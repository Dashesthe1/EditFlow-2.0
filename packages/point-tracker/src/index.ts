import type {
  EditorMotionDirectionV1,
  EditorNormalizedPointV1,
  EditorSubjectStateV1,
  EditorTrackStatusV1,
} from "../../editor-state/src/index.js";

export interface GrayFrameV1 {
  readonly frameId: string;
  readonly width: number;
  readonly height: number;
  /** Row-major 8-bit luminance data, exactly width * height bytes. */
  readonly data: Uint8Array;
  readonly timeMs: number;
  readonly evidenceRefs: readonly string[];
}

export interface PointTrackRequestV1 {
  readonly targetEntityId: string;
  readonly initialPoint: EditorNormalizedPointV1;
  readonly featureRadiusPx?: number;
  readonly searchRadiusPx?: number;
  readonly maxJumpPx?: number;
  readonly maxRoundTripErrorPx?: number;
  readonly maxNormalizedError?: number;
  readonly minStableConfidence?: number;
  readonly minUniqueness?: number;
}

export interface PointTrackSampleV1 {
  readonly frameId: string;
  readonly timeMs: number;
  readonly point: EditorNormalizedPointV1;
  readonly confidence: number;
  readonly normalizedError: number;
  readonly uniqueness: number;
  readonly jumpPx: number;
  readonly roundTripErrorPx: number;
  readonly status: EditorTrackStatusV1;
  readonly evidenceRefs: readonly string[];
}

export interface PointTrackResultV1 {
  readonly targetEntityId: string;
  readonly status: EditorTrackStatusV1;
  readonly confidence: number;
  readonly samples: readonly PointTrackSampleV1[];
  readonly evidenceRefs: readonly string[];
}

export interface PointTrackOptionsV1 {
  readonly featureRadiusPx: number;
  readonly searchRadiusPx: number;
  readonly maxJumpPx: number;
  readonly maxRoundTripErrorPx: number;
  readonly maxNormalizedError: number;
  readonly minStableConfidence: number;
  readonly minUniqueness: number;
}

export const DEFAULT_POINT_TRACK_OPTIONS_V1: PointTrackOptionsV1 = {
  featureRadiusPx: 3,
  searchRadiusPx: 10,
  maxJumpPx: 7,
  maxRoundTripErrorPx: 2.5,
  maxNormalizedError: 0.32,
  minStableConfidence: 0.72,
  minUniqueness: 0.12,
};

interface PixelPoint {
  readonly x: number;
  readonly y: number;
}

