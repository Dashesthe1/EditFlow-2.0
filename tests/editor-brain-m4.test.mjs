import test from "node:test";
import assert from "node:assert/strict";
import { EditorBrainV1 } from "../.tmp/runtime/packages/editor-brain/src/m4.js";

const comp = { stableId: "COMP_M4" };
const layer = { stableId: "LAYER_M4" };
const style = {
  profileId: "STYLE_M4",
  name: "M4 Object Aware",
  techniqueBias: { HOLD: 0.1, REFRAME: 0.2, IMPACT_PULSE: 0.95, FADE_PULSE: 0.1 },
  preferredImpactIntensity: 0.8,
  minimumReadability: 0.55,
  evidenceIds: ["REF_M4"],
};

const subject = (overrides = {}) => ({
  semanticId: "SUBJECT_HERO_01",
  x: 0.5,
  y: 0.5,
  scale: 0.45,
  velocityX: 0.8,
  velocityY: 0.1,
  accelerationX: 0.1,
  accelerationY: 0,
  trackConfidence: 0.94,
  driftRisk: 0.05,
  occlusion: 0.05,
  framingQuality: 0.9,
  isolationAvailable: true,
  evidenceIds: ["TRACK_M4_01"],
  ...overrides,
});
const state = (overrides = {}) => ({
  comp,
  layer,
  style,
  desiredEnergy: 0.92,
  readability: 0.9,
  dialogueImportance: 0.05,
  transitionPressure: 0.8,
  beatStrength: "STRONG",
  beatEtaMs: 60,
  shotAgeMs: 800,
  subject: subject(),
  ...overrides,
});

test("tracked subject motion becomes the editor motion model", () => {
  const decision = new EditorBrainV1().decide(state());
  assert.equal(decision.route, "LOCAL");
  assert.equal(decision.subjectId, "SUBJECT_HERO_01");
  assert.equal(decision.technique, "IMPACT_PULSE");
  assert.equal(decision.program.direction, "RIGHT");
  assert.ok(decision.rationaleCodes.includes("TRACKED_SUBJECT_BOUND"));
  assert.ok(decision.rationaleCodes.includes("TRACKED_SUBJECT_HIGH_MOTION"));
  assert.ok(decision.evidenceIds.includes("TRACK_M4_01"));
});

test("tracked edge risk can drive a known subject reframe", () => {
  const target = { position: [960, 540, 0], scale: [105, 105, 100] };
  const decision = new EditorBrainV1().decide(state({
    style: { ...style, techniqueBias: { HOLD: 0.05, REFRAME: 1, IMPACT_PULSE: 0.05, FADE_PULSE: 0.05 } },
    subject: subject({ x: 0.92, velocityX: 0.05, velocityY: 0 }),
    reframeTarget: target,
    desiredEnergy: 0.2,
    transitionPressure: 0.05,
    beatStrength: "NONE",
    beatEtaMs: null,
  }));
  assert.equal(decision.route, "LOCAL");
  assert.equal(decision.technique, "REFRAME");
  assert.deepEqual(decision.program.target, target);
  assert.ok(decision.objectRationaleCodes.includes("TRACKED_SUBJECT_EDGE_RISK"));
});

test("low confidence tracking fails closed", () => {
  const decision = new EditorBrainV1().decide(state({ subject: subject({ trackConfidence: 0.4 }) }));
  assert.equal(decision.route, "ESCALATE");
  assert.equal(decision.escalationReason, "TRACK_CONFIDENCE_LOW");
});

test("drifting tracking fails closed", () => {
  const decision = new EditorBrainV1().decide(state({ subject: subject({ driftRisk: 0.7 }) }));
  assert.equal(decision.route, "ESCALATE");
  assert.equal(decision.escalationReason, "TRACK_DRIFT_RISK_HIGH");
});

test("strong occlusion fails closed", () => {
  const decision = new EditorBrainV1().decide(state({ subject: subject({ occlusion: 0.95 }) }));
  assert.equal(decision.route, "ESCALATE");
  assert.equal(decision.escalationReason, "SUBJECT_OCCLUDED");
});
test("edge-risk subject without a reframe target escalates", () => {
  const decision = new EditorBrainV1().decide(state({
    subject: subject({ x: 0.94, velocityX: 0.1, velocityY: 0 }),
  }));
  assert.equal(decision.route, "ESCALATE");
  assert.equal(decision.escalationReason, "REFRAME_TARGET_REQUIRED");
});

test("invalid tracked subject state fails closed", () => {
  const decision = new EditorBrainV1().decide(state({ subject: subject({ x: 1.4 }) }));
  assert.equal(decision.route, "ESCALATE");
  assert.equal(decision.escalationReason, "SUBJECT_STATE_INVALID");
});

test("isolation availability is retained as decision evidence", () => {
  const decision = new EditorBrainV1().decide(state({
    subject: subject({ isolationAvailable: true, velocityX: 0.2, velocityY: 0.1 }),
  }));
  assert.ok(decision.objectRationaleCodes.includes("SUBJECT_ISOLATION_AVAILABLE"));
});
