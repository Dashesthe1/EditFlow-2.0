import { readFile } from "node:fs/promises";
import type { GrayFrameV1 } from "./index.js";
import type { BmpFrameEvidenceV1 } from "./bmp.js";

export interface TiffDecodeLimitsV1 {
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxPixels: number;
  readonly maxBytes: number;
  readonly maxIfdEntries: number;
  readonly maxStrips: number;
}

export const DEFAULT_TIFF_DECODE_LIMITS_V1: TiffDecodeLimitsV1 = {
  maxWidth: 8192,
  maxHeight: 8192,
  maxPixels: 33_554_432,
  maxBytes: 268_435_456,
  maxIfdEntries: 256,
  maxStrips: 8192,
};

type Endian = "II" | "MM";

interface TiffReader {
  readonly bytes: Buffer;
  readonly endian: Endian;
  u16(offset: number): number;
  u32(offset: number): number;
}

interface IfdEntry {
  readonly tag: number;
  readonly type: number;
  readonly count: number;
  readonly valueOffset: number;
  readonly entryOffset: number;
}

const TIFF_TYPE_BYTE = 1;
const TIFF_TYPE_SHORT = 3;
const TIFF_TYPE_LONG = 4;
const TIFF_MAGIC = 42;

const TAG_IMAGE_WIDTH = 256;
const TAG_IMAGE_LENGTH = 257;
const TAG_BITS_PER_SAMPLE = 258;
const TAG_COMPRESSION = 259;
const TAG_PHOTOMETRIC = 262;
const TAG_STRIP_OFFSETS = 273;
const TAG_SAMPLES_PER_PIXEL = 277;
const TAG_ROWS_PER_STRIP = 278;
const TAG_STRIP_BYTE_COUNTS = 279;
const TAG_PLANAR_CONFIGURATION = 284;
const TAG_EXTRA_SAMPLES = 338;
const TAG_SAMPLE_FORMAT = 339;

const ensureRange = (bytes: Buffer, offset: number, length: number, label: string): void => {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new Error(`${label} extends beyond TIFF data.`);
  }
};

const createReader = (input: Uint8Array): TiffReader => {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.length < 8) throw new Error("TIFF is too short for its header.");
  const endian = bytes.toString("ascii", 0, 2);
  if (endian !== "II" && endian !== "MM") throw new Error("TIFF byte-order marker must be II or MM.");
  const little = endian === "II";
  return {
    bytes,
    endian,
    u16(offset: number): number {
      ensureRange(bytes, offset, 2, "TIFF uint16");
      return little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
    },
    u32(offset: number): number {
      ensureRange(bytes, offset, 4, "TIFF uint32");
      return little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
    },
  };
};

const typeSize = (type: number): number => {
  if (type === TIFF_TYPE_BYTE) return 1;
  if (type === TIFF_TYPE_SHORT) return 2;
  if (type === TIFF_TYPE_LONG) return 4;
  throw new Error(`Unsupported TIFF field type: ${type}.`);
};

const entryValueByteOffset = (reader: TiffReader, entry: IfdEntry): number => {
  const bytes = typeSize(entry.type) * entry.count;
  if (bytes <= 4) return entry.entryOffset + 8;
  return entry.valueOffset;
};

const readEntryValues = (reader: TiffReader, entry: IfdEntry, maxCount: number): readonly number[] => {
  if (!Number.isInteger(entry.count) || entry.count < 1 || entry.count > maxCount) {
    throw new RangeError(`TIFF tag ${entry.tag} count is outside supported bounds.`);
  }
  const size = typeSize(entry.type);
  const offset = entryValueByteOffset(reader, entry);
  ensureRange(reader.bytes, offset, size * entry.count, `TIFF tag ${entry.tag}`);
  const values: number[] = [];
  for (let index = 0; index < entry.count; index += 1) {
    const at = offset + index * size;
    if (entry.type === TIFF_TYPE_BYTE) values.push(reader.bytes[at] ?? 0);
    else if (entry.type === TIFF_TYPE_SHORT) values.push(reader.u16(at));
    else values.push(reader.u32(at));
  }
  return values;
};

const scalar = (reader: TiffReader, entry: IfdEntry | undefined, label: string, fallback?: number): number => {
  if (!entry) {
    if (fallback !== undefined) return fallback;
    throw new Error(`TIFF is missing required ${label} tag.`);
  }
  if (entry.count !== 1) throw new Error(`TIFF ${label} must contain exactly one value.`);
  const value = readEntryValues(reader, entry, 1)[0];
  if (value === undefined) throw new Error(`TIFF ${label} value is missing.`);
  return value;
};

