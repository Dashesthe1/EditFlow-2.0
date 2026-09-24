import type {
  DenseEffectSequenceV1,
  DenseEffectWindowV1,
} from "../../../packages/visual-effects-intelligence/src/index.js";
import {
  buildPracticeReferenceAnatomyV1,
  summarizePracticeSubjectIdentityV1,
  type PracticeCrossSourceSubjectBindingProofV1,
  type PracticeCrossSourceSubjectProofV1,
  type PracticeReferenceAnalysisV1,
  type PracticeReferenceShotV1,
  type PracticeSceneMatchV1,
} from "../../../packages/practice-homework/src/index.js";
import type {
  PracticeCrossSourceSubjectBindingV1,
} from "./practice-m6-media.js";

export interface PracticeCrossSourceSubjectBinderV1 {
  bindCrossSourceSubject(input: {
    readonly referenceVideoPath: string;
    readonly sourceVideoPath: string;
    readonly referenceTimeMs: number;
    readonly sourceTimeMs: number;
    readonly referenceSubjectBox: readonly [number, number, number, number];
    readonly referenceSemanticId: string;
    readonly sourceId: string;
    readonly shotId: string;
  }): Promise<PracticeCrossSourceSubjectBindingV1>;
}

const unique = (values: readonly string[]): readonly string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const nonEmpty = (value: string | undefined): string | null => {
  const normalized = value?.trim() ?? "";
  return normalized.length === 0 ? null : normalized;
};

const sourceTimeForReference = (
  reference: PracticeReferenceAnalysisV1,
  match: PracticeSceneMatchV1,
  referenceTimeMs: number,
): number => {
  const trajectory = [...(match.trajectory ?? [])]
    .sort((left, right) => left.referenceTimeMs - right.referenceTimeMs);
  if (trajectory.length >= 2) {
    if (referenceTimeMs <= trajectory[0]!.referenceTimeMs) {
      return trajectory[0]!.sourceTimeMs;
    }
    if (referenceTimeMs >= trajectory.at(-1)!.referenceTimeMs) {
      return trajectory.at(-1)!.sourceTimeMs;
    }
    for (let index = 1; index < trajectory.length; index += 1) {
      const right = trajectory[index]!;
      const left = trajectory[index - 1]!;
      if (referenceTimeMs <= right.referenceTimeMs) {
        const span = right.referenceTimeMs - left.referenceTimeMs;
        const phase = span <= 0 ? 0 : (referenceTimeMs - left.referenceTimeMs) / span;
        return left.sourceTimeMs + (right.sourceTimeMs - left.sourceTimeMs) * phase;
      }
    }
  }
  const shot = reference.shots.find((candidate) => candidate.shotId === match.shotId);
  if (shot === undefined) {
    throw new Error("Practice cross-source proof lost reference shot " + match.shotId + ".");
  }
  const delta = referenceTimeMs - shot.referenceStartMs;
  return match.direction === "FORWARD"
    ? match.sourceStartMs + delta * match.playbackRate
    : match.sourceEndMs - delta * match.playbackRate;
};

