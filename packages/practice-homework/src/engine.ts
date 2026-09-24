import type {
  EditFlowOperatingModeV1,
  EditTypeKnowledgeSnapshotV1,
  PracticeAttemptV1,
  PracticeAudioMatchV1,
  PracticeEpisodeV1,
  PracticeHomeworkAdaptersV1,
  PracticeLearningAllocationResultV1,
  PracticeSceneMatchV1,
  PracticeSessionRequestV1,
  PracticeSessionResultV1,
} from "./contracts.js";
import { EditTypeRegistryV1 } from "./edit-types.js";
import { PracticeLearningMemoryV1 } from "./memory.js";
import { finalizePracticeSimilarityReportV1 } from "./similarity.js";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export class EditFlowModeControllerV1 {
  #mode: EditFlowOperatingModeV1;

  constructor(initialMode: EditFlowOperatingModeV1 = "PRACTICE") {
    this.#mode = initialMode;
  }

  get mode(): EditFlowOperatingModeV1 {
    return this.#mode;
  }

  setMode(mode: EditFlowOperatingModeV1): void {
    this.#mode = mode;
  }
}

const selectBestAttempt = (
  attempts: readonly PracticeAttemptV1[],
): PracticeAttemptV1 | null => {
  let best: PracticeAttemptV1 | null = null;
  for (const attempt of attempts) {
    if (best === null) {
      best = attempt;
      continue;
    }
    const attemptPenalty = attempt.report.wrongSceneCount
      + attempt.report.unmatchedSceneCount
      + (1 - attempt.report.definingEffectCoverage);
    const bestPenalty = best.report.wrongSceneCount
      + best.report.unmatchedSceneCount
      + (1 - best.report.definingEffectCoverage);
    if (attemptPenalty < bestPenalty
      || (attemptPenalty === bestPenalty
        && attempt.report.overallSimilarity > best.report.overallSimilarity)) {
      best = attempt;
    }
  }
  return best;
};

const uniqueRefs = (refs: readonly string[]): readonly string[] =>
  [...new Set(refs.filter((ref) => ref.trim().length > 0))];

const validateMatches = (
  shotIds: readonly string[],
  matches: readonly PracticeSceneMatchV1[],
  minimumConfidence: number,
): readonly string[] => {
  const reasons: string[] = [];
  const byShot = new Map(matches.map((match) => [match.shotId, match]));
  for (const shotId of shotIds) {
    const match = byShot.get(shotId);
    if (match === undefined) {
      reasons.push("No source scene match was found for " + shotId + ".");
      continue;
    }
    if (match.confidence < minimumConfidence) {
      reasons.push("Source match confidence for " + shotId + " is below the exact-scene gate.");
    }
    if (match.sourceEndMs <= match.sourceStartMs) {
      reasons.push("Source match for " + shotId + " has an invalid time range.");
    }
    if (!Number.isFinite(match.playbackRate) || match.playbackRate <= 0) {
      reasons.push("Source match for " + shotId + " has an invalid playback rate.");
    }
  }
  if (byShot.size !== shotIds.length) {
    reasons.push("Scene matching must produce exactly one retained match per reference shot.");
  }
  return uniqueRefs(reasons);
};

const validateAudioMatch = (
  match: PracticeAudioMatchV1,
  minimumConfidence: number,
): readonly string[] => {
  const reasons: string[] = [];
  if (match.overallConfidence < minimumConfidence) {
    reasons.push("Song/audio match is below the configured exact-audio confidence gate.");
  }
  if (match.segments.length === 0) {
    reasons.push("Song/audio matching produced no retained reference-to-source segment.");
  }
  for (const segment of match.segments) {
    if (segment.referenceEndMs <= segment.referenceStartMs
      || segment.sourceEndMs <= segment.sourceStartMs) {
      reasons.push("Audio segment " + segment.segmentId + " has an invalid time range.");
    }
    if (!Number.isFinite(segment.playbackRate) || segment.playbackRate <= 0) {
      reasons.push("Audio segment " + segment.segmentId + " has an invalid playback rate.");
    }
    if (segment.confidence < minimumConfidence) {
      reasons.push("Audio segment " + segment.segmentId + " is below the exact-audio gate.");
    }
  }
  return uniqueRefs(reasons);
};

const allocationPrompt = (
  sessionId: string,
  editTypeId: string,
) => ({
  id: "allocate-practice-learning" as const,
  required: true as const,
  defaultEditTypeId: editTypeId,
  sessionId,
  message: "Choose the Edit Type that should receive this Practice session's learned successes and failures.",
});

export class PracticeHomeworkEngineV1 {
  readonly adapters: PracticeHomeworkAdaptersV1;
  readonly memory: PracticeLearningMemoryV1;
  readonly editTypes: EditTypeRegistryV1;

  constructor(
    adapters: PracticeHomeworkAdaptersV1,
    memory = new PracticeLearningMemoryV1(),
    editTypes = new EditTypeRegistryV1(),
  ) {
    this.adapters = adapters;
    this.memory = memory;
    this.editTypes = editTypes;
  }

