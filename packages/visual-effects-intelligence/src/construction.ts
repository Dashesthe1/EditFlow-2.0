import type {
  EditingIrNodeV1,
  EditingIrPrimitiveKindV1,
  EditingIrRecipeV1,
} from "../../editing-ir/src/index.js";
import { assertValidEditingIrRecipeV1 } from "../../editing-ir/src/index.js";
import { asCapabilityId, type ExecutionPlan } from "../../core-contracts/src/index.js";
import {
  compileEditingIrRecipeToVirtualAeV1,
  inspectRecipeCompilerSupportV1,
  lowerCompiledRecipeToNativeAePlanV1,
  NativeAeRecipeLoweringError,
  RecipeCompileError,
  type NativeAeRecipeLoweringInputV1,
  type RecipeCompilerContextV1,
} from "../../recipe-compiler/src/index.js";
import {
  simulateVirtualAeV1,
  type VirtualAeProjectV1,
  type VirtualAeSimulationV1,
} from "../../virtual-ae/src/index.js";
import type {
  ConstructionCompilationV1,
  ConstructionGraphV1,
  ConstructionNodeKindV1,
  ConstructionNodeV1,
  EffectAnatomyV1,
  EffectInvariantV1,
  VisualDimensionV1,
} from "./contracts.js";

interface NodeTemplateV1 {
  readonly kind: ConstructionNodeKindV1;
  readonly dimension: VisualDimensionV1;
  readonly capabilities: readonly string[];
}

const templateFor = (
  invariant: EffectInvariantV1,
  family: EffectAnatomyV1["family"],
): NodeTemplateV1 => {
  if (invariant.metric === "temporalStateCountPeak"
    || invariant.metric === "fragmentationTemporalStateCountPeak"
    || invariant.metric === "temporalPersistence") {
    return { kind: "TEMPORAL_DUPLICATES", dimension: "TEMPORAL",
      capabilities: ["ae.layer.duplicate", "ae.layer.time.offset"] };
  }
  if (invariant.metric === "fragmentationCoherencePeak"
    || invariant.metric === "fragmentationEventLocalization") {
    return { kind: "TEMPORAL_DUPLICATES", dimension: "COMPOSITING",
      capabilities: ["ae.layer.duplicate", "ae.layer.time.offset", "ae.layer.opacity.set", "ae.layer.transform.set"] };
  }
  if (invariant.metric === "fragmentationStateSeparationPeak" || invariant.metric === "stateSeparationPeak") {
    return { kind: "TEMPORAL_DUPLICATES", dimension: "SPATIAL",
      capabilities: ["ae.layer.duplicate", "ae.layer.time.offset", "ae.layer.opacity.set", "ae.layer.transform.set"] };
  }
  if (invariant.metric === "subjectSeparationPeak" || invariant.metric === "maskCoveragePeak") {
    return { kind: "SUBJECT_ISOLATION", dimension: "ISOLATION",
      capabilities: ["ae.subject.isolate", "ae.layer.matte.set"] };
  }
  if (invariant.metric === "distortionPeak") {
    return { kind: "DISTORTION", dimension: "DISTORTION",
      capabilities: family === "DISPLACEMENT_WARP"
        ? ["ae.effect.turbulent-displace"]
        : ["ae.effect.displacement-map"] };
  }
  if (invariant.metric === "blurPeak"
    || invariant.metric === "blurHalfPeakAttackMs"
    || invariant.metric === "blurHalfPeakRecoveryMs") {
    return { kind: "OPTICAL_TREATMENT", dimension: "OPTICAL",
      capabilities: ["ae.effect.directional-blur"] };
  }
  if (invariant.metric === "exposurePeak") {
    return { kind: "EXPOSURE_ACCENT", dimension: "OPTICAL",
      capabilities: ["ae.effect.exposure"] };
  }
  if (invariant.metric === "chromaticSeparationPeak") {
    return { kind: "CHROMATIC_TREATMENT", dimension: "OPTICAL",
      capabilities: ["ae.effect.channel-shift", "ae.layer.blend_mode.set"] };
  }
  if (invariant.metric === "occlusionPeak") {
    return { kind: "OCCLUSION_COMPOSITE", dimension: "COMPOSITING",
      capabilities: ["ae.layer.matte.set", "ae.layer.order.set"] };
  }
  if (invariant.metric === "recoveryFrames" || invariant.metric === "accelerationPeak") {
    return { kind: "RECOVERY", dimension: "MOTION_STRUCTURE",
      capabilities: ["ae.keyframe.temporal_ease.set", "ae.layer.transform.set"] };
  }
  if (invariant.metric === "activeDimensionCount"
    || invariant.metric === "overlapDensityPeak"
    || invariant.metric === "fragmentationOverlapDensityPeak") {
    return { kind: "TEMPORAL_DUPLICATES", dimension: "COMPOSITING",
      capabilities: ["ae.layer.duplicate", "ae.layer.opacity.set"] };
  }
  if (family === "UNKNOWN"
    && (invariant.metric === "displacementPeak"
      || invariant.metric === "displacementDirection"
      || invariant.metric === "motionPeakPhase")) {
    return { kind: "CAMERA_MOTION", dimension: "SPATIAL",
      capabilities: ["ae.layer.transform.set", "ae.keyframe.spatial.set"] };
  }
  if (invariant.metric === "displacementDirection") {
    return { kind: "CAMERA_MOTION", dimension: "SPATIAL",
      capabilities: ["ae.layer.transform.set", "ae.keyframe.spatial.set"] };
  }
  return { kind: "TRANSFORM_MOTION", dimension: invariant.dimension,
    capabilities: ["ae.layer.transform.set", "ae.keyframe.temporal_ease.set"] };
};

