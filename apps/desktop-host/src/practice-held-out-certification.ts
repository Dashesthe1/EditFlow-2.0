import type {
  BenchmarkCaseEvidenceV1,
} from "../../../packages/visual-effects-intelligence/src/index.js";
import { loadM6ProfessionalBenchmarkEvidenceV1 } from "./m6-professional-benchmark-evidence.js";
import {
  buildPracticeHeldOutBenchmarkCaseV1,
  evaluatePracticeHeldOutBenchmarkV1,
  type EditTypeRegistryV1,
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
  if (input.registry.transferableKnowledge(editTypeId) === null) {
    throw new TypeError(
      "Held-out certification requires TRANSFER_VERIFIED Practice knowledge.",
    );
  }

  const heldOutCase = buildPracticeHeldOutBenchmarkCaseV1({
    sessionId: input.sessionId,
    proof: input.proof,
    proofRef: input.proofRef,
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
    ...(professionalBenchmarkEvidence === undefined
      ? {}
      : { professionalBenchmarkEvidence }),
  });
  input.registry.recordHeldOutBenchmark(benchmark);
  return { heldOutCase, benchmark };
};
