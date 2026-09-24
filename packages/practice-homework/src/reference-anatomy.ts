import {
  classifyEffectFamilyV1,
  type DenseEffectSequenceV1,
  type DenseEffectWindowV1,
} from "../../visual-effects-intelligence/src/index.js";
import type {
  PracticeAudioBeatGridV1,
  PracticeObjectMotionRelationV1,
  PracticeReferenceAnalysisV1,
  PracticeReferenceAnatomyV1,
  PracticeReferenceBeatCueV1,
  PracticeReferenceCutV1,
  PracticeReferenceEffectWindowV1,
  PracticeReferenceWindowRelationV1,
  PracticeSceneMatchV1,
  PracticeSceneTemporalBehaviorV1,
  PracticeTemporalRewindV1,
} from "./contracts.js";
import {
  practiceSubjectMaskTruthVerifiedV1,
  summarizePracticeSubjectIdentityV1,
} from "./subject-identity.js";

const unique = (values: readonly string[]): readonly string[] =>
  [...new Set(values.filter((value) => value.trim().length > 0))];

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  if ((ordered.length % 2) === 1) return ordered[middle]!;
  return (ordered[middle - 1]! + ordered[middle]!) / 2;
};

const beatCueFor = (
  eventMs: number,
  beatGrid: PracticeAudioBeatGridV1 | undefined,
  frameIntervalMs: number,
): PracticeReferenceBeatCueV1 | undefined => {
  if (beatGrid === undefined || beatGrid.confidence < 0.30) return undefined;
  const beats = [...beatGrid.beatTimesMs]
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (beats.length < 3 || !Number.isFinite(eventMs)) return undefined;
  const intervals = beats.slice(1)
    .map((value, index) => value - beats[index]!)
    .filter((value) => value > 1e-3);
  const beatIntervalMs = median(intervals);
  if (!Number.isFinite(beatIntervalMs) || beatIntervalMs <= 1e-3) return undefined;
  const nearestBeatMs = [...beats].sort((a, b) =>
    Math.abs(eventMs - a) - Math.abs(eventMs - b))[0]!;
  const offsetMs = eventMs - nearestBeatMs;
  const absoluteOffsetMs = Math.abs(offsetMs);
  const validFrameIntervalMs = Number.isFinite(frameIntervalMs) && frameIntervalMs > 0
    ? frameIntervalMs
    : 1000 / 30;
  const onBeatToleranceMs = Math.max(
    validFrameIntervalMs * 1.5,
    Math.min(80, beatIntervalMs * 0.12),
  );
  const nearBeatToleranceMs = Math.max(
    validFrameIntervalMs * 3,
    Math.min(160, beatIntervalMs * 0.30),
  );
  const alignment = absoluteOffsetMs <= onBeatToleranceMs
    ? "ON_BEAT"
    : absoluteOffsetMs <= nearBeatToleranceMs ? "NEAR_BEAT" : "OFF_BEAT";
  return {
    eventMs,
    nearestBeatMs,
    beatIntervalMs,
    offsetMs,
    offsetBeats: offsetMs / beatIntervalMs,
    alignment,
    confidence: beatGrid.confidence,
    evidenceRefs: unique([
      ...beatGrid.evidenceRefs,
      "practice-beat-alignment:" + alignment,
      "practice-beat-event-ms:" + eventMs.toFixed(3),
      "practice-beat-nearest-ms:" + nearestBeatMs.toFixed(3),
      "practice-beat-offset-ms:" + offsetMs.toFixed(3),
      "practice-beat-offset-beats:" + (offsetMs / beatIntervalMs).toFixed(6),
    ]),
  };
};

const maxFrame = (
  window: DenseEffectWindowV1,
  key: "maskCoverage" | "occlusion",
): number => Math.max(0, ...window.evidence.frames.map((frame) => frame[key]));

