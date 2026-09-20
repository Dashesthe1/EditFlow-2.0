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
import {
  resolveFragmentationEventMetricsV1,
  scoreFragmentationEventLocalizationV1,
} from "./dense-evidence.js";
import { measureHalfPeakTemporalProfileV1 } from "./temporal-profile.js";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const measurementProvenanceKey = (evidence: DenseEffectEvidenceV1): string => {
  const explicit = typeof evidence.analyzerFingerprint === "string"
    ? evidence.analyzerFingerprint.trim() : "";
  if (explicit.length > 0) return `fingerprint:${explicit}`;
  // Retained M6.1 real-pixel evidence predates the explicit analyzerFingerprint
  // field. Preserve that evidence only when it carries both immutable probe
  // content and an exact declared algorithm family; new evidence must use the
  // explicit implementation fingerprint produced by analyzeDenseEffectEvidenceV1.
  const probeRef = evidence.evidenceRefs.find((ref) => ref.startsWith("probe-json:sha256:"));
  const algorithmRefs = evidence.evidenceRefs
    .filter((ref) => ref.startsWith("algorithm:"))
    .sort();
  if (probeRef !== undefined && algorithmRefs.length > 0) {
    return `retained-legacy:${algorithmRefs.join("|")}`;
  }
  return "";
};

const maxFrameMetric = (evidence: DenseEffectEvidenceV1, metric: string): number => {
  const values = evidence.frames.map((frame) => (frame as unknown as Readonly<Record<string, unknown>>)[metric])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length === 0 ? 0 : Math.max(...values);
};

