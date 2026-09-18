import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeBmpGrayFrameV1,
} from "../.tmp/runtime/packages/point-tracker/src/bmp.js";
import { trackPointV1 } from "../.tmp/runtime/packages/point-tracker/src/index.js";

const createBmp = (width, height, pixel, { topDown = false, bitDepth = 24, compression = 0 } = {}) => {
  const bytesPerPixel = bitDepth / 8;
  const rowStride = Math.floor((width * bytesPerPixel + 3) / 4) * 4;
  const pixelBytes = rowStride * height;
  const buffer = Buffer.alloc(54 + pixelBytes, 0);
  buffer.write("BM", 0, 2, "ascii");
  buffer.writeUInt32LE(buffer.length, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(topDown ? -height : height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(bitDepth, 28);
  buffer.writeUInt32LE(compression, 30);
  buffer.writeUInt32LE(pixelBytes, 34);

  for (let y = 0; y < height; y += 1) {
    const storedY = topDown ? y : height - 1 - y;
    const rowOffset = 54 + storedY * rowStride;
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue, alpha = 255] = pixel(x, y);
      const offset = rowOffset + x * bytesPerPixel;
      buffer[offset] = blue;
      buffer[offset + 1] = green;
      buffer[offset + 2] = red;
      if (bytesPerPixel === 4) buffer[offset + 3] = alpha;
    }
  }
  return buffer;
};

const evidence = (frameId, timeMs) => ({ frameId, timeMs, evidenceRefs: [`AE_RENDER_${frameId}`] });

const targetBmp = (targetX, targetY, options = {}) => createBmp(32, 24, (x, y) => {
  const dx = x - targetX;
  const dy = y - targetY;
  if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) {
    const value = 45 + (dx + 2) * 32 + (dy + 2) * 7;
    return [value, value, value];
  }
  return [12, 12, 12];
}, options);

test("decodes bottom-up 24-bit BMP into top-down deterministic luminance", () => {
  const bmp = createBmp(2, 2, (x, y) => {
    if (x === 0 && y === 0) return [255, 0, 0];
    if (x === 1 && y === 0) return [0, 255, 0];
    if (x === 0 && y === 1) return [0, 0, 255];
    return [255, 255, 255];
  });
  const frame = decodeBmpGrayFrameV1(bmp, evidence("BOTTOM", 0));
  assert.equal(frame.width, 2);
  assert.equal(frame.height, 2);
  assert.deepEqual([...frame.data], [77, 149, 29, 255]);
  assert.deepEqual(frame.evidenceRefs, ["AE_RENDER_BOTTOM"]);
});

test("decodes top-down 32-bit BMP without depending on alpha", () => {
  const bmp = createBmp(2, 2, (x, y) => [x * 100, y * 80, 20, 0], { topDown: true, bitDepth: 32 });
  const frame = decodeBmpGrayFrameV1(bmp, evidence("TOP", 40));
  assert.deepEqual([...frame.data], [2, 32, 49, 79]);
  assert.equal(frame.timeMs, 40);
});

test("fails closed on compressed BMP", () => {
  const bmp = createBmp(2, 2, () => [0, 0, 0], { compression: 1 });
  assert.throws(() => decodeBmpGrayFrameV1(bmp, evidence("COMPRESSED", 0)), /Unsupported BMP compression/);
});

test("fails before large pixel allocation when configured bounds are exceeded", () => {
  const bmp = createBmp(4, 4, () => [0, 0, 0]);
  assert.throws(() => decodeBmpGrayFrameV1(bmp, evidence("BOUNDED", 0), {
    maxWidth: 3,
    maxHeight: 8,
    maxPixels: 64,
    maxBytes: 4096,
  }), /BMP width/);
});

test("AE-style BMP frame evidence feeds the deterministic point tracker", () => {
  const frames = [
    decodeBmpGrayFrameV1(targetBmp(10, 10), evidence("A", 0)),
    decodeBmpGrayFrameV1(targetBmp(12, 10), evidence("B", 40)),
    decodeBmpGrayFrameV1(targetBmp(14, 11), evidence("C", 80)),
  ];
  const result = trackPointV1(frames, {
    targetEntityId: "SUBJECT_AE",
    initialPoint: { x: 10 / 31, y: 10 / 23 },
    featureRadiusPx: 2,
    searchRadiusPx: 8,
    maxJumpPx: 5,
  });
  assert.equal(result.status, "STABLE");
  assert.ok(result.confidence >= 0.72);
  assert.deepEqual(result.evidenceRefs, ["AE_RENDER_A", "AE_RENDER_B", "AE_RENDER_C"]);
  const last = result.samples.at(-1);
  assert.ok(last);
  assert.ok(Math.abs(last.point.x - 14 / 31) < 1e-9);
  assert.ok(Math.abs(last.point.y - 11 / 23) < 1e-9);
});

test("rejects truncated pixel payloads", () => {
  const bmp = targetBmp(10, 10).subarray(0, 80);
  assert.throws(() => decodeBmpGrayFrameV1(bmp, evidence("TRUNCATED", 0)), /pixel data extends beyond supplied bytes|declared file size extends beyond supplied bytes/);
});
