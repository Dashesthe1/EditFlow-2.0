import type {
  EditFlowOperatingModeV1,
  PracticeAttemptV1,
  PracticeEpisodeV1,
  PracticeHomeworkAdaptersV1,
  PracticeSceneMatchV1,
  PracticeSessionRequestV1,
  PracticeSessionResultV1,
} from "./contracts.js";
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
      reasons.push(`No source scene match was found for ${shotId}.`);
      continue;
    }
    if (match.confidence < minimumConfidence) {
      reasons.push(`Source match confidence for ${shotId} is below the exact-scene gate.`);
    }
    if (match.sourceEndMs <= match.sourceStartMs) {
      reasons.push(`Source match for ${shotId} has an invalid time range.`);
    }
    if (!Number.isFinite(match.playbackRate) || match.playbackRate <= 0) {
      reasons.push(`Source match for ${shotId} has an invalid playback rate.`);
    }
  }
  if (byShot.size !== shotIds.length) {
    reasons.push("Scene matching must produce exactly one retained match per reference shot.");
  }
  return uniqueRefs(reasons);
};
export class PracticeHomeworkEngineV1 {
  readonly adapters: PracticeHomeworkAdaptersV1;
  readonly memory: PracticeLearningMemoryV1;

  constructor(
    adapters: PracticeHomeworkAdaptersV1,
    memory = new PracticeLearningMemoryV1(),
  ) {
    this.adapters = adapters;
    this.memory = memory;
  }

  async run(request: PracticeSessionRequestV1): Promise<PracticeSessionResultV1> {
    const target = clamp01(request.minimumSimilarity ?? 0.95);
    const stretch = Math.max(target, clamp01(request.stretchSimilarity ?? 0.99));
    const maxAttempts = Math.max(1, Math.floor(request.maxAttempts ?? 48));
    const exactSceneConfidence = clamp01(request.exactSceneConfidence ?? 0.95);
    const initialReasons: string[] = [];

    if (request.mode !== "PRACTICE") {
      initialReasons.push("PracticeHomeworkEngineV1 only executes PRACTICE sessions.");
    }
    if (request.finish.role !== "FINISH_REFERENCE") {
      initialReasons.push("Finish must contain exactly one FINISH_REFERENCE media item.");
    }
    if (request.start.length === 0
      || request.start.some((item) => item.role !== "START_SOURCE")) {
      initialReasons.push("Start must contain one or more START_SOURCE media items.");
    }
    if (initialReasons.length > 0) {
      return {
        schema: "editflow.practice-session-result.v1",
        sessionId: request.sessionId,
        status: "BLOCKED",
        reference: null,
        sourceIndex: null,
        matches: [],
        baseline: null,
        attempts: [],
        bestAttempt: null,
        targetSimilarity: target,
        stretchSimilarity: stretch,
        evidenceRefs: [],
        reasons: initialReasons,
      };
    }

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
    if (matchReasons.length > 0) {
      return {
        schema: "editflow.practice-session-result.v1",
        sessionId: request.sessionId,
        status: "BLOCKED",
        reference,
        sourceIndex,
        matches,
        baseline: null,
        attempts: [],
        bestAttempt: null,
        targetSimilarity: target,
        stretchSimilarity: stretch,
        evidenceRefs: uniqueRefs([
          ...reference.evidenceRefs,
          ...sourceIndex.evidenceRefs,
          ...matches.flatMap((match) => match.evidenceRefs),
        ]),
        reasons: matchReasons,
      };
    }

    const baseline = await this.adapters.buildContentBaseline({ reference, matches });
    const attempts: PracticeAttemptV1[] = [];

    for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
      const reconstruction = await this.adapters.reconstruct({
        sessionId: request.sessionId,
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
        evidenceRefs: uniqueRefs([
          ...reconstruction.evidenceRefs,
          ...report.evidenceRefs,
        ]),
      });

      const bestAttempt = selectBestAttempt(attempts);
      const episode: PracticeEpisodeV1 = {
        sessionId: request.sessionId,
        styleFingerprint: reference.styleFingerprint,
        baselineId: baseline.baselineId,
        matches,
        attempts,
        mastered: bestAttempt?.report.passed ?? false,
        bestAttempt,
      };
      this.memory.remember(episode);
      await this.adapters.recordEpisode?.(episode);
      if (bestAttempt?.report.passed === true) {
        return {
          schema: "editflow.practice-session-result.v1",
          sessionId: request.sessionId,
          status: "MASTERED",
          reference,
          sourceIndex,
          matches,
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
        };
      }
    }
    const bestAttempt = selectBestAttempt(attempts);
    return {
      schema: "editflow.practice-session-result.v1",
      sessionId: request.sessionId,
      status: "HUMAN_REVIEW_REQUIRED",
      reference,
      sourceIndex,
      matches,
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
        `No reconstruction satisfied the ${Math.round(target * 100)}% practice gate within the configured attempt budget.`,
        "The strongest retained attempt should be exported for human evaluation and diagnosis.",
      ],
    };
  }
}
