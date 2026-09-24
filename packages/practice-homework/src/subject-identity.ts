import type {
  DenseFrameMetricsV1,
} from "../../visual-effects-intelligence/src/index.js";
import type {
  PracticeSubjectIdentitySummaryV1,
} from "./contracts.js";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const unique = (values: readonly string[]): readonly string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const ACTIVE_TRACK_STATES = new Set([
  "OBSERVED",
  "PREDICTED_LOW_MOTION",
  "PREDICTED_OCCLUDED",
]);
const VALIDATED_MASK_SOURCES = new Set([
  "SEGMENTATION",
  "AE_TRACKED_MASK",
  "ROTO_BRUSH",
]);

const semanticId = (frame: DenseFrameMetricsV1): string | null => {
  const value = frame.subjectSemanticId?.trim() ?? "";
  return value.length > 0 ? value : null;
};

const identityActive = (frame: DenseFrameMetricsV1): boolean => {
  const state = frame.subjectTrackState;
  return semanticId(frame) !== null
    && state !== undefined
    && ACTIVE_TRACK_STATES.has(state)
    && (frame.subjectIdentityConfidence ?? 0) > 0;
};

const lowMotionFrame = (frame: DenseFrameMetricsV1): boolean => {
  if (frame.subjectTrackState === "PREDICTED_LOW_MOTION") return true;
  if (!identityActive(frame)) return false;
  return Math.hypot(frame.subjectMotion.x, frame.subjectMotion.y) <= 0.012
    && frame.subjectSeparation <= 0.08;
};

const occlusionFrame = (frame: DenseFrameMetricsV1): boolean =>
  frame.subjectTrackState === "PREDICTED_OCCLUDED"
  || frame.occlusion >= 0.18;

const backgroundMotionStressFrame = (frame: DenseFrameMetricsV1): boolean => {
  if (!identityActive(frame)) return false;
  const backgroundMagnitude = Math.hypot(
    frame.backgroundMotion.x,
    frame.backgroundMotion.y,
  );
  return backgroundMagnitude >= 0.12
    && frame.motionEnergy >= 0.2
    && frame.subjectBackgroundDivergence >= 0.08;
};

const identityAmbiguityFrame = (frame: DenseFrameMetricsV1): boolean => {
  if (!identityActive(frame) || frame.subjectTrackState !== "OBSERVED") return false;
  const confidence = clamp01(frame.subjectIdentityConfidence ?? 0);
  const visibility = clamp01(frame.subjectVisibility ?? 1);
  // Keep ambiguity distinct from occlusion: the subject remains visibly observed,
  // but identity confidence is materially degraded while staying above the proof floor.
  return confidence >= 0.35
    && confidence < 0.65
    && visibility >= 0.5
    && frame.occlusion < 0.18;
};

const validatedMaskFrame = (frame: DenseFrameMetricsV1): boolean =>
  frame.subjectMaskValidated === true
  && frame.subjectMaskSource !== undefined
  && VALIDATED_MASK_SOURCES.has(frame.subjectMaskSource);

