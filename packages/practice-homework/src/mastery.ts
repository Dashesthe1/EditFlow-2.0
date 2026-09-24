import type {
  BenchmarkCaseEvidenceV1,
} from "../../visual-effects-intelligence/src/index.js";
import {
  createCanonicalProfessionalBenchmarkV1,
  evaluateProfessionalBenchmarkV1,
} from "../../visual-effects-intelligence/src/index.js";

import type {
  EditTypeProfileV1,
  GptLearnedSkillV1,
  GptSkillMaturityV1,
  PracticeAttemptV1,
  PracticeHeldOutBenchmarkCaseV1,
  PracticeHeldOutBenchmarkPolicyV1,
  PracticeHeldOutBenchmarkReportV1,
  PracticeMasteryProofV1,
  PracticeSkillUseAttestationV1,
  PracticeMasteryRecordV1,
  PracticeMasteryScopeV1,
  PracticeMaturityStageV1,
} from "./contracts.js";
import { buildPracticeSubjectIdentityMemoriesV1 } from "./subject-identity-memory.js";

const nonEmpty = (value: string | undefined): string | null => {
  const normalized = value?.trim() ?? "";
  return normalized.length === 0 ? null : normalized;
};

const uniqueNonEmpty = (values: readonly string[]): readonly string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const machineEvidenceValues = (
  source: string,
  attempt: PracticeAttemptV1 | null,
  proof: PracticeMasteryProofV1,
): readonly string[] => {
  const traces = attempt?.decisionTraces ?? [];
  switch (source) {
    case "CUE_ID":
      return uniqueNonEmpty(traces.flatMap((trace) => trace.cueIds));
    case "RATIONALE_CODE":
      return uniqueNonEmpty(traces.flatMap((trace) => trace.rationaleCodes));
    case "CONSTRUCTION_ID":
      return uniqueNonEmpty(traces.flatMap((trace) => trace.constructionIds));
    case "EVIDENCE_REF":
      return uniqueNonEmpty([...(attempt?.evidenceRefs ?? []), ...proof.evidenceRefs]);
    case "PROOF_EFFECT_FAMILY":
      return uniqueNonEmpty(proof.effectFamilyIds);
    case "PROOF_OBJECT_AWARE":
      return [
        proof.objectAwareProof?.required === true
          && proof.objectAwareProof.verified
          && proof.crossSourceSubjectProof?.required === true
          && proof.crossSourceSubjectProof.verified
          ? "VERIFIED"
          : "NOT_VERIFIED",
      ];
    default:
      return [];
  }
};

const matchedMachineEvidenceValues = (
  predicate: { readonly source: string; readonly match: string; readonly value: string },
  attempt: PracticeAttemptV1 | null,
  proof: PracticeMasteryProofV1,
): readonly string[] => {
  const expected = predicate.value.trim();
  if (expected.length === 0) return [];
  const values = machineEvidenceValues(predicate.source, attempt, proof);
  return predicate.match === "PREFIX"
    ? values.filter((value) => value.startsWith(expected))
    : values.filter((value) => value === expected);
};

