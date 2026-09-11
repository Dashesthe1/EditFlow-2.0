import test from "node:test";
import assert from "node:assert/strict";
import {
  EditorBrainRuntimeV0,
  EditorBrainV0,
  compileEditorStyleProfileV0,
} from "../.tmp/runtime/packages/editor-brain/src/index.js";

const comp = { stableId: "COMP" };
const layer = { stableId: "LAYER" };

const style = (bias = {}) => ({
  profileId: "STYLE_TEST",
  name: "Test Style",
  techniqueBias: {
    HOLD: bias.HOLD ?? 0.2,
    REFRAME: bias.REFRAME ?? 0.2,
    IMPACT_PULSE: bias.IMPACT_PULSE ?? 0.8,
    FADE_PULSE: bias.FADE_PULSE ?? 0.2,
  },
  preferredImpactIntensity: 0.78,
  minimumReadability: 0.55,
  evidenceIds: ["REF_STYLE_01", "TUT_STYLE_01"],
});
const state = (overrides = {}) => ({
  comp,
  layer,
  style: style(),
  desiredEnergy: 0.92,
  readability: 0.88,
  dialogueImportance: 0.05,
  transitionPressure: 0.82,
  motionMagnitude: 0.78,
  motionDirection: "RIGHT",
  beatStrength: "STRONG",
  beatEtaMs: 70,
  shotAgeMs: 720,
  subjectX: 0.5,
  subjectY: 0.5,
  ...overrides,
});

test("reference and tutorial evidence compile into a reusable style profile", () => {
  const profile = compileEditorStyleProfileV0("STYLE_PRO", "Pro Edit", [
    { evidenceId: "REF_1", kind: "REFERENCE", technique: "IMPACT_PULSE", confidence: 1, frequency: 0.9, meanIntensity: 0.85 },
    { evidenceId: "TUT_1", kind: "TUTORIAL", technique: "IMPACT_PULSE", confidence: 0.8, frequency: 0.7, meanIntensity: 0.65 },
    { evidenceId: "REF_2", kind: "REFERENCE", technique: "HOLD", confidence: 1, frequency: 0.2 },
  ]);
  assert.ok(profile.techniqueBias.IMPACT_PULSE > profile.techniqueBias.HOLD);
  assert.ok(profile.preferredImpactIntensity > 0.7);
  assert.deepEqual(profile.evidenceIds, ["REF_1", "TUT_1", "REF_2"]);
});
test("high-energy motion on an imminent strong accent chooses an impact pulse", () => {
  const decision = new EditorBrainV0().decide(state());
  assert.equal(decision.route, "LOCAL");
  assert.equal(decision.technique, "IMPACT_PULSE");
  assert.equal(decision.program.kind, "IMPACT_PULSE");
  assert.equal(decision.program.direction, "RIGHT");
  assert.ok(decision.confidence >= 0.58);
  assert.ok(decision.decisionMs <= 50);
  assert.ok(decision.rationaleCodes.includes("MUSICAL_ACCENT_IMMINENT"));
});

test("dialogue and readability pressure prefer restraint instead of gratuitous effects", () => {
  const decision = new EditorBrainV0().decide(state({
    desiredEnergy: 0.25,
    dialogueImportance: 0.98,
    transitionPressure: 0.05,
    motionMagnitude: 0.1,
    beatStrength: "NONE",
    beatEtaMs: null,
    style: style({ HOLD: 0.9, IMPACT_PULSE: 0.2 }),
  }));
  assert.equal(decision.route, "LOCAL");
  assert.equal(decision.technique, "HOLD");
  assert.ok(decision.rationaleCodes.includes("DIALOGUE_READABILITY_PRIORITY"));
});
test("off-center subject with a known framing target chooses a reframe", () => {
  const target = { position: [1010, 540, 0], scale: [104, 104, 100] };
  const decision = new EditorBrainV0().decide(state({
    style: style({ HOLD: 0.1, REFRAME: 0.95, IMPACT_PULSE: 0.1, FADE_PULSE: 0.1 }),
    desiredEnergy: 0.2,
    transitionPressure: 0.05,
    motionMagnitude: 0.1,
    beatStrength: "NONE",
    beatEtaMs: null,
    subjectX: 0.9,
    reframeTarget: target,
  }));
  assert.equal(decision.route, "LOCAL");
  assert.equal(decision.technique, "REFRAME");
  assert.deepEqual(decision.program.target, target);
});

test("transition-biased low-motion style can choose a fade pulse", () => {
  const decision = new EditorBrainV0().decide(state({
    style: style({ HOLD: 0.05, REFRAME: 0.05, IMPACT_PULSE: 0.05, FADE_PULSE: 0.98 }),
    desiredEnergy: 0.5,
    transitionPressure: 0.95,
    motionMagnitude: 0.02,
    beatStrength: "MEDIUM",
    beatEtaMs: 80,
  }));
  assert.equal(decision.route, "LOCAL");
  assert.equal(decision.technique, "FADE_PULSE");
});
test("invalid compact editor state fails closed instead of guessing", () => {
  const decision = new EditorBrainV0().decide(state({ desiredEnergy: 2 }));
  assert.equal(decision.route, "ESCALATE");
  assert.equal(decision.technique, null);
  assert.equal(decision.escalationReason, "INVALID_EDITOR_STATE");
});

test("the same editor state produces the same explicit program", () => {
  const brain = new EditorBrainV0();
  const first = brain.decide(state());
  const second = brain.decide(state());
  assert.equal(first.technique, second.technique);
  assert.deepEqual(first.program, second.program);
  assert.deepEqual(first.scores, second.scores);
  assert.deepEqual(first.rationaleCodes, second.rationaleCodes);
});

test("editor runtime sends one high-level reflex goal to the fast runner", async () => {
  const calls = [];
  const fakeRunner = { async run(goal, transactionId) {
    calls.push({ goal, transactionId });
    return {
      route: "LOCAL", goalKind: goal.kind, plan: { route: "LOCAL", goalKind: goal.kind, intents: [] },
      actions: [], completedActions: 3, planningMs: 0.1, actionMs: 40, totalMs: 40.1,
      withinBudget: true, escalationReason: null, escalationDetail: null, hostRevision: 13,
    };
  } };
  const brain = new EditorBrainV0();
  const runtime = new EditorBrainRuntimeV0(brain, fakeRunner);
  const result = await runtime.run(state(), "TX_EDITOR_BRAIN");
  assert.equal(result.route, "LOCAL");
  assert.equal(result.decision.technique, "IMPACT_PULSE");
  assert.equal(result.visibleMutationExpected, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].transactionId, "TX_EDITOR_BRAIN");
  assert.equal(calls[0].goal.kind, "IMPACT_PULSE");
  assert.equal(calls[0].goal.direction, "RIGHT");
});

test("1000 familiar decisions stay inside the local decision budget", () => {
  const brain = new EditorBrainV0();
  for (let index = 0; index < 1000; index += 1) {
    const decision = brain.decide(state({ beatEtaMs: 40 + (index % 120) }));
    assert.equal(decision.route, "LOCAL");
    assert.ok(decision.decisionMs <= 50);
  }
});
