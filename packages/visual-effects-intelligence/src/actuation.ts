import type {
  ConstructionActuationPlanV1,
  ConstructionControlInstructionV1,
  ConstructionControlKindV1,
  ConstructionGraphV1,
  FidelityComparisonV1,
  NormalizedPointV1,
} from "./contracts.js";

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

const magnitude = (value: number | NormalizedPointV1): number =>
  typeof value === "number" ? Math.abs(value) : Math.hypot(value.x, value.y);

const CONTROL_BY_METRIC: Readonly<Record<string, readonly ConstructionControlKindV1[]>> = {
  temporalStateCountPeak: ["TEMPORAL_COPY_COUNT"],
  fragmentationTemporalStateCountPeak: ["TEMPORAL_COPY_COUNT"],
  temporalPersistence: ["TEMPORAL_PERSISTENCE"],
  overlapDensityPeak: ["TEMPORAL_BAND_MIX", "DUPLICATE_OPACITY", "DUPLICATE_SPREAD", "TEMPORAL_FRAGMENT_DENSITY"],
  fragmentationOverlapDensityPeak: ["TEMPORAL_BAND_MIX", "DUPLICATE_OPACITY", "DUPLICATE_SPREAD", "TEMPORAL_FRAGMENT_DENSITY"],
  fragmentationCoherencePeak: ["TEMPORAL_BAND_MIX", "TEMPORAL_COPY_COUNT", "DUPLICATE_OPACITY", "DUPLICATE_SPREAD", "TEMPORAL_FRAGMENT_DENSITY"],
  fragmentationEventLocalization: ["TEMPORAL_BAND_MIX", "TEMPORAL_COPY_COUNT", "DUPLICATE_OPACITY", "DUPLICATE_SPREAD", "TEMPORAL_FRAGMENT_DENSITY"],
  displacementPeak: ["SPATIAL_SEPARATION"],
  stateSeparationPeak: ["SPATIAL_SEPARATION", "DUPLICATE_SPREAD"],
  fragmentationStateSeparationPeak: ["SPATIAL_SEPARATION", "DUPLICATE_SPREAD"],
  displacementDirection: ["SPATIAL_DIRECTION"],
  motionEnergyPeak: ["MOTION_IMPULSE"],
  accelerationPeak: ["MOTION_IMPULSE", "MOTION_IMPULSE_SHARPNESS", "MOTION_IMPULSE_PHASE"],
  recoveryFrames: ["RECOVERY_DURATION"],
  blurPeak: ["BLUR_STRENGTH"],
  blurHalfPeakAttackMs: ["BLUR_ATTACK_DURATION"],
  blurHalfPeakRecoveryMs: ["BLUR_RECOVERY_DURATION"],
  exposurePeak: ["EXPOSURE_STRENGTH"],
  distortionPeak: ["DISTORTION_STRENGTH", "DISTORTION_SIZE", "DISTORTION_COMPLEXITY", "DISTORTION_EVOLUTION"],
  subjectSeparationPeak: ["SUBJECT_ISOLATION"],
  maskCoveragePeak: ["SUBJECT_ISOLATION"],
  occlusionPeak: ["OCCLUSION_COVERAGE"],
  chromaticSeparationPeak: ["CHROMATIC_SEPARATION"],
  scaleRange: ["SCALE_PULSE"],
  rotationRange: ["ROTATION_PULSE"],
  activeDimensionCount: ["COORDINATED_DIMENSION_COUNT"],
};

const correctionDirection = (
  reference: number | NormalizedPointV1,
  render: number | NormalizedPointV1,
): ConstructionControlInstructionV1["direction"] => {
  if (typeof reference !== "number" || typeof render !== "number") return "SET";
  if (render < reference) return "INCREASE";
  if (render > reference) return "DECREASE";
  return "SET";
};

const correctionMultiplier = (
  direction: ConstructionControlInstructionV1["direction"],
  reference: number | NormalizedPointV1,
  render: number | NormalizedPointV1,
): number => {
  if (direction === "SET") return 1;
  const referenceMagnitude = magnitude(reference);
  const renderMagnitude = magnitude(render);
  if (direction === "INCREASE") {
    if (renderMagnitude <= 1e-6) return 2;
    return Math.sqrt(clamp(referenceMagnitude / renderMagnitude, 1, 4));
  }
  if (referenceMagnitude <= 1e-6) return Math.sqrt(0.2);
  if (renderMagnitude <= 1e-6) return 1;
  return Math.sqrt(clamp(referenceMagnitude / renderMagnitude, 0.2, 1));
};

