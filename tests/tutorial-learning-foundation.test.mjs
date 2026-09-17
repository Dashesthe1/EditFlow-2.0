import test from "node:test";
import assert from "node:assert/strict";

import {
  compileTutorialLessonV0,
  deriveTutorialSkillStateV0,
  discoverTutorialCapabilitiesV0,
  TutorialLessonValidationError,
} from "../.tmp/runtime/packages/tutorial-learning/src/index.js";
import { CapabilityRegistry } from "../.tmp/runtime/packages/capability-registry/src/index.js";

const requirement = (capabilityId, minimumProofMaturity, reason, extra = {}) => ({
  capabilityId,
  minimumProofMaturity,
  reason,
  ...extra,
});

const packet = () => ({
  tutorialId: "tutorial.speed-ramp.001",
  title: "Motion-driven speed ramp",
  sourceRef: "upload://tutorial-speed-ramp.mp4",
  durationMs: 12000,
  evidenceRefs: ["frame:120", "transcript:4.2-8.9"],
  skills: [{
    skillId: "skill.motion-speed-ramp",
    name: "Motion-driven speed ramp",
    objective: "Speed up movement through a cut while retaining readability.",
    whenToUse: "Directional movement provides enough visual continuity to support a ramp.",
    adaptationVariables: ["motionDirection", "transitionFrame", "handleLength"],
    validationCriteria: ["motion remains readable", "no temporal discontinuity"],
    steps: [{
      stepId: "step.remap",
      startMs: 4200,
      endMs: 6100,
      intent: "Create the timing curve.",
      action: "Enable time remapping and shape the temporal curve.",
      observableResult: "Playback speeds into the transition and eases out.",
      capabilityRequirements: [
        requirement("ae.time.remap.set", "TRANSFER", "Create the remap keys."),
        requirement("ae.graph.temporal.set", "TRANSFER", "Shape the timing curve."),
        requirement("ae.motion_blur.set", "STRUCTURAL", "Preserve visual continuity."),
      ],
    }, {
      stepId: "step.trail",
      startMs: 6100,
      endMs: 7600,
      intent: "Add a short visual trail during the fastest section.",
      action: "Duplicate and offset the isolated subject for two frames.",
      observableResult: "A brief directional trail follows the subject.",
      capabilityRequirements: [
        requirement("ae.layer.trail.create", "STRUCTURAL", "Create and offset trail layers."),
        requirement("ae.motion_blur.set", "VISUAL", "Blend trail edges."),
        requirement("ae.plugin.optional", "TRANSFER", "Optional enhanced trail renderer.", { optional: true }),
      ],
    }],
  }],
});

const capability = (id, status, proofMaturity, routes = []) => ({
  id,
  domain: "tutorial-test",
  description: id,
  status,
  proofMaturity,
  routes,
  readbackStrategy: "TEST",
  rollbackStrategy: "TEST",
  riskClass: "R1_REVERSIBLE",
  fallbackPolicy: "FORBID",
});
const route = (routeId, kind = "HOST_ADAPTER") => ({
  routeId,
  kind,
  available: true,
});

test("tutorial analysis compiles into an observed lesson with merged capability needs", () => {
  const lesson = compileTutorialLessonV0(packet());
  assert.equal(lesson.schemaVersion, 1);
  assert.equal(lesson.skills[0].learningState, "OBSERVED");
  const needs = new Map(lesson.skills[0].requiredCapabilities.map((item) => [item.capabilityId, item]));
  assert.equal(needs.size, 5);
  assert.equal(needs.get("ae.motion_blur.set").minimumProofMaturity, "VISUAL");
  assert.equal(needs.get("ae.motion_blur.set").optional, false);
  assert.equal(needs.get("ae.plugin.optional").optional, true);
});

test("tutorial compiler rejects impossible tutorial time ranges", () => {
  const invalid = packet();
  invalid.skills[0].steps[0].endMs = 14000;
  assert.throws(() => compileTutorialLessonV0(invalid), TutorialLessonValidationError);
});

test("learning-state promotion requires reconstruction before transfer and robustness", () => {
  const skillId = "skill.motion-speed-ramp";
  const reconstruction = { skillId, kind: "RECONSTRUCTION", passed: true, evidenceRefs: ["render:a"] };
  const transfer = { skillId, kind: "TRANSFER", passed: true, evidenceRefs: ["render:b"] };
  const robustness = { skillId, kind: "ROBUSTNESS", passed: true, evidenceRefs: ["render:c"] };
  assert.equal(deriveTutorialSkillStateV0(skillId, []), "OBSERVED");
  assert.equal(deriveTutorialSkillStateV0(skillId, [transfer]), "OBSERVED");
  assert.equal(deriveTutorialSkillStateV0(skillId, [reconstruction]), "RECONSTRUCTED");
  assert.equal(deriveTutorialSkillStateV0(skillId, [reconstruction, transfer]), "TRANSFER_VERIFIED");
  assert.equal(deriveTutorialSkillStateV0(skillId, [reconstruction, transfer, robustness]), "ROBUST");
});

test("tutorial-driven discovery reports only the AE access the lesson actually needs", () => {
  const registry = new CapabilityRegistry("env:tutorial-test", "2026-09-17T20:00:00.000Z");
  registry.registerStatic([
    capability("ae.time.remap.set", "FULL", "TRANSFER", [route("route.time-remap")]),
    capability("ae.graph.temporal.set", "FULL", "STRUCTURAL", [route("route.temporal")]),
    capability("ae.motion_blur.set", "ADAPTER_REQUIRED", "DECLARED", []),
    capability("ae.plugin.optional", "PARTIAL", "TRANSFER", [route("route.optional", "GUARDED_UI")]),
  ]);
  const lesson = compileTutorialLessonV0(packet());
  const report = discoverTutorialCapabilitiesV0(lesson, registry, "2026-09-17T20:01:00.000Z");
  const states = new Map(report.findings.map((finding) => [finding.capabilityId, finding.state]));
  assert.equal(states.get("ae.time.remap.set"), "READY");
  assert.equal(states.get("ae.graph.temporal.set"), "PROOF_REQUIRED");
  assert.equal(states.get("ae.motion_blur.set"), "ADAPTER_REQUIRED");
  assert.equal(states.get("ae.layer.trail.create"), "UNREGISTERED");
  assert.equal(states.get("ae.plugin.optional"), "PARTIAL");
  assert.deepEqual(report.summary, { total: 5, ready: 1, blocked: 3, optionalGaps: 1 });
  assert.equal(report.developmentQueue[0].capabilityId, "ae.layer.trail.create");
  assert.equal(report.developmentQueue.at(-1).capabilityId, "ae.plugin.optional");
  assert.equal(report.developmentQueue.at(-1).blocking, false);
});
