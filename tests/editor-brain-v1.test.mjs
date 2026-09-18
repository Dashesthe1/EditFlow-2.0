import test from "node:test";
import assert from "node:assert/strict";
import { EditorBrainV0 } from "../.tmp/runtime/packages/editor-brain/src/index.js";
import { EditorBrainV1 } from "../.tmp/runtime/packages/editor-brain/src/v1.js";

const comp = { stableId: "COMP" };
const layer = { stableId: "LAYER" };

const style = (bias = {}) => ({
  profileId: "STYLE_M4_TEST",
  name: "M4 Test Style",
  techniqueBias: {
    HOLD: bias.HOLD ?? 0.1,
    REFRAME: bias.REFRAME ?? 0.95,
    IMPACT_PULSE: bias.IMPACT_PULSE ?? 0.1,
    FADE_PULSE: bias.FADE_PULSE ?? 0.1,
  },
  preferredImpactIntensity: 0.75,
  minimumReadability: 0.55,
  evidenceIds: ["REF_M4_01"],
});

const baseState = (overrides = {}) => ({
  comp,
  layer,
  style: style(),
  desiredEnergy: 0.2,
  readability: 0.9,
  dialogueImportance: 0.1,
  transitionPressure: 0.05,
  motionMagnitude: 0.1,
  motionDirection: "NONE",
  beatStrength: "NONE",
  beatEtaMs: null,
  shotAgeMs: 800,
  ...overrides,
});

const subject = (overrides = {}) => ({
  entityId: "SUBJECT_HERO",
  label: "Hero",
  center: { x: 0.9, y: 0.5 },
  box: { left: 0.72, top: 0.2, right: 0.98, bottom: 0.86 },
  scale: 0.2,
  speed: 0.1,
  acceleration: 0.02,
  motionDirection: "RIGHT",
  observationConfidence: 0.96,
  identityConfidence: 0.95,
  geometryConfidence: 0.94,
  trackConfidence: 0.93,
  occlusionConfidence: 0.9,
  trackStatus: "STABLE",
  isolationStatus: "NOT_NEEDED",
  occludedFraction: 0.05,
  foregroundOccluderEntityId: null,
  framingQuality: 0.55,
  attachPoints: [],
  evidenceRefs: ["TRACK_OBS_01"],
  observedAtMs: 1200,
  ...overrides,
});

const context = (overrides = {}) => ({
  heroSubjectId: "SUBJECT_HERO",
  subjects: [subject()],
  capabilities: {},
  reframeTarget: { position: [960, 540, 0], scale: [104, 104, 100] },
  ...overrides,
});

const brain = () => new EditorBrainV1(new EditorBrainV0());

test("stable high-confidence subject state enables a tracked reframe", () => {
  const decision = brain().decide(baseState(), context());
  assert.equal(decision.route, "LOCAL");
  assert.equal(decision.intent, "TRACKED_REFRAME");
  assert.equal(decision.subjectId, "SUBJECT_HERO");
  assert.equal(decision.delegatedDecisionV0?.technique, "REFRAME");
  assert.equal(decision.delegatedStateV0?.subjectX, 0.9);
  assert.equal(decision.delegatedStateV0?.motionDirection, "RIGHT");
  assert.ok(decision.rationaleCodes.includes("TRACK_CONFIDENCE_ACCEPTED"));
});

test("at-risk track is rejected instead of being used for object-aware mutation", () => {
  const decision = brain().decide(baseState(), context({
    subjects: [subject({ trackStatus: "AT_RISK", trackConfidence: 0.6 })],
  }));
  assert.equal(decision.route, "ESCALATE");
  assert.equal(decision.intent, "REQUEST_TRACK");
  assert.equal(decision.escalationReason, "UNRELIABLE_SUBJECT_TRACK");
  assert.equal(decision.delegatedDecisionV0, null);
  assert.ok(decision.rationaleCodes.includes("REJECT_UNRELIABLE_TRACK"));
});

test("drifting track fails closed when drift repair is unavailable", () => {
  const decision = brain().decide(baseState(), context({
    subjects: [subject({ trackStatus: "DRIFTING", trackConfidence: 0.45 })],
  }));
  assert.equal(decision.route, "ESCALATE");
  assert.equal(decision.intent, "REPAIR_TRACK");
  assert.equal(decision.escalationReason, "DRIFT_REPAIR_CAPABILITY_UNAVAILABLE");
  assert.equal(decision.delegatedStateV0, null);
});

