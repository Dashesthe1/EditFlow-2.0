import type { VirtualAeOperationV1, VirtualAeProjectV1 } from "../../virtual-ae/src/index.js";
import type { CompiledVirtualAeRecipeV1 } from "./index.js";

export const LIVE_AE_RECIPE_SCHEMA_V1 = "editflow.recipe-compiler.live-ae.v1" as const;

export type LiveAeRecipeActionV1 =
  | Readonly<{
      type: "PRECOMPOSE";
      nodeId: string;
      compStableId: string;
      sourceLayerStableIds: readonly string[];
      childCompStableId: string;
      replacementLayerStableId: string;
      name: string;
    }>
  | Readonly<{
      type: "TIME_REMAP_ENABLE";
      nodeId: string;
      compStableId: string;
      layerStableId: string;
    }>
  | Readonly<{
      type: "TIME_REMAP_PULSE";
      nodeId: string;
      compStableId: string;
      layerStableId: string;
      keyTimesSeconds: readonly [number, number, number];
      velocityContrast: number;
      temporalPeakPhase: number;
    }>
  | Readonly<{
      type: "CAMERA_PUSH";
      nodeId: string;
      compStableId: string;
      layerStableId: string;
      keyTimesSeconds: readonly [number, number, number];
      zoomIntensity: number;
      zoomCenter: readonly [number, number];
      compWidth: number;
      compHeight: number;
    }>;

export interface CompiledLiveAeRecipeV1 {
  readonly schema: typeof LIVE_AE_RECIPE_SCHEMA_V1;
  readonly recipeId: string;
  readonly compStableId: string;
  readonly actions: readonly LiveAeRecipeActionV1[];
  readonly skippedOptionalNodeIds: readonly string[];
}

export interface RecipeLiveCompileIssueV1 {
  readonly operationIndex: number;
  readonly code: string;
  readonly message: string;
}

export class RecipeLiveCompileError extends Error {
  readonly issues: readonly RecipeLiveCompileIssueV1[];

  constructor(issues: readonly RecipeLiveCompileIssueV1[]) {
    super(issues.map((issue) => issue.code + ": " + issue.message).join("\n"));
    this.name = "RecipeLiveCompileError";
    this.issues = issues;
  }
}

interface SemanticValueV1 {
  readonly nodeId: string;
  readonly phase: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;

const semanticValue = (
  value: unknown,
  operationIndex: number,
  issues: RecipeLiveCompileIssueV1[],
): SemanticValueV1 | null => {
  const record = asRecord(value);
  const parameters = asRecord(record?.["parameters"]);
  const nodeId = record?.["nodeId"];
  const phase = record?.["phase"];
  if (typeof nodeId !== "string" || typeof phase !== "string" || parameters === null) {
    issues.push({
      operationIndex,
      code: "SEMANTIC_VALUE_REQUIRED",
      message: "Live AE lowering requires semantic recipe values with nodeId, phase, and parameters.",
    });
    return null;
  }
  return { nodeId, phase, parameters };
};
const finiteNumber = (
  value: unknown,
  field: string,
  operationIndex: number,
  issues: RecipeLiveCompileIssueV1[],
): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push({
      operationIndex,
      code: "ADAPTED_NUMBER_REQUIRED",
      message: field + " must be a finite adapted number.",
    });
    return null;
  }
  return value;
};

const keyGroup = (
  operations: readonly VirtualAeOperationV1[],
  layerId: string,
  propertyPath: string,
  nodeId: string,
): readonly Extract<VirtualAeOperationV1, { type: "ADD_KEYFRAME" }>[] =>
  operations.filter((operation): operation is Extract<VirtualAeOperationV1, { type: "ADD_KEYFRAME" }> => {
    if (operation.type !== "ADD_KEYFRAME"
      || operation.layerId !== layerId
      || operation.propertyPath !== propertyPath) return false;
    const value = asRecord(operation.value);
    return value?.["nodeId"] === nodeId;
  }).sort((left, right) => left.timeMs - right.timeMs);

