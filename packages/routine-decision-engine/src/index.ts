import { performance } from "node:perf_hooks";

import {
  capabilityForCommandV11,
  type AeCepAdapterClientV11,
  type AeCepAdapterStateV11,
} from "../../adapters/ae-cep/src/v1_1.js";
import {
  AE_ADAPTER_PROTOCOL_VERSION_V11,
  type AeAdapterPublicCommandV11,
  type AeAdapterResponseV11,
} from "../../adapters/ae-cep/src/protocol-v1_1.js";

export type AeRoutineRef = Readonly<{ stableId: string } | { hostId: number }>;

export type RoutineIntent =
  | Readonly<{ kind: "CREATE_COMP"; stableId: string; name: string; width: number; height: number; pixelAspect: number; duration: number; frameRate: number; displayStartTime?: number }>
  | Readonly<{ kind: "UPDATE_COMP_SETTINGS"; comp: AeRoutineRef; settings: Readonly<Record<string, unknown>> }>
  | Readonly<{ kind: "ADD_MEDIA_LAYER"; stableId: string; comp: AeRoutineRef; item: AeRoutineRef; duration?: number }>
  | Readonly<{ kind: "DUPLICATE_LAYER"; stableId: string; comp: AeRoutineRef; layer: AeRoutineRef }>
  | Readonly<{ kind: "REORDER_LAYER"; comp: AeRoutineRef; layer: AeRoutineRef; position: "BEGINNING" | "END" | "BEFORE" | "AFTER"; relativeTo?: AeRoutineRef }>
  | Readonly<{ kind: "SET_LAYER_TRANSFORM"; comp: AeRoutineRef; layer: AeRoutineRef; values: Readonly<Record<string, unknown>> }>
  | Readonly<{ kind: "SET_LAYER_TIMING"; comp: AeRoutineRef; layer: AeRoutineRef; timing: Readonly<Record<string, unknown>> }>
  | Readonly<{ kind: "ADD_EFFECT"; comp: AeRoutineRef; layer: AeRoutineRef; matchName: string; name?: string }>;

export type RoutineEscalationReason =
  | "NOT_ROUTINE"
  | "INVALID_ROUTINE_INPUT"
  | "LEASE_EXPIRED"
  | "LEASE_INVALID"
  | "STALE_HOST_STATE"
  | "HOST_REJECTED";

export interface RoutineLocalDecision {
  readonly route: "LOCAL";
  readonly command: AeAdapterPublicCommandV11;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile: "ROUTINE_FASTPATH_V1";
}

export interface RoutineEscalatedDecision {
  readonly route: "ESCALATE";
  readonly reason: RoutineEscalationReason;
  readonly detail: string;
}

export type RoutineDecision = RoutineLocalDecision | RoutineEscalatedDecision;

export interface RoutineExecutionTimings {
  readonly decisionMs: number;
  readonly dispatchMs: number;
  readonly totalMs: number;
}

export interface RoutineExecutionResult {
  readonly route: "LOCAL" | "ESCALATE";
  readonly decision: RoutineLocalDecision | null;
  readonly reason: RoutineEscalationReason | null;
  readonly detail: string | null;
  readonly response: AeAdapterResponseV11 | null;
  readonly withinBudget: boolean;
  readonly timings: RoutineExecutionTimings;
  readonly hostRevision: number;
}