const objectMetricsForWindow = (window: DenseEffectWindowV1) => {
  const frames = window.evidence.frames;
  const peakFrame = [...frames].sort((a, b) =>
    b.subjectBackgroundDivergence - a.subjectBackgroundDivergence)[0];
  const subjectMotionPeak = Math.max(
    0,
    ...frames.map((frame) => Math.hypot(frame.subjectMotion.x, frame.subjectMotion.y)),
  );
  const backgroundMotionPeak = Math.max(
    0,
    ...frames.map((frame) => Math.hypot(frame.backgroundMotion.x, frame.backgroundMotion.y)),
  );
  const evidencePersistence = frames.length === 0 ? 0 : frames.filter((frame) =>
    frame.subjectSeparation >= 0.08
    || frame.maskCoverage >= 0.03
    || frame.occlusion >= 0.12
    || frame.subjectBackgroundDivergence >= 0.05).length / frames.length;
  return {
    divergencePeak: Math.max(0, ...frames.map((frame) => frame.subjectBackgroundDivergence)),
    evidencePersistence,
    subjectMotionPeak,
    backgroundMotionPeak,
    subjectMotionDirection: peakFrame?.subjectMotion ?? { x: 0, y: 0 },
    backgroundMotionDirection: peakFrame?.backgroundMotion ?? { x: 0, y: 0 },
  };
};

const objectRelationFor = (input: {
  readonly validatedMaskCoveragePeak: number;
  readonly occlusionPeak: number;
  readonly divergencePeak: number;
  readonly subjectMotionPeak: number;
  readonly backgroundMotionPeak: number;
}): PracticeObjectMotionRelationV1 => {
  if (input.occlusionPeak >= 0.65) return "OCCLUSION_DRIVEN";
  if (input.validatedMaskCoveragePeak >= 0.12) return "MASK_DRIVEN";
  if (input.divergencePeak >= 0.08) {
    if (input.subjectMotionPeak >= Math.max(0.04, input.backgroundMotionPeak * 1.35)) {
      return "SUBJECT_DOMINANT";
    }
    if (input.backgroundMotionPeak >= Math.max(0.04, input.subjectMotionPeak * 1.35)) {
      return "BACKGROUND_DOMINANT";
    }
    return "DIVERGENT";
  }
  return "CO_MOVING";
};

const orderedShots = (reference: PracticeReferenceAnalysisV1) =>
  [...reference.shots].sort((a, b) => a.order - b.order);

const buildCuts = (
  reference: PracticeReferenceAnalysisV1,
  beatGrid: PracticeAudioBeatGridV1 | undefined,
): readonly PracticeReferenceCutV1[] => {
  const shots = orderedShots(reference);
  const frameIntervalMs = reference.video?.fps !== undefined && reference.video.fps > 0
    ? 1000 / reference.video.fps
    : 1000 / 30;
  return shots.slice(0, -1).map((outgoing, index) => {
    const incoming = shots[index + 1]!;
    const beatCue = beatCueFor(incoming.referenceStartMs, beatGrid, frameIntervalMs);
    return {
      cutId: "cut:" + String(index + 1).padStart(4, "0"),
      atMs: incoming.referenceStartMs,
      outgoingShotId: outgoing.shotId,
      incomingShotId: incoming.shotId,
      transitionWindowIds: [],
      ...(beatCue === undefined ? {} : { beatCue }),
    };
  });
};

const shotsForWindow = (
  reference: PracticeReferenceAnalysisV1,
  window: DenseEffectWindowV1,
): readonly PracticeReferenceAnalysisV1["shots"][number][] => {
  const hits = orderedShots(reference).filter((shot) =>
    Math.min(window.endMs, shot.referenceEndMs)
      - Math.max(window.startMs, shot.referenceStartMs) > 0.5);
  if (hits.length > 0) return hits;
  const nearest = orderedShots(reference).sort((a, b) => {
    const aCenter = (a.referenceStartMs + a.referenceEndMs) / 2;
    const bCenter = (b.referenceStartMs + b.referenceEndMs) / 2;
    return Math.abs(window.anchorMs - aCenter) - Math.abs(window.anchorMs - bCenter);
  })[0];
  return nearest === undefined ? [] : [nearest];
};

