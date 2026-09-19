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
  let chroma = 0;
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

  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const pixel = y * frame.width + x;
      const offset = pixel * 4;
      const r = frame.rgba[offset] ?? 0;
      const g = frame.rgba[offset + 1] ?? 0;
      const b = frame.rgba[offset + 2] ?? 0;
      const a = frame.rgba[offset + 3] ?? 0;
      const luma = lumaAt(frame.rgba, offset);
      sum += luma;
      sumSquares += luma * luma;
      chroma += Math.max(r, g, b) - Math.min(r, g, b);
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
      }
    }
  }
  const interior = Math.max(1, (frame.width - 2) * (frame.height - 2));
  const mean = sum / pixels;
  const variance = Math.max(0, sumSquares / pixels - mean * mean);
  return {
    lumaMean: mean / 255,
    lumaStd: Math.sqrt(variance) / 127.5,
    sharpness: clamp01((laplacian / interior) / 128),
    edgeDensity: edges / interior,
    chromaticSeparation: chroma / (pixels * 255),
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
): string => {
  const hash = createHash("sha256");
  hash.update(sourceId);
  hash.update(sourceKind);
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

const summaryFor = (
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
  const active = frames.filter((frame) => frame.frameDifference >= 0.025).length;
  return {
    frameCount: frames.length,
    frameIntervalMs: interval,
    temporalStateCountPeak: max((frame) => frame.temporalStateCount),
    temporalPersistence: frames.length <= 1 ? 0 : active / (frames.length - 1),
    motionEnergyPeak: motionPeak,
    displacementPeak: max((frame) => frame.displacementMagnitude),
    displacementDirection: frames[displacementPeakIndex]?.motionDirection ?? { x: 0, y: 0 },
    scaleRange: max((frame) => frame.scale) - min((frame) => frame.scale),
    rotationRange: max((frame) => frame.rotationDegrees) - min((frame) => frame.rotationDegrees),
    blurPeak: max((frame) => frame.blurStrength),
    blurPeakPhase: phase(blurIndex, frames.length),
    distortionPeak: max((frame) => frame.distortionStrength),
    exposurePeak: max((frame) => frame.exposure),
    subjectSeparationPeak: max((frame) => frame.subjectSeparation),
    overlapDensityPeak: max((frame) => frame.overlapDensity),
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

  const contentKey = digestInput(input.sourceId, input.sourceKind, frames, input.settings);
  const cached = input.cache?.get(contentKey);
  if (cached !== null && cached !== undefined) return cached;
  const edgeThreshold = input.settings.edgeThreshold ?? 32;
  const stats = frames.map((frame) => pixelStats(frame, edgeThreshold));
  const metrics: DenseFrameMetricsV1[] = [];
  for (const [index, frame] of frames.entries()) {
    const current = stats[index];
    if (current === undefined) continue;
    const previous = stats[index - 1];
    const semantic = frame.semantic;
    const centroidMotion = previous === undefined
      ? { x: 0, y: 0 }
      : subtract(current.centroid, previous.centroid);
    const subjectNow = semantic?.subjectCentroid ?? current.subjectCentroid;
    const subjectBefore = frames[index - 1]?.semantic?.subjectCentroid ?? previous?.subjectCentroid;
    const backgroundNow = semantic?.backgroundCentroid ?? current.backgroundCentroid;
    const backgroundBefore = frames[index - 1]?.semantic?.backgroundCentroid ?? previous?.backgroundCentroid;
    const subjectMotion = subjectNow !== undefined && subjectNow !== null
      && subjectBefore !== undefined && subjectBefore !== null
      ? subtract(subjectNow, subjectBefore) : { x: 0, y: 0 };
    const backgroundMotion = backgroundNow !== undefined && backgroundNow !== null
      && backgroundBefore !== undefined && backgroundBefore !== null
      ? subtract(backgroundNow, backgroundBefore) : { x: 0, y: 0 };
    const displacement = semantic?.displacement ?? centroidMotion;
    const difference = frameDifference(frames[index - 1], frame);
    const separation = semantic?.subjectSeparation
      ?? clamp01(magnitude(subtract(subjectMotion, backgroundMotion)) * 4);
    const blur = semantic?.blurStrength ?? clamp01(1 - current.sharpness);
    const distortion = semantic?.distortionStrength
      ?? clamp01(Math.abs((current.edgeDensity - (previous?.edgeDensity ?? current.edgeDensity))) * 4);
    metrics.push({
      timeMs: frame.timeMs,
      lumaMean: current.lumaMean,
      lumaStd: current.lumaStd,
      exposure: current.lumaMean,
      sharpness: current.sharpness,
      edgeDensity: current.edgeDensity,
      chromaticSeparation: current.chromaticSeparation,
      alphaCoverage: current.alphaCoverage,
      visualDensity: clamp01((current.edgeDensity + current.lumaStd + current.chromaticSeparation) / 3),
      frameDifference: difference,
      motionEnergy: clamp01(Math.max(difference, magnitude(displacement))),
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
    settingsFingerprint,
    contentKey,
    frames: metrics,
    summary: summaryFor(metrics, interval, input.settings.recoveryEnergyRatio ?? 0.25),
    evidenceRefs: [...new Set(input.evidenceRefs)],
  };
  input.cache?.set(result);
  return result;
};
