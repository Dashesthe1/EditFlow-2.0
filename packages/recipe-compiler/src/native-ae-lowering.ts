import {
  asCapabilityId,
  asOperationId,
  asPlanId,
  asRollbackBoundaryId,
  asRouteId,
  type ExecutionPlan,
  type ExecutionPlanBinding,
  type ExecutionPlanOperation,
  type ObservedProjectState,
} from "../../core-contracts/src/index.js";
import type { VirtualAeOperationV1 } from "../../virtual-ae/src/index.js";
import { AE_ADAPTER_ROUTE_ID_V11 } from "../../adapters/ae-cep/src/protocol-v1_1.js";
import { AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17 } from "../../adapters/ae-cep/src/protocol-v1_7.js";
import { AE_TEMPORAL_EASE_ROUTE_ID_V18 } from "../../adapters/ae-cep/src/protocol-v1_8.js";
import { AE_MARKER_MOTION_ROUTE_ID_V20 } from "../../adapters/ae-cep/src/protocol-v2_0.js";
import { AE_TIME_REMAP_ROUTE_ID_V27 } from "../../adapters/ae-cep/src/protocol-v2_7.js";
import {
  NATIVE_AE_LIVE_CURVE_INTENT_SCHEMA_V1,
  type NativeAeLiveCurveIntentV1,
} from "../../adapters/ae-cep/src/native-curve-materialization.js";
import type { CompiledVirtualAeRecipeV1 } from "./index.js";

export const NATIVE_AE_RECIPE_LOWERING_PHASE = "M5_RECIPE_NATIVE_AE_LOWERING_V1" as const;

export type NativeAeSemanticCurvePathV1 =
  | "TimeRemap.SourceTime"
  | "Transform.CameraPush.Scale"
  | "Transform.CameraPush.Center";

export interface NativeAeResolvedKeyframeV1 {
  readonly timeMs: number;
  readonly value: unknown;
}
export interface NativeAeKeyEaseV1 {
  readonly keyIndex: number;
  readonly inEase: readonly { readonly speed: number; readonly influence: number }[];
  readonly outEase: readonly { readonly speed: number; readonly influence: number }[];
}

export interface NativeAeEaseHandleIntentV1 {
  readonly speed: number;
  readonly influence: number;
}

export interface NativeAeKeyEaseIntentV1 {
  readonly keyIndex: number;
  readonly inEase: NativeAeEaseHandleIntentV1;
  readonly outEase: NativeAeEaseHandleIntentV1;
}

export interface NativeAeCurveBindingV1 {
  readonly layerId: string;
  readonly semanticPropertyPath: NativeAeSemanticCurvePathV1;
  readonly keyframes: readonly NativeAeResolvedKeyframeV1[];
  readonly easeByKey?: readonly NativeAeKeyEaseV1[];
  readonly easeIntentByKey?: readonly NativeAeKeyEaseIntentV1[];
}

export type NativeAeCurveBindingModeV1 = "EXACT" | "LIVE_ADAPTIVE";

export interface NativeAeRecipeLoweringInputV1 {
  readonly planId: string;
  readonly planRevision?: number;
  readonly observedState: ObservedProjectState;
  readonly curveBindings?: readonly NativeAeCurveBindingV1[];
  readonly curveBindingMode?: NativeAeCurveBindingModeV1;
  readonly bindings?: readonly ExecutionPlanBinding[];
  readonly creativeObjective?: string;
  readonly recipeRefs?: readonly string[];
}

export class NativeAeRecipeLoweringError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "NativeAeRecipeLoweringError";
    this.code = code;
  }
}

const nativePropertyPath = (
  semanticPath: NativeAeSemanticCurvePathV1,
): readonly (string | number)[] => {
  switch (semanticPath) {
    case "TimeRemap.SourceTime":
      return ["ADBE Time Remapping"];
    case "Transform.CameraPush.Scale":
      return ["ADBE Transform Group", "ADBE Scale"];
    case "Transform.CameraPush.Center":
      return ["ADBE Transform Group", "ADBE Position"];
  }
};