const subjectFrameForShot = (
  window: DenseEffectWindowV1,
  shot: PracticeReferenceShotV1,
  semanticId: string,
): DenseEffectWindowV1["evidence"]["frames"][number] | null => {
  const candidates = window.evidence.frames.filter((frame) =>
    frame.timeMs >= Math.max(window.startMs, shot.referenceStartMs) - 0.5
    && frame.timeMs <= Math.min(window.endMs, shot.referenceEndMs) + 0.5
    && frame.subjectSemanticId === semanticId
    && frame.subjectBoundingBox !== undefined
    && frame.subjectTrackState !== "LOST"
    && frame.subjectTrackState !== "UNOBSERVED");
  if (candidates.length === 0) return null;
  const targetMs = Math.max(
    shot.referenceStartMs,
    Math.min(shot.referenceEndMs, window.anchorMs),
  );
  return [...candidates].sort((left, right) => {
    const leftObserved = left.subjectTrackState === "OBSERVED" ? 2 : 0;
    const rightObserved = right.subjectTrackState === "OBSERVED" ? 2 : 0;
    const leftScore = leftObserved
      + (left.subjectIdentityConfidence ?? 0)
      + (left.subjectVisibility ?? 0)
      - Math.abs(left.timeMs - targetMs) / Math.max(1, window.endMs - window.startMs);
    const rightScore = rightObserved
      + (right.subjectIdentityConfidence ?? 0)
      + (right.subjectVisibility ?? 0)
      - Math.abs(right.timeMs - targetMs) / Math.max(1, window.endMs - window.startMs);
    return rightScore - leftScore;
  })[0] ?? null;
};

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
export const buildPracticeCrossSourceSubjectProofV1 = async (input: {
  readonly reference: PracticeReferenceAnalysisV1;
  readonly sequence: DenseEffectSequenceV1;
  readonly matches: readonly PracticeSceneMatchV1[];
  readonly binder: PracticeCrossSourceSubjectBinderV1;
}): Promise<PracticeCrossSourceSubjectProofV1> => {
  const anatomy = buildPracticeReferenceAnatomyV1({
    reference: input.reference,
    sequence: input.sequence,
    matches: input.matches,
  });
  const requiredWindows = anatomy.effectWindows
    .filter((window) => window.objectCue.objectAware);
  const bindings: PracticeCrossSourceSubjectBindingProofV1[] = [];
  const reasons: string[] = [];
  const evidenceRefs: string[] = [];
  let requiredBindingCount = 0;
  let verifiedBindingCount = 0;
  let verifiedWindowCount = 0;

  for (const anatomyWindow of requiredWindows) {
    const denseWindow = input.sequence.windows.find((window) =>
      window.windowId === anatomyWindow.windowId);
    if (denseWindow === undefined) {
      reasons.push(anatomyWindow.windowId + ": dense reference evidence is missing.");
      continue;
    }
    const identity = summarizePracticeSubjectIdentityV1(denseWindow.evidence.frames);
    const semanticId = identity.dominantSemanticId;
    let windowVerified = true;
    if (!identity.continuityVerified || semanticId === null) {
      reasons.push(...identity.reasons.map((reason) =>
        anatomyWindow.windowId + ": " + reason));
      windowVerified = false;
    }
    if (anatomyWindow.shotIds.length === 0) {
      reasons.push(anatomyWindow.windowId + ": no Finish shot owns this object-aware window.");
      windowVerified = false;
    }

    for (const shotId of anatomyWindow.shotIds) {
      requiredBindingCount += 1;
      const shot = input.reference.shots.find((candidate) => candidate.shotId === shotId);
      const matches = input.matches.filter((candidate) => candidate.shotId === shotId);
      const match = matches.length === 1 ? matches[0]! : null;
      if (shot === undefined || match === null || semanticId === null) {
        reasons.push(
          anatomyWindow.windowId + "/" + shotId
            + ": an exact Finish-to-Start shot binding is required before subject proof.",
        );
        windowVerified = false;
        continue;
      }
      const frame = subjectFrameForShot(denseWindow, shot, semanticId);
      if (frame?.subjectBoundingBox === undefined) {
        reasons.push(
          anatomyWindow.windowId + "/" + shotId
            + ": no bounded subject frame is available for cross-source binding.",
        );
        windowVerified = false;
        continue;
      }
      const referencePath = nonEmpty(input.reference.sourcePath);
      const sourcePath = nonEmpty(match.sourcePath);
      if (referencePath === null || sourcePath === null) {
        reasons.push(
          anatomyWindow.windowId + "/" + shotId
            + ": local Finish and raw Start paths are required for subject binding.",
        );
        windowVerified = false;
        continue;
      }

      const sourceTimeMs = sourceTimeForReference(input.reference, match, frame.timeMs);
      try {
        const binding = await input.binder.bindCrossSourceSubject({
          referenceVideoPath: referencePath,
          sourceVideoPath: sourcePath,
          referenceTimeMs: frame.timeMs,
          sourceTimeMs,
          referenceSubjectBox: frame.subjectBoundingBox,
          referenceSemanticId: semanticId,
          sourceId: match.sourceId,
          shotId,
        });
        const verified = binding.verified
          && binding.sourceSemanticId !== null
          && binding.sourceSubjectBox !== null;
        bindings.push({
          referenceWindowId: anatomyWindow.windowId,
          shotId,
          sourceId: match.sourceId,
          referenceTimeMs: frame.timeMs,
          sourceTimeMs,
          referenceSemanticId: semanticId,
          sourceSemanticId: binding.sourceSemanticId,
          referenceSubjectBox: frame.subjectBoundingBox,
          sourceSubjectBox: binding.sourceSubjectBox,
          confidence: binding.confidence,
          verified,
          reason: binding.reason,
          algorithmId: binding.algorithmId,
          sourceVideo: structuredClone(binding.sourceVideo),
          evidenceRefs: unique(binding.evidenceRefs),
        });
        evidenceRefs.push(...binding.evidenceRefs);
        if (verified) {
          verifiedBindingCount += 1;
        } else {
          windowVerified = false;
          reasons.push(
            anatomyWindow.windowId + "/" + shotId
              + ": Finish-to-Start subject binding failed"
              + (binding.reason === null ? "." : " (" + binding.reason + ")."),
          );
        }
      } catch (error) {
        windowVerified = false;
        reasons.push(
          anatomyWindow.windowId + "/" + shotId
            + ": cross-source subject binder error: " + errorText(error),
        );
      }
    }
    if (windowVerified && anatomyWindow.shotIds.length > 0) {
      verifiedWindowCount += 1;
    }
  }

  const referenceWindowCount = requiredWindows.length;
  const required = referenceWindowCount > 0;
  const verified = required
    && reasons.length === 0
    && verifiedWindowCount === referenceWindowCount
    && verifiedBindingCount === requiredBindingCount
    && requiredBindingCount > 0;
  evidenceRefs.push(
    "practice-cross-source-subject-windows:" + String(referenceWindowCount),
    "practice-cross-source-subject-bindings-required:" + String(requiredBindingCount),
    "practice-cross-source-subject-bindings-verified:" + String(verifiedBindingCount),
  );
  return {
    schema: "editflow.practice-cross-source-subject-proof.v1",
    required,
    referenceWindowCount,
    requiredBindingCount,
    verifiedBindingCount,
    verifiedWindowCount,
    verified,
    bindings,
    reasons: unique(reasons),
    evidenceRefs: unique(evidenceRefs),
  };
};
