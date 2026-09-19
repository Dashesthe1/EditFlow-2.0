import {
  validateEditingIrRecipeV1,
  type EditingIrNodeV1,
  type EditingIrPrimitiveKindV1,
  type EditingIrRecipeV1,
} from "../../editing-ir/src/index.js";
import {
  getEffectSchemaV1,
  type EffectSchemaPropertyBindingV1,
  type EffectSchemaV1,
} from "./effect-schemas.js";
import type {
  VirtualAeLayerV1,
  VirtualAeOperationV1,
  VirtualAeProjectV1,
  VirtualAeFrameBlendingModeV1,
} from "../../virtual-ae/src/index.js";

export const RECIPE_COMPILER_PHASE = "M5_TUTORIAL_VIRTUAL_AE_FOUNDATION" as const;

export const VIRTUAL_AE_SUPPORTED_PRIMITIVE_KINDS_V1 = [
  "PRECOMPOSE",
  "TIME_REMAP",
  "CAMERA_PUSH",
  "TRANSFORM_ANIMATION",
  "MOTION_BLUR",
  "EFFECT_STACK",
  "STABILIZATION",
  "LAYER_DUPLICATION",
  "TEMPORAL_DUPLICATION",
  "SUBJECT_ISOLATION",
  "OPACITY_SHAPING",
  "DIRECTIONAL_OFFSET",
  "BLUR",
  "COLOR_TREATMENT",
  "DISTORTION",
  "MATTE_RELATION",
  "MOTION_SHAPING",
] as const satisfies readonly EditingIrPrimitiveKindV1[];

export const NATIVE_AE_SUPPORTED_PRIMITIVE_KINDS_V1 = [
  "PRECOMPOSE",
  "TIME_REMAP",
  "CAMERA_PUSH",
  "TRANSFORM_ANIMATION",
  "MOTION_BLUR",
  "EFFECT_STACK",
  "STABILIZATION",
  "LAYER_DUPLICATION",
  "TEMPORAL_DUPLICATION",
  "OPACITY_SHAPING",
  "DIRECTIONAL_OFFSET",
  "MOTION_SHAPING",
] as const satisfies readonly EditingIrPrimitiveKindV1[];

const effectSchemaRefV1 = (node: EditingIrNodeV1): string | null => {
  const parameter = node.parameters.find((candidate) => candidate.name === "effectSchemaRef");
  return typeof parameter?.value === "string" && parameter.value.trim().length > 0
    ? parameter.value
    : null;
};

const effectSchemaForNodeV1 = (node: EditingIrNodeV1): EffectSchemaV1 | null => {
  const schemaRef = effectSchemaRefV1(node);
  return schemaRef === null ? null : getEffectSchemaV1(schemaRef);
};

const literalParameterValueV1 = (
  node: EditingIrNodeV1,
  name: string,
): unknown => node.parameters.find((parameter) => parameter.name === name)?.value;

export interface RecipeCompilerSupportOptionsV1 {
  readonly proofOnlyEffectSchemaRefs?: readonly string[];
}

const effectSchemaExecutableV1 = (
  node: EditingIrNodeV1,
  options: RecipeCompilerSupportOptionsV1 = {},
): boolean => {
  const schema = effectSchemaForNodeV1(node);
  if (schema === null) return false;
  if (schema.status === "CERTIFIED") return true;
  return (options.proofOnlyEffectSchemaRefs ?? []).includes(schema.schemaId);
};

const supportedNodeVariantV1 = (
  node: EditingIrNodeV1,
  target: "VIRTUAL" | "NATIVE" = "VIRTUAL",
  options: RecipeCompilerSupportOptionsV1 = {},
): boolean => {
  if (node.kind === "TRANSFORM_ANIMATION" || node.kind === "MOTION_BLUR") {
    return node.timing === undefined;
  }
  if (node.kind === "EFFECT_STACK") {
    return node.timing === undefined && effectSchemaExecutableV1(node, options);
  }
  if (node.kind === "STABILIZATION") {
    return node.timing === undefined
      && literalParameterValueV1(node, "stabilizationMode") === "POSITION_XY"
      && literalParameterValueV1(node, "analysisDirection") === "FORWARD";
  }
  if (node.kind === "DIRECTIONAL_OFFSET" && target === "NATIVE") {
    const displacement = literalParameterValueV1(node, "displacementPeak");
    const direction = literalParameterValueV1(node, "displacementDirection");
    const phase = literalParameterValueV1(node, "motionPeakPhase");
    return typeof displacement === "number"
      && Number.isFinite(displacement)
      && displacement > 0
      && Array.isArray(direction)
      && direction.length === 2
      && direction.every((entry) => typeof entry === "number" && Number.isFinite(entry))
      && Math.hypot(direction[0], direction[1]) > 1e-6
      && typeof phase === "number"
      && Number.isFinite(phase)
      && phase >= 0
      && phase <= 1;
  }
  return true;
};

