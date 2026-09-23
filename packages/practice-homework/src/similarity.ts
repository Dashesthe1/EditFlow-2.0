import type {
  PracticeSimilarityBreakdownV1,
  PracticeSimilarityReportV1,
} from "./contracts.js";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const WEIGHTS: Readonly<Record<keyof PracticeSimilarityBreakdownV1, number>> = {
  sceneIdentity: 0.18,
  temporalAlignment: 0.14,
  cutTiming: 0.12,
  framing: 0.10,
  motion: 0.10,
  effectFidelity: 0.14,
  transitionFidelity: 0.10,
  colorFinish: 0.06,
  pixelStructure: 0.06,
};

export const scorePracticeSimilarityV1 = (
  breakdown: PracticeSimilarityBreakdownV1,
): number => {
  let score = 0;
  for (const key of Object.keys(WEIGHTS) as (keyof PracticeSimilarityBreakdownV1)[]) {
    const value = breakdown[key];
    if (!Number.isFinite(value)) return 0;
    score += clamp01(value) * WEIGHTS[key];
  }
  return clamp01(score);
};
export const finalizePracticeSimilarityReportV1 = (
  report: PracticeSimilarityReportV1,
  minimumSimilarity: number,
): PracticeSimilarityReportV1 => {
  const minimum = clamp01(minimumSimilarity);
  const overallSimilarity = scorePracticeSimilarityV1(report.breakdown);
  const retainedReasons = [...new Set(
    report.reasons.map((reason) => reason.trim()).filter(Boolean),
  )];
  const reasons: string[] = [];

  if (report.wrongSceneCount > 0) {
    reasons.push("Wrong source scene remains in the reconstruction.");
  }
  if (report.unmatchedSceneCount > 0) {
    reasons.push("One or more reference shots have no exact source match.");
  }
  if (report.breakdown.sceneIdentity < 0.995) {
    reasons.push("Scene identity is below the exact-source practice gate.");
  }
  if (report.breakdown.temporalAlignment < 0.97) {
    reasons.push("Source timing or speed mapping is not reference-aligned.");
  }
  if (report.breakdown.cutTiming < 0.97) {
    reasons.push("Cut boundaries are not reference-aligned.");
  }
  if (report.definingEffectCoverage < 1) {
    reasons.push("At least one defining effect or transition behavior is missing.");
  }
  if (report.breakdown.effectFidelity < minimum) {
    reasons.push("Effect fidelity is below the practice target.");
  }
  if (report.breakdown.transitionFidelity < minimum) {
    reasons.push("Transition fidelity is below the practice target.");
  }
  if (overallSimilarity < minimum) {
    reasons.push("Weighted reconstruction similarity is below the practice target.");
  }

  return {
    ...report,
    overallSimilarity,
    passed: retainedReasons.length === 0 && reasons.length === 0,
    reasons: [...new Set([...retainedReasons, ...reasons])],
  };
};