const relationForWindow = (
  window: DenseEffectWindowV1,
  shots: readonly PracticeReferenceAnalysisV1["shots"][number][],
): PracticeReferenceWindowRelationV1 => {
  if (shots.length > 1) return "CUT_SPAN";
  const shot = shots[0];
  if (shot === undefined) return "SHOT_INTERIOR";
  const duration = Math.max(1, window.endMs - window.startMs);
  const tolerance = Math.max(
    window.evidence.summary.frameIntervalMs * 2,
    Math.min(140, duration * 0.35),
  );
  const nearIn = Math.abs(window.startMs - shot.referenceStartMs) <= tolerance
    || window.startMs < shot.referenceStartMs;
  const nearOut = Math.abs(window.endMs - shot.referenceEndMs) <= tolerance
    || window.endMs > shot.referenceEndMs;
  if (nearIn && !nearOut) return "CUT_IN";
  if (nearOut && !nearIn) return "CUT_OUT";
  return "SHOT_INTERIOR";
};

const transitionBoundaryFor = (
  window: DenseEffectWindowV1,
  relation: PracticeReferenceWindowRelationV1,
  shotIds: readonly string[],
  cuts: readonly PracticeReferenceCutV1[],
): number | null => {
  const direct = cuts.filter((cut) => cut.atMs >= window.startMs && cut.atMs <= window.endMs);
  if (direct.length > 0) {
    return [...direct].sort((a, b) =>
      Math.abs(a.atMs - window.anchorMs) - Math.abs(b.atMs - window.anchorMs))[0]!.atMs;
  }
  if (relation === "SHOT_INTERIOR" || shotIds.length === 0) return null;
  const relevant = cuts.filter((cut) =>
    relation === "CUT_IN"
      ? shotIds.includes(cut.incomingShotId)
      : relation === "CUT_OUT"
        ? shotIds.includes(cut.outgoingShotId)
        : shotIds.includes(cut.outgoingShotId) || shotIds.includes(cut.incomingShotId));
  const nearest = [...relevant].sort((a, b) =>
    Math.abs(a.atMs - window.anchorMs) - Math.abs(b.atMs - window.anchorMs))[0];
  return nearest?.atMs ?? null;
};

const temporalCueFor = (
  familyId: string,
  shotIds: readonly string[],
  matches: readonly PracticeSceneMatchV1[],
): Readonly<{
  behavior: PracticeSceneTemporalBehaviorV1;
  rewind: PracticeTemporalRewindV1 | null;
  evidenceShotIds: readonly string[];
}> => {
  const relevant = matches.filter((match) => shotIds.includes(match.shotId));
  const rewinds = relevant
    .filter((match) => match.rewind?.detected === true)
    .map((match) => ({ match, rewind: match.rewind! }))
    .sort((a, b) => b.rewind.confidence - a.rewind.confidence);
  if (rewinds.length > 0) {
    return {
      behavior: "FORWARD_THEN_REWIND",
      rewind: rewinds[0]!.rewind,
      evidenceShotIds: unique(rewinds.map((item) => item.match.shotId)),
    };
  }
  const behaviors = unique(relevant.map((match) =>
    match.temporalBehavior ?? (match.direction === "REVERSE" ? "REVERSE" : "FORWARD")));
  if (familyId === "REVERSE_TEMPORAL") {
    return {
      behavior: "REVERSE",
      rewind: null,
      evidenceShotIds: unique(relevant.map((match) => match.shotId)),
    };
  }
  return {
    behavior: behaviors.length === 1
      ? behaviors[0] as PracticeSceneTemporalBehaviorV1
      : behaviors.length === 0 ? "COMPLEX" : "COMPLEX",
    rewind: null,
    evidenceShotIds: unique(relevant.map((match) => match.shotId)),
  };
};