const blockedKinds = (
  recipe: EditingIrRecipeV1,
  supportedKinds: readonly EditingIrPrimitiveKindV1[],
  target: "VIRTUAL" | "NATIVE",
  options: RecipeCompilerSupportOptionsV1 = {},
): readonly EditingIrPrimitiveKindV1[] => {
  const supported = new Set<EditingIrPrimitiveKindV1>(supportedKinds);
  return [...new Set(
    recipe.nodes
      .filter((node) => node.optional !== true
        && (!supported.has(node.kind) || !supportedNodeVariantV1(node, target, options)))
      .map((node) => node.kind),
  )].sort();
};

export const unsupportedVirtualAePrimitiveKindsV1 = (
  recipe: EditingIrRecipeV1,
  options: RecipeCompilerSupportOptionsV1 = {},
): readonly EditingIrPrimitiveKindV1[] => blockedKinds(
  recipe,
  VIRTUAL_AE_SUPPORTED_PRIMITIVE_KINDS_V1,
  "VIRTUAL",
  options,
);

export const unsupportedNativeAePrimitiveKindsV1 = (
  recipe: EditingIrRecipeV1,
  options: RecipeCompilerSupportOptionsV1 = {},
): readonly EditingIrPrimitiveKindV1[] => blockedKinds(
  recipe,
  NATIVE_AE_SUPPORTED_PRIMITIVE_KINDS_V1,
  "NATIVE",
  options,
);

export interface RecipeCompilerSupportReportV1 {
  readonly virtualAeBlockedPrimitiveKinds: readonly EditingIrPrimitiveKindV1[];
  readonly nativeAeBlockedPrimitiveKinds: readonly EditingIrPrimitiveKindV1[];
  readonly blockedPrimitiveKinds: readonly EditingIrPrimitiveKindV1[];
}

export const inspectRecipeCompilerSupportV1 = (
  recipe: EditingIrRecipeV1,
  options: RecipeCompilerSupportOptionsV1 = {},
): RecipeCompilerSupportReportV1 => {
  const virtualAeBlockedPrimitiveKinds = unsupportedVirtualAePrimitiveKindsV1(recipe, options);
  const nativeAeBlockedPrimitiveKinds = unsupportedNativeAePrimitiveKindsV1(recipe, options);
  return {
    virtualAeBlockedPrimitiveKinds,
    nativeAeBlockedPrimitiveKinds,
    blockedPrimitiveKinds: [...new Set([
      ...virtualAeBlockedPrimitiveKinds,
      ...nativeAeBlockedPrimitiveKinds,
    ])].sort(),
  };
};