const threeTimesSeconds = (
  keyframes: readonly Extract<VirtualAeOperationV1, { type: "ADD_KEYFRAME" }>[],
  operationIndex: number,
  issues: RecipeLiveCompileIssueV1[],
): readonly [number, number, number] | null => {
  if (keyframes.length !== 3) {
    issues.push({
      operationIndex,
      code: "THREE_KEY_PULSE_REQUIRED",
      message: "Live pulse lowering requires exactly three ordered semantic keyframes.",
    });
    return null;
  }
  const values = keyframes.map((keyframe) => keyframe.timeMs / 1000);
  if (!(values[0]! < values[1]! && values[1]! < values[2]!)) {
    issues.push({
      operationIndex,
      code: "KEY_TIME_ORDER_INVALID",
      message: "Live pulse key times must be strictly increasing.",
    });
    return null;
  }
  return [values[0]!, values[1]!, values[2]!];
};

const nodeIdForPrecompose = (
  compiled: CompiledVirtualAeRecipeV1,
  operation: Extract<VirtualAeOperationV1, { type: "PRECOMPOSE" }>,
): string | null => {
  for (const [nodeId, layerIds] of Object.entries(compiled.nodeTargetLayerIds)) {
    if (layerIds.some((layerId) => operation.layerIds.includes(layerId))) return nodeId;
  }
  return null;
};

const normalizedCenter = (
  value: unknown,
  operationIndex: number,
  issues: RecipeLiveCompileIssueV1[],
): readonly [number, number] | null => {
  if (!Array.isArray(value) || value.length !== 2
    || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    issues.push({
      operationIndex,
      code: "ZOOM_CENTER_REQUIRED",
      message: "zoomCenter must be a finite normalized [x, y] pair.",
    });
    return null;
  }
  const x = Number(value[0]);
  const y = Number(value[1]);
  if (x < 0 || x > 1 || y < 0 || y > 1) {
    issues.push({
      operationIndex,
      code: "ZOOM_CENTER_OUT_OF_RANGE",
      message: "zoomCenter must stay inside normalized composition bounds.",
    });
    return null;
  }
  return [x, y];
};

