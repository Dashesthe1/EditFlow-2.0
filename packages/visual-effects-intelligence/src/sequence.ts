import { createHash } from "node:crypto";
import type {
  DenseEffectEvidenceV1,
  DenseEffectSequenceV1,
  DenseEffectWindowV1,
  DenseFrameMetricsV1,
  SemanticEffectSequenceAlignmentV1,
} from "./contracts.js";
import { summarizeDenseEffectFramesV1 } from "./dense-evidence.js";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const percentile = (values: readonly number[], quantile: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = clamp01(quantile) * (sorted.length - 1);
  const low = Math.floor(position);
  const high = Math.ceil(position);
  const a = sorted[low] ?? 0;
  const b = sorted[high] ?? a;
  return a + ((b - a) * (position - low));
};

const median = (values: readonly number[]): number => percentile(values, 0.5);

const effectScore = (frame: DenseFrameMetricsV1): number => clamp01(
  (frame.motionEnergy * 0.34)
  + (frame.frameDifference * 0.24)
  + (Math.min(1, frame.displacementMagnitude * 10) * 0.12)
  + (frame.distortionStrength * 0.08)
  + (frame.overlapDensity * 0.07)
  + (Math.min(1, Math.abs(frame.rotationDegrees) / 12) * 0.03)
  + (Math.min(1, Math.abs(frame.scale - 1) * 4) * 0.04)
  + (frame.temporalStateCount > 1
    ? Math.min(1, (frame.temporalStateCount - 1) / 2) * 0.08 : 0)
);

const averageInterval = (evidence: DenseEffectEvidenceV1): number => {
  if (evidence.frames.length < 2) return evidence.summary.frameIntervalMs;
  let total = 0;
  for (let index = 1; index < evidence.frames.length; index += 1) {
    total += (evidence.frames[index]?.timeMs ?? 0)
      - (evidence.frames[index - 1]?.timeMs ?? 0);
  }
  return total / (evidence.frames.length - 1);
};

export const sliceDenseEffectEvidenceV1 = (
  evidence: DenseEffectEvidenceV1,
  startIndex: number,
  endIndex: number,
  windowId: string,
): DenseEffectEvidenceV1 => {
  if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex)
    || startIndex < 0 || endIndex >= evidence.frames.length || endIndex - startIndex < 2) {
    throw new RangeError("Dense effect windows require at least three in-range consecutive frames.");
  }
  const frames = evidence.frames.slice(startIndex, endIndex + 1);
  const interval = frames.length < 2 ? evidence.summary.frameIntervalMs
    : ((frames.at(-1)?.timeMs ?? 0) - (frames[0]?.timeMs ?? 0)) / (frames.length - 1);
  const contentKey = createHash("sha256")
    .update([evidence.contentKey, startIndex, endIndex, windowId].join(":"))
    .digest("hex");
  return {
    schema: "editflow.dense-effect-evidence.v1",
    sourceId: `${evidence.sourceId}#${windowId}`,
    sourceKind: evidence.sourceKind,
    range: {
      startMs: frames[0]?.timeMs ?? evidence.range.startMs,
      endMs: frames.at(-1)?.timeMs ?? evidence.range.endMs,
    },
    analyzerFingerprint: evidence.analyzerFingerprint,
    settingsFingerprint: evidence.settingsFingerprint,
    contentKey,
    frames,
    summary: summarizeDenseEffectFramesV1(frames, interval, 0.25),
    evidenceRefs: [...new Set([
      ...evidence.evidenceRefs,
      `parent-evidence:${evidence.contentKey}`,
      `dense-window:${startIndex}-${endIndex}`,
    ])],
  };
};