export const attestPracticeSkillUseV1 = (input: {
  readonly skills: readonly GptLearnedSkillV1[];
  readonly attempt: PracticeAttemptV1 | null;
  readonly proof: PracticeMasteryProofV1;
  readonly acceptedMaturities?: readonly GptSkillMaturityV1[];
}): readonly PracticeSkillUseAttestationV1[] => input.skills.map((skill) => {
  const reasons: string[] = [];
  const attempt = input.attempt;
  const causalModel = skill.causalModel;
  const signature = skill.machineUseSignature;
  const invariants = uniqueNonEmpty(causalModel?.invariants ?? []);
  const acceptedMaturities: readonly GptSkillMaturityV1[] =
    input.acceptedMaturities ?? ["TRANSFER_VERIFIED"];
  let matchedInvariantCount = 0;

  if (!acceptedMaturities.includes(skill.maturity)) {
    reasons.push(
      "Skill maturity is not eligible for machine skill-use attestation: "
        + skill.maturity + ".",
    );
  }
  if (attempt === null) {
    reasons.push("No persisted Practice attempt is available for machine skill-use attestation.");
  } else if (attempt.renderRef !== input.proof.finalRenderRef) {
    reasons.push("Persisted Practice attempt does not match the certified final render.");
  }
  if (causalModel === undefined || invariants.length === 0) {
    reasons.push("Skill has no retained causal invariants to verify.");
  }
  if (signature === undefined
    || signature.schema !== "editflow.gpt-skill-machine-use-signature.v1") {
    reasons.push("Skill has no machine-use signature.");
  }

  const signatureHasConstructionBinding = signature?.invariantRules.some((rule) =>
    rule.evidence.some((predicate) => predicate.source === "CONSTRUCTION_ID")) ?? false;
  if (signature !== undefined && !signatureHasConstructionBinding) {
    reasons.push(
      "Machine-use signature does not bind the skill to persisted reconstruction construction evidence.",
    );
  }
  if (attempt !== null && attempt.evidenceRefs.length === 0) {
    reasons.push("Practice attempt contains no retained AE/runtime evidence refs.");
  }

  const matchedConstructionIds: string[] = [];
  if (causalModel !== undefined && signature !== undefined) {
    const invariantSet = new Set(invariants);
    const malformedRules = signature.invariantRules.filter((rule) =>
      !invariantSet.has(rule.invariant.trim()) || rule.evidence.length === 0);
    if (malformedRules.length > 0) {
      reasons.push("Machine-use signature contains malformed or non-causal invariant rules.");
    }
    for (const invariant of invariants) {
      const rules = signature.invariantRules.filter(
        (rule) => rule.invariant.trim() === invariant,
      );
      if (rules.length === 0) {
        reasons.push("Machine-use signature has no rule for causal invariant: " + invariant);
        continue;
      }
      const matchedRules = rules.map((rule) => ({
        rule,
        matchedValues: rule.evidence.map((predicate) =>
          matchedMachineEvidenceValues(predicate, attempt, input.proof)),
      })).filter((candidate) =>
        candidate.matchedValues.every((values) => values.length > 0));
      const selected = matchedRules.find((candidate) =>
        candidate.rule.evidence.some((predicate) => predicate.source === "CONSTRUCTION_ID"))
        ?? matchedRules[0];
      if (selected === undefined) {
        reasons.push("Causal invariant lacks matching machine evidence: " + invariant);
        continue;
      }
      matchedInvariantCount += 1;
      selected.rule.evidence.forEach((predicate, index) => {
        if (predicate.source === "CONSTRUCTION_ID") {
          matchedConstructionIds.push(...(selected.matchedValues[index] ?? []));
        }
      });
    }
  }

  const boundConstructionIds = uniqueNonEmpty(matchedConstructionIds);
  if (signature !== undefined && boundConstructionIds.length === 0) {
    reasons.push("No machine-use rule matched persisted construction evidence for this skill.");
  }
  const evidenceRefs = uniqueNonEmpty([
    ...(attempt?.evidenceRefs ?? []),
    ...input.proof.evidenceRefs,
  ]);
  const verified = reasons.length === 0
    && invariants.length > 0
    && matchedInvariantCount === invariants.length
    && boundConstructionIds.length > 0;
  return {
    skillId: skill.skillId,
    verified,
    matchedInvariantCount,
    requiredInvariantCount: invariants.length,
    matchedConstructionIds: verified ? boundConstructionIds : [],
    evidenceRefs: verified ? evidenceRefs : [],
    reasons: uniqueNonEmpty(reasons),
  };
});

