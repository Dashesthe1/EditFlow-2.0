import { randomUUID } from "node:crypto";

import type {
  CompiledLiveAeRecipeV1,
  LiveAeRecipeActionV1,
  LiveAeTimeRemapBaselineV1,
  LiveAeTransformBaselineV1,
} from "../../../packages/recipe-compiler/src/index.js";
import {
  materializeCameraPushV1,
  materializeTimeRemapPulseV1,
} from "../../../packages/recipe-compiler/src/index.js";
import {
  AE_ADAPTER_PROTOCOL_VERSION_V11,
  type AeAdapterCommandV11,
  type AeAdapterRequestV11,
  type AeAdapterResponseV11,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";
import {
  capabilityForCommandV11,
} from "../../../packages/adapters/ae-cep/src/v1_1.js";
import {
  type AeTemporalInterpolationRequestV17,
  type AeTemporalInterpolationResponseV17,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_7.js";
import {
  buildTemporalInterpolationRequestV17,
} from "../../../packages/adapters/ae-cep/src/m3-temporal-interpolation.js";import {
  type AeTemporalEaseRequestV18,
  type AeTemporalEaseResponseV18,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_8.js";
import {
  buildTemporalEaseRequestV18,
} from "../../../packages/adapters/ae-cep/src/m3-temporal-ease.js";
import {
  type AeTimeRemapRequestV27,
  type AeTimeRemapResponseV27,
} from "../../../packages/adapters/ae-cep/src/protocol-v2_7.js";
import {
  buildTimeRemapRequestV27,
} from "../../../packages/adapters/ae-cep/src/m5-time-remap.js";

export interface LiveAeRecipeTransportV1 {
  dispatch(request: AeAdapterRequestV11): Promise<AeAdapterResponseV11>;
  dispatch(request: AeTemporalInterpolationRequestV17): Promise<AeTemporalInterpolationResponseV17>;
  dispatch(request: AeTemporalEaseRequestV18): Promise<AeTemporalEaseResponseV18>;
  dispatch(request: AeTimeRemapRequestV27): Promise<AeTimeRemapResponseV27>;
}

export interface LiveAeRecipeRuntimeOptionsV1 {
  readonly initialHostRevision: number;
  readonly transactionId?: string;
  readonly requestIdFactory?: () => string;
}

export interface LiveAeRecipeTraceEntryV1 {
  readonly actionType: LiveAeRecipeActionV1["type"] | "ROLLBACK";
  readonly protocolVersion: string;
  readonly command: string;
  readonly outcome: string;
  readonly hostRevision: number;
}

export interface LiveAeRecipeExecutionResultV1 {  readonly status: "PASS";
  readonly transactionId: string;
  readonly finalHostRevision: number;
  readonly appliedMutationCount: number;
  readonly traces: readonly LiveAeRecipeTraceEntryV1[];
}

export class LiveAeRecipeExecutionError extends Error {
  readonly causeError: unknown;
  readonly rollbackComplete: boolean;
  readonly traces: readonly LiveAeRecipeTraceEntryV1[];

  constructor(
    message: string,
    causeError: unknown,
    rollbackComplete: boolean,
    traces: readonly LiveAeRecipeTraceEntryV1[],
  ) {
    super(message);
    this.name = "LiveAeRecipeExecutionError";
    this.causeError = causeError;
    this.rollbackComplete = rollbackComplete;
    this.traces = traces;
  }
}

type AnySupportedResponse =
  | AeAdapterResponseV11
  | AeTemporalInterpolationResponseV17
  | AeTemporalEaseResponseV18
  | AeTimeRemapResponseV27;

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;const finiteVector = (value: unknown): readonly number[] | null =>
  Array.isArray(value)
  && value.length >= 2
  && value.every((item) => typeof item === "number" && Number.isFinite(item))
    ? value as readonly number[]
    : null;

const responseError = (response: AnySupportedResponse): Error => {
  const error = response.error;
  const prefix = error?.code ?? response.outcome;
  return new Error(prefix + ": " + (error?.message ?? "AE live recipe operation failed."));
};

const assertSuccess = (response: AnySupportedResponse): void => {
  if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
    throw responseError(response);
  }
};

const v11Request = (
  command: AeAdapterCommandV11,
  payload: Readonly<Record<string, unknown>>,
  revision: number | null,
  transactionId: string,
  operationId: string,
  requestId: string,
): AeAdapterRequestV11 => ({
  protocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
  requestId,
  transactionId,
  operationId,
  capabilityId: capabilityForCommandV11(command),
  command,
  expectedProjectRevision: null,
  expectedProjectFingerprint: null,
  expectedHostProjectRevision: revision,
  payload,
  readbackProfile: "TUTORIAL_LIVE_RECIPE_V1",
});const traceEntry = (
  actionType: LiveAeRecipeTraceEntryV1["actionType"],
  response: AnySupportedResponse,
  hostRevision: number,
): LiveAeRecipeTraceEntryV1 => ({
  actionType,
  protocolVersion: response.protocolVersion,
  command: response.command,
  outcome: response.outcome,
  hostRevision,
});

const transformFromReadback = (
  readback: Readonly<Record<string, unknown>> | null,
): LiveAeTransformBaselineV1 | null => {
  const top = asRecord(readback);
  const layer = asRecord(top?.["replacementLayer"] ?? top?.["layer"]);
  const transform = asRecord(layer?.["transform"]);
  const anchorPoint = finiteVector(transform?.["anchorPoint"]);
  const position = finiteVector(transform?.["position"]);
  const scale = finiteVector(transform?.["scale"]);
  if (anchorPoint === null || position === null || scale === null) return null;
  return { anchorPoint, position, scale };
};

const timeRemapBaseline = (
  response: AeTimeRemapResponseV27,
): LiveAeTimeRemapBaselineV1 => {
  const readback = response.readback;
  if (readback === null) {
    throw new Error("TIME_REMAP_READBACK_REQUIRED: protocol 2.7 returned no native readback.");
  }
  return {
    timeRemapEnabled: readback.timeRemapEnabled,
    propertyAvailable: readback.propertyAvailable,
    keys: readback.keys.map((key) => ({
      index: key.index,
      time: key.time,
      value: key.value,
    })),
  };
};const keyIndexAtTime = (
  response: AeTimeRemapResponseV27,
  time: number,
): number => {
  const readback = response.readback;
  if (readback === null) throw new Error("TIME_REMAP_READBACK_REQUIRED");
  const tolerance = 1 / 10000;
  const match = readback.keys.find((key) => Math.abs(key.time - time) <= tolerance);
  if (match === undefined) {
    throw new Error("TIME_REMAP_KEY_INDEX_UNRESOLVED: no key exists at adapted time " + time + ".");
  }
  return match.index;
};

export const executeLiveAeRecipeV1 = async (
  plan: CompiledLiveAeRecipeV1,
  transport: LiveAeRecipeTransportV1,
  options: LiveAeRecipeRuntimeOptionsV1,
): Promise<LiveAeRecipeExecutionResultV1> => {
  if (!Number.isInteger(options.initialHostRevision) || options.initialHostRevision < 0) {
    throw new TypeError("initialHostRevision must be a non-negative integer.");
  }
  const transactionId = options.transactionId ?? "tutorial-live-" + randomUUID();
  const requestIdFactory = options.requestIdFactory ?? randomUUID;
  const traces: LiveAeRecipeTraceEntryV1[] = [];
  const transforms = new Map<string, LiveAeTransformBaselineV1>();
  const remaps = new Map<string, LiveAeTimeRemapBaselineV1>();
  let hostRevision = options.initialHostRevision;
  let appliedMutationCount = 0;
  let operationCounter = 0;

  const operationId = (suffix: string): string =>
    transactionId + ":" + (++operationCounter) + ":" + suffix;

  const accept = (
    actionType: LiveAeRecipeTraceEntryV1["actionType"],
    response: AnySupportedResponse,
    mutation: boolean,
  ): void => {    assertSuccess(response);
    if (typeof response.hostProjectRevision === "number") {
      hostRevision = response.hostProjectRevision;
    }
    if (mutation && response.outcome === "APPLIED") appliedMutationCount += 1;
    traces.push(traceEntry(actionType, response, hostRevision));
  };

  const dispatchV11 = async (
    actionType: LiveAeRecipeTraceEntryV1["actionType"],
    command: AeAdapterCommandV11,
    payload: Readonly<Record<string, unknown>>,
    mutation = true,
  ): Promise<AeAdapterResponseV11> => {
    const request = v11Request(
      command,
      payload,
      mutation ? hostRevision : null,
      transactionId,
      operationId(command),
      requestIdFactory(),
    );
    const response = await transport.dispatch(request);
    accept(actionType, response, mutation);
    return response;
  };

  const readTimeRemap = async (
    action: Extract<LiveAeRecipeActionV1, { type: "TIME_REMAP_PULSE" }>,
  ): Promise<AeTimeRemapResponseV27> => {
    const request = buildTimeRemapRequestV27({
      requestId: requestIdFactory(),
      transactionId,
      operationId: operationId("layer.time_remap.readback"),
      command: "layer.time_remap.readback",
      payload: {
        comp: { stableId: action.compStableId },
        layer: { stableId: action.layerStableId },
      },
    });    const response = await transport.dispatch(request);
    accept(action.type, response, false);
    remaps.set(action.layerStableId, timeRemapBaseline(response));
    return response;
  };

  const applyCurve = async (
    action: Extract<LiveAeRecipeActionV1, { type: "TIME_REMAP_PULSE" }>,
    keyIndex: number,
    curve: ReturnType<typeof materializeTimeRemapPulseV1>["curve"][number],
  ): Promise<void> => {
    const interpolation = buildTemporalInterpolationRequestV17({
      requestId: requestIdFactory(),
      transactionId,
      operationId: operationId("property.temporal_interpolation.set"),
      command: "property.temporal_interpolation.set",
      expectedHostProjectRevision: hostRevision,
      payload: {
        comp: { stableId: action.compStableId },
        layer: { stableId: action.layerStableId },
        propertyPath: ["ADBE Time Remapping"],
        keyIndex,
        interpolation: curve.interpolation,
      },
    });
    const interpolationResponse = await transport.dispatch(interpolation);
    accept(action.type, interpolationResponse, true);

    const ease = buildTemporalEaseRequestV18({
      requestId: requestIdFactory(),
      transactionId,
      operationId: operationId("property.temporal_ease.set"),
      command: "property.temporal_ease.set",
      expectedHostProjectRevision: hostRevision,
      payload: {
        comp: { stableId: action.compStableId },
        layer: { stableId: action.layerStableId },
        propertyPath: ["ADBE Time Remapping"],
        keyIndex,
        ease: curve.ease,
      },
    });    const easeResponse = await transport.dispatch(ease);
    accept(action.type, easeResponse, true);
  };

  const runAction = async (action: LiveAeRecipeActionV1): Promise<void> => {
    if (action.type === "PRECOMPOSE") {
      const response = await dispatchV11(action.type, "layers.precompose", {
        comp: { stableId: action.compStableId },
        layers: action.sourceLayerStableIds.map((stableId) => ({ stableId })),
        stableId: action.childCompStableId,
        replacementStableId: action.replacementLayerStableId,
        name: action.name,
        moveAllAttributes: true,
      });
      const transform = transformFromReadback(response.readback);
      if (transform !== null) transforms.set(action.replacementLayerStableId, transform);
      return;
    }

    if (action.type === "TIME_REMAP_ENABLE") {
      const request = buildTimeRemapRequestV27({
        requestId: requestIdFactory(),
        transactionId,
        operationId: operationId("layer.time_remap.enable"),
        command: "layer.time_remap.enable",
        expectedHostProjectRevision: hostRevision,
        payload: {
          comp: { stableId: action.compStableId },
          layer: { stableId: action.layerStableId },
        },
      });
      const response = await transport.dispatch(request);
      accept(action.type, response, true);
      remaps.set(action.layerStableId, timeRemapBaseline(response));
      return;
    }

    if (action.type === "TIME_REMAP_PULSE") {
      let baseline = remaps.get(action.layerStableId);
      if (baseline === undefined) {
        await readTimeRemap(action);
        baseline = remaps.get(action.layerStableId);
      }      if (baseline === undefined) throw new Error("TIME_REMAP_BASELINE_UNRESOLVED");
      const materialized = materializeTimeRemapPulseV1(action, baseline);
      await dispatchV11(action.type, "property.set_keyframes", {
        comp: { stableId: action.compStableId },
        layer: { stableId: action.layerStableId },
        propertyPath: [...materialized.propertyPath],
        keyframes: materialized.keyframes.map((keyframe) => ({
          time: keyframe.time,
          value: keyframe.value,
        })),
      });
      const readback = await readTimeRemap(action);
      for (const curve of materialized.curve) {
        await applyCurve(action, keyIndexAtTime(readback, curve.keyTimeSeconds), curve);
      }
      return;
    }

    let transform = transforms.get(action.layerStableId);
    if (transform === undefined) {
      const readback = await dispatchV11(action.type, "readback.object", {
        kind: "LAYER",
        comp: { stableId: action.compStableId },
        target: { stableId: action.layerStableId },
      }, false);
      transform = transformFromReadback(readback.readback) ?? undefined;
    }
    if (transform === undefined) {
      throw new Error("CAMERA_PUSH_TRANSFORM_BASELINE_UNRESOLVED");
    }
    const materialized = materializeCameraPushV1(action, transform);
    await dispatchV11(action.type, "property.set_keyframes", {
      comp: { stableId: action.compStableId },
      layer: { stableId: action.layerStableId },
      propertyPath: [...materialized.scalePropertyPath],
      keyframes: materialized.scaleKeyframes.map((keyframe) => ({
        time: keyframe.time,
        value: [...keyframe.value],
      })),
    });    await dispatchV11(action.type, "property.set_keyframes", {
      comp: { stableId: action.compStableId },
      layer: { stableId: action.layerStableId },
      propertyPath: [...materialized.positionPropertyPath],
      keyframes: materialized.positionKeyframes.map((keyframe) => ({
        time: keyframe.time,
        value: [...keyframe.value],
      })),
    });
  };

  const rollback = async (): Promise<boolean> => {
    const count = appliedMutationCount;
    for (let index = 0; index < count; index += 1) {
      try {
        const response = await transport.dispatch(v11Request(
          "transaction.undo_last",
          {},
          hostRevision,
          transactionId,
          operationId("transaction.undo_last"),
          requestIdFactory(),
        ));
        assertSuccess(response);
        if (typeof response.hostProjectRevision === "number") {
          hostRevision = response.hostProjectRevision;
        }
        traces.push(traceEntry("ROLLBACK", response, hostRevision));
      } catch {
        return false;
      }
    }
    return true;
  };

  try {
    for (const action of plan.actions) await runAction(action);
  } catch (error) {
    const rollbackComplete = await rollback();
    throw new LiveAeRecipeExecutionError(
      "Live AE recipe execution failed"
        + (rollbackComplete ? " and was rolled back." : " and rollback was incomplete."),
      error,
      rollbackComplete,
      traces,
    );
  }

  return {
    status: "PASS",
    transactionId,
    finalHostRevision: hostRevision,
    appliedMutationCount,
    traces,
  };
};