const curveKey = (layerId: string, propertyPath: string): string =>
  `${layerId}\u0000${propertyPath}`;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const finiteVector = (value: unknown, positive = false): value is readonly number[] =>
  Array.isArray(value)
  && (value.length === 2 || value.length === 3)
  && value.every((entry) => finite(entry) && (!positive || entry > 0));

const validateResolvedValue = (
  semanticPath: NativeAeSemanticCurvePathV1,
  value: unknown,
): void => {
  if (semanticPath === "TimeRemap.SourceTime") {
    if (!finite(value) || value < 0) {
      throw new NativeAeRecipeLoweringError(
        "INVALID_NATIVE_VALUE",
        "TimeRemap.SourceTime requires a finite non-negative source-time value in seconds.",
      );
    }
    return;
  }
  if (semanticPath === "Transform.CameraPush.Scale") {
    if (!finiteVector(value, true)) {
      throw new NativeAeRecipeLoweringError(
        "INVALID_NATIVE_VALUE",
        "Transform.CameraPush.Scale requires a positive 2D/3D native scale vector.",
      );
    }
    return;
  }
  if (!finiteVector(value)) {
    throw new NativeAeRecipeLoweringError(
      "INVALID_NATIVE_VALUE",
      "Transform.CameraPush.Center requires a finite 2D/3D native position vector.",
    );
  }
};

const validateEaseHandle = (
  value: NativeAeEaseHandleIntentV1,
  label: string,
): void => {
  if (
    !finite(value.speed)
    || !finite(value.influence)
    || value.influence < 0.1
    || value.influence > 100
  ) {
    throw new NativeAeRecipeLoweringError(
      "INVALID_NATIVE_EASE",
      `${label} ease requires finite speed and influence from 0.1 through 100.`,
    );
  }
};

const validateEaseKeyIndex = (keyIndex: number): void => {
  if (!Number.isInteger(keyIndex) || keyIndex < 1) {
    throw new NativeAeRecipeLoweringError(
      "INVALID_NATIVE_EASE",
      "Ease keyIndex must be a positive integer.",
    );
  }
};

const validateEase = (ease: NativeAeKeyEaseV1): void => {
  validateEaseKeyIndex(ease.keyIndex);
  const validateSide = (
    values: readonly NativeAeEaseHandleIntentV1[],
    label: string,
  ): void => {
    if (values.length < 1 || values.length > 3) {
      throw new NativeAeRecipeLoweringError(
        "INVALID_NATIVE_EASE",
        `${label} ease cardinality must be 1-3.`,
      );
    }
    for (const entry of values) validateEaseHandle(entry, label);
  };
  validateSide(ease.inEase, "Incoming");
  validateSide(ease.outEase, "Outgoing");
  if (ease.inEase.length !== ease.outEase.length) {
    throw new NativeAeRecipeLoweringError(
      "INVALID_NATIVE_EASE",
      "Incoming and outgoing ease cardinality must match.",
    );
  }
};

const validateEaseIntent = (ease: NativeAeKeyEaseIntentV1): void => {
  validateEaseKeyIndex(ease.keyIndex);
  validateEaseHandle(ease.inEase, "Incoming intent");
  validateEaseHandle(ease.outEase, "Outgoing intent");
};

const isSupportedSemanticPath = (value: string): value is NativeAeSemanticCurvePathV1 =>
  value === "TimeRemap.SourceTime"
  || value === "Transform.CameraPush.Scale"
  || value === "Transform.CameraPush.Center";

