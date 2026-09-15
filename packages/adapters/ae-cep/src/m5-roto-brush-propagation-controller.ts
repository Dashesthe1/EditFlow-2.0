import {
  prepareRotoBrushSemanticActionV1,
  type RotoBrushTimeRangeV1,
} from "./m5-roto-brush.js";
import {
  assertRotoBrushEffectIdentityV26,
  buildRotoBrushReadbackRequestV26,
  deriveRotoBrushEffectFingerprintV26,
  deriveRotoBrushSessionRevisionV26,
} from "./m5-roto-brush-readback.js";
import type {
  AeRotoBrushRequestV26,
  AeRotoBrushResponseV26,
} from "./protocol-v2_6.js";

export type RotoBrushPropagationOperationV1 = "PROPAGATE_FORWARD" | "PROPAGATE_BACKWARD";
export type RotoBrushPropagationEscalationV1 =
  | "TARGET_UNAVAILABLE"
  | "AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE"
  | "ROTO_EFFECT_IDENTITY_NOT_ESTABLISHED"
  | "START_TIME_MISMATCH"
  | "RANGE_EXCEEDS_BOUNDS"
  | "VISUAL_DRIVER_UNAVAILABLE"
  | "PROPAGATION_DIRECTION_UNPROVEN"
  | "VISUAL_ACTION_REFUSED"
  | "POST_TARGET_DRIFT"
  | "FINAL_TIME_NOT_REACHED"
  | "SESSION_PROGRESS_NOT_OBSERVED";
export interface RotoBrushPropagationReadbackTransportV26 {
  dispatch(request: AeRotoBrushRequestV26): Promise<AeRotoBrushResponseV26>;
}

export interface RotoBrushPropagationVisualRequestV1 {
  readonly operation: RotoBrushPropagationOperationV1;
  readonly compHostId: number;
  readonly layerHostId: number;
  readonly expectedCompName: string;
  readonly expectedLayerName: string;
  readonly expectedSessionRevision: string;
  readonly expectedEffectFingerprint: string;
  readonly expectedEffectMatchCount: 1;
  readonly range: RotoBrushTimeRangeV1;
  readonly frameDuration: number;
  readonly expectedFrameSteps: number;
  readonly expectedStartTime: number;
  readonly expectedEndTime: number;
  readonly evidenceIds: readonly string[];
}

export interface RotoBrushPropagationVisualResultV1 {
  readonly status: "COMPLETED" | "REFUSED";
  readonly propagationVisualVerified?: boolean;
  readonly finalVisualEvidenceId?: string | null;
  readonly detail?: string | null;
  readonly frameSteps?: number;
  readonly aeActionToActionLatenciesMs?: readonly number[];
}
export interface RotoBrushPropagationVisualDriverV1 {
  readonly driverId: string;
  readonly verifiedVision: boolean;
  readonly verifiedCursorControl: boolean;
  readonly supportedDirections: readonly RotoBrushPropagationOperationV1[];
  propagate(input: RotoBrushPropagationVisualRequestV1): Promise<RotoBrushPropagationVisualResultV1>;
}

export interface RotoBrushPropagationRunV1 {
  readonly route: "LOCAL" | "ESCALATE";
  readonly operation: RotoBrushPropagationOperationV1;
  readonly escalationReason: RotoBrushPropagationEscalationV1 | null;
  readonly baselineSessionRevision: string | null;
  readonly finalSessionRevision: string | null;
  readonly baselineEffectFingerprint: string | null;
  readonly finalEffectFingerprint: string | null;
  readonly baselineTime: number | null;
  readonly finalTime: number | null;
  readonly expectedStartTime: number | null;
  readonly expectedEndTime: number | null;
  readonly expectedFrameSteps: number;
  readonly visualEvidenceId: string | null;
  readonly aeActionToActionLatenciesMs: readonly number[];
  readonly readback: AeRotoBrushResponseV26["readback"];
}

const MAX_PROPAGATION_STEPS = 12;
const finitePositive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const exactTarget = (
  response: AeRotoBrushResponseV26,
  input: { compHostId: number; layerHostId: number; expectedCompName: string; expectedLayerName: string },
): boolean => {
  const value = response.readback;
  return response.outcome === "NO_OP"
    && !!value
    && value.comp.hostId === input.compHostId
    && value.layer.hostId === input.layerHostId
    && value.comp.name === input.expectedCompName
    && value.layer.name === input.expectedLayerName;
};

const exactEffectState = (response: AeRotoBrushResponseV26): boolean => {
  const value = response.readback;
  return response.outcome === "NO_OP"
    && !!value
    && !value.propertyTreeTruncated
    && value.effectMatchCount === 1
    && !!value.effect;
};

