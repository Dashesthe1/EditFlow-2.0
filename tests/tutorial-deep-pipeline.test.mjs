import test from "node:test";
import assert from "node:assert/strict";

import {
  learnDeepFromTutorialUploadV1,
  TutorialLessonValidationError,
} from "../.tmp/runtime/packages/tutorial-learning/src/index.js";
import { CapabilityRegistry } from "../.tmp/runtime/packages/capability-registry/src/index.js";

const upload = () => ({
  uploadId: "upload-001",
  mediaRef: "upload://tutorial.mp4",
  transcriptRef: "upload://tutorial.txt",
  projectFileRef: "upload://tutorial.aep",
  sourceMediaRefs: ["upload://source-a.mp4"],
  referenceRenderRef: "upload://reference.mp4",
});

const requirement = (capabilityId) => ({
  capabilityId,
  reason: "Animate the semantic subject transform.",
  minimumProofMaturity: "TRANSFER",
});

const packet = () => ({
  schema: "editflow.tutorial-analysis.v1",
  tutorialId: "tutorial.push.001",
  title: "Motion-aware impact push",
  sourceRef: "upload://tutorial.mp4",
  durationMs: 5000,
  evidenceRefs: ["video:0-5s", "transcript:all"],
  skills: [{
    skillId: "skill.impact-push",
    name: "Motion-aware impact push",
    what: {
      objective: "Create a brief scale-and-position accent while preserving subject readability.",
      components: [{
        componentId: "push",
        visibleResult: "The frame pushes toward the subject at the accent.",
        role: "Increase impact and direct attention.",
        interactions: ["Scale and position cooperate to preserve framing."],
      }],
    },
    whenWhy: {
      creativeIntent: "Emphasize a meaningful motion or beat accent.",
      attentionGoal: "Pull attention toward the hero subject.",
      emotionalPurpose: "Increase impact without overstaying the moment.",
      pacingRole: "Short accent rather than persistent motion.",
      musicRelationship: "Prefer a strong transient when music supplies one.",
      dialogueRelationship: "Reduce intensity when dialogue readability is primary.",
      motionConditions: ["Subject motion remains readable during the push."],
      compositionConditions: ["There is enough framing margin for the push."],
      continuityConstraints: ["Do not create a positional jump across the cut."],
      useWhen: ["A clear visual or musical accent benefits from emphasis."],
      avoidWhen: ["The shot is already unstable or tightly cropped."],
      restraintRule: "Use the smallest push that clearly communicates the accent.",
    },
    how: {
      topology: ["single hero layer with semantic transform animation"],
      timingModel: "Anchor the push near the selected event and return quickly.",
      easingModel: "Fast ease into impact with a controlled recovery.",
      adaptationRules: ["Derive scale from crop margin and subject size."],
      mechanisms: [{
        mechanismId: "push",
        primitive: "TRANSFORM_ANIMATION",
        startMs: 1200,
        endMs: 1800,
        intent: "Push toward the subject while maintaining readable framing.",
        construction: "Animate scale and position around the semantic accent.",
        observableResult: "The hero grows briefly without leaving the safe framing region.",
        dependsOn: [],
        parameters: [{
          name: "pushIntensity",
          intent: "Increase impact without clipping the subject.",
          derivedFrom: ["subjectScale", "cropMargin", "accentStrength"],
          normalizedRange: { min: 0.1, max: 0.8 },
        }],
        timing: { anchor: "EVENT", eventRef: "impact", durationMs: 600 },
        evidenceRefs: ["video:1.2-1.8s"],
      }],
    },
    access: {
      bindings: [{
        mechanismId: "push",
        capabilityRequirements: [requirement("ae.layer.transform.set")],
      }],
    },
    proof: {
      validationCriteria: ["Subject remains readable throughout the push."],
      invariants: ["Transform target remains the intended hero layer."],
      failureModes: [{
        condition: "The push crops the subject.",
        diagnosis: "Intensity exceeds available composition margin.",
        repairStrategy: "Reduce scale or compensate position before changing timing.",
      }],
      transferAxes: ["different subject scale", "different aspect ratio"],
      robustnessAxes: ["off-center subject", "short shot handles"],
    },
    scenePrerequisites: ["A hero subject or framing target can be identified."],
    knowledgeDelta: {
      newConcepts: ["Push intensity should be bounded by crop margin."],
      reinforcedConcepts: [],
      newCombinations: [],
      refinements: [],
      contradictions: [],
    },
    compatibleTechniques: ["BEAT_ACCENT"],
    conflictingTechniques: [],
  }],
});