export interface RoutineDecisionEngineOptions {
  readonly budgetMs?: number;
  readonly leaseTtlMs?: number;
  readonly clock?: () => number;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isPositiveNumber = (value: unknown): value is number => isFiniteNumber(value) && value > 0;
const isPositiveInteger = (value: unknown): value is number => Number.isInteger(value) && Number(value) > 0;
const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isRef = (value: unknown): value is AeRoutineRef => {
  const candidate = asRecord(value);
  if (candidate === null) return false;
  return isNonEmptyString(candidate["stableId"]) || isPositiveInteger(candidate["hostId"]);
};
const finiteVector = (value: unknown): value is readonly number[] =>
  Array.isArray(value) && (value.length === 2 || value.length === 3) && value.every(isFiniteNumber);
const escalate = (reason: RoutineEscalationReason, detail: string): RoutineEscalatedDecision => ({ route: "ESCALATE", reason, detail });
const local = (command: AeAdapterPublicCommandV11, payload: Readonly<Record<string, unknown>>): RoutineLocalDecision => ({
  route: "LOCAL",
  command,
  payload,
  readbackProfile: "ROUTINE_FASTPATH_V1",
});

const compileCreateComp = (input: Record<string, unknown>): RoutineDecision => {
  if (!isNonEmptyString(input["stableId"]) || !isNonEmptyString(input["name"])
    || !isPositiveInteger(input["width"]) || !isPositiveInteger(input["height"])
    || !isPositiveNumber(input["pixelAspect"]) || !isPositiveNumber(input["duration"])
    || !isPositiveNumber(input["frameRate"])) {
    return escalate("INVALID_ROUTINE_INPUT", "CREATE_COMP requires stableId, name, positive integer dimensions, pixel aspect, duration, and frame rate.");
  }
  const payload: Record<string, unknown> = {
    stableId: input["stableId"], name: input["name"], width: input["width"], height: input["height"],
    pixelAspect: input["pixelAspect"], duration: input["duration"], frameRate: input["frameRate"],
  };
  if (input["displayStartTime"] !== undefined) {
    if (!isFiniteNumber(input["displayStartTime"])) return escalate("INVALID_ROUTINE_INPUT", "displayStartTime must be finite.");
    payload["displayStartTime"] = input["displayStartTime"];
  }
  return local("comp.create", payload);
};

const compileCompSettings = (input: Record<string, unknown>): RoutineDecision => {
  if (!isRef(input["comp"])) return escalate("INVALID_ROUTINE_INPUT", "UPDATE_COMP_SETTINGS requires an unambiguous composition reference.");
  const source = asRecord(input["settings"]);
  if (source === null) return escalate("INVALID_ROUTINE_INPUT", "UPDATE_COMP_SETTINGS requires settings.");
  const settings: Record<string, unknown> = {};
  for (const key of ["width", "height"] as const) {
    if (source[key] !== undefined) {
      if (!isPositiveInteger(source[key])) return escalate("INVALID_ROUTINE_INPUT", `${key} must be a positive integer.`);
      settings[key] = source[key];
    }
  }
  for (const key of ["pixelAspect", "duration", "frameRate"] as const) {
    if (source[key] !== undefined) {
      if (!isPositiveNumber(source[key])) return escalate("INVALID_ROUTINE_INPUT", `${key} must be positive and finite.`);
      settings[key] = source[key];
    }
  }
  if (source["displayStartTime"] !== undefined) {
    if (!isFiniteNumber(source["displayStartTime"])) return escalate("INVALID_ROUTINE_INPUT", "displayStartTime must be finite.");
    settings["displayStartTime"] = source["displayStartTime"];
  }
  if (Object.keys(settings).length === 0) return escalate("INVALID_ROUTINE_INPUT", "UPDATE_COMP_SETTINGS contained no supported setting.");
  return local("comp.update_settings", { comp: input["comp"], settings });
};

const compileAddMediaLayer = (input: Record<string, unknown>): RoutineDecision => {
  if (!isNonEmptyString(input["stableId"]) || !isRef(input["comp"]) || !isRef(input["item"])) {
    return escalate("INVALID_ROUTINE_INPUT", "ADD_MEDIA_LAYER requires stableId plus unambiguous comp and item references.");
  }
  const payload: Record<string, unknown> = { stableId: input["stableId"], comp: input["comp"], item: input["item"] };
  if (input["duration"] !== undefined) {
    if (!isPositiveNumber(input["duration"])) return escalate("INVALID_ROUTINE_INPUT", "Layer duration must be positive and finite.");
    payload["duration"] = input["duration"];
  }
  return local("layer.add_media", payload);
};

const compileDuplicateLayer = (input: Record<string, unknown>): RoutineDecision => {
  if (!isNonEmptyString(input["stableId"]) || !isRef(input["comp"]) || !isRef(input["layer"])) {
    return escalate("INVALID_ROUTINE_INPUT", "DUPLICATE_LAYER requires a new stableId plus unambiguous comp and layer references.");
  }
  return local("layer.duplicate", { stableId: input["stableId"], comp: input["comp"], layer: input["layer"] });
};

const compileReorderLayer = (input: Record<string, unknown>): RoutineDecision => {
  if (!isRef(input["comp"]) || !isRef(input["layer"])) return escalate("INVALID_ROUTINE_INPUT", "REORDER_LAYER requires comp and layer references.");
  const position = input["position"];
  if (position !== "BEGINNING" && position !== "END" && position !== "BEFORE" && position !== "AFTER") {
    return escalate("INVALID_ROUTINE_INPUT", "REORDER_LAYER position must be BEGINNING, END, BEFORE, or AFTER.");
  }
  const payload: Record<string, unknown> = { comp: input["comp"], layer: input["layer"], position };
  if (position === "BEFORE" || position === "AFTER") {
    if (!isRef(input["relativeTo"])) return escalate("INVALID_ROUTINE_INPUT", `${position} requires relativeTo.`);
    payload["relativeTo"] = input["relativeTo"];
  }
  return local("layer.reorder", payload);
};

const compileTransform = (input: Record<string, unknown>): RoutineDecision => {
  if (!isRef(input["comp"]) || !isRef(input["layer"])) return escalate("INVALID_ROUTINE_INPUT", "SET_LAYER_TRANSFORM requires comp and layer references.");
  const source = asRecord(input["values"]);
  if (source === null) return escalate("INVALID_ROUTINE_INPUT", "SET_LAYER_TRANSFORM requires values.");
  const values: Record<string, unknown> = {};
  for (const key of ["anchorPoint", "position", "scale"] as const) {
    if (source[key] !== undefined) {
      if (!finiteVector(source[key])) return escalate("INVALID_ROUTINE_INPUT", `${key} must be a finite 2D or 3D vector.`);
      values[key] = [...source[key]];
    }
  }
  for (const key of ["rotation", "opacity"] as const) {
    if (source[key] !== undefined) {
      if (!isFiniteNumber(source[key])) return escalate("INVALID_ROUTINE_INPUT", `${key} must be finite.`);
      if (key === "opacity" && (source[key] < 0 || source[key] > 100)) return escalate("INVALID_ROUTINE_INPUT", "opacity must be between 0 and 100.");
      values[key] = source[key];
    }
  }
  if (Object.keys(values).length === 0) return escalate("INVALID_ROUTINE_INPUT", "SET_LAYER_TRANSFORM contained no supported transform value.");
  return local("layer.set_transform", { comp: input["comp"], layer: input["layer"], values });
};

const compileTiming = (input: Record<string, unknown>): RoutineDecision => {
  if (!isRef(input["comp"]) || !isRef(input["layer"])) return escalate("INVALID_ROUTINE_INPUT", "SET_LAYER_TIMING requires comp and layer references.");
  const source = asRecord(input["timing"]);
  if (source === null) return escalate("INVALID_ROUTINE_INPUT", "SET_LAYER_TIMING requires timing.");
  const timing: Record<string, unknown> = {};
  for (const key of ["startTime", "inPoint", "outPoint", "stretch"] as const) {
    if (source[key] !== undefined) {
      if (!isFiniteNumber(source[key])) return escalate("INVALID_ROUTINE_INPUT", `${key} must be finite.`);
      if (key === "stretch" && source[key] === 0) return escalate("INVALID_ROUTINE_INPUT", "stretch cannot be zero.");
      timing[key] = source[key];
    }
  }
  if (Object.keys(timing).length === 0) return escalate("INVALID_ROUTINE_INPUT", "SET_LAYER_TIMING contained no supported timing value.");
  return local("layer.set_timing", { comp: input["comp"], layer: input["layer"], timing });
};

const compileAddEffect = (input: Record<string, unknown>): RoutineDecision => {
  if (!isRef(input["comp"]) || !isRef(input["layer"]) || !isNonEmptyString(input["matchName"])) {
    return escalate("INVALID_ROUTINE_INPUT", "ADD_EFFECT requires comp and layer references plus an Adobe effect matchName.");
  }
  const payload: Record<string, unknown> = { comp: input["comp"], layer: input["layer"], matchName: input["matchName"] };
  if (input["name"] !== undefined) {
    if (!isNonEmptyString(input["name"])) return escalate("INVALID_ROUTINE_INPUT", "Effect name must be a non-empty string.");
    payload["name"] = input["name"];
  }
  return local("effect.add", payload);
};

export const compileRoutineIntent = (value: unknown): RoutineDecision => {
  const input = asRecord(value);
  if (input === null || !isNonEmptyString(input["kind"])) return escalate("NOT_ROUTINE", "Intent is not a recognized structured routine editing decision.");
  switch (input["kind"]) {
    case "CREATE_COMP": return compileCreateComp(input);
    case "UPDATE_COMP_SETTINGS": return compileCompSettings(input);
    case "ADD_MEDIA_LAYER": return compileAddMediaLayer(input);
    case "DUPLICATE_LAYER": return compileDuplicateLayer(input);
    case "REORDER_LAYER": return compileReorderLayer(input);
    case "SET_LAYER_TRANSFORM": return compileTransform(input);
    case "SET_LAYER_TIMING": return compileTiming(input);
    case "ADD_EFFECT": return compileAddEffect(input);
    default: return escalate("NOT_ROUTINE", `Intent kind '${input["kind"]}' is not allow-listed for local execution.`);
  }
};

export class RoutineDecisionEngine {
  readonly client: AeCepAdapterClientV11;
  readonly budgetMs: number;
  readonly leaseTtlMs: number;
  readonly clock: () => number;
  #hostRevision: number;
  #expiresAtMs: number;
  #valid = true;
  #operationCounter = 0;
  #queue: Promise<void> = Promise.resolve();