export const deriveConstructionActuationPlanV1 = (input: {
  readonly graph: ConstructionGraphV1;
  readonly comparison: FidelityComparisonV1;
}): ConstructionActuationPlanV1 => {
  const instructions: ConstructionControlInstructionV1[] = [];
  const unresolved = new Set<string>();

  for (const failure of input.comparison.metrics.filter((metric) => !metric.passed)) {
    const coveredNodeIds = input.graph.invariantCoverage[failure.invariantId] ?? [];
    let nodeId = coveredNodeIds[0];
    let controls = CONTROL_BY_METRIC[failure.metric] ?? [];
    if (failure.metric === "temporalPersistence"
      && correctionDirection(failure.referenceValue, failure.renderValue) === "DECREASE") {
      const echoNodeId = coveredNodeIds.find((coveredNodeId) => {
        const node = input.graph.nodes.find((candidate) => candidate.nodeId === coveredNodeId);
        return node?.parameters["synthesisStrategy"] === "LAYERED_ECHO_AUGMENTED"
          || node?.parameters["synthesisStrategy"] === "NATIVE_ECHO_HYBRID";
      });
      if (echoNodeId !== undefined) {
        // A retained Echo can dominate a visually over-long temporal tail even
        // after the explicit duplicate window shrinks. Reduce Echo decay when
        // rendered persistence exceeds the reference; keep the base temporal
        // window as the INCREASE actuator for under-driven persistence.
        nodeId = echoNodeId;
        controls = ["TEMPORAL_BAND_MIX"];
      }
    }
    if (nodeId !== undefined
      && (failure.metric === "temporalStateCountPeak"
        || failure.metric === "fragmentationTemporalStateCountPeak")
      && typeof failure.referenceValue === "number"
      && Number.isFinite(failure.referenceValue)) {
      const temporalNode = input.graph.nodes.find((node) => node.nodeId === nodeId);
      const baseCountRaw = temporalNode?.parameters.fragmentationTemporalStateCountPeak
        ?? temporalNode?.parameters.temporalStateCountPeak;
      const scaleRaw = temporalNode?.parameters.temporalCopyCountScale;
      const baseCount = typeof baseCountRaw === "number" && Number.isFinite(baseCountRaw)
        ? baseCountRaw
        : null;
      const scale = typeof scaleRaw === "number" && Number.isFinite(scaleRaw) ? scaleRaw : 1;
      const structuralStateCount = baseCount === null
        ? null
        : Math.max(2, Math.min(8, Math.round(baseCount * scale)));
      const requiredVisibleStateCount = Math.max(2, Math.round(failure.referenceValue));
      if (structuralStateCount !== null && structuralStateCount >= requiredVisibleStateCount) {
        // The graph already contains enough temporal states. A lower rendered state
        // count is an observability/visibility deficit, not evidence that more
        // duplicate layers should be created. Strengthen visibility instead of
        // structurally over-shooting the professional reference.
        controls = ["DUPLICATE_OPACITY"];
      } else if (controls.includes("TEMPORAL_COPY_COUNT")) {
        controls = ["TEMPORAL_COPY_COUNT", "DUPLICATE_OPACITY"];
      }
    }
    if (nodeId === undefined || controls.length === 0) {
      unresolved.add(failure.invariantId);
      continue;
    }
    for (const control of controls) {
      const coupledMetric = control === "DUPLICATE_SPREAD"
        ? input.comparison.metrics.find((metric) =>
          metric.metric === "fragmentationStateSeparationPeak" || metric.metric === "stateSeparationPeak")
        : undefined;
      const controlReference = coupledMetric?.referenceValue ?? failure.referenceValue;
      const controlRender = coupledMetric?.renderValue ?? failure.renderValue;
      const direction = correctionDirection(controlReference, controlRender);
      const multiplier = correctionMultiplier(direction, controlReference, controlRender);
      const couplingRationale = coupledMetric === undefined
        ? ""
        : " Duplicate spread is constrained by the reference within-frame state-separation envelope so overlap correction cannot over-drive fragment spacing.";
      instructions.push({
        instructionId: `actuate:${failure.invariantId}:${control.toLowerCase()}`,
        invariantId: failure.invariantId,
        nodeId,
        metric: coupledMetric?.metric ?? failure.metric,
        deficitMetric: failure.metric,
        deficitReferenceValue: failure.referenceValue,
        deficitRenderValue: failure.renderValue,
        control,
        direction,
        referenceValue: controlReference,
        renderValue: controlRender,
        multiplier,
        normalizedError: failure.normalizedError,
        defining: failure.defining,
        rationale: `${failure.diagnosis}${couplingRationale}`,
      });
    }
  }

  return {
    schema: "editflow.construction-actuation-plan.v1",
    family: input.comparison.family,
    comparisonKey: `${input.comparison.referenceEvidenceKey}->${input.comparison.renderEvidenceKey}`,
    instructions,
    unresolvedInvariantIds: [...unresolved],
  };
};