  async allocateLearning(input: {
    readonly sessionId: string;
    readonly editTypeId: string;
  }): Promise<PracticeLearningAllocationResultV1> {
    const episode = this.memory.get(input.sessionId);
    if (episode === null) {
      throw new TypeError("Practice session is not available for learning allocation: " + input.sessionId);
    }
    if (episode.allocatedEditTypeId !== undefined
      && episode.allocatedEditTypeId !== input.editTypeId) {
      throw new TypeError(
        "Practice session was already allocated to Edit Type " + episode.allocatedEditTypeId + ".",
      );
    }
    const existing = this.editTypes.get(input.editTypeId);
    if (existing === null) {
      throw new TypeError("Unknown Edit Type: " + input.editTypeId);
    }
    if (episode.allocatedEditTypeId === input.editTypeId
      && existing.sessionIds.includes(episode.sessionId)) {
      return {
        sessionId: episode.sessionId,
        allocatedEditTypeId: input.editTypeId,
        profileRevision: existing.revision,
        evidenceCount: existing.behaviorEvidence
          .filter((item) => item.sessionId === episode.sessionId).length,
      };
    }
    const profile = this.editTypes.allocateEpisode(episode, input.editTypeId);
    const allocated: PracticeEpisodeV1 = {
      ...episode,
      allocatedEditTypeId: input.editTypeId,
    };
    this.memory.remember(allocated);
    await this.adapters.recordEpisode?.(allocated);
    return {
      sessionId: episode.sessionId,
      allocatedEditTypeId: input.editTypeId,
      profileRevision: profile.revision,
      evidenceCount: profile.behaviorEvidence
        .filter((item) => item.sessionId === episode.sessionId).length,
    };
  }

