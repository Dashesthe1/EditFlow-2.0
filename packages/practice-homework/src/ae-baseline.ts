import { createHash } from "node:crypto";

import type {
  PracticeAudioMatchV1,
  PracticeAudioSegmentMatchV1,
  PracticeContentBaselineV1,
  PracticeReferenceAnalysisV1,
  PracticeSceneMatchV1,
} from "./contracts.js";

export type PracticeAeBaselineCommandV1 =
  | "media.import"
  | "comp.create"
  | "layer.add_media"
  | "layer.set_timing"
  | "layer.time_remap.enable"
  | "property.set_keyframes"
  | "layer.switches.set";

export interface PracticeAeBaselineOperationV1 {
  readonly operationId: string;
  readonly command: PracticeAeBaselineCommandV1;
  readonly capabilityId:
    | "ae.media.import"
    | "ae.comp.create"
    | "ae.layer.create"
    | "ae.layer.timing.set"
    | "ae.layer.time_remap.enable"
    | "ae.keyframe.set"
    | "ae.layer.switches.set";
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface PracticeAeBaselinePlanV1 {
  readonly schema: "editflow.practice-ae-baseline-plan.v1";
  readonly baselineId: string;
  readonly referenceId: string;
  readonly compStableId: string;
  readonly durationMs: number;
  readonly frameRate: number;
  readonly audioMatchId: string | null;
  readonly operations: readonly PracticeAeBaselineOperationV1[];
  readonly evidenceRefs: readonly string[];
}

export interface PracticeAeBaselineCommandRunnerV1 {
  execute(operation: PracticeAeBaselineOperationV1): Promise<{
    readonly evidenceRefs?: readonly string[];
  }>;
}

export interface PracticeAeBaselineBatchRunnerV1 {
  executePlan(plan: PracticeAeBaselinePlanV1): Promise<{
    readonly evidenceRefs?: readonly string[];
  }>;
}

export type PracticeAeBaselineRunnerV1 =
  | PracticeAeBaselineCommandRunnerV1
  | PracticeAeBaselineBatchRunnerV1;

const digest = (value: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");

const stableToken = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 42) || "item";

const commandCapability = (
  command: PracticeAeBaselineCommandV1,
): PracticeAeBaselineOperationV1["capabilityId"] => {
  switch (command) {
    case "media.import": return "ae.media.import";
    case "comp.create": return "ae.comp.create";
    case "layer.add_media": return "ae.layer.create";
    case "layer.set_timing": return "ae.layer.timing.set";
    case "layer.time_remap.enable": return "ae.layer.time_remap.enable";
    case "property.set_keyframes": return "ae.keyframe.set";
    case "layer.switches.set": return "ae.layer.switches.set";
  }
};

const operation = (
  baselineId: string,
  ordinal: number,
  command: PracticeAeBaselineCommandV1,
  payload: Readonly<Record<string, unknown>>,
): PracticeAeBaselineOperationV1 => ({
  operationId: baselineId + ":op:" + String(ordinal).padStart(3, "0"),
  command,
  capabilityId: commandCapability(command),
  payload,
});

const AE_LAYER_START_TIME_LIMIT_SECONDS = 10800;

interface PracticeMatchTimingPlanV1 {
  readonly timing: Readonly<Record<string, number>>;
  readonly timeRemapKeyframes: readonly {
    readonly time: number;
    readonly value: number;
  }[] | null;
}

type PracticeTrajectoryPointV1 = NonNullable<PracticeSceneMatchV1["trajectory"]>[number];

const monotonicTrajectorySubset = (
  match: PracticeSceneMatchV1,
  trajectory: readonly PracticeTrajectoryPointV1[],
): readonly PracticeTrajectoryPointV1[] | null => {
  const behavior = match.temporalBehavior ?? match.direction;
  if (behavior !== "FORWARD" && behavior !== "REVERSE") return trajectory;
  if (trajectory.length < 3) return null;

  const expectedSign = behavior === "FORWARD" ? 1 : -1;
  const scores = trajectory.map((point) => 0.35 + Math.max(0, Math.min(1, point.similarity)));
  const counts = trajectory.map(() => 1);
  const previous = trajectory.map(() => -1);

  for (let right = 0; right < trajectory.length; right += 1) {
    for (let left = 0; left < right; left += 1) {
      const sourceDelta = trajectory[right]!.sourceTimeMs - trajectory[left]!.sourceTimeMs;
      if ((expectedSign * sourceDelta) <= 1e-3) continue;
      const candidateScore = scores[left]! + 0.35
        + Math.max(0, Math.min(1, trajectory[right]!.similarity));
      const candidateCount = counts[left]! + 1;
      if (candidateScore > scores[right]! + 1e-9
        || (Math.abs(candidateScore - scores[right]!) <= 1e-9
          && candidateCount > counts[right]!)) {
        scores[right] = candidateScore;
        counts[right] = candidateCount;
        previous[right] = left;
      }
    }
  }

  let bestIndex = 0;
  for (let index = 1; index < trajectory.length; index += 1) {
    if (scores[index]! > scores[bestIndex]! + 1e-9
      || (Math.abs(scores[index]! - scores[bestIndex]!) <= 1e-9
        && counts[index]! > counts[bestIndex]!)) bestIndex = index;
  }
  const retained: PracticeTrajectoryPointV1[] = [];
  for (let index = bestIndex; index >= 0; index = previous[index]!) {
    retained.push(trajectory[index]!);
    if (previous[index] === -1) break;
  }
  retained.reverse();
  if (retained.length < 3) return null;

  const originalSpan = trajectory[trajectory.length - 1]!.referenceTimeMs
    - trajectory[0]!.referenceTimeMs;
  const retainedSpan = retained[retained.length - 1]!.referenceTimeMs
    - retained[0]!.referenceTimeMs;
  const retainedFraction = retained.length / trajectory.length;
  const spanCoverage = originalSpan <= 1e-6 ? 1 : retainedSpan / originalSpan;
  if (retainedFraction < 0.60 || spanCoverage < 0.65) return null;
  return retained;
};

const trajectoryNeedsVariableRateRemap = (
  shot: PracticeReferenceAnalysisV1["shots"][number],
  match: PracticeSceneMatchV1,
  trajectory: readonly PracticeTrajectoryPointV1[],
): boolean => {
  const behavior = match.temporalBehavior ?? match.direction;
  if (behavior !== "FORWARD" && behavior !== "REVERSE") return false;
  if (trajectory.length < 3) return false;

  const expectedSign = behavior === "FORWARD" ? 1 : -1;
  const segmentRates: number[] = [];
  for (let index = 1; index < trajectory.length; index += 1) {
    const left = trajectory[index - 1]!;
    const right = trajectory[index]!;
    const referenceDelta = right.referenceTimeMs - left.referenceTimeMs;
    const sourceDelta = right.sourceTimeMs - left.sourceTimeMs;
    if (referenceDelta <= 1e-6 || Math.abs(sourceDelta) <= 1e-6) return false;
    if (Math.sign(sourceDelta) !== expectedSign) return false;
    segmentRates.push(Math.abs(sourceDelta / referenceDelta));
  }
  if (segmentRates.length < 2) return false;

  const first = trajectory[0]!;
  const last = trajectory[trajectory.length - 1]!;
  const referenceSpan = last.referenceTimeMs - first.referenceTimeMs;
  if (referenceSpan <= 1e-6) return false;
  const endpointSlope = (last.sourceTimeMs - first.sourceTimeMs) / referenceSpan;
  const residuals = trajectory.map((point) => {
    const predicted = first.sourceTimeMs
      + endpointSlope * (point.referenceTimeMs - first.referenceTimeMs);
    return point.sourceTimeMs - predicted;
  });
  const residualRmsMs = Math.sqrt(
    residuals.reduce((sum, value) => sum + (value * value), 0) / residuals.length,
  );
  const durationMs = Math.max(1, shot.referenceEndMs - shot.referenceStartMs);
  const residualFloorMs = Math.max(45, Math.min(120, durationMs * 0.04));
  const minimumRate = Math.min(...segmentRates);
  const maximumRate = Math.max(...segmentRates);
  const rateSpread = minimumRate <= 1e-6 ? Number.POSITIVE_INFINITY : maximumRate / minimumRate;
  const similarities = trajectory.map((point) => point.similarity);
  const meanSimilarity = similarities.reduce((sum, value) => sum + value, 0) / similarities.length;
  const minimumSimilarity = Math.min(...similarities);

  return meanSimilarity >= 0.80
    && minimumSimilarity >= 0.60
    && rateSpread >= 1.30
    && residualRmsMs >= residualFloorMs;
};

const trajectoryTimeRemapKeyframes = (
  shot: PracticeReferenceAnalysisV1["shots"][number],
  match: PracticeSceneMatchV1,
): PracticeMatchTimingPlanV1["timeRemapKeyframes"] => {
  const preserveMeasuredRewind = match.rewind?.detected === true
    && match.temporalBehavior === "FORWARD_THEN_REWIND";
  const trajectory = [...(match.trajectory ?? [])]
    .filter((point) =>
      Number.isFinite(point.referenceTimeMs)
      && Number.isFinite(point.sourceTimeMs)
      && Number.isFinite(point.similarity)
      && point.referenceTimeMs >= shot.referenceStartMs
      && point.referenceTimeMs <= shot.referenceEndMs)
    .sort((a, b) => a.referenceTimeMs - b.referenceTimeMs);
  if (trajectory.length < 3) return null;

  const uniqueTrajectory = trajectory.filter((point, index) =>
    index === 0 || Math.abs(point.referenceTimeMs - trajectory[index - 1]!.referenceTimeMs) > 1e-3);
  if (uniqueTrajectory.length < 3) return null;
  const preparedTrajectory = preserveMeasuredRewind
    ? uniqueTrajectory
    : monotonicTrajectorySubset(match, uniqueTrajectory);
  if (preparedTrajectory === null || preparedTrajectory.length < 3) return null;
  if (!preserveMeasuredRewind
    && !trajectoryNeedsVariableRateRemap(shot, match, preparedTrajectory)) return null;
  const first = preparedTrajectory[0]!;
  const second = preparedTrajectory[1]!;
  const penultimate = preparedTrajectory[preparedTrajectory.length - 2]!;
  const last = preparedTrajectory[preparedTrajectory.length - 1]!;
  const sourceMinimum = Math.min(match.sourceStartMs, ...preparedTrajectory.map((point) => point.sourceTimeMs));
  const sourceMaximum = Math.max(match.sourceEndMs, ...preparedTrajectory.map((point) => point.sourceTimeMs));
  const sourceAt = (
    referenceTimeMs: number,
    left: typeof first,
    right: typeof first,
  ): number => {
    const referenceDelta = right.referenceTimeMs - left.referenceTimeMs;
    const slope = Math.abs(referenceDelta) <= 1e-6
      ? 0
      : (right.sourceTimeMs - left.sourceTimeMs) / referenceDelta;
    return Math.min(
      sourceMaximum,
      Math.max(sourceMinimum, left.sourceTimeMs + slope * (referenceTimeMs - left.referenceTimeMs)),
    );
  };
  const points = [
    {
      referenceTimeMs: shot.referenceStartMs,
      sourceTimeMs: sourceAt(shot.referenceStartMs, first, second),
    },
    ...preparedTrajectory.map((point) => ({
      referenceTimeMs: point.referenceTimeMs,
      sourceTimeMs: point.sourceTimeMs,
    })),
    {
      referenceTimeMs: shot.referenceEndMs,
      sourceTimeMs: sourceAt(shot.referenceEndMs, penultimate, last),
    },
  ];
  return points
    .filter((point, index) =>
      index === 0 || Math.abs(point.referenceTimeMs - points[index - 1]!.referenceTimeMs) > 1e-3)
    .map((point) => ({
      time: point.referenceTimeMs / 1000,
      value: point.sourceTimeMs / 1000,
    }));
};

const timingPlanForMatch = (
  shot: PracticeReferenceAnalysisV1["shots"][number],
  match: PracticeSceneMatchV1,
): PracticeMatchTimingPlanV1 => {
  if (!Number.isFinite(match.playbackRate) || match.playbackRate <= 0) {
    throw new TypeError("Invalid playback rate for " + match.shotId + ".");
  }
  const refStart = shot.referenceStartMs / 1000;
  const refEnd = shot.referenceEndMs / 1000;
  const sourceStart = match.sourceStartMs / 1000;
  const sourceEnd = match.sourceEndMs / 1000;
  const measuredTrajectory = trajectoryTimeRemapKeyframes(shot, match);
  if (measuredTrajectory !== null) {
    return {
      timing: {
        startTime: refStart,
        inPoint: refStart,
        outPoint: refEnd,
        stretch: 100,
      },
      timeRemapKeyframes: measuredTrajectory,
    };
  }
  const slope = match.direction === "FORWARD"
    ? match.playbackRate
    : -match.playbackRate;
  const sourceAtReferenceStart = match.direction === "FORWARD"
    ? sourceStart
    : sourceEnd;
  const directStartTime = refStart - (sourceAtReferenceStart / slope);
  if (Math.abs(directStartTime) <= AE_LAYER_START_TIME_LIMIT_SECONDS) {
    return {
      timing: {
        startTime: directStartTime,
        inPoint: refStart,
        outPoint: refEnd,
        stretch: 100 / slope,
      },
      timeRemapKeyframes: null,
    };
  }

  return {
    timing: {
      startTime: refStart,
      inPoint: refStart,
      outPoint: refEnd,
      stretch: 100,
    },
    timeRemapKeyframes: [
      {
        time: refStart,
        value: sourceAtReferenceStart,
      },
      {
        time: refEnd,
        value: match.direction === "FORWARD" ? sourceEnd : sourceStart,
      },
    ],
  };
};

const timingForAudioSegment = (
  segment: PracticeAudioSegmentMatchV1,
): Readonly<Record<string, number>> => {
  if (!Number.isFinite(segment.playbackRate) || segment.playbackRate <= 0) {
    throw new TypeError("Invalid audio playback rate for " + segment.segmentId + ".");
  }
  const refStart = segment.referenceStartMs / 1000;
  const refEnd = segment.referenceEndMs / 1000;
  const sourceStart = segment.sourceStartMs / 1000;
  const slope = segment.playbackRate;
  return {
    startTime: refStart - (sourceStart / slope),
    inPoint: refStart,
    outPoint: refEnd,
    stretch: 100 / slope,
  };
};

export const compilePracticeAeBaselinePlanV1 = (input: {
  readonly reference: PracticeReferenceAnalysisV1;
  readonly matches: readonly PracticeSceneMatchV1[];
  readonly audioMatch?: PracticeAudioMatchV1 | null;
  readonly compName?: string;
}): PracticeAeBaselinePlanV1 => {
  const { reference } = input;
  const audioMatch = input.audioMatch ?? null;
  if (reference.video === undefined) {
    throw new TypeError("Practice AE baseline requires reference video metadata.");
  }
  if (input.matches.length !== reference.shots.length) {
    throw new TypeError("Practice AE baseline requires one match per reference shot.");
  }

  const byShot = new Map(input.matches.map((match) => [match.shotId, match]));
  const orderedShots = [...reference.shots].sort((a, b) => a.order - b.order);
  if (byShot.size !== orderedShots.length) {
    throw new TypeError("Practice AE baseline contains duplicate or missing shot matches.");
  }

  const identityMaterial = orderedShots.map((shot) => {
    const match = byShot.get(shot.shotId);
    if (match === undefined) throw new TypeError("Missing source match for " + shot.shotId + ".");
    return {
      shotId: shot.shotId,
      referenceStartMs: shot.referenceStartMs,
      referenceEndMs: shot.referenceEndMs,
      sourceId: match.sourceId,
      sourcePath: match.sourcePath ?? null,
      sourceStartMs: match.sourceStartMs,
      sourceEndMs: match.sourceEndMs,
      direction: match.direction,
      playbackRate: match.playbackRate,
      temporalBehavior: match.temporalBehavior ?? null,
      rewind: match.rewind ?? null,
      trajectory: match.trajectory ?? [],
    };
  });
  const audioIdentity = audioMatch === null ? null : {
    matchId: audioMatch.matchId,
    sourceId: audioMatch.sourceId,
    sourcePath: audioMatch.sourcePath ?? null,
    segments: audioMatch.segments.map((segment) => ({
      segmentId: segment.segmentId,
      referenceStartMs: segment.referenceStartMs,
      referenceEndMs: segment.referenceEndMs,
      sourceStartMs: segment.sourceStartMs,
      sourceEndMs: segment.sourceEndMs,
      playbackRate: segment.playbackRate,
    })),
  };
  const shortHash = digest({
    referenceId: reference.referenceId,
    styleFingerprint: reference.styleFingerprint,
    identityMaterial,
    audioIdentity,
  }).slice(0, 16);
  const baselineId = "practice-baseline:" + shortHash;
  const compStableId = "PRACTICE_BASELINE_COMP_" + shortHash;

  const sourcePaths = new Map<string, string>();
  for (const match of input.matches) {
    if (match.sourcePath === undefined || match.sourcePath.trim().length === 0) {
      throw new TypeError(
        "Practice AE baseline requires a resolved local source path for " + match.sourceId + ".",
      );
    }
    const prior = sourcePaths.get(match.sourceId);
    if (prior !== undefined && prior !== match.sourcePath) {
      throw new TypeError("Source id " + match.sourceId + " resolved to more than one local path.");
    }
    sourcePaths.set(match.sourceId, match.sourcePath);
  }
  if (audioMatch !== null) {
    if (audioMatch.sourcePath === undefined || audioMatch.sourcePath.trim().length === 0) {
      throw new TypeError("Practice AE baseline requires a resolved source path for matched audio.");
    }
    const prior = sourcePaths.get(audioMatch.sourceId);
    if (prior !== undefined && prior !== audioMatch.sourcePath) {
      throw new TypeError(
        "Audio source id " + audioMatch.sourceId + " conflicts with an existing media path.",
      );
    }
    sourcePaths.set(audioMatch.sourceId, audioMatch.sourcePath);
  }

  const sourceStableIds = new Map<string, string>();
  const operations: PracticeAeBaselineOperationV1[] = [];
  let ordinal = 1;
  for (const [sourceId, sourcePath] of [...sourcePaths.entries()]
    .sort(([a], [b]) => a.localeCompare(b))) {
    const sourceStableId = "PRACTICE_MEDIA_" + shortHash + "_" + stableToken(sourceId);
    sourceStableIds.set(sourceId, sourceStableId);
    operations.push(operation(baselineId, ordinal, "media.import", {
      path: sourcePath,
      stableId: sourceStableId,
      sequence: false,
    }));
    ordinal += 1;
  }

  operations.push(operation(baselineId, ordinal, "comp.create", {
    stableId: compStableId,
    name: input.compName ?? ("Practice Baseline - " + reference.referenceId),
    width: reference.video.width,
    height: reference.video.height,
    pixelAspect: 1,
    duration: reference.video.durationMs / 1000,
    frameRate: reference.video.fps,
  }));
  ordinal += 1;

  for (const shot of orderedShots) {
    const match = byShot.get(shot.shotId);
    if (match === undefined) throw new TypeError("Missing source match for " + shot.shotId + ".");
    const sourceStableId = sourceStableIds.get(match.sourceId);
    if (sourceStableId === undefined) {
      throw new TypeError("No imported media identity exists for " + match.sourceId + ".");
    }
    const layerStableId = "PRACTICE_SHOT_" + shortHash + "_"
      + String(shot.order + 1).padStart(4, "0");
    const timingPlan = timingPlanForMatch(shot, match);
    operations.push(operation(baselineId, ordinal, "layer.add_media", {
      stableId: layerStableId,
      comp: { stableId: compStableId },
      item: { stableId: sourceStableId },
    }));
    ordinal += 1;
    operations.push(operation(baselineId, ordinal, "layer.set_timing", {
      comp: { stableId: compStableId },
      layer: { stableId: layerStableId },
      timing: timingPlan.timing,
    }));
    ordinal += 1;
    if (timingPlan.timeRemapKeyframes !== null) {
      operations.push(operation(baselineId, ordinal, "layer.time_remap.enable", {
        comp: { stableId: compStableId },
        layer: { stableId: layerStableId },
      }));
      ordinal += 1;
      operations.push(operation(baselineId, ordinal, "property.set_keyframes", {
        comp: { stableId: compStableId },
        layer: { stableId: layerStableId },
        propertyPath: ["ADBE Time Remapping"],
        keyframes: timingPlan.timeRemapKeyframes,
      }));
      ordinal += 1;
    }
    operations.push(operation(baselineId, ordinal, "layer.switches.set", {
      comp: { stableId: compStableId },
      layer: { stableId: layerStableId },
      switches: { audioEnabled: false },
    }));
    ordinal += 1;
  }

  if (audioMatch !== null) {
    const sourceStableId = sourceStableIds.get(audioMatch.sourceId);
    if (sourceStableId === undefined) {
      throw new TypeError("Matched Practice audio source was not imported.");
    }
    for (const [index, segment] of audioMatch.segments.entries()) {
      const layerStableId = "PRACTICE_AUDIO_" + shortHash + "_"
        + String(index + 1).padStart(3, "0");
      operations.push(operation(baselineId, ordinal, "layer.add_media", {
        stableId: layerStableId,
        comp: { stableId: compStableId },
        item: { stableId: sourceStableId },
      }));
      ordinal += 1;
      operations.push(operation(baselineId, ordinal, "layer.set_timing", {
        comp: { stableId: compStableId },
        layer: { stableId: layerStableId },
        timing: timingForAudioSegment(segment),
      }));
      ordinal += 1;
      operations.push(operation(baselineId, ordinal, "layer.switches.set", {
        comp: { stableId: compStableId },
        layer: { stableId: layerStableId },
        switches: { audioEnabled: true },
      }));
      ordinal += 1;
    }
  }

  return {
    schema: "editflow.practice-ae-baseline-plan.v1",
    baselineId,
    referenceId: reference.referenceId,
    compStableId,
    durationMs: reference.video.durationMs,
    frameRate: reference.video.fps,
    audioMatchId: audioMatch?.matchId ?? null,
    operations,
    evidenceRefs: [
      ...reference.evidenceRefs,
      ...input.matches.flatMap((match) => match.evidenceRefs),
      ...(audioMatch?.evidenceRefs ?? []),
      "practice-baseline-plan:sha256:" + digest(operations),
    ],
  };
};

export class PracticeAeBaselineBuilderV1 {
  readonly runner: PracticeAeBaselineRunnerV1;
  readonly #plans = new Map<string, PracticeAeBaselinePlanV1>();

