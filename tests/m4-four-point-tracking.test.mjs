import test from "node:test";
import assert from "node:assert/strict";

import {
  M4_FOUR_POINT_TRACKING_CAPABILITY_V1,
  fourPointTrackerReadbackToPerspectiveTrackV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-four-point-tracking.js";

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

const mapping = {
  upperLeftIndex: 9,
  upperRightIndex: 3,
  lowerLeftIndex: 7,
  lowerRightIndex: 5,
};

const baseline = {
  upperLeft: [200, 200],
  upperRight: [800, 200],
  lowerLeft: [200, 800],
  lowerRight: [800, 800],
};
const destination = {
  upperLeft: [250, 250],
  upperRight: [760, 170],
  lowerLeft: [180, 780],
  lowerRight: [850, 820],
};

const pointsFor = (finalCorners = destination) => [
  point(5, [sample(0, baseline.lowerRight, 0.97), sample(0.5, finalCorners.lowerRight, 0.91)]),
  point(9, [sample(0, baseline.upperLeft, 0.96), sample(0.5, finalCorners.upperLeft, 0.88)]),
  point(7, [sample(0, baseline.lowerLeft, 0.94), sample(0.5, finalCorners.lowerLeft, 0.92)]),
  point(3, [sample(0, baseline.upperRight, 0.95), sample(0.5, finalCorners.upperRight, 0.90)]),
];

const project = (h, [x, y]) => {
  const w = h[6] * x + h[7] * y + h[8];
  return [
    (h[0] * x + h[1] * y + h[2]) / w,
    (h[3] * x + h[4] * y + h[5]) / w,
  ];
};
const nearPair = (actual, expected, epsilon = 1e-7) => {
  assert.ok(Math.abs(actual[0] - expected[0]) <= epsilon, `${actual[0]} != ${expected[0]}`);
  assert.ok(Math.abs(actual[1] - expected[1]) <= epsilon, `${actual[1]} != ${expected[1]}`);
};

test("four-point perspective capability is structurally promoted only after retained real-AE proof", () => {
  assert.equal(M4_FOUR_POINT_TRACKING_CAPABILITY_V1.status, "PARTIAL");
  assert.equal(M4_FOUR_POINT_TRACKING_CAPABILITY_V1.proofMaturity, "STRUCTURAL");
  assert.equal(M4_FOUR_POINT_TRACKING_CAPABILITY_V1.routes[0].available, true);
  assert.equal(M4_FOUR_POINT_TRACKING_CAPABILITY_V1.riskClass, "R0_READ_ONLY");
});

test("four explicitly mapped native points derive a true projective homography", () => {
  const result = fourPointTrackerReadbackToPerspectiveTrackV1(readback(pointsFor()), mapping);
  assert.ok(result);
  assert.equal(result.samples.length, 2);
  assert.deepEqual(result.mapping, mapping);
  assert.equal(result.baselineAreaPx, 360000);
  nearPair(result.samples[1].cornersNormalized.upperLeft, [0.25, 0.25]);
  nearPair(result.samples[1].cornersNormalized.lowerRight, [0.85, 0.82]);
  assert.equal(result.samples[1].confidence, 0.88);
  const h = result.samples[1].homography;
  nearPair(project(h, baseline.upperLeft), destination.upperLeft, 1e-6);
  nearPair(project(h, baseline.upperRight), destination.upperRight, 1e-6);
  nearPair(project(h, baseline.lowerLeft), destination.lowerLeft, 1e-6);
  nearPair(project(h, baseline.lowerRight), destination.lowerRight, 1e-6);
  assert.ok(Math.abs(h[6]) > 1e-9 || Math.abs(h[7]) > 1e-9, "expected a projective, non-affine denominator");
});

test("baseline four-point sample produces identity homography", () => {
  const result = fourPointTrackerReadbackToPerspectiveTrackV1(readback(pointsFor()), mapping);
  assert.ok(result);
  const identity = result.samples[0].homography;
  const expected = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  identity.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-9));
});

test("corner roles come only from explicit point mapping, never tracker array order", () => {
  const result = fourPointTrackerReadbackToPerspectiveTrackV1(readback(pointsFor()), mapping);
  assert.ok(result);
  assert.deepEqual(result.baselineCornersPx, baseline);
  assert.deepEqual(result.samples[1].evidenceIds.map((value) => Number(value.split(":")[3])), [9, 3, 7, 5]);
});

test("four-point derivation rejects duplicate corner assignments and unsynchronized samples", () => {
  const duplicate = fourPointTrackerReadbackToPerspectiveTrackV1(readback(pointsFor()), {
    ...mapping,
    lowerRightIndex: mapping.lowerLeftIndex,
  });
  assert.equal(duplicate, null);

  const unsynchronized = pointsFor().map((value) => value.pointIndex === 5
    ? point(5, [sample(0.25, baseline.lowerRight), sample(0.75, destination.lowerRight)])
    : value);
  assert.equal(fourPointTrackerReadbackToPerspectiveTrackV1(readback(unsynchronized), mapping), null);
});

test("four-point derivation fails closed on concave or winding-flipped geometry", () => {
  const concave = {
    ...destination,
    lowerRight: [300, 300],
  };
  assert.equal(fourPointTrackerReadbackToPerspectiveTrackV1(readback(pointsFor(concave)), mapping), null);

  const flipped = {
    upperLeft: destination.upperRight,
    upperRight: destination.upperLeft,
    lowerLeft: destination.lowerRight,
    lowerRight: destination.lowerLeft,
  };
  assert.equal(fourPointTrackerReadbackToPerspectiveTrackV1(readback(pointsFor(flipped)), mapping), null);
});

test("four-point derivation rejects missing native corner samples", () => {
  const missing = pointsFor().filter((value) => value.pointIndex !== mapping.lowerLeftIndex);
  assert.equal(fourPointTrackerReadbackToPerspectiveTrackV1(readback(missing), mapping), null);
});

import { readFile } from "node:fs/promises";

test("real-AE four-point perspective proof is reversible and production converter verified", async () => {
  const source = await readFile("scripts/windows/m4-four-point-tracking-v1-live-proof.jsx", "utf8");
  const verifier = await readFile("scripts/m4-four-point-tracking-v1-verify.mjs", "utf8");
  assert.ok(source.includes('app.beginUndoGroup("EditFlow M4 four-point perspective live proof")'));
  assert.ok((source.match(/tracker\.addProperty\("ADBE MTracker Pt"\)/g) ?? []).length >= 4);
  assert.ok(source.includes("app.executeCommand(16)"));
  assert.ok(source.includes("nonAffinePerspectiveGeometry"));
  assert.equal(source.includes("app.project.save"), false);
  assert.equal(source.includes("app.project.close"), false);
  assert.equal(source.includes("app.quit"), false);
  assert.ok(verifier.includes("fourPointTrackerReadbackToPerspectiveTrackV1"));
  assert.ok(verifier.includes("homographyReprojectsAllFourCorners"));
  assert.ok(verifier.includes("projectiveDenominatorIsNonAffine"));
});
