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
  PracticeHeldOutBenchmarkCaseV1,
  PracticeHeldOutBenchmarkPolicyV1,
  PracticeHeldOutBenchmarkReportV1,
  PracticeMasteryProofV1,
  PracticeMasteryRecordV1,
  PracticeMasteryScopeV1,
  PracticeMaturityStageV1,
} from "./contracts.js";

const nonEmpty = (value: string | undefined): string | null => {
  const normalized = value?.trim() ?? "";
  return normalized.length === 0 ? null : normalized;
};

export const classifyPracticeMasteryScopeV1 = (
  prior: readonly PracticeMasteryRecordV1[],
  proof: PracticeMasteryProofV1,
): PracticeMasteryScopeV1 => {
  const referenceFingerprint = nonEmpty(proof.referenceFingerprint);
  const sourceFingerprint = nonEmpty(proof.sourceFingerprint);
  if (referenceFingerprint === null || sourceFingerprint === null) {
    return "REFERENCE_VERIFIED";
  }

  const hasMaterialTransfer = prior.some((record) => {
    const priorReference = nonEmpty(record.referenceFingerprint);
    const priorSource = nonEmpty(record.sourceFingerprint);
    return priorReference !== null
      && priorSource !== null
      && priorReference !== referenceFingerprint
      && priorSource !== sourceFingerprint;
  });
  return hasMaterialTransfer ? "TRANSFER_VERIFIED" : "REFERENCE_VERIFIED";
};

export const buildPracticeHeldOutBenchmarkCaseV1 = (input: {
  readonly sessionId: string;
  readonly proof: PracticeMasteryProofV1;
  readonly proofRef: string;
  readonly appliedSkillIds?: readonly string[];
  readonly traceReasons?: readonly string[];
}): PracticeHeldOutBenchmarkCaseV1 => {
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
    appliedSkillIds: [...new Set((input.appliedSkillIds ?? [])
      .map((skillId) => skillId.trim())
      .filter(Boolean))],
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
    const appliedSkillIds = [...new Set((item.appliedSkillIds ?? [])
      .map((skillId) => skillId.trim())
      .filter(Boolean))];
    for (const skillId of appliedSkillIds) {
      if (!requiredLearnedSkills.has(skillId)) {
        reasons.push(
          "Held-out case references a skill that is not retained as TRANSFER_VERIFIED: "
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
      for (const skillId of appliedSkillIds) {
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