const validateLimits = (limits: TiffDecodeLimitsV1): void => {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value < 1 || !Number.isSafeInteger(value)) {
      throw new RangeError(`${name} must be a positive safe integer.`);
    }
  }
};

const luma8 = (red: number, green: number, blue: number): number =>
  Math.min(255, Math.max(0, Math.round((77 * red + 150 * green + 29 * blue) / 256)));

/**
 * Decode the bounded baseline TIFF class emitted by AE's installed
 * "TIFF Sequence with Alpha" output module on the M4 proof workstation.
 *
 * Supported:
 * - II or MM byte order
 * - baseline TIFF magic 42
 * - RGB photometric (2)
 * - uncompressed BI-style strips (Compression=1)
 * - chunky/interleaved samples (PlanarConfiguration=1)
 * - RGB or RGBA, 8 bits/sample, unsigned integer sample format
 * - one or multiple strips
 *
 * Any other layout fails closed rather than approximating pixels.
 */
export const decodeTiffGrayFrameV1 = (
  input: Uint8Array,
  evidence: BmpFrameEvidenceV1,
  limits: TiffDecodeLimitsV1 = DEFAULT_TIFF_DECODE_LIMITS_V1,
): GrayFrameV1 => {
  validateLimits(limits);
  if (!evidence.frameId) throw new Error("TIFF frame evidence requires a non-empty frameId.");
  if (!Number.isFinite(evidence.timeMs) || evidence.timeMs < 0) {
    throw new RangeError("TIFF frame evidence timeMs must be finite and non-negative.");
  }
  if (input.byteLength > limits.maxBytes) {
    throw new RangeError(`TIFF exceeds maxBytes (${input.byteLength} > ${limits.maxBytes}).`);
  }

  const reader = createReader(input);
  if (reader.u16(2) !== TIFF_MAGIC) throw new Error("Unsupported TIFF magic; expected 42.");
  const ifdOffset = reader.u32(4);
  ensureRange(reader.bytes, ifdOffset, 2, "TIFF IFD");
  const entryCount = reader.u16(ifdOffset);
  if (entryCount < 1 || entryCount > limits.maxIfdEntries) {
    throw new RangeError(`TIFF IFD entry count ${entryCount} exceeds supported bounds.`);
  }
  ensureRange(reader.bytes, ifdOffset + 2, entryCount * 12 + 4, "TIFF IFD entries");

  const entries = new Map<number, IfdEntry>();
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    const entry: IfdEntry = {
      tag: reader.u16(entryOffset),
      type: reader.u16(entryOffset + 2),
      count: reader.u32(entryOffset + 4),
      valueOffset: reader.u32(entryOffset + 8),
      entryOffset,
    };
    if (!entries.has(entry.tag)) entries.set(entry.tag, entry);
  }

  const width = scalar(reader, entries.get(TAG_IMAGE_WIDTH), "ImageWidth");
  const height = scalar(reader, entries.get(TAG_IMAGE_LENGTH), "ImageLength");
  if (!Number.isInteger(width) || width < 1 || width > limits.maxWidth) throw new RangeError(`TIFF width ${width} exceeds supported bounds.`);
  if (!Number.isInteger(height) || height < 1 || height > limits.maxHeight) throw new RangeError(`TIFF height ${height} exceeds supported bounds.`);
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > limits.maxPixels) {
    throw new RangeError(`TIFF exceeds maxPixels (${pixels} > ${limits.maxPixels}).`);
  }

  const compression = scalar(reader, entries.get(TAG_COMPRESSION), "Compression", 1);
  if (compression !== 1) throw new Error(`Unsupported TIFF Compression=${compression}; expected uncompressed value 1.`);
  const photometric = scalar(reader, entries.get(TAG_PHOTOMETRIC), "PhotometricInterpretation");
  if (photometric !== 2) throw new Error(`Unsupported TIFF PhotometricInterpretation=${photometric}; expected RGB value 2.`);
  const samplesPerPixel = scalar(reader, entries.get(TAG_SAMPLES_PER_PIXEL), "SamplesPerPixel", 3);
  if (samplesPerPixel !== 3 && samplesPerPixel !== 4) {
    throw new Error(`Unsupported TIFF SamplesPerPixel=${samplesPerPixel}; expected RGB or RGBA.`);
  }
  const planar = scalar(reader, entries.get(TAG_PLANAR_CONFIGURATION), "PlanarConfiguration", 1);
  if (planar !== 1) throw new Error(`Unsupported TIFF PlanarConfiguration=${planar}; expected chunky value 1.`);

  const bitsEntry = entries.get(TAG_BITS_PER_SAMPLE);
  if (!bitsEntry) throw new Error("TIFF is missing required BitsPerSample tag.");
  const bits = readEntryValues(reader, bitsEntry, 8);
  if (bits.length !== samplesPerPixel || bits.some((value) => value !== 8)) {
    throw new Error("Unsupported TIFF BitsPerSample; expected 8 bits for every RGB(A) sample.");
  }

  const sampleFormatEntry = entries.get(TAG_SAMPLE_FORMAT);
  if (sampleFormatEntry) {
    const formats = readEntryValues(reader, sampleFormatEntry, 8);
    if (formats.length !== samplesPerPixel || formats.some((value) => value !== 1)) {
      throw new Error("Unsupported TIFF SampleFormat; expected unsigned integer samples.");
    }
  }
  if (samplesPerPixel === 4) {
    const extras = entries.get(TAG_EXTRA_SAMPLES);
    if (extras) {
      const extraValues = readEntryValues(reader, extras, 4);
      if (extraValues.length !== 1 || (extraValues[0] !== 0 && extraValues[0] !== 1 && extraValues[0] !== 2)) {
        throw new Error("Unsupported TIFF ExtraSamples layout.");
      }
    }
  }

  const rowsPerStrip = scalar(reader, entries.get(TAG_ROWS_PER_STRIP), "RowsPerStrip", height);
  if (!Number.isInteger(rowsPerStrip) || rowsPerStrip < 1) throw new Error("TIFF RowsPerStrip must be positive.");
  const stripCount = Math.ceil(height / rowsPerStrip);
  if (stripCount < 1 || stripCount > limits.maxStrips) throw new RangeError(`TIFF strip count ${stripCount} exceeds supported bounds.`);

  const offsetsEntry = entries.get(TAG_STRIP_OFFSETS);
  const byteCountsEntry = entries.get(TAG_STRIP_BYTE_COUNTS);
  if (!offsetsEntry || !byteCountsEntry) throw new Error("TIFF is missing strip offsets or byte counts.");
  const stripOffsets = readEntryValues(reader, offsetsEntry, limits.maxStrips);
  const stripByteCounts = readEntryValues(reader, byteCountsEntry, limits.maxStrips);
  if (stripOffsets.length !== stripCount || stripByteCounts.length !== stripCount) {
    throw new Error(`TIFF strip metadata count mismatch; expected ${stripCount}.`);
  }

  const rowBytes = width * samplesPerPixel;
  const output = new Uint8Array(pixels);
  let outputY = 0;
  for (let stripIndex = 0; stripIndex < stripCount; stripIndex += 1) {
    const offset = stripOffsets[stripIndex];
    const byteCount = stripByteCounts[stripIndex];
    if (offset === undefined || byteCount === undefined) throw new Error("TIFF strip metadata is incomplete.");
    const rows = Math.min(rowsPerStrip, height - outputY);
    const requiredBytes = rows * rowBytes;
    if (byteCount < requiredBytes) throw new Error(`TIFF strip ${stripIndex} is shorter than its declared image rows.`);
    ensureRange(reader.bytes, offset, byteCount, `TIFF strip ${stripIndex}`);
    for (let row = 0; row < rows; row += 1) {
      const rowOffset = offset + row * rowBytes;
      const outputRow = (outputY + row) * width;
      for (let x = 0; x < width; x += 1) {
        const pixel = rowOffset + x * samplesPerPixel;
        output[outputRow + x] = luma8(
          reader.bytes[pixel] ?? 0,
          reader.bytes[pixel + 1] ?? 0,
          reader.bytes[pixel + 2] ?? 0,
        );
      }
    }
    outputY += rows;
  }
  if (outputY !== height) throw new Error("TIFF strip rows did not cover the complete image.");

  return {
    frameId: evidence.frameId,
    width,
    height,
    data: output,
    timeMs: evidence.timeMs,
    evidenceRefs: [...evidence.evidenceRefs],
  };
};

export const readTiffGrayFrameV1 = async (
  filePath: string,
  evidence: BmpFrameEvidenceV1,
  limits: TiffDecodeLimitsV1 = DEFAULT_TIFF_DECODE_LIMITS_V1,
): Promise<GrayFrameV1> => {
  if (!filePath) throw new Error("TIFF frame evidence requires a non-empty file path.");
  return decodeTiffGrayFrameV1(await readFile(filePath), evidence, limits);
};