export const classifyPracticeMasteryScopeV1 = (
  prior: readonly PracticeMasteryRecordV1[],
  proof: PracticeMasteryProofV1,
): PracticeMasteryScopeV1 => {
  const referenceFingerprint = nonEmpty(proof.referenceFingerprint);
  const sourceFingerprint = nonEmpty(proof.sourceFingerprint);
  const sourceMediaSha256 = uniqueNonEmpty(proof.sourceMediaSha256 ?? []);
  if (referenceFingerprint === null
    || sourceFingerprint === null
    || sourceMediaSha256.length === 0) {
    return "REFERENCE_VERIFIED";
  }
  const currentSourceMedia = new Set(sourceMediaSha256);

  const hasMaterialTransfer = prior.some((record) => {
    const priorReference = nonEmpty(record.referenceFingerprint);
    const priorSource = nonEmpty(record.sourceFingerprint);
    const priorSourceMedia = uniqueNonEmpty(record.sourceMediaSha256 ?? []);
    return priorReference !== null
      && priorSource !== null
      && priorReference !== referenceFingerprint
      && priorSource !== sourceFingerprint
      && priorSourceMedia.length > 0
      && priorSourceMedia.every((sha256) => !currentSourceMedia.has(sha256));
  });
  return hasMaterialTransfer ? "TRANSFER_VERIFIED" : "REFERENCE_VERIFIED";
};

export const buildPracticeMasteryRecordV1 = (input: {
  readonly sessionId: string;
  readonly priorRecords: readonly PracticeMasteryRecordV1[];
  readonly proof: PracticeMasteryProofV1;
  readonly proofRef: string;
  readonly attempt: PracticeAttemptV1 | null;
}): PracticeMasteryRecordV1 => {
  if (!input.proof.report.passed) {
    throw new TypeError("Practice mastery record requires a passing machine verification report.");
  }
  if (input.proof.sessionId !== input.sessionId) {
    throw new TypeError("Practice mastery proof session does not match the retained session.");
  }
  const proofRef = input.proofRef.trim();
  if (proofRef.length === 0) {
    throw new TypeError("Practice mastery record requires a retained proof reference.");
  }
  const scope = classifyPracticeMasteryScopeV1(input.priorRecords, input.proof);
  const subjectIdentityMemories = buildPracticeSubjectIdentityMemoriesV1({
    sessionId: input.sessionId,
    proof: input.proof,
    attempt: input.attempt,
  });
  return {
    sessionId: input.sessionId,
    scope,
    proofRef,
    referenceId: input.proof.referenceId,
    sourceIndexId: input.proof.sourceIndexId,
    referenceFingerprint: input.proof.referenceFingerprint,
    sourceFingerprint: input.proof.sourceFingerprint,
    ...(input.proof.sourceMediaSha256 === undefined
      ? {}
      : { sourceMediaSha256: [...input.proof.sourceMediaSha256] }),
    finalRenderRef: input.proof.finalRenderRef,
    overallSimilarity: input.proof.report.overallSimilarity,
    definingEffectCoverage: input.proof.report.definingEffectCoverage,
    effectFamilyIds: [...input.proof.effectFamilyIds],
    ...(subjectIdentityMemories.length === 0
      ? {}
      : { subjectIdentityMemories }),
    verifiedAt: input.proof.verifiedAt,
  };
};

