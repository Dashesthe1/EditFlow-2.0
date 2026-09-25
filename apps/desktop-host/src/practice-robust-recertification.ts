import type { BenchmarkCaseEvidenceV1 } from "../../../packages/visual-effects-intelligence/src/index.js";
import type {
  EditTypeRegistryV1,
  PracticeHeldOutBenchmarkReportV1,
  PracticeMaturityStageV1,
  PracticeProgressionGateV1,
  PracticeRetainedTruthSuiteReportV1,
} from "../../../packages/practice-homework/src/index.js";

import { refreshPracticeHeldOutBenchmarkV1 } from "./practice-held-out-certification.js";
import { evaluatePracticeRetainedTruthSuiteManifestV1 } from "./practice-retained-truth-suite.js";

export interface PracticeRobustRecertificationReportV1 {
  readonly schema: "editflow.practice-robust-recertification-report.v1";
  readonly editTypeId: string;
  readonly retainedTruthEvaluatedAt: string;
  readonly retainedTruthCertified: boolean;
  readonly retainedTruthEvidenceRefs: readonly string[];
  readonly heldOutRefreshAttempted: boolean;
  readonly heldOutRefreshCompleted: boolean;
  readonly heldOutRefreshError: string | null;
  readonly heldOutBenchmarkEvaluatedAt: string | null;
  readonly heldOutBenchmarkRobust: boolean | null;
  readonly maturityStage: PracticeMaturityStageV1 | null;
  readonly robustClaimAllowed: boolean;
  readonly progressionGate: PracticeProgressionGateV1;
  readonly evidenceRefs: readonly string[];
}

const uniqueNonEmpty = (values: readonly string[]): readonly string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const errorMessage = (error: unknown): string => error instanceof Error
  ? error.message
  : String(error);

export const applyPracticeRobustRecertificationV1 = (input: {
  readonly registry: EditTypeRegistryV1;
  readonly retainedTruthReport: PracticeRetainedTruthSuiteReportV1;
  readonly repositoryRoot?: string;
  readonly professionalBenchmarkEvidence?: readonly BenchmarkCaseEvidenceV1[];
}): PracticeRobustRecertificationReportV1 => {
  const editTypeId = input.retainedTruthReport.editTypeId.trim();
  if (editTypeId.length === 0) {
    throw new TypeError("Practice ROBUST recertification requires an Edit Type.");
  }
  if (input.registry.get(editTypeId) === null) {
    throw new TypeError(
      "Practice ROBUST recertification targets an unknown Edit Type: " + editTypeId,
    );
  }

  input.registry.recordRetainedTruthSuite(input.retainedTruthReport);
  const retained = input.registry.knowledge(editTypeId);
  if (retained === null) {
    throw new TypeError("Practice ROBUST recertification lost retained Edit Type knowledge.");
  }

  const shouldRefresh = input.retainedTruthReport.certified
    && retained.gptLearning.heldOutCases.length > 0;
  let heldOutBenchmark: PracticeHeldOutBenchmarkReportV1 | null = null;
  let heldOutRefreshError: string | null = null;
  if (shouldRefresh) {
    try {
      heldOutBenchmark = refreshPracticeHeldOutBenchmarkV1({
        registry: input.registry,
        editTypeId,
        ...(input.repositoryRoot === undefined
          ? {}
          : { repositoryRoot: input.repositoryRoot }),
        ...(input.professionalBenchmarkEvidence === undefined
          ? {}
          : { professionalBenchmarkEvidence: input.professionalBenchmarkEvidence }),
      });
    } catch (error) {
      heldOutRefreshError = errorMessage(error);
    }
  }

  const knowledge = input.registry.knowledge(editTypeId);
  if (knowledge === null) {
    throw new TypeError("Practice ROBUST recertification lost final Edit Type knowledge.");
  }
  const benchmarkEvidenceRefs = heldOutBenchmark?.evidenceRefs ?? [];
  return {
    schema: "editflow.practice-robust-recertification-report.v1",
    editTypeId,
    retainedTruthEvaluatedAt: input.retainedTruthReport.evaluatedAt,
    retainedTruthCertified: input.retainedTruthReport.certified,
    retainedTruthEvidenceRefs: uniqueNonEmpty(input.retainedTruthReport.evidenceRefs),
    heldOutRefreshAttempted: shouldRefresh,
    heldOutRefreshCompleted: shouldRefresh && heldOutRefreshError === null,
    heldOutRefreshError,
    heldOutBenchmarkEvaluatedAt: heldOutBenchmark?.evaluatedAt ?? null,
    heldOutBenchmarkRobust: heldOutBenchmark?.robust ?? null,
    maturityStage: knowledge.maturityStage,
    robustClaimAllowed: knowledge.progressionGate.robustClaimAllowed,
    progressionGate: knowledge.progressionGate,
    evidenceRefs: uniqueNonEmpty([
      ...input.retainedTruthReport.evidenceRefs,
      ...benchmarkEvidenceRefs,
    ]),
  };
};

export const recertifyPracticeRobustManifestV1 = async (input: {
  readonly registry: EditTypeRegistryV1;
  readonly manifestPath: string;
  readonly repositoryRoot?: string;
  readonly professionalBenchmarkEvidence?: readonly BenchmarkCaseEvidenceV1[];
}): Promise<PracticeRobustRecertificationReportV1> => {
  const retainedTruthReport = await evaluatePracticeRetainedTruthSuiteManifestV1(
    input.manifestPath,
  );
  return applyPracticeRobustRecertificationV1({
    registry: input.registry,
    retainedTruthReport,
    ...(input.repositoryRoot === undefined
      ? {}
      : { repositoryRoot: input.repositoryRoot }),
    ...(input.professionalBenchmarkEvidence === undefined
      ? {}
      : { professionalBenchmarkEvidence: input.professionalBenchmarkEvidence }),
  });
};
