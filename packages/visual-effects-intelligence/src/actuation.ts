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
  temporalPersistence: ["TEMPORAL_PERSISTENCE"],
  overlapDensityPeak: ["TEMPORAL_BAND_MIX", "DUPLICATE_OPACITY", "DUPLICATE_SPREAD", "TEMPORAL_FRAGMENT_DENSITY"],
  fragmentationCoherencePeak: ["TEMPORAL_BAND_MIX", "TEMPORAL_COPY_COUNT", "DUPLICATE_OPACITY", "DUPLICATE_SPREAD", "TEMPORAL_FRAGMENT_DENSITY"],
  displacementPeak: ["SPATIAL_SEPARATION"],
  stateSeparationPeak: ["SPATIAL_SEPARATION", "DUPLICATE_SPREAD"],
  fragmentationStateSeparationPeak: ["SPATIAL_SEPARATION", "DUPLICATE_SPREAD"],
  displacementDirection: ["SPATIAL_DIRECTION"],
  motionEnergyPeak: ["MOTION_IMPULSE"],
  accelerationPeak: ["MOTION_IMPULSE"],
  recoveryFrames: ["RECOVERY_DURATION"],
  blurPeak: ["BLUR_STRENGTH"],
  exposurePeak: ["EXPOSURE_STRENGTH"],
  distortionPeak: ["DISTORTION_STRENGTH"],
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
    if (renderMagnitude <= 1e-6) return 4;
    return clamp(referenceMagnitude / renderMagnitude, 1, 4);
  }
  if (referenceMagnitude <= 1e-6) return 0.2;
  if (renderMagnitude <= 1e-6) return 1;
  return clamp(referenceMagnitude / renderMagnitude, 0.2, 1);
};

export const deriveConstructionActuationPlanV1 = (input: {
  readonly graph: ConstructionGraphV1;
  readonly comparison: FidelityComparisonV1;
}): ConstructionActuationPlanV1 => {
  const instructions: ConstructionControlInstructionV1[] = [];
  const unresolved = new Set<string>();

  for (const failure of input.comparison.metrics.filter((metric) => !metric.passed)) {
    const nodeId = input.graph.invariantCoverage[failure.invariantId]?.[0];
    const controls = CONTROL_BY_METRIC[failure.metric] ?? [];
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

export const selectDefiningActuationInstructionsV1 = (
  plan: ConstructionActuationPlanV1,
): readonly ConstructionControlInstructionV1[] =>
  plan.instructions.filter((instruction) => instruction.defining);