const capability = (proofMaturity = "TRANSFER") => ({
  id: "ae.layer.transform.set",
  domain: "layer",
  description: "Set typed layer transform properties.",
  status: "FULL",
  proofMaturity,
  routes: [{
    routeId: "route.transform",
    kind: "HOST_ADAPTER",
    available: true,
  }],
  readbackStrategy: "TEST",
  rollbackStrategy: "TEST",
  riskClass: "R1_REVERSIBLE",
  fallbackPolicy: "FORBID",
});

const registryWith = (record = capability()) => {
  const registry = new CapabilityRegistry(
    "env:tutorial-deep-pipeline",
    "2026-09-17T20:30:00.000Z",
  );
  if (record) registry.registerStatic([record]);
  return registry;
};

test("deep upload pipeline preserves provenance and compiles the complete tutorial intelligence path", async () => {
  const analyzer = { analyze: async () => packet() };
  const result = await learnDeepFromTutorialUploadV1(
    upload(),
    analyzer,
    registryWith(),
    { generatedAt: "2026-09-17T20:31:00.000Z" },
  );
  assert.equal(result.schema, "editflow.tutorial-deep-learning-result.v1");
  assert.equal(result.upload.projectFileRef, "upload://tutorial.aep");
  assert.deepEqual(result.upload.sourceMediaRefs, ["upload://source-a.mp4"]);
  assert.equal(result.lesson.skills[0].editingIr.nodes[0].kind, "TRANSFORM_ANIMATION");
  assert.equal(result.capabilityReport.summary.ready, 1);
  assert.deepEqual(result.blockingCapabilityIds, []);
  assert.equal(result.readyForReconstruction, true);
  assert.equal(result.targetState, "TRANSFER_VERIFIED");
  const l2 = result.proofPlans[0].stages.find((stage) => stage.level === 2);
  const l6 = result.proofPlans[0].stages.find((stage) => stage.level === 6);
  assert.equal(l2.required, false);
  assert.equal(l6.required, true);
});

test("deep upload pipeline surfaces capability blockers before reconstruction", async () => {
  const analyzer = { analyze: async () => packet() };
  const result = await learnDeepFromTutorialUploadV1(
    upload(),
    analyzer,
    registryWith(null),
    { generatedAt: "2026-09-17T20:32:00.000Z" },
  );
  assert.equal(result.readyForReconstruction, false);
  assert.deepEqual(result.blockingCapabilityIds, ["ae.layer.transform.set"]);
  assert.equal(result.capabilityReport.findings[0].state, "UNREGISTERED");
});

test("deep upload pipeline refuses analyzer source-lineage drift", async () => {
  const analyzer = {
    analyze: async () => ({ ...packet(), sourceRef: "upload://different.mp4" }),
  };
  await assert.rejects(
    () => learnDeepFromTutorialUploadV1(upload(), analyzer, registryWith()),
    TutorialLessonValidationError,
  );
});

test("deep upload pipeline rejects malformed optional provenance instead of losing it silently", async () => {
  const badUpload = upload();
  badUpload.sourceMediaRefs = ["upload://source-a.mp4", "   "];
  const analyzer = { analyze: async () => packet() };
  await assert.rejects(
    () => learnDeepFromTutorialUploadV1(badUpload, analyzer, registryWith()),
    /sourceMediaRefs\[1\] must not be empty/i,
  );
});
