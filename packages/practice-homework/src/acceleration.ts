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
