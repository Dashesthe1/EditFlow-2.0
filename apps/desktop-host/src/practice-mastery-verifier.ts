import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  classifyEffectFamilyV1,
  detectDenseEffectWindowsV1,
} from "../../../packages/visual-effects-intelligence/src/index.js";
import {
  LocalPracticeMediaMatcherV1,
  comparePracticeM6AlignedWindowsV1,
  hasRepeatedSceneGeometryV1,
  finalizePracticeSimilarityReportV1,
  resolvePracticeLocalMediaPathV1,
  type GptOrchestrationAssignmentV1,
  type PracticeMasteryProofV1,
  type PracticeReferenceShotV1,
  type PracticeSceneMatchV1,
  type PracticeSimilarityReportV1,
} from "../../../packages/practice-homework/src/index.js";
import { buildPracticeCrossSourceSubjectProofV1 } from "./practice-cross-source-subject-proof.js";
import { PracticeM6LocalMediaAnalyzerV1 } from "./practice-m6-media.js";

export interface PracticeMasteryVerifierConfigV1 {
  readonly repositoryRoot: string;
  readonly ffmpegPath?: string;
}

export interface PracticeMasteryVerificationResultV1 {
  readonly proof: PracticeMasteryProofV1;
  readonly proofRef: string;
}

const unique = (values: readonly string[]): readonly string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const oneEvidenceFingerprint = (
  refs: readonly string[],
  prefix: string,
  label: string,
): string => {
  const values = unique(refs
    .filter((ref) => ref.startsWith(prefix))
    .map((ref) => ref.slice(prefix.length)));
  if (values.length !== 1) {
    throw new TypeError(
      "Practice mastery requires exactly one " + label + " content fingerprint.",
    );
  }
  return values[0]!;
};

export const practiceSourceMediaSha256FromMatchesV1 = (
  matches: readonly PracticeSceneMatchV1[],
): readonly string[] => [...unique(
  matches
    .flatMap((match) => match.evidenceRefs)
    .filter((ref) => ref.startsWith("source-video:sha256:"))
    .map((ref) => ref.slice("source-video:sha256:".length)),
)].sort();

const sourceSetFingerprint = (
  matches: readonly PracticeSceneMatchV1[],
): string => {
  const sourceMediaSha256 = practiceSourceMediaSha256FromMatchesV1(matches);
  if (sourceMediaSha256.length === 0) {
    throw new TypeError("Practice mastery requires content-addressed Start video evidence.");
  }
  const identities = sourceMediaSha256.map((value) => "source-video:sha256:" + value);
  return createHash("sha256").update(identities.join("\n"), "utf8").digest("hex");
};

export const validatePracticeReferenceCoverageV1 = (
  shots: readonly PracticeReferenceShotV1[],
  durationMs: number,
  fps: number,
): readonly string[] => {
  const reasons: string[] = [];
  if (shots.length === 0) return ["Finish decomposition contains no shots."];
  const ordered = [...shots].sort((a, b) => a.order - b.order);
  const frameMs = Number.isFinite(fps) && fps > 0 ? 1000 / fps : 1000 / 30;
  const toleranceMs = Math.max(1, frameMs * 1.5);
  for (let index = 0; index < ordered.length; index += 1) {
    const shot = ordered[index]!;
    if (!Number.isFinite(shot.referenceStartMs)
      || !Number.isFinite(shot.referenceEndMs)
      || shot.referenceEndMs <= shot.referenceStartMs) {
      reasons.push("Finish shot " + shot.shotId + " has an invalid reference range.");
      continue;
    }
    if (index > 0 && shot.order <= ordered[index - 1]!.order) {
      reasons.push("Finish shot order is not strictly increasing at " + shot.shotId + ".");
    }
    if (index > 0) {
      const delta = shot.referenceStartMs - ordered[index - 1]!.referenceEndMs;
      if (delta > toleranceMs) {
        reasons.push("Finish decomposition has an uncovered timeline gap before " + shot.shotId + ".");
      } else if (delta < -toleranceMs) {
        reasons.push("Finish decomposition has a material shot overlap before " + shot.shotId + ".");
      }
    }
  }
  if (ordered[0]!.referenceStartMs > toleranceMs) {
    reasons.push("Finish decomposition does not cover the beginning of the reference.");
  }
  if (Math.abs(ordered[ordered.length - 1]!.referenceEndMs - durationMs) > toleranceMs) {
    reasons.push("Finish decomposition does not cover the full reference duration.");
  }
  return unique(reasons);
};