const parameterValue = (
  invariant: EffectInvariantV1,
  observed: EffectAnatomyV1["observedMetrics"][string] | undefined,
): number | readonly number[] => {
  if (typeof observed === "number" && Number.isFinite(observed)) return observed;
  if (observed !== undefined && typeof observed !== "number") return [observed.x, observed.y];
  if (typeof invariant.target === "number") return invariant.target;
  if (Array.isArray(invariant.target)) return (invariant.target[0] + invariant.target[1]) / 2;
  const target = invariant.target as Readonly<{ x: number; y: number }>;
  return [target.x, target.y];
};

const nodeKey = (template: NodeTemplateV1): string =>
  template.kind === "TEMPORAL_DUPLICATES"
    ? template.kind
    : `${template.kind}:${template.dimension}`;

const constructionNodeKeyV1 = (
  template: NodeTemplateV1,
  family: EffectAnatomyV1["family"],
): string => {
  // Zoom motion energy is the visible consequence of the same scale pulse,
  // not an independent directionless offset. Keep both defining invariants on
  // one transform node so native lowering receives the measured scale driver.
  if (family === "ZOOM_IMPACT" && template.kind === "TRANSFORM_MOTION") {
    return "TRANSFORM_MOTION:ZOOM_IMPACT";
  }
  return nodeKey(template);
};

