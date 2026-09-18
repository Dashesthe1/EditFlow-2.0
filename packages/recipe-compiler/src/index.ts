import {
  validateEditingIrRecipeV1,
  type EditingIrNodeV1,
  type EditingIrRecipeV1,
} from "../../editing-ir/src/index.js";
import type {
  VirtualAeLayerV1,
  VirtualAeOperationV1,
  VirtualAeProjectV1,
} from "../../virtual-ae/src/index.js";

export const RECIPE_COMPILER_PHASE = "M5_TUTORIAL_VIRTUAL_AE_FOUNDATION" as const;

export interface RecipeRoleBindingV1 {
  readonly role: string;
  readonly layerIds: readonly string[];
}
export interface RecipeCompilerContextV1 {
  readonly compId: string;
  readonly eventTimesMs: Readonly<Record<string, number>>;
  readonly roleBindings: readonly RecipeRoleBindingV1[];
  readonly parameterValues: Readonly<Record<string, unknown>>;
}
export interface RecipeCompileIssueV1 {
  readonly nodeId: string;
  readonly code: string;
  readonly message: string;
}
export class RecipeCompileError extends Error {
  readonly issues: readonly RecipeCompileIssueV1[];

  constructor(issues: readonly RecipeCompileIssueV1[]) {
    super(issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n"));
    this.name = "RecipeCompileError";
    this.issues = issues;
  }
}

export interface CompiledVirtualAeRecipeV1 {
  readonly schema: "editflow.recipe-compiler.virtual-ae.v1";
  readonly recipeId: string;
  readonly compId: string;
  readonly operations: readonly VirtualAeOperationV1[];
  readonly nodeTargetLayerIds: Readonly<Record<string, readonly string[]>>;
  readonly skippedOptionalNodeIds: readonly string[];
}

interface LayerWindowV1 {
  readonly inMs: number;
  readonly outMs: number;
}

interface TimingWindowV1 {
  readonly startMs: number;
  readonly peakMs: number;
  readonly endMs: number;
}
export const recipeParameterKeyV1 = (nodeId: string, parameterName: string): string =>
  nodeId + "." + parameterName;

const uniqueStrings = (values: readonly string[]): readonly string[] =>
  [...new Set(values)];

const addIssue = (
  issues: RecipeCompileIssueV1[],
  nodeId: string,
  code: string,
  message: string,
): null => {
  issues.push({ nodeId, code, message });
  return null;
};

const resolveParameter = (
  node: EditingIrNodeV1,
  parameterName: string,
  context: RecipeCompilerContextV1,
  issues: RecipeCompileIssueV1[],
): unknown | null => {
  const definition = node.parameters.find((item) => item.name === parameterName);
  if (!definition) {
    return addIssue(issues, node.nodeId, "UNKNOWN_PARAMETER",
      `Node '${node.nodeId}' has no parameter '${parameterName}'.`);
  }
  const key = recipeParameterKeyV1(node.nodeId, parameterName);
  const value = context.parameterValues[key] ?? definition.value;
  if (value === undefined) {
    return addIssue(issues, node.nodeId, "UNRESOLVED_PARAMETER",
      `Parameter '${key}' requires an adapted value before compilation.`);
  }
  if (typeof value === "number" && definition.normalizedRange) {
    const { min, max } = definition.normalizedRange;
    if (!Number.isFinite(value) || value < min || value > max) {
      return addIssue(issues, node.nodeId, "PARAMETER_OUT_OF_RANGE",
        `Parameter '${key}' must stay within [${min}, ${max}].`);
    }
  }
  return structuredClone(value);
};

const resolveNumberParameter = (
  node: EditingIrNodeV1,
  parameterName: string,
  context: RecipeCompilerContextV1,
  issues: RecipeCompileIssueV1[],
): number | null => {
  const value = resolveParameter(node, parameterName, context, issues);
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return addIssue(issues, node.nodeId, "PARAMETER_NOT_NUMERIC",
      `Parameter '${recipeParameterKeyV1(node.nodeId, parameterName)}' must be numeric.`);
  }
  return value;
};
const resolveTargets = (
  node: EditingIrNodeV1,
  roleBindings: ReadonlyMap<string, readonly string[]>,
  nodeOutputs: ReadonlyMap<string, readonly string[]>,
  issues: RecipeCompileIssueV1[],
): readonly string[] => {
  if (node.target) {
    const targets: string[] = [];
    for (const role of node.target.roles) {
      const layerIds = roleBindings.get(role);
      if (!layerIds || layerIds.length === 0) {
        addIssue(issues, node.nodeId, "ROLE_UNBOUND",
          `Semantic role '${role}' has no layer binding.`);
        continue;
      }
      targets.push(...layerIds);
    }
    return uniqueStrings(targets);
  }
  const inherited = uniqueStrings(
    node.dependsOn.flatMap((dependency) => nodeOutputs.get(dependency) ?? []),
  );
  if (inherited.length === 0) {
    addIssue(issues, node.nodeId, "TARGET_UNRESOLVED",
      `Node '${node.nodeId}' has no explicit target and no dependency output to inherit.`);
  }
  return inherited;
};
const resolveTimingWindow = (
  node: EditingIrNodeV1,
  layer: LayerWindowV1,
  context: RecipeCompilerContextV1,
  issues: RecipeCompileIssueV1[],
): TimingWindowV1 | null => {
  const timing = node.timing;
  if (!timing || timing.anchor !== "EVENT" || !timing.eventRef) {
    return addIssue(issues, node.nodeId, "TIMING_UNSUPPORTED",
      `Node '${node.nodeId}' requires EVENT timing for this compiler route.`);
  }
  const eventMs = context.eventTimesMs[timing.eventRef];
  if (typeof eventMs !== "number" || !Number.isFinite(eventMs)) {
    return addIssue(issues, node.nodeId, "EVENT_UNRESOLVED",
      `Event '${timing.eventRef}' has no finite time binding.`);
  }
  let durationMs = timing.durationMs;
  if (timing.durationParameter) {
    const ratio = resolveNumberParameter(node, timing.durationParameter, context, issues);
    if (ratio === null) return null;
    durationMs = (layer.outMs - layer.inMs) * ratio;
  }
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) {
    return addIssue(issues, node.nodeId, "DURATION_UNRESOLVED",
      `Node '${node.nodeId}' has no executable positive duration.`);
  }
  let peakPhase = 0.5;
  if (timing.peakPhaseParameter) {
    const resolved = resolveNumberParameter(
      node,
      timing.peakPhaseParameter,
      context,
      issues,
    );
    if (resolved === null) return null;
    peakPhase = resolved;
  }
  if (peakPhase < 0 || peakPhase > 1) {
    return addIssue(issues, node.nodeId, "PEAK_PHASE_OUT_OF_RANGE",
      `Node '${node.nodeId}' peak phase must stay within [0, 1].`);
  }
  const peakMs = eventMs + (timing.offsetMs ?? 0);
  const startMs = peakMs - durationMs * peakPhase;
  const endMs = startMs + durationMs;
  if (startMs < layer.inMs || endMs > layer.outMs) {
    return addIssue(issues, node.nodeId, "TIMING_WINDOW_OUT_OF_BOUNDS",
      `Node '${node.nodeId}' window [${startMs}, ${endMs}] exceeds target layer [${layer.inMs}, ${layer.outMs}].`);
  }
  return { startMs, peakMs, endMs };
};

