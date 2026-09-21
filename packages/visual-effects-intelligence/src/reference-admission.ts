import type {
  DenseEffectEvidenceV1,
  EffectFamilyV1,
  EffectInvariantV1,
  NormalizedPointV1,
} from "./contracts.js";
import {
  classifyEffectFamilyV1,
  deriveEffectAnatomyV1,
} from "./anatomy.js";

export interface ReferenceFamilyInvariantCheckV1 {
  readonly invariantId: string;
  readonly metric: string;
  readonly comparator: EffectInvariantV1["comparator"];
  readonly target: EffectInvariantV1["target"];
  readonly tolerance: number;
  readonly observed: number | NormalizedPointV1 | null;
  readonly passed: boolean;
  readonly score: number;
  readonly diagnosis: string;
}

export interface ReferenceFamilyCandidateV1 {
  readonly schema: "editflow.reference-family-candidate.v1";
  readonly sourceId: string;
  readonly evidenceContentKey: string;
  readonly analyzerFingerprint: string;
  readonly requestedFamily: Exclude<EffectFamilyV1, "UNKNOWN">;
  readonly classifiedFamily: EffectFamilyV1;
  readonly passed: boolean;
  readonly definingCoverage: number;
  readonly weightedContractScore: number;
  readonly checks: readonly ReferenceFamilyInvariantCheckV1[];
  readonly failures: readonly string[];
  readonly evidenceRefs: readonly string[];
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const scalar = (value: number | NormalizedPointV1): number => typeof value === "number"
  ? value
  : Math.hypot(value.x, value.y);

const isNormalizedPoint = (
  value: EffectInvariantV1["target"],
): value is NormalizedPointV1 =>
  typeof value !== "number" && !Array.isArray(value) && "x" in value && "y" in value;

const targetScalar = (target: EffectInvariantV1["target"]): number | null =>
  typeof target === "number"
    ? target
    : isNormalizedPoint(target)
      ? Math.hypot(target.x, target.y)
      : null;

const directionErrorSignAgnostic = (
  target: NormalizedPointV1,
  observed: NormalizedPointV1,
): number => {
  const targetMagnitude = Math.hypot(target.x, target.y);
  const observedMagnitude = Math.hypot(observed.x, observed.y);
  if (targetMagnitude <= 1e-9 || observedMagnitude <= 1e-9) return 1;
  const cosine = clamp01(Math.abs(
    ((target.x * observed.x) + (target.y * observed.y))
      / (targetMagnitude * observedMagnitude),
  ));
  return 1 - cosine;
};

const evaluateInvariant = (
  invariant: EffectInvariantV1,
  observed: number | NormalizedPointV1 | null,
): ReferenceFamilyInvariantCheckV1 => {
  if (observed === null) {
    return {
      invariantId: invariant.invariantId,
      metric: invariant.metric,
      comparator: invariant.comparator,
      target: invariant.target,
      tolerance: invariant.tolerance,
      observed,
      passed: false,
      score: 0,
      diagnosis: invariant.metric + " is unavailable in dense reference evidence.",
    };
  }

  const observedScalar = scalar(observed);
  let passed = false;
  let score = 0;
  let boundary = "";
  if (invariant.comparator === "MIN" && typeof invariant.target === "number") {
    const floor = Math.max(0, invariant.target - invariant.tolerance);
    passed = observedScalar >= floor;
    score = floor <= 1e-9 ? 1 : clamp01(observedScalar / floor);
    boundary = "minimum " + floor.toFixed(4);
  } else if (invariant.comparator === "MAX" && typeof invariant.target === "number") {
    const ceiling = invariant.target + invariant.tolerance;
    passed = observedScalar <= ceiling;
    score = passed
      ? 1
      : clamp01(1 - ((observedScalar - ceiling) / Math.max(Math.abs(ceiling), 1e-6)));
    boundary = "maximum " + ceiling.toFixed(4);
  } else if (invariant.comparator === "RANGE" && Array.isArray(invariant.target)) {
    const low = invariant.target[0] - invariant.tolerance;
    const high = invariant.target[1] + invariant.tolerance;
    passed = observedScalar >= low && observedScalar <= high;
    const miss = observedScalar < low ? low - observedScalar
      : observedScalar > high ? observedScalar - high : 0;
    score = clamp01(1 - (miss / Math.max(Math.abs(high - low), 1e-6)));
    boundary = "range " + low.toFixed(4) + ".." + high.toFixed(4);
  } else if (
    invariant.comparator === "DIRECTION"
    && isNormalizedPoint(invariant.target)
    && typeof observed !== "number"
  ) {
    const error = directionErrorSignAgnostic(invariant.target, observed);
    passed = error <= invariant.tolerance;
    score = clamp01(1 - (error / Math.max(invariant.tolerance, 1e-6)));
    boundary = "axis error <= " + invariant.tolerance.toFixed(4);
  } else if (invariant.comparator === "PHASE") {
    const target = targetScalar(invariant.target);
    const error = target === null ? Number.POSITIVE_INFINITY : Math.abs(observedScalar - target);
    passed = error <= invariant.tolerance;
    score = Number.isFinite(error)
      ? clamp01(1 - (error / Math.max(invariant.tolerance, 1e-6)))
      : 0;
    boundary = target === null
      ? "numeric phase target required"
      : "phase " + target.toFixed(4) + " +/- " + invariant.tolerance.toFixed(4);
  }

  return {
    invariantId: invariant.invariantId,
    metric: invariant.metric,
    comparator: invariant.comparator,
    target: invariant.target,
    tolerance: invariant.tolerance,
    observed,
    passed,
    score,
    diagnosis: passed
      ? invariant.metric + " satisfies family admission (" + boundary + ")."
      : invariant.metric + "=" + observedScalar.toFixed(4)
        + " fails family admission (" + boundary + "). " + invariant.rationale,
  };
};

export const evaluateReferenceFamilyCandidateV1 = (
  evidence: DenseEffectEvidenceV1,
  family: Exclude<EffectFamilyV1, "UNKNOWN">,
): ReferenceFamilyCandidateV1 => {
  if (evidence.sourceKind !== "REFERENCE") {
    throw new TypeError("Reference-family admission requires REFERENCE dense evidence.");
  }
  const anatomy = deriveEffectAnatomyV1(evidence, family);
  const checks = anatomy.dna.definingInvariants.map((invariant) =>
    evaluateInvariant(invariant, anatomy.observedMetrics[invariant.metric] ?? null));
  const passedChecks = checks.filter((check) => check.passed).length;
  const definingCoverage = checks.length === 0 ? 0 : passedChecks / checks.length;
  const totalWeight = anatomy.dna.definingInvariants.reduce(
    (sum, invariant) => sum + invariant.weight,
    0,
  );
  const weightedContractScore = totalWeight <= 1e-9
    ? 0
    : anatomy.dna.definingInvariants.reduce((sum, invariant, index) =>
      sum + ((checks[index]?.score ?? 0) * invariant.weight), 0) / totalWeight;
  const failures = checks.filter((check) => !check.passed).map((check) => check.diagnosis);

  return {
    schema: "editflow.reference-family-candidate.v1",
    sourceId: evidence.sourceId,
    evidenceContentKey: evidence.contentKey,
    analyzerFingerprint: evidence.analyzerFingerprint,
    requestedFamily: family,
    classifiedFamily: classifyEffectFamilyV1(evidence),
    passed: definingCoverage === 1,
    definingCoverage,
    weightedContractScore,
    checks,
    failures,
    evidenceRefs: evidence.evidenceRefs,
  };
};
