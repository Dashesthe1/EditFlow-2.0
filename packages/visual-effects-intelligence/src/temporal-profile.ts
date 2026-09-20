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
 * Measures the contiguous half-peak lobe around a visual metric's strongest
 * frame. Durations are peak-relative, so they remain meaningful when reference
 * and render windows are semantically aligned but start at different times.
 */
export const measureHalfPeakTemporalProfileV1 = (
  evidence: DenseEffectEvidenceV1,
  metric: string,
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
