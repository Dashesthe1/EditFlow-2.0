import type { CapabilityRegistry } from "../../capability-registry/src/index.js";
import type {
  TutorialCapabilityDiscoveryReportV0,
  TutorialSkillState,
  TutorialUploadV0,
} from "./contracts.js";
import {
  compileTutorialDeepLessonV1,
  type TutorialDeepAnalysisPacketV1,
  type TutorialDeepLessonV1,
} from "./deep-analysis.js";
import { discoverTutorialCapabilitiesV0 } from "./capability-discovery.js";
import {
  compileTutorialProofPlanV1,
  type TutorialProofPlanV1,
} from "./proof-compiler.js";
import { TutorialLessonValidationError } from "./compiler.js";

export interface TutorialDeepAnalyzerV1 {
  analyze(upload: TutorialUploadV0): Promise<TutorialDeepAnalysisPacketV1>;
}

export interface TutorialDeepLearningResultV1 {
  readonly schema: "editflow.tutorial-deep-learning-result.v1";
  readonly upload: TutorialUploadV0;
  readonly lesson: TutorialDeepLessonV1;
  readonly capabilityReport: TutorialCapabilityDiscoveryReportV0;
  readonly proofPlans: readonly TutorialProofPlanV1[];
  readonly targetState: TutorialSkillState;
  readonly blockingCapabilityIds: readonly string[];
  readonly readyForReconstruction: boolean;
}

export interface TutorialDeepLearningOptionsV1 {
  readonly generatedAt?: string;
  readonly targetState?: TutorialSkillState;
}

const requireText = (value: string | undefined, field: string): void => {
  if (value !== undefined && value.trim().length === 0) {
    throw new TutorialLessonValidationError(field + " must not be empty when provided.");
  }
};

const validateUploadProvenance = (upload: TutorialUploadV0): void => {
  if (upload.uploadId.trim().length === 0) {
    throw new TutorialLessonValidationError("uploadId must not be empty.");
  }
  if (upload.mediaRef.trim().length === 0) {
    throw new TutorialLessonValidationError("mediaRef must not be empty.");
  }
  requireText(upload.transcriptRef, "transcriptRef");
  requireText(upload.projectFileRef, "projectFileRef");
  requireText(upload.referenceRenderRef, "referenceRenderRef");
  for (const [index, sourceRef] of (upload.sourceMediaRefs ?? []).entries()) {
    if (sourceRef.trim().length === 0) {
      throw new TutorialLessonValidationError(
        "sourceMediaRefs[" + index + "] must not be empty.",
      );
    }
  }
};

export const learnDeepFromTutorialUploadV1 = async (
  upload: TutorialUploadV0,
  analyzer: TutorialDeepAnalyzerV1,
  registry: CapabilityRegistry,
  options: TutorialDeepLearningOptionsV1 = {},
): Promise<TutorialDeepLearningResultV1> => {
  validateUploadProvenance(upload);
  const packet = await analyzer.analyze(structuredClone(upload));
  if (packet.sourceRef !== upload.mediaRef) {
    throw new TutorialLessonValidationError(
      "Analyzer sourceRef must exactly match the tutorial upload mediaRef.",
    );
  }

  const lesson = compileTutorialDeepLessonV1(packet);
  const capabilityReport = options.generatedAt === undefined
    ? discoverTutorialCapabilitiesV0(lesson.legacyLesson, registry)
    : discoverTutorialCapabilitiesV0(lesson.legacyLesson, registry, options.generatedAt);
  const targetState = options.targetState ?? "TRANSFER_VERIFIED";
  const proofPlans = lesson.skills.map((skill) =>
    compileTutorialProofPlanV1(skill, capabilityReport, targetState));
  const blockingCapabilityIds = [...new Set(
    capabilityReport.developmentQueue
      .filter((task) => task.blocking)
      .map((task) => String(task.capabilityId)),
  )].sort();

  return {
    schema: "editflow.tutorial-deep-learning-result.v1",
    upload: structuredClone(upload),
    lesson,
    capabilityReport,
    proofPlans,
    targetState,
    blockingCapabilityIds,
    readyForReconstruction: blockingCapabilityIds.length === 0,
  };
};
