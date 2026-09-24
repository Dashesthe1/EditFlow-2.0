import { createHash } from "node:crypto";

import type {
  EditTypeKnowledgeSnapshotV1,
  PracticeAttemptV1,
  PracticeMasteryProofV1,
  PracticeReferenceAnalysisV1,
  PracticeSceneMatchV1,
  PracticeSubjectIdentityMemoryV1,
  PracticeVerifiedSubjectMaskSourceV1,
} from "./contracts.js";

const unique = (values: readonly string[]): readonly string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const MASK_SOURCE_PREFIX = "practice-subject-mask-source:";

const VERIFIED_MASK_SOURCES = new Set<PracticeVerifiedSubjectMaskSourceV1>([
  "SEGMENTATION",
  "AE_TRACKED_MASK",
  "ROTO_BRUSH",
]);

const evidenceValues = (
  refs: readonly string[],
  prefix: string,
): readonly string[] => unique(
  refs.filter((ref) => ref.startsWith(prefix)).map((ref) => ref.slice(prefix.length)),
);

const sourceVideoSha256ForMatch = (
  match: PracticeSceneMatchV1,
): string | null => {
  const values = evidenceValues(match.evidenceRefs, "source-video:sha256:");
  return values.length === 1 ? values[0]! : null;
};

export const practiceSourceMediaSha256V1 = (
  matches: readonly PracticeSceneMatchV1[],
): readonly string[] => [...unique(matches
  .map(sourceVideoSha256ForMatch)
  .filter((value): value is string => value !== null))].sort();

export const practiceSourceSetFingerprintV1 = (
  matches: readonly PracticeSceneMatchV1[],
): string | null => {
  const sourceMediaSha256 = practiceSourceMediaSha256V1(matches);
  if (sourceMediaSha256.length === 0) return null;
  const identities = sourceMediaSha256
    .map((value) => "source-video:sha256:" + value);
  return createHash("sha256")
    .update(identities.join("\n"), "utf8")
    .digest("hex");
};

const referenceFingerprintV1 = (
  reference: PracticeReferenceAnalysisV1,
): string | null => {
  const values = evidenceValues(reference.evidenceRefs, "video:sha256:");
  return values.length === 1 ? values[0]! : null;
};

const maskSourcesForAttempt = (
  attempt: PracticeAttemptV1 | null,
): readonly PracticeVerifiedSubjectMaskSourceV1[] => {
  if (attempt === null) return [];
  return unique(attempt.evidenceRefs
    .filter((ref) => ref.startsWith(MASK_SOURCE_PREFIX))
    .map((ref) => ref.slice(MASK_SOURCE_PREFIX.length)))
    .filter((value): value is PracticeVerifiedSubjectMaskSourceV1 =>
      VERIFIED_MASK_SOURCES.has(value as PracticeVerifiedSubjectMaskSourceV1));
};

const memoryIdFor = (material: object): string =>
  "practice-subject-memory:" + createHash("sha256")
    .update(JSON.stringify(material), "utf8")
    .digest("hex")
    .slice(0, 24);