const semanticCurves = (
  operations: readonly VirtualAeOperationV1[],
): Map<string, Extract<VirtualAeOperationV1, { readonly type: "ADD_KEYFRAME" }>[]> => {
  const result = new Map<string, Extract<VirtualAeOperationV1, { readonly type: "ADD_KEYFRAME" }>[]>();
  for (const operation of operations) {
    if (operation.type !== "ADD_KEYFRAME") continue;
    if (!isSupportedSemanticPath(operation.propertyPath)) {
      throw new NativeAeRecipeLoweringError(
        "UNSUPPORTED_SEMANTIC_CURVE",
        `Native AE lowering does not support semantic keyframe path '${operation.propertyPath}'.`,
      );
    }
    const key = curveKey(operation.layerId, operation.propertyPath);
    const existing = result.get(key) ?? [];
    existing.push(operation);
    result.set(key, existing);
  }
  return result;
};

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;

const liveCurveIntent = (
  semanticPath: NativeAeSemanticCurvePathV1,
  semantic: readonly Extract<VirtualAeOperationV1, { readonly type: "ADD_KEYFRAME" }>[],
): NativeAeLiveCurveIntentV1 => {
  if (semantic.length !== 3) {
    throw new NativeAeRecipeLoweringError(
      "LIVE_ADAPTIVE_CURVE_SHAPE_UNSUPPORTED",
      "Live-adaptive V1 requires exactly three semantic keyframes per curve.",
    );
  }
  const times = semantic.map((operation) => operation.timeMs / 1000);
  if (!(times[0]! < times[1]! && times[1]! < times[2]!)) {
    throw new NativeAeRecipeLoweringError(
      "LIVE_ADAPTIVE_TIME_ORDER_INVALID",
      "Live-adaptive curve times must be strictly increasing.",
    );
  }
  const value = asRecord(semantic[0]!.value);
  const parameters = asRecord(value?.["parameters"]);
  if (parameters === null) {
    throw new NativeAeRecipeLoweringError(
      "LIVE_ADAPTIVE_PARAMETERS_REQUIRED",
      `Semantic curve '${semanticPath}' is missing adapted parameters.`,
    );
  }
  const keyTimesSeconds = [times[0]!, times[1]!, times[2]!] as const;

  if (semanticPath === "TimeRemap.SourceTime") {
    const velocityContrast = parameters["velocityContrast"];
    if (!finite(velocityContrast)) {
      throw new NativeAeRecipeLoweringError(
        "LIVE_ADAPTIVE_PARAMETERS_REQUIRED",
        "Time Remap live adaptation requires finite velocityContrast.",
      );
    }
    return {
      schema: NATIVE_AE_LIVE_CURVE_INTENT_SCHEMA_V1,
      kind: "TIME_REMAP_PULSE",
      keyTimesSeconds,
      velocityContrast,
    };
  }

  const zoomIntensity = parameters["zoomIntensity"];
  const zoomCenter = parameters["zoomCenter"];
  if (
    !finite(zoomIntensity)
    || !Array.isArray(zoomCenter)
    || zoomCenter.length !== 2
    || zoomCenter.some((item) => !finite(item))
  ) {
    throw new NativeAeRecipeLoweringError(
      "LIVE_ADAPTIVE_PARAMETERS_REQUIRED",
      "Camera-push live adaptation requires finite zoomIntensity and zoomCenter.",
    );
  }
  return {
    schema: NATIVE_AE_LIVE_CURVE_INTENT_SCHEMA_V1,
    kind: "CAMERA_PUSH",
    component: semanticPath === "Transform.CameraPush.Scale" ? "SCALE" : "POSITION",
    keyTimesSeconds,
    zoomIntensity,
    zoomCenter: [zoomCenter[0] as number, zoomCenter[1] as number],
  };
};

