import type {
  EffectFamilyV1,
  ProfessionalBenchmarkCaseV1,
  ProfessionalBenchmarkResultV1,
  ProfessionalFidelityLevelV1,
} from "./contracts.js";

const families: readonly Exclude<EffectFamilyV1, "UNKNOWN">[] = [
  "SHUTTER_FRAGMENTATION",
  "TEMPORAL_ECHO",
  "VELOCITY_TRANSITION",
  "SUBJECT_ISOLATED_TRANSITION",
  "WHIP_SMEAR",
  "DISPLACEMENT_WARP",
  "ZOOM_IMPACT",
  "OCCLUSION_TRANSITION",
  "FREEZE_FRAGMENTATION",
  "CAMERA_MOTION_MATCH",
  "CHROMATIC_GLITCH",
  "REVERSE_TEMPORAL",
  "MASK_REVEAL",
  "COMPOUND_LAYERED",
];

const variants = [
  ["subject", "aspect-ratio"],
  ["frame-rate", "motion-direction"],
  ["duration", "intensity"],
] as const;

export const createCanonicalProfessionalBenchmarkV1 = (): readonly ProfessionalBenchmarkCaseV1[] => {
  const cases: ProfessionalBenchmarkCaseV1[] = [];
  for (const [index, family] of families.entries()) {
    cases.push({
      caseId: `m6:${family.toLowerCase()}:canonical`,
      family,
      sourceKind: index < 5 ? "TUTORIAL" : "REFERENCE_ONLY",
      transferAxes: variants[index % variants.length] ?? ["subject"],
      referenceEvidenceRef: `proofs/m6/references/${family.toLowerCase()}-canonical.json`,
      expectedLevel: "PROFESSIONAL_FIDELITY_VERIFIED",
    });
  }
  for (const [index, family] of families.slice(0, 10).entries()) {
    cases.push({
      caseId: `m6:${family.toLowerCase()}:held-out`,
      family,
      sourceKind: "HELD_OUT",
      transferAxes: variants[(index + 1) % variants.length] ?? ["duration"],
      referenceEvidenceRef: `proofs/m6/references/${family.toLowerCase()}-held-out.json`,
      expectedLevel: "PROFESSIONAL_FIDELITY_VERIFIED",
    });
  }
  return cases;
};

const maturityRank: Readonly<Record<ProfessionalFidelityLevelV1, number>> = {
  FUNCTIONALLY_PRESENT: 1,
  STRUCTURAL: 2,
  VISUALLY_RECOGNIZABLE: 3,
  REFERENCE_FAITHFUL: 4,
  TRANSFER_VERIFIED: 5,
  PROFESSIONAL_FIDELITY_VERIFIED: 6,
  ROBUST: 7,
};

export interface ProfessionalMaturityProofV1 {
  readonly functionallyPresent: boolean;
  readonly structuralCoverageComplete: boolean;
  readonly visuallyRecognizable: boolean;
  readonly referenceFaithful: boolean;
  readonly transferVariantCount: number;
  readonly professionalCasePassCount: number;
  readonly robustnessAxesPassed: readonly string[];
}

const ROBUSTNESS_AXES_V1 = [
  "subject",
  "aspect-ratio",
  "frame-rate",
  "motion-direction",
  "duration",
  "intensity",
] as const;

/**
 * Derives maturity from retained proof facts instead of trusting a caller-supplied
 * label. M6 governance treats each level as cumulative: later levels cannot be
 * asserted when an earlier visual proof gate is absent.
 */
export const deriveProfessionalFidelityLevelV1 = (
  proof: ProfessionalMaturityProofV1,
): ProfessionalFidelityLevelV1 => {
  if (!proof.functionallyPresent) {
    throw new TypeError("Professional maturity cannot be assigned before the effect is functionally present.");
  }
  if (!proof.structuralCoverageComplete) return "FUNCTIONALLY_PRESENT";
  if (!proof.visuallyRecognizable) return "STRUCTURAL";
  if (!proof.referenceFaithful) return "VISUALLY_RECOGNIZABLE";
  if (proof.transferVariantCount < 1) return "REFERENCE_FAITHFUL";
  if (proof.professionalCasePassCount < 2) return "TRANSFER_VERIFIED";
  const robustAxes = new Set(proof.robustnessAxesPassed);
  const robust = ROBUSTNESS_AXES_V1.every((axis) => robustAxes.has(axis));
  return robust ? "ROBUST" : "PROFESSIONAL_FIDELITY_VERIFIED";
};

export interface BenchmarkCaseEvidenceV1 {
  readonly caseId: string;
  /** Optional assertion retained only for audit; the evaluator derives authority from maturityProof. */
  readonly achievedLevel?: ProfessionalFidelityLevelV1;
  readonly maturityProof: ProfessionalMaturityProofV1;
  readonly directAbReferenceRef: string;
  readonly comparisonEvidenceRef: string;
  readonly transferPassed: boolean;
  readonly degradedCaseRejected: boolean;
}

export const evaluateProfessionalBenchmarkV1 = (
  cases: readonly ProfessionalBenchmarkCaseV1[],
  evidence: readonly BenchmarkCaseEvidenceV1[],
): ProfessionalBenchmarkResultV1 => {
  if (cases.length < 20 || cases.length > 30) {
    throw new TypeError("M6 professional benchmark must contain 20-30 cases.");
  }
  const evidenceByCase = new Map(evidence.map((item) => [item.caseId, item] as const));
  const failures: string[] = [];
  for (const item of cases) {
    const proof = evidenceByCase.get(item.caseId);
    if (proof === undefined) {
      failures.push(`${item.caseId}:MISSING_EVIDENCE`);
      continue;
    }
    if (proof.directAbReferenceRef.trim().length === 0 || proof.comparisonEvidenceRef.trim().length === 0) {
      failures.push(`${item.caseId}:MISSING_DIRECT_AB_OR_MACHINE_COMPARISON`);
    }
    let derivedLevel: ProfessionalFidelityLevelV1;
    try {
      derivedLevel = deriveProfessionalFidelityLevelV1(proof.maturityProof);
    } catch {
      failures.push(`${item.caseId}:FUNCTIONALLY_ABSENT`);
      continue;
    }
    if (proof.achievedLevel !== undefined && proof.achievedLevel !== derivedLevel) {
      failures.push(`${item.caseId}:MATURITY_ASSERTION_MISMATCH_${proof.achievedLevel}_VS_${derivedLevel}`);
    }
    if (maturityRank[derivedLevel] < maturityRank[item.expectedLevel]) {
      failures.push(`${item.caseId}:MATURITY_${derivedLevel}`);
    }
    if (!proof.transferPassed) failures.push(`${item.caseId}:TRANSFER_FAILED`);
    if (!proof.degradedCaseRejected) failures.push(`${item.caseId}:DEGRADED_CASE_NOT_REJECTED`);
  }
  const familyCoverage = [...new Set(cases.map((item) => item.family))];
  const heldOutCases = cases.filter((item) => item.sourceKind === "HELD_OUT").length;
  const transferAxes = [...new Set(cases.flatMap((item) => item.transferAxes))].sort();
  const passedCaseIds = new Set(cases.map((item) => item.caseId));
  for (const failure of failures) passedCaseIds.delete(failure.split(":").slice(0, -1).join(":"));
  return {
    schema: "editflow.professional-benchmark-result.v1",
    passed: failures.length === 0 && familyCoverage.length === families.length && heldOutCases > 0,
    total: cases.length,
    passedCases: passedCaseIds.size,
    familyCoverage,
    heldOutCases,
    transferAxes,
    failures,
  };
};
