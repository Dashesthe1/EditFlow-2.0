import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  M4_TWO_POINT_TRACKING_CAPABILITY_V1,
  twoPointTrackerReadbackToTransformTrackV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-two-point-tracking.js";

const sample = (time, compPoint, confidence = 0.95) => ({
  time,
  featureCenter: compPoint,
  featureSize: [40, 40],
  searchOffset: [0, 0],
  searchSize: [100, 100],
  confidence,
  attachPoint: compPoint,
  attachPointOffset: [0, 0],
  compPoint,
  compNormalized: compPoint ? [compPoint[0] / 1000, compPoint[1] / 1000] : null,
});

const point = (pointIndex, samples) => ({
  pointIndex,
  name: `Track Point ${pointIndex}`,
  matchName: "ADBE MTracker Pt",
  keyedSampleCount: samples.length,
  samples,
});
const readback = (points, overrides = {}) => ({
  comp: { stableId: "COMP", hostId: 10, name: "Proof", width: 1000, height: 1000 },
  layer: { stableId: "LAYER", hostId: 20, name: "Footage", index: 1 },
  trackers: [{ trackerIndex: 1, name: "Tracker 1", matchName: "ADBE MTracker", points }],
  ...overrides,
});

test("two-point capability is structurally promoted only after retained real-AE proof", () => {
  assert.equal(M4_TWO_POINT_TRACKING_CAPABILITY_V1.status, "PARTIAL");
  assert.equal(M4_TWO_POINT_TRACKING_CAPABILITY_V1.proofMaturity, "STRUCTURAL");
  assert.equal(M4_TWO_POINT_TRACKING_CAPABILITY_V1.routes[0].available, true);
  assert.equal(M4_TWO_POINT_TRACKING_CAPABILITY_V1.riskClass, "R0_READ_ONLY");
});

test("two native points derive center, scale ratio, and rotation delta", () => {
  const result = twoPointTrackerReadbackToTransformTrackV1(readback([
    point(1, [sample(0, [400, 400], 0.96), sample(0.5, [500, 300], 0.91)]),
    point(2, [sample(0, [600, 400], 0.94), sample(0.5, [500, 600], 0.88)]),
  ]));
  assert.ok(result);
  assert.equal(result.samples.length, 2);
  assert.ok(Math.abs(result.baselineDistancePx - 200) < 1e-9);
  assert.ok(Math.abs(result.samples[0].scaleRatio - 1) < 1e-9);
  assert.ok(Math.abs(result.samples[1].scaleRatio - 1.5) < 1e-9);
  assert.ok(Math.abs(result.samples[1].rotationDeltaDegrees - 90) < 1e-9);
  assert.deepEqual(result.samples[1].centerNormalized, [0.5, 0.45]);
  assert.equal(result.samples[1].confidence, 0.88);
});
test("two-point derivation requires synchronized keyed samples from distinct points", () => {
  const unsynchronized = twoPointTrackerReadbackToTransformTrackV1(readback([
    point(1, [sample(0, [100, 100]), sample(0.5, [120, 100])]),
    point(2, [sample(0.25, [200, 100]), sample(0.75, [220, 100])]),
  ]));
  assert.equal(unsynchronized, null);
  const samePoint = twoPointTrackerReadbackToTransformTrackV1(readback([
    point(1, [sample(0, [100, 100]), sample(0.5, [120, 100])]),
  ]), 1, 1, 1);
  assert.equal(samePoint, null);
});

test("degenerate baseline geometry fails closed", () => {
  const result = twoPointTrackerReadbackToTransformTrackV1(readback([
    point(1, [sample(0, [300, 300]), sample(0.5, [320, 300])]),
    point(2, [sample(0, [300, 300]), sample(0.5, [420, 300])]),
  ]));
  assert.equal(result, null);
});

test("rotation delta unwraps across the minus/plus 180 degree boundary", () => {
  const radians = (degrees) => degrees * Math.PI / 180;
  const p = (degrees) => [500 + Math.cos(radians(degrees)) * 100, 500 + Math.sin(radians(degrees)) * 100];
  const result = twoPointTrackerReadbackToTransformTrackV1(readback([
    point(1, [sample(0, [500, 500]), sample(0.5, [500, 500])]),
    point(2, [sample(0, p(170)), sample(0.5, p(-170))]),
  ]));
  assert.ok(result);
  assert.ok(Math.abs(result.samples[1].rotationDeltaDegrees - 20) < 1e-9);
});


test("real-AE two-point proof is reversible and never saves or closes the user project", async () => {
  const source = await readFile("scripts/windows/m4-two-point-tracking-v1-live-proof.jsx", "utf8");
  assert.ok(source.includes('app.beginUndoGroup("EditFlow M4 two-point tracking live proof")'));
  assert.ok((source.match(/tracker\.addProperty\("ADBE MTracker Pt"\)/g) ?? []).length >= 2);
  assert.ok(source.includes("app.executeCommand(16)"));
  assert.ok(source.includes("nativeScaleGeometry"));
  assert.ok(source.includes("nativeRotationGeometry"));
  assert.equal(source.includes("app.project.save"), false);
  assert.equal(source.includes("app.project.close"), false);
});