export const compileVirtualAeRecipeToLiveAeV1 = (
  compiled: CompiledVirtualAeRecipeV1,
  project: VirtualAeProjectV1,
): CompiledLiveAeRecipeV1 => {
  const issues: RecipeLiveCompileIssueV1[] = [];
  const comp = project.compositions.find((candidate) => candidate.compId === compiled.compId);
  if (comp === undefined) {
    throw new RecipeLiveCompileError([{
      operationIndex: -1,
      code: "COMP_UNRESOLVED",
      message: "Compiled recipe composition is absent from the supplied project.",
    }]);
  }

  const actions: LiveAeRecipeActionV1[] = [];
  const emitted = new Set<string>();

  for (const [operationIndex, operation] of compiled.operations.entries()) {
    if (operation.type === "PRECOMPOSE") {
      const nodeId = nodeIdForPrecompose(compiled, operation);
      if (nodeId === null) {
        issues.push({
          operationIndex,
          code: "PRECOMPOSE_NODE_UNRESOLVED",
          message: "Could not associate precompose output with an Editing IR node.",
        });
        continue;
      }
      actions.push({
        type: "PRECOMPOSE",
        nodeId,
        compStableId: operation.compId,
        sourceLayerStableIds: [...operation.layerIds],
        childCompStableId: operation.newCompId,
        replacementLayerStableId: operation.newLayerId,
        name: operation.newCompName,
      });
      continue;
    }

    if (operation.type === "SET_PROPERTY" && operation.propertyPath === "TimeRemap.Enabled") {
      const semantic = semanticValue(operation.value, operationIndex, issues);
      if (semantic === null) continue;
      actions.push({
        type: "TIME_REMAP_ENABLE",
        nodeId: semantic.nodeId,
        compStableId: operation.compId,
        layerStableId: operation.layerId,
      });
      continue;
    }

    if (operation.type === "ADD_KEYFRAME" && operation.propertyPath === "TimeRemap.SourceTime") {
      const semantic = semanticValue(operation.value, operationIndex, issues);
      if (semantic === null) continue;
      const dedupe = "retime:" + semantic.nodeId + ":" + operation.layerId;
      if (emitted.has(dedupe)) continue;
      emitted.add(dedupe);
      const keys = keyGroup(compiled.operations, operation.layerId, operation.propertyPath, semantic.nodeId);
      const times = threeTimesSeconds(keys, operationIndex, issues);
      const contrast = finiteNumber(
        semantic.parameters["velocityContrast"],
        "velocityContrast",
        operationIndex,
        issues,
      );
      const peakPhase = finiteNumber(
        semantic.parameters["temporalPeakPhase"],
        "temporalPeakPhase",
        operationIndex,
        issues,
      );
      if (times === null || contrast === null || peakPhase === null) continue;
      if (contrast < 0 || contrast >= 1 || peakPhase <= 0 || peakPhase >= 1) {
        issues.push({
          operationIndex,
          code: "TIME_REMAP_PARAMETER_OUT_OF_RANGE",
          message: "velocityContrast must be [0,1) and temporalPeakPhase must be inside (0,1).",
        });
        continue;
      }
      actions.push({
        type: "TIME_REMAP_PULSE",
        nodeId: semantic.nodeId,
        compStableId: operation.compId,
        layerStableId: operation.layerId,
        keyTimesSeconds: times,
        velocityContrast: contrast,
        temporalPeakPhase: peakPhase,
      });
      continue;
    }

    if (operation.type === "ADD_KEYFRAME" && operation.propertyPath === "Transform.CameraPush.Scale") {
      const semantic = semanticValue(operation.value, operationIndex, issues);
      if (semantic === null) continue;
      const dedupe = "push:" + semantic.nodeId + ":" + operation.layerId;
      if (emitted.has(dedupe)) continue;
      emitted.add(dedupe);
      const keys = keyGroup(compiled.operations, operation.layerId, operation.propertyPath, semantic.nodeId);
      const times = threeTimesSeconds(keys, operationIndex, issues);
      const intensity = finiteNumber(
        semantic.parameters["zoomIntensity"],
        "zoomIntensity",
        operationIndex,
        issues,
      );
      const center = normalizedCenter(
        semantic.parameters["zoomCenter"],
        operationIndex,
        issues,
      );
      if (times === null || intensity === null || center === null) continue;
      if (intensity < 0 || intensity >= 1) {
        issues.push({
          operationIndex,
          code: "ZOOM_INTENSITY_OUT_OF_RANGE",
          message: "zoomIntensity must stay inside [0,1).",
        });
        continue;
      }
      actions.push({
        type: "CAMERA_PUSH",
        nodeId: semantic.nodeId,
        compStableId: operation.compId,
        layerStableId: operation.layerId,
        keyTimesSeconds: times,
        zoomIntensity: intensity,
        zoomCenter: center,
        compWidth: comp.width,
        compHeight: comp.height,
      });
      continue;
    }

    const absorbed = operation.type === "SET_PROPERTY"
      && (operation.propertyPath === "TimeRemap.Interpolation"
        || operation.propertyPath === "TimeRemap.TemporalEase"
        || operation.propertyPath === "Transform.CameraPush.Policy");
    const cameraCenter = operation.type === "ADD_KEYFRAME"
      && operation.propertyPath === "Transform.CameraPush.Center";
    if (absorbed || cameraCenter) continue;

    issues.push({
      operationIndex,
      code: "LIVE_OPERATION_UNSUPPORTED",
      message: "No safe live-AE lowering exists for virtual operation "
        + operation.type + ".",
    });
  }

  if (issues.length > 0) throw new RecipeLiveCompileError(issues);
  return {
    schema: LIVE_AE_RECIPE_SCHEMA_V1,
    recipeId: compiled.recipeId,
    compStableId: compiled.compId,
    actions,
    skippedOptionalNodeIds: [...compiled.skippedOptionalNodeIds],
  };
};

