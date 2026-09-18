import test from "node:test";
import assert from "node:assert/strict";

import {
  compileTutorialDeepLessonV1,
  compileTutorialProofPlanV1,
  discoverTutorialCapabilitiesV0,
  TutorialLessonValidationError,
} from "../.tmp/runtime/packages/tutorial-learning/src/index.js";
import { EditingIrValidationError } from "../.tmp/runtime/packages/editing-ir/src/index.js";
import { CapabilityRegistry } from "../.tmp/runtime/packages/capability-registry/src/index.js";

const requirement = (capabilityId, minimumProofMaturity, reason) => ({
  capabilityId,
  minimumProofMaturity,
  reason,
});

const route = (routeId) => ({
  routeId,
  kind: "HOST_ADAPTER",
  available: true,
});

const capability = (id, proofMaturity = "TRANSFER") => ({
  id,
  domain: "tutorial-intelligence-test",
  description: id,
  status: "FULL",
  proofMaturity,
  routes: [route(`route.${id}`)],
  readbackStrategy: "TEST",
  rollbackStrategy: "TEST",
  riskClass: "R1_REVERSIBLE",
  fallbackPolicy: "FORBID",
});

const deepPacket = () => ({
  schema: "editflow.tutorial-analysis.v1",
  tutorialId: "tutorial.subject-trail.001",
  title: "Motion-aware subject trail",
  sourceRef: "upload://subject-trail.mp4",
  durationMs: 10000,
  evidenceRefs: ["video:0-10s", "transcript:all"],
  skills: [{
    skillId: "skill.subject-trail",
    name: "Motion-aware subject trail",
    what: {
      objective: "Create a readable temporal subject trail that reinforces motion.",
      components: [{
        componentId: "trail-stack",
        visibleResult: "Isolated subject echoes decay behind the moving subject.",
        role: "Reinforce direction and impact without obscuring the hero subject.",
        interactions: ["Isolation constrains duplicates", "Opacity decay preserves hierarchy"],
      }],
    },
    whenWhy: {
      creativeIntent: "Increase perceived motion energy around an accent.",
      attentionGoal: "Keep the live subject dominant while motion echoes guide the eye.",
      emotionalPurpose: "Add impact without turning the frame into persistent clutter.",
      pacingRole: "Brief accent around a fast motion event.",
      musicRelationship: "Prefer a strong beat or transient when music is present.",
      dialogueRelationship: "Reduce or omit during dialogue-critical readability moments.",
      motionConditions: ["Subject has measurable directional velocity"],
      compositionConditions: ["There is space behind the motion direction"],
      continuityConstraints: ["Trail direction must agree with apparent motion"],
      useWhen: ["A moving subject needs a short impact accent"],
      avoidWhen: ["Subject motion is ambiguous or the frame is already visually dense"],
      restraintRule: "Use the shortest persistence that still communicates direction.",
    },
    how: {
      topology: ["hero subject above decaying temporal duplicates"],
      timingModel: "Trail offsets derive from velocity, frame rate, and desired persistence.",
      easingModel: "Opacity falls monotonically with temporal age.",
      adaptationRules: ["Increase separation with velocity while preserving subject readability"],
      mechanisms: [{
        mechanismId: "isolate",
        primitive: "SUBJECT_ISOLATION",
        startMs: 1200,
        endMs: 2600,
        intent: "Separate the hero subject from background motion.",
        construction: "Build an editable subject isolation matte.",
        observableResult: "Only the intended subject drives the trail source.",
        dependsOn: [],
        parameters: [{
          name: "subjectBoundary",
          intent: "Follow the visible subject silhouette.",
          derivedFrom: ["subjectLocation", "subjectScale"],
        }],
      }, {
        mechanismId: "echoes",
        primitive: "TEMPORAL_DUPLICATION",
        startMs: 2600,
        endMs: 4200,
        intent: "Create motion echoes behind the hero subject.",
        construction: "Duplicate the isolated subject at semantic temporal offsets.",
        observableResult: "Older copies trail behind motion with controlled persistence.",
        dependsOn: ["isolate"],
        parameters: [{
          name: "temporalSeparation",
          intent: "Separate echoes enough to show motion without fragmenting the subject.",
          derivedFrom: ["subjectVelocity", "frameRate", "desiredPersistence"],
          normalizedRange: { min: 0.05, max: 0.8 },
        }],
        timing: { anchor: "EVENT", eventRef: "motion-accent", offsetMs: 0, durationMs: 400 },
      }],
    },
    access: {
      bindings: [{
        mechanismId: "isolate",
        capabilityRequirements: [
          requirement("ae.subject.isolate", "TRANSFER", "Create transferable subject isolation."),
        ],
      }, {
        mechanismId: "echoes",
        capabilityRequirements: [
          requirement("ae.layer.duplicate", "TRANSFER", "Create reusable temporal duplicates."),
          requirement("ae.layer.timing.set", "TRANSFER", "Offset duplicates semantically in time."),
        ],
      }],
    },
    proof: {
      validationCriteria: [
        "Hero subject remains dominant",
        "Trail direction agrees with motion",
        "Echo opacity decreases with temporal age",
      ],
      invariants: [
        "No generated trail layer references a missing source",
        "Temporal age ordering remains monotonic",
      ],
      failureModes: [{
        condition: "Echoes obscure the live subject",
        diagnosis: "Persistence or opacity is too strong for the current composition",
        repairStrategy: "Reduce echo count, persistence, or opacity before changing the underlying isolation",
      }],
      transferAxes: ["different subject velocity", "different frame rate", "different aspect ratio"],
      robustnessAxes: ["camera motion", "short shot handles", "off-center subject"],
    },
    scenePrerequisites: ["A trackable or isolatable hero subject is present"],
    knowledgeDelta: {
      newConcepts: ["Temporal echo spacing should be motion-aware rather than fixed-frame copying"],
      reinforcedConcepts: [],
      newCombinations: ["Subject isolation combined with temporal duplication"],
      refinements: [],
      contradictions: [],
    },
    compatibleTechniques: ["CAMERA_PUSH", "BEAT_ACCENT"],
    conflictingTechniques: ["LONG_EXPOSURE_TRAIL"],
  }],
});

