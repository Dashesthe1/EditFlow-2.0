import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PNG } from "pngjs";

import { evaluateMotionLandmarkProofV1 } from "../scripts/proofs/motion-landmark-evaluator.mjs";

const WIDTH = 420;
const HEIGHT = 120;
const LEFT = { id: "left", rgb: [0, 255, 0], sourceX: 50 };
const RIGHT = { id: "right", rgb: [255, 0, 255], sourceX: 350 };
const MOVING = { id: "moving", rgb: [255, 128, 0] };
const DURATION = 5;

const drawSquare = (image, cx, cy, rgb) => {
  for (let y = Math.round(cy) - 3; y <= Math.round(cy) + 3; y += 1) {
    for (let x = Math.round(cx) - 3; x <= Math.round(cx) + 3; x += 1) {
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
      const offset = (y * image.width + x) * 4;
      image.data[offset] = rgb[0];
      image.data[offset + 1] = rgb[1];
      image.data[offset + 2] = rgb[2];
      image.data[offset + 3] = 255;
    }
  }
};

const sourceXFor = (sourceTime, startX, endX) =>
  startX + (endX - startX) * sourceTime / DURATION;

const writeFrame = async (path, { scale, translate, sourceX }) => {
  const image = new PNG({ width: WIDTH, height: HEIGHT });
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = 20;
    image.data[i + 1] = 20;
    image.data[i + 2] = 20;
    image.data[i + 3] = 255;
  }
  const screenX = (x) => translate + scale * x;
  drawSquare(image, screenX(LEFT.sourceX), 20, LEFT.rgb);
  drawSquare(image, screenX(RIGHT.sourceX), 20, RIGHT.rgb);
  drawSquare(image, screenX(sourceX), 55, MOVING.rgb);
  await writeFile(path, PNG.sync.write(image));
};

const buildFrames = async (dir, outgoingTimes, incomingTimes) => {
  const frames = [];
  const specs = [
    ...outgoingTimes.map(([timeMs, sourceTime]) => ({
      timeMs,
      sourceX: sourceXFor(sourceTime, 100, 300),
    })),
    ...incomingTimes.map(([timeMs, sourceTime]) => ({
      timeMs,
      sourceX: sourceXFor(sourceTime, 300, 100),
    })),
  ];
  for (const [index, spec] of specs.entries()) {
    const path = join(dir, "frame-" + spec.timeMs + ".png");
    await writeFrame(path, {
      scale: 0.85 + index * 0.025,
      translate: 4 + index * 0.5,
      sourceX: spec.sourceX,
    });
    frames.push({ timeMs: spec.timeMs, path });
  }
  return frames;
};

const evaluate = (frames) => evaluateMotionLandmarkProofV1({
  frames,
  referenceMarkers: [LEFT, RIGHT],
  movingMarker: MOVING,
  sourceDurationSeconds: DURATION,
  segments: [
    {
      id: "outgoing",
      startTimeMs: 0,
      endTimeMs: 300,
      sourceStartX: 100,
      sourceEndX: 300,
      expectedTrend: "ACCELERATE",
    },
    {
      id: "incoming",
      startTimeMs: 500,
      endTimeMs: 800,
      sourceStartX: 300,
      sourceEndX: 100,
      expectedTrend: "DECELERATE",
    },
  ],
  rules: {
    colorTolerance: 2,
    minMarkerPixels: 20,
    minPlaybackRate: 0.15,
    maxPlaybackRate: 2,
    minTrendRatio: 1.1,
    sourceTimeToleranceSeconds: 0.05,
  },
});

test("motion landmark evaluator removes camera scale/translation and verifies velocity trends", async () => {
  const dir = await mkdtemp(join(tmpdir(), "editflow-motion-good-"));
  try {
    const frames = await buildFrames(
      dir,
      [[0, 1.00], [100, 1.05], [200, 1.13], [300, 1.24]],
      [[500, 2.00], [600, 2.12], [700, 2.21], [800, 2.27]],
    );
    const result = await evaluate(frames);
    assert.equal(result.passed, true, result.issues.join(", "));
    assert.deepEqual(result.issues, []);
    assert.ok(result.segments[0].lastRate > result.segments[0].firstRate);
    assert.ok(result.segments[1].firstRate > result.segments[1].lastRate);
    assert.ok(result.observations.every((item) => item.referenceScale > 0));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("motion landmark evaluator rejects a source-time plateau even while camera motion continues", async () => {
  const dir = await mkdtemp(join(tmpdir(), "editflow-motion-freeze-"));
  try {
    const frames = await buildFrames(
      dir,
      [[0, 1.00], [100, 1.05], [200, 1.05], [300, 1.06]],
      [[500, 2.00], [600, 2.12], [700, 2.21], [800, 2.27]],
    );
    const result = await evaluate(frames);
    assert.equal(result.passed, false);
    assert.ok(result.issues.includes("MOTION_FREEZE_OR_REVERSAL:outgoing"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
