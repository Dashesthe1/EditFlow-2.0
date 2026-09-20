export type UnknownSynthesisProvenanceV1 =
  | "LEARNED_SKILL_DISABLED"
  | "UNKNOWN_DECOMPOSITION_DIRECT";

export interface UnknownEffectSynthesisProofCaseV1 {
  readonly caseId: string;
  readonly proofRef: string;
  readonly proofSha256: string;
  readonly referenceContentKey: string;
  readonly family: "UNKNOWN";
  readonly provenance: UnknownSynthesisProvenanceV1;
  readonly behaviorFirst: boolean;
  readonly namedEffectFallbackUsed: boolean;
  readonly finalCertified: boolean;
  readonly finalDefiningCoverage: number;
  readonly finalWeightedFidelity: number;
  readonly degradedOrUnderDrivenRejected: boolean;
  readonly renderedOutputVerified: boolean;
  readonly realAeTransactionCommitted: boolean;
  readonly automaticCorrectionObserved: boolean;
}

export interface UnknownEffectSynthesisMilestoneResultV1 {
  readonly schema: "editflow.m6.unknown-effect-synthesis-milestone-result.v1";
  readonly milestone: "M6.8";
  readonly passed: boolean;
  readonly caseCount: number;
  readonly distinctReferenceCount: number;
  readonly renderedCaseCount: number;
  readonly realAeCaseCount: number;
  readonly automaticCorrectionCaseCount: number;
  readonly failures: readonly string[];
}

const SHA256_V1 = /^[a-f0-9]{64}$/i;
const isUnitInterval = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= 1;

export const evaluateUnknownEffectSynthesisMilestoneV1 = (
  cases: readonly UnknownEffectSynthesisProofCaseV1[],
): UnknownEffectSynthesisMilestoneResultV1 => {
  const failures: string[] = [];
  if (cases.length < 3) failures.push("M6.8:REQUIRES_THREE_UNKNOWN_EFFECT_CASES");

  const seenCaseIds = new Set<string>();
  const references = new Set<string>();
  for (const item of cases) {
    const prefix = item.caseId.trim().length > 0 ? item.caseId : "M6.8:UNNAMED_CASE";
    if (seenCaseIds.has(item.caseId)) failures.push(`${prefix}:DUPLICATE_CASE_ID`);
    seenCaseIds.add(item.caseId);
    if (!SHA256_V1.test(item.referenceContentKey)) {
      failures.push(`${prefix}:REFERENCE_CONTENT_KEY_INVALID`);
    } else {
      references.add(item.referenceContentKey.toLowerCase());
    }
    if (!SHA256_V1.test(item.proofSha256)) failures.push(`${prefix}:PROOF_DIGEST_INVALID`);
    if (item.proofRef.trim().length === 0) failures.push(`${prefix}:PROOF_REF_MISSING`);
    if (item.family !== "UNKNOWN") failures.push(`${prefix}:NOT_UNKNOWN_FAMILY`);
    if (!item.behaviorFirst) failures.push(`${prefix}:NOT_BEHAVIOR_FIRST`);
    if (item.namedEffectFallbackUsed) failures.push(`${prefix}:NAMED_EFFECT_FALLBACK_USED`);
    if (item.provenance !== "LEARNED_SKILL_DISABLED"
      && item.provenance !== "UNKNOWN_DECOMPOSITION_DIRECT") {
      failures.push(`${prefix}:UNKNOWN_PROVENANCE`);
    }
    if (!item.finalCertified) failures.push(`${prefix}:FINAL_RENDER_NOT_CERTIFIED`);
    if (!isUnitInterval(item.finalDefiningCoverage)
      || item.finalDefiningCoverage < 1 - 1e-9) {
      failures.push(`${prefix}:DEFINING_COVERAGE_INCOMPLETE`);
    }
    if (!isUnitInterval(item.finalWeightedFidelity)
      || item.finalWeightedFidelity < 0.9) {
      failures.push(`${prefix}:FINAL_FIDELITY_BELOW_M6_8_FLOOR`);
    }
    if (!item.degradedOrUnderDrivenRejected) {
      failures.push(`${prefix}:NO_REJECTED_DEGRADED_OR_UNDER_DRIVEN_STATE`);
    }
    if (!item.renderedOutputVerified) failures.push(`${prefix}:RENDERED_OUTPUT_NOT_VERIFIED`);
  }

  if (references.size < 3) failures.push("M6.8:REFERENCES_NOT_DISTINCT");
  const renderedCaseCount = cases.filter((item) => item.renderedOutputVerified).length;
  const realAeCaseCount = cases.filter((item) => item.realAeTransactionCommitted).length;
  const automaticCorrectionCaseCount = cases.filter(
    (item) => item.automaticCorrectionObserved,
  ).length;
  // M6.8 itself is a synthesis gate, but it must remain connected to the real
  // production path: at least one case must prove native AE commit, and at least
  // one must prove bounded correction rather than a hand-selected final render.
  if (realAeCaseCount < 1) failures.push("M6.8:NO_REAL_AE_COMMITTED_CASE");
  if (automaticCorrectionCaseCount < 1) {
    failures.push("M6.8:NO_AUTOMATIC_CORRECTION_CASE");
  }

  return {
    schema: "editflow.m6.unknown-effect-synthesis-milestone-result.v1",
    milestone: "M6.8",
    passed: failures.length === 0,
    caseCount: cases.length,
    distinctReferenceCount: references.size,
    renderedCaseCount,
    realAeCaseCount,
    automaticCorrectionCaseCount,
    failures: [...new Set(failures)],
  };
};