export const detectDenseEffectWindowsV1 = (
  evidence: DenseEffectEvidenceV1,
  options: Readonly<{
    minGapMs?: number;
    preRollMs?: number;
    postRollMs?: number;
    maxWindows?: number;
    minimumScore?: number;
  }> = {},
): DenseEffectSequenceV1 => {
  if (evidence.frames.length < 3) {
    throw new TypeError("Dense effect sequence detection requires at least three frames.");
  }
  const scores = evidence.frames.map(effectScore);
  const center = median(scores);
  const mad = median(scores.map((value) => Math.abs(value - center)));
  const threshold = Math.max(
    options.minimumScore ?? 0.075,
    percentile(scores, 0.78),
    center + (2.25 * mad),
  );
  const candidates: Array<{ index: number; score: number }> = [];
  for (let index = 1; index < scores.length - 1; index += 1) {
    const score = scores[index] ?? 0;
    const left = scores[index - 1] ?? 0;
    const right = scores[index + 1] ?? 0;
    if (score >= threshold && score >= left && score >= right) {
      candidates.push({ index, score });
    }
  }

  const interval = Math.max(1, averageInterval(evidence));
  const minGapFrames = Math.max(2, Math.round((options.minGapMs ?? 260) / interval));
  const selected: Array<{ index: number; score: number }> = [];
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    if (selected.some((item) => Math.abs(item.index - candidate.index) < minGapFrames)) continue;
    selected.push(candidate);
    if (selected.length >= (options.maxWindows ?? 16)) break;
  }
  if (selected.length === 0) {
    const anchor = scores.reduce(
      (best, value, index) => value > best.score ? { index, score: value } : best,
      { index: 0, score: scores[0] ?? 0 },
    );
    selected.push(anchor);
  }
  selected.sort((a, b) => a.index - b.index);

  const preFrames = Math.max(2, Math.round((options.preRollMs ?? 240) / interval));
  const postFrames = Math.max(2, Math.round((options.postRollMs ?? 320) / interval));
  const windows: DenseEffectWindowV1[] = selected.map((anchor, sequenceIndex) => {
    const previous = selected[sequenceIndex - 1]?.index;
    const next = selected[sequenceIndex + 1]?.index;
    const lowerBoundary = previous === undefined ? 0 : Math.floor((previous + anchor.index) / 2) + 1;
    const upperBoundary = next === undefined
      ? evidence.frames.length - 1 : Math.floor((anchor.index + next) / 2);
    let startIndex = Math.max(lowerBoundary, anchor.index - preFrames);
    let endIndex = Math.min(upperBoundary, anchor.index + postFrames);
    if (endIndex - startIndex < 2) {
      startIndex = Math.max(0, anchor.index - 1);
      endIndex = Math.min(evidence.frames.length - 1, startIndex + 2);
      startIndex = Math.max(0, endIndex - 2);
    }
    const windowId = `effect-${String(sequenceIndex + 1).padStart(2, "0")}`;
    const windowEvidence = sliceDenseEffectEvidenceV1(
      evidence, startIndex, endIndex, windowId,
    );
    return {
      windowId,
      startIndex,
      endIndex,
      anchorIndex: anchor.index,
      startMs: windowEvidence.range.startMs,
      endMs: windowEvidence.range.endMs,
      anchorMs: evidence.frames[anchor.index]?.timeMs ?? windowEvidence.range.startMs,
      peakEnergy: anchor.score,
      evidence: windowEvidence,
    };
  });
  return {
    schema: "editflow.dense-effect-sequence.v1",
    sourceId: evidence.sourceId,
    windows,
    evidenceRefs: [...new Set([
      ...evidence.evidenceRefs,
      `dense-sequence-parent:${evidence.contentKey}`,
      "algorithm:robust-effect-window-detection-v1",
    ])],
  };
};

const relativeDifference = (a: number, b: number, floor: number): number =>
  clamp01(Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), floor));

export const semanticEffectWindowCostV1 = (
  reference: DenseEffectEvidenceV1,
  render: DenseEffectEvidenceV1,
): number => {
  const a = reference.summary;
  const b = render.summary;
  const terms: readonly [number, number][] = [
    [relativeDifference(a.temporalStateCountPeak, b.temporalStateCountPeak, 1), 1.2],
    [Math.abs(a.temporalPersistence - b.temporalPersistence), 1],
    [relativeDifference(a.motionEnergyPeak, b.motionEnergyPeak, 0.08), 0.8],
    [relativeDifference(a.displacementPeak, b.displacementPeak, 0.025), 1],
    [relativeDifference(a.scaleRange, b.scaleRange, 0.04), 0.7],
    [relativeDifference(a.rotationRange, b.rotationRange, 2), 0.5],
    [Math.abs(a.blurPeak - b.blurPeak), 0.45],
    [Math.abs(a.distortionPeak - b.distortionPeak), 0.8],
    [Math.abs(a.overlapDensityPeak - b.overlapDensityPeak), 1.1],
    [relativeDifference(a.accelerationPeak, b.accelerationPeak, 0.025), 0.8],
    [relativeDifference(a.recoveryFrames, b.recoveryFrames, 1), 0.7],
    [Math.abs(a.motionPeakPhase - b.motionPeakPhase), 0.55],
    [Math.abs(a.opticalPeakPhase - b.opticalPeakPhase), 0.45],
  ];
  const totalWeight = terms.reduce((sum, [, weight]) => sum + weight, 0);
  return totalWeight === 0 ? 1
    : clamp01(terms.reduce((sum, [value, weight]) => sum + (value * weight), 0) / totalWeight);
};