const resolvedBindings = (
  bindings: readonly NativeAeCurveBindingV1[],
): Map<string, NativeAeCurveBindingV1> => {
  const result = new Map<string, NativeAeCurveBindingV1>();
  for (const binding of bindings) {
    const key = curveKey(binding.layerId, binding.semanticPropertyPath);
    if (result.has(key)) {
      throw new NativeAeRecipeLoweringError(
        "DUPLICATE_NATIVE_BINDING",
        `Duplicate native curve binding for '${binding.layerId}' / '${binding.semanticPropertyPath}'.`,
      );
    }
    let previousTimeMs = -Infinity;
    for (const keyframe of binding.keyframes) {
      if (!finite(keyframe.timeMs) || keyframe.timeMs < 0) {
        throw new NativeAeRecipeLoweringError("INVALID_NATIVE_TIME", "Native keyframe timeMs must be finite and non-negative.");
      }
      if (keyframe.timeMs <= previousTimeMs) {
        throw new NativeAeRecipeLoweringError(
          "INVALID_NATIVE_TIME_ORDER",
          "Native keyframe times must be strictly increasing.",
        );
      }
      previousTimeMs = keyframe.timeMs;
      validateResolvedValue(binding.semanticPropertyPath, keyframe.value);
    }
    const easeKeyIndices = new Set<number>();
    const registerEaseKey = (keyIndex: number): void => {
      if (keyIndex > binding.keyframes.length) {
        throw new NativeAeRecipeLoweringError(
          "INVALID_NATIVE_EASE",
          "Ease keyIndex cannot exceed the native keyframe count.",
        );
      }
      if (easeKeyIndices.has(keyIndex)) {
        throw new NativeAeRecipeLoweringError(
          "DUPLICATE_NATIVE_EASE",
          `Duplicate native ease binding for key ${keyIndex}.`,
        );
      }
      easeKeyIndices.add(keyIndex);
    };
    for (const ease of binding.easeByKey ?? []) {
      validateEase(ease);
      registerEaseKey(ease.keyIndex);
    }
    for (const ease of binding.easeIntentByKey ?? []) {
      validateEaseIntent(ease);
      registerEaseKey(ease.keyIndex);
    }
    result.set(key, binding);
  }
  return result;
};

const requireBinding = (
  layerId: string,
  propertyPath: NativeAeSemanticCurvePathV1,
  curves: Map<string, Extract<VirtualAeOperationV1, { readonly type: "ADD_KEYFRAME" }>[]>,
  bindings: Map<string, NativeAeCurveBindingV1>,
): NativeAeCurveBindingV1 => {
  const key = curveKey(layerId, propertyPath);
  const semantic = curves.get(key);
  if (semantic === undefined) {
    throw new NativeAeRecipeLoweringError("SEMANTIC_CURVE_MISSING", `Semantic curve '${propertyPath}' is missing for '${layerId}'.`);
  }
  const binding = bindings.get(key);
  if (binding === undefined) {
    throw new NativeAeRecipeLoweringError(
      "NATIVE_BINDING_REQUIRED",
      `Adapted native curve binding required for '${layerId}' / '${propertyPath}'.`,
    );
  }
  if (binding.keyframes.length !== semantic.length) {
    throw new NativeAeRecipeLoweringError(
      "NATIVE_BINDING_STALE",
      `Native binding key count no longer matches semantic curve '${layerId}' / '${propertyPath}'.`,
    );
  }
  for (let index = 0; index < semantic.length; index += 1) {
    if (binding.keyframes[index]?.timeMs !== semantic[index]?.timeMs) {
      throw new NativeAeRecipeLoweringError(
        "NATIVE_BINDING_STALE",
        `Native binding time no longer matches semantic curve '${layerId}' / '${propertyPath}'.`,
      );
    }
  }
  return binding;
};

type NativeAeEaseBindingV1 =
  | { readonly mode: "EXACT"; readonly ease: NativeAeKeyEaseV1 }
  | { readonly mode: "LIVE_CARDINALITY"; readonly ease: NativeAeKeyEaseIntentV1 };