const semanticValue = (
  node: EditingIrNodeV1,
  kind: string,
  phase: string,
  parameters: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => ({
  kind,
  nodeId: node.nodeId,
  phase,
  parameters: structuredClone(parameters),
});

const layerWindow = (
  layerId: string,
  windows: ReadonlyMap<string, LayerWindowV1>,
  node: EditingIrNodeV1,
  issues: RecipeCompileIssueV1[],
): LayerWindowV1 | null => {
  const found = windows.get(layerId);
  if (!found) {
    return addIssue(issues, node.nodeId, "LAYER_UNRESOLVED",
      `Target layer '${layerId}' is not present in the selected composition.`);
  }
  return found;
};

const precomposeIds = (
  nodeId: string,
  sourceLayerIds: readonly string[],
  ordinal: number,
): { compId: string; layerId: string; name: string } => {
  const scope = sourceLayerIds.join("+");
  return {
    compId: nodeId + "::" + ordinal + "::" + scope + "::comp",
    layerId: nodeId + "::" + ordinal + "::" + scope + "::layer",
    name: nodeId + " " + (ordinal + 1),
  };
};
const collectRoleBindings = (
  bindings: readonly RecipeRoleBindingV1[],
  issues: RecipeCompileIssueV1[],
): ReadonlyMap<string, readonly string[]> => {
  const map = new Map<string, readonly string[]>();
  for (const binding of bindings) {
    if (binding.role.trim().length === 0 || binding.layerIds.length === 0) {
      addIssue(issues, "recipe", "INVALID_ROLE_BINDING",
        "Role bindings require a non-empty role and at least one target layer.");
      continue;
    }
    if (map.has(binding.role)) {
      addIssue(issues, "recipe", "DUPLICATE_ROLE_BINDING",
        `Semantic role '${binding.role}' is bound more than once.`);
      continue;
    }
    map.set(binding.role, uniqueStrings(binding.layerIds));
  }
  return map;
};

const appendPulseKeyframes = (
  operations: VirtualAeOperationV1[],
  node: EditingIrNodeV1,
  compId: string,
  layerId: string,
  propertyPath: string,
  window: TimingWindowV1,
  kind: string,
  parameters: Readonly<Record<string, unknown>>,
): void => {
  operations.push(
    {
      type: "ADD_KEYFRAME",
      compId,
      layerId,
      propertyPath,
      timeMs: window.startMs,
      value: semanticValue(node, kind, "BASELINE_IN", parameters),
    },
    {
      type: "ADD_KEYFRAME",
      compId,
      layerId,
      propertyPath,
      timeMs: window.peakMs,
      value: semanticValue(node, kind, "PEAK", parameters),
    },
    {
      type: "ADD_KEYFRAME",
      compId,
      layerId,
      propertyPath,
      timeMs: window.endMs,
      value: semanticValue(node, kind, "BASELINE_OUT", parameters),
    },
  );
};

const compilePrecompose = (
  node: EditingIrNodeV1,
  targets: readonly string[],
  context: RecipeCompilerContextV1,
  windows: Map<string, LayerWindowV1>,
  operations: VirtualAeOperationV1[],
  issues: RecipeCompileIssueV1[],
): readonly string[] => {
  const groups = node.target?.mode === "GROUP"
    ? [targets]
    : targets.map((target) => [target]);
  const outputs: string[] = [];
  for (const [ordinal, sourceLayerIds] of groups.entries()) {
    const sourceWindows = sourceLayerIds.map((layerId) =>
      layerWindow(layerId, windows, node, issues));
    if (sourceWindows.some((value) => value === null)) continue;
    const typedWindows = sourceWindows as LayerWindowV1[];
    const ids = precomposeIds(node.nodeId, sourceLayerIds, ordinal);
    operations.push({
      type: "PRECOMPOSE",
      compId: context.compId,
      newCompId: ids.compId,
      newCompName: ids.name,
      newLayerId: ids.layerId,
      layerIds: [...sourceLayerIds],
    });
    const nextWindow = {
      inMs: Math.min(...typedWindows.map((value) => value.inMs)),
      outMs: Math.max(...typedWindows.map((value) => value.outMs)),
    };
    windows.set(ids.layerId, nextWindow);
    outputs.push(ids.layerId);
  }
  return outputs;
};

const resolveParameterMap = (
  node: EditingIrNodeV1,
  names: readonly string[],
  context: RecipeCompilerContextV1,
  issues: RecipeCompileIssueV1[],
): Readonly<Record<string, unknown>> | null => {
  const values: Record<string, unknown> = {};
  for (const name of names) {
    const value = resolveParameter(node, name, context, issues);
    if (value === null) return null;
    values[name] = value;
  }
  return values;
};

const compileTimeRemap = (
  node: EditingIrNodeV1,
  targets: readonly string[],
  context: RecipeCompilerContextV1,
  windows: Map<string, LayerWindowV1>,
  operations: VirtualAeOperationV1[],
  issues: RecipeCompileIssueV1[],
): readonly string[] => {
  const outputs: string[] = [];
  for (const layerId of targets) {
    const layer = layerWindow(layerId, windows, node, issues);
    if (layer === null) continue;

    if (node.timing === undefined) {
      const parameterNames = node.parameters
        .filter((parameter) => parameter.value !== undefined)
        .map((parameter) => parameter.name);
      const parameters = resolveParameterMap(node, parameterNames, context, issues);
      if (parameters === null) continue;
      operations.push({
        type: "SET_PROPERTY",
        compId: context.compId,
        layerId,
        propertyPath: "TimeRemap.Enabled",
        value: semanticValue(node, "TIME_REMAP", "ACTIVATED", parameters),
      });
      outputs.push(layerId);
      continue;
    }

    const window = resolveTimingWindow(node, layer, context, issues);
    if (window === null) continue;
    const parameters = resolveParameterMap(
      node,
      node.parameters.map((parameter) => parameter.name),
      context,
      issues,
    );
    if (parameters === null) continue;

    appendPulseKeyframes(
      operations,
      node,
      context.compId,
      layerId,
      "TimeRemap.SourceTime",
      window,
      "TIME_REMAP",
      parameters,
    );
    operations.push(
      {
        type: "SET_PROPERTY",
        compId: context.compId,
        layerId,
        propertyPath: "TimeRemap.Interpolation",
        value: semanticValue(node, "TIME_REMAP", "BEZIER", parameters),
      },
      {
        type: "SET_PROPERTY",
        compId: context.compId,
        layerId,
        propertyPath: "TimeRemap.TemporalEase",
        value: semanticValue(node, "TIME_REMAP", "ADAPTED_EASE", parameters),
      },
    );
    outputs.push(layerId);
  }
  return uniqueStrings(outputs);
};

const compileCameraPush = (
  node: EditingIrNodeV1,
  targets: readonly string[],
  context: RecipeCompilerContextV1,
  windows: Map<string, LayerWindowV1>,
  operations: VirtualAeOperationV1[],
  issues: RecipeCompileIssueV1[],
): readonly string[] => {
  const outputs: string[] = [];
  for (const layerId of targets) {
    const layer = layerWindow(layerId, windows, node, issues);
    if (layer === null) continue;
    const window = resolveTimingWindow(node, layer, context, issues);
    if (window === null) continue;
    const parameters = resolveParameterMap(
      node,
      node.parameters.map((parameter) => parameter.name),
      context,
      issues,
    );
    if (parameters === null) continue;

    appendPulseKeyframes(
      operations,
      node,
      context.compId,
      layerId,
      "Transform.CameraPush.Scale",
      window,
      "CAMERA_PUSH",
      parameters,
    );
    appendPulseKeyframes(
      operations,
      node,
      context.compId,
      layerId,
      "Transform.CameraPush.Center",
      window,
      "CAMERA_PUSH",
      parameters,
    );
    operations.push({
      type: "SET_PROPERTY",
      compId: context.compId,
      layerId,
      propertyPath: "Transform.CameraPush.Policy",
      value: semanticValue(node, "CAMERA_PUSH", "ADAPTED", parameters),
    });
    outputs.push(layerId);
  }
  return uniqueStrings(outputs);
};

const layerWindowsForComp = (
  layers: readonly VirtualAeLayerV1[],
): Map<string, LayerWindowV1> =>
  new Map(layers.map((layer) => [
    layer.layerId,
    { inMs: layer.inMs, outMs: layer.outMs },
  ]));

export const compileEditingIrRecipeToVirtualAeV1 = (
  recipe: EditingIrRecipeV1,
  project: VirtualAeProjectV1,
  context: RecipeCompilerContextV1,
): CompiledVirtualAeRecipeV1 => {
  const validation = validateEditingIrRecipeV1(recipe);
  const issues: RecipeCompileIssueV1[] = validation.errors.map((message) => ({
    nodeId: "recipe",
    code: "INVALID_EDITING_IR",
    message,
  }));
  const comp = project.compositions.find((candidate) => candidate.compId === context.compId);
  if (comp === undefined) {
    issues.push({
      nodeId: "recipe",
      code: "COMP_UNRESOLVED",
      message: `Composition '${context.compId}' is not present in the Virtual AE project.`,
    });
  }
  if (issues.length > 0 || comp === undefined) throw new RecipeCompileError(issues);

  const roleBindings = collectRoleBindings(context.roleBindings, issues);
  const windows = layerWindowsForComp(comp.layers);
  const operations: VirtualAeOperationV1[] = [];
  const nodeOutputs = new Map<string, readonly string[]>();
  const nodeTargetLayerIds: Record<string, readonly string[]> = {};
  const skippedOptionalNodeIds: string[] = [];
  const nodeById = new Map(recipe.nodes.map((node) => [node.nodeId, node] as const));

  for (const nodeId of validation.orderedNodeIds) {
    const node = nodeById.get(nodeId);
    if (node === undefined) continue;
    const targets = resolveTargets(node, roleBindings, nodeOutputs, issues);
    nodeTargetLayerIds[node.nodeId] = [...targets];

    let outputs: readonly string[];
    if (node.kind === "PRECOMPOSE") {
      outputs = compilePrecompose(node, targets, context, windows, operations, issues);
    } else if (node.kind === "TIME_REMAP") {
      outputs = compileTimeRemap(node, targets, context, windows, operations, issues);
    } else if (node.kind === "CAMERA_PUSH") {
      outputs = compileCameraPush(node, targets, context, windows, operations, issues);
    } else if (node.optional === true) {
      skippedOptionalNodeIds.push(node.nodeId);
      outputs = targets;
    } else {
      addIssue(
        issues,
        node.nodeId,
        "UNSUPPORTED_NODE_KIND",
        `Recipe compiler does not yet support required primitive '${node.kind}'.`,
      );
      outputs = [];
    }
    nodeOutputs.set(node.nodeId, outputs);
  }

  for (const outputNodeId of recipe.outputs) {
    if ((nodeOutputs.get(outputNodeId) ?? []).length === 0) {
      addIssue(
        issues,
        outputNodeId,
        "OUTPUT_UNRESOLVED",
        `Recipe output node '${outputNodeId}' produced no target layers.`,
      );
    }
  }
  if (issues.length > 0) throw new RecipeCompileError(issues);

  return {
    schema: "editflow.recipe-compiler.virtual-ae.v1",
    recipeId: recipe.recipeId,
    compId: context.compId,
    operations,
    nodeTargetLayerIds,
    skippedOptionalNodeIds,
  };
};

export {
  NATIVE_AE_RECIPE_LOWERING_PHASE,
  NativeAeRecipeLoweringError,
  lowerCompiledRecipeToNativeAePlanV1,
} from "./native-ae-lowering.js";
export type {
  NativeAeCurveBindingModeV1,
  NativeAeCurveBindingV1,
  NativeAeEaseHandleIntentV1,
  NativeAeKeyEaseIntentV1,
  NativeAeKeyEaseV1,
  NativeAeRecipeLoweringInputV1,
  NativeAeResolvedKeyframeV1,
  NativeAeSemanticCurvePathV1,
} from "./native-ae-lowering.js";
