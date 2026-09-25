import type {
  BenchmarkCaseEvidenceV1,
} from "../../../packages/visual-effects-intelligence/src/index.js";
import { loadM6ProfessionalBenchmarkEvidenceV1 } from "./m6-professional-benchmark-evidence.js";
import {
  attestPracticeSkillUseV1,
  buildPracticeHeldOutBenchmarkCaseV1,
  evaluatePracticeHeldOutBenchmarkV1,
  type EditTypeRegistryV1,
  type PracticeAttemptV1,
  type PracticeHeldOutBenchmarkCaseV1,
  type PracticeHeldOutBenchmarkReportV1,
  type PracticeMasteryProofV1,
} from "../../../packages/practice-homework/src/index.js";

export interface PracticeHeldOutCertificationRecordV1 {
  readonly heldOutCase: PracticeHeldOutBenchmarkCaseV1;
  readonly benchmark: PracticeHeldOutBenchmarkReportV1;
}

export const recordPracticeHeldOutCertificationV1 = (input: {
  readonly registry: EditTypeRegistryV1;
  readonly editTypeId: string;
  readonly sessionId: string;
  readonly proof: PracticeMasteryProofV1;
  readonly proofRef: string;
  readonly appliedSkillIds?: readonly string[];
  readonly attempt?: PracticeAttemptV1 | null;
  readonly repositoryRoot?: string;
  readonly professionalBenchmarkEvidence?: readonly BenchmarkCaseEvidenceV1[];
  readonly traceReasons?: readonly string[];
}): PracticeHeldOutCertificationRecordV1 => {
  const editTypeId = input.editTypeId.trim();
  if (editTypeId.length === 0) {
    throw new TypeError("Held-out certification requires an Edit Type.");
  }
  if (input.proof.editTypeId !== editTypeId) {
    throw new TypeError("Held-out proof Edit Type does not match the certification target.");
  }
  if (input.proof.sessionId !== input.sessionId) {
    throw new TypeError("Held-out proof session does not match the certification session.");
  }
  const transferable = input.registry.transferableKnowledge(editTypeId);
  if (transferable === null) {
    throw new TypeError(
      "Held-out certification requires TRANSFER_VERIFIED Practice knowledge.",
    );
  }
  const appliedSkillIds = [...new Set((input.appliedSkillIds ?? [])
    .map((skillId) => skillId.trim())
    .filter(Boolean))];
  const transferableSkillIds = new Set(
    transferable.gptLearning.learnedSkills.map((skill) => skill.skillId),
  );
  const unknownAppliedSkillIds = appliedSkillIds.filter(
    (skillId) => !transferableSkillIds.has(skillId),
  );
  if (unknownAppliedSkillIds.length > 0) {
    throw new TypeError(
      "Held-out certification referenced skills that are not retained as TRANSFER_VERIFIED: "
        + unknownAppliedSkillIds.join(", "),
    );
  }

  const skillUseAttestations = attestPracticeSkillUseV1({
    skills: transferable.gptLearning.learnedSkills,
    attempt: input.attempt ?? null,
    proof: input.proof,
  });
  const heldOutCase = buildPracticeHeldOutBenchmarkCaseV1({
    sessionId: input.sessionId,
    proof: input.proof,
    proofRef: input.proofRef,
    appliedSkillIds,
    skillUseAttestations,
    ...(input.traceReasons === undefined ? {} : { traceReasons: input.traceReasons }),
  });
  input.registry.recordHeldOutCase(editTypeId, heldOutCase);

  const retained = input.registry.knowledge(editTypeId);
  if (retained === null) {
    throw new TypeError("Held-out certification lost its Edit Type registry entry.");
  }
  const professionalBenchmarkEvidence = input.professionalBenchmarkEvidence
    ?? (input.repositoryRoot === undefined
      ? undefined
      : loadM6ProfessionalBenchmarkEvidenceV1(input.repositoryRoot));
  const benchmark = evaluatePracticeHeldOutBenchmarkV1({
    editTypeId,
    cases: retained.gptLearning.heldOutCases,
    priorMasteryRecords: retained.gptLearning.masteryRecords,
    priorLearnedSkills: retained.gptLearning.learnedSkills,
    retainedTruthSuiteReports: retained.gptLearning.retainedTruthSuiteReports,
    ...(professionalBenchmarkEvidence === undefined
      ? {}
      : { professionalBenchmarkEvidence }),
  });
  input.registry.recordHeldOutBenchmark(benchmark);
  return { heldOutCase, benchmark };
};

export const refreshPracticeHeldOutBenchmarkV1 = (input: {
  readonly registry: EditTypeRegistryV1;
  readonly editTypeId: string;
  readonly repositoryRoot?: string;
  readonly professionalBenchmarkEvidence?: readonly BenchmarkCaseEvidenceV1[];
}): PracticeHeldOutBenchmarkReportV1 => {
  const editTypeId = input.editTypeId.trim();
  if (editTypeId.length === 0) {
    throw new TypeError("Held-out benchmark refresh requires an Edit Type.");
  }
  const retained = input.registry.knowledge(editTypeId);
  if (retained === null) {
    throw new TypeError("Held-out benchmark refresh requires retained Edit Type knowledge.");
  }
  if (retained.gptLearning.heldOutCases.length === 0) {
    throw new TypeError("Held-out benchmark refresh requires retained held-out cases.");
  }
  const professionalBenchmarkEvidence = input.professionalBenchmarkEvidence
    ?? (input.repositoryRoot === undefined
      ? undefined
      : loadM6ProfessionalBenchmarkEvidenceV1(input.repositoryRoot));
  const benchmark = evaluatePracticeHeldOutBenchmarkV1({
    editTypeId,
    cases: retained.gptLearning.heldOutCases,
    priorMasteryRecords: retained.gptLearning.masteryRecords,
    priorLearnedSkills: retained.gptLearning.learnedSkills,
    retainedTruthSuiteReports: retained.gptLearning.retainedTruthSuiteReports,
    ...(professionalBenchmarkEvidence === undefined
      ? {}
      : { professionalBenchmarkEvidence }),
  });
  input.registry.recordHeldOutBenchmark(benchmark);
  return benchmark;
};