const easeForKey = (
  binding: NativeAeCurveBindingV1,
  keyIndex: number,
): NativeAeEaseBindingV1 => {
  const exact = binding.easeByKey?.find(
    (candidate) => candidate.keyIndex === keyIndex,
  );
  if (exact !== undefined) return { mode: "EXACT", ease: exact };

  const intent = binding.easeIntentByKey?.find(
    (candidate) => candidate.keyIndex === keyIndex,
  );
  if (intent !== undefined) return { mode: "LIVE_CARDINALITY", ease: intent };

  throw new NativeAeRecipeLoweringError(
    "NATIVE_EASE_REQUIRED",
    `Adapted native ease required for '${binding.layerId}' / '${binding.semanticPropertyPath}' key ${keyIndex}.`,
  );
};

const hasSetProperty = (
  operations: readonly VirtualAeOperationV1[],
  layerId: string,
  propertyPath: string,
): boolean => operations.some((operation) =>
  operation.type === "SET_PROPERTY"
  && operation.layerId === layerId
  && operation.propertyPath === propertyPath);

const nativeTransformField = (propertyPath: string): string | null => {
  if (propertyPath === "Transform.Position") return "position";
  if (propertyPath === "Transform.Scale") return "scale";
  if (propertyPath === "Transform.AnchorPoint") return "anchorPoint";
  if (propertyPath === "Transform.Rotation") return "rotation";
  if (propertyPath === "Transform.Opacity") return "opacity";
  return null;
};

const validateStaticTransformValue = (propertyPath: string, value: unknown): void => {
  if (propertyPath === "Transform.Position" || propertyPath === "Transform.AnchorPoint") {
    if (!finiteVector(value)) {
      throw new NativeAeRecipeLoweringError("INVALID_STATIC_TRANSFORM",
        `${propertyPath} requires a finite 2D/3D vector.`);
    }
    return;
  }
  if (propertyPath === "Transform.Scale") {
    if (!finiteVector(value)) {
      throw new NativeAeRecipeLoweringError("INVALID_STATIC_TRANSFORM",
        "Transform.Scale requires a finite 2D/3D percentage vector.");
    }
    return;
  }
  if (!finite(value)) {
    throw new NativeAeRecipeLoweringError("INVALID_STATIC_TRANSFORM",
      `${propertyPath} requires a finite number.`);
  }
  if (propertyPath === "Transform.Opacity" && (value < 0 || value > 100)) {
    throw new NativeAeRecipeLoweringError("INVALID_STATIC_TRANSFORM",
      "Transform.Opacity must stay within [0, 100].");
  }
};

const layerOrder = (operations: readonly VirtualAeOperationV1[]): readonly string[] => {
  const ordered: string[] = [];
  for (const operation of operations) {
    if (operation.type !== "ADD_KEYFRAME" && operation.type !== "SET_PROPERTY") continue;
    if (!ordered.includes(operation.layerId)) ordered.push(operation.layerId);
  }
  return ordered;
};