export const buildConstructionGraphV1 = (anatomy: EffectAnatomyV1): ConstructionGraphV1 => {
  const invariants = [...anatomy.dna.definingInvariants, ...anatomy.dna.optionalInvariants];
  const fragmentationStates = anatomy.observedMetrics["fragmentationTemporalStateCountPeak"];
  const fragmentationCoherence = anatomy.observedMetrics["fragmentationCoherencePeak"];
  const hasCoherentFragmentation = typeof fragmentationStates === "number"
    && Number.isFinite(fragmentationStates) && fragmentationStates >= 3
    && typeof fragmentationCoherence === "number"
    && Number.isFinite(fragmentationCoherence) && fragmentationCoherence >= 0.7;
  const grouped = new Map<string, { template: NodeTemplateV1; invariants: EffectInvariantV1[] }>();
  for (const item of invariants) {
    const template = templateFor(item, anatomy.family);
    const key = constructionNodeKeyV1(template, anatomy.family);
    const existing = grouped.get(key);
    if (existing === undefined) {
      grouped.set(key, {
        template: template.kind === "TEMPORAL_DUPLICATES"
          ? { ...template, dimension: "TEMPORAL" }
          : template,
        invariants: [item],
      });
    } else {
      existing.invariants.push(item);
      existing.template = {
        ...existing.template,
        capabilities: [...new Set([
          ...existing.template.capabilities,
          ...template.capabilities,
        ])],
      };
    }
  }
  const nodes: ConstructionNodeV1[] = [];
  const coverage: Record<string, string[]> = {};
  let previousRequired: string | null = null;
  for (const [index, group] of [...grouped.values()].entries()) {
    const required = group.invariants.some((item) => item.defining);
    const nodeId =`node:${index + 1}:${group.template.kind.toLowerCase()}`;
    const parameters: Record<string, number | string | boolean | readonly number[]> = {};
    for (const item of group.invariants) {
      parameters[item.metric] = parameterValue(item, anatomy.observedMetrics[item.metric]);
      coverage[item.invariantId] = [nodeId];
    }
    if (anatomy.family === "DISPLACEMENT_WARP" && group.template.kind === "DISTORTION") {
      const distortionPeak = parameters.distortionPeak;
      if (typeof distortionPeak === "number" && Number.isFinite(distortionPeak) && distortionPeak > 0) {
        const distortion = Math.max(0, Math.min(1, distortionPeak));
        parameters.effectSchemaRef = "ae.effect-schema.m6.turbulent-displace.v3";
        parameters.distortionAmount = Math.max(20, Math.min(100, 20 + distortion * 120));
        parameters.distortionSize = Math.max(10, Math.min(48, 10 + distortion * 35));
        parameters.distortionComplexity = Math.max(1.5, Math.min(4, 1.5 + distortion * 3));
        parameters.distortionEvolution = Math.max(45, Math.min(270, 45 + distortion * 225));
        parameters.eventLocalEffect = true;
        parameters.eventDynamicDistortion = true;
        parameters.eventLocalEffectApplication = "IN_PLACE";
        parameters.eventLocalEffectTargetScope = "PRIMARY";
        parameters.eventLocalEffectRecoveryBounded = true;
        parameters.eventAmountPulseScale = Math.max(1.2, Math.min(2.25, 1.15 + distortion * 1.8));
        parameters.eventEvolutionSweepDegrees = Math.max(180, Math.min(720, 180 + distortion * 720));
        parameters.eventEvolutionSweepScale = 1;
        parameters.eventEvolutionSharpnessScale = 1;
      }
    }
    if (group.template.kind === "OPTICAL_TREATMENT") {
      const displacementDirection = anatomy.observedMetrics["displacementDirection"];
      let directionDegrees = 0;
      if (displacementDirection !== undefined && typeof displacementDirection !== "number") {
        parameters.blurDirectionVector = [displacementDirection.x, displacementDirection.y];
        if (Math.hypot(displacementDirection.x, displacementDirection.y) > 1e-6) {
          directionDegrees = Math.atan2(displacementDirection.y, displacementDirection.x) * 180 / Math.PI;
        }
      }
      const blurPeak = parameters.blurPeak;
      if (typeof blurPeak === "number" && Number.isFinite(blurPeak) && blurPeak > 0) {
        parameters.effectSchemaRef = "ae.effect-schema.m6.directional-blur.v1";
        parameters.blurDirectionDegrees = directionDegrees;
        parameters.blurLengthPixels = Math.max(2, Math.min(64, blurPeak * 48));
        parameters.eventLocalEffect = true;
        const blurPeakPhase = anatomy.observedMetrics["blurPeakPhase"];
        if (typeof blurPeakPhase === "number" && Number.isFinite(blurPeakPhase)) {
          parameters.blurPeakPhase = Math.max(0, Math.min(1, blurPeakPhase));
        }
      }
    }
    const effectEventPhase = anatomy.observedMetrics["effectEventPhase"];
    if (typeof effectEventPhase === "number" && Number.isFinite(effectEventPhase)) {
      parameters.effectEventPhase = Math.max(0, Math.min(1, effectEventPhase));
    }
    const effectRecoveryFrames = anatomy.observedMetrics["recoveryFrames"];
    if (typeof effectRecoveryFrames === "number" && Number.isFinite(effectRecoveryFrames)
      && effectRecoveryFrames > 0) {
      parameters.effectRecoveryFrames = effectRecoveryFrames;
    }
    const referenceFrameIntervalMs = anatomy.observedMetrics["referenceFrameIntervalMs"];
    if (typeof referenceFrameIntervalMs === "number" && Number.isFinite(referenceFrameIntervalMs)
      && referenceFrameIntervalMs > 0) {
      parameters.referenceFrameIntervalMs = referenceFrameIntervalMs;
    }
    const effectAnalysisDurationMs = anatomy.observedMetrics["effectAnalysisDurationMs"];
    if (typeof effectAnalysisDurationMs === "number" && Number.isFinite(effectAnalysisDurationMs)
      && effectAnalysisDurationMs > 0) {
      parameters.effectAnalysisDurationMs = effectAnalysisDurationMs;
    }
    const effectRecoveryDurationMs = anatomy.observedMetrics["effectRecoveryDurationMs"];
    if (typeof effectRecoveryDurationMs === "number" && Number.isFinite(effectRecoveryDurationMs)
      && effectRecoveryDurationMs > 0) {
      parameters.effectRecoveryDurationMs = effectRecoveryDurationMs;
    }
    if (anatomy.family === "ZOOM_IMPACT" && group.template.kind === "TRANSFORM_MOTION") {
      const scaleVelocityRecoveryMs = anatomy.observedMetrics["scaleVelocityRecoveryMs"];
      if (typeof scaleVelocityRecoveryMs === "number" && Number.isFinite(scaleVelocityRecoveryMs)
        && scaleVelocityRecoveryMs > 0) {
        parameters.scaleVelocityRecoveryMs = scaleVelocityRecoveryMs;
      }
    }
    if (group.template.kind === "RECOVERY" && hasCoherentFragmentation) {
      parameters.motionProfile = "SHUTTER_CONVERGENCE";
    }
    const dependencies = previousRequired === null ? [] : [previousRequired];
    nodes.push({
      nodeId,
      kind: group.template.kind,
      dimension: group.template.dimension,
      dependsOn: dependencies,
      requiredInvariantIds: group.invariants.filter((item) => item.defining).map((item) => item.invariantId),
      capabilityCandidates: group.template.capabilities,
      parameters,
      optional: !required,
    });
    if (required) previousRequired = nodeId;
  }
  const definingIds = anatomy.dna.definingInvariants.map((item) => item.invariantId);
  const missingInvariantIds = definingIds.filter((id) => (coverage[id] ?? []).length === 0);
  return {
    schema: "editflow.effect-construction-graph.v1",
    graphId: `construction:${anatomy.anatomyId}`,
    family: anatomy.family,
    nodes,
    outputs: previousRequired === null ? [] : [previousRequired],
    invariantCoverage: coverage,
    missingInvariantIds,
    evidenceRefs: anatomy.evidenceRefs,
  };
};

