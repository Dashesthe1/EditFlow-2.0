import type {
  ConstructionCompilationV1,
  DenseEffectEvidenceV1,
  EffectInvariantV1,
  FidelityComparisonV1,
  FidelityGateResultV1,
  FidelityMetricResultV1,
  NormalizedPointV1,
  TransitionDnaV1,
} from "./contracts.js";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const maxFrameMetric = (evidence: DenseEffectEvidenceV1, metric: string): number => {
  const values = evidence.frames.map((frame) => (frame as unknown as Readonly<Record<string, unknown>>)[metric])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length === 0 ? 0 : Math.max(...values);
};

const activeDimensionCount = (evidence: DenseEffectEvidenceV1): number => {
  const s = evidence.summary;
  return [
    s.displacementPeak > 0.04 || s.scaleRange > 0.04 || s.rotationRange > 3,
    s.temporalStateCountPeak > 1 || s.temporalPersistence > 0.25,
    s.subjectSeparationPeak > 0.15 || maxFrameMetric(evidence, "maskCoverage") > 0.06,
    s.blurPeak > 0.15 || s.exposurePeak > 0.58 || maxFrameMetric(evidence, "chromaticSeparation") > 0.1,
    s.distortionPeak > 0.15,
    s.overlapDensityPeak > 0.12 || s.occlusionPeak > 0.15,
    s.motionEnergyPeak > 0.1 || s.accelerationPeak > 0.025,
  ].filter(Boolean).length;
};

const metricValue = (
  evidence: DenseEffectEvidenceV1,
  metric: string,
): number | NormalizedPointV1 => {
  const summary = evidence.summary as unknown as Readonly<Record<string, unknown>>;
  const summaryValue = summary[metric];
  if (typeof summaryValue === "number") return summaryValue;
  if (metric === "displacementDirection") return evidence.summary.displacementDirection;
  if (metric === "maskCoveragePeak") return maxFrameMetric(evidence, "maskCoverage");
  if (metric === "chromaticSeparationPeak") return maxFrameMetric(evidence, "chromaticSeparation");
  if (metric === "activeDimensionCount") return activeDimensionCount(evidence);
  return maxFrameMetric(evidence, metric);
};

const scalar = (value: number | NormalizedPointV1): number =>
  typeof value === "number" ? value : Math.hypot(value.x, value.y);

const directionError = (a: NormalizedPointV1, b: NormalizedPointV1): number => {
  const am = Math.hypot(a.x, a.y);
  const bm = Math.hypot(b.x, b.y);
  if (am < 1e-6 || bm < 1e-6) return am < 1e-6 && bm < 1e-6 ? 0 : 1;
  const cosine = Math.min(1, Math.max(-1, (a.x * b.x + a.y * b.y) / (am * bm)));
  return Math.acos(cosine) / Math.PI;
};

const compareInvariant = (
  invariant: EffectInvariantV1,
  referenceValue: number | NormalizedPointV1,
  renderValue: number | NormalizedPointV1,
): FidelityMetricResultV1 => {
  const referenceScalar = scalar(referenceValue);
  const renderScalar = scalar(renderValue);
  const target = invariant.target;
  let error: number;
  if (invariant.comparator === "DIRECTION") {
    const ref = typeof referenceValue === "number" ? { x: referenceValue, y: 0 } : referenceValue;
    const render = typeof renderValue === "number" ? { x: renderValue, y: 0 } : renderValue;
    error = directionError(ref, render);
  } else if (invariant.comparator === "MIN") {
    const floor = typeof target === "number" ? Math.max(target, referenceScalar * 0.8) : referenceScalar * 0.8;
    error = renderScalar >= floor - invariant.tolerance
      ? 0 : clamp01((floor - renderScalar) / Math.max(floor, 1e-6));
  } else if (invariant.comparator === "MAX") {
    const ceiling = typeof target === "number" ? Math.min(target, Math.max(referenceScalar * 1.25, target)) : referenceScalar * 1.25;
    error = renderScalar <= ceiling + invariant.tolerance
      ? 0 : clamp01((renderScalar - ceiling) / Math.max(ceiling, 1e-6));
  } else if (invariant.comparator === "RANGE" && Array.isArray(target)) {
    const [low, high] = target;
    error = renderScalar < low - invariant.tolerance
      ? clamp01((low - renderScalar) / Math.max(low, 1e-6))
      : renderScalar > high + invariant.tolerance
        ? clamp01((renderScalar - high) / Math.max(high, 1e-6)) : 0;
  } else {
    error = clamp01(Math.abs(renderScalar - referenceScalar)
      / Math.max(Math.abs(referenceScalar), invariant.tolerance, 1e-6));
  }
  const passed = error <= invariant.tolerance;
  const direction = renderScalar < referenceScalar ? "under-driven" : "over-driven";
  return {
    invariantId: invariant.invariantId,
    dimension: invariant.dimension,
    metric: invariant.metric,
    referenceValue,
    renderValue,
    normalizedError: error,
    passed,
    defining: invariant.defining,
    weight: invariant.weight,
    diagnosis: passed
      ? `${invariant.metric} preserves the defining reference behavior.`
      : `${invariant.metric} is ${direction}: reference ${referenceScalar.toFixed(3)}, render ${renderScalar.toFixed(3)}. ${invariant.rationale}`,
  };
};