export const lowerCompiledRecipeToNativeAePlanV1 = (
  compiled: CompiledVirtualAeRecipeV1,
  input: NativeAeRecipeLoweringInputV1,
): ExecutionPlan => {
  const curves = semanticCurves(compiled.operations);
  const bindingMode = input.curveBindingMode ?? "EXACT";
  const bindings = resolvedBindings(input.curveBindings ?? []);
  if (bindingMode === "LIVE_ADAPTIVE" && bindings.size > 0) {
    throw new NativeAeRecipeLoweringError(
      "LIVE_ADAPTIVE_BINDING_CONFLICT",
      "LIVE_ADAPTIVE lowering cannot also receive exact curveBindings.",
    );
  }

  for (const key of bindings.keys()) {
    if (!curves.has(key)) {
      throw new NativeAeRecipeLoweringError(
        "STALE_NATIVE_BINDING",
        "Native curve binding does not correspond to a current semantic recipe curve.",
      );
    }
  }

  const rollbackBoundaryId = asRollbackBoundaryId(`${compiled.recipeId}:native-ae-v1`);
  const operations: ExecutionPlanOperation[] = [];
  let previousOperationId: ReturnType<typeof asOperationId> | null = null;
  let operationCounter = 0;

  const emit = (
    capabilityId: string,
    routeId: string,
    command: string,
    payload: Readonly<Record<string, unknown>>,
    riskClass: ExecutionPlanOperation["riskClass"],
  ): void => {
    const operationId = asOperationId(
      `${compiled.recipeId}:native:${String(++operationCounter).padStart(3, "0")}:${command}`,
    );
    operations.push({
      operationId,
      capabilityId: asCapabilityId(capabilityId),
      routeId: asRouteId(routeId),
      dependsOn: previousOperationId === null ? [] : [previousOperationId],
      idempotency: "CHECK_THEN_APPLY",
      riskClass,
      input: { command, payload, readbackProfile: NATIVE_AE_RECIPE_LOWERING_PHASE },
      rollbackBoundaryId,
    });
    previousOperationId = operationId;
  };

  for (const operation of compiled.operations) {
    if (operation.type !== "PRECOMPOSE") continue;
    emit(
      "ae.precompose.layers",
      AE_ADAPTER_ROUTE_ID_V11,
      "layers.precompose",
      {
        comp: { stableId: operation.compId },
        layers: operation.layerIds.map((stableId) => ({ stableId })),
        stableId: operation.newCompId,
        replacementStableId: operation.newLayerId,
        name: operation.newCompName,
        moveAllAttributes: true,
        preserveSingleLayerTiming: operation.layerIds.length === 1,
        sourceHandlePolicy: operation.sourceHandlePolicy ?? "PRESERVE_TRIM",
      },
      "R2_STRUCTURAL",
    );
  }

  for (const operation of compiled.operations) {
    if (operation.type === "SET_PROPERTY") {
      const transformField = nativeTransformField(operation.propertyPath);
      if (transformField !== null) {
        validateStaticTransformValue(operation.propertyPath, operation.value);
        emit(
          "ae.layer.transform.set",
          AE_ADAPTER_ROUTE_ID_V11,
          "layer.set_transform",
          {
            comp: { stableId: operation.compId },
            layer: { stableId: operation.layerId },
            values: { [transformField]: structuredClone(operation.value) },
          },
          "R1_REVERSIBLE",
        );
      }
      continue;
    }
    if (operation.type === "SET_COMP_MOTION") {
      emit(
        "ae.comp.motion.set",
        AE_MARKER_MOTION_ROUTE_ID_V20,
        "comp.motion.set",
        {
          comp: { stableId: operation.compId },
          state: structuredClone(operation.state),
        },
        "R1_REVERSIBLE",
      );
      continue;
    }
    if (operation.type === "SET_LAYER_MOTION") {
      emit(
        "ae.layer.motion.set",
        AE_MARKER_MOTION_ROUTE_ID_V20,
        "layer.motion.set",
        {
          comp: { stableId: operation.compId },
          layer: { stableId: operation.layerId },
          state: structuredClone(operation.state),
        },
        "R1_REVERSIBLE",
      );
    }
  }

  type EmittedCurve = Readonly<{
    keyCount: number;
    exactBinding: NativeAeCurveBindingV1 | null;
  }>;

  const emitCurve = (
    layerId: string,
    semanticPath: NativeAeSemanticCurvePathV1,
  ): EmittedCurve => {
    const semantic = curves.get(curveKey(layerId, semanticPath));
    if (semantic === undefined) {
      throw new NativeAeRecipeLoweringError(
        "SEMANTIC_CURVE_MISSING",
        `Semantic curve '${semanticPath}' is missing for '${layerId}'.`,
      );
    }
    const exactBinding = bindingMode === "EXACT"
      ? requireBinding(layerId, semanticPath, curves, bindings)
      : null;
    const curvePayload = exactBinding === null
      ? { liveCurveIntent: liveCurveIntent(semanticPath, semantic) }
      : {
          keyframes: exactBinding.keyframes.map((keyframe) => ({
            time: keyframe.timeMs / 1000,
            value: structuredClone(keyframe.value),
          })),
        };
    emit(
      "ae.keyframe.set",
      AE_ADAPTER_ROUTE_ID_V11,
      "property.set_keyframes",
      {
        comp: { stableId: compiled.compId },
        layer: { stableId: layerId },
        propertyPath: nativePropertyPath(semanticPath),
        ...curvePayload,
      },
      "R1_REVERSIBLE",
    );
    return { keyCount: semantic.length, exactBinding };
  };

  const emitBezierAndEase = (
    layerId: string,
    semanticPath: NativeAeSemanticCurvePathV1,
    curve: EmittedCurve,
  ): void => {
    const propertyPath = nativePropertyPath(semanticPath);
    for (let keyIndex = 1; keyIndex <= curve.keyCount; keyIndex += 1) {
      emit(
        "ae.property.temporal_interpolation.set",
        AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17,
        "property.temporal_interpolation.set",
        {
          comp: { stableId: compiled.compId },
          layer: { stableId: layerId },
          propertyPath,
          keyIndex,
          interpolation: {
            inType: "BEZIER",
            outType: "BEZIER",
            temporalContinuous: false,
            temporalAutoBezier: false,
          },
        },
        "R1_REVERSIBLE",
      );
      const easePayload = curve.exactBinding === null
        ? { liveCurveEaseIntent: { keyIndex } }
        : (() => {
            const easeBinding = easeForKey(curve.exactBinding, keyIndex);
            return easeBinding.mode === "EXACT"
              ? {
                  ease: {
                    inEase: structuredClone(easeBinding.ease.inEase),
                    outEase: structuredClone(easeBinding.ease.outEase),
                  },
                }
              : {
                  easeIntent: {
                    inEase: structuredClone(easeBinding.ease.inEase),
                    outEase: structuredClone(easeBinding.ease.outEase),
                  },
                };
          })();
      emit(
        "ae.property.temporal_ease.set",
        AE_TEMPORAL_EASE_ROUTE_ID_V18,
        "property.temporal_ease.set",
        {
          comp: { stableId: compiled.compId },
          layer: { stableId: layerId },
          propertyPath,
          keyIndex,
          ...easePayload,
        },
        "R1_REVERSIBLE",
      );
    }
  };

  const planCreatedPrecompLayers = new Set(
    compiled.operations
      .filter((operation) => operation.type === "PRECOMPOSE")
      .map((operation) => operation.newLayerId),
  );

  for (const layerId of layerOrder(compiled.operations)) {
    const enablesTimeRemap = hasSetProperty(
      compiled.operations,
      layerId,
      "TimeRemap.Enabled",
    );
    if (enablesTimeRemap) {
      emit(
        "ae.layer.time_remap.enable",
        AE_TIME_REMAP_ROUTE_ID_V27,
        "layer.time_remap.enable",
        {
          comp: { stableId: compiled.compId },
          layer: { stableId: layerId },
        },
        "R1_REVERSIBLE",
      );
    }

    if (curves.has(curveKey(layerId, "TimeRemap.SourceTime"))) {
      if (!enablesTimeRemap || !planCreatedPrecompLayers.has(layerId)) {
        throw new NativeAeRecipeLoweringError(
          "UNSAFE_TIME_REMAP_KEY_RESET",
          `Native Time Remap curve lowering for '${layerId}' requires a newly precomposed layer enabled in the same plan before default boundary keys can be reset safely.`,
        );
      }
      // AE creates two default Time Remap boundary keys when the property is enabled.
      // Keep those keys present while inserting the semantic curve; removing every
      // default key first can cause AE to hide the property and reject setValuesAtTimes().
      const curve = emitCurve(layerId, "TimeRemap.SourceTime");
      emit(
        "ae.keyframe.set",
        AE_ADAPTER_ROUTE_ID_V11,
        "property.set_keyframes",
        {
          comp: { stableId: compiled.compId },
          layer: { stableId: layerId },
          propertyPath: ["ADBE Time Remapping"],
          removeKeyIndices: [curve.keyCount + 2, 1],
        },
        "R1_REVERSIBLE",
      );
      if (hasSetProperty(compiled.operations, layerId, "TimeRemap.Interpolation")
        || hasSetProperty(compiled.operations, layerId, "TimeRemap.TemporalEase")) {
        emitBezierAndEase(layerId, "TimeRemap.SourceTime", curve);
      }
    }

    const cameraScaleKey = curveKey(layerId, "Transform.CameraPush.Scale");
    const cameraCenterKey = curveKey(layerId, "Transform.CameraPush.Center");
    const hasCameraPolicy = hasSetProperty(
      compiled.operations,
      layerId,
      "Transform.CameraPush.Policy",
    );
    let scaleCurve: EmittedCurve | null = null;
    let centerCurve: EmittedCurve | null = null;
    if (curves.has(cameraScaleKey)) scaleCurve = emitCurve(layerId, "Transform.CameraPush.Scale");
    if (curves.has(cameraCenterKey)) centerCurve = emitCurve(layerId, "Transform.CameraPush.Center");
    if (hasCameraPolicy) {
      if (scaleCurve === null || centerCurve === null) {
        throw new NativeAeRecipeLoweringError(
          "CAMERA_PUSH_CURVE_INCOMPLETE",
          `Camera push policy for '${layerId}' requires both Scale and Center curves.`,
        );
      }
      emitBezierAndEase(layerId, "Transform.CameraPush.Scale", scaleCurve);
      emitBezierAndEase(layerId, "Transform.CameraPush.Center", centerCurve);
    }
  }

  const supportedSetPaths = new Set([
    "TimeRemap.Enabled",
    "TimeRemap.Interpolation",
    "TimeRemap.TemporalEase",
    "Transform.CameraPush.Policy",
    "Transform.Position",
    "Transform.Scale",
    "Transform.AnchorPoint",
    "Transform.Rotation",
    "Transform.Opacity",
  ]);
  for (const operation of compiled.operations) {
    if (operation.type === "PRECOMPOSE" || operation.type === "ADD_KEYFRAME"
      || operation.type === "SET_COMP_MOTION" || operation.type === "SET_LAYER_MOTION") continue;
    if (operation.type === "SET_PROPERTY" && supportedSetPaths.has(operation.propertyPath)) continue;
    throw new NativeAeRecipeLoweringError(
      "UNSUPPORTED_NATIVE_OPERATION",
      `Native AE lowering does not yet support Virtual AE operation '${operation.type}'.`,
    );
  }

  const requiredCapabilities = [...new Set(
    operations.map((operation) => String(operation.capabilityId)),
  )].map(asCapabilityId);

  return {
    planId: asPlanId(input.planId),
    planRevision: input.planRevision ?? 1,
    projectRevision: input.observedState.projectRevision,
    projectFingerprint: input.observedState.projectFingerprint,
    environmentFingerprint: input.observedState.environmentFingerprint,
    creativeObjective: input.creativeObjective
      ?? `Execute native AE construction for recipe '${compiled.recipeId}'.`,
    recipeRefs: [compiled.recipeId, ...(input.recipeRefs ?? [])],
    requiredCapabilities,
    bindings: structuredClone(input.bindings ?? []),
    operations,
    checkpoints: previousOperationId === null
      ? []
      : [{
          checkpointId: `${compiled.recipeId}:native-structural`,
          afterOperationIds: [previousOperationId],
          kind: "STRUCTURAL",
          profile: NATIVE_AE_RECIPE_LOWERING_PHASE,
        }],
    invariants: {
      structural: [{
        kind: "NATIVE_AE_RECIPE_LOWERED",
        recipeId: compiled.recipeId,
        operationCount: operations.length,
      }],
      visual: [],
    },
    rollbackBoundaries: [{
      id: rollbackBoundaryId,
      strategy: "RESTORE_SNAPSHOT",
      notes: "Undo all applied recipe operations back to the transaction-group boundary.",
    }],
    planHash: null,
  };
};
