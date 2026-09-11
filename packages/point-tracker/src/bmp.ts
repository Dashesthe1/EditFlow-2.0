import { readFile } from "node:fs/promises";
import type { GrayFrameV1 } from "./index.js";

export interface BmpDecodeLimitsV1 {
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxPixels: number;
  readonly maxBytes: number;
}

export interface BmpFrameEvidenceV1 {
  readonly frameId: string;
  readonly timeMs: number;
  readonly evidenceRefs: readonly string[];
}

export const DEFAULT_BMP_DECODE_LIMITS_V1: BmpDecodeLimitsV1 = {
  maxWidth: 8192,
  maxHeight: 8192,
  maxPixels: 33_554_432,
  maxBytes: 268_435_456,
};

const ensureIntegerInRange = (name: string, value: number, min: number, max: number): void => {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}].`);
  }
};

const validateLimits = (limits: BmpDecodeLimitsV1): void => {
  ensureIntegerInRange("maxWidth", limits.maxWidth, 1, 1_000_000);
  ensureIntegerInRange("maxHeight", limits.maxHeight, 1, 1_000_000);
  ensureIntegerInRange("maxPixels", limits.maxPixels, 1, Number.MAX_SAFE_INTEGER);
  ensureIntegerInRange("maxBytes", limits.maxBytes, 54, Number.MAX_SAFE_INTEGER);
};

const validateEvidence = (evidence: BmpFrameEvidenceV1): void => {
  if (!evidence.frameId) throw new Error("BMP frame evidence requires a non-empty frameId.");
  if (!Number.isFinite(evidence.timeMs) || evidence.timeMs < 0) {
    throw new RangeError("BMP frame evidence timeMs must be finite and non-negative.");
  }
};

const luminance8 = (red: number, green: number, blue: number): number =>
  Math.min(255, Math.max(0, Math.round((77 * red + 150 * green + 29 * blue) / 256)));

/**
 * Decode an uncompressed Windows BMP into deterministic 8-bit luminance.
 *
 * Supported inputs:
 * - BITMAPINFOHEADER-or-later DIB headers (>= 40 bytes)
 * - 24-bit BGR or 32-bit BGRA pixels
 * - bottom-up and top-down row order
 * - BI_RGB (compression = 0)
 *
 * Unsupported or malformed variants fail closed before pixel allocation/copy.
 */
export const decodeBmpGrayFrameV1 = (
  input: Uint8Array,
  evidence: BmpFrameEvidenceV1,
  limits: BmpDecodeLimitsV1 = DEFAULT_BMP_DECODE_LIMITS_V1,
): GrayFrameV1 => {
  validateLimits(limits);
  validateEvidence(evidence);

  if (input.byteLength > limits.maxBytes) {
    throw new RangeError(`BMP exceeds maxBytes (${input.byteLength} > ${limits.maxBytes}).`);
  }
  if (input.byteLength < 54) throw new Error("BMP is too short for file and BITMAPINFO headers.");

  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.toString("ascii", 0, 2) !== "BM") throw new Error("BMP signature is not BM.");

  const declaredFileSize = bytes.readUInt32LE(2);
  const pixelOffset = bytes.readUInt32LE(10);
  const dibSize = bytes.readUInt32LE(14);
  if (dibSize < 40) throw new Error(`Unsupported BMP DIB header size: ${dibSize}.`);
  if (14 + dibSize > bytes.length) throw new Error("BMP DIB header extends beyond file data.");
  if (declaredFileSize !== 0 && declaredFileSize > bytes.length) {
    throw new Error("BMP declared file size extends beyond supplied bytes.");
  }

  const width = bytes.readInt32LE(18);
  const signedHeight = bytes.readInt32LE(22);
  const planes = bytes.readUInt16LE(26);
  const bitsPerPixel = bytes.readUInt16LE(28);
  const compression = bytes.readUInt32LE(30);

  if (width <= 0) throw new Error("BMP width must be positive.");
  if (signedHeight === 0) throw new Error("BMP height cannot be zero.");
  if (planes !== 1) throw new Error(`Unsupported BMP plane count: ${planes}.`);
  if (bitsPerPixel !== 24 && bitsPerPixel !== 32) {
    throw new Error(`Unsupported BMP bit depth: ${bitsPerPixel}; expected 24 or 32.`);
  }
  if (compression !== 0) throw new Error(`Unsupported BMP compression: ${compression}; expected BI_RGB.`);

  const height = Math.abs(signedHeight);
  ensureIntegerInRange("BMP width", width, 1, limits.maxWidth);
  ensureIntegerInRange("BMP height", height, 1, limits.maxHeight);
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > limits.maxPixels) {
    throw new RangeError(`BMP exceeds maxPixels (${pixels} > ${limits.maxPixels}).`);
  }

  const bytesPerPixel = bitsPerPixel / 8;
  const rowStride = Math.floor((width * bytesPerPixel + 3) / 4) * 4;
  const pixelBytes = rowStride * height;
  if (!Number.isSafeInteger(pixelBytes)) throw new RangeError("BMP pixel byte count exceeds safe integer range.");
  if (pixelOffset < 14 + dibSize) throw new Error("BMP pixel offset overlaps header data.");
  if (pixelOffset + pixelBytes > bytes.length) throw new Error("BMP pixel data extends beyond supplied bytes.");

  const output = new Uint8Array(pixels);
  const topDown = signedHeight < 0;
  for (let y = 0; y < height; y += 1) {
    const sourceY = topDown ? y : height - 1 - y;
    const rowOffset = pixelOffset + sourceY * rowStride;
    const outputRow = y * width;
    for (let x = 0; x < width; x += 1) {
      const pixel = rowOffset + x * bytesPerPixel;
      const blue = bytes[pixel] ?? 0;
      const green = bytes[pixel + 1] ?? 0;
      const red = bytes[pixel + 2] ?? 0;
      output[outputRow + x] = luminance8(red, green, blue);
    }
  }

  return {
    frameId: evidence.frameId,
    width,
    height,
    data: output,
    timeMs: evidence.timeMs,
    evidenceRefs: [...evidence.evidenceRefs],
  };
};

export const readBmpGrayFrameV1 = async (
  filePath: string,
  evidence: BmpFrameEvidenceV1,
  limits: BmpDecodeLimitsV1 = DEFAULT_BMP_DECODE_LIMITS_V1,
): Promise<GrayFrameV1> => {
  if (!filePath) throw new Error("BMP frame evidence requires a non-empty file path.");
  const bytes = await readFile(filePath);
  return decodeBmpGrayFrameV1(bytes, evidence, limits);
};

export interface BmpSequenceFrameV1 extends BmpFrameEvidenceV1 {
  readonly filePath: string;
}

export const readBmpGraySequenceV1 = async (
  frames: readonly BmpSequenceFrameV1[],
  limits: BmpDecodeLimitsV1 = DEFAULT_BMP_DECODE_LIMITS_V1,
): Promise<readonly GrayFrameV1[]> => {
  if (frames.length < 2) throw new RangeError("BMP tracking sequence requires at least two frames.");
  let previousTimeMs = -Infinity;
  const output: GrayFrameV1[] = [];
  for (const frame of frames) {
    if (frame.timeMs <= previousTimeMs) throw new RangeError("BMP sequence frame times must be strictly increasing.");
    previousTimeMs = frame.timeMs;
    output.push(await readBmpGrayFrameV1(frame.filePath, frame, limits));
  }
  return output;
};