const anatomyWindow = (
  reference: PracticeReferenceAnalysisV1,
  window: DenseEffectWindowV1,
  cuts: readonly PracticeReferenceCutV1[],
  matches: readonly PracticeSceneMatchV1[],
  beatGrid: PracticeAudioBeatGridV1 | undefined,
): PracticeReferenceEffectWindowV1 => {
  const shots = shotsForWindow(reference, window);
  const shotIds = shots.map((shot) => shot.shotId);
  const relation = relationForWindow(window, shots);
  const familyId = classifyEffectFamilyV1(window.evidence);
  const summary = window.evidence.summary;
  const maskCoveragePeak = maxFrame(window, "maskCoverage");
  const validatedMaskCoveragePeak = Math.max(
    0,
    ...window.evidence.frames.map((frame) =>
      frame.subjectMaskValidated === true ? frame.maskCoverage : 0),
  );
  const subjectIdentity = summarizePracticeSubjectIdentityV1(window.evidence.frames);
  const maskTruthValidated = practiceSubjectMaskTruthVerifiedV1(subjectIdentity);
  const occlusionPeak = Math.max(summary.occlusionPeak, maxFrame(window, "occlusion"));
  const objectMotion = objectMetricsForWindow(window);
  const persistentObjectEvidence = objectMotion.evidencePersistence
    >= (window.evidence.frames.length <= 4 ? 0.25 : 0.2);
  const objectAware = persistentObjectEvidence && (
    summary.subjectSeparationPeak >= 0.12
    || validatedMaskCoveragePeak >= 0.05
    || occlusionPeak >= 0.18
    || objectMotion.divergencePeak >= 0.08
  );
  const objectRelation = objectRelationFor({
    validatedMaskCoveragePeak,
    occlusionPeak,
    divergencePeak: objectMotion.divergencePeak,
    subjectMotionPeak: objectMotion.subjectMotionPeak,
    backgroundMotionPeak: objectMotion.backgroundMotionPeak,
  });
  const temporalCue = temporalCueFor(familyId, shotIds, matches);
  const transitionBoundaryMs = transitionBoundaryFor(window, relation, shotIds, cuts);
  const anchorBeatCue = beatCueFor(window.anchorMs, beatGrid, summary.frameIntervalMs);
  const transitionBeatCue = transitionBoundaryMs === null
    ? undefined
    : beatCueFor(transitionBoundaryMs, beatGrid, summary.frameIntervalMs);
  return {
    windowId: window.windowId,
    effectFamilyId: familyId,
    startMs: window.startMs,
    endMs: window.endMs,
    anchorMs: window.anchorMs,
    shotIds,
    relation,
    transitionBoundaryMs,
    ...(anchorBeatCue === undefined ? {} : { anchorBeatCue }),
    ...(transitionBeatCue === undefined ? {} : { transitionBeatCue }),
    motion: {
      peakEnergy: window.peakEnergy,
      motionPeakPhase: summary.motionPeakPhase,
      accelerationPeak: summary.accelerationPeak,
      displacementPeak: summary.displacementPeak,
      displacementDirection: summary.displacementDirection,
      blurPeak: summary.blurPeak,
      distortionPeak: summary.distortionPeak,
      scaleRange: summary.scaleRange,
      rotationRange: summary.rotationRange,
      recoveryDurationMs: summary.recoveryFrames * summary.frameIntervalMs,
    },
    objectCue: {
      objectAware,
      relation: objectRelation,
      evidencePersistence: objectMotion.evidencePersistence,
      subjectSeparationPeak: summary.subjectSeparationPeak,
      subjectBackgroundDivergencePeak: objectMotion.divergencePeak,
      subjectMotionPeak: objectMotion.subjectMotionPeak,
      backgroundMotionPeak: objectMotion.backgroundMotionPeak,
      subjectMotionDirection: objectMotion.subjectMotionDirection,
      backgroundMotionDirection: objectMotion.backgroundMotionDirection,
      maskCoveragePeak,
      validatedMaskCoveragePeak,
      maskTruthValidated,
      subjectIdentityContinuityVerified: subjectIdentity.continuityVerified,
      subjectIdentityCoverage: subjectIdentity.identityCoverage,
      occlusionPeak,
    },
    temporalCue,
    evidenceRefs: unique([
      ...window.evidence.evidenceRefs,
      ...subjectIdentity.evidenceRefs,
      ...matches
        .filter((match) => shotIds.includes(match.shotId))
        .flatMap((match) => match.evidenceRefs),
      "practice-window-relation:" + relation,
      "practice-effect-family:" + familyId,
      "practice-temporal-behavior:" + temporalCue.behavior,
      ...(anchorBeatCue?.evidenceRefs ?? []),
      ...(transitionBeatCue?.evidenceRefs ?? []),
      ...(anchorBeatCue === undefined ? [] : [
        "practice-effect-anchor-beat-alignment:" + anchorBeatCue.alignment,
      ]),
      ...(transitionBeatCue === undefined ? [] : [
        "practice-transition-beat-alignment:" + transitionBeatCue.alignment,
      ]),
      ...(objectAware ? [
        "practice-object-aware-window:" + window.windowId,
        "practice-object-relation:" + objectRelation,
        "practice-object-divergence:" + objectMotion.divergencePeak.toFixed(6),
        "practice-object-persistence:" + objectMotion.evidencePersistence.toFixed(6),
        "practice-subject-identity-continuity:"
          + String(subjectIdentity.continuityVerified),
        "practice-subject-identity-coverage:"
          + subjectIdentity.identityCoverage.toFixed(6),
        "practice-subject-mask-truth:" + String(maskTruthValidated),
      ] : []),
      ...(temporalCue.rewind === null
        ? []
        : ["practice-rewind-span-ms:" + temporalCue.rewind.rewindSpanMs.toFixed(3)]),
    ]),
  };
};

