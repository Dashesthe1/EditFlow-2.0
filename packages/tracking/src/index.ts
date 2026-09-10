export interface TrackingPoint { readonly x: number; readonly y: number; }
export interface TrackingImage { readonly width: number; readonly height: number; readonly rgb: Uint8Array; }
export interface PointTrackSample {
  readonly frameIndex: number;
  readonly point: TrackingPoint;
  readonly similarity: number;
  readonly separation: number;
  readonly accepted: boolean;
}
export interface PointTrackRequest {
  readonly frames: readonly TrackingImage[];
  readonly seed: TrackingPoint;
  readonly featureRadius: number;
  readonly searchRadius: number;
  readonly minSimilarity?: number;
  readonly minSeparation?: number;
}
export interface PointTrackResult {
  readonly status: "TRACKED" | "REJECTED";
  readonly samples: readonly PointTrackSample[];
  readonly rejectedFrameIndex: number | null;
  readonly reason: string | null;
}

const assertInteger = (name: string, value: number, min = 0): void => {
  if (!Number.isInteger(value) || value < min) throw new TypeError(`${name} must be an integer >= ${min}.`);
};
const pixelOffset = (image: TrackingImage, x: number, y: number): number => (y * image.width + x) * 3;
const validateImage = (image: TrackingImage): void => {
  assertInteger("image.width", image.width, 1); assertInteger("image.height", image.height, 1);
  if (image.rgb.length !== image.width * image.height * 3) throw new TypeError("Tracking image RGB byte length is invalid.");
};
const patchFits = (image: TrackingImage, point: TrackingPoint, radius: number): boolean =>
  point.x - radius >= 0 && point.y - radius >= 0 && point.x + radius < image.width && point.y + radius < image.height;

const patchSad = (template: TrackingImage, templatePoint: TrackingPoint, candidate: TrackingImage, candidatePoint: TrackingPoint, radius: number): number => {
  let total = 0; let count = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const a = pixelOffset(template, templatePoint.x + dx, templatePoint.y + dy);
      const b = pixelOffset(candidate, candidatePoint.x + dx, candidatePoint.y + dy);
      total += Math.abs(template.rgb[a] - candidate.rgb[b]) + Math.abs(template.rgb[a + 1] - candidate.rgb[b + 1]) + Math.abs(template.rgb[a + 2] - candidate.rgb[b + 2]);
      count += 3;
    }
  }
  return total / (count * 255);
};

export const trackPoint = (request: PointTrackRequest): PointTrackResult => {
  if (request.frames.length < 2) throw new TypeError("Point tracking requires at least two frames.");
  request.frames.forEach(validateImage);
  const { width, height } = request.frames[0];
  if (request.frames.some((frame) => frame.width !== width || frame.height !== height)) throw new TypeError("All tracking frames must share dimensions.");
  assertInteger("seed.x", request.seed.x); assertInteger("seed.y", request.seed.y);
  assertInteger("featureRadius", request.featureRadius, 1); assertInteger("searchRadius", request.searchRadius, 1);
  if (!patchFits(request.frames[0], request.seed, request.featureRadius)) throw new RangeError("Seed feature patch falls outside the first frame.");
  const minSimilarity = request.minSimilarity ?? 0.82;
  const minSeparation = request.minSeparation ?? 0.015;
  if (minSimilarity < 0 || minSimilarity > 1 || minSeparation < 0 || minSeparation > 1) throw new RangeError("Tracking thresholds must be in [0,1].");

  const samples: PointTrackSample[] = [{ frameIndex: 0, point: { ...request.seed }, similarity: 1, separation: 1, accepted: true }];
  let previousPoint = { ...request.seed };
  for (let frameIndex = 1; frameIndex < request.frames.length; frameIndex += 1) {
    const previousFrame = request.frames[frameIndex - 1]; const frame = request.frames[frameIndex];
    let best: { point: TrackingPoint; sad: number } | null = null;
    let secondSad = Number.POSITIVE_INFINITY;
    for (let y = previousPoint.y - request.searchRadius; y <= previousPoint.y + request.searchRadius; y += 1) {
      for (let x = previousPoint.x - request.searchRadius; x <= previousPoint.x + request.searchRadius; x += 1) {
        const point = { x, y };
        if (!patchFits(frame, point, request.featureRadius)) continue;
        const sad = patchSad(previousFrame, previousPoint, frame, point, request.featureRadius);
        if (best === null || sad < best.sad) { secondSad = best?.sad ?? secondSad; best = { point, sad }; }
        else if (sad < secondSad) secondSad = sad;
      }
    }
    if (best === null) return { status: "REJECTED", samples, rejectedFrameIndex: frameIndex, reason: "NO_VALID_SEARCH_CANDIDATE" };
    const similarity = 1 - best.sad;
    const separation = Number.isFinite(secondSad) ? Math.max(0, secondSad - best.sad) : 1;
    const accepted = similarity >= minSimilarity && separation >= minSeparation;
    const sample: PointTrackSample = { frameIndex, point: best.point, similarity, separation, accepted };
    samples.push(sample);
    if (!accepted) return { status: "REJECTED", samples, rejectedFrameIndex: frameIndex, reason: similarity < minSimilarity ? "LOW_SIMILARITY" : "AMBIGUOUS_MATCH" };
    previousPoint = best.point;
  }
  return { status: "TRACKED", samples, rejectedFrameIndex: null, reason: null };
};

export const decodeBmp24 = (bytes: Uint8Array): TrackingImage => {
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) throw new TypeError("Expected a Windows BMP file.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pixelStart = view.getUint32(10, true); const dibSize = view.getUint32(14, true);
  const width = view.getInt32(18, true); const signedHeight = view.getInt32(22, true);
  const planes = view.getUint16(26, true); const bpp = view.getUint16(28, true); const compression = view.getUint32(30, true);
  if (dibSize < 40 || width <= 0 || signedHeight === 0 || planes !== 1 || bpp !== 24 || compression !== 0) throw new TypeError("Only uncompressed 24-bit Windows BMP input is supported by the M4 point tracker.");
  const height = Math.abs(signedHeight); const topDown = signedHeight < 0; const stride = Math.ceil((width * 3) / 4) * 4;
  if (pixelStart + stride * height > bytes.length) throw new TypeError("BMP pixel data is truncated.");
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const sourceY = topDown ? y : height - 1 - y; const row = pixelStart + sourceY * stride;
    for (let x = 0; x < width; x += 1) {
      const src = row + x * 3, dst = (y * width + x) * 3;
      rgb[dst] = bytes[src + 2]; rgb[dst + 1] = bytes[src + 1]; rgb[dst + 2] = bytes[src];
    }
  }
  return { width, height, rgb };
};
