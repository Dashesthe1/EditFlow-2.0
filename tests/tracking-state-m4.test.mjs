import test from "node:test";
import assert from "node:assert/strict";
import { TrackingStateReducerV1 } from "../.tmp/runtime/packages/tracking-state/src/index.js";
import { EditorBrainV1 } from "../.tmp/runtime/packages/editor-brain/src/m4.js";

const observation = (overrides = {}) => ({
  semanticId: "SUBJECT_01",
  timestampMs: 1000,
  x: 0.4,
  y: 0.5,
  scale: 0.45,
  confidence: 0.95,
  residualError: 0.03,
  occlusion: 0.05,
  isolationAvailable: true,
  evidenceIds: ["OBS_01"],
  ...overrides,
});

const style = {
  profileId: "STYLE_TRACK",
  name: "Tracking Integration",
  techniqueBias: { HOLD: 0.1, REFRAME: 0.1, IMPACT_PULSE: 0.95, FADE_PULSE: 0.1 },
  preferredImpactIntensity: 0.8,
  minimumReadability: 0.55,
  evidenceIds: ["STYLE_EVIDENCE"],
};
test("tracking reducer derives motion and framing from timestamped observations", () => {
  const reducer = new TrackingStateReducerV1();
  const first = reducer.update(observation());
  const second = reducer.update(observation({
    timestampMs: 1100,
    x: 0.48,
    evidenceIds: ["OBS_02"],
  }));
  assert.equal(first.velocityX, 0);
  assert.ok(second.velocityX > 0.79 && second.velocityX < 0.81);
  assert.equal(second.velocityY, 0);
  assert.ok(second.framingQuality > first.framingQuality);
  assert.deepEqual(second.evidenceIds, ["OBS_02"]);
});

test("residual error and confidence loss raise drift risk", () => {
  const reducer = new TrackingStateReducerV1();
  reducer.update(observation());
  const good = reducer.update(observation({ timestampMs: 1100, x: 0.41 }));
  reducer.reset();
  reducer.update(observation());
  const poor = reducer.update(observation({
    timestampMs: 1100,
    x: 0.41,
    confidence: 0.65,
    residualError: 0.7,
  }));
  assert.ok(poor.driftRisk > good.driftRisk);
  assert.ok(poor.driftRisk > 0.35);
});
test("non-monotonic observations are rejected without corrupting state", () => {
  const reducer = new TrackingStateReducerV1();
  reducer.update(observation());
  assert.equal(reducer.update(observation({ timestampMs: 900 })), null);
  const next = reducer.update(observation({ timestampMs: 1100, x: 0.5 }));
  assert.ok(next.velocityX > 0.99 && next.velocityX < 1.01);
});

test("tracking estimate feeds Editor Brain v1 without coordinate hand wiring", () => {
  const reducer = new TrackingStateReducerV1();
  reducer.update(observation());
  const subject = reducer.update(observation({ timestampMs: 1100, x: 0.48 }));
  const decision = new EditorBrainV1().decide({
    comp: { stableId: "COMP" },
    layer: { stableId: "LAYER" },
    style,
    desiredEnergy: 0.92,
    readability: 0.9,
    dialogueImportance: 0.05,
    transitionPressure: 0.8,
    beatStrength: "STRONG",
    beatEtaMs: 50,
    shotAgeMs: 900,
    subject,
  });
  assert.equal(decision.route, "LOCAL");
  assert.equal(decision.program.kind, "IMPACT_PULSE");
  assert.equal(decision.program.direction, "RIGHT");
  assert.equal(decision.subjectId, "SUBJECT_01");
});
