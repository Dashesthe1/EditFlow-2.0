export interface PracticeSearchFunnelStageV1 {
  readonly id: "COARSE" | "MID" | "FULL";
  readonly resolutionScale: number;
  readonly maxCandidates: number;
  readonly criticalFramesOnly: boolean;
}

export interface PracticeAccelerationPolicyV1 {
  readonly schema: "editflow.practice-acceleration-policy.v1";
  readonly targetOperatorLoopSpeedup: number;
  readonly targetEndToEndSpeedup: number;
  readonly buildWholeEditBeforeCertification: true;
  readonly sourceDecisionsBatchable: true;
  readonly scratchSearchIsNonCanonical: true;
  readonly gptReviewTopK: number;
  readonly maxMicroCorrectionRoundsPerPhase: number;
  readonly minimumRelativeGainToContinueMicroTuning: number;
  readonly candidateBatchSize: number;
  readonly maxParallelCpuJobs: number;
  readonly residualFocusFraction: number;
  readonly funnel: readonly PracticeSearchFunnelStageV1[];
}

export const DEFAULT_PRACTICE_ACCELERATION_POLICY_V1: PracticeAccelerationPolicyV1 = {
  schema: "editflow.practice-acceleration-policy.v1",
  targetOperatorLoopSpeedup: 100,
  targetEndToEndSpeedup: 100,
  buildWholeEditBeforeCertification: true,
  sourceDecisionsBatchable: true,
  scratchSearchIsNonCanonical: true,
  gptReviewTopK: 3,
  maxMicroCorrectionRoundsPerPhase: 2,
  minimumRelativeGainToContinueMicroTuning: 0.01,
  candidateBatchSize: 32,
  maxParallelCpuJobs: 4,
  residualFocusFraction: 0.2,
  funnel: [
    { id: "COARSE", resolutionScale: 0.125, maxCandidates: 32, criticalFramesOnly: true },
    { id: "MID", resolutionScale: 0.25, maxCandidates: 8, criticalFramesOnly: true },
    { id: "FULL", resolutionScale: 1, maxCandidates: 2, criticalFramesOnly: false },
  ],
};

export interface PracticeCandidateScoreV1 {
  readonly candidateId: string;
  readonly score: number;
}

export const retainTopPracticeCandidatesV1 = (
  candidates: readonly PracticeCandidateScoreV1[],
  limit: number,
): readonly PracticeCandidateScoreV1[] =>
  [...candidates]
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.floor(limit)));

export const shouldEscalatePracticeHypothesisV1 = (input: {
  readonly microCorrectionRound: number;
  readonly priorScore: number;
  readonly currentScore: number;
  readonly policy?: PracticeAccelerationPolicyV1;
}): boolean => {
  const policy = input.policy ?? DEFAULT_PRACTICE_ACCELERATION_POLICY_V1;
  if (input.microCorrectionRound >= policy.maxMicroCorrectionRoundsPerPhase) return true;
  if (!Number.isFinite(input.priorScore) || !Number.isFinite(input.currentScore)) return true;
  const denominator = Math.max(Math.abs(input.priorScore), Number.EPSILON);
  const relativeGain = (input.currentScore - input.priorScore) / denominator;
  return relativeGain < policy.minimumRelativeGainToContinueMicroTuning;
};


export interface PracticeResidualV1 {
  readonly phaseId: string;
  readonly similarity: number;
  readonly durationMs: number;
  readonly viewerSalience?: number;
  readonly wrongSource?: boolean;
  readonly temporalMismatch?: boolean;
  readonly definingEffectMissing?: boolean;
  readonly transitionMismatch?: boolean;
  readonly dependencyPhaseIds?: readonly string[];
}

export interface RankedPracticeResidualV1 extends PracticeResidualV1 {
  readonly priority: number;
}

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

export const rankPracticeResidualsV1 = (
  residuals: readonly PracticeResidualV1[],
): readonly RankedPracticeResidualV1[] =>
  residuals
    .map((residual) => {
      const similaritySeverity = 1 - clampUnit(residual.similarity);
      const salience = clampUnit(residual.viewerSalience ?? 0.5);
      const durationWeight = Math.min(1.5, Math.max(0.5, Math.sqrt(Math.max(1, residual.durationMs) / 500)));
      const structuralPenalty =
        (residual.wrongSource ? 1.5 : 0)
        + (residual.definingEffectMissing ? 1.0 : 0)
        + (residual.temporalMismatch ? 0.6 : 0)
        + (residual.transitionMismatch ? 0.45 : 0);
      return {
        ...residual,
        priority: (similaritySeverity * 2 + salience + structuralPenalty) * durationWeight,
      };
    })
    .sort((left, right) => right.priority - left.priority);

export const selectPracticeResidualFocusSetV1 = (
  residuals: readonly PracticeResidualV1[],
  fraction = DEFAULT_PRACTICE_ACCELERATION_POLICY_V1.residualFocusFraction,
): readonly RankedPracticeResidualV1[] => {
  const ranked = rankPracticeResidualsV1(residuals);
  if (ranked.length === 0) return [];
  const count = Math.max(1, Math.ceil(ranked.length * clampUnit(fraction)));
  return ranked.slice(0, count);
};

export const affectedPracticePhaseIdsV1 = (
  changedPhaseId: string,
  residuals: readonly PracticeResidualV1[],
): readonly string[] => {
  const affected = new Set<string>([changedPhaseId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const residual of residuals) {
      const dependencies = residual.dependencyPhaseIds ?? [];
      if (affected.has(residual.phaseId)
        || dependencies.some((phaseId) => affected.has(phaseId))) {
        if (!affected.has(residual.phaseId)) {
          affected.add(residual.phaseId);
          grew = true;
        }
        for (const dependency of dependencies) {
          if (!affected.has(dependency)) {
            affected.add(dependency);
            grew = true;
          }
        }
      }
    }
  }
  return [...affected];
};