  async run(
    request: PracticeSessionRequestV1,
    knowledgeOverride?: EditTypeKnowledgeSnapshotV1,
    options?: { readonly retainEpisode?: boolean },
  ): Promise<PracticeSessionResultV1> {
    const retainEpisode = options?.retainEpisode !== false;
    const target = clamp01(request.minimumSimilarity ?? 0.95);
    const stretch = Math.max(target, clamp01(request.stretchSimilarity ?? 0.99));
    const maxAttempts = Math.max(1, Math.floor(request.maxAttempts ?? 48));
    const exactSceneConfidence = clamp01(request.exactSceneConfidence ?? 0.95);
    const minimumAudioConfidence = clamp01(request.minimumAudioConfidence ?? 0.90);
    const initialReasons: string[] = [];

    if (request.mode !== "PRACTICE") {
      initialReasons.push("PracticeHomeworkEngineV1 only executes PRACTICE sessions.");
    }
    if (!this.editTypes.has(request.editTypeId)) {
      initialReasons.push("A registered Edit Type must be selected before Practice can start.");
    }
    if (request.finish.role !== "FINISH_REFERENCE" || request.finish.mediaKind !== "VIDEO") {
      initialReasons.push("Finish must contain exactly one FINISH_REFERENCE video.");
    }
    if (request.start.length === 0
      || request.start.some((item) => item.role !== "START_SOURCE")) {
      initialReasons.push("Start must contain one or more START_SOURCE media items.");
    }
    if (!request.start.some((item) => item.mediaKind === "VIDEO")) {
      initialReasons.push("Practice Start requires at least one raw video source.");
    }
    if (initialReasons.length > 0) {
      return {
        schema: "editflow.practice-session-result.v1",
        sessionId: request.sessionId,
        editTypeId: request.editTypeId,
        status: "BLOCKED",
        reference: null,
        sourceIndex: null,
        matches: [],
        audioMatch: null,
        baseline: null,
        attempts: [],
        bestAttempt: null,
        targetSimilarity: target,
        stretchSimilarity: stretch,
        evidenceRefs: [],
        reasons: initialReasons,
        allocationPrompt: null,
      };
    }

    const retainedKnowledge = this.editTypes.knowledge(request.editTypeId);
    if (retainedKnowledge === null) {
      throw new TypeError(
        "Registered Edit Type disappeared before Practice execution: " + request.editTypeId,
      );
    }
    if (knowledgeOverride !== undefined
      && knowledgeOverride.editTypeId !== request.editTypeId) {
      throw new TypeError("Practice knowledge override does not match the selected Edit Type.");
    }
    const editTypeKnowledge = knowledgeOverride ?? retainedKnowledge;

    const reference = await this.adapters.analyzeFinish(request.finish);
    const sourceIndex = await this.adapters.indexStart(request.start);
    const matches = await this.adapters.matchScenes({
      reference,
      sourceIndex,
      minimumConfidence: exactSceneConfidence,
    });
    const matchReasons = validateMatches(
      reference.shots.map((shot) => shot.shotId),
      matches,
      exactSceneConfidence,
    );

    let audioMatch: PracticeAudioMatchV1 | null = null;
    const audioReasons: string[] = [];
    if (sourceIndex.audioSourceIds.length > 0) {
      if (this.adapters.matchAudio === undefined) {
        audioReasons.push(
          "Raw audio was supplied but no real Practice audio-matching capability is available.",
        );
      } else {
        audioMatch = await this.adapters.matchAudio({
          reference,
          sourceIndex,
          minimumConfidence: minimumAudioConfidence,
        });
        if (audioMatch === null) {
          audioReasons.push("No source song/audio match was found for the Finish reference.");
        } else {
          audioReasons.push(...validateAudioMatch(audioMatch, minimumAudioConfidence));
        }
      }
    }

    const blockingReasons = uniqueRefs([...matchReasons, ...audioReasons]);
    if (blockingReasons.length > 0) {
      return {
        schema: "editflow.practice-session-result.v1",
        sessionId: request.sessionId,
        editTypeId: request.editTypeId,
        status: "BLOCKED",
        reference,
        sourceIndex,
        matches,
        audioMatch,
        baseline: null,
        attempts: [],
        bestAttempt: null,
        targetSimilarity: target,
        stretchSimilarity: stretch,
        evidenceRefs: uniqueRefs([
          ...reference.evidenceRefs,
          ...sourceIndex.evidenceRefs,
          ...matches.flatMap((match) => match.evidenceRefs),
          ...(audioMatch?.evidenceRefs ?? []),
        ]),
        reasons: blockingReasons,
        allocationPrompt: null,
      };
    }

    const baseline = await this.adapters.buildContentBaseline({
      reference,
      matches,
      audioMatch,
    });
    const attempts: PracticeAttemptV1[] = [];

    for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
      const startedAt = Date.now();
      const reconstruction = await this.adapters.reconstruct({
        sessionId: request.sessionId,
        editTypeId: request.editTypeId,
        editTypeKnowledge,
        attempt: attemptNumber,
        reference,
        baseline,
        matches,
        priorAttempts: attempts,
      });
      const measured = await this.adapters.evaluate({
        reference,
        renderRef: reconstruction.renderRef,
        minimumSimilarity: target,
      });
      const report = finalizePracticeSimilarityReportV1(measured, target);
      attempts.push({
        attempt: attemptNumber,
        renderRef: reconstruction.renderRef,
        report,
        decisionTraces: reconstruction.decisionTraces,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        evidenceRefs: uniqueRefs([
          ...reconstruction.evidenceRefs,
          ...report.evidenceRefs,
        ]),
      });

      const bestAttempt = selectBestAttempt(attempts);
      const episode: PracticeEpisodeV1 = {
        sessionId: request.sessionId,
        selectedEditTypeId: request.editTypeId,
        styleFingerprint: reference.styleFingerprint,
        baselineId: baseline.baselineId,
        matches,
        audioMatch,
        attempts,
        mastered: bestAttempt?.report.passed ?? false,
        bestAttempt,
      };
      if (retainEpisode) {
        this.memory.remember(episode);
        await this.adapters.recordEpisode?.(episode);
      }
      if (bestAttempt?.report.passed === true) {
        return {
          schema: "editflow.practice-session-result.v1",
          sessionId: request.sessionId,
          editTypeId: request.editTypeId,
          status: "MASTERED",
          reference,
          sourceIndex,
          matches,
          audioMatch,
          baseline,
          attempts,
          bestAttempt,
          targetSimilarity: target,
          stretchSimilarity: stretch,
          evidenceRefs: uniqueRefs([
            ...reference.evidenceRefs,
            ...sourceIndex.evidenceRefs,
            ...baseline.evidenceRefs,
            ...attempts.flatMap((attempt) => attempt.evidenceRefs),
          ]),
          reasons: bestAttempt.report.overallSimilarity >= stretch
            ? ["Practice target and stretch target both satisfied."]
            : ["Practice target satisfied; retained as a mastered reconstruction."],
          allocationPrompt: retainEpisode
            ? allocationPrompt(request.sessionId, request.editTypeId)
            : null,
        };
      }
    }

    const bestAttempt = selectBestAttempt(attempts);
    return {
      schema: "editflow.practice-session-result.v1",
      sessionId: request.sessionId,
      editTypeId: request.editTypeId,
      status: "HUMAN_REVIEW_REQUIRED",
      reference,
      sourceIndex,
      matches,
      audioMatch,
      baseline,
      attempts,
      bestAttempt,
      targetSimilarity: target,
      stretchSimilarity: stretch,
      evidenceRefs: uniqueRefs([
        ...reference.evidenceRefs,
        ...sourceIndex.evidenceRefs,
        ...baseline.evidenceRefs,
        ...attempts.flatMap((attempt) => attempt.evidenceRefs),
      ]),
      reasons: [
        "No reconstruction satisfied the " + String(Math.round(target * 100))
          + "% practice gate within the configured attempt budget.",
        "The strongest retained attempt should be exported for human evaluation and diagnosis.",
      ],
      allocationPrompt: retainEpisode
        ? allocationPrompt(request.sessionId, request.editTypeId)
        : null,
    };
  }
}