  constructor(runner: PracticeAeBaselineRunnerV1) {
    this.runner = runner;
  }

  plan(baselineId: string): PracticeAeBaselinePlanV1 | null {
    const plan = this.#plans.get(baselineId);
    return plan === undefined ? null : structuredClone(plan);
  }

  buildContentBaseline = async (input: {
    readonly reference: PracticeReferenceAnalysisV1;
    readonly matches: readonly PracticeSceneMatchV1[];
    readonly audioMatch?: PracticeAudioMatchV1 | null;
  }): Promise<PracticeContentBaselineV1> => {
    const plan = compilePracticeAeBaselinePlanV1(input);
    const evidenceRefs = [...plan.evidenceRefs];
    if ("executePlan" in this.runner) {
      const result = await this.runner.executePlan(plan);
      evidenceRefs.push(
        "practice-ae-plan:" + plan.baselineId,
        ...(result.evidenceRefs ?? []),
      );
    } else {
      for (const operationValue of plan.operations) {
        const result = await this.runner.execute(operationValue);
        evidenceRefs.push(
          "practice-ae-operation:" + operationValue.operationId,
          ...(result.evidenceRefs ?? []),
        );
      }
    }
    this.#plans.set(plan.baselineId, plan);
    return {
      baselineId: plan.baselineId,
      timelineRef: "ae:comp:" + plan.compStableId,
      ...(plan.audioMatchId === null
        ? {}
        : { audioTimelineRef: "ae:comp:" + plan.compStableId + "#audio:" + plan.audioMatchId }),
      evidenceRefs: [...new Set(evidenceRefs)],
    };
  };
}