const readback = async (
  transport: RotoBrushPropagationReadbackTransportV26,
  input: { compHostId: number; layerHostId: number },
  suffix: string,
): Promise<AeRotoBrushResponseV26> => transport.dispatch(buildRotoBrushReadbackRequestV26({
  requestId: `M5_ROTO_PROPAGATE_${suffix}`,
  transactionId: `M5_ROTO_PROPAGATE_${suffix}`,
  operationId: `M5_ROTO_PROPAGATE_${suffix}`,
  payload: { comp: { hostId: input.compHostId }, layer: { hostId: input.layerHostId } },
  readbackProfile: "M5_ROTO_BRUSH_PROPAGATION_VERIFY",
}));

const cleanLatencies = (values: readonly number[] | undefined): readonly number[] => {
  if (!values || values.some((value) => !Number.isFinite(value) || value < 0)) return [];
  return Object.freeze([...values]);
};

const nearFrameTime = (actual: number, expected: number, frameDuration: number): boolean =>
  Number.isFinite(actual) && Math.abs(actual - expected) <= Math.max(0.002, frameDuration * 0.60);

const framePlan = (
  operation: RotoBrushPropagationOperationV1,
  range: RotoBrushTimeRangeV1,
  frameDuration: number,
  compDuration: number,
): { start: number; end: number; steps: number } | null => {
  if (!finitePositive(frameDuration) || !finitePositive(compDuration)) return null;
  if (range.startTime < 0 || range.endTime > compDuration + frameDuration * 0.1) return null;
  const rawSteps = (range.endTime - range.startTime) / frameDuration;
  const steps = Math.round(rawSteps);
  if (steps < 1 || steps > MAX_PROPAGATION_STEPS || Math.abs(rawSteps - steps) > 0.15) return null;
  return operation === "PROPAGATE_FORWARD"
    ? { start: range.startTime, end: range.endTime, steps }
    : { start: range.endTime, end: range.startTime, steps };
};
export class GuardedRotoBrushPropagationControllerV1 {
  readonly transport: RotoBrushPropagationReadbackTransportV26;
  readonly visualDriver: RotoBrushPropagationVisualDriverV1 | null;

  constructor(
    transport: RotoBrushPropagationReadbackTransportV26,
    visualDriver: RotoBrushPropagationVisualDriverV1 | null = null,
  ) {
    this.transport = transport;
    this.visualDriver = visualDriver;
  }

