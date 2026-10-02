import {
  DEFAULT_PRACTICE_ACCELERATION_POLICY_V1,
  type PracticeSearchFunnelStageV1,
} from "./acceleration.js";

export interface PracticeScratchCandidateV1<T> {
  readonly candidateId: string;
  readonly value: T;
}

export interface PracticeScratchEvaluationV1<T> {
  readonly candidate: PracticeScratchCandidateV1<T>;
  readonly score: number;
  readonly definingCoverage: number;
  readonly evidenceRefs: readonly string[];
}

export interface PracticeScratchStageResultV1<T> {
  readonly stage: PracticeSearchFunnelStageV1;
  readonly evaluated: readonly PracticeScratchEvaluationV1<T>[];
  readonly retained: readonly PracticeScratchEvaluationV1<T>[];
}

export interface PracticeScratchSearchResultV1<T> {
  readonly schema: "editflow.practice-scratch-search-result.v1";
  readonly stages: readonly PracticeScratchStageResultV1<T>[];
  readonly finalists: readonly PracticeScratchEvaluationV1<T>[];
  readonly winner: PracticeScratchEvaluationV1<T> | null;
}

const objective = <T>(evaluation: PracticeScratchEvaluationV1<T>): number =>
  (Math.min(1, Math.max(0, evaluation.definingCoverage)) * 10)
  + Math.min(1, Math.max(0, evaluation.score));

const parallelMap = async <A, B>(
  values: readonly A[],
  concurrency: number,
  fn: (value: A) => Promise<B>,
): Promise<B[]> => {
  const output = new Array<B>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, values.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      output[index] = await fn(values[index]!);
    }
  });
  await Promise.all(workers);
  return output;
};

export class PracticeScratchCandidateRigV1<T> {
  constructor(
    readonly maxParallelJobs = DEFAULT_PRACTICE_ACCELERATION_POLICY_V1.maxParallelCpuJobs,
  ) {}

  async search(input: {
    readonly candidates: readonly PracticeScratchCandidateV1<T>[];
    readonly evaluate: (
      candidate: PracticeScratchCandidateV1<T>,
      stage: PracticeSearchFunnelStageV1,
    ) => Promise<Omit<PracticeScratchEvaluationV1<T>, "candidate">>;
    readonly funnel?: readonly PracticeSearchFunnelStageV1[];
  }): Promise<PracticeScratchSearchResultV1<T>> {
    const funnel = input.funnel ?? DEFAULT_PRACTICE_ACCELERATION_POLICY_V1.funnel;
    let active = [...input.candidates];
    const stages: PracticeScratchStageResultV1<T>[] = [];
    for (const stage of funnel) {
      if (active.length === 0) break;
      const stageCandidates = active.slice(0, stage.maxCandidates);
      const evaluated = await parallelMap(stageCandidates, this.maxParallelJobs, async (candidate) => ({
        candidate,
        ...await input.evaluate(candidate, stage),
      }));
      const retained = [...evaluated]
        .filter((item) => Number.isFinite(item.score) && Number.isFinite(item.definingCoverage))
        .sort((left, right) => objective(right) - objective(left))
        .slice(0, stage.maxCandidates);
      stages.push({ stage, evaluated, retained });
      const next = funnel[funnel.indexOf(stage) + 1];
      active = retained
        .slice(0, next?.maxCandidates ?? retained.length)
        .map((item) => item.candidate);
    }
    const finalists = stages.at(-1)?.retained ?? [];
    return {
      schema: "editflow.practice-scratch-search-result.v1",
      stages,
      finalists,
      winner: finalists[0] ?? null,
    };
  }
}
