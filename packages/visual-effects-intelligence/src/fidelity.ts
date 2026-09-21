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

const baselineDeltaMetrics = new Set([
  "motionEnergyPeak",
  "accelerationPeak",
]);

const baselineAlignedVelocityMetric = (
  render: DenseEffectEvidenceV1,
  baseline: DenseEffectEvidenceV1,
  metric: string,
): number | null => {
  const residual = render.frames.map((frame, index) => {
    const baselineFrame = baseline.frames[index];
    if (baselineFrame === undefined) return Number.NaN;
    return frame.motionEnergy - baselineFrame.motionEnergy;
  });
  if (residual.some((value) => !Number.isFinite(value))) return null;
  if (metric === "motionEnergyPeak") {
    return residual.length === 0 ? 0 : Math.max(...residual.map((value) => Math.abs(value)));
  }
  if (metric === "accelerationPeak") {
    let peak = 0;
    for (let index = 2; index < residual.length; index += 1) {
      const a = residual[index - 2]!;
      const b = residual[index - 1]!;
      const c = residual[index]!;
      peak = Math.max(peak, Math.abs((c - b) - (b - a)));
    }
    return peak;
  }
  return null;
};

const metricValuesForComparison = (
  reference: DenseEffectEvidenceV1,
  render: DenseEffectEvidenceV1,
  invariant: EffectInvariantV1,
  alignment: "FRAME" | "SEMANTIC",
  baseline?: DenseEffectEvidenceV1,
): Readonly<{
  referenceValue: number | NormalizedPointV1;
  renderValue: number | NormalizedPointV1;
  baselineValue?: number | NormalizedPointV1;
  rawRenderValue?: number | NormalizedPointV1;
  comparisonBasis: "ABSOLUTE" | "BASELINE_DELTA" | "BASELINE_ALIGNED_DELTA";
}> => {
  if (invariant.metric === "blurHalfPeakAttackMs"
    || invariant.metric === "blurHalfPeakRecoveryMs") {
    const referenceProfile = measureHalfPeakTemporalProfileV1(reference, "blurStrength");
    const preferredRenderPhase = alignment === "SEMANTIC" && reference.frames.length > 1
      ? referenceProfile.peakIndex / (reference.frames.length - 1)
      : undefined;
    const renderProfile = measureHalfPeakTemporalProfileV1(
      render,
      "blurStrength",
      preferredRenderPhase,
      baseline,
    );
    const rawRenderProfile = baseline === undefined
      ? null
      : measureHalfPeakTemporalProfileV1(render, "blurStrength", preferredRenderPhase);
    const baselineProfile = baseline === undefined
      ? null
      : measureHalfPeakTemporalProfileV1(baseline, "blurStrength", preferredRenderPhase);
    const attack = invariant.metric === "blurHalfPeakAttackMs";
    return {
      referenceValue: attack ? referenceProfile.attackMs : referenceProfile.recoveryMs,
      renderValue: attack ? renderProfile.attackMs : renderProfile.recoveryMs,
      ...(baselineProfile === null || rawRenderProfile === null
        ? {}
        : {
            baselineValue: attack ? baselineProfile.attackMs : baselineProfile.recoveryMs,
            rawRenderValue: attack ? rawRenderProfile.attackMs : rawRenderProfile.recoveryMs,
          }),
      comparisonBasis: baseline === undefined ? "ABSOLUTE" : "BASELINE_ALIGNED_DELTA",
    };
  }
  const referenceValue = metricValue(reference, invariant.invariantId, invariant.metric);
  let renderValue = metricValue(render, invariant.invariantId, invariant.metric);
  if (
    baseline !== undefined
    && invariant.invariantId.startsWith("velocity.")
    && baselineDeltaMetrics.has(invariant.metric)
    && typeof renderValue === "number"
  ) {
    const baselineValue = metricValue(baseline, invariant.invariantId, invariant.metric);
    const alignedDelta = baselineAlignedVelocityMetric(render, baseline, invariant.metric);
    if (typeof baselineValue === "number" && alignedDelta !== null) {
      const rawRenderValue = renderValue;
      renderValue = alignedDelta;
      return {
        referenceValue,
        renderValue,
        baselineValue,
        rawRenderValue,
        comparisonBasis: "BASELINE_ALIGNED_DELTA",
      };
    }
  }
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
  return {
    referenceValue,
    renderValue,
    comparisonBasis: "ABSOLUTE",
  };
};

