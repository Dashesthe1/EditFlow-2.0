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

export type BenchmarkArtifactKindV1 =
  | "REFERENCE_DENSE_EVIDENCE"
  | "RENDER_DENSE_EVIDENCE"
  | "SEMANTIC_COMPARISON"
  | "DIRECT_AB"
  | "TRANSFER_PROOF"
  | "PROFESSIONAL_CASE_PROOF"
  | "DEGRADED_CONTROL";

export interface BenchmarkArtifactBindingV1 {
  readonly ref: string;
  readonly kind: BenchmarkArtifactKindV1;
  readonly caseId: string;
  readonly family: EffectFamilyV1;
  readonly sha256: string;
  readonly contentKey?: string;
  readonly referenceContentKey?: string;
  readonly renderContentKey?: string;
  readonly baselineSourceContentKey?: string;
  readonly transferSourceContentKey?: string;
  readonly transferAxes?: readonly string[];
}

export interface RetainedBenchmarkCaseEvidenceV1 extends BenchmarkCaseEvidenceV1 {
  readonly renderEvidenceRef: string;
  readonly transferEvidenceRefs: readonly string[];
  /** Additional independent professional cases beyond the canonical comparison. */
  readonly professionalCaseEvidenceRefs?: readonly string[];
  readonly degradedControlEvidenceRef: string;
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

const SHA256_PATTERN_V1 = /^[a-f0-9]{64}$/i;

const isSha256V1 = (value: string | undefined): value is string =>
  typeof value === "string" && SHA256_PATTERN_V1.test(value);

const withRetainedFailuresV1 = (
  cases: readonly ProfessionalBenchmarkCaseV1[],
  base: ProfessionalBenchmarkResultV1,
  failures: readonly string[],
): ProfessionalBenchmarkResultV1 => {
  const uniqueFailures = [...new Set(failures)];
  const passedCaseIds = new Set(cases.map((item) => item.caseId));
  for (const failure of uniqueFailures) {
    passedCaseIds.delete(failure.split(":").slice(0, -1).join(":"));
  }
  return {
    ...base,
    passed: base.passed && uniqueFailures.length === 0,
    passedCases: passedCaseIds.size,
    failures: uniqueFailures,
  };
};

/**
 * Evaluates the M6.9 benchmark against retained, content-addressed proof artifacts.
 * The structural evaluator intentionally remains useful for unit-level contracts;
 * this retained evaluator is the authority for milestone/release claims.
 */
export const evaluateRetainedProfessionalBenchmarkV1 = (
  cases: readonly ProfessionalBenchmarkCaseV1[],
  evidence: readonly RetainedBenchmarkCaseEvidenceV1[],
  artifacts: readonly BenchmarkArtifactBindingV1[],
): ProfessionalBenchmarkResultV1 => {
  const base = evaluateProfessionalBenchmarkV1(cases, evidence);
  const failures = [...base.failures];
  const artifactByRef = new Map<string, BenchmarkArtifactBindingV1>();
  const duplicateRefs = new Set<string>();
  for (const artifact of artifacts) {
    if (artifactByRef.has(artifact.ref)) {
      duplicateRefs.add(artifact.ref);
    } else {
      artifactByRef.set(artifact.ref, artifact);
    }
  }
  const evidenceByCase = new Map(evidence.map((item) => [item.caseId, item] as const));

  for (const item of cases) {
    const proof = evidenceByCase.get(item.caseId);
    if (proof === undefined) continue;
    const requireArtifact = (
      ref: string,
      kind: BenchmarkArtifactKindV1,
      label: string,
    ): BenchmarkArtifactBindingV1 | null => {
      const artifact = artifactByRef.get(ref);
      if (artifact === undefined) {
        failures.push(`${item.caseId}:MISSING_${label}_ARTIFACT`);
        return null;
      }
      let valid = true;
      if (duplicateRefs.has(ref)) {
        failures.push(`${item.caseId}:DUPLICATE_${label}_ARTIFACT_REF`);
        valid = false;
      }
      if (artifact.kind !== kind) {
        failures.push(`${item.caseId}:${label}_ARTIFACT_KIND_MISMATCH`);
        valid = false;
      }
      if (artifact.caseId !== item.caseId || artifact.family !== item.family) {
        failures.push(`${item.caseId}:${label}_ARTIFACT_CASE_BINDING_MISMATCH`);
        valid = false;
      }
      if (!isSha256V1(artifact.sha256)) {
        failures.push(`${item.caseId}:${label}_ARTIFACT_DIGEST_INVALID`);
        valid = false;
      }
      return valid ? artifact : null;
    };

    const reference = requireArtifact(
      item.referenceEvidenceRef, "REFERENCE_DENSE_EVIDENCE", "REFERENCE",
    );
    const render = requireArtifact(proof.renderEvidenceRef, "RENDER_DENSE_EVIDENCE", "RENDER");
    const comparison = requireArtifact(
      proof.comparisonEvidenceRef, "SEMANTIC_COMPARISON", "COMPARISON",
    );
    const directAb = requireArtifact(proof.directAbReferenceRef, "DIRECT_AB", "DIRECT_AB");
    const degraded = requireArtifact(
      proof.degradedControlEvidenceRef, "DEGRADED_CONTROL", "DEGRADED_CONTROL",
    );
    const referenceKey = reference?.contentKey;
    const renderKey = render?.contentKey;
    if (reference !== null && !isSha256V1(referenceKey)) {
      failures.push(`${item.caseId}:REFERENCE_CONTENT_KEY_INVALID`);
    }
    if (render !== null && !isSha256V1(renderKey)) {
      failures.push(`${item.caseId}:RENDER_CONTENT_KEY_INVALID`);
    }
    if (comparison !== null && referenceKey !== undefined && renderKey !== undefined
      && (comparison.referenceContentKey !== referenceKey || comparison.renderContentKey !== renderKey)) {
      failures.push(`${item.caseId}:COMPARISON_CONTENT_BINDING_MISMATCH`);
    }

    if (directAb !== null && referenceKey !== undefined && renderKey !== undefined
      && (directAb.referenceContentKey !== referenceKey || directAb.renderContentKey !== renderKey)) {
      failures.push(`${item.caseId}:DIRECT_AB_CONTENT_BINDING_MISMATCH`);
    }
    if (degraded !== null && referenceKey !== undefined) {
      if (degraded.referenceContentKey !== referenceKey || !isSha256V1(degraded.renderContentKey)) {
        failures.push(`${item.caseId}:DEGRADED_CONTROL_CONTENT_BINDING_MISMATCH`);
      } else if (renderKey !== undefined && degraded.renderContentKey === renderKey) {
        failures.push(`${item.caseId}:DEGRADED_CONTROL_REUSES_CERTIFIED_RENDER`);
      }
    }

    const professionalCaseRefs = proof.professionalCaseEvidenceRefs ?? [];
    const requiredAdditionalProfessionalCases = Math.max(
      0, proof.maturityProof.professionalCasePassCount - 1,
    );
    if (professionalCaseRefs.length < requiredAdditionalProfessionalCases) {
      failures.push(`${item.caseId}:INSUFFICIENT_PROFESSIONAL_CASE_ARTIFACTS`);
    }
    const canonicalReferenceSource = reference?.baselineSourceContentKey;
    const professionalReferenceSources = new Set<string>();
    for (const professionalCaseRef of professionalCaseRefs) {
      const professionalCase = requireArtifact(
        professionalCaseRef, "PROFESSIONAL_CASE_PROOF", "PROFESSIONAL_CASE",
      );
      if (professionalCase === null) continue;
      if (!isSha256V1(professionalCase.referenceContentKey)
        || !isSha256V1(professionalCase.renderContentKey)) {
        failures.push(`${item.caseId}:PROFESSIONAL_CASE_CONTENT_BINDING_INVALID`);
      }
      const sourceKey = professionalCase.baselineSourceContentKey;
      if (!isSha256V1(sourceKey)) {
        failures.push(`${item.caseId}:PROFESSIONAL_CASE_SOURCE_IDENTITY_MISSING`);
      } else if (isSha256V1(canonicalReferenceSource) && sourceKey === canonicalReferenceSource) {
        failures.push(`${item.caseId}:PROFESSIONAL_CASE_SOURCE_NOT_INDEPENDENT`);
      } else if (professionalReferenceSources.has(sourceKey)) {
        failures.push(`${item.caseId}:PROFESSIONAL_CASE_SOURCE_REUSED`);
      } else {
        professionalReferenceSources.add(sourceKey);
      }
      if (referenceKey !== undefined && professionalCase.referenceContentKey === referenceKey) {
        failures.push(`${item.caseId}:PROFESSIONAL_CASE_REUSES_CANONICAL_REFERENCE`);
      }
    }

    const expectedTransferVariants = Math.max(1, proof.maturityProof.transferVariantCount);
    if (proof.transferEvidenceRefs.length < expectedTransferVariants) {
      failures.push(`${item.caseId}:INSUFFICIENT_TRANSFER_ARTIFACTS`);
    }
    const coveredTransferAxes = new Set<string>();
    for (const transferRef of proof.transferEvidenceRefs) {
      const transfer = requireArtifact(transferRef, "TRANSFER_PROOF", "TRANSFER");
      if (transfer === null) continue;
      if (!isSha256V1(transfer.referenceContentKey)) {
        failures.push(`${item.caseId}:TRANSFER_REFERENCE_CONTENT_KEY_INVALID`);
      } else if (referenceKey !== undefined && transfer.referenceContentKey !== referenceKey) {
        // A transfer proof may legitimately be regenerated by a newer dense
        // analyzer than the retained canonical proof. Do not pretend those
        // evidence content keys are identical. Instead, permit the analyzer
        // boundary only when both artifacts retain the exact same immutable
        // professional-reference source hash.
        const canonicalReferenceSource = reference?.baselineSourceContentKey;
        const sameReferenceSource = isSha256V1(canonicalReferenceSource)
          && isSha256V1(transfer.baselineSourceContentKey)
          && canonicalReferenceSource === transfer.baselineSourceContentKey;
        if (!sameReferenceSource) {
          failures.push(`${item.caseId}:TRANSFER_REFERENCE_BINDING_MISMATCH`);
        }
      }

      if (!isSha256V1(transfer.renderContentKey)) {
        failures.push(`${item.caseId}:TRANSFER_RENDER_CONTENT_KEY_INVALID`);
      }
      if (!isSha256V1(transfer.baselineSourceContentKey)
        || !isSha256V1(transfer.transferSourceContentKey)) {
        failures.push(`${item.caseId}:TRANSFER_SOURCE_IDENTITY_MISSING`);
      } else if (transfer.baselineSourceContentKey === transfer.transferSourceContentKey) {
        failures.push(`${item.caseId}:TRANSFER_SOURCE_NOT_MATERIALLY_DIFFERENT`);
      }
      if (transfer.transferAxes === undefined || transfer.transferAxes.length === 0) {
        failures.push(`${item.caseId}:TRANSFER_AXES_MISSING`);
      } else {
        for (const axis of transfer.transferAxes) {
          if (item.transferAxes.includes(axis)) coveredTransferAxes.add(axis);
        }
      }
    }
    for (const axis of item.transferAxes) {
      if (!coveredTransferAxes.has(axis)) {
        failures.push(`${item.caseId}:TRANSFER_AXIS_UNPROVEN_${axis.toUpperCase().replace(/-/g, "_")}`);
      }
    }
  }

  return withRetainedFailuresV1(cases, base, failures);
};