  constructor(client: AeCepAdapterClientV11, initialState: AeCepAdapterStateV11, options: RoutineDecisionEngineOptions = {}) {
    this.client = client;
    this.budgetMs = options.budgetMs ?? 1000;
    this.leaseTtlMs = options.leaseTtlMs ?? 30_000;
    this.clock = options.clock ?? (() => performance.now());
    this.#hostRevision = initialState.hostRevision;
    this.#expiresAtMs = this.clock() + this.leaseTtlMs;
  }

  get hostRevision(): number { return this.#hostRevision; }
  invalidate(): void { this.#valid = false; }
  refresh(state: AeCepAdapterStateV11): void {
    this.#hostRevision = state.hostRevision;
    this.#expiresAtMs = this.clock() + this.leaseTtlMs;
    this.#valid = true;
  }

  async execute(intent: unknown, transactionId = "routine-fastpath"): Promise<RoutineExecutionResult> {
    let resolveResult!: (value: RoutineExecutionResult) => void;
    let rejectResult!: (reason?: unknown) => void;
    const resultPromise = new Promise<RoutineExecutionResult>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    const previous = this.#queue;
    this.#queue = (async () => {
      await previous;
      try { resolveResult(await this.#executeOne(intent, transactionId)); }
      catch (error) { rejectResult(error); }
    })().then(() => undefined, () => undefined);
    return await resultPromise;
  }

  async #executeOne(intent: unknown, transactionId: string): Promise<RoutineExecutionResult> {
    const started = this.clock();
    if (!this.#valid) return this.#escalated(started, "LEASE_INVALID", "Warm routine lease is invalid and requires a fresh observation.");
    if (started > this.#expiresAtMs) {
      this.#valid = false;
      return this.#escalated(started, "LEASE_EXPIRED", "Warm routine lease expired and requires a fresh observation.");
    }

    const compiled = compileRoutineIntent(intent);
    const decisionComplete = this.clock();
    if (compiled.route === "ESCALATE") {
      return {
        route: "ESCALATE", decision: null, reason: compiled.reason, detail: compiled.detail, response: null,
        withinBudget: decisionComplete - started <= this.budgetMs,
        timings: { decisionMs: decisionComplete - started, dispatchMs: 0, totalMs: decisionComplete - started },
        hostRevision: this.#hostRevision,
      };
    }

    this.client.filesystemPolicy.assertCommandPayload(compiled.command, compiled.payload);
    const requestId = this.client.requestIdFactory();
    const operationId = `${transactionId}_ROUTINE_${++this.#operationCounter}`;
    const dispatchStarted = this.clock();
    const response = await this.client.transport.dispatch({
      protocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
      requestId,
      transactionId,
      operationId,
      capabilityId: capabilityForCommandV11(compiled.command),
      command: compiled.command,
      expectedProjectRevision: `ae-revision:${this.#hostRevision}`,
      expectedProjectFingerprint: null,
      expectedHostProjectRevision: this.#hostRevision,
      payload: compiled.payload,
      readbackProfile: compiled.readbackProfile,
    });
    const completed = this.clock();
    const timings = { decisionMs: decisionComplete - started, dispatchMs: completed - dispatchStarted, totalMs: completed - started };

    if (response.outcome === "APPLIED" || response.outcome === "NO_OP") {
      if (typeof response.hostProjectRevision === "number") this.#hostRevision = response.hostProjectRevision;
      return {
        route: "LOCAL", decision: compiled, reason: null, detail: null, response,
        withinBudget: timings.totalMs <= this.budgetMs, timings, hostRevision: this.#hostRevision,
      };
    }

    this.#valid = false;
    const stale = response.error?.code === "HOST_REVISION_MISMATCH" || response.error?.category === "STALE_PROJECT_STATE";
    return {
      route: "ESCALATE", decision: compiled, reason: stale ? "STALE_HOST_STATE" : "HOST_REJECTED",
      detail: response.error?.message ?? `AE returned ${response.outcome}.`, response,
      withinBudget: timings.totalMs <= this.budgetMs, timings, hostRevision: this.#hostRevision,
    };
  }

  #escalated(started: number, reason: RoutineEscalationReason, detail: string): RoutineExecutionResult {
    const completed = this.clock();
    return {
      route: "ESCALATE", decision: null, reason, detail, response: null,
      withinBudget: completed - started <= this.budgetMs,
      timings: { decisionMs: completed - started, dispatchMs: 0, totalMs: completed - started },
      hostRevision: this.#hostRevision,
    };
  }
}