const scalar = (value: number | NormalizedPointV1): number =>
  typeof value === "number" ? value : Math.hypot(value.x, value.y);

const referenceRelativeTolerance = (nominal: number, referenceScalar: number): number => {
  if (nominal <= 0 || referenceScalar <= 1e-9) return nominal;
  // Family tolerances are recognition-scale defaults. When a real professional
  // reference measures far below that synthetic scale, a larger absolute
  // tolerance can erase the defining signal entirely (for example, allowing
  // zero motion to match a small but clearly localized velocity impulse).
  // Only cap tolerances that are at least half of the observed signal, keeping
  // ordinary family tolerances unchanged while preserving non-zero evidence.
  if (nominal < referenceScalar * 0.5) return nominal;
  return Math.min(nominal, Math.max(referenceScalar * 0.25, 1e-6));
};

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
  referenceMagnitudeOnly = false,
): FidelityMetricResultV1 => {
  const referenceScalar = scalar(referenceValue);
  const renderScalar = scalar(renderValue);
  const target = invariant.target;
  const tolerance = referenceRelativeTolerance(invariant.tolerance, referenceScalar);
  let error = 1;
  let passed = false;
  if (referenceMagnitudeOnly) {
    const delta = Math.abs(renderScalar - referenceScalar);
    passed = delta <= tolerance;
    error = clamp01(delta / Math.max(Math.abs(referenceScalar), tolerance, 1e-6));
  } else if (invariant.comparator === "DIRECTION") {
    const ref = typeof referenceValue === "number" ? { x: referenceValue, y: 0 } : referenceValue;
    const render = typeof renderValue === "number" ? { x: renderValue, y: 0 } : renderValue;
    error = directionError(ref, render);
    passed = error <= invariant.tolerance;
  } else if (invariant.comparator === "MIN") {
    const referenceFloor = referenceScalar * 0.8;
    const contractFloor = typeof target === "number" ? target : referenceFloor;
    const floor = Math.min(referenceScalar, Math.max(contractFloor, referenceFloor));
    const allowedFloor = Math.max(0, floor - tolerance);
    const deficit = Math.max(0, allowedFloor - renderScalar);
    passed = deficit <= 1e-9;
    error = clamp01(deficit / Math.max(Math.abs(referenceScalar), floor, 1e-6));
  } else if (invariant.comparator === "MAX") {
    const referenceCeiling = referenceScalar * 1.25;
    const contractCeiling = typeof target === "number" ? target : referenceCeiling;
    const ceiling = Math.max(referenceScalar, Math.min(contractCeiling, referenceCeiling));
    const allowedCeiling = ceiling + tolerance;
    const excess = Math.max(0, renderScalar - allowedCeiling);
    passed = excess <= 1e-9;
    error = clamp01(excess / Math.max(Math.abs(referenceScalar), ceiling, 1e-6));
  } else if (invariant.comparator === "RANGE" && Array.isArray(target)) {
    const [contractLow, contractHigh] = target;
    // RANGE expresses the valid family envelope, but M6 fidelity is reference-relative.
    // Intersect the contract with the same 80%-125% reference window used by MIN/MAX,
    // then apply the invariant tolerance. This prevents a family-valid but visibly
    // over/under-driven construction from being certified as reference faithful.
    const referenceLow = referenceScalar * 0.8 - tolerance;
    const referenceHigh = referenceScalar * 1.25 + tolerance;
    const low = Math.max(contractLow - tolerance, referenceLow);
    const high = Math.min(contractHigh + tolerance, referenceHigh);
    const miss = renderScalar < low ? low - renderScalar
      : renderScalar > high ? renderScalar - high : 0;
    passed = miss <= 1e-9;
    error = clamp01(miss / Math.max(Math.abs(referenceScalar), Math.abs(high - low), 1e-6));
  } else {
    const delta = Math.abs(renderScalar - referenceScalar);
    passed = delta <= tolerance;
    error = clamp01(delta / Math.max(Math.abs(referenceScalar), tolerance, 0.1));
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
  /** Optional no-effect render of the same target-footage window for causal transfer comparison. */
  readonly baseline?: DenseEffectEvidenceV1;
  readonly dna: TransitionDnaV1;
  readonly alignment?: "FRAME" | "SEMANTIC";
  readonly minimumWeightedFidelity?: number;
}): FidelityComparisonV1 => {
  const referenceProvenance = measurementProvenanceKey(input.reference);
  const renderProvenance = measurementProvenanceKey(input.render);
  const baselineProvenance = input.baseline === undefined
    ? null : measurementProvenanceKey(input.baseline);
  if (
    referenceProvenance.length === 0
    || renderProvenance.length === 0
    || baselineProvenance === ""
  ) {
    throw new TypeError(
      "Fidelity comparison requires analyzer provenance on reference, render, and any supplied baseline evidence.",
    );
  }
  if (
    referenceProvenance !== renderProvenance
    || (baselineProvenance !== null && baselineProvenance !== renderProvenance)
  ) {
    throw new TypeError(
      "Fidelity comparison refuses evidence produced by different analyzer implementations.",
    );
  }
  if (input.baseline !== undefined) {
    if (input.render.sourceKind !== "RENDER" || input.baseline.sourceKind !== "RENDER") {
      throw new TypeError("Baseline-aware fidelity comparison requires RENDER target and baseline evidence.");
    }
    if (input.baseline.frames.length !== input.render.frames.length) {
      throw new TypeError(
        "Baseline-aware fidelity comparison requires equal target and baseline frame counts.",
      );
    }
    if (input.baseline.settingsFingerprint !== input.render.settingsFingerprint) {
      throw new TypeError(
        "Baseline-aware fidelity comparison requires identical target and baseline evidence settings.",
      );
    }
    if (input.baseline.frames.some((frame, index) =>
      Math.abs(frame.timeMs - input.render.frames[index]!.timeMs) > 1e-3)) {
      throw new TypeError(
        "Baseline-aware fidelity comparison requires time-aligned target and baseline frames.",
      );
    }
  }
  const alignment = input.alignment ?? "SEMANTIC";
  if (alignment === "FRAME" && input.reference.frames.length !== input.render.frames.length) {
    throw new TypeError("Frame-aligned fidelity comparison requires equal frame counts.");
  }
  const invariants = [...input.dna.definingInvariants, ...input.dna.optionalInvariants];
  const metrics = invariants.map((item) => {
    const values = metricValuesForComparison(
      input.reference,
      input.render,
      item,
      alignment,
      input.baseline,
    );
    const compared = compareInvariant(
      item,
      values.referenceValue,
      values.renderValue,
      values.comparisonBasis === "BASELINE_ALIGNED_DELTA",
    );
    if (
      (values.comparisonBasis === "BASELINE_DELTA"
        || values.comparisonBasis === "BASELINE_ALIGNED_DELTA")
      && values.baselineValue !== undefined
      && values.rawRenderValue !== undefined
    ) {
      const baselineScalar = scalar(values.baselineValue);
      const rawRenderScalar = scalar(values.rawRenderValue);
      const effectScalar = scalar(values.renderValue);
      const referenceScalar = scalar(values.referenceValue);
      const causalDirection = effectScalar < referenceScalar ? "under-driven" : "over-driven";
      return {
        ...compared,
        baselineValue: values.baselineValue,
        rawRenderValue: values.rawRenderValue,
        comparisonBasis: values.comparisonBasis,
        diagnosis: compared.passed
          ? item.metric + " aligned causal delta preserves the defining reference behavior: reference "
            + referenceScalar.toFixed(3) + ", baseline peak " + baselineScalar.toFixed(3)
            + ", edited peak " + rawRenderScalar.toFixed(3) + ", causal peak " + effectScalar.toFixed(3) + "."
          : item.metric + " aligned causal delta is " + causalDirection + ": reference "
            + referenceScalar.toFixed(3) + ", baseline peak " + baselineScalar.toFixed(3)
            + ", edited peak " + rawRenderScalar.toFixed(3) + ", causal peak " + effectScalar.toFixed(3)
            + ". " + item.rationale,
      } satisfies FidelityMetricResultV1;
    }
    return {
      ...compared,
      comparisonBasis: values.comparisonBasis,
    } satisfies FidelityMetricResultV1;
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
    ...(input.baseline === undefined
      ? {} : { baselineEvidenceKey: input.baseline.contentKey }),
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