export const alignDenseEffectSequencesV1 = (
  reference: DenseEffectSequenceV1,
  render: DenseEffectSequenceV1,
  options: Readonly<{
    gapPenalty?: number;
    positionWeight?: number;
    maxPhaseDrift?: number;
  }> = {},
): SemanticEffectSequenceAlignmentV1 => {
  const n = reference.windows.length;
  const m = render.windows.length;
  const gap = options.gapPenalty ?? 0.55;
  const positionWeight = options.positionWeight ?? 0.35;
  // Constrain semantic warping so repeated, visually similar transitions cannot
  // cross-match across distant editorial events. This is the sequence analogue
  // of a bounded DTW warping window: footage timing may stretch, but event
  // identity remains local in normalized edit time.
  const maxPhaseDrift = Math.min(1, Math.max(0, options.maxPhaseDrift ?? 0.28));
  const cost = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(Number.POSITIVE_INFINITY));
  const op = Array.from(
    { length: n + 1 },
    () => Array<"MATCH" | "SKIP_REFERENCE" | "SKIP_RENDER" | null>(m + 1).fill(null),
  );
  cost[0]![0] = 0;
  for (let i = 1; i <= n; i += 1) {
    cost[i]![0] = i * gap;
    op[i]![0] = "SKIP_REFERENCE";
  }
  for (let j = 1; j <= m; j += 1) {
    cost[0]![j] = j * gap;
    op[0]![j] = "SKIP_RENDER";
  }

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const referenceWindow = reference.windows[i - 1];
      const renderWindow = render.windows[j - 1];
      if (referenceWindow === undefined || renderWindow === undefined) continue;
      const semantic = semanticEffectWindowCostV1(referenceWindow.evidence, renderWindow.evidence);
      const referenceStart = reference.windows[0]?.startMs ?? referenceWindow.startMs;
      const referenceEnd = reference.windows.at(-1)?.endMs ?? referenceWindow.endMs;
      const renderStart = render.windows[0]?.startMs ?? renderWindow.startMs;
      const renderEnd = render.windows.at(-1)?.endMs ?? renderWindow.endMs;
      const referencePhase = (referenceWindow.anchorMs - referenceStart)
        / Math.max(1, referenceEnd - referenceStart);
      const renderPhase = (renderWindow.anchorMs - renderStart)
        / Math.max(1, renderEnd - renderStart);
      // Penalize temporal drift non-linearly. An adjacent cut in a dense edit can
      // look semantically similar; normalized time keeps the comparator paired
      // to the same editorial event without requiring source-time identity.
      const phaseDrift = Math.abs(referencePhase - renderPhase);
      const temporalPenalty = Math.min(1, phaseDrift / 0.2) * positionWeight;
      const match = phaseDrift > maxPhaseDrift
        ? Number.POSITIVE_INFINITY
        : (cost[i - 1]?.[j - 1] ?? 0) + semantic + temporalPenalty;
      const skipReference = (cost[i - 1]?.[j] ?? Number.POSITIVE_INFINITY) + gap;
      const skipRender = (cost[i]?.[j - 1] ?? Number.POSITIVE_INFINITY) + gap;
      const best = Math.min(match, skipReference, skipRender);
      cost[i]![j] = best;
      op[i]![j] = best === match ? "MATCH"
        : best === skipReference ? "SKIP_REFERENCE" : "SKIP_RENDER";
    }
  }

  const pairs = [];
  const unmatchedReferenceWindowIds: string[] = [];
  const unmatchedRenderWindowIds: string[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const step = op[i]?.[j];
    if (step === "MATCH") {
      const referenceWindow = reference.windows[i - 1];
      const renderWindow = render.windows[j - 1];
      if (referenceWindow !== undefined && renderWindow !== undefined) {
        pairs.push({
          referenceWindowId: referenceWindow.windowId,
          renderWindowId: renderWindow.windowId,
          referenceIndex: i - 1,
          renderIndex: j - 1,
          semanticCost: semanticEffectWindowCostV1(referenceWindow.evidence, renderWindow.evidence),
        });
      }
      i -= 1;
      j -= 1;
    } else if (step === "SKIP_REFERENCE" || j === 0) {
      const referenceWindow = reference.windows[i - 1];
      if (referenceWindow !== undefined) unmatchedReferenceWindowIds.push(referenceWindow.windowId);
      i -= 1;
    } else {
      const renderWindow = render.windows[j - 1];
      if (renderWindow !== undefined) unmatchedRenderWindowIds.push(renderWindow.windowId);
      j -= 1;
    }
  }

  return {
    schema: "editflow.semantic-effect-sequence-alignment.v1",
    pairs: pairs.reverse(),
    unmatchedReferenceWindowIds: unmatchedReferenceWindowIds.reverse(),
    unmatchedRenderWindowIds: unmatchedRenderWindowIds.reverse(),
  };
};
