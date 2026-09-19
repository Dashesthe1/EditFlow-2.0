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

export interface BenchmarkCaseEvidenceV1 {
  readonly caseId: string;
  readonly achievedLevel: ProfessionalFidelityLevelV1;
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
    if (maturityRank[proof.achievedLevel] < maturityRank[item.expectedLevel]) {
      failures.push(`${item.caseId}:MATURITY_${proof.achievedLevel}`);
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