export const validatePracticeSceneMatchesV1 = (
  shotIds: readonly string[],
  matches: readonly PracticeSceneMatchV1[],
  minimumConfidence: number,
  videoSourceIds: readonly string[],
): readonly string[] => {
  const reasons: string[] = [];
  const knownSources = new Set(videoSourceIds);
  const grouped = new Map<string, PracticeSceneMatchV1[]>();
  for (const match of matches) {
    grouped.set(match.shotId, [...(grouped.get(match.shotId) ?? []), match]);
  }
  for (const shotId of shotIds) {
    const values = grouped.get(shotId) ?? [];
    if (values.length !== 1) {
      reasons.push("Scene matching must retain exactly one match for " + shotId + ".");
      continue;
    }
    const match = values[0]!;
    if (match.confidence < minimumConfidence) {
      reasons.push("Source match confidence for " + shotId + " is below the exact-scene gate.");
    } else if (!hasRepeatedSceneGeometryV1(match)) {
      reasons.push(
        "Source match for " + shotId
          + " lacks repeated geometric proof required by the exact-scene gate.",
      );
    }
    if (match.candidateMargin !== undefined
      && (!Number.isFinite(match.candidateMargin) || match.candidateMargin < 0.02)) {
      reasons.push(
        "Source match for " + shotId
          + " is too ambiguous against its retained runner-up for exact-scene certification.",
      );
    }
    if (!knownSources.has(match.sourceId)) {
      reasons.push("Source match for " + shotId + " does not belong to the indexed Start video set.");
    }
    const identities = unique(match.evidenceRefs.filter((ref) => ref.startsWith("source-video:sha256:")));
    if (identities.length !== 1) {
      reasons.push("Source match for " + shotId + " must retain exactly one content-addressed video identity.");
    }
    if (match.sourceEndMs <= match.sourceStartMs) {
      reasons.push("Source match for " + shotId + " has an invalid time range.");
    }
    if (!Number.isFinite(match.playbackRate) || match.playbackRate <= 0) {
      reasons.push("Source match for " + shotId + " has an invalid playback rate.");
    }
    const trajectory = [...(match.trajectory ?? [])]
      .sort((a, b) => a.referenceTimeMs - b.referenceTimeMs);
    if (trajectory.some((point) =>
      !Number.isFinite(point.referenceTimeMs)
      || !Number.isFinite(point.sourceTimeMs)
      || !Number.isFinite(point.similarity)
      || point.similarity < 0
      || point.similarity > 1)) {
      reasons.push("Source-time trajectory for " + shotId + " contains invalid measurements.");
    }
    if (trajectory.some((point, index) =>
      index > 0 && point.referenceTimeMs <= trajectory[index - 1]!.referenceTimeMs)) {
      reasons.push("Source-time trajectory for " + shotId + " is not strictly ordered.");
    }
    if (match.temporalBehavior === "FORWARD_THEN_REWIND") {
      if (match.rewind?.detected !== true || trajectory.length < 3) {
        reasons.push(
          "Source match for " + shotId
            + " claims a rewind without retained multi-point source-time evidence.",
        );
      } else {
        const sourceDeltas = trajectory.slice(1).map((point, index) =>
          point.sourceTimeMs - trajectory[index]!.sourceTimeMs);
        const firstNegative = sourceDeltas.findIndex((value) => value < -18);
        const hasForwardBefore = firstNegative > 0
          && sourceDeltas.slice(0, firstNegative).some((value) => value > 18);
        const hasReverseAfter = firstNegative >= 0
          && sourceDeltas.slice(firstNegative).every((value) => value < 18);
        if (!hasForwardBefore || !hasReverseAfter) {
          reasons.push(
            "Source match for " + shotId
              + " claims a rewind but its retained trajectory does not travel forward then backward.",
          );
        }
      }
    }
    if (match.rewind !== undefined) {
      const rewind = match.rewind;
      if (match.temporalBehavior !== "FORWARD_THEN_REWIND"
        || !Number.isFinite(rewind.referenceStartMs)
        || !Number.isFinite(rewind.referenceEndMs)
        || rewind.referenceEndMs <= rewind.referenceStartMs
        || !Number.isFinite(rewind.sourceStartMs)
        || !Number.isFinite(rewind.sourceEndMs)
        || rewind.sourceStartMs <= rewind.sourceEndMs
        || !Number.isFinite(rewind.rewindSpanMs)
        || rewind.rewindSpanMs <= 0
        || !Number.isFinite(rewind.confidence)
        || rewind.confidence < 0.55
        || rewind.confidence > 1) {
        reasons.push("Source match for " + shotId + " has invalid measured rewind evidence.");
      } else {
        const measuredSpan = rewind.sourceStartMs - rewind.sourceEndMs;
        const tolerance = Math.max(30, rewind.rewindSpanMs * 0.2);
        if (Math.abs(measuredSpan - rewind.rewindSpanMs) > tolerance) {
          reasons.push("Source match for " + shotId + " has inconsistent rewind span evidence.");
        }
      }
    }
  }
  return unique(reasons);
};