export interface ConstructionActuationApplicationV1 {
  readonly graph: ConstructionGraphV1;
  readonly appliedInstructionIds: readonly string[];
  readonly unsupportedInstructionIds: readonly string[];
}

const PHYSICAL_SCALE_PARAMETER_BY_CONTROL: Readonly<Partial<Record<
  ConstructionControlKindV1,
  string
>>> = {
  TEMPORAL_COPY_COUNT: "temporalCopyCountScale",
  TEMPORAL_PERSISTENCE: "temporalPersistenceScale",
  DUPLICATE_OPACITY: "duplicateOpacityScale",
  DUPLICATE_SPREAD: "duplicateSpreadScale",
  MOTION_IMPULSE: "motionImpulseScale",
  MOTION_IMPULSE_SHARPNESS: "motionImpulseSharpnessScale",
  MOTION_IMPULSE_PHASE: "motionImpulsePhaseScale",
  RECOVERY_DURATION: "recoveryDurationScale",
  BLUR_STRENGTH: "blurStrengthScale",
  BLUR_ATTACK_DURATION: "blurAttackDurationScale",
  BLUR_RECOVERY_DURATION: "blurRecoveryDurationScale",
  EXPOSURE_STRENGTH: "exposureStrengthScale",
  DISTORTION_STRENGTH: "distortionStrengthScale",
  CHROMATIC_SEPARATION: "chromaticSeparationScale",
  SCALE_PULSE: "scalePulseScale",
};

const physicalParameterForControl = (
  node: ConstructionGraphV1["nodes"][number],
  control: ConstructionControlKindV1,
): string | undefined => {
  if (node.parameters["synthesisStrategy"] === "NATIVE_ECHO_HYBRID"
    || node.parameters["synthesisStrategy"] === "LAYERED_ECHO_AUGMENTED") {
    switch (control) {
      case "TEMPORAL_COPY_COUNT":
      case "TEMPORAL_FRAGMENT_DENSITY":
        return "numberOfEchoes";
      case "TEMPORAL_PERSISTENCE":
        return "echoSpacingFrames";
      case "TEMPORAL_BAND_MIX":
        return "decay";
      case "DUPLICATE_OPACITY":
        return "startingIntensity";
      case "DUPLICATE_SPREAD":
        // Echo spacing is already the dedicated persistence actuator. Do not
        // alias spatial duplicate spread onto the same native parameter.
        return undefined;
      default:
        break;
    }
  }
  if (node.parameters["synthesisStrategy"] === "TIME_DISPLACEMENT_HYBRID") {
    if (control === "TEMPORAL_PERSISTENCE") return "timeDisplacementStrengthScale";
  }
  if (node.parameters["synthesisStrategy"] === "TURBULENT_DISPLACE_HYBRID"
    || node.parameters["synthesisStrategy"] === "COMPOUND_EVOLVING_WARP_HYBRID"
    || node.parameters["synthesisStrategy"] === "COMPOUND_COMPOSITE_WARP_HYBRID"
    || node.parameters["synthesisStrategy"] === "COMPOUND_DUAL_WARP_HYBRID") {
    if (control === "DISTORTION_SIZE") return "distortionSizeScale";
    if (control === "DISTORTION_COMPLEXITY") return "distortionComplexityScale";
    if (control === "DISTORTION_EVOLUTION") return "distortionEvolutionScale";
    if (node.parameters["synthesisStrategy"] === "COMPOUND_EVOLVING_WARP_HYBRID"
      || node.parameters["synthesisStrategy"] === "COMPOUND_COMPOSITE_WARP_HYBRID"
      || node.parameters["synthesisStrategy"] === "COMPOUND_DUAL_WARP_HYBRID") {
      // Acceleration on the evolving-warp node is produced by the temporal
      // deformation sweep itself. Route the primary acceleration actuator to a
      // compiler-consumed parameter; do not report generic motion knobs as
      // applied when this EFFECT_STACK cannot consume them.
      if (control === "MOTION_IMPULSE") return "eventEvolutionSweepScale";
      if (control === "MOTION_IMPULSE_SHARPNESS") return "eventEvolutionSharpnessScale";
      if (control === "MOTION_IMPULSE_PHASE") return undefined;
    }
  }
  return PHYSICAL_SCALE_PARAMETER_BY_CONTROL[control];
};

