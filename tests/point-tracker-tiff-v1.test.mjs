import test from "node:test";
import assert from "node:assert/strict";
import { decodeTiffGrayFrameV1 } from "../.tmp/runtime/packages/point-tracker/src/tiff.js";
import { trackPointV1 } from "../.tmp/runtime/packages/point-tracker/src/index.js";

const TYPE_SHORT = 3;
const TYPE_LONG = 4;

const makeTiff = ({ width = 16, height = 12, samples = 4, little = false, rowsPerStrip = height, pixel }) => {
  const order = little ? "II" : "MM";
  const write16 = (buffer, offset, value) => little ? buffer.writeUInt16LE(value, offset) : buffer.writeUInt16BE(value, offset);
  const write32 = (buffer, offset, value) => little ? buffer.writeUInt32LE(value, offset) : buffer.writeUInt32BE(value, offset);
  const stripCount = Math.ceil(height / rowsPerStrip);
  const entries = [
    [256, TYPE_LONG, 1, width],
    [257, TYPE_LONG, 1, height],
    [258, TYPE_SHORT, samples, null],
    [259, TYPE_SHORT, 1, 1],
    [262, TYPE_SHORT, 1, 2],
    [273, TYPE_LONG, stripCount, null],
    [277, TYPE_SHORT, 1, samples],
    [278, TYPE_LONG, 1, rowsPerStrip],
    [279, TYPE_LONG, stripCount, null],
    [284, TYPE_SHORT, 1, 1],
    ...(samples === 4 ? [[338, TYPE_SHORT, 1, 0]] : []),
  ];
  const ifdOffset = 8;
  const ifdBytes = 2 + entries.length * 12 + 4;
  let cursor = ifdOffset + ifdBytes;
  const bitsOffset = cursor;
  cursor += samples * 2;
  if (cursor % 2) cursor += 1;
  const stripOffsetsMeta = stripCount > 1 ? cursor : null;
  if (stripOffsetsMeta !== null) cursor += stripCount * 4;
  const stripCountsMeta = stripCount > 1 ? cursor : null;
  if (stripCountsMeta !== null) cursor += stripCount * 4;
  const pixelOffset = cursor;
  const rowBytes = width * samples;
  const totalPixelBytes = rowBytes * height;
  const buffer = Buffer.alloc(pixelOffset + totalPixelBytes, 0);
  buffer.write(order, 0, 2, "ascii");
  write16(buffer, 2, 42);
  write32(buffer, 4, ifdOffset);
  write16(buffer, ifdOffset, entries.length);

  const stripOffsets = [];
  const stripCounts = [];
  let y = 0;
  let stripPixelOffset = pixelOffset;
  while (y < height) {
    const rows = Math.min(rowsPerStrip, height - y);
    stripOffsets.push(stripPixelOffset);
    stripCounts.push(rows * rowBytes);
    stripPixelOffset += rows * rowBytes;
    y += rows;
  }

  const inlineValue = (offset, type, value) => {
    if (type === TYPE_SHORT) write16(buffer, offset, value);
    else write32(buffer, offset, value);
  };
  entries.forEach(([tag, type, count, direct], index) => {
    const o = ifdOffset + 2 + index * 12;
    write16(buffer, o, tag); write16(buffer, o + 2, type); write32(buffer, o + 4, count);
    if (tag === 258) write32(buffer, o + 8, bitsOffset);
    else if (tag === 273) {
      if (stripCount === 1) write32(buffer, o + 8, stripOffsets[0]);
      else write32(buffer, o + 8, stripOffsetsMeta);
    } else if (tag === 279) {
      if (stripCount === 1) write32(buffer, o + 8, stripCounts[0]);
      else write32(buffer, o + 8, stripCountsMeta);
    } else inlineValue(o + 8, type, direct);
  });
  write32(buffer, ifdOffset + 2 + entries.length * 12, 0);
  for (let i = 0; i < samples; i += 1) write16(buffer, bitsOffset + i * 2, 8);
  if (stripCount > 1) {
    stripOffsets.forEach((value, index) => write32(buffer, stripOffsetsMeta + index * 4, value));
    stripCounts.forEach((value, index) => write32(buffer, stripCountsMeta + index * 4, value));
  }

  let p = pixelOffset;
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const [r, g, b, a = 255] = pixel(px, py);
      buffer[p++] = r; buffer[p++] = g; buffer[p++] = b;
      if (samples === 4) buffer[p++] = a;
    }
  }
  return buffer;
};

const evidence = (id, timeMs) => ({ frameId: id, timeMs, evidenceRefs: [`AE_TIFF_${id}`] });

const targetTiff = (x0, y0, opts = {}) => makeTiff({ ...opts, pixel: (x, y) => {
  const dx = x - x0, dy = y - y0;
  if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
    const v = 50 + (dx + 1) * 50 + (dy + 1) * 13;
    return [v, v, v, 255];
  }
  return [10, 10, 10, 255];
}});

test("decodes big-endian uncompressed RGBA baseline TIFF", () => {
  const frame = decodeTiffGrayFrameV1(makeTiff({ width: 2, height: 2, samples: 4, pixel: (x, y) => {
    if (x === 0 && y === 0) return [255, 0, 0, 0];
    if (x === 1 && y === 0) return [0, 255, 0, 64];
    if (x === 0 && y === 1) return [0, 0, 255, 128];
    return [255, 255, 255, 255];
  }}), evidence("BE", 0));
  assert.equal(frame.width, 2); assert.equal(frame.height, 2);
  assert.deepEqual([...frame.data], [77, 149, 29, 255]);
});

test("decodes little-endian RGB multi-strip TIFF", () => {
  const frame = decodeTiffGrayFrameV1(makeTiff({ width: 3, height: 4, samples: 3, little: true, rowsPerStrip: 2, pixel: (x, y) => [x * 20, y * 30, 10] }), evidence("LE", 40));
  assert.equal(frame.data.length, 12);
  assert.equal(frame.timeMs, 40);
});

test("rejects unsupported TIFF compression", () => {
  const data = makeTiff({ pixel: () => [10, 10, 10, 255] });
  data.writeUInt16BE(5, 8 + 2 + 3 * 12 + 8);
  assert.throws(() => decodeTiffGrayFrameV1(data, evidence("COMP", 0)), /Compression/);
});

test("TIFF evidence feeds stable deterministic tracking", () => {
  const frames = [
    decodeTiffGrayFrameV1(targetTiff(5, 5), evidence("A", 0)),
    decodeTiffGrayFrameV1(targetTiff(7, 5), evidence("B", 40)),
    decodeTiffGrayFrameV1(targetTiff(9, 6), evidence("C", 80)),
  ];
  const result = trackPointV1(frames, {
    targetEntityId: "SUBJECT_TIFF",
    initialPoint: { x: 5 / 15, y: 5 / 11 },
    featureRadiusPx: 1,
    searchRadiusPx: 6,
    maxJumpPx: 5,
  });
  assert.equal(result.status, "STABLE");
  assert.ok(result.confidence >= 0.72);
  assert.deepEqual(result.evidenceRefs, ["AE_TIFF_A", "AE_TIFF_B", "AE_TIFF_C"]);
});

test("fails closed on bounded dimensions", () => {
  const data = makeTiff({ width: 8, height: 8, pixel: () => [0, 0, 0, 255] });
  assert.throws(() => decodeTiffGrayFrameV1(data, evidence("BOUND", 0), {
    maxWidth: 4, maxHeight: 16, maxPixels: 256, maxBytes: 100000, maxIfdEntries: 64, maxStrips: 64,
  }), /width/);
});