const readyRegistry = () => {
  const registry = new CapabilityRegistry("env:tutorial-intelligence", "2026-09-17T20:20:00.000Z");
  registry.registerStatic([
    capability("ae.subject.isolate"),
    capability("ae.layer.duplicate"),
    capability("ae.layer.timing.set"),
  ]);
  return registry;
};

test("deep tutorial analysis preserves professional judgment and compiles semantic Editing IR", () => {
  const lesson = compileTutorialDeepLessonV1(deepPacket());
  assert.equal(lesson.skills[0].learningState, "OBSERVED");
  assert.equal(lesson.skills[0].analysis.whenWhy.avoidWhen.length, 1);
  assert.deepEqual(lesson.skills[0].editingIr.outputs, ["echoes"]);
  assert.deepEqual(
    lesson.skills[0].editingIr.nodes[1].parameters[0].derivedFrom,
    ["subjectVelocity", "frameRate", "desiredPersistence"],
  );
  assert.equal(lesson.legacyLesson.skills[0].requiredCapabilities.length, 3);
});

test("deep tutorial analysis rejects shallow professional judgment", () => {
  const packet = deepPacket();
  packet.skills[0].whenWhy.avoidWhen = [];
  assert.throws(() => compileTutorialDeepLessonV1(packet), TutorialLessonValidationError);
});

test("semantic mechanism cycles fail before any AE proof", () => {
  const packet = deepPacket();
  packet.skills[0].how.mechanisms[0].dependsOn = ["echoes"];
  assert.throws(() => compileTutorialDeepLessonV1(packet), EditingIrValidationError);
});

test("proof compiler reuses ready capability evidence and stops before redundant live microproofs", () => {
  const lesson = compileTutorialDeepLessonV1(deepPacket());
  const report = discoverTutorialCapabilitiesV0(
    lesson.legacyLesson,
    readyRegistry(),
    "2026-09-17T20:21:00.000Z",
  );
  const plan = compileTutorialProofPlanV1(lesson.skills[0], report);
  const l2 = plan.stages.find((stage) => stage.level === 2);
  const l6 = plan.stages.find((stage) => stage.level === 6);
  const l7 = plan.stages.find((stage) => stage.level === 7);
  assert.equal(l2.required, false);
  assert.equal(l2.liveAeRequired, false);
  assert.equal(plan.reusableCapabilityProofs.length, 3);
  assert.equal(l6.required, true);
  assert.equal(l7.required, false);
  assert.equal(plan.risk, "HIGH");
});

test("proof compiler requests only invalidated capability microproofs and ROBUST coverage when asked", () => {
  const lesson = compileTutorialDeepLessonV1(deepPacket());
  const registry = new CapabilityRegistry(
    "env:tutorial-intelligence-lower-maturity",
    "2026-09-17T20:22:00.000Z",
  );
  registry.registerStatic([
    capability("ae.subject.isolate"),
    capability("ae.layer.duplicate"),
    capability("ae.layer.timing.set", "STRUCTURAL"),
  ]);
  const report = discoverTutorialCapabilitiesV0(
    lesson.legacyLesson,
    registry,
    "2026-09-17T20:22:00.000Z",
  );
  const plan = compileTutorialProofPlanV1(lesson.skills[0], report, "ROBUST");
  const l2 = plan.stages.find((stage) => stage.level === 2);
  const l7 = plan.stages.find((stage) => stage.level === 7);
  assert.equal(l2.required, true);
  assert.match(l2.assertions.join("\n"), /ae\.layer\.timing\.set/);
  assert.equal(l7.required, true);
  assert.match(l7.assertions.join("\n"), /camera motion/);
});
