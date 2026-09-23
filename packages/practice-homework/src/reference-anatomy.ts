import {
  classifyEffectFamilyV1,
  type DenseEffectSequenceV1,
  type DenseEffectWindowV1,
} from "../../visual-effects-intelligence/src/index.js";
import type {
  PracticeReferenceAnalysisV1,
  PracticeReferenceAnatomyV1,
  PracticeReferenceCutV1,
  PracticeReferenceEffectWindowV1,
  PracticeReferenceWindowRelationV1,
  PracticeSceneMatchV1,
  PracticeSceneTemporalBehaviorV1,
  PracticeTemporalRewindV1,
} from "./contracts.js";

const unique = (values: readonly string[]): readonly string[] =>
  [...new Set(values.filter((value) => value.trim().length > 0))];

const maxFrame = (
  window: DenseEffectWindowV1,
  key: "maskCoverage" | "occlusion",
): number => Math.max(0, ...window.evidence.frames.map((frame) => frame[key]));

const orderedShots = (reference: PracticeReferenceAnalysisV1) =>
  [...reference.shots].sort((a, b) => a.order - b.order);

const buildCuts = (
  reference: PracticeReferenceAnalysisV1,
): readonly PracticeReferenceCutV1[] => {
  const shots = orderedShots(reference);
  return shots.slice(0, -1).map((outgoing, index) => {
    const incoming = shots[index + 1]!;
    return {
      cutId: "cut:" + String(index + 1).padStart(4, "0"),
      atMs: incoming.referenceStartMs,
      outgoingShotId: outgoing.shotId,
      incomingShotId: incoming.shotId,
      transitionWindowIds: [],
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
): PracticeReferenceEffectWindowV1 => {
  const shots = shotsForWindow(reference, window);
  const shotIds = shots.map((shot) => shot.shotId);
  const relation = relationForWindow(window, shots);
  const familyId = classifyEffectFamilyV1(window.evidence);
  const summary = window.evidence.summary;
  const maskCoveragePeak = maxFrame(window, "maskCoverage");
  const occlusionPeak = Math.max(summary.occlusionPeak, maxFrame(window, "occlusion"));
  const objectAware = summary.subjectSeparationPeak >= 0.12
    || maskCoveragePeak >= 0.05
    || occlusionPeak >= 0.18;
  const temporalCue = temporalCueFor(familyId, shotIds, matches);
  return {
    windowId: window.windowId,
    effectFamilyId: familyId,
    startMs: window.startMs,
    endMs: window.endMs,
    anchorMs: window.anchorMs,
    shotIds,
    relation,
    transitionBoundaryMs: transitionBoundaryFor(window, relation, shotIds, cuts),
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
      subjectSeparationPeak: summary.subjectSeparationPeak,
      maskCoveragePeak,
      occlusionPeak,
    },
    temporalCue,
    evidenceRefs: unique([
      ...window.evidence.evidenceRefs,
      ...matches
        .filter((match) => shotIds.includes(match.shotId))
        .flatMap((match) => match.evidenceRefs),
      "practice-window-relation:" + relation,
      "practice-effect-family:" + familyId,
      "practice-temporal-behavior:" + temporalCue.behavior,
      ...(objectAware ? ["practice-object-aware-window:" + window.windowId] : []),
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
}): PracticeReferenceAnatomyV1 => {
  const baseCuts = buildCuts(input.reference);
  const effectWindows = input.sequence.windows.map((window) =>
    anatomyWindow(input.reference, window, baseCuts, input.matches));
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
      ...effectWindows.flatMap((window) => window.evidenceRefs),
      "practice-reference-cuts:" + String(cuts.length),
      "practice-reference-effect-windows:" + String(effectWindows.length),
      "practice-reference-rewind-shots:" + String(rewindShotIds.length),
      "practice-reference-object-aware-windows:" + String(objectAwareWindowIds.length),
    ]),
  };
};