export const buildPracticeHeldOutBenchmarkCaseV1 = (input: {
  readonly sessionId: string;
  readonly proof: PracticeMasteryProofV1;
  readonly proofRef: string;
  readonly appliedSkillIds?: readonly string[];
  readonly skillUseAttestations?: readonly PracticeSkillUseAttestationV1[];
  readonly traceReasons?: readonly string[];
}): PracticeHeldOutBenchmarkCaseV1 => {
  const appliedSkillIds = uniqueNonEmpty(input.appliedSkillIds ?? []);
  const skillUseAttestations = (input.skillUseAttestations ?? []).map((item) => ({
    ...structuredClone(item),
    evidenceRefs: uniqueNonEmpty(item.evidenceRefs),
    reasons: uniqueNonEmpty(item.reasons),
    matchedConstructionIds: uniqueNonEmpty(item.matchedConstructionIds),
  }));
  const verifiedSkillUseIds = uniqueNonEmpty(
    skillUseAttestations.filter((item) => item.verified).map((item) => item.skillId),
  );
  const claimedWithoutMachineProof = appliedSkillIds
    .filter((skillId) => !verifiedSkillUseIds.includes(skillId))
    .map((skillId) => "Claimed skill use lacks machine attestation: " + skillId + ".");
  const objectAwareRequired = input.proof.objectAwareProof?.required === true;
  const objectProofReasons = objectAwareRequired
    && !input.proof.objectAwareProof!.verified
    ? input.proof.objectAwareProof!.reasons
    : [];
  const crossSourceSubjectVerified = objectAwareRequired
    && input.proof.crossSourceSubjectProof?.required === true
    && input.proof.crossSourceSubjectProof.verified;
  const crossSourceSubjectReasons = objectAwareRequired && !crossSourceSubjectVerified
    ? input.proof.crossSourceSubjectProof?.reasons.length
      ? input.proof.crossSourceSubjectProof.reasons
      : ["Object-aware held-out proof lacks verified Finish-to-Start subject binding."]
    : [];
  const reasons = [...new Set([
    ...input.proof.report.reasons,
    ...objectProofReasons,
    ...crossSourceSubjectReasons,
    ...claimedWithoutMachineProof,
    ...(input.traceReasons ?? []),
  ].map((value) => value.trim()).filter(Boolean))];
  return {
    caseId: "held-out:" + input.sessionId,
    sessionId: input.sessionId,
    referenceFingerprint: input.proof.referenceFingerprint,
    sourceFingerprint: input.proof.sourceFingerprint,
    ...(input.proof.sourceMediaSha256 === undefined
      ? {}
      : { sourceMediaSha256: [...input.proof.sourceMediaSha256] }),
    effectFamilyIds: [...input.proof.effectFamilyIds],
    appliedSkillIds,
    verifiedSkillUseIds,
    skillUseAttestations,
    objectAwareVerified: objectAwareRequired
      && input.proof.objectAwareProof!.verified
      && crossSourceSubjectVerified,
    overallSimilarity: input.proof.report.overallSimilarity,
    definingEffectCoverage: input.proof.report.definingEffectCoverage,
    passed: input.proof.report.passed && reasons.length === 0,
    reasons,
    evidenceRefs: [...new Set([
      input.proofRef,
      ...input.proof.evidenceRefs,
      ...(input.proof.objectAwareProof?.evidenceRefs ?? []),
      ...(input.proof.crossSourceSubjectProof?.evidenceRefs ?? []),
      ...skillUseAttestations.flatMap((item) => item.evidenceRefs),
    ].map((value) => value.trim()).filter(Boolean))],
  };
};

export const DEFAULT_PRACTICE_HELD_OUT_BENCHMARK_POLICY_V1: PracticeHeldOutBenchmarkPolicyV1 = {
  minimumCases: 20,
  maximumCases: 30,
  minimumSimilarity: 0.95,
  minimumDefiningEffectCoverage: 1,
  minimumObjectAwareCases: 1,
};