const activeDimensionCount = (evidence: DenseEffectEvidenceV1): number => {
  const s = evidence.summary;
  return [
    s.displacementPeak > 0.04 || (s.stateSeparationPeak ?? 0) > 0.025 || s.scaleRange > 0.04 || s.rotationRange > 3,
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
  invariantId: string,
  metric: string,
): number | NormalizedPointV1 => {
  const fragmentation = resolveFragmentationEventMetricsV1(evidence);
  if (invariantId.startsWith("shutter.")) {
    if (metric === "temporalStateCountPeak") return fragmentation.temporalStateCountPeak;
    if (metric === "overlapDensityPeak") return fragmentation.overlapDensityPeak;
  }
  if (metric === "fragmentationTemporalStateCountPeak") {
    return fragmentation.temporalStateCountPeak;
  }
  if (metric === "fragmentationOverlapDensityPeak") {
    return fragmentation.overlapDensityPeak;
  }
  if (metric === "fragmentationStateSeparationPeak") {
    return fragmentation.stateSeparationPeak;
  }
  const summary = evidence.summary as unknown as Readonly<Record<string, unknown>>;
  const summaryValue = summary[metric];
  if (typeof summaryValue === "number") return summaryValue;
  if (metric === "displacementDirection") return evidence.summary.displacementDirection;
  if (metric === "maskCoveragePeak") return maxFrameMetric(evidence, "maskCoverage");
  if (metric === "chromaticSeparationPeak") return maxFrameMetric(evidence, "chromaticSeparation");
  if (metric === "stateSeparationPeak") return maxFrameMetric(evidence, "stateSeparation");
  if (metric === "fragmentationCoherencePeak") return fragmentation.peak;
  if (metric === "fragmentationEventLocalization") {
    return scoreFragmentationEventLocalizationV1(evidence, fragmentation.phase);
  }
  if (metric === "fragmentationCoherencePhase") return fragmentation.phase;
  if (metric === "blurHalfPeakAttackMs") {
    return measureHalfPeakTemporalProfileV1(evidence, "blurStrength").attackMs;
  }
  if (metric === "blurHalfPeakRecoveryMs") {
    return measureHalfPeakTemporalProfileV1(evidence, "blurStrength").recoveryMs;
  }
  if (metric === "activeDimensionCount") return activeDimensionCount(evidence);
  return maxFrameMetric(evidence, metric);
};

const metricValuesForComparison = (
  reference: DenseEffectEvidenceV1,
  render: DenseEffectEvidenceV1,
  invariant: EffectInvariantV1,
): Readonly<{
  referenceValue: number | NormalizedPointV1;
  renderValue: number | NormalizedPointV1;
}> => {
  const referenceValue = metricValue(reference, invariant.invariantId, invariant.metric);
  let renderValue = metricValue(render, invariant.invariantId, invariant.metric);
  if (invariant.metric === "recoveryFrames"
    && typeof referenceValue === "number" && typeof renderValue === "number") {
    const referenceInterval = reference.summary.frameIntervalMs;
    const renderInterval = render.summary.frameIntervalMs;
    if (Number.isFinite(referenceInterval) && referenceInterval > 0
      && Number.isFinite(renderInterval) && renderInterval > 0) {
      // Recovery is a duration, not a literal frame count. Express the render in
      // reference-frame equivalents so semantic comparison remains stable across FPS.
      renderValue *= renderInterval / referenceInterval;
    }
  }
  return { referenceValue, renderValue };
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
  let error = 1;
  let passed = false;
  if (invariant.comparator === "DIRECTION") {
    const ref = typeof referenceValue === "number" ? { x: referenceValue, y: 0 } : referenceValue;
    const render = typeof renderValue === "number" ? { x: renderValue, y: 0 } : renderValue;
    error = directionError(ref, render);
    passed = error <= invariant.tolerance;
  } else if (invariant.comparator === "MIN") {
    const referenceFloor = referenceScalar * 0.8;
    const contractFloor = typeof target === "number" ? target : referenceFloor;
    const floor = Math.min(referenceScalar, Math.max(contractFloor, referenceFloor));
    const allowedFloor = Math.max(0, floor - invariant.tolerance);
    const deficit = Math.max(0, allowedFloor - renderScalar);
    passed = deficit <= 1e-9;
    error = clamp01(deficit / Math.max(Math.abs(referenceScalar), floor, 1e-6));
  } else if (invariant.comparator === "MAX") {
    const referenceCeiling = referenceScalar * 1.25;
    const contractCeiling = typeof target === "number" ? target : referenceCeiling;
    const ceiling = Math.max(referenceScalar, Math.min(contractCeiling, referenceCeiling));
    const allowedCeiling = ceiling + invariant.tolerance;
    const excess = Math.max(0, renderScalar - allowedCeiling);
    passed = excess <= 1e-9;
    error = clamp01(excess / Math.max(Math.abs(referenceScalar), ceiling, 1e-6));
  } else if (invariant.comparator === "RANGE" && Array.isArray(target)) {
    const [contractLow, contractHigh] = target;
    // RANGE expresses the valid family envelope, but M6 fidelity is reference-relative.
    // Intersect the contract with the same 80%-125% reference window used by MIN/MAX,
    // then apply the invariant tolerance. This prevents a family-valid but visibly
    // over/under-driven construction from being certified as reference faithful.
    const referenceLow = referenceScalar * 0.8 - invariant.tolerance;
    const referenceHigh = referenceScalar * 1.25 + invariant.tolerance;
    const low = Math.max(contractLow - invariant.tolerance, referenceLow);
    const high = Math.min(contractHigh + invariant.tolerance, referenceHigh);
    const miss = renderScalar < low ? low - renderScalar
      : renderScalar > high ? renderScalar - high : 0;
    passed = miss <= 1e-9;
    error = clamp01(miss / Math.max(Math.abs(referenceScalar), Math.abs(high - low), 1e-6));
  } else {
    const delta = Math.abs(renderScalar - referenceScalar);
    passed = delta <= invariant.tolerance;
    error = clamp01(delta / Math.max(Math.abs(referenceScalar), invariant.tolerance, 0.1));
  }
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
  const referenceProvenance = measurementProvenanceKey(input.reference);
  const renderProvenance = measurementProvenanceKey(input.render);
  if (referenceProvenance.length === 0 || renderProvenance.length === 0) {
    throw new TypeError("Fidelity comparison requires analyzer provenance on both reference and render evidence.");
  }
  if (referenceProvenance !== renderProvenance) {
    throw new TypeError(
      "Fidelity comparison refuses evidence produced by different analyzer implementations.",
    );
  }
  const alignment = input.alignment ?? "SEMANTIC";
  if (alignment === "FRAME" && input.reference.frames.length !== input.render.frames.length) {
    throw new TypeError("Frame-aligned fidelity comparison requires equal frame counts.");
  }
  const invariants = [...input.dna.definingInvariants, ...input.dna.optionalInvariants];
  const metrics = invariants.map((item) => {
    const values = metricValuesForComparison(input.reference, input.render, item);
    return compareInvariant(item, values.referenceValue, values.renderValue);
  });
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
