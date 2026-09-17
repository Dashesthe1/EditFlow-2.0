import type { CapabilityRegistry } from "../../capability-registry/src/index.js";
import type {
  TutorialAnalyzerV0,
  TutorialLearningResultV0,
  TutorialUploadV0,
} from "./contracts.js";
import { compileTutorialLessonV0, TutorialLessonValidationError } from "./compiler.js";
import { discoverTutorialCapabilitiesV0 } from "./capability-discovery.js";

const requireUploadText = (value: string, field: string): void => {
  if (value.trim().length === 0) throw new TutorialLessonValidationError(`${field} must not be empty.`);
};

export const learnFromTutorialUploadV0 = async (
  upload: TutorialUploadV0,
  analyzer: TutorialAnalyzerV0,
  registry: CapabilityRegistry,
  generatedAt?: string,
): Promise<TutorialLearningResultV0> => {
  requireUploadText(upload.uploadId, "uploadId");
  requireUploadText(upload.mediaRef, "mediaRef");
  const packet = await analyzer.analyze(upload);
  if (packet.sourceRef !== upload.mediaRef) {
    throw new TutorialLessonValidationError("Analyzer sourceRef must match the tutorial upload mediaRef.");
  }
  const lesson = compileTutorialLessonV0(packet);
  const capabilityReport = generatedAt === undefined
    ? discoverTutorialCapabilitiesV0(lesson, registry)
    : discoverTutorialCapabilitiesV0(lesson, registry, generatedAt);
  return { lesson, capabilityReport };
};