const PHYSICAL_SCALE_LIMITS: Readonly<Record<string, readonly [number, number]>> = {
  temporalCopyCountScale: [0.5, 2],
  temporalPersistenceScale: [0.5, 4],
  duplicateOpacityScale: [0.35, 1.5],
  duplicateSpreadScale: [0.25, 2],
  motionImpulseScale: [0.25, 4],
  motionImpulseSharpnessScale: [0.5, 2],
  motionImpulsePhaseScale: [0.5, 1.5],
  recoveryDurationScale: [0.25, 2],
  blurStrengthScale: [0, 4],
  blurAttackDurationScale: [0.25, 4],
  blurRecoveryDurationScale: [0.25, 4],
  exposureStrengthScale: [0.25, 4],
  distortionStrengthScale: [0.25, 4],
  distortionSizeScale: [0.25, 4],
  distortionComplexityScale: [0.5, 2],
  distortionEvolutionScale: [0.25, 4],
  eventEvolutionSweepScale: [0.25, 4],
  timeDisplacementStrengthScale: [0.25, 4],
  eventEvolutionSharpnessScale: [0.5, 2],
  chromaticSeparationScale: [0.25, 4],
  scalePulseScale: [0.25, 4],
  numberOfEchoes: [1, 12],
  echoSpacingFrames: [0.25, 8],
  startingIntensity: [0.1, 1],
  decay: [0.05, 0.98],
};

/**
 * Converts rendered-comparator actuation instructions into bounded physical
 * construction parameters. This deliberately keeps semantic reference metrics
 * unchanged: correction adjusts how the recipe realizes them rather than
 * rewriting the professional evidence it is trying to match.
 */
export const applyConstructionActuationPlanV1 = (
  graph: ConstructionGraphV1,
  plan: ConstructionActuationPlanV1,
): ConstructionActuationApplicationV1 => {
  const selected = new Map<string, ConstructionControlInstructionV1>();
  const unsupported = new Set<string>();
  for (const instruction of plan.instructions.filter((item) => item.defining)) {
    const node = graph.nodes.find((candidate) => candidate.nodeId === instruction.nodeId);
    const parameter = node === undefined
      ? undefined
      : physicalParameterForControl(node, instruction.control);
    if (parameter === undefined) {
      unsupported.add(instruction.instructionId);
      continue;
    }
    // Multiple semantic controls can intentionally converge on one native
    // actuator. Keep only the strongest defining error so a blind pass cannot
    // multiply contradictory corrections onto the same physical parameter.
    const key = `${instruction.nodeId}:${parameter}`;
    const current = selected.get(key);
    if (current === undefined || instruction.normalizedError > current.normalizedError) {
      selected.set(key, instruction);
    }
  }

  const applied: string[] = [];
  const nodes = graph.nodes.map((node) => {
    const parameters = { ...node.parameters };
    let changed = false;
    for (const instruction of selected.values()) {
      if (instruction.nodeId !== node.nodeId) continue;
      const parameter = physicalParameterForControl(node, instruction.control);
      if (parameter === undefined) continue;
      const limits = PHYSICAL_SCALE_LIMITS[parameter];
      if (limits === undefined || !Number.isFinite(instruction.multiplier)) {
        unsupported.add(instruction.instructionId);
        continue;
      }
      const priorRaw = parameters[parameter];
      const prior = typeof priorRaw === "number" && Number.isFinite(priorRaw) ? priorRaw : 1;
      const scaled = clamp(prior * instruction.multiplier, limits[0], limits[1]);
      const next = parameter === "numberOfEchoes" ? Math.round(scaled) : scaled;
      if (Math.abs(next - prior) <= 1e-9) continue;
      parameters[parameter] = next;
      applied.push(
        ...plan.instructions
          .filter((candidate) =>
            candidate.defining
            && candidate.nodeId === instruction.nodeId
            && candidate.control === instruction.control
            && candidate.direction === instruction.direction)
          .map((candidate) => candidate.instructionId),
      );
      changed = true;
    }
    return changed ? { ...node, parameters } : node;
  });

  return {
    graph: { ...graph, nodes },
    appliedInstructionIds: [...new Set(applied)],
    unsupportedInstructionIds: [...unsupported],
  };
};

export const selectDefiningActuationInstructionsV1 = (
  plan: ConstructionActuationPlanV1,
): readonly ConstructionControlInstructionV1[] =>
  plan.instructions.filter((instruction) => instruction.defining);