export const compareSemanticVisualFidelityV1 = (input: {
  readonly reference: DenseEffectEvidenceV1;
  readonly render: DenseEffectEvidenceV1;
  readonly dna: TransitionDnaV1;
  readonly alignment?: "FRAME" | "SEMANTIC";
  readonly minimumWeightedFidelity?: number;
}): FidelityComparisonV1 => {
  const alignment = input.alignment ?? "SEMANTIC";
  if (alignment === "FRAME" && input.reference.frames.length !== input.render.frames.length) {
    throw new TypeError("Frame-aligned fidelity comparison requires equal frame counts.");
  }
  const invariants = [...input.dna.definingInvariants, ...input.dna.optionalInvariants];
  const metrics = invariants.map((item) => compareInvariant(
    item,
    metricValue(input.reference, item.metric),
    metricValue(input.render, item.metric),
  ));
  const defining = metrics.filter((metric) => metric.defining);
  const definingCoverage = defining.length === 0
    ? 0 : defining.filter((metric) => metric.passed).length / defining.length;
  const totalWeight = metrics.reduce((sum, metric) => sum + metric.weight, 0);
  const weightedFidelity = totalWeight === 0 ? 0 : metrics.reduce((sum, metric) =>
    sum + ((1 - metric.normalizedError) * metric.weight), 0) / totalWeight;
  const passed = definingCoverage === 1 && weightedFidelity >= (input.minimumWeightedFidelity ?? 0.82);
  return {
    schema: "editflow.semantic-fidelity-comparison.v1",
    family: input.dna.family,
    alignment,
    metrics,
    definingCoverage,
    weightedFidelity,
    passed,
    diagnoses: metrics.filter((metric) => !metric.passed).map((metric) => metric.diagnosis),
    referenceEvidenceKey: input.reference.contentKey,
    renderEvidenceKey: input.render.contentKey,
  };
};

export const evaluateProfessionalFidelityGateV1 = (input: {
  readonly comparison: FidelityComparisonV1;
  readonly compilation: ConstructionCompilationV1;
  readonly synthesisPossible: boolean;
}): FidelityGateResultV1 => {
  const definingMetrics = input.comparison.metrics.filter((metric) => metric.defining);
  const underDrivenInvariantIds = definingMetrics
    .filter((metric) => !metric.passed)
    .map((metric) => metric.invariantId);
  const missingDefiningInvariantIds = [...new Set([
    ...input.compilation.graph.missingInvariantIds,
    ...definingMetrics.filter((metric) => scalar(metric.renderValue) <= 1e-6).map((metric) => metric.invariantId),
  ])];
  const optionalPasses = input.comparison.metrics.filter((metric) => !metric.defining && metric.passed).length;
  const weakerSubstitutionDetected = underDrivenInvariantIds.length > 0 && optionalPasses > 0;
  const reasons: string[] = [];
  if (input.compilation.capabilityGaps.length > 0) {
    reasons.push(`Required capability gaps: ${input.compilation.capabilityGaps.join(", ")}.`);
  }
  if (missingDefiningInvariantIds.length > 0) {
    reasons.push(`Missing defining behavior: ${missingDefiningInvariantIds.join(", ")}.`);
  }
  if (underDrivenInvariantIds.length > 0) {
    reasons.push(`Defining behavior failed rendered comparison: ${underDrivenInvariantIds.join(", ")}.`);
  }
  if (weakerSubstitutionDetected) {
    reasons.push("Optional decoration is present while defining behavior is absent or materially under-driven.");
  }
  if (input.comparison.passed && input.compilation.definingCoverageComplete
    && input.compilation.capabilityGaps.length === 0) {
    return {
      schema: "editflow.professional-fidelity-gate.v1",
      outcome: "PASS",
      certified: true,
      missingDefiningInvariantIds,
      underDrivenInvariantIds,
      weakerSubstitutionDetected: false,
      reasons: ["Every defining invariant is covered by construction and passes rendered semantic comparison."],
    };
  }
  const outcome = input.compilation.capabilityGaps.length > 0
    ? (input.synthesisPossible ? "SYNTHESIS_REQUIRED" : "CAPABILITY_GAP")
    : "CORRECTION_REQUIRED";
  return {
    schema: "editflow.professional-fidelity-gate.v1",
    outcome,
    certified: false,
    missingDefiningInvariantIds,
    underDrivenInvariantIds,
    weakerSubstitutionDetected,
    reasons,
  };
};