test("proven drift repair is recognized but handed off instead of mutated directly by the brain", () => {
  const decision = brain().decide(baseState(), context({
    subjects: [subject({ trackStatus: "DRIFTING", trackConfidence: 0.45 })],
    capabilities: {
      driftRepair: {
        capabilityId: "m4.drift_repair",
        status: "FULL",
        proofMaturity: "STRUCTURAL",
        available: true,
      },
    },
  }));
  assert.equal(decision.route, "ESCALATE");
  assert.equal(decision.intent, "REPAIR_TRACK");
  assert.equal(decision.escalationReason, "TRACK_REPAIR_EXECUTION_HANDOFF_REQUIRED");
  assert.deepEqual(decision.requiredCapabilityIds, ["m4.drift_repair"]);
  assert.ok(decision.rationaleCodes.includes("DO_NOT_MUTATE_FROM_BRAIN"));
});

test("foreground occlusion opportunity is recognized but blocked when point tracking is not proven", () => {
  const decision = brain().decide(baseState({ transitionPressure: 0.9 }), context({
    subjects: [subject({
      center: { x: 0.5, y: 0.5 },
      foregroundOccluderEntityId: "HAND_1",
      foregroundOccluderCoverage: 0.7,
      occlusionConfidence: 0.92,
    })],
    reframeTarget: undefined,
  }));
  assert.equal(decision.route, "ESCALATE");
  assert.equal(decision.intent, "FOREGROUND_OCCLUSION_CANDIDATE");
  assert.equal(decision.escalationReason, "POINT_TRACKING_CAPABILITY_UNAVAILABLE");
  assert.ok(decision.rationaleCodes.includes("CAPABILITY_GATE_BLOCKED"));
});

test("proven tracking advances an occlusion opportunity only to deterministic recipe handoff", () => {
  const decision = brain().decide(baseState({ transitionPressure: 0.9 }), context({
    subjects: [subject({
      center: { x: 0.5, y: 0.5 },
      foregroundOccluderEntityId: "HAND_1",
      foregroundOccluderCoverage: 0.7,
      occlusionConfidence: 0.92,
    })],
    capabilities: {
      pointTracking: {
        capabilityId: "m4.point_tracking",
        status: "FULL",
        proofMaturity: "STRUCTURAL",
        available: true,
      },
    },
    reframeTarget: undefined,
  }));
  assert.equal(decision.route, "ESCALATE");
  assert.equal(decision.intent, "FOREGROUND_OCCLUSION_CANDIDATE");
  assert.equal(decision.escalationReason, "OCCLUSION_TECHNIQUE_RECIPE_HANDOFF_REQUIRED");
  assert.deepEqual(decision.requiredCapabilityIds, ["m4.point_tracking"]);
  assert.ok(decision.rationaleCodes.includes("TECHNIQUE_REQUIRES_DETERMINISTIC_RECIPE"));
});

test("heavy occlusion causes a local preserve-subject hold with no AE mutation request", () => {
  const decision = brain().decide(baseState({ desiredEnergy: 0.95 }), context({
    subjects: [subject({
      center: { x: 0.5, y: 0.5 },
      occludedFraction: 0.65,
      framingQuality: 0.8,
    })],
    reframeTarget: undefined,
  }));
  assert.equal(decision.route, "LOCAL");
  assert.equal(decision.intent, "PRESERVE_SUBJECT");
  assert.equal(decision.delegatedDecisionV0, null);
  assert.equal(decision.delegatedStateV0, null);
  assert.ok(decision.rationaleCodes.includes("PRESERVE_SUBJECT_READABILITY"));
});

test("without an unambiguous hero subject v1 safely falls back to v0 policy", () => {
  const decision = brain().decide(baseState({
    style: style({ HOLD: 0.95, REFRAME: 0.05 }),
    dialogueImportance: 0.95,
  }), {
    subjects: [],
    capabilities: {},
  });
  assert.equal(decision.route, "LOCAL");
  assert.equal(decision.intent, "DELEGATE_V0");
  assert.equal(decision.delegatedDecisionV0?.technique, "HOLD");
  assert.ok(decision.rationaleCodes.includes("NO_UNAMBIGUOUS_HERO_SUBJECT"));
});

test("1000 trusted object-aware decisions remain inside the local brain budget", () => {
  const editorBrain = brain();
  for (let index = 0; index < 1000; index += 1) {
    const x = 0.82 + ((index % 10) * 0.01);
    const decision = editorBrain.decide(baseState(), context({
      subjects: [subject({ center: { x, y: 0.5 } })],
    }));
    assert.equal(decision.route, "LOCAL");
    assert.equal(decision.intent, "TRACKED_REFRAME");
    assert.ok(decision.decisionMs <= 50);
  }
});