export interface ConstructionGraphValidationV1 {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export const validateConstructionGraphV1 = (
  graph: ConstructionGraphV1,
): ConstructionGraphValidationV1 => {
  const errors: string[] = [];
  const nodes = new Map(graph.nodes.map((node) => [node.nodeId, node] as const));
  if (nodes.size !== graph.nodes.length) errors.push("Construction graph node IDs must be unique.");
  if (graph.nodes.length === 0 || graph.outputs.length === 0) errors.push("Construction graph must have nodes and outputs.");
  for (const node of graph.nodes) {
    if (node.nodeId.trim().length === 0) errors.push("Construction node ID must not be empty.");
    for (const dependency of node.dependsOn) {
      if (!nodes.has(dependency)) errors.push(`Construction node '${node.nodeId}' has missing dependency '${dependency}'.`);
      if (dependency === node.nodeId) errors.push(`Construction node '${node.nodeId}' cannot depend on itself.`);
    }
    if (!node.optional && node.requiredInvariantIds.length === 0) {
      errors.push(`Required construction node '${node.nodeId}' covers no defining invariant.`);
    }
  }
  for (const output of graph.outputs) if (!nodes.has(output)) errors.push(`Missing graph output '${output}'.`);
  for (const invariantId of graph.missingInvariantIds) errors.push(`Defining invariant '${invariantId}' is uncovered.`);
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
};

const primitiveFor = (node: ConstructionNodeV1): EditingIrPrimitiveKindV1 => {
  if (typeof node.parameters["effectSchemaRef"] === "string") return "EFFECT_STACK";
  const synthesisStrategy = node.parameters["synthesisStrategy"];
  if (synthesisStrategy === "NATIVE_ECHO_HYBRID"
    || synthesisStrategy === "LAYERED_ECHO_AUGMENTED"
    || synthesisStrategy === "TIME_DISPLACEMENT_HYBRID"
    || synthesisStrategy === "TURBULENT_DISPLACE_HYBRID"
    || synthesisStrategy === "COMPOUND_EVOLVING_WARP_HYBRID"
    || synthesisStrategy === "COMPOUND_COMPOSITE_WARP_HYBRID"
    || synthesisStrategy === "COMPOUND_DUAL_WARP_HYBRID") {
    return "EFFECT_STACK";
  }
  switch (node.kind) {
    case "BASE_TIMING": return "TIME_REMAP";
    case "TEMPORAL_DUPLICATES":
      if (node.dimension === "COMPOSITING") return "OPACITY_SHAPING";
      if (node.dimension === "SPATIAL") return "DIRECTIONAL_OFFSET";
      return "TEMPORAL_DUPLICATION";
    case "SUBJECT_ISOLATION": return "SUBJECT_ISOLATION";
    case "CAMERA_MOTION": return "DIRECTIONAL_OFFSET";
    case "TRANSFORM_MOTION": return "DIRECTIONAL_OFFSET";
    case "DISTORTION": return "DISTORTION";
    case "OPTICAL_TREATMENT": return "BLUR";
    case "EXPOSURE_ACCENT": return "COLOR_TREATMENT";
    case "CHROMATIC_TREATMENT": return "COLOR_TREATMENT";
    case "OCCLUSION_COMPOSITE": return "MATTE_RELATION";
    case "PRECOMPOSE_BOUNDARY": return "PRECOMPOSE";
    case "RECOVERY": return "MOTION_SHAPING";
  }
};

const irNode = (node: ConstructionNodeV1): EditingIrNodeV1 => ({
  nodeId: node.nodeId,
  kind: primitiveFor(node),
  intent: `Reproduce ${node.dimension.toLowerCase()} defining behavior for ${node.requiredInvariantIds.join(", ") || "optional finish"}.`,
  dependsOn: node.dependsOn,
  capabilityIds: node.capabilityCandidates.map(asCapabilityId),
  parameters: Object.entries(node.parameters).map(([name, value]) => ({
    name,
    intent: `Adapt ${name} from normalized reference evidence.`,
    derivedFrom: ["referenceEvidence", "subject", "frameRate", "duration", "intensity"],
    value,
  })),
  ...(node.dependsOn.length === 0 ? { target: { roles: ["hero"], mode: "EACH" as const } } : {}),
  optional: node.optional,
});

export const compileConstructionGraphV1 = (
  graph: ConstructionGraphV1,
  availableCapabilities: readonly string[],
): ConstructionCompilationV1 => {
  const validation = validateConstructionGraphV1(graph);
  if (!validation.valid) {
    return { graph, recipe: null, capabilityGaps: validation.errors, definingCoverageComplete: false };
  }
  const available = new Set(availableCapabilities);
  const capabilityGaps = [...new Set(graph.nodes
    .filter((node) => !node.optional)
    .flatMap((node) => node.capabilityCandidates.filter((capability) => !available.has(capability))))].sort();
  const recipe: EditingIrRecipeV1 = {
    schema: "editflow.editing-ir.recipe.v1",
    recipeId: `recipe:${graph.graphId}`,
    skillId: `synthesized:${graph.family.toLowerCase()}`,
    creativeIntent: `Reconstruct ${graph.family} from defining visual behavior, not a nearest-name substitute.`,
    prerequisites: ["Dense reference evidence is available.", "Every required capability is preflighted."],
    nodes: graph.nodes.map(irNode),
    outputs: graph.outputs,
    validationCriteria: Object.keys(graph.invariantCoverage).map((id) => `Rendered proof satisfies invariant ${id}.`),
  };
  assertValidEditingIrRecipeV1(recipe);
  return {
    graph,
    recipe: capabilityGaps.length === 0 ? recipe : null,
    capabilityGaps,
    definingCoverageComplete: graph.missingInvariantIds.length === 0,
  };
};

export interface VirtualAeConstructionResultV1 {
  readonly compiled: boolean;
  readonly simulation: VirtualAeSimulationV1 | null;
  readonly issues: readonly string[];
}

export const compileConstructionThroughVirtualAeV1 = (
  compilation: ConstructionCompilationV1,
  project: VirtualAeProjectV1,
  context: RecipeCompilerContextV1,
): VirtualAeConstructionResultV1 => {
  if (compilation.recipe === null) {
    return { compiled: false, simulation: null, issues: compilation.capabilityGaps };
  }
  try {
    const lowered = compileEditingIrRecipeToVirtualAeV1(compilation.recipe, project, context);
    const simulation = simulateVirtualAeV1(project, lowered.operations);
    return { compiled: simulation.valid, simulation, issues: simulation.errors };
  } catch (error) {
    if (error instanceof RecipeCompileError) {
      return { compiled: false, simulation: null, issues: error.issues.map((issue) => `${issue.code}:${issue.message}`) };
    }
    throw error;
  }
};

export interface NativeAeConstructionResultV1 {
  readonly compiled: boolean;
  readonly plan: ExecutionPlan | null;
  readonly issues: readonly string[];
}

export const compileConstructionThroughNativeAeV1 = (
  compilation: ConstructionCompilationV1,
  project: VirtualAeProjectV1,
  context: RecipeCompilerContextV1,
  nativeInput: NativeAeRecipeLoweringInputV1,
): NativeAeConstructionResultV1 => {
  if (compilation.recipe === null) {
    return { compiled: false, plan: null, issues: compilation.capabilityGaps };
  }
  const support = inspectRecipeCompilerSupportV1(compilation.recipe, context);
  if (support.nativeAeBlockedPrimitiveKinds.length > 0) {
    return {
      compiled: false,
      plan: null,
      issues: support.nativeAeBlockedPrimitiveKinds.map((kind) =>
        `UNSUPPORTED_NATIVE_M6_PRIMITIVE:${kind}`),
    };
  }
  try {
    const virtual = compileEditingIrRecipeToVirtualAeV1(compilation.recipe, project, context);
    const simulation = simulateVirtualAeV1(project, virtual.operations);
    if (!simulation.valid) return { compiled: false, plan: null, issues: simulation.errors };
    const plan = lowerCompiledRecipeToNativeAePlanV1(virtual, nativeInput);
    return { compiled: true, plan, issues: [] };
  } catch (error) {
    if (error instanceof RecipeCompileError) {
      return {
        compiled: false,
        plan: null,
        issues: error.issues.map((issue) => `${issue.code}:${issue.message}`),
      };
    }
    if (error instanceof NativeAeRecipeLoweringError) {
      return { compiled: false, plan: null, issues: [`${error.code}:${error.message}`] };
    }
    throw error;
  }
};