export interface LiveAeTimeRemapBaselineV1 {
  readonly timeRemapEnabled: boolean;
  readonly propertyAvailable: boolean;
  readonly keys: readonly Readonly<{
    index: number;
    time: number;
    value: number;
  }>[];
}

export interface LiveAeConcreteKeyframeV1<T = unknown> {
  readonly time: number;
  readonly value: T;
}

export interface LiveAeTemporalCurveKeyV1 {
  readonly keyTimeSeconds: number;
  readonly interpolation: Readonly<{
    inType: "BEZIER";
    outType: "BEZIER";
    temporalContinuous: true;
    temporalAutoBezier: false;
  }>;
  readonly ease: Readonly<{
    inEase: readonly Readonly<{ speed: number; influence: number }>[];
    outEase: readonly Readonly<{ speed: number; influence: number }>[];
  }>;
}
export interface MaterializedTimeRemapPulseV1 {
  readonly propertyPath: readonly ["ADBE Time Remapping"];
  readonly keyframes: readonly LiveAeConcreteKeyframeV1<number>[];
  readonly curve: readonly LiveAeTemporalCurveKeyV1[];
}

export interface LiveAeTransformBaselineV1 {
  readonly anchorPoint: readonly number[];
  readonly position: readonly number[];
  readonly scale: readonly number[];
}

export interface MaterializedCameraPushV1 {
  readonly scalePropertyPath: readonly ["ADBE Transform Group", "ADBE Scale"];
  readonly positionPropertyPath: readonly ["ADBE Transform Group", "ADBE Position"];
  readonly scaleKeyframes: readonly LiveAeConcreteKeyframeV1<readonly number[]>[];
  readonly positionKeyframes: readonly LiveAeConcreteKeyframeV1<readonly number[]>[];
}

const materializeError = (code: string, message: string): never => {
  throw new RecipeLiveCompileError([{
    operationIndex: -1,
    code,
    message,
  }]);
};

const linearValueAt = (
  first: Readonly<{ time: number; value: number }>,
  last: Readonly<{ time: number; value: number }>,
  time: number,
): number => {  const duration = last.time - first.time;
  if (!(duration > 0)) {
    return materializeError(
      "TIME_REMAP_BASELINE_INVALID",
      "Native Time Remap baseline key times must be strictly increasing.",
    );
  }
  const phase = (time - first.time) / duration;
  return first.value + (last.value - first.value) * phase;
};