  async run(input: {
    readonly operation: RotoBrushPropagationOperationV1;
    readonly compHostId: number;
    readonly layerHostId: number;
    readonly expectedCompName: string;
    readonly expectedLayerName: string;
    readonly range: RotoBrushTimeRangeV1;
    readonly evidenceIds: readonly string[];
  }): Promise<RotoBrushPropagationRunV1> {
    const before = await readback(this.transport, input, "BEFORE");
    if (!exactTarget(before, input)) return this.#escalate(input.operation, "TARGET_UNAVAILABLE", before);
    if (!exactEffectState(before)) return this.#escalate(input.operation, "AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE", before);
    try { assertRotoBrushEffectIdentityV26(before); }
    catch (_) { return this.#escalate(input.operation, "ROTO_EFFECT_IDENTITY_NOT_ESTABLISHED", before); }
    const rb = before.readback!;
    const plan = framePlan(input.operation, input.range, rb.comp.frameDuration, rb.comp.duration);
    if (!plan) return this.#escalate(input.operation, "RANGE_EXCEEDS_BOUNDS", before);
    if (!nearFrameTime(rb.comp.time, plan.start, rb.comp.frameDuration)) {
      return this.#escalate(input.operation, "START_TIME_MISMATCH", before, null, null, plan.start, plan.end, plan.steps);
    }
    let baselineSessionRevision: string;
    let baselineEffectFingerprint: string;
    try {
      baselineSessionRevision = deriveRotoBrushSessionRevisionV26(before);
      baselineEffectFingerprint = deriveRotoBrushEffectFingerprintV26(before);
    } catch (_) {
      return this.#escalate(input.operation, "AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE", before, null, null, plan.start, plan.end, plan.steps);
    }
    const semantic = prepareRotoBrushSemanticActionV1({
      operation: input.operation,
      target: {
        compHostId: input.compHostId,
        layerHostId: input.layerHostId,
        expectedCompName: input.expectedCompName,
        expectedLayerName: input.expectedLayerName,
      },
      expectedSessionRevision: baselineSessionRevision,
      range: input.range,
      evidenceIds: input.evidenceIds,
    });
    const driver = this.visualDriver;
    if (!driver || !driver.verifiedVision || !driver.verifiedCursorControl) {
      return this.#escalate(input.operation, "VISUAL_DRIVER_UNAVAILABLE", before, baselineSessionRevision, baselineEffectFingerprint, plan.start, plan.end, plan.steps);
    }
    if (!driver.supportedDirections.includes(input.operation)) {
      return this.#escalate(input.operation, "PROPAGATION_DIRECTION_UNPROVEN", before, baselineSessionRevision, baselineEffectFingerprint, plan.start, plan.end, plan.steps);
    }
    const visual = await driver.propagate({
      operation: input.operation,
      compHostId: input.compHostId,
      layerHostId: input.layerHostId,
      expectedCompName: input.expectedCompName,
      expectedLayerName: input.expectedLayerName,
      expectedSessionRevision: baselineSessionRevision,
      expectedEffectFingerprint: baselineEffectFingerprint,
      expectedEffectMatchCount: 1,
      range: semantic.range as RotoBrushTimeRangeV1,
      frameDuration: rb.comp.frameDuration,
      expectedFrameSteps: plan.steps,
      expectedStartTime: plan.start,
      expectedEndTime: plan.end,
      evidenceIds: semantic.evidenceIds,
    });
    const latencies = cleanLatencies(visual.aeActionToActionLatenciesMs);
    if (visual.status !== "COMPLETED" || visual.propagationVisualVerified !== true || visual.frameSteps !== plan.steps) {
      return this.#escalate(input.operation, "VISUAL_ACTION_REFUSED", before, baselineSessionRevision, baselineEffectFingerprint, plan.start, plan.end, plan.steps, visual.finalVisualEvidenceId ?? null, latencies);
    }

    const after = await readback(this.transport, input, "AFTER");
    if (!exactTarget(after, input)) {
      return this.#escalate(input.operation, "POST_TARGET_DRIFT", after, baselineSessionRevision, baselineEffectFingerprint, plan.start, plan.end, plan.steps, visual.finalVisualEvidenceId ?? null, latencies);
    }
    if (!exactEffectState(after)) {
      return this.#escalate(input.operation, "AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE", after, baselineSessionRevision, baselineEffectFingerprint, plan.start, plan.end, plan.steps, visual.finalVisualEvidenceId ?? null, latencies);
    }
    try { assertRotoBrushEffectIdentityV26(after); }
    catch (_) {
      return this.#escalate(input.operation, "ROTO_EFFECT_IDENTITY_NOT_ESTABLISHED", after, baselineSessionRevision, baselineEffectFingerprint, plan.start, plan.end, plan.steps, visual.finalVisualEvidenceId ?? null, latencies);
    }
    const finalReadback = after.readback!;
    if (!nearFrameTime(finalReadback.comp.time, plan.end, finalReadback.comp.frameDuration)) {
      return this.#escalate(input.operation, "FINAL_TIME_NOT_REACHED", after, baselineSessionRevision, baselineEffectFingerprint, plan.start, plan.end, plan.steps, visual.finalVisualEvidenceId ?? null, latencies);
    }
    const finalSessionRevision = deriveRotoBrushSessionRevisionV26(after);
    const finalEffectFingerprint = deriveRotoBrushEffectFingerprintV26(after);
    if (finalSessionRevision === baselineSessionRevision) {
      return this.#escalate(input.operation, "SESSION_PROGRESS_NOT_OBSERVED", after, baselineSessionRevision, baselineEffectFingerprint, plan.start, plan.end, plan.steps, visual.finalVisualEvidenceId ?? null, latencies, finalSessionRevision, finalEffectFingerprint);
    }
    return {
      route: "LOCAL",
      operation: input.operation,
      escalationReason: null,
      baselineSessionRevision,
      finalSessionRevision,
      baselineEffectFingerprint,
      finalEffectFingerprint,
      baselineTime: rb.comp.time,
      finalTime: finalReadback.comp.time,
      expectedStartTime: plan.start,
      expectedEndTime: plan.end,
      expectedFrameSteps: plan.steps,
      visualEvidenceId: visual.finalVisualEvidenceId ?? null,
      aeActionToActionLatenciesMs: latencies,
      readback: finalReadback,
    };
  }
  #escalate(
    operation: RotoBrushPropagationOperationV1,
    reason: RotoBrushPropagationEscalationV1,
    response: AeRotoBrushResponseV26,
    baselineSessionRevision: string | null = null,
    baselineEffectFingerprint: string | null = null,
    expectedStartTime: number | null = null,
    expectedEndTime: number | null = null,
    expectedFrameSteps = 0,
    visualEvidenceId: string | null = null,
    aeActionToActionLatenciesMs: readonly number[] = [],
    finalSessionRevision: string | null = null,
    finalEffectFingerprint: string | null = null,
  ): RotoBrushPropagationRunV1 {
    return {
      route: "ESCALATE",
      operation,
      escalationReason: reason,
      baselineSessionRevision,
      finalSessionRevision,
      baselineEffectFingerprint,
      finalEffectFingerprint,
      baselineTime: response.readback?.comp.time ?? null,
      finalTime: response.readback?.comp.time ?? null,
      expectedStartTime,
      expectedEndTime,
      expectedFrameSteps,
      visualEvidenceId,
      aeActionToActionLatenciesMs,
      readback: response.readback,
    };
  }
}
