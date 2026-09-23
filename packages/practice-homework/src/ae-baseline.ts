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