const benchmarkPolicy = (
  value: Partial<PracticeHeldOutBenchmarkPolicyV1> | undefined,
): PracticeHeldOutBenchmarkPolicyV1 => ({
  minimumCases: Math.max(
    DEFAULT_PRACTICE_HELD_OUT_BENCHMARK_POLICY_V1.minimumCases,
    Math.floor(value?.minimumCases ?? DEFAULT_PRACTICE_HELD_OUT_BENCHMARK_POLICY_V1.minimumCases),
  ),
  maximumCases: Math.max(
    DEFAULT_PRACTICE_HELD_OUT_BENCHMARK_POLICY_V1.maximumCases,
    Math.floor(value?.maximumCases ?? DEFAULT_PRACTICE_HELD_OUT_BENCHMARK_POLICY_V1.maximumCases),
  ),
  minimumSimilarity: Math.max(
    DEFAULT_PRACTICE_HELD_OUT_BENCHMARK_POLICY_V1.minimumSimilarity,
    Math.min(1, value?.minimumSimilarity ?? DEFAULT_PRACTICE_HELD_OUT_BENCHMARK_POLICY_V1.minimumSimilarity),
  ),
  minimumDefiningEffectCoverage: Math.max(
    DEFAULT_PRACTICE_HELD_OUT_BENCHMARK_POLICY_V1.minimumDefiningEffectCoverage,
    Math.min(
      1,
      value?.minimumDefiningEffectCoverage
        ?? DEFAULT_PRACTICE_HELD_OUT_BENCHMARK_POLICY_V1.minimumDefiningEffectCoverage,
    ),
  ),
  minimumObjectAwareCases: Math.max(
    DEFAULT_PRACTICE_HELD_OUT_BENCHMARK_POLICY_V1.minimumObjectAwareCases,
    Math.floor(
      value?.minimumObjectAwareCases
        ?? DEFAULT_PRACTICE_HELD_OUT_BENCHMARK_POLICY_V1.minimumObjectAwareCases,
    ),
  ),
});

