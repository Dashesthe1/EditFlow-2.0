import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPointTrackToEditorSubjectV1,
  trackPointV1,
} from "../.tmp/runtime/packages/point-tracker/src/index.js";

const WIDTH = 32;
const HEIGHT = 24;
const TARGET_RADIUS = 2;

const drawTarget = (data, cx, cy) => {
  for (let dy = -TARGET_RADIUS; dy <= TARGET_RADIUS; dy += 1) {
    for (let dx = -TARGET_RADIUS; dx <= TARGET_RADIUS; dx += 1) {
      const x = cx + dx;
      const y = cy + dy;
      data[y * WIDTH + x] = 55 + (dx + TARGET_RADIUS) * 31 + (dy + TARGET_RADIUS) * 7;
    }
  }
};

const frame = (frameId, timeMs, targets = []) => {
  const data = new Uint8Array(WIDTH * HEIGHT);
  data.fill(12);
  for (const [x, y] of targets) drawTarget(data, x, y);
  return {
    frameId,
    width: WIDTH,
    height: HEIGHT,
    data,
    timeMs,
    evidenceRefs: [`PIX_${frameId}`],
  };
};

const normalized = (x, y) => ({ x: x / (WIDTH - 1), y: y / (HEIGHT - 1) });

const request = (overrides = {}) => ({
  targetEntityId: "SUBJECT_1",
  initialPoint: normalized(10, 10),
  featureRadiusPx: TARGET_RADIUS,
  searchRadiusPx: 10,
  maxJumpPx: 5,
  maxRoundTripErrorPx: 2,
  maxNormalizedError: 0.3,
  minStableConfidence: 0.72,
  minUniqueness: 0.12,
  ...overrides,
});

test("tracks a unique persistent feature across a short trajectory", () => {
  const result = trackPointV1([
    frame("A", 0, [[10, 10]]),
    frame("B", 40, [[12, 10]]),
    frame("C", 80, [[14, 11]]),
    frame("D", 120, [[16, 12]]),
  ], request());

  assert.equal(result.targetEntityId, "SUBJECT_1");
  assert.equal(result.status, "STABLE");
  assert.ok(result.confidence >= 0.72);
  assert.equal(result.samples.length, 4);
  assert.deepEqual(result.samples.map((sample) => sample.status), ["STABLE", "STABLE", "STABLE", "STABLE"]);
  const last = result.samples.at(-1);
  assert.ok(last);
  assert.ok(Math.abs(last.point.x - normalized(16, 12).x) < 1e-9);
  assert.ok(Math.abs(last.point.y - normalized(16, 12).y) < 1e-9);
  assert.deepEqual(result.evidenceRefs, ["PIX_A", "PIX_B", "PIX_C", "PIX_D"]);
});

test("marks an ambiguous duplicate feature AT_RISK instead of pretending certainty", () => {
  const result = trackPointV1([
    frame("A", 0, [[10, 10]]),
    frame("B", 40, [[13, 10], [18, 10]]),
  ], request());

  assert.equal(result.status, "AT_RISK");
  const last = result.samples.at(-1);
  assert.ok(last);
  assert.equal(last.status, "AT_RISK");
  assert.ok(last.uniqueness < 0.12);
});

test("marks a large target jump DRIFTING even when the appearance match is exact", () => {
  const result = trackPointV1([
    frame("A", 0, [[10, 10]]),
    frame("B", 40, [[18, 10]]),
  ], request({ maxJumpPx: 5 }));

  assert.equal(result.status, "DRIFTING");
  const last = result.samples.at(-1);
  assert.ok(last);
  assert.equal(last.status, "DRIFTING");
  assert.ok(last.jumpPx > 5);
});

test("marks target disappearance LOST", () => {
  const result = trackPointV1([
    frame("A", 0, [[10, 10]]),
    frame("B", 40, []),
  ], request());

  assert.equal(result.status, "LOST");
  const last = result.samples.at(-1);
  assert.ok(last);
  assert.equal(last.status, "LOST");
});

test("semantic readback updates persistent subject motion and track confidence", () => {
  const result = trackPointV1([
    frame("A", 0, [[10, 10]]),
    frame("B", 100, [[12, 10]]),
    frame("C", 200, [[15, 10]]),
  ], request());

  const subject = {
    entityId: "SUBJECT_1",
    label: "Hero",
    center: normalized(10, 10),
    box: { left: 0.2, top: 0.2, right: 0.6, bottom: 0.8 },
    scale: 0.2,
    speed: 0,
    acceleration: 0,
    motionDirection: "STILL",
    observationConfidence: 0.95,
    identityConfidence: 0.94,
    geometryConfidence: 0.93,
    trackConfidence: 0,
    occlusionConfidence: 0.7,
    trackStatus: "NOT_TRACKED",
    isolationStatus: "NOT_NEEDED",
    occludedFraction: 0,
    foregroundOccluderEntityId: null,
    framingQuality: 0.9,
    attachPoints: [],
    evidenceRefs: ["OBS_INITIAL"],
    observedAtMs: 0,
  };

  const updated = applyPointTrackToEditorSubjectV1(subject, result);
  assert.equal(updated.entityId, "SUBJECT_1");
  assert.equal(updated.trackStatus, "STABLE");
  assert.equal(updated.trackConfidence, result.confidence);
  assert.equal(updated.motionDirection, "RIGHT");
  assert.ok(updated.speed > 0);
  assert.ok(updated.acceleration > 0);
  assert.equal(updated.observedAtMs, 200);
  assert.deepEqual(updated.evidenceRefs, ["OBS_INITIAL", "PIX_A", "PIX_B", "PIX_C"]);
});

test("semantic readback refuses a track bound to a different entity", () => {
  const result = trackPointV1([
    frame("A", 0, [[10, 10]]),
    frame("B", 40, [[11, 10]]),
  ], request({ targetEntityId: "OTHER_SUBJECT" }));

  assert.throws(() => applyPointTrackToEditorSubjectV1({
    entityId: "SUBJECT_1",
    center: normalized(10, 10),
    box: { left: 0.2, top: 0.2, right: 0.6, bottom: 0.8 },
    scale: 0.2,
    speed: 0,
    acceleration: 0,
    motionDirection: "STILL",
    observationConfidence: 0.95,
    identityConfidence: 0.94,
    geometryConfidence: 0.93,
    trackConfidence: 0,
    occlusionConfidence: 0.7,
    trackStatus: "NOT_TRACKED",
    isolationStatus: "NOT_NEEDED",
    occludedFraction: 0,
    framingQuality: 0.9,
    attachPoints: [],
    evidenceRefs: [],
    observedAtMs: 0,
  }, result), /does not match subject/);
});

test("invalid frame evidence fails before tracking", () => {
  const bad = frame("BAD", 40, [[11, 10]]);
  bad.data = new Uint8Array(5);
  assert.throws(() => trackPointV1([
    frame("A", 0, [[10, 10]]),
    bad,
  ], request()), /width \* height/);
});
