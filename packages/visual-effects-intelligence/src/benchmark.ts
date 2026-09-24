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

export interface BenchmarkTransferAxisEvidenceV1 {
  readonly axis: string;
  readonly passed: boolean;
  /** Retained machine/visual proof for this exact transfer variation. */
  readonly evidenceRef: string;
  /** Stable content/config fingerprint for the materially changed transfer variant. */
  readonly variantFingerprint: string;
}

export interface BenchmarkCaseEvidenceV1 {
  readonly caseId: string;
  /** Must bind to the exact reference declared by the benchmark case. */
  readonly referenceEvidenceRef: string;
  /** Optional assertion retained only for audit; the evaluator derives authority from maturityProof. */
  readonly achievedLevel?: ProfessionalFidelityLevelV1;
  readonly maturityProof: ProfessionalMaturityProofV1;
  readonly directAbReferenceRef: string;
  readonly comparisonEvidenceRef: string;
  readonly transferEvidence: readonly BenchmarkTransferAxisEvidenceV1[];
  readonly degradedCaseRejected: boolean;
  readonly degradedCaseEvidenceRef: string;
}

const benchmarkFailureCode = (value: string): string =>
  value.trim().replace(/[^A-Za-z0-9_.-]+/g, "_");

export const evaluateProfessionalBenchmarkV1 = (
  cases: readonly ProfessionalBenchmarkCaseV1[],
  evidence: readonly BenchmarkCaseEvidenceV1[],
): ProfessionalBenchmarkResultV1 => {
  if (cases.length < 20 || cases.length > 30) {
    throw new TypeError("M6 professional benchmark must contain 20-30 cases.");
  }

  const failures: string[] = [];
  const failedCaseIds = new Set<string>();
  const failCase = (caseId: string, code: string): void => {
    failedCaseIds.add(caseId);
    failures.push(`${caseId}:${code}`);
  };
  const failBenchmark = (code: string): void => {
    failures.push(`BENCHMARK:${code}`);
  };

  const declaredCaseIds = new Set<string>();
  for (const item of cases) {
    if (declaredCaseIds.has(item.caseId)) {
      failCase(item.caseId, "DUPLICATE_CASE_ID");
    }
    declaredCaseIds.add(item.caseId);
  }

  const evidenceByCase = new Map<string, BenchmarkCaseEvidenceV1>();
  for (const proof of evidence) {
    if (!declaredCaseIds.has(proof.caseId)) {
      failBenchmark(`UNKNOWN_EVIDENCE_${benchmarkFailureCode(proof.caseId)}`);
      continue;
    }
    if (evidenceByCase.has(proof.caseId)) {
      failCase(proof.caseId, "DUPLICATE_EVIDENCE");
      continue;
    }
    evidenceByCase.set(proof.caseId, proof);
  }

  for (const item of cases) {
    const proof = evidenceByCase.get(item.caseId);
    if (proof === undefined) {
      failCase(item.caseId, "MISSING_EVIDENCE");
      continue;
    }
    if (proof.referenceEvidenceRef.trim() !== item.referenceEvidenceRef.trim()) {
      failCase(item.caseId, "REFERENCE_EVIDENCE_MISMATCH");
    }
    if (proof.directAbReferenceRef.trim().length === 0 || proof.comparisonEvidenceRef.trim().length === 0) {
      failCase(item.caseId, "MISSING_DIRECT_AB_OR_MACHINE_COMPARISON");
    }

    const requiredAxes = new Set(item.transferAxes.map((axis) => axis.trim()).filter(Boolean));
    if (requiredAxes.size === 0) {
      failCase(item.caseId, "NO_TRANSFER_AXES");
    }
    const transferByAxis = new Map<string, BenchmarkTransferAxisEvidenceV1>();
    for (const transfer of proof.transferEvidence) {
      const axis = transfer.axis.trim();
      if (!requiredAxes.has(axis)) {
        failCase(item.caseId, `UNDECLARED_TRANSFER_AXIS_${benchmarkFailureCode(axis || "EMPTY")}`);
        continue;
      }
      if (transferByAxis.has(axis)) {
        failCase(item.caseId, `DUPLICATE_TRANSFER_AXIS_${benchmarkFailureCode(axis)}`);
        continue;
      }
      transferByAxis.set(axis, transfer);
    }
    for (const axis of requiredAxes) {
      const transfer = transferByAxis.get(axis);
      if (transfer === undefined) {
        failCase(item.caseId, `MISSING_TRANSFER_AXIS_${benchmarkFailureCode(axis)}`);
        continue;
      }
      if (!transfer.passed) {
        failCase(item.caseId, `TRANSFER_AXIS_FAILED_${benchmarkFailureCode(axis)}`);
      }
      if (transfer.evidenceRef.trim().length === 0) {
        failCase(item.caseId, `MISSING_TRANSFER_EVIDENCE_${benchmarkFailureCode(axis)}`);
      }
      if (transfer.variantFingerprint.trim().length === 0) {
        failCase(item.caseId, `MISSING_TRANSFER_VARIANT_FINGERPRINT_${benchmarkFailureCode(axis)}`);
      }
    }

    let derivedLevel: ProfessionalFidelityLevelV1;
    try {
      derivedLevel = deriveProfessionalFidelityLevelV1(proof.maturityProof);
    } catch {
      failCase(item.caseId, "FUNCTIONALLY_ABSENT");
      continue;
    }
    if (proof.achievedLevel !== undefined && proof.achievedLevel !== derivedLevel) {
      failCase(
        item.caseId,
        `MATURITY_ASSERTION_MISMATCH_${proof.achievedLevel}_VS_${derivedLevel}`,
      );
    }
    if (maturityRank[derivedLevel] < maturityRank[item.expectedLevel]) {
      failCase(item.caseId, `MATURITY_${derivedLevel}`);
    }
    if (!proof.degradedCaseRejected) {
      failCase(item.caseId, "DEGRADED_CASE_NOT_REJECTED");
    }
    if (proof.degradedCaseEvidenceRef.trim().length === 0) {
      failCase(item.caseId, "MISSING_DEGRADED_CASE_EVIDENCE");
    }
  }

  const familyCoverage = [...new Set(cases.map((item) => item.family))];
  for (const family of families) {
    if (!familyCoverage.includes(family)) {
      failBenchmark(`MISSING_EFFECT_FAMILY_${family}`);
    }
  }
  const heldOutCases = cases.filter((item) => item.sourceKind === "HELD_OUT").length;
  if (heldOutCases < 10) {
    failBenchmark("HELD_OUT_CASES_BELOW_10");
  }
  const transferAxes = [...new Set(cases.flatMap((item) => item.transferAxes).map((axis) => axis.trim()).filter(Boolean))].sort();
  for (const axis of ROBUSTNESS_AXES_V1) {
    if (!transferAxes.includes(axis)) {
      failBenchmark(`MISSING_TRANSFER_AXIS_${benchmarkFailureCode(axis)}`);
    }
  }

  const passedCaseIds = new Set(cases.map((item) => item.caseId));
  for (const caseId of failedCaseIds) passedCaseIds.delete(caseId);
  return {
    schema: "editflow.professional-benchmark-result.v1",
    passed: failures.length === 0,
    total: cases.length,
    passedCases: passedCaseIds.size,
    familyCoverage,
    heldOutCases,
    transferAxes,
    failures,
  };
};