export const evaluatePracticeHeldOutBenchmarkV1 = (input: {
  readonly editTypeId: string;
  readonly cases: readonly PracticeHeldOutBenchmarkCaseV1[];
  readonly priorMasteryRecords?: readonly PracticeMasteryRecordV1[];
  readonly priorLearnedSkills?: readonly GptLearnedSkillV1[];
  readonly professionalBenchmarkEvidence?: readonly BenchmarkCaseEvidenceV1[];
  readonly policy?: Partial<PracticeHeldOutBenchmarkPolicyV1>;
}): PracticeHeldOutBenchmarkReportV1 => {
  const policy = benchmarkPolicy(input.policy);
  const reasons: string[] = [];
  const trainingReferences = new Set(
    (input.priorMasteryRecords ?? []).map((record) => record.referenceFingerprint),
  );
  const trainingSources = new Set(
    (input.priorMasteryRecords ?? []).map((record) => record.sourceFingerprint),
  );
  const materialPairs = new Set<string>();
  const heldOutReferences = new Set<string>();
  const heldOutSources = new Set<string>();
  const requiredEffectFamilies = new Set(
    (input.priorMasteryRecords ?? [])
      .filter((record) => record.scope === "TRANSFER_VERIFIED")
      .flatMap((record) => record.effectFamilyIds)
      .map((family) => family.trim())
      .filter(Boolean),
  );
  const verifiedEffectFamilies = new Set<string>();
  const requiredLearnedSkills = new Set(
    (input.priorLearnedSkills ?? [])
      .filter((skill) => skill.maturity === "TRANSFER_VERIFIED")
      .map((skill) => skill.skillId.trim())
      .filter(Boolean),
  );
  const verifiedLearnedSkills = new Set<string>();
  const evidenceRefs = new Set<string>();
  let passedCaseCount = 0;
  let objectAwareCaseCount = 0;

  if (input.cases.length < policy.minimumCases) {
    reasons.push("Held-out benchmark has fewer than " + String(policy.minimumCases) + " cases.");
  }
  if (input.cases.length > policy.maximumCases) {
    reasons.push("Held-out benchmark exceeds the supported " + String(policy.maximumCases) + "-case proof window.");
  }

  for (const item of input.cases) {
    const pairKey = item.referenceFingerprint + "\u0000" + item.sourceFingerprint;
    if (materialPairs.has(pairKey)) {
      reasons.push("Held-out benchmark reuses a reference/source material pair: " + item.caseId + ".");
    }
    materialPairs.add(pairKey);
    if (heldOutReferences.has(item.referenceFingerprint)) {
      reasons.push("Held-out benchmark reuses a reference fingerprint: " + item.caseId + ".");
    }
    heldOutReferences.add(item.referenceFingerprint);
    if (heldOutSources.has(item.sourceFingerprint)) {
      reasons.push("Held-out benchmark reuses a source fingerprint: " + item.caseId + ".");
    }
    heldOutSources.add(item.sourceFingerprint);
    if (trainingReferences.has(item.referenceFingerprint)) {
      reasons.push("Held-out case reuses a training reference fingerprint: " + item.caseId + ".");
    }
    if (trainingSources.has(item.sourceFingerprint)) {
      reasons.push("Held-out case reuses a training source fingerprint: " + item.caseId + ".");
    }
    if (!item.passed) {
      reasons.push("Held-out case did not pass its machine proof gate: " + item.caseId + ".");
    }
    for (const reason of item.reasons ?? []) {
      const normalized = reason.trim();
      if (normalized.length > 0) {
        reasons.push("Held-out case " + item.caseId + ": " + normalized);
      }
    }
    if (item.overallSimilarity < policy.minimumSimilarity) {
      reasons.push("Held-out case is below the similarity floor: " + item.caseId + ".");
    }
    if (item.definingEffectCoverage < policy.minimumDefiningEffectCoverage) {
      reasons.push("Held-out case is missing defining effect behavior: " + item.caseId + ".");
    }
    if (item.effectFamilyIds.length === 0) {
      reasons.push("Held-out case has no retained effect-family evidence: " + item.caseId + ".");
    }
    if (item.evidenceRefs.length === 0) {
      reasons.push("Held-out case has no retained proof evidence: " + item.caseId + ".");
    }
    for (const ref of item.evidenceRefs) {
      const normalized = ref.trim();
      if (normalized.length > 0) evidenceRefs.add(normalized);
    }
    const claimedSkillIds = uniqueNonEmpty(item.appliedSkillIds ?? []);
    for (const skillId of claimedSkillIds) {
      if (!requiredLearnedSkills.has(skillId)) {
        reasons.push(
          "Held-out case claims a skill that is not retained as TRANSFER_VERIFIED: "
            + item.caseId + " -> " + skillId + ".",
        );
      }
    }
    const validAttestations = (item.skillUseAttestations ?? []).filter((attestation) => {
      if (!attestation.verified) return false;
      const structurallyValid = attestation.requiredInvariantCount > 0
        && attestation.matchedInvariantCount === attestation.requiredInvariantCount
        && attestation.matchedConstructionIds.length > 0
        && attestation.evidenceRefs.length > 0
        && attestation.reasons.length === 0;
      if (!structurallyValid) {
        reasons.push(
          "Held-out case contains an invalid verified skill-use attestation: "
            + item.caseId + " -> " + attestation.skillId + ".",
        );
      }
      return structurallyValid;
    });
    const machineVerifiedSkillIds = uniqueNonEmpty(
      validAttestations.map((attestation) => attestation.skillId),
    );
    const recordedVerifiedSkillIds = uniqueNonEmpty(item.verifiedSkillUseIds ?? []);
    if (JSON.stringify([...machineVerifiedSkillIds].sort())
      !== JSON.stringify([...recordedVerifiedSkillIds].sort())) {
      reasons.push(
        "Held-out case verified-skill index does not match its machine attestations: "
          + item.caseId + ".",
      );
    }
    for (const skillId of machineVerifiedSkillIds) {
      if (!requiredLearnedSkills.has(skillId)) {
        reasons.push(
          "Held-out case machine-attests a skill that is not retained as TRANSFER_VERIFIED: "
            + item.caseId + " -> " + skillId + ".",
        );
      }
    }
    const caseMeetsMachineGate = item.passed
      && item.overallSimilarity >= policy.minimumSimilarity
      && item.definingEffectCoverage >= policy.minimumDefiningEffectCoverage
      && item.effectFamilyIds.length > 0
      && item.evidenceRefs.length > 0;
    if (caseMeetsMachineGate) {
      passedCaseCount += 1;
      for (const family of item.effectFamilyIds) {
        const normalized = family.trim();
        if (normalized.length > 0) verifiedEffectFamilies.add(normalized);
      }
      for (const skillId of machineVerifiedSkillIds) {
        if (requiredLearnedSkills.has(skillId)) verifiedLearnedSkills.add(skillId);
      }
      if (item.objectAwareVerified) objectAwareCaseCount += 1;
    }
  }

  const requiredEffectFamilyIds = [...requiredEffectFamilies].sort();
  const verifiedEffectFamilyIds = [...verifiedEffectFamilies].sort();
  const missingEffectFamilyIds = requiredEffectFamilyIds.filter(
    (family) => !verifiedEffectFamilies.has(family),
  );
  const effectFamilyCoverageVerified = requiredEffectFamilyIds.length > 0
    && missingEffectFamilyIds.length === 0;
  if (requiredEffectFamilyIds.length === 0) {
    reasons.push(
      "Held-out benchmark has no TRANSFER_VERIFIED effect-family target set from Practice mastery.",
    );
  } else if (missingEffectFamilyIds.length > 0) {
    reasons.push(
      "Held-out benchmark is missing passing transfer coverage for mastered effect families: "
        + missingEffectFamilyIds.join(", ")
        + ".",
    );
  }

  const requiredLearnedSkillIds = [...requiredLearnedSkills].sort();
  const verifiedLearnedSkillIds = [...verifiedLearnedSkills].sort();
  const missingLearnedSkillIds = requiredLearnedSkillIds.filter(
    (skillId) => !verifiedLearnedSkills.has(skillId),
  );
  const learnedSkillCoverageVerified = requiredLearnedSkillIds.length === 0
    || missingLearnedSkillIds.length === 0;
  if (missingLearnedSkillIds.length > 0) {
    reasons.push(
      "Held-out benchmark is missing explicit passing coverage for TRANSFER_VERIFIED learned skills: "
        + missingLearnedSkillIds.join(", ")
        + ".",
    );
  }

  const professionalCases = createCanonicalProfessionalBenchmarkV1();
  const professionalEvidence = input.professionalBenchmarkEvidence ?? [];
  const professionalResult = evaluateProfessionalBenchmarkV1(
    professionalCases,
    professionalEvidence,
  );
  const professionalBenchmarkVerifiedEffectFamilyIds = requiredEffectFamilyIds.filter((family) => {
    const familyCases = professionalCases.filter((item) => item.family === family);
    return familyCases.length > 0 && familyCases.every((item) =>
      !professionalResult.failures.some((failure) => failure.startsWith(item.caseId + ":")));
  });
  const professionalVerifiedSet = new Set(professionalBenchmarkVerifiedEffectFamilyIds);
  const professionalBenchmarkMissingEffectFamilyIds = requiredEffectFamilyIds.filter(
    (family) => !professionalVerifiedSet.has(family),
  );
  const professionalBenchmarkGlobalFailures = professionalResult.failures.filter((failure) =>
    failure.startsWith("BENCHMARK:"));
  const professionalBenchmarkCoverageVerified = requiredEffectFamilyIds.length > 0
    && professionalBenchmarkMissingEffectFamilyIds.length === 0
    && professionalBenchmarkGlobalFailures.length === 0;
  const requiredProfessionalCaseIds = new Set(
    professionalCases
      .filter((item) => requiredEffectFamilies.has(item.family))
      .map((item) => item.caseId),
  );
  const professionalBenchmarkFailures = professionalResult.failures.filter((failure) =>
    failure.startsWith("BENCHMARK:")
    || [...requiredProfessionalCaseIds].some((caseId) => failure.startsWith(caseId + ":")));
  for (const family of professionalBenchmarkMissingEffectFamilyIds) {
    if (!professionalCases.some((item) => item.family === family)) {
      professionalBenchmarkFailures.push("practice:" + family + ":NOT_IN_M6_CANONICAL_BENCHMARK");
    }
  }
  const professionalBenchmarkEvidenceRefs = [...new Set(
    professionalEvidence
      .filter((item) => requiredProfessionalCaseIds.has(item.caseId))
      .flatMap((item) => [
        item.referenceEvidenceRef,
        item.directAbReferenceRef,
        item.comparisonEvidenceRef,
        item.degradedCaseEvidenceRef,
        ...item.transferEvidence.map((transfer) => transfer.evidenceRef),
      ])
      .map((ref) => ref.trim())
      .filter(Boolean),
  )];
  if (professionalBenchmarkMissingEffectFamilyIds.length > 0) {
    reasons.push(
      "M6 professional benchmark authority is missing for mastered effect families: "
        + professionalBenchmarkMissingEffectFamilyIds.join(", ")
        + ".",
    );
  }
  if (professionalBenchmarkGlobalFailures.length > 0) {
    reasons.push(
      "M6 professional benchmark evidence has global integrity failures: "
        + professionalBenchmarkGlobalFailures.join(", ")
        + ".",
    );
  }

  const objectAwareVerified = objectAwareCaseCount >= policy.minimumObjectAwareCases;
  if (!objectAwareVerified) {
    reasons.push(
      "Held-out benchmark has fewer than "
        + String(policy.minimumObjectAwareCases)
        + " object-aware verified cases.",
    );
  }
  const robust = reasons.length === 0
    && passedCaseCount === input.cases.length
    && materialPairs.size === input.cases.length
    && effectFamilyCoverageVerified
    && learnedSkillCoverageVerified
    && professionalBenchmarkCoverageVerified
    && objectAwareVerified;

  return {
    schema: "editflow.practice-held-out-benchmark.v1",
    editTypeId: input.editTypeId.trim(),
    policy,
    caseCount: input.cases.length,
    passedCaseCount,
    distinctMaterialPairCount: materialPairs.size,
    distinctEffectFamilyCount: verifiedEffectFamilies.size,
    requiredEffectFamilyIds,
    verifiedEffectFamilyIds,
    missingEffectFamilyIds,
    effectFamilyCoverageVerified,
    requiredLearnedSkillIds,
    verifiedLearnedSkillIds,
    missingLearnedSkillIds,
    learnedSkillCoverageVerified,
    professionalBenchmarkVerifiedEffectFamilyIds,
    professionalBenchmarkMissingEffectFamilyIds,
    professionalBenchmarkCoverageVerified,
    professionalBenchmarkFailures: [...new Set(professionalBenchmarkFailures)],
    professionalBenchmarkEvidenceRefs,
    objectAwareCaseCount,
    objectAwareVerified,
    robust,
    reasons: [...new Set(reasons)],
    cases: structuredClone(input.cases),
    evidenceRefs: [...evidenceRefs],
    evaluatedAt: new Date().toISOString(),
  };
};

export const derivePracticeMaturityStageV1 = (
  profile: EditTypeProfileV1,
): PracticeMaturityStageV1 | null => {
  const learning = profile.gptLearning;
  const records = learning?.masteryRecords ?? [];
  const benchmarks = learning?.heldOutBenchmarks ?? [];
  if (benchmarks.some((report) =>
    report.robust
    && report.objectAwareVerified
    && report.effectFamilyCoverageVerified === true
    && report.learnedSkillCoverageVerified === true
    && report.professionalBenchmarkCoverageVerified === true)) return "ROBUST";
  if (benchmarks.some((report) => report.objectAwareVerified)) {
    return "OBJECT_AWARE_VERIFIED";
  }
  if (records.some((record) => record.scope === "TRANSFER_VERIFIED")) {
    return "TRANSFER_VERIFIED";
  }
  if (records.length > 0) return "VISUAL_MATCH_VERIFIED";
  if (profile.behaviorEvidence.length > 0) return "RECONSTRUCTED";
  if ((learning?.practiceSessionIds.length ?? 0) > 0 || profile.sessionIds.length > 0) {
    return "OBSERVED";
  }
  return null;
};