const dominantIdentity = (
  frames: readonly DenseFrameMetricsV1[],
): Readonly<{ id: string | null; count: number; distinct: number }> => {
  const counts = new Map<string, number>();
  for (const frame of frames) {
    if (!identityActive(frame)) continue;
    const id = semanticId(frame);
    if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const ordered = [...counts.entries()].sort((left, right) =>
    right[1] - left[1] || left[0].localeCompare(right[0]));
  return {
    id: ordered[0]?.[0] ?? null,
    count: ordered[0]?.[1] ?? 0,
    distinct: counts.size,
  };
};

const identitySwitchCount = (frames: readonly DenseFrameMetricsV1[]): number => {
  let prior: string | null = null;
  let switches = 0;
  for (const frame of frames) {
    if (!identityActive(frame)) continue;
    const current = semanticId(frame);
    if (current === null) continue;
    if (prior !== null && current !== prior) switches += 1;
    prior = current;
  }
  return switches;
};

const eventSurvived = (
  frames: readonly DenseFrameMetricsV1[],
  predicate: (frame: DenseFrameMetricsV1) => boolean,
  dominantId: string | null,
): boolean => {
  const relevant = frames.filter(predicate);
  if (relevant.length === 0) return true;
  if (dominantId === null) return false;
  return relevant.every((frame) =>
    identityActive(frame) && semanticId(frame) === dominantId);
};

export const summarizePracticeSubjectIdentityV1 = (
  frames: readonly DenseFrameMetricsV1[],
): PracticeSubjectIdentitySummaryV1 => {
  const frameCount = frames.length;
  const activeFrames = frames.filter(identityActive);
  const observedFrames = frames.filter((frame) =>
    frame.subjectTrackState === "OBSERVED" && identityActive(frame));
  const predictedFrames = frames.filter((frame) =>
    (frame.subjectTrackState === "PREDICTED_LOW_MOTION"
      || frame.subjectTrackState === "PREDICTED_OCCLUDED")
    && identityActive(frame));
  const lostFrames = frames.filter((frame) => frame.subjectTrackState === "LOST");
  const lowMotionFrames = frames.filter(lowMotionFrame);
  const occlusionFrames = frames.filter(occlusionFrame);
  const backgroundMotionStressFrames = frames.filter(backgroundMotionStressFrame);
  const identityAmbiguityFrames = frames.filter(identityAmbiguityFrame);
  const maskFrames = frames.filter(validatedMaskFrame);
  const dominant = dominantIdentity(frames);
  const switches = identitySwitchCount(frames);
  const meanIdentityConfidence = activeFrames.length === 0
    ? 0
    : activeFrames.reduce(
      (sum, frame) => sum + clamp01(frame.subjectIdentityConfidence ?? 0),
      0,
    ) / activeFrames.length;
  const identityCoverage = frameCount === 0 ? 0 : activeFrames.length / frameCount;
  const observedCoverage = frameCount === 0 ? 0 : observedFrames.length / frameCount;
  const validatedMaskCoverage = frameCount === 0 ? 0 : maskFrames.length / frameCount;
  const lowMotionSurvived = eventSurvived(frames, lowMotionFrame, dominant.id);
  const occlusionSurvived = eventSurvived(frames, occlusionFrame, dominant.id);
  const backgroundMotionStressSurvived = eventSurvived(
    frames,
    backgroundMotionStressFrame,
    dominant.id,
  );
  const identityAmbiguitySurvived = eventSurvived(
    frames,
    identityAmbiguityFrame,
    dominant.id,
  );
  const dominantCoverage = activeFrames.length === 0
    ? 0
    : dominant.count / activeFrames.length;
  const tracked = dominant.id !== null && activeFrames.length > 0;
  const reasons: string[] = [];
  if (!tracked) {
    reasons.push("No stable semantic subject identity was retained for this object-aware window.");
  }
  if (dominant.distinct > 1 || switches > 0) {
    reasons.push("Subject identity switched inside the object-aware window.");
  }
  if (tracked && identityCoverage < 0.45) {
    reasons.push("Subject identity coverage is below the 45% continuity floor.");
  }
  if (tracked && dominantCoverage < 0.9) {
    reasons.push("The dominant subject identity does not cover at least 90% of tracked frames.");
  }
  if (tracked && observedFrames.length === 0) {
    reasons.push("Subject identity has no directly observed frame; prediction alone is insufficient.");
  }
  if (tracked && meanIdentityConfidence < 0.35) {
    reasons.push("Mean subject identity confidence is below the 0.35 proof floor.");
  }
  if (!lowMotionSurvived) {
    reasons.push("The bound subject identity did not survive the low-motion interval.");
  }
  if (!occlusionSurvived) {
    reasons.push("The bound subject identity did not survive the occlusion interval.");
  }
  if (!backgroundMotionStressSurvived) {
    reasons.push("The bound subject identity did not survive strong background/camera motion.");
  }
  if (!identityAmbiguitySurvived) {
    reasons.push("The bound subject identity did not survive an ambiguous-identity interval.");
  }
  const continuityVerified = reasons.length === 0;
  return {
    tracked,
    continuityVerified,
    dominantSemanticId: dominant.id,
    semanticIdentityCount: dominant.distinct,
    identitySwitchCount: switches,
    frameCount,
    trackedFrameCount: activeFrames.length,
    observedFrameCount: observedFrames.length,
    predictedFrameCount: predictedFrames.length,
    lostFrameCount: lostFrames.length,
    identityCoverage,
    observedCoverage,
    meanIdentityConfidence,
    lowMotionFrameCount: lowMotionFrames.length,
    lowMotionSurvived,
    occlusionFrameCount: occlusionFrames.length,
    occlusionSurvived,
    backgroundMotionStressFrameCount: backgroundMotionStressFrames.length,
    backgroundMotionStressSurvived,
    identityAmbiguityFrameCount: identityAmbiguityFrames.length,
    identityAmbiguitySurvived,
    validatedMaskFrameCount: maskFrames.length,
    validatedMaskCoverage,
    validatedMaskSources: unique(maskFrames
      .map((frame) => frame.subjectMaskSource ?? "")
      .filter(Boolean)),
    reasons: unique(reasons),
    evidenceRefs: unique(frames.flatMap((frame) => frame.subjectEvidenceIds ?? [])),
  };
};

export const practiceSubjectMaskTruthVerifiedV1 = (
  summary: PracticeSubjectIdentitySummaryV1,
): boolean =>
  summary.validatedMaskFrameCount > 0
  && summary.validatedMaskCoverage >= 0.2
  && summary.validatedMaskSources.length > 0;