const assertNonEmptyFile = async (value: string): Promise<string> => {
  const resolved = resolvePracticeLocalMediaPathV1(value);
  const metadata = await stat(resolved);
  if (!metadata.isFile() || metadata.size <= 0) {
    throw new TypeError("Practice mastery requires a non-empty final render file.");
  }
  return resolved;
};

const durationMsForReference = (
  assignment: GptOrchestrationAssignmentV1,
  reference: Awaited<ReturnType<LocalPracticeMediaMatcherV1["analyzeFinish"]>>,
): number => {
  const duration = reference.video?.durationMs
    ?? Math.max(0, ...reference.shots.map((shot) => shot.referenceEndMs));
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new TypeError(
      "Practice mastery verification could not establish the Finish duration for "
        + assignment.sessionId + ".",
    );
  }
  return duration;
};

export class PracticeMasteryVerifierV1 {
  readonly repositoryRoot: string;
  readonly ffmpegPath: string | undefined;

  constructor(config: PracticeMasteryVerifierConfigV1) {
    this.repositoryRoot = path.resolve(config.repositoryRoot);
    this.ffmpegPath = config.ffmpegPath;
  }

  async verify(input: {
    readonly assignment: GptOrchestrationAssignmentV1;
    readonly finalRenderRef: string;
    readonly minimumSimilarity?: number;
    readonly exactSceneConfidence?: number;
    readonly minimumAudioConfidence?: number;
  }): Promise<PracticeMasteryVerificationResultV1> {
    if (input.assignment.mode !== "PRACTICE" || input.assignment.finish === null) {
      throw new TypeError("Practice mastery verification requires a Practice assignment.");
    }
    const minimumSimilarity = input.minimumSimilarity ?? 0.95;
    const exactSceneConfidence = input.exactSceneConfidence ?? 0.95;
    const minimumAudioConfidence = input.minimumAudioConfidence ?? 0.90;
    const finalRenderRef = await assertNonEmptyFile(input.finalRenderRef);
    const proofDir = path.join(
      input.assignment.artifactDir,
      "mastery-verification",
    );
    await mkdir(proofDir, { recursive: true });

    const matcher = new LocalPracticeMediaMatcherV1({
      artifactDir: path.join(proofDir, "media"),
      analysisCacheDir: path.join(
        this.repositoryRoot,
        "proofs",
        "artifacts",
        "practice-media-cache",
      ),
      scriptPath: path.join(
        this.repositoryRoot,
        "scripts",
        "practice",
        "practice-media-match.py",
      ),
      ...(this.ffmpegPath === undefined ? {} : { ffmpegPath: this.ffmpegPath }),
    });
    const analyzer = new PracticeM6LocalMediaAnalyzerV1({
      repositoryRoot: this.repositoryRoot,
      artifactDir: path.join(proofDir, "m6"),
    });

    const reference = await matcher.analyzeFinish(input.assignment.finish);
    const sourceIndex = await matcher.indexStart(input.assignment.start);
    const durationMs = durationMsForReference(input.assignment, reference);
    const referenceCoverageReasons = validatePracticeReferenceCoverageV1(
      reference.shots,
      durationMs,
      reference.video?.fps ?? 30,
    );
    const matches = await matcher.matchScenes({
      reference,
      sourceIndex,
      minimumConfidence: exactSceneConfidence,
    });
    const matchReasons = unique([
      ...referenceCoverageReasons,
      ...validatePracticeSceneMatchesV1(
        reference.shots.map((shot) => shot.shotId),
        matches,
        exactSceneConfidence,
        sourceIndex.videoSourceIds,
      ),
    ]);
    const audioMatch = sourceIndex.audioSourceIds.length === 0
      ? null
      : await matcher.matchAudio({
        reference,
        sourceIndex,
        minimumConfidence: minimumAudioConfidence,
      });

    const audioReasons = sourceIndex.audioSourceIds.length === 0
      ? []
      : audioMatch === null
        ? ["Raw audio was supplied but no source-to-Finish audio match was proven."]
        : audioMatch.overallConfidence < minimumAudioConfidence
          ? ["Source audio match is below the Practice audio confidence gate."]
          : [];
    const referenceFingerprint = oneEvidenceFingerprint(
      reference.evidenceRefs,
      "video:sha256:",
      "Finish reference",
    );
    const sourceMediaSha256 = practiceSourceMediaSha256FromMatchesV1(matches);
    const sourceFingerprint = sourceSetFingerprint(matches);

    const content = await analyzer.compareContentStructure({
      reference,
      renderPath: finalRenderRef,
      matches,
    });
    const temporalBehaviorReasons = content.temporalBehaviorProof === undefined
      || content.temporalBehaviorProof.passed
      ? []
      : content.temporalBehaviorProof.reasons;
    if (reference.sourcePath === undefined) {
      throw new TypeError("Practice mastery verification requires the local Finish source path.");
    }
    const referenceEvidence = await analyzer.analyzeVideo({
      videoPath: reference.sourcePath,
      sourceId: "mastery-reference:" + input.assignment.sessionId,
      sourceKind: "REFERENCE",
      startMs: 0,
      endMs: durationMs,
    });
    const renderEvidence = await analyzer.analyzeVideo({
      videoPath: finalRenderRef,
      sourceId: "mastery-render:" + input.assignment.sessionId,
      sourceKind: "RENDER",
      startMs: 0,
      endMs: durationMs,
    });

    const referenceSequence = detectDenseEffectWindowsV1(referenceEvidence);
    const renderSequence = detectDenseEffectWindowsV1(renderEvidence);
    const crossSourceSubjectProof = await buildPracticeCrossSourceSubjectProofV1({
      reference,
      sequence: referenceSequence,
      matches,
      binder: analyzer,
    });
    const effectFamilyIds = unique(
      referenceSequence.windows
        .map((window) => classifyEffectFamilyV1(window.evidence))
        .filter((family) => family !== "UNKNOWN"),
    );
    const compared = referenceSequence.windows.length === 0
      ? {
        definingCoverage: 1,
        effectFidelity: 1,
        transitionFidelity: 1,
        objectAwareProof: {
          schema: "editflow.practice-object-aware-proof.v1" as const,
          required: false,
          referenceWindowCount: 0,
          matchedWindowCount: 0,
          passedWindowCount: 0,
          overallScore: 1,
          verified: false,
          windows: [],
          reasons: [],
          evidenceRefs: [],
        },
        diagnoses: [] as readonly string[],
        evidenceRefs: unique([
          ...referenceSequence.evidenceRefs,
          ...renderSequence.evidenceRefs,
        ]),
      }
      : comparePracticeM6AlignedWindowsV1(referenceSequence, renderSequence);

    const crossSourceSubjectReasons = compared.objectAwareProof.required
      ? !crossSourceSubjectProof.required
        ? ["Object-aware proof requires Finish-to-Start subject binding, but no binding proof was generated."]
        : crossSourceSubjectProof.verified
          ? []
          : crossSourceSubjectProof.reasons.length > 0
            ? crossSourceSubjectProof.reasons
            : ["Finish-to-Start subject binding did not satisfy the machine proof gate."]
      : [];

    const rawReport: PracticeSimilarityReportV1 = {
      schema: "editflow.practice-similarity.v1",
      breakdown: {
        sceneIdentity: content.sceneIdentity,
        temporalAlignment: content.temporalAlignment,
        cutTiming: content.cutTiming,
        framing: content.framing,
        motion: content.motion,
        effectFidelity: compared.effectFidelity,
        transitionFidelity: compared.transitionFidelity,
        colorFinish: content.colorFinish,
        pixelStructure: content.pixelStructure,
      },
      definingEffectCoverage: compared.definingCoverage,
      wrongSceneCount: content.wrongSceneCount,
      unmatchedSceneCount: Math.max(
        content.unmatchedSceneCount,
        matchReasons.length === 0 ? 0 : 1,
      ),
      overallSimilarity: 0,
      passed: false,
      reasons: unique([
        ...(content.evidenceRefs.length === 0
          ? ["Content comparison produced no retained evidence."]
          : []),
        ...compared.diagnoses,
        ...crossSourceSubjectReasons,
        ...temporalBehaviorReasons,
        ...matchReasons,
        ...audioReasons,
      ]),
      evidenceRefs: unique([
        ...reference.evidenceRefs,
        ...sourceIndex.evidenceRefs,
        ...matches.flatMap((match) => match.evidenceRefs),
        ...(audioMatch?.evidenceRefs ?? []),
        ...content.evidenceRefs,
        ...(content.temporalBehaviorProof?.evidenceRefs ?? []),
        ...compared.evidenceRefs,
        ...crossSourceSubjectProof.evidenceRefs,
      ]),
    };
    const finalized = finalizePracticeSimilarityReportV1(
      rawReport,
      minimumSimilarity,
    );

    const objectAwareReasons = compared.objectAwareProof.required
      && !compared.objectAwareProof.verified
      ? compared.objectAwareProof.reasons
      : [];
    const blockingReasons = unique([
      ...matchReasons,
      ...audioReasons,
      ...temporalBehaviorReasons,
      ...objectAwareReasons,
      ...crossSourceSubjectReasons,
    ]);
    const report: PracticeSimilarityReportV1 = {
      ...finalized,
      passed: finalized.passed && blockingReasons.length === 0
        && finalized.evidenceRefs.length > 0,
      reasons: unique([...finalized.reasons, ...blockingReasons]),
    };
    const proof: PracticeMasteryProofV1 = {
      schema: "editflow.practice-mastery-proof.v1",
      sessionId: input.assignment.sessionId,
      editTypeId: input.assignment.editTypeId,
      referenceId: reference.referenceId,
      sourceIndexId: sourceIndex.indexId,
      referenceFingerprint,
      sourceFingerprint,
      sourceMediaSha256,
      finalRenderRef,
      minimumSimilarity,
      exactSceneConfidence,
      effectFamilyIds,
      objectAwareProof: compared.objectAwareProof,
      crossSourceSubjectProof,
      report,
      matches,
      audioMatch,
      evidenceRefs: report.evidenceRefs,
      verifiedAt: new Date().toISOString(),
    };
    const proofRef = path.join(proofDir, "practice-mastery-proof.json");
    await writeFile(proofRef, JSON.stringify(proof, null, 2) + "\n", "utf8");
    return { proof, proofRef };
  }
}