interface Candidate {
  readonly point: PixelPoint;
  readonly error: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const finite01 = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1;
const distancePx = (a: PixelPoint, b: PixelPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

const unique = (values: readonly string[]): readonly string[] => [...new Set(values)];

const optionsFor = (request: PointTrackRequestV1): PointTrackOptionsV1 => ({
  featureRadiusPx: request.featureRadiusPx ?? DEFAULT_POINT_TRACK_OPTIONS_V1.featureRadiusPx,
  searchRadiusPx: request.searchRadiusPx ?? DEFAULT_POINT_TRACK_OPTIONS_V1.searchRadiusPx,
  maxJumpPx: request.maxJumpPx ?? DEFAULT_POINT_TRACK_OPTIONS_V1.maxJumpPx,
  maxRoundTripErrorPx: request.maxRoundTripErrorPx ?? DEFAULT_POINT_TRACK_OPTIONS_V1.maxRoundTripErrorPx,
  maxNormalizedError: request.maxNormalizedError ?? DEFAULT_POINT_TRACK_OPTIONS_V1.maxNormalizedError,
  minStableConfidence: request.minStableConfidence ?? DEFAULT_POINT_TRACK_OPTIONS_V1.minStableConfidence,
  minUniqueness: request.minUniqueness ?? DEFAULT_POINT_TRACK_OPTIONS_V1.minUniqueness,
});

const validatePositiveInteger = (name: string, value: number): void => {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer.`);
};

const validateOptions = (options: PointTrackOptionsV1): void => {
  validatePositiveInteger("featureRadiusPx", options.featureRadiusPx);
  validatePositiveInteger("searchRadiusPx", options.searchRadiusPx);
  if (options.searchRadiusPx < options.featureRadiusPx) {
    throw new RangeError("searchRadiusPx must be at least featureRadiusPx.");
  }
  if (!Number.isFinite(options.maxJumpPx) || options.maxJumpPx <= 0) throw new RangeError("maxJumpPx must be positive.");
  if (!Number.isFinite(options.maxRoundTripErrorPx) || options.maxRoundTripErrorPx < 0) {
    throw new RangeError("maxRoundTripErrorPx must be non-negative.");
  }
  if (!finite01(options.maxNormalizedError)) throw new RangeError("maxNormalizedError must be in [0,1].");
  if (!finite01(options.minStableConfidence)) throw new RangeError("minStableConfidence must be in [0,1].");
  if (!finite01(options.minUniqueness)) throw new RangeError("minUniqueness must be in [0,1].");
};

const validateFrames = (frames: readonly GrayFrameV1[]): void => {
  if (frames.length < 2) throw new RangeError("Point tracking requires at least two frames.");
  const first = frames[0];
  if (!first) throw new RangeError("Point tracking requires a first frame.");
  validatePositiveInteger("frame.width", first.width);
  validatePositiveInteger("frame.height", first.height);
  let previousTime = -Infinity;
  for (const frame of frames) {
    if (frame.width !== first.width || frame.height !== first.height) {
      throw new RangeError("All tracking frames must have identical dimensions.");
    }
    if (frame.data.length !== frame.width * frame.height) {
      throw new RangeError(`Frame '${frame.frameId}' luminance length does not equal width * height.`);
    }
    if (!Number.isFinite(frame.timeMs) || frame.timeMs <= previousTime) {
      throw new RangeError("Tracking frame times must be finite and strictly increasing.");
    }
    previousTime = frame.timeMs;
  }
};

const normalizedToPixel = (point: EditorNormalizedPointV1, width: number, height: number): PixelPoint => {
  if (!finite01(point.x) || !finite01(point.y)) throw new RangeError("initialPoint must be normalized to [0,1].");
  return {
    x: Math.round(point.x * Math.max(0, width - 1)),
    y: Math.round(point.y * Math.max(0, height - 1)),
  };
};

const pixelToNormalized = (point: PixelPoint, width: number, height: number): EditorNormalizedPointV1 => ({
  x: width <= 1 ? 0 : point.x / (width - 1),
  y: height <= 1 ? 0 : point.y / (height - 1),
});

const patchFits = (frame: GrayFrameV1, point: PixelPoint, radius: number): boolean =>
  point.x - radius >= 0 &&
  point.y - radius >= 0 &&
  point.x + radius < frame.width &&
  point.y + radius < frame.height;

const patch = (frame: GrayFrameV1, point: PixelPoint, radius: number): Uint8Array => {
  if (!patchFits(frame, point, radius)) throw new RangeError("Tracking feature patch falls outside the frame.");
  const size = radius * 2 + 1;
  const output = new Uint8Array(size * size);
  let write = 0;
  for (let y = point.y - radius; y <= point.y + radius; y += 1) {
    const row = y * frame.width;
    for (let x = point.x - radius; x <= point.x + radius; x += 1) {
      output[write] = frame.data[row + x] ?? 0;
      write += 1;
    }
  }
  return output;
};

const normalizedMae = (
  frame: GrayFrameV1,
  point: PixelPoint,
  radius: number,
  template: Uint8Array,
): number => {
  const size = radius * 2 + 1;
  if (template.length !== size * size || !patchFits(frame, point, radius)) return 1;
  let total = 0;
  let read = 0;
  for (let y = point.y - radius; y <= point.y + radius; y += 1) {
    const row = y * frame.width;
    for (let x = point.x - radius; x <= point.x + radius; x += 1) {
      total += Math.abs((frame.data[row + x] ?? 0) - (template[read] ?? 0));
      read += 1;
    }
  }
  return total / (template.length * 255);
};

const search = (
  frame: GrayFrameV1,
  center: PixelPoint,
  template: Uint8Array,
  featureRadiusPx: number,
  searchRadiusPx: number,
): readonly Candidate[] => {
  const candidates: Candidate[] = [];
  const minX = Math.max(featureRadiusPx, center.x - searchRadiusPx);
  const maxX = Math.min(frame.width - featureRadiusPx - 1, center.x + searchRadiusPx);
  const minY = Math.max(featureRadiusPx, center.y - searchRadiusPx);
  const maxY = Math.min(frame.height - featureRadiusPx - 1, center.y + searchRadiusPx);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const point = { x, y };
      candidates.push({
        point,
        error: normalizedMae(frame, point, featureRadiusPx, template),
      });
    }
  }
  candidates.sort((a, b) => a.error - b.error || distancePx(a.point, center) - distancePx(b.point, center));
  return candidates;
};

const match = (
  frame: GrayFrameV1,
  center: PixelPoint,
  template: Uint8Array,
  options: PointTrackOptionsV1,
): { readonly best: Candidate | null; readonly uniqueness: number } => {
  const candidates = search(frame, center, template, options.featureRadiusPx, options.searchRadiusPx);
  const best = candidates[0] ?? null;
  if (!best) return { best: null, uniqueness: 0 };
  const exclusion = Math.max(2, options.featureRadiusPx);
  const second = candidates.find((candidate) => distancePx(candidate.point, best.point) > exclusion);
  if (!second) return { best, uniqueness: 1 };
  const denominator = Math.max(second.error, 1 / 255);
  return { best, uniqueness: clamp01((second.error - best.error) / denominator) };
};

const statusRank: Readonly<Record<EditorTrackStatusV1, number>> = {
  NOT_TRACKED: 0,
  STABLE: 1,
  AT_RISK: 2,
  DRIFTING: 3,
  LOST: 4,
};

const worseStatus = (a: EditorTrackStatusV1, b: EditorTrackStatusV1): EditorTrackStatusV1 =>
  statusRank[a] >= statusRank[b] ? a : b;

const classify = (
  normalizedError: number,
  uniqueness: number,
  confidence: number,
  jumpPx: number,
  roundTripErrorPx: number,
  options: PointTrackOptionsV1,
): EditorTrackStatusV1 => {
  if (normalizedError > options.maxNormalizedError || confidence < 0.25) return "LOST";
  if (jumpPx > options.maxJumpPx || roundTripErrorPx > options.maxRoundTripErrorPx) return "DRIFTING";
  if (confidence < options.minStableConfidence || uniqueness < options.minUniqueness) return "AT_RISK";
  return "STABLE";
};

const backwardRoundTripError = (
  previousFrame: GrayFrameV1,
  currentFrame: GrayFrameV1,
  previousPoint: PixelPoint,
  currentPoint: PixelPoint,
  options: PointTrackOptionsV1,
): number => {
  if (!patchFits(currentFrame, currentPoint, options.featureRadiusPx)) return Number.POSITIVE_INFINITY;
  const currentTemplate = patch(currentFrame, currentPoint, options.featureRadiusPx);
  const backwards = match(previousFrame, previousPoint, currentTemplate, options);
  return backwards.best ? distancePx(backwards.best.point, previousPoint) : Number.POSITIVE_INFINITY;
};

export const trackPointV1 = (
  frames: readonly GrayFrameV1[],
  request: PointTrackRequestV1,
): PointTrackResultV1 => {
  validateFrames(frames);
  const options = optionsFor(request);
  validateOptions(options);
  const first = frames[0];
  if (!first) throw new RangeError("Point tracking requires a first frame.");
  const initialPixel = normalizedToPixel(request.initialPoint, first.width, first.height);
  if (!patchFits(first, initialPixel, options.featureRadiusPx)) {
    throw new RangeError("Initial tracking feature patch falls outside the first frame.");
  }
  const template = patch(first, initialPixel, options.featureRadiusPx);
  const samples: PointTrackSampleV1[] = [{
    frameId: first.frameId,
    timeMs: first.timeMs,
    point: pixelToNormalized(initialPixel, first.width, first.height),
    confidence: 1,
    normalizedError: 0,
    uniqueness: 1,
    jumpPx: 0,
    roundTripErrorPx: 0,
    status: "STABLE",
    evidenceRefs: [...first.evidenceRefs],
  }];

  let previousPoint = initialPixel;
  let overallStatus: EditorTrackStatusV1 = "STABLE";
  let confidenceTotal = 0;
  let confidenceCount = 0;

  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index];
    const previousFrame = frames[index - 1];
    if (!frame || !previousFrame) continue;
    const found = match(frame, previousPoint, template, options);
    if (!found.best) {
      const lost: PointTrackSampleV1 = {
        frameId: frame.frameId,
        timeMs: frame.timeMs,
        point: pixelToNormalized(previousPoint, frame.width, frame.height),
        confidence: 0,
        normalizedError: 1,
        uniqueness: 0,
        jumpPx: 0,
        roundTripErrorPx: Number.POSITIVE_INFINITY,
        status: "LOST",
        evidenceRefs: [...frame.evidenceRefs],
      };
      samples.push(lost);
      overallStatus = "LOST";
      confidenceCount += 1;
      continue;
    }

    const currentPoint = found.best.point;
    const jumpPx = distancePx(currentPoint, previousPoint);
    const roundTripErrorPx = backwardRoundTripError(previousFrame, frame, previousPoint, currentPoint, options);
    const quality = clamp01(1 - found.best.error / Math.max(options.maxNormalizedError, 1 / 255));
    const confidence = clamp01(quality * 0.72 + found.uniqueness * 0.28);
    const status = classify(
      found.best.error,
      found.uniqueness,
      confidence,
      jumpPx,
      roundTripErrorPx,
      options,
    );
    samples.push({
      frameId: frame.frameId,
      timeMs: frame.timeMs,
      point: pixelToNormalized(currentPoint, frame.width, frame.height),
      confidence,
      normalizedError: found.best.error,
      uniqueness: found.uniqueness,
      jumpPx,
      roundTripErrorPx,
      status,
      evidenceRefs: [...frame.evidenceRefs],
    });
    overallStatus = worseStatus(overallStatus, status);
    confidenceTotal += confidence;
    confidenceCount += 1;
    if (status !== "LOST") previousPoint = currentPoint;
  }

  return {
    targetEntityId: request.targetEntityId,
    status: overallStatus,
    confidence: confidenceCount === 0 ? 1 : clamp01(confidenceTotal / confidenceCount),
    samples,
    evidenceRefs: unique(frames.flatMap((frame) => frame.evidenceRefs)),
  };
};

const motionFromSamples = (
  samples: readonly PointTrackSampleV1[],
): { readonly speed: number; readonly acceleration: number; readonly direction: EditorMotionDirectionV1 } => {
  if (samples.length < 2) return { speed: 0, acceleration: 0, direction: "STILL" };
  const last = samples[samples.length - 1];
  const previous = samples[samples.length - 2];
  if (!last || !previous) return { speed: 0, acceleration: 0, direction: "UNKNOWN" };
  const dt = (last.timeMs - previous.timeMs) / 1000;
  if (!Number.isFinite(dt) || dt <= 0) return { speed: 0, acceleration: 0, direction: "UNKNOWN" };
  const dx = last.point.x - previous.point.x;
  const dy = last.point.y - previous.point.y;
  const speed = Math.hypot(dx, dy) / dt;
  let direction: EditorMotionDirectionV1 = "STILL";
  if (Math.hypot(dx, dy) >= 0.0025) {
    if (Math.abs(dx) >= Math.abs(dy)) direction = dx >= 0 ? "RIGHT" : "LEFT";
    else direction = dy >= 0 ? "DOWN" : "UP";
  }

  let previousSpeed = speed;
  if (samples.length >= 3) {
    const before = samples[samples.length - 3];
    if (before) {
      const previousDt = (previous.timeMs - before.timeMs) / 1000;
      if (previousDt > 0) previousSpeed = Math.hypot(
        previous.point.x - before.point.x,
        previous.point.y - before.point.y,
      ) / previousDt;
    }
  }
  return { speed, acceleration: (speed - previousSpeed) / dt, direction };
};

export const applyPointTrackToEditorSubjectV1 = (
  subject: EditorSubjectStateV1,
  track: PointTrackResultV1,
): EditorSubjectStateV1 => {
  if (track.targetEntityId !== subject.entityId) {
    throw new Error(`Track target '${track.targetEntityId}' does not match subject '${subject.entityId}'.`);
  }
  const last = track.samples[track.samples.length - 1];
  if (!last) throw new Error("Point track result has no samples.");
  const motion = motionFromSamples(track.samples);
  return {
    ...subject,
    center: last.point,
    speed: motion.speed,
    acceleration: motion.acceleration,
    motionDirection: motion.direction,
    trackConfidence: track.confidence,
    trackStatus: track.status,
    evidenceRefs: unique([...subject.evidenceRefs, ...track.evidenceRefs]),
    observedAtMs: last.timeMs,
  };
};