export const materializeTimeRemapPulseV1 = (
  action: Extract<LiveAeRecipeActionV1, { type: "TIME_REMAP_PULSE" }>,
  baseline: LiveAeTimeRemapBaselineV1,
): MaterializedTimeRemapPulseV1 => {
  if (!baseline.timeRemapEnabled || !baseline.propertyAvailable) {
    return materializeError(
      "TIME_REMAP_NOT_READY",
      "Native Time Remap must be enabled and readable before pulse materialization.",
    );
  }
  if (baseline.keys.length !== 2) {
    return materializeError(
      "PREAUTHORED_TIME_REMAP_REQUIRES_POLICY",
      "V1 refuses to reshape a Time Remap surface that already contains a custom key curve.",
    );
  }
  const first = baseline.keys[0]!;
  const last = baseline.keys[1]!;
  if (!(last.time > first.time) || !(last.value > first.value)) {
    return materializeError(
      "MONOTONIC_TIME_REMAP_REQUIRED",
      "V1 pulse materialization requires a forward monotonic native Time Remap baseline.",
    );
  }  const [startTime, peakTime, endTime] = action.keyTimesSeconds;
  if (startTime < first.time || endTime > last.time) {
    return materializeError(
      "TIME_REMAP_WINDOW_OUT_OF_SOURCE_RANGE",
      "The adapted pulse window exceeds the native Time Remap source range.",
    );
  }

  const startValue = linearValueAt(first, last, startTime);
  const baselinePeakValue = linearValueAt(first, last, peakTime);
  const endValue = linearValueAt(first, last, endTime);
  const leftSpan = baselinePeakValue - startValue;
  const rightSpan = endValue - baselinePeakValue;
  if (!(leftSpan > 0) || !(rightSpan > 0)) {
    return materializeError(
      "TIME_REMAP_WINDOW_DEGENERATE",
      "The adapted pulse requires positive source-time span on both sides of its peak.",
    );
  }

  const safeShift = Math.min(leftSpan, rightSpan) * 0.95;
  const requestedShift = Math.min(leftSpan, rightSpan) * action.velocityContrast;
  const peakValue = baselinePeakValue + Math.min(requestedShift, safeShift);
  if (!(startValue < peakValue && peakValue < endValue)) {
    return materializeError(
      "TIME_REMAP_MONOTONICITY_LOST",
      "The adapted velocity contrast would create a hold or reversal.",
    );
  }

  const leftSpeed = (peakValue - startValue) / (peakTime - startTime);
  const rightSpeed = (endValue - peakValue) / (endTime - peakTime);  const peakSpeed = (leftSpeed + rightSpeed) / 2;
  const tailInfluence = Math.min(55, 30 + action.velocityContrast * 20);
  const peakInfluence = Math.min(75, 45 + action.velocityContrast * 30);
  const values = [
    { time: startTime, value: startValue, speed: leftSpeed, influence: tailInfluence },
    { time: peakTime, value: peakValue, speed: peakSpeed, influence: peakInfluence },
    { time: endTime, value: endValue, speed: rightSpeed, influence: tailInfluence },
  ] as const;

  return {
    propertyPath: ["ADBE Time Remapping"],
    keyframes: values.map(({ time, value }) => ({ time, value })),
    curve: values.map(({ time, speed, influence }) => ({
      keyTimeSeconds: time,
      interpolation: {
        inType: "BEZIER",
        outType: "BEZIER",
        temporalContinuous: true,
        temporalAutoBezier: false,
      },
      ease: {
        inEase: [{ speed, influence }],
        outEase: [{ speed, influence }],
      },
    })),
  };
};

const vector = (
  value: readonly number[],
  minimumLength: number,
  field: string,
): readonly number[] => {
  if (value.length < minimumLength || value.some((item) => !Number.isFinite(item))) {
    return materializeError(
      "TRANSFORM_BASELINE_INVALID",
      field + " must contain finite transform components.",
    );
  }
  return value;
};
export const materializeCameraPushV1 = (
  action: Extract<LiveAeRecipeActionV1, { type: "CAMERA_PUSH" }>,
  baseline: LiveAeTransformBaselineV1,
): MaterializedCameraPushV1 => {
  const anchor = vector(baseline.anchorPoint, 2, "anchorPoint");
  const position = vector(baseline.position, 2, "position");
  const scale = vector(baseline.scale, 2, "scale");
  const factor = 1 + action.zoomIntensity;
  const subjectPoint = [
    action.zoomCenter[0] * action.compWidth,
    action.zoomCenter[1] * action.compHeight,
  ];
  const peakScale = scale.map((component) => component * factor);
  const peakPosition = position.map((component, index) => {
    if (index >= 2) return component;
    const baselineScaleFactor = scale[index]! / 100;
    const sourceOffset = (subjectPoint[index]! - anchor[index]!) * baselineScaleFactor;
    return component + (1 - factor) * sourceOffset;
  });

  const [startTime, peakTime, endTime] = action.keyTimesSeconds;
  return {
    scalePropertyPath: ["ADBE Transform Group", "ADBE Scale"],
    positionPropertyPath: ["ADBE Transform Group", "ADBE Position"],
    scaleKeyframes: [
      { time: startTime, value: [...scale] },
      { time: peakTime, value: peakScale },
      { time: endTime, value: [...scale] },
    ],
    positionKeyframes: [
      { time: startTime, value: [...position] },
      { time: peakTime, value: peakPosition },
      { time: endTime, value: [...position] },
    ],
  };
};
