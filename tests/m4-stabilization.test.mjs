import test from "node:test";
import assert from "node:assert/strict";
import {
  M4_STABILIZATION_CAPABILITY_V1,
  trackerReadbackToStabilizationSolutionV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-stabilization.js";

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

const readback = (points) => ({
  comp: { stableId: "COMP", hostId: 10, name: "Proof", width: 1000, height: 1000 },
  layer: { stableId: "LAYER", hostId: 20, name: "Footage", index: 1 },
  trackers: [{ trackerIndex: 1, name: "Tracker 1", matchName: "ADBE MTracker", points }],
});

test("stabilization capability stays declared/read-only until a retained real-AE proof exists", () => {
  assert.equal(M4_STABILIZATION_CAPABILITY_V1.status, "PARTIAL");
  assert.equal(M4_STABILIZATION_CAPABILITY_V1.proofMaturity, "DECLARED");
  assert.equal(M4_STABILIZATION_CAPABILITY_V1.routes[0].available, true);
  assert.equal(M4_STABILIZATION_CAPABILITY_V1.riskClass, "R0_READ_ONLY");
  assert.ok(M4_STABILIZATION_CAPABILITY_V1.limitations.some((value) => value.includes("Runtime capability registration is intentionally withheld")));
});

test("position stabilization derives inverse composition-space translation from one native point", () => {
  const result = trackerReadbackToStabilizationSolutionV1(readback([
    point(1, [sample(0.5, [130, 160], 0.88), sample(0, [100, 200], 0.96)]),
  ]));
  assert.ok(result);
  assert.equal(result.referenceTime, 0);
  assert.deepEqual(result.components, { position: true, rotation: false, scale: false });
  assert.equal(result.secondaryPointIndex, null);
  assert.deepEqual(result.samples.map((item) => item.time), [0, 0.5]);
  assert.deepEqual(result.samples[0].counterTranslationCompPx, [0, 0]);
  assert.deepEqual(result.samples[1].counterTranslationCompPx, [-30, 40]);
  assert.equal(result.samples[1].confidence, 0.88);
  assert.deepEqual(result.samples[1].evidenceIds, ["AE_TRACKER:LAYER:1:1:0.5"]);
});

test("rotation and scale stabilization derive component-wise inverse two-point geometry", () => {
  const result = trackerReadbackToStabilizationSolutionV1(readback([
    point(1, [sample(0, [400, 400], 0.97), sample(0.5, [400, 400], 0.91)]),
    point(2, [sample(0, [600, 400], 0.95), sample(0.5, [400, 700], 0.86)]),
  ]), {
    stabilizePosition: true,
    stabilizeRotation: true,
    stabilizeScale: true,
  });
  assert.ok(result);
  assert.deepEqual(result.components, { position: true, rotation: true, scale: true });
  assert.equal(result.secondaryPointIndex, 2);
  assert.deepEqual(result.samples[1].counterTranslationCompPx, [0, 0]);
  assert.ok(Math.abs(result.samples[1].counterRotationDegrees - (-90)) < 1e-9);
  assert.ok(Math.abs(result.samples[1].scaleMultiplier - (2 / 3)) < 1e-9);
  assert.equal(result.samples[1].confidence, 0.86);
  assert.deepEqual(result.samples[1].evidenceIds, [
    "AE_TRACKER:LAYER:1:1:0.5",
    "AE_TRACKER:LAYER:1:2:0.5",
  ]);
});

test("referenceTime selects an exact microsecond-rounded tracked reference frame", () => {
  const result = trackerReadbackToStabilizationSolutionV1(readback([
    point(1, [
      sample(0, [100, 100]),
      sample(0.5, [125, 90]),
      sample(1, [150, 80]),
    ]),
  ]), { referenceTime: 0.5000002 });
  assert.ok(result);
  assert.equal(result.referenceTime, 0.5);
  assert.deepEqual(result.samples[0].counterTranslationCompPx, [25, -10]);
  assert.deepEqual(result.samples[1].counterTranslationCompPx, [0, 0]);
  assert.deepEqual(result.samples[2].counterTranslationCompPx, [-25, 10]);
});

test("rotation/scale stabilization requires distinct synchronized secondary samples", () => {
  const unsynchronized = trackerReadbackToStabilizationSolutionV1(readback([
    point(1, [sample(0, [100, 100]), sample(0.5, [120, 100])]),
    point(2, [sample(0.25, [200, 100]), sample(0.75, [220, 100])]),
  ]), { stabilizeRotation: true });
  assert.equal(unsynchronized, null);

  const samePoint = trackerReadbackToStabilizationSolutionV1(readback([
    point(1, [sample(0, [100, 100]), sample(0.5, [120, 100])]),
  ]), { secondaryPointIndex: 1, stabilizeScale: true });
  assert.equal(samePoint, null);
});

test("position-only stabilization does not require a secondary point", () => {
  const result = trackerReadbackToStabilizationSolutionV1(readback([
    point(1, [sample(0, [10, 20]), sample(1, [15, 25])]),
  ]), { secondaryPointIndex: 99 });
  assert.ok(result);
  assert.deepEqual(result.samples[1].counterTranslationCompPx, [-5, -5]);
});

test("degenerate two-point geometry and empty component requests fail closed", () => {
  const degenerateReference = trackerReadbackToStabilizationSolutionV1(readback([
    point(1, [sample(0, [300, 300]), sample(0.5, [320, 300])]),
    point(2, [sample(0, [300, 300]), sample(0.5, [420, 300])]),
  ]), { stabilizeScale: true });
  assert.equal(degenerateReference, null);

  const degenerateCurrent = trackerReadbackToStabilizationSolutionV1(readback([
    point(1, [sample(0, [300, 300]), sample(0.5, [320, 300])]),
    point(2, [sample(0, [400, 300]), sample(0.5, [320, 300])]),
  ]), { stabilizeRotation: true });
  assert.equal(degenerateCurrent, null);

  const noComponents = trackerReadbackToStabilizationSolutionV1(readback([
    point(1, [sample(0, [100, 100]), sample(0.5, [120, 100])]),
  ]), {
    stabilizePosition: false,
    stabilizeRotation: false,
    stabilizeScale: false,
  });
  assert.equal(noComponents, null);
});

test("missing requested reference frame fails closed", () => {
  const result = trackerReadbackToStabilizationSolutionV1(readback([
    point(1, [sample(0, [100, 100]), sample(0.5, [120, 100])]),
  ]), { referenceTime: 0.25 });
  assert.equal(result, null);
});

test("rotation inverse unwraps safely across the minus/plus 180 degree boundary", () => {
  const radians = (degrees) => degrees * Math.PI / 180;
  const p = (degrees) => [500 + Math.cos(radians(degrees)) * 100, 500 + Math.sin(radians(degrees)) * 100];
  const result = trackerReadbackToStabilizationSolutionV1(readback([
    point(1, [sample(0, [500, 500]), sample(0.5, [500, 500])]),
    point(2, [sample(0, p(170)), sample(0.5, p(-170))]),
  ]), { stabilizeRotation: true });
  assert.ok(result);
  assert.ok(Math.abs(result.samples[1].counterRotationDegrees - (-20)) < 1e-9);
});
