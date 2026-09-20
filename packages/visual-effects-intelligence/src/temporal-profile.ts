import type { DenseEffectEvidenceV1 } from "./contracts.js";

export interface HalfPeakTemporalProfileV1 {
  readonly metric: string;
  readonly peakValue: number;
  readonly peakIndex: number;
  readonly peakTimeMs: number;
  readonly threshold: number;
  readonly firstHalfPeakIndex: number;
  readonly lastHalfPeakIndex: number;
  readonly attackMs: number;
  readonly recoveryMs: number;
}

/**
 * Measures the contiguous half-peak lobe around a visual metric. By default the
 * strongest lobe wins. When semantic comparison supplies a preferred phase, the
 * nearest local peak with at least half of the global peak energy is selected so
 * a stronger unrelated source lobe cannot steal an effect-local timing metric.
 */
export const measureHalfPeakTemporalProfileV1 = (
  evidence: DenseEffectEvidenceV1,
  metric: string,
  preferredPeakPhase?: number,
): HalfPeakTemporalProfileV1 => {
  const samples = evidence.frames.map((frame) => {
    const value = (frame as unknown as Readonly<Record<string, unknown>>)[metric];
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
  });
  if (samples.length === 0) {
    return {
      metric,
      peakValue: 0,
      peakIndex: -1,
      peakTimeMs: 0,
      threshold: 0,
      firstHalfPeakIndex: -1,
      lastHalfPeakIndex: -1,
      attackMs: 0,
      recoveryMs: 0,
    };
  }

  let peakIndex = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if ((samples[index] ?? 0) > (samples[peakIndex] ?? 0)) peakIndex = index;
  }
  const globalPeakIndex = peakIndex;
  const globalPeakValue = samples[globalPeakIndex] ?? 0;
  if (typeof preferredPeakPhase === "number" && Number.isFinite(preferredPeakPhase)
    && samples.length > 1 && globalPeakValue > 1e-9) {
    const preferred = Math.min(1, Math.max(0, preferredPeakPhase));
    const minimumSemanticPeak = globalPeakValue * 0.5;
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestValue = -1;
    for (let index = 0; index < samples.length; index += 1) {
      const value = samples[index] ?? 0;
      const previous = index === 0 ? Number.NEGATIVE_INFINITY : samples[index - 1] ?? 0;
      const next = index + 1 === samples.length ? Number.NEGATIVE_INFINITY : samples[index + 1] ?? 0;
      const localPeak = value >= previous && value >= next && (value > previous || value > next);
      if (!localPeak || value + 1e-9 < minimumSemanticPeak) continue;
      const candidatePhase = index / (samples.length - 1);
      const distance = Math.abs(candidatePhase - preferred);
      if (distance < bestDistance - 1e-9
        || (Math.abs(distance - bestDistance) <= 1e-9 && value > bestValue)) {
        bestIndex = index;
        bestDistance = distance;
        bestValue = value;
      }
    }
    if (bestIndex >= 0) peakIndex = bestIndex;
  }
  const peakValue = samples[peakIndex] ?? 0;
  if (peakValue <= 1e-9) {
    return {
      metric,
      peakValue,
      peakIndex,
      peakTimeMs: evidence.frames[peakIndex]?.timeMs ?? 0,
      threshold: 0,
      firstHalfPeakIndex: peakIndex,
      lastHalfPeakIndex: peakIndex,
      attackMs: 0,
      recoveryMs: 0,
    };
  }

  const threshold = peakValue * 0.5;
  let first = peakIndex;
  let last = peakIndex;
  while (first > 0 && (samples[first - 1] ?? 0) >= threshold) first -= 1;
  while (last + 1 < samples.length && (samples[last + 1] ?? 0) >= threshold) last += 1;

  const peakTimeMs = evidence.frames[peakIndex]?.timeMs ?? 0;
  const firstTimeMs = evidence.frames[first]?.timeMs ?? peakTimeMs;
  const lastTimeMs = evidence.frames[last]?.timeMs ?? peakTimeMs;
  return {
    metric,
    peakValue,
    peakIndex,
    peakTimeMs,
    threshold,
    firstHalfPeakIndex: first,
    lastHalfPeakIndex: last,
    attackMs: Math.max(0, peakTimeMs - firstTimeMs),
    recoveryMs: Math.max(0, lastTimeMs - peakTimeMs),
  };
};