export interface RecipeRoleBindingV1 {
  readonly role: string;
  readonly layerIds: readonly string[];
}
export interface RecipeCompilerContextV1 {
  readonly compId: string;
  readonly eventTimesMs: Readonly<Record<string, number>>;
  readonly roleBindings: readonly RecipeRoleBindingV1[];
  readonly parameterValues: Readonly<Record<string, unknown>>;
  /** Exact developer-proof allowlist. PROOF_REQUIRED effect schemas remain blocked everywhere else. */
  readonly proofOnlyEffectSchemaRefs?: readonly string[];
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
  optional: node.optional === true,
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
    const sourceHandlePolicy = node.parameters.some((parameter) =>
      parameter.derivedFrom.includes("sourceHandleAvailability"))
      ? "EXPOSE_AVAILABLE_SOURCE"
      : "PRESERVE_TRIM";
    operations.push({
      type: "PRECOMPOSE",
      compId: context.compId,
      newCompId: ids.compId,
      newCompName: ids.name,
      newLayerId: ids.layerId,
      layerIds: [...sourceLayerIds],
      sourceHandlePolicy,
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

const adaptEffectSchemaValueV1 = (
  node: EditingIrNodeV1,
  binding: EffectSchemaPropertyBindingV1,
  value: unknown,
  frameRate: number,
  issues: RecipeCompileIssueV1[],
): unknown | null => {
  const adapter = binding.valueAdapter ?? "IDENTITY";
  if (adapter === "IDENTITY") return structuredClone(value);
  if (adapter === "NEGATIVE_FRAMES_TO_SECONDS") {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0
      || !Number.isFinite(frameRate) || frameRate <= 0) {
      addIssue(
        issues,
        node.nodeId,
        "EFFECT_ADAPTATION_INVALID",
        `Effect parameter '${binding.semanticParameter}' requires positive finite frame spacing and frame rate.`,
      );
      return null;
    }
    return -(value / frameRate);
  }
  addIssue(
    issues,
    node.nodeId,
    "EFFECT_ADAPTATION_UNSUPPORTED",
    `Effect parameter '${binding.semanticParameter}' uses unsupported value adapter '${String(adapter)}'.`,
  );
  return null;
};

const compileEffectStack = (
  node: EditingIrNodeV1,
  targets: readonly string[],
  context: RecipeCompilerContextV1,
  operations: VirtualAeOperationV1[],
  issues: RecipeCompileIssueV1[],
  frameRate: number,
): readonly string[] => {
  if (node.timing !== undefined) {
    addIssue(issues, node.nodeId, "EFFECT_TIMING_UNSUPPORTED",
      "EFFECT_STACK currently supports static adapted effect state only.");
    return [];
  }
  const schema = effectSchemaForNodeV1(node);
  if (schema === null) {
    addIssue(issues, node.nodeId, "EFFECT_SCHEMA_REQUIRED",
      "EFFECT_STACK requires a known literal effectSchemaRef.");
    return [];
  }
  if (!effectSchemaExecutableV1(node, context)) {
    addIssue(issues, node.nodeId, "EFFECT_SCHEMA_PROOF_REQUIRED",
      `Effect schema '${schema.schemaId}' is not certified and is not explicitly allowlisted for this proof run.`);
    return [];
  }
  const values = new Map<string, unknown>();
  for (const binding of schema.propertyBindings) {
    const value = resolveParameter(
      node,
      binding.semanticParameter,
      context,
      issues,
    );
    if (value !== null) {
      const adapted = adaptEffectSchemaValueV1(node, binding, value, frameRate, issues);
      if (adapted !== null) values.set(binding.semanticParameter, adapted);
    }
  }
  if (values.size !== schema.propertyBindings.length) return [];

  for (const layerId of targets) {
    const effectId = `${node.nodeId}:${layerId}`;
    operations.push({
      type: "ADD_EFFECT",
      compId: context.compId,
      layerId,
      effectId,
      matchName: schema.effectMatchName,
    });
    for (const binding of schema.propertyBindings) {
      operations.push({
        type: "SET_EFFECT_PROPERTY",
        compId: context.compId,
        layerId,
        effectId,
        propertyPath: [...binding.propertyPath],
        value: structuredClone(values.get(binding.semanticParameter)),
      });
    }
  }
  return targets;
};

const compileStabilization = (
  node: EditingIrNodeV1,
  targets: readonly string[],
  context: RecipeCompilerContextV1,
  operations: VirtualAeOperationV1[],
  issues: RecipeCompileIssueV1[],
): readonly string[] => {
  if (node.timing !== undefined) {
    addIssue(issues, node.nodeId, "STABILIZATION_TIMING_UNSUPPORTED",
      "STABILIZATION currently executes across the selected shot/layer window; explicit sub-window orchestration is not yet certified.");
    return [];
  }
  const values = resolveParameterMap(
    node,
    ["stabilizationMode", "analysisDirection", "trackFeaturePolicy", "minimumTrackConfidence"],
    context,
    issues,
  );
  if (values === null) return [];

  const mode = values["stabilizationMode"];
  const direction = values["analysisDirection"];
  const trackFeaturePolicy = values["trackFeaturePolicy"];
  const minimumTrackConfidence = values["minimumTrackConfidence"];
  if (mode !== "POSITION_XY"
    || direction !== "FORWARD"
    || typeof trackFeaturePolicy !== "string"
    || trackFeaturePolicy.trim().length === 0
    || typeof minimumTrackConfidence !== "number"
    || !Number.isFinite(minimumTrackConfidence)
    || minimumTrackConfidence < 0
    || minimumTrackConfidence > 1) {
    addIssue(issues, node.nodeId, "STABILIZATION_VARIANT_UNPROVEN",
      "Only proven Forward Position X/Y stabilization with a semantic feature policy and normalized confidence is supported.");
    return [];
  }

  for (const layerId of targets) {
    operations.push({
      type: "APPLY_STABILIZATION",
      compId: context.compId,
      layerId,
      state: {
        mode,
        direction,
        trackFeaturePolicy,
        minimumTrackConfidence,
      },
    });
  }
  return targets;
};

const compileStaticTransform = (
  node: EditingIrNodeV1,
  targets: readonly string[],
  context: RecipeCompilerContextV1,
  operations: VirtualAeOperationV1[],
  issues: RecipeCompileIssueV1[],
): readonly string[] => {
  if (node.timing !== undefined) {
    addIssue(issues, node.nodeId, "TRANSFORM_TIMING_UNSUPPORTED",
      "TRANSFORM_ANIMATION currently supports adapted static transform state only.");
    return [];
  }
  const propertyMap = [
    ["position", "Transform.Position"],
    ["scale", "Transform.Scale"],
    ["anchorPoint", "Transform.AnchorPoint"],
    ["rotation", "Transform.Rotation"],
    ["opacity", "Transform.Opacity"],
  ] as const;
  const declared = propertyMap.filter(([name]) =>
    node.parameters.some((parameter) => parameter.name === name));
  if (declared.length === 0) {
    addIssue(issues, node.nodeId, "TRANSFORM_PARAMETER_REQUIRED",
      "Static transform requires at least one of position, scale, anchorPoint, rotation, or opacity.");
    return [];
  }
  const values = new Map<string, unknown>();
  for (const [name] of declared) {
    const value = resolveParameter(node, name, context, issues);
    if (value !== null) values.set(name, value);
  }
  if (values.size !== declared.length) return [];
  for (const layerId of targets) {
    for (const [name, propertyPath] of declared) {
      operations.push({
        type: "SET_PROPERTY",
        compId: context.compId,
        layerId,
        propertyPath,
        value: structuredClone(values.get(name)),
      });
    }
  }
  return targets;
};

const resolveM6EffectEventSeconds = (
  node: EditingIrNodeV1,
  context: RecipeCompilerContextV1,
  issues: RecipeCompileIssueV1[],
): number | null => {
  const explicitDefinition = node.parameters.find((parameter) => parameter.name === "effectEventRef");
  let eventRef: string | null = null;
  if (explicitDefinition !== undefined) {
    const resolved = resolveParameter(node, "effectEventRef", context, issues);
    if (resolved === null) return null;
    if (typeof resolved !== "string" || resolved.trim().length === 0) {
      return addIssue(
        issues,
        node.nodeId,
        "M6_EVENT_REF_INVALID",
        "M6 effect realization requires effectEventRef to resolve to a non-empty semantic event name.",
      );
    }
    eventRef = resolved.trim();
  } else if (typeof context.eventTimesMs["transition"] === "number"
    && Number.isFinite(context.eventTimesMs["transition"])) {
    eventRef = "transition";
  } else {
    const finiteEvents = Object.entries(context.eventTimesMs)
      .filter(([, value]) => typeof value === "number" && Number.isFinite(value));
    if (finiteEvents.length === 1) eventRef = finiteEvents[0]![0];
    else {
      return addIssue(
        issues,
        node.nodeId,
        finiteEvents.length === 0 ? "M6_EVENT_UNRESOLVED" : "M6_EVENT_REF_AMBIGUOUS",
        finiteEvents.length === 0
          ? "M6 effect realization requires a finite semantic event time."
          : "M6 effect realization has multiple semantic event times; bind effectEventRef explicitly.",
      );
    }
  }
  const eventMs = context.eventTimesMs[eventRef];
  if (typeof eventMs !== "number" || !Number.isFinite(eventMs)) {
    return addIssue(
      issues,
      node.nodeId,
      "M6_EVENT_UNRESOLVED",
      `M6 semantic event '${eventRef}' has no finite time binding.`,
    );
  }
  return eventMs / 1000;
};

const compileM6TemporalDuplication = (
  node: EditingIrNodeV1,
  targets: readonly string[],
  context: RecipeCompilerContextV1,
  operations: VirtualAeOperationV1[],
  issues: RecipeCompileIssueV1[],
  frameRate: number,
): readonly string[] => {
  const parameters = resolveParameterMap(
    node,
    node.parameters.map((parameter) => parameter.name),
    context,
    issues,
  );
  if (parameters === null) return [];
  const eventSeconds = resolveM6EffectEventSeconds(node, context, issues);
  if (eventSeconds === null) return [];
  const rawRecoveryFrames = parameters["effectRecoveryFrames"] ?? parameters["recoveryFrames"];
  const eventWindowFrames = typeof rawRecoveryFrames === "number"
    && Number.isFinite(rawRecoveryFrames) && rawRecoveryFrames > 0
    ? Math.max(2, Math.min(6, rawRecoveryFrames))
    : 3;
  const countParameter = node.parameters.find((parameter) =>
    parameter.name === "temporalStateCountPeak"
      || parameter.name === "fragmentationTemporalStateCountPeak"
      || parameter.name === "stateCount");
  const resolved = countParameter === undefined ? 2 : parameters[countParameter.name];
  if (typeof resolved !== "number" || !Number.isFinite(resolved)) {
    addIssue(issues, node.nodeId, "TEMPORAL_STATE_COUNT_INVALID",
      "M6 temporal duplication requires a finite temporal state count.");
    return [];
  }
  const count = Math.max(2, Math.min(8, Math.round(resolved)));
  const outputs: string[] = [...targets];
  for (const sourceLayerId of targets) {
    for (let state = 1; state < count; state += 1) {
      const layerId = `${node.nodeId}::${sourceLayerId}::state-${state}`;
      const sourceTimeOffsetSeconds = state / frameRate;
      operations.push({
        type: "DUPLICATE_LAYER",
        compId: context.compId,
        sourceLayerId,
        layerId,
        name: `${sourceLayerId} temporal state ${state}`,
      });
      operations.push({
        type: "SET_PROPERTY",
        compId: context.compId,
        layerId,
        propertyPath: "TimeRemap.Enabled",
        value: true,
      });
      operations.push({
        type: "SET_EXPRESSION",
        compId: context.compId,
        layerId,
        propertyPath: "TimeRemap.SourceTime",
        expression: `Math.max(0,value-${sourceTimeOffsetSeconds});`,
      });
      const statePeakOpacity = Math.max(42, 78 - (state - 1) * 11);
      operations.push({
        type: "SET_EXPRESSION",
        compId: context.compId,
        layerId,
        propertyPath: "Transform.Opacity",
        expression: [
          `var event=${eventSeconds};`,
          "var f=(time-event)*thisComp.frameRate;",
          `var pre=${eventWindowFrames};`,
          `var peak=${statePeakOpacity};`,
          "if(f<=-pre||f>=1){0}",
          "else if(f<-1){linear(f,-pre,-1,0,peak)}",
          "else if(f<0){linear(f,-1,0,peak,peak*0.4)}",
          "else{linear(f,0,1,peak*0.4,0)}",
        ].join(""),
      });
      outputs.push(layerId);
    }
  }
  return uniqueStrings(outputs);
};

interface M6PositionExpressionComponentV1 {
  readonly componentId: string;
  readonly deltaExpression: string;
  readonly standaloneExpression: string;
}

type M6PositionExpressionRegistryV1 =
  Map<string, readonly M6PositionExpressionComponentV1[]>;

const registerM6PositionExpressionV1 = (
  compId: string,
  layerId: string,
  component: M6PositionExpressionComponentV1,
  registry: M6PositionExpressionRegistryV1,
  operations: VirtualAeOperationV1[],
): void => {
  const key = `${compId}\u0000${layerId}`;
  const existing = registry.get(key) ?? [];
  const next = [...existing, component];
  registry.set(key, next);

  const priorOperationIndex = operations.findIndex((operation) =>
    operation.type === "SET_EXPRESSION"
      && operation.compId === compId
      && operation.layerId === layerId
      && operation.propertyPath === "Transform.Position");
  if (priorOperationIndex >= 0) operations.splice(priorOperationIndex, 1);

  if (next.length === 1) {
    operations.push({
      type: "SET_EXPRESSION",
      compId,
      layerId,
      propertyPath: "Transform.Position",
      expression: component.standaloneExpression,
    });
    return;
  }

  const declarations = next.map((item, index) =>
    `var d${index}=${item.deltaExpression};`);
  const xSum = next.map((_, index) => `d${index}[0]`).join("+");
  const ySum = next.map((_, index) => `d${index}[1]`).join("+");
  const expression = [
    "var base=value;",
    ...declarations,
    `var dx=${xSum};`,
    `var dy=${ySum};`,
    "base.length>2?[base[0]+dx,base[1]+dy,base[2]]:base+[dx,dy];",
  ].join("");
  operations.push({
    type: "SET_EXPRESSION",
    compId,
    layerId,
    propertyPath: "Transform.Position",
    expression,
  });
};

const compileM6SemanticVisualState = (
  node: EditingIrNodeV1,
  targets: readonly string[],
  context: RecipeCompilerContextV1,
  operations: VirtualAeOperationV1[],
  issues: RecipeCompileIssueV1[],
  positionExpressionRegistry: M6PositionExpressionRegistryV1,
): readonly string[] => {
  const parameters = resolveParameterMap(
    node,
    node.parameters.map((parameter) => parameter.name),
    context,
    issues,
  );
  if (parameters === null) return [];
  if (node.kind === "OPACITY_SHAPING") {
    const eventSeconds = resolveM6EffectEventSeconds(node, context, issues);
    if (eventSeconds === null) return [];
    const rawRecoveryFrames = parameters["effectRecoveryFrames"] ?? parameters["recoveryFrames"];
    const eventWindowFrames = typeof rawRecoveryFrames === "number"
      && Number.isFinite(rawRecoveryFrames) && rawRecoveryFrames > 0
      ? Math.max(2, Math.min(6, rawRecoveryFrames))
      : 3;
    const overlap = parameters["fragmentationOverlapDensityPeak"] ?? parameters["overlapDensityPeak"];
    const coherence = parameters["fragmentationCoherencePeak"];
    const driver = typeof coherence === "number" && Number.isFinite(coherence)
      ? coherence
      : (typeof overlap === "number" && Number.isFinite(overlap) ? overlap * 4.6 : null);
    if (driver === null) {
      addIssue(issues, node.nodeId, "M6_OPACITY_SHAPING_PARAMETERS_INVALID",
        "M6 opacity shaping requires fragmentation coherence or overlap-density evidence.");
      return [];
    }
    const peakOpacity = Math.max(35, Math.min(90, 45 + driver * 130));
    targets.forEach((layerId, index) => {
      if (targets.length > 1 && index === 0) return;
      const stateScale = Math.max(0.45, 1 - index * 0.18);
      const peak = peakOpacity * stateScale;
      operations.push({
        type: "SET_EXPRESSION",
        compId: context.compId,
        layerId,
        propertyPath: "Transform.Opacity",
        expression: [
          `var event=${eventSeconds};`,
          "var f=(time-event)*thisComp.frameRate;",
          `var peak=${peak};`,
          `var pre=${eventWindowFrames};`,
          "var shaped=0;",
          "if(f<=-pre||f>=1){shaped=0;}",
          "else if(f<-1){shaped=linear(f,-pre,-1,0,peak);}",
          "else if(f<0){shaped=linear(f,-1,0,peak,peak*0.34);}",
          "else{shaped=linear(f,0,1,peak*0.34,0);}",
          "Math.min(value,shaped);",
        ].join(""),
      });
    });
    return targets;
  }
  if (node.kind === "DIRECTIONAL_OFFSET") {
    const displacementRaw = parameters["displacementPeak"];
    const directionRaw = parameters["displacementDirection"];
    const phaseRaw = parameters["motionPeakPhase"];
    const hasMeasuredDirectionalTuple = displacementRaw !== undefined
      && directionRaw !== undefined
      && phaseRaw !== undefined;
    if (hasMeasuredDirectionalTuple) {
      const validDirection = Array.isArray(directionRaw)
        && directionRaw.length === 2
        && directionRaw.every((entry) => typeof entry === "number" && Number.isFinite(entry));
      if (typeof displacementRaw !== "number"
        || !Number.isFinite(displacementRaw)
        || displacementRaw <= 0
        || !validDirection
        || typeof phaseRaw !== "number"
        || !Number.isFinite(phaseRaw)
        || phaseRaw < 0
        || phaseRaw > 1) {
        addIssue(issues, node.nodeId, "M6_DIRECTIONAL_OFFSET_PARAMETERS_INVALID",
          "M6 directional offset requires positive displacementPeak, a finite non-zero 2D displacementDirection, and normalized motionPeakPhase evidence.");
        return [];
      }
      const directionX = directionRaw[0] as number;
      const directionY = directionRaw[1] as number;
      const directionMagnitude = Math.hypot(directionX, directionY);
      if (directionMagnitude <= 1e-6) {
        addIssue(issues, node.nodeId, "M6_DIRECTIONAL_OFFSET_PARAMETERS_INVALID",
          "M6 directional offset requires a non-zero displacementDirection vector.");
        return [];
      }
      const eventBindings = Object.entries(context.eventTimesMs).filter(([, value]) =>
        typeof value === "number" && Number.isFinite(value));
      if (eventBindings.length !== 1) {
        addIssue(issues, node.nodeId, "M6_DIRECTIONAL_OFFSET_EVENT_ANCHOR_REQUIRED",
          "Measured M6 directional motion requires exactly one finite semantic event binding so every temporal state shares the same comp-time peak.");
        return [];
      }
      const peakTimeSeconds = (eventBindings[0]![1] as number) / 1000;
      const normalizedX = directionX / directionMagnitude;
      const normalizedY = directionY / directionMagnitude;
      const expression = [
        "var span=Math.max(thisComp.frameDuration,Math.abs(outPoint-inPoint));",
        `var center=${peakTimeSeconds};`,
        "var width=Math.max(thisComp.frameDuration*2,span*0.12);",
        "var u=(time-center)/width;",
        "var envelope=Math.exp(-4*u*u);",
        `var amplitude=${displacementRaw}*Math.max(thisComp.width,thisComp.height);`,
        `var dx=${normalizedX}*amplitude*envelope;`,
        `var dy=${normalizedY}*amplitude*envelope;`,
        "value.length>2?[value[0]+dx,value[1]+dy,value[2]]:value+[dx,dy];",
      ].join("");
      const deltaExpression = [
        "(function(){",
        "var span=Math.max(thisComp.frameDuration,Math.abs(outPoint-inPoint));",
        `var center=${peakTimeSeconds};`,
        "var width=Math.max(thisComp.frameDuration*2,span*0.12);",
        "var u=(time-center)/width;",
        "var envelope=Math.exp(-4*u*u);",
        `var amplitude=${displacementRaw}*Math.max(thisComp.width,thisComp.height);`,
        `return [${normalizedX}*amplitude*envelope,${normalizedY}*amplitude*envelope];`,
        "})()",
      ].join("");
      for (const layerId of targets) {
        registerM6PositionExpressionV1(
          context.compId,
          layerId,
          {
            componentId: `${node.nodeId}:directional`,
            deltaExpression,
            standaloneExpression: expression,
          },
          positionExpressionRegistry,
          operations,
        );
      }
      return targets;
    }
  }
  if (node.kind === "MOTION_SHAPING") {
    const accelerationRaw = parameters["accelerationPeak"];
    const recoveryRaw = parameters["recoveryFrames"];
    const hasAcceleration = typeof accelerationRaw === "number" && Number.isFinite(accelerationRaw);
    const hasRecovery = typeof recoveryRaw === "number" && Number.isFinite(recoveryRaw) && recoveryRaw > 0;
    if (!hasAcceleration && !hasRecovery) {
      addIssue(issues, node.nodeId, "M6_MOTION_SHAPING_PARAMETERS_INVALID",
        "M6 motion shaping requires observed accelerationPeak or recoveryFrames evidence.");
      return [];
    }
    const eventSeconds = resolveM6EffectEventSeconds(node, context, issues);
    if (eventSeconds === null) return [];
    const acceleration = hasAcceleration ? accelerationRaw : 0.02;
    const recoveryFrames = hasRecovery
      ? recoveryRaw
      : Math.max(2, Math.min(12, Math.round(0.5 / Math.max(acceleration, 0.02))));
    const preFrames = Math.max(2, Math.min(6, recoveryFrames));
    const expression = [
      `var event=${eventSeconds};`,
      "var f=(time-event)*thisComp.frameRate;",
      `var amplitude=${acceleration}*Math.max(thisComp.width,thisComp.height)*0.5;`,
      `var pre=${preFrames};`,
      "var impulse=0;",
      "if(f<=-pre||f>=0){impulse=0;}",
      "else if(f<-1){impulse=linear(f,-pre,-1,0,-amplitude);}",
      "else{impulse=linear(f,-1,0,-amplitude,0);}",
      "value+[0,impulse];",
    ].join("");
    const deltaExpression = [
      "(function(){",
      `var event=${eventSeconds};`,
      "var f=(time-event)*thisComp.frameRate;",
      `var amplitude=${acceleration}*Math.max(thisComp.width,thisComp.height)*0.5;`,
      `var pre=${preFrames};`,
      "var impulse=0;",
      "if(f<=-pre||f>=0){impulse=0;}",
      "else if(f<-1){impulse=linear(f,-pre,-1,0,-amplitude);}",
      "else{impulse=linear(f,-1,0,-amplitude,0);}",
      "return [0,impulse];",
      "})()",
    ].join("");
    for (const layerId of targets) {
      registerM6PositionExpressionV1(
        context.compId,
        layerId,
        {
          componentId: `${node.nodeId}:motion-shaping`,
          deltaExpression,
          standaloneExpression: expression,
        },
        positionExpressionRegistry,
        operations,
      );
    }
    return targets;
  }
  for (const layerId of targets) {
    operations.push({
      type: "SET_PROPERTY",
      compId: context.compId,
      layerId,
      propertyPath: `M6.${node.kind}`,
      value: semanticValue(node, node.kind, "ADAPTED", parameters),
    });
  }
  return targets;
};

const compileMotionBlur = (
  node: EditingIrNodeV1,
  targets: readonly string[],
  context: RecipeCompilerContextV1,
  operations: VirtualAeOperationV1[],
  issues: RecipeCompileIssueV1[],
): readonly string[] => {
  if (node.timing !== undefined) {
    addIssue(issues, node.nodeId, "MOTION_TIMING_UNSUPPORTED",
      "MOTION_BLUR currently supports adapted composition/layer motion state only.");
    return [];
  }
  const names = [
    "motionBlurEnabled",
    "frameBlendingType",
    "compMotionBlurEnabled",
    "compFrameBlendingEnabled",
    "shutterAngle",
    "shutterPhase",
    "samplesPerFrame",
    "adaptiveSampleLimit",
  ] as const;
  const values = resolveParameterMap(node, names, context, issues);
  if (values === null) return [];
  const motionBlurEnabled = values["motionBlurEnabled"];
  const frameBlendingType = values["frameBlendingType"];
  const compMotionBlurEnabled = values["compMotionBlurEnabled"];
  const compFrameBlendingEnabled = values["compFrameBlendingEnabled"];
  const shutterAngle = values["shutterAngle"];
  const shutterPhase = values["shutterPhase"];
  const samplesPerFrame = values["samplesPerFrame"];
  const adaptiveSampleLimit = values["adaptiveSampleLimit"];
  if (typeof motionBlurEnabled !== "boolean"
    || typeof compMotionBlurEnabled !== "boolean"
    || typeof compFrameBlendingEnabled !== "boolean"
    || typeof frameBlendingType !== "string"
    || !["NO_FRAME_BLEND", "FRAME_MIX", "PIXEL_MOTION"].includes(frameBlendingType)
    || typeof shutterAngle !== "number"
    || typeof shutterPhase !== "number"
    || typeof samplesPerFrame !== "number"
    || typeof adaptiveSampleLimit !== "number") {
    addIssue(issues, node.nodeId, "MOTION_PARAMETER_INVALID",
      "Motion state requires booleans, a valid frame-blending mode, and numeric shutter/sample settings.");
    return [];
  }
  operations.push({
    type: "SET_COMP_MOTION",
    compId: context.compId,
    state: {
      motionBlur: compMotionBlurEnabled,
      frameBlending: compFrameBlendingEnabled,
      shutterAngle,
      shutterPhase,
      samplesPerFrame,
      adaptiveSampleLimit,
    },
  });
  for (const layerId of targets) {
    operations.push({
      type: "SET_LAYER_MOTION",
      compId: context.compId,
      layerId,
      state: {
        motionBlur: motionBlurEnabled,
        frameBlendingType: frameBlendingType as VirtualAeFrameBlendingModeV1,
      },
    });
  }
  return targets;
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
  const positionExpressionRegistry: M6PositionExpressionRegistryV1 = new Map();
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
    if (node.optional === true && !supportedNodeVariantV1(node, "VIRTUAL", context)) {
      skippedOptionalNodeIds.push(node.nodeId);
      outputs = targets;
    } else if (node.kind === "PRECOMPOSE") {
      outputs = compilePrecompose(node, targets, context, windows, operations, issues);
    } else if (node.kind === "TIME_REMAP") {
      outputs = compileTimeRemap(node, targets, context, windows, operations, issues);
    } else if (node.kind === "CAMERA_PUSH") {
      outputs = compileCameraPush(node, targets, context, windows, operations, issues);
    } else if (node.kind === "TRANSFORM_ANIMATION") {
      outputs = compileStaticTransform(node, targets, context, operations, issues);
    } else if (node.kind === "MOTION_BLUR") {
      outputs = compileMotionBlur(node, targets, context, operations, issues);
    } else if (node.kind === "EFFECT_STACK") {
      outputs = compileEffectStack(node, targets, context, operations, issues, comp.frameRate);
    } else if (node.kind === "STABILIZATION") {
      outputs = compileStabilization(node, targets, context, operations, issues);
    } else if (node.kind === "LAYER_DUPLICATION" || node.kind === "TEMPORAL_DUPLICATION") {
      outputs = compileM6TemporalDuplication(
        node,
        targets,
        context,
        operations,
        issues,
        comp.frameRate,
      );
    } else if ([
      "SUBJECT_ISOLATION",
      "OPACITY_SHAPING",
      "DIRECTIONAL_OFFSET",
      "BLUR",
      "COLOR_TREATMENT",
      "DISTORTION",
      "MATTE_RELATION",
      "MOTION_SHAPING",
    ].includes(node.kind)) {
      outputs = compileM6SemanticVisualState(
        node,
        targets,
        context,
        operations,
        issues,
        positionExpressionRegistry,
      );
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