export const buildPracticeSubjectIdentityMemoriesV1 = (input: {
  readonly sessionId: string;
  readonly proof: PracticeMasteryProofV1;
  readonly attempt: PracticeAttemptV1 | null;
}): readonly PracticeSubjectIdentityMemoryV1[] => {
  const crossSource = input.proof.crossSourceSubjectProof;
  const maskSources = maskSourcesForAttempt(input.attempt);
  if (crossSource?.verified !== true || maskSources.length === 0) return [];

  const matchByBinding = new Map(
    input.proof.matches.map((match) => [
      match.shotId + "\u0000" + match.sourceId,
      match,
    ]),
  );
  const output: PracticeSubjectIdentityMemoryV1[] = [];
  for (const binding of crossSource.bindings) {
    if (!binding.verified
      || binding.sourceSemanticId === null
      || binding.sourceSubjectBox === null
      || binding.sourceVideo === undefined
      || binding.algorithmId === undefined
      || binding.algorithmId.trim().length === 0) {
      continue;
    }

    const match = matchByBinding.get(binding.shotId + "\u0000" + binding.sourceId);
    if (match === undefined) continue;
    const sourceVideoSha256 = sourceVideoSha256ForMatch(match);
    if (sourceVideoSha256 === null) continue;
    const identityMaterial = {
      referenceFingerprint: input.proof.referenceFingerprint,
      sourceFingerprint: input.proof.sourceFingerprint,
      sourceVideoSha256,
      referenceWindowId: binding.referenceWindowId,
      shotId: binding.shotId,
      sourceId: binding.sourceId,
      referenceSemanticId: binding.referenceSemanticId,
      sourceSemanticId: binding.sourceSemanticId,
      referenceTimeMs: binding.referenceTimeMs,
      sourceTimeMs: binding.sourceTimeMs,
      sourceSubjectBox: binding.sourceSubjectBox,
    };
    const subjectEvidence = input.attempt?.evidenceRefs.filter((ref) =>
      ref.startsWith("practice-subject-")
      || ref.startsWith("practice-tracked-mask-")
      || ref.startsWith("practice-roto-")
      || ref.startsWith("m4-segmentation-runtime-evidence:")) ?? [];
    output.push({
      memoryId: memoryIdFor(identityMaterial),
      sessionId: input.sessionId,

      referenceFingerprint: input.proof.referenceFingerprint,
      sourceFingerprint: input.proof.sourceFingerprint,
      sourceMediaSha256: [...(input.proof.sourceMediaSha256 ?? [])],
      sourceVideoSha256,
      referenceWindowId: binding.referenceWindowId,
      shotId: binding.shotId,
      sourceId: binding.sourceId,
      referenceSemanticId: binding.referenceSemanticId,
      sourceSemanticId: binding.sourceSemanticId,
      referenceTimeMs: binding.referenceTimeMs,
      sourceTimeMs: binding.sourceTimeMs,
      referenceSubjectBox: [...binding.referenceSubjectBox] as
        [number, number, number, number],
      sourceSubjectBox: [...binding.sourceSubjectBox] as
        [number, number, number, number],
      confidence: binding.confidence,
      algorithmId: binding.algorithmId,
      sourceVideo: structuredClone(binding.sourceVideo),
      maskSources,
      evidenceRefs: unique([
        ...binding.evidenceRefs,
        ...subjectEvidence,
        "practice-subject-memory-source-session:" + input.sessionId,
      ]),
      verifiedAt: input.proof.verifiedAt,
    });

  }
  return output.sort((left, right) =>
    left.referenceWindowId.localeCompare(right.referenceWindowId)
      || left.shotId.localeCompare(right.shotId)
      || left.sourceId.localeCompare(right.sourceId));
};

export const selectReusablePracticeSubjectIdentityMemoryV1 = (input: {
  readonly knowledge: EditTypeKnowledgeSnapshotV1;
  readonly reference: PracticeReferenceAnalysisV1;
  readonly matches: readonly PracticeSceneMatchV1[];
  readonly referenceWindowId: string;
  readonly shotId: string;
  readonly sourceMatch: PracticeSceneMatchV1;
  readonly referenceSemanticId: string;
}): PracticeSubjectIdentityMemoryV1 | null => {
  const referenceFingerprint = referenceFingerprintV1(input.reference);
  const sourceFingerprint = practiceSourceSetFingerprintV1(input.matches);
  const sourceVideoSha256 = sourceVideoSha256ForMatch(input.sourceMatch);
  if (referenceFingerprint === null
    || sourceFingerprint === null
    || sourceVideoSha256 === null) {
    return null;
  }

  const candidates = input.knowledge.gptLearning.masteryRecords
    .filter((record) =>
      record.referenceFingerprint === referenceFingerprint
      && record.sourceFingerprint === sourceFingerprint)
    .flatMap((record) => record.subjectIdentityMemories ?? [])
    .filter((memory) =>
      memory.referenceFingerprint === referenceFingerprint
      && memory.sourceFingerprint === sourceFingerprint
      && memory.sourceVideoSha256 === sourceVideoSha256
      && memory.referenceWindowId === input.referenceWindowId
      && memory.shotId === input.shotId
      && memory.sourceId === input.sourceMatch.sourceId
      && memory.referenceSemanticId === input.referenceSemanticId
      && memory.maskSources.length > 0
      && memory.evidenceRefs.length > 0);

  const ordered = [...candidates].sort((left, right) =>
    right.verifiedAt.localeCompare(left.verifiedAt)
      || right.confidence - left.confidence
      || left.memoryId.localeCompare(right.memoryId));
  return ordered[0] === undefined ? null : structuredClone(ordered[0]);
};
