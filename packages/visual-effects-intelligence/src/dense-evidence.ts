import { createHash } from "node:crypto";
import type {
  DenseEffectEvidenceV1,
  DenseEvidenceSettingsV1,
  DenseEvidenceSummaryV1,
  DenseFrameInputV1,
  DenseFrameMetricsV1,
  NormalizedPointV1,
} from "./contracts.js";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const finite = (value: number, name: string): number => {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite.`);
  return value;
};
const point = (value: NormalizedPointV1 | undefined): NormalizedPointV1 => ({
  x: value === undefined ? 0 : finite(value.x, "point.x"),
  y: value === undefined ? 0 : finite(value.y, "point.y"),
});
const magnitude = (value: NormalizedPointV1): number => Math.hypot(value.x, value.y);
const subtract = (a: NormalizedPointV1, b: NormalizedPointV1): NormalizedPointV1 => ({
  x: a.x - b.x,
  y: a.y - b.y,
});
const phase = (index: number, count: number): number => count <= 1 ? 0 : index / (count - 1);
const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2
    : ordered[middle] ?? 0;
};

interface PixelStatsV1 {
  readonly lumaMean: number;
  readonly lumaStd: number;
  readonly sharpness: number;
  readonly edgeDensity: number;
  readonly chromaticSeparation: number;
  readonly alphaCoverage: number;
  readonly centroid: NormalizedPointV1;
  readonly subjectCentroid: NormalizedPointV1 | null;
  readonly backgroundCentroid: NormalizedPointV1 | null;
}

const lumaAt = (rgba: Uint8Array, offset: number): number =>
  ((rgba[offset] ?? 0) * 0.2126)
  + ((rgba[offset + 1] ?? 0) * 0.7152)
  + ((rgba[offset + 2] ?? 0) * 0.0722);

const projectionCorrelation = (
  a: Float64Array,
  b: Float64Array,
  lag: number,
): number => {
  const start = Math.max(0, -lag);
  const end = Math.min(a.length, b.length - lag);
  if (end - start < 2) return 0;
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let index = start; index < end; index += 1) {
    const av = a[index] ?? 0;
    const bv = b[index + lag] ?? 0;
    dot += av * bv;
    aa += av * av;
    bb += bv * bv;
  }
  return aa <= 1e-9 || bb <= 1e-9 ? 0 : dot / Math.sqrt(aa * bb);
};

const projectionMisregistration = (
  a: Float64Array,
  b: Float64Array,
  maxLag: number,
): number => {
  const zero = projectionCorrelation(a, b, 0);
  let best = zero;
  let bestLag = 0;
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    if (lag === 0) continue;
    const correlation = projectionCorrelation(a, b, lag);
    if (correlation > best) {
      best = correlation;
      bestLag = lag;
    }
  }
  if (best < 0.25 || bestLag === 0) return 0;
  const improvement = Math.max(0, best - zero);
  const shift = Math.abs(bestLag) / Math.max(1, maxLag);
  return clamp01(improvement * best * (0.25 + 0.75 * shift) * 1.5);
};

const pixelStats = (frame: DenseFrameInputV1, edgeThreshold: number): PixelStatsV1 => {
  const pixels = frame.width * frame.height;
  if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height)
    || frame.width < 2 || frame.height < 2 || frame.rgba.length !== pixels * 4) {
    throw new TypeError("Dense frame dimensions and RGBA length do not agree.");
  }
  if (frame.subjectMask !== undefined && frame.subjectMask.length !== pixels) {
    throw new TypeError("Dense frame subjectMask length must equal width * height.");
  }

  let sum = 0;
  let sumSquares = 0;
  let alpha = 0;
  let edges = 0;
  let laplacian = 0;
  let weightedX = 0;
  let weightedY = 0;
  let weight = 0;
  let subjectX = 0;
  let subjectY = 0;
  let subjectWeight = 0;
  let backgroundX = 0;
  let backgroundY = 0;
  let backgroundWeight = 0;
  const channelColumnEdges = Array.from({ length: 3 }, () => new Float64Array(frame.width));
  const channelRowEdges = Array.from({ length: 3 }, () => new Float64Array(frame.height));

  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const pixel = y * frame.width + x;
      const offset = pixel * 4;
      const a = frame.rgba[offset + 3] ?? 0;
      const luma = lumaAt(frame.rgba, offset);
      sum += luma;
      sumSquares += luma * luma;
      if (a >= 250) alpha += 1;
      const normalizedWeight = luma / 255 + 0.001;
      weightedX += (x / (frame.width - 1)) * normalizedWeight;
      weightedY += (y / (frame.height - 1)) * normalizedWeight;
      weight += normalizedWeight;

      const isSubject = (frame.subjectMask?.[pixel] ?? 0) >= 128;
      if (isSubject) {
        subjectX += x / (frame.width - 1);
        subjectY += y / (frame.height - 1);
        subjectWeight += 1;
      } else {
        backgroundX += x / (frame.width - 1);
        backgroundY += y / (frame.height - 1);
        backgroundWeight += 1;
      }

      if (x > 0 && y > 0 && x < frame.width - 1 && y < frame.height - 1) {
        const left = lumaAt(frame.rgba, offset - 4);
        const right = lumaAt(frame.rgba, offset + 4);
        const above = lumaAt(frame.rgba, offset - frame.width * 4);
        const below = lumaAt(frame.rgba, offset + frame.width * 4);
        const gradient = Math.hypot(right - left, below - above);
        if (gradient >= edgeThreshold) edges += 1;
        laplacian += Math.abs((4 * luma) - left - right - above - below);
        for (let channel = 0; channel < 3; channel += 1) {
          const center = offset + channel;
          const channelLeft = frame.rgba[center - 4] ?? 0;
          const channelRight = frame.rgba[center + 4] ?? 0;
          const channelAbove = frame.rgba[center - frame.width * 4] ?? 0;
          const channelBelow = frame.rgba[center + frame.width * 4] ?? 0;
          const channelGradient = Math.hypot(
            channelRight - channelLeft,
            channelBelow - channelAbove,
          );
          const columnProjection = channelColumnEdges[channel]!;
          const rowProjection = channelRowEdges[channel]!;
          columnProjection[x] = (columnProjection[x] ?? 0) + channelGradient;
          rowProjection[y] = (rowProjection[y] ?? 0) + channelGradient;
        }
      }
    }
  }
  const interior = Math.max(1, (frame.width - 2) * (frame.height - 2));
  const mean = sum / pixels;
  const variance = Math.max(0, sumSquares / pixels - mean * mean);
  const maxLagX = Math.max(1, Math.min(12, Math.round(frame.width * 0.04)));
  const maxLagY = Math.max(1, Math.min(12, Math.round(frame.height * 0.04)));
  const channelPairs = [[0, 1], [1, 2], [0, 2]] as const;
  let chromaticSeparation = 0;
  for (const [aChannel, bChannel] of channelPairs) {
    chromaticSeparation = Math.max(
      chromaticSeparation,
      projectionMisregistration(
        channelColumnEdges[aChannel]!,
        channelColumnEdges[bChannel]!,
        maxLagX,
      ),
      projectionMisregistration(
        channelRowEdges[aChannel]!,
        channelRowEdges[bChannel]!,
        maxLagY,
      ),
    );
  }
  return {
    lumaMean: mean / 255,
    lumaStd: Math.sqrt(variance) / 127.5,
    sharpness: clamp01((laplacian / interior) / 128),
    edgeDensity: edges / interior,
    chromaticSeparation,
    alphaCoverage: alpha / pixels,
    centroid: { x: weightedX / weight, y: weightedY / weight },
    subjectCentroid: subjectWeight > 0
      ? { x: subjectX / subjectWeight, y: subjectY / subjectWeight }
      : null,
    backgroundCentroid: backgroundWeight > 0
      ? { x: backgroundX / backgroundWeight, y: backgroundY / backgroundWeight }
      : null,
  };
};

const frameDifference = (a: DenseFrameInputV1 | undefined, b: DenseFrameInputV1): number => {
  if (a === undefined) return 0;
  if (a.width !== b.width || a.height !== b.height) {
    throw new TypeError("All dense evidence frames must have identical dimensions.");
  }
  let total = 0;
  for (let offset = 0; offset < b.rgba.length; offset += 4) {
    total += Math.abs((b.rgba[offset] ?? 0) - (a.rgba[offset] ?? 0));
    total += Math.abs((b.rgba[offset + 1] ?? 0) - (a.rgba[offset + 1] ?? 0));
    total += Math.abs((b.rgba[offset + 2] ?? 0) - (a.rgba[offset + 2] ?? 0));
  }
  return total / (b.width * b.height * 3 * 255);
};

const digestInput = (
  sourceId: string,
  sourceKind: "REFERENCE" | "RENDER",
  frames: readonly DenseFrameInputV1[],
  settings: DenseEvidenceSettingsV1,
  analyzerFingerprint: string,
): string => {
  const hash = createHash("sha256");
  hash.update(sourceId);
  hash.update(sourceKind);
  hash.update(analyzerFingerprint);
  hash.update(JSON.stringify(settings));
  for (const frame of frames) {
    hash.update(`${frame.timeMs}:${frame.width}:${frame.height}:`);
    hash.update(frame.rgba);
    if (frame.subjectMask !== undefined) hash.update(frame.subjectMask);
    hash.update(JSON.stringify(frame.semantic ?? {}));
  }
  return hash.digest("hex");
};

const peakIndex = (
  frames: readonly DenseFrameMetricsV1[],
  select: (frame: DenseFrameMetricsV1) => number,
): number => {
  let best = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const candidate = frames[index];
    const incumbent = frames[best];
    if (candidate !== undefined && incumbent !== undefined && select(candidate) > select(incumbent)) best = index;
  }
  return best;
};

/**
 * Measures whether the defining shutter ingredients occur as one coordinated
 * high-frequency event instead of being assembled from unrelated maxima found
 * at distant moments in the same window. The neighborhood is approximately
 * 100 ms wide, which permits anticipation -> separation -> overlap/convergence
 * while remaining local enough to reject content-only edge repetition later in
 * the shot.
 */
export const measureFragmentationCoherenceV1 = (
  frames: readonly DenseFrameMetricsV1[],
  interval: number,
): Readonly<{
  peak: number;
  phase: number;
  temporalStateCountPeak: number;
  overlapDensityPeak: number;
  stateSeparationPeak: number;
}> => {
  if (frames.length === 0) {
    return {
      peak: 0,
      phase: 0,
      temporalStateCountPeak: 0,
      overlapDensityPeak: 0,
      stateSeparationPeak: 0,
    };
  }
  const safeInterval = Math.max(1, interval);
  const radius = Math.max(2, Math.round(50 / safeInterval));
  const motionAnchorIndex = peakIndex(frames, (frame) => frame.motionEnergy);
  const motionPeak = frames[motionAnchorIndex]?.motionEnergy ?? 0;
  let bestPeak = 0;
  let bestIndex = 0;
  let bestTemporalStateCount = 0;
  let bestOverlapDensity = 0;
  let bestStateSeparation = 0;
  for (let center = 0; center < frames.length; center += 1) {
    const start = Math.max(0, center - radius);
    const end = Math.min(frames.length - 1, center + radius);
    const local = frames.slice(start, end + 1);
    const stateScores = local.map((frame) => clamp01(frame.temporalStateCount - 1));
    const overlapScores = local.map((frame) => clamp01(frame.overlapDensity / 0.20));
    // Fragmentation requires within-frame separation of simultaneous image states.
    // Inter-frame optical-flow displacement is a camera/content motion quantity and
    // is not a valid substitute. Retained pre-v3 evidence falls back only so older
    // structural fixtures remain readable; professional proof must use v3 evidence.
    const separationScores = local.map((frame) => clamp01(
      ((frame.stateSeparation ?? frame.displacementMagnitude) / 0.015),
    ));
    const componentPeak = (scores: readonly number[]): Readonly<{ score: number; index: number }> => {
      let index = 0;
      for (let candidate = 1; candidate < scores.length; candidate += 1) {
        if ((scores[candidate] ?? 0) > (scores[index] ?? 0)) index = candidate;
      }
      return { score: scores[index] ?? 0, index };
    };
    const statePeak = componentPeak(stateScores);
    const overlapPeak = componentPeak(overlapScores);
    const separationPeak = componentPeak(separationScores);
    const baseScore = Math.min(statePeak.score, overlapPeak.score, separationPeak.score);
    const componentSpanFrames = Math.max(statePeak.index, overlapPeak.index, separationPeak.index)
      - Math.min(statePeak.index, overlapPeak.index, separationPeak.index);
    // A shutter event may develop over neighboring frames, but unrelated maxima
    // spread across the full analysis neighborhood must not be combined into a
    // false defining event. Give full credit inside one frame, then decay to
    // zero by ~75 ms of peak-to-peak separation.
    const componentSpanMs = componentSpanFrames * safeInterval;
    const coordination = clamp01(1 - (Math.max(0, componentSpanMs - safeInterval) / 75));
    // Shutter fragmentation must be part of the transition impulse, not an
    // unrelated repeated texture discovered later in the analysis window.
    // Preserve full credit within ~100 ms of the motion-energy anchor, then
    // decay to zero by ~250 ms. When there is no material motion anchor, do
    // not manufacture one.
    const motionDistanceMs = Math.abs(center - motionAnchorIndex) * safeInterval;
    const motionCoordination = motionPeak < 0.02
      ? 1
      : clamp01(1 - (Math.max(0, motionDistanceMs - 100) / 150));
    const score = baseScore * coordination * motionCoordination;
    if (score > bestPeak) {
      bestPeak = score;
      bestIndex = center;
      bestTemporalStateCount = local[statePeak.index]?.temporalStateCount ?? 0;
      bestOverlapDensity = local[overlapPeak.index]?.overlapDensity ?? 0;
      bestStateSeparation = local[separationPeak.index]?.stateSeparation
        ?? local[separationPeak.index]?.displacementMagnitude
        ?? 0;
    }
  }
  return {
    peak: bestPeak,
    phase: phase(bestIndex, frames.length),
    temporalStateCountPeak: bestTemporalStateCount,
    overlapDensityPeak: bestOverlapDensity,
    stateSeparationPeak: bestStateSeparation,
  };
};

const fragmentationProminenceMinimumsV1 = (
  evidence: DenseEffectEvidenceV1,
): Readonly<{ near: number; delta: number }> => {
  const probeAlgorithm = evidence.evidenceRefs.find((ref) =>
    ref.startsWith("probe-algorithm:editflow.m6.dense-video-probe.v"));
  const versionMatch = probeAlgorithm?.match(/dense-video-probe\.v(\d+)$/);
  const version = versionMatch === null || versionMatch === undefined
    ? null
    : Number(versionMatch[1]);
  // Probe v10 introduced temporal-baseline subtraction. The retained
  // professional shutter reference remains cleanly event-local (far mean 0)
  // but its normalized near-event tuple scale is ~0.01165 instead of the
  // pre-v10 ~0.02+ scale. Keep locality causal by requiring positive near/far
  // separation, while calibrating the absolute floor to the analyzer version.
  return version !== null && Number.isFinite(version) && version >= 10
    ? { near: 0.01, delta: 0.0075 }
    : { near: 0.02, delta: 0.015 };
};

/**
 * Measures whether a modern real-pixel fragmentation tuple is actually local
 * to the selected effect event. Repeated source texture can make the
 * autocorrelation detector report states/overlap/separation across an entire
 * window; that is evidence of image content, not evidence of a shutter event.
 *
 * Retained pre-v6 evidence and hand-authored fixtures are deliberately
 * non-applicable so older proofs keep their historical meaning.
 */
export const measureFragmentationEventProminenceV1 = (
  evidence: DenseEffectEvidenceV1,
  eventPhase?: number,
): Readonly<{
  applicable: boolean;
  nearMean: number;
  farMean: number;
  delta: number;
  localized: boolean;
}> => {
  const probeAlgorithm = evidence.evidenceRefs.find((ref) =>
    ref.startsWith("probe-algorithm:editflow.m6.dense-video-probe.v"));
  const versionMatch = probeAlgorithm?.match(/dense-video-probe\.v(\d+)$/);
  const version = versionMatch === null || versionMatch === undefined
    ? null
    : Number(versionMatch[1]);
  const applicable = version !== null && Number.isFinite(version) && version >= 6
    && evidence.frames.length >= 5;
  if (!applicable) {
    return { applicable: false, nearMean: 0, farMean: 0, delta: 0, localized: true };
  }

  const resolvedPhase = eventPhase ?? evidence.summary.fragmentationCoherencePhase
    ?? measureFragmentationCoherenceV1(evidence.frames, evidence.summary.frameIntervalMs).phase;
  const denominator = Math.max(1, evidence.frames.length - 1);
  const tupleScores = evidence.frames.map((frame, index) => {
    const states = clamp01(frame.temporalStateCount - 1);
    const overlap = clamp01(frame.overlapDensity / 0.20);
    const separation = clamp01(((frame.stateSeparation ?? frame.displacementMagnitude) / 0.015));
    return { phase: index / denominator, score: Math.min(states, overlap, separation) };
  });
  const mean = (values: readonly number[]): number =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  const near = tupleScores
    .filter((sample) => Math.abs(sample.phase - resolvedPhase) <= 0.12)
    .map((sample) => sample.score);
  const far = tupleScores
    .filter((sample) => Math.abs(sample.phase - resolvedPhase) >= 0.22)
    .map((sample) => sample.score);
  if (near.length === 0 || far.length === 0) {
    return { applicable: false, nearMean: 0, farMean: 0, delta: 0, localized: true };
  }
  const nearMean = mean(near);
  const farMean = mean(far);
  const delta = nearMean - farMean;
  const minimums = fragmentationProminenceMinimumsV1(evidence);
  return {
    applicable: true,
    nearMean,
    farMean,
    delta,
    localized: nearMean >= minimums.near && delta >= minimums.delta,
  };
};

/**
 * Continuous [0,1] form of the same event-locality gate used by family
 * classification. Pre-v6 evidence is non-applicable by design and therefore
 * retains its historical meaning with a neutral passing score.
 */
export const scoreFragmentationEventLocalizationV1 = (
  evidence: DenseEffectEvidenceV1,
  eventPhase?: number,
): number => {
  const prominence = measureFragmentationEventProminenceV1(evidence, eventPhase);
  if (!prominence.applicable) return 1;
  const minimums = fragmentationProminenceMinimumsV1(evidence);
  const nearScore = clamp01(prominence.nearMean / minimums.near);
  const deltaScore = clamp01(prominence.delta / minimums.delta);
  return Math.min(nearScore, deltaScore);
};

/**
 * Resolves the causal fragmentation event while preserving retained pre-v6
 * analyzer evidence. New/synthetic evidence is derived from the coordinated
 * event; v1-v5 real-pixel evidence keeps its historical global semantics and
 * therefore remains inspectable without being silently reinterpreted.
 */
export const resolveFragmentationEventMetricsV1 = (
  evidence: DenseEffectEvidenceV1,
): ReturnType<typeof measureFragmentationCoherenceV1> => {
  const summary = evidence.summary;
  if (
    typeof summary.fragmentationCoherencePeak === "number"
    && typeof summary.fragmentationCoherencePhase === "number"
    && typeof summary.fragmentationTemporalStateCountPeak === "number"
    && typeof summary.fragmentationOverlapDensityPeak === "number"
    && typeof summary.fragmentationStateSeparationPeak === "number"
  ) {
    return {
      peak: summary.fragmentationCoherencePeak,
      phase: summary.fragmentationCoherencePhase,
      temporalStateCountPeak: summary.fragmentationTemporalStateCountPeak,
      overlapDensityPeak: summary.fragmentationOverlapDensityPeak,
      stateSeparationPeak: summary.fragmentationStateSeparationPeak,
    };
  }

  const probeAlgorithm = evidence.evidenceRefs.find((ref) =>
    ref.startsWith("probe-algorithm:editflow.m6.dense-video-probe.v"));
  // Hand-authored fixtures and retained semantic evidence may already declare a
  // coherence score without the v6 event tuple. Preserve that declared event
  // instead of silently recomputing different semantics from fixture frames.
  if (
    probeAlgorithm === undefined
    && typeof summary.fragmentationCoherencePeak === "number"
  ) {
    return {
      peak: summary.fragmentationCoherencePeak,
      phase: summary.fragmentationCoherencePhase ?? 0,
      temporalStateCountPeak: summary.temporalStateCountPeak,
      overlapDensityPeak: summary.overlapDensityPeak,
      stateSeparationPeak: summary.stateSeparationPeak
        ?? Math.max(...evidence.frames.map((frame) => frame.stateSeparation ?? 0)),
    };
  }

  const legacyRealPixel = probeAlgorithm !== undefined
    && /dense-video-probe\.v[1-5]$/.test(probeAlgorithm);
  if (legacyRealPixel) {
    return {
      peak: summary.fragmentationCoherencePeak
        ?? measureFragmentationCoherenceV1(evidence.frames, summary.frameIntervalMs).peak,
      phase: summary.fragmentationCoherencePhase ?? 0,
      temporalStateCountPeak: summary.temporalStateCountPeak,
      overlapDensityPeak: summary.overlapDensityPeak,
      stateSeparationPeak: summary.stateSeparationPeak
        ?? Math.max(...evidence.frames.map((frame) => frame.stateSeparation ?? 0)),
    };
  }

  return measureFragmentationCoherenceV1(evidence.frames, summary.frameIntervalMs);
};

export const measureScaleDynamicsV1 = (
  frames: readonly DenseFrameMetricsV1[],
  recoveryRatio = 0.35,
): Readonly<{
  scaleVelocityPeakPerSecond: number;
  scaleVelocityRecoveryRatio: number;
  scaleVelocityRecoveryMs: number;
}> => {
  if (frames.length < 2) {
    return {
      scaleVelocityPeakPerSecond: 0,
      scaleVelocityRecoveryRatio: 1,
      scaleVelocityRecoveryMs: 0,
    };
  }
  const velocities: Array<Readonly<{ timeMs: number; value: number }>> = [];
  for (let index = 1; index < frames.length; index += 1) {
    const current = frames[index]!;
    const previous = frames[index - 1]!;
    const elapsedSeconds = (current.timeMs - previous.timeMs) / 1000;
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) continue;
    velocities.push({
      timeMs: current.timeMs,
      value: Math.abs(current.scale - previous.scale) / elapsedSeconds,
    });
  }
  if (velocities.length === 0) {
    return {
      scaleVelocityPeakPerSecond: 0,
      scaleVelocityRecoveryRatio: 1,
      scaleVelocityRecoveryMs: 0,
    };
  }
  const scaleVelocityPeakPerSecond = Math.max(...velocities.map((item) => item.value));
  const peakIndex = velocities.findIndex((item) => item.value === scaleVelocityPeakPerSecond);
  const peakTimeMs = velocities[peakIndex]?.timeMs ?? frames[0]!.timeMs;
  const finalVelocityTimeMs = velocities.at(-1)?.timeMs ?? peakTimeMs;
  const totalDurationMs = Math.max(0, finalVelocityTimeMs - peakTimeMs);
  let scaleVelocityRecoveryRatio = 1;
  let scaleVelocityRecoveryMs = totalDurationMs;
  if (scaleVelocityPeakPerSecond > 1e-6) {
    const postPeak = velocities.slice(peakIndex + 1);
    if (postPeak.length > 0 && totalDurationMs > 0) {
      // A single near-zero scale delta can occur at a cut, optical-flow wobble,
      // or the crest of a compound push. It is not recovery if scale motion
      // immediately resumes. Measure terminal residual speed over the final
      // quarter of post-peak time, then require recovery to remain inside the
      // band for the rest of the observed effect window.
      const terminalStartMs = peakTimeMs + (totalDurationMs * 0.75);
      const terminal = postPeak.filter((item) => item.timeMs >= terminalStartMs);
      const terminalSamples = terminal.length > 0 ? terminal : postPeak.slice(-1);
      scaleVelocityRecoveryRatio = Math.min(
        1,
        Math.max(...terminalSamples.map((item) => item.value)) / scaleVelocityPeakPerSecond,
      );
      const threshold = scaleVelocityPeakPerSecond * recoveryRatio;
      const recovered = postPeak.find((item, index) => {
        const suffix = postPeak.slice(index);
        return suffix.length >= 2 && suffix.every((sample) => sample.value <= threshold);
      });
      if (recovered !== undefined) {
        scaleVelocityRecoveryMs = Math.max(0, recovered.timeMs - peakTimeMs);
      }
    }
  }
  return {
    scaleVelocityPeakPerSecond,
    scaleVelocityRecoveryRatio,
    scaleVelocityRecoveryMs,
  };
};

export const summarizeDenseEffectFramesV1 = (
  frames: readonly DenseFrameMetricsV1[],
  interval: number,
  recoveryEnergyRatio: number,
): DenseEvidenceSummaryV1 => {
  const max = (select: (frame: DenseFrameMetricsV1) => number): number =>
    Math.max(...frames.map(select));
  const min = (select: (frame: DenseFrameMetricsV1) => number): number =>
    Math.min(...frames.map(select));
  const motionIndex = peakIndex(frames, (frame) => frame.motionEnergy);
  const blurIndex = peakIndex(frames, (frame) => frame.blurStrength);
  const opticalIndex = peakIndex(frames, (frame) =>
    (frame.blurStrength + frame.chromaticSeparation + frame.exposure) / 3);
  const motionPeak = frames[motionIndex]?.motionEnergy ?? 0;
  let recoveryFrames = 0;
  for (let index = motionIndex + 1; index < frames.length; index += 1) {
    recoveryFrames += 1;
    if ((frames[index]?.motionEnergy ?? 0) <= motionPeak * recoveryEnergyRatio) break;
  }
  let accelerationPeak = 0;
  for (let index = 2; index < frames.length; index += 1) {
    const a = frames[index - 2]?.motionEnergy ?? 0;
    const b = frames[index - 1]?.motionEnergy ?? 0;
    const c = frames[index]?.motionEnergy ?? 0;
    accelerationPeak = Math.max(accelerationPeak, Math.abs((c - b) - (b - a)));
  }
  const displacementPeakIndex = peakIndex(frames, (frame) => frame.displacementMagnitude);
  const scaleDynamics = measureScaleDynamicsV1(frames, recoveryEnergyRatio);
  const fragmentation = measureFragmentationCoherenceV1(frames, interval);
  // Temporal persistence is the occupancy of visible simultaneous temporal
  // states, not generic inter-frame pixel change. Requiring state count,
  // overlap, and within-frame separation together prevents static repeated
  // source texture from masquerading as an Echo/trail while allowing a
  // smoothly moving multi-state composite to remain persistent.
  const persistentTemporalFrames = frames.filter((frame) =>
    frame.temporalStateCount > 1
    && frame.overlapDensity >= 0.20
    && (frame.stateSeparation ?? 0) >= 0.015).length;
  return {
    frameCount: frames.length,
    frameIntervalMs: interval,
    temporalStateCountPeak: max((frame) => frame.temporalStateCount),
    temporalPersistence: frames.length === 0 ? 0 : persistentTemporalFrames / frames.length,
    motionEnergyPeak: motionPeak,
    displacementPeak: max((frame) => frame.displacementMagnitude),
    displacementDirection: frames[displacementPeakIndex]?.motionDirection ?? { x: 0, y: 0 },
    scaleRange: max((frame) => frame.scale) - min((frame) => frame.scale),
    scaleDynamicsVersion: "SUSTAINED_TAIL_V1",
    scaleVelocityPeakPerSecond: scaleDynamics.scaleVelocityPeakPerSecond,
    scaleVelocityRecoveryRatio: scaleDynamics.scaleVelocityRecoveryRatio,
    scaleVelocityRecoveryMs: scaleDynamics.scaleVelocityRecoveryMs,
    rotationRange: max((frame) => frame.rotationDegrees) - min((frame) => frame.rotationDegrees),
    blurPeak: max((frame) => frame.blurStrength),
    blurPeakPhase: phase(blurIndex, frames.length),
    distortionPeak: max((frame) => frame.distortionStrength),
    exposurePeak: max((frame) => frame.exposure),
    subjectSeparationPeak: max((frame) => frame.subjectSeparation),
    overlapDensityPeak: max((frame) => frame.overlapDensity),
    stateSeparationPeak: max((frame) => frame.stateSeparation ?? 0),
    fragmentationCoherencePeak: fragmentation.peak,
    fragmentationCoherencePhase: fragmentation.phase,
    fragmentationTemporalStateCountPeak: fragmentation.temporalStateCountPeak,
    fragmentationOverlapDensityPeak: fragmentation.overlapDensityPeak,
    fragmentationStateSeparationPeak: fragmentation.stateSeparationPeak,
    occlusionPeak: max((frame) => frame.occlusion),
    accelerationPeak,
    recoveryFrames,
    opticalPeakPhase: phase(opticalIndex, frames.length),
    motionPeakPhase: phase(motionIndex, frames.length),
  };
};

export class DenseEvidenceCacheV1 {
  readonly #entries = new Map<string, DenseEffectEvidenceV1>();

  get(contentKey: string): DenseEffectEvidenceV1 | null {
    const value = this.#entries.get(contentKey);
    return value === undefined ? null : structuredClone(value);
  }

  set(value: DenseEffectEvidenceV1): void {
    this.#entries.set(value.contentKey, structuredClone(value));
  }

  get size(): number { return this.#entries.size; }
}

export const analyzeDenseEffectEvidenceV1 = (input: {
  readonly sourceId: string;
  readonly sourceKind: "REFERENCE" | "RENDER";
  readonly frames: readonly DenseFrameInputV1[];
  readonly settings: DenseEvidenceSettingsV1;
  /**
   * Composite fingerprint for the upstream probe + this dense measurement implementation.
   * Production evidence should always supply it; synthetic/unit evidence receives a stable default.
   */
  readonly analyzerFingerprint?: string;
  readonly evidenceRefs: readonly string[];
  readonly cache?: DenseEvidenceCacheV1;
}): DenseEffectEvidenceV1 => {
  if (input.sourceId.trim().length === 0) throw new TypeError("sourceId must not be empty.");
  if (input.frames.length < 3) throw new TypeError("Dense evidence requires at least three consecutive frames.");
  if (!Number.isFinite(input.settings.expectedFps) || input.settings.expectedFps <= 0) {
    throw new TypeError("expectedFps must be positive.");
  }
  const frames = [...input.frames].sort((a, b) => a.timeMs - b.timeMs);
  if (new Set(frames.map((frame) => frame.timeMs)).size !== frames.length) {
    throw new TypeError("Dense evidence frame times must be unique.");
  }
  const expectedInterval = 1000 / input.settings.expectedFps;
  const intervals = frames.slice(1).map((frame, index) => frame.timeMs - (frames[index]?.timeMs ?? frame.timeMs));
  if (intervals.some((value) => value <= 0)) throw new TypeError("Dense evidence frames must advance in time.");
  if (input.settings.requireEveryFrame !== false
    && intervals.some((value) => Math.abs(value - expectedInterval) > expectedInterval * 0.35)) {
    throw new TypeError("Dense evidence must contain every important frame in the requested range.");
  }

  const analyzerFingerprint = input.analyzerFingerprint?.trim()
    || "editflow:dense-evidence:synthetic-core-v1";
  const contentKey = digestInput(
    input.sourceId,
    input.sourceKind,
    frames,
    input.settings,
    analyzerFingerprint,
  );
  const cached = input.cache?.get(contentKey);
  if (cached !== null && cached !== undefined) return cached;
  const edgeThreshold = input.settings.edgeThreshold ?? 32;
  const stats = frames.map((frame) => pixelStats(frame, edgeThreshold));
  const exposureEdgeCount = Math.max(1, Math.min(
    Math.ceil(stats.length * 0.2),
    Math.max(1, Math.floor(stats.length / 2)),
  ));
  const startExposureBaseline = median(
    stats.slice(0, exposureEdgeCount).map((item) => item.lumaMean),
  );
  const endExposureBaseline = median(
    stats.slice(-exposureEdgeCount).map((item) => item.lumaMean),
  );
  const relativeExposure = (index: number, lumaMean: number): number => {
    const progress = phase(index, stats.length);
    const expectedLuma = startExposureBaseline
      + (endExposureBaseline - startExposureBaseline) * progress;
    const epsilon = 1 / 255;
    const stops = Math.abs(Math.log2((lumaMean + epsilon) / (expectedLuma + epsilon)));
    return clamp01(stops / 4);
  };
  const metrics: DenseFrameMetricsV1[] = [];
  for (const [index, frame] of frames.entries()) {
    const current = stats[index];
    if (current === undefined) continue;
    const previous = stats[index - 1];
    const semantic = frame.semantic;
    const shotBoundaryDiscontinuity = semantic?.shotBoundaryDiscontinuity === true;
    const centroidMotion = previous === undefined
      ? { x: 0, y: 0 }
      : subtract(current.centroid, previous.centroid);
    const subjectNow = semantic?.subjectCentroid ?? current.subjectCentroid;
    const subjectBefore = frames[index - 1]?.semantic?.subjectCentroid ?? previous?.subjectCentroid;
    const backgroundNow = semantic?.backgroundCentroid ?? current.backgroundCentroid;
    const backgroundBefore = frames[index - 1]?.semantic?.backgroundCentroid ?? previous?.backgroundCentroid;
    const subjectMotion = shotBoundaryDiscontinuity
      ? { x: 0, y: 0 }
      : subjectNow !== undefined && subjectNow !== null
        && subjectBefore !== undefined && subjectBefore !== null
        ? subtract(subjectNow, subjectBefore) : { x: 0, y: 0 };
    const backgroundMotion = shotBoundaryDiscontinuity
      ? { x: 0, y: 0 }
      : backgroundNow !== undefined && backgroundNow !== null
        && backgroundBefore !== undefined && backgroundBefore !== null
        ? subtract(backgroundNow, backgroundBefore) : { x: 0, y: 0 };
    const displacement = shotBoundaryDiscontinuity
      ? { x: 0, y: 0 }
      : semantic?.displacement ?? centroidMotion;
    const difference = frameDifference(frames[index - 1], frame);
    const exposureDelta = previous === undefined
      ? 0 : Math.abs(current.lumaMean - previous.lumaMean);
    const contrastDelta = previous === undefined
      ? 0 : Math.abs(current.lumaStd - previous.lumaStd);
    // Raw frame difference is retained as temporal/change evidence, but motion
    // must not be satisfiable by a flash alone. Discount global exposure and
    // contrast shifts before using pixel change as motion energy.
    const structuralDifference = shotBoundaryDiscontinuity
      ? 0
      : clamp01(Math.max(
          0,
          difference - exposureDelta - (contrastDelta * 0.25),
        ));
    const separation = semantic?.subjectSeparation
      ?? clamp01(magnitude(subtract(subjectMotion, backgroundMotion)) * 4);
    const blur = semantic?.blurStrength ?? clamp01(1 - current.sharpness);
    const distortion = shotBoundaryDiscontinuity
      ? 0
      : semantic?.distortionStrength
        ?? clamp01(Math.abs((current.edgeDensity - (previous?.edgeDensity ?? current.edgeDensity))) * 4);
    metrics.push({
      timeMs: frame.timeMs,
      lumaMean: current.lumaMean,
      lumaStd: current.lumaStd,
      exposure: relativeExposure(index, current.lumaMean),
      sharpness: current.sharpness,
      edgeDensity: current.edgeDensity,
      chromaticSeparation: current.chromaticSeparation,
      alphaCoverage: current.alphaCoverage,
      visualDensity: clamp01((current.edgeDensity + current.lumaStd + current.chromaticSeparation) / 3),
      frameDifference: difference,
      structuralDifference,
      motionEnergy: clamp01(Math.max(structuralDifference, magnitude(displacement))),
      motionDirection: point(displacement),
      subjectMotion,
      backgroundMotion,
      subjectBackgroundDivergence: magnitude(subtract(subjectMotion, backgroundMotion)),
      displacementMagnitude: magnitude(displacement),
      scale: finite(semantic?.scale ?? 1, "semantic.scale"),
      rotationDegrees: finite(semantic?.rotationDegrees ?? 0, "semantic.rotationDegrees"),
      perspectiveEnergy: clamp01(semantic?.perspectiveEnergy ?? 0),
      blurStrength: clamp01(blur),
      distortionStrength: clamp01(distortion),
      subjectSeparation: clamp01(separation),
      overlapDensity: clamp01(semantic?.overlapDensity ?? 0),
      stateSeparation: clamp01(semantic?.stateSeparation ?? 0),
      temporalStateCount: Math.max(1, Math.round(semantic?.temporalStateCount ?? 1)),
      occlusion: clamp01(semantic?.occlusion ?? 0),
      maskCoverage: clamp01(semantic?.maskCoverage
        ?? (frame.subjectMask === undefined ? 0 : frame.subjectMask.filter((value) => value >= 128).length / (frame.width * frame.height))),
    });
  }
  const interval = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  const settingsFingerprint = createHash("sha256").update(JSON.stringify(input.settings)).digest("hex");
  const result: DenseEffectEvidenceV1 = {
    schema: "editflow.dense-effect-evidence.v1",
    sourceId: input.sourceId,
    sourceKind: input.sourceKind,
    range: { startMs: frames[0]?.timeMs ?? 0, endMs: frames.at(-1)?.timeMs ?? 0 },
    analyzerFingerprint,
    settingsFingerprint,
    contentKey,
    frames: metrics,
    summary: summarizeDenseEffectFramesV1(metrics, interval, input.settings.recoveryEnergyRatio ?? 0.25),
    evidenceRefs: [...new Set(input.evidenceRefs)],
  };
  input.cache?.set(result);
  return result;
};