export const buildPracticeReferenceAnatomyV1 = (input: {
  readonly reference: PracticeReferenceAnalysisV1;
  readonly sequence: DenseEffectSequenceV1;
  readonly matches: readonly PracticeSceneMatchV1[];
  readonly beatGrid?: PracticeAudioBeatGridV1;
}): PracticeReferenceAnatomyV1 => {
  const baseCuts = buildCuts(input.reference, input.beatGrid);
  const effectWindows = input.sequence.windows.map((window) =>
    anatomyWindow(input.reference, window, baseCuts, input.matches, input.beatGrid));
  const cuts = baseCuts.map((cut) => ({
    ...cut,
    transitionWindowIds: effectWindows
      .filter((window) => window.transitionBoundaryMs === cut.atMs)
      .map((window) => window.windowId),
  }));
  const rewindShotIds = unique(input.matches
    .filter((match) => match.rewind?.detected === true)
    .map((match) => match.shotId));
  const objectAwareWindowIds = effectWindows
    .filter((window) => window.objectCue.objectAware)
    .map((window) => window.windowId);
  return {
    schema: "editflow.practice-reference-anatomy.v1",
    referenceId: input.reference.referenceId,
    cuts,
    effectWindows,
    rewindShotIds,
    objectAwareWindowIds,
    evidenceRefs: unique([
      ...input.reference.evidenceRefs,
      ...input.sequence.evidenceRefs,
      ...input.matches.flatMap((match) => match.evidenceRefs),
      ...(input.beatGrid?.evidenceRefs ?? []),
      ...cuts.flatMap((cut) => cut.beatCue?.evidenceRefs ?? []),
      ...effectWindows.flatMap((window) => window.evidenceRefs),
      "practice-reference-beat-grid:" + String(input.beatGrid !== undefined),
      "practice-reference-beat-cued-cuts:"
        + String(cuts.filter((cut) => cut.beatCue !== undefined).length),
      "practice-reference-cuts:" + String(cuts.length),
      "practice-reference-effect-windows:" + String(effectWindows.length),
      "practice-reference-rewind-shots:" + String(rewindShotIds.length),
      "practice-reference-object-aware-windows:" + String(objectAwareWindowIds.length),
    ]),
  };
};
