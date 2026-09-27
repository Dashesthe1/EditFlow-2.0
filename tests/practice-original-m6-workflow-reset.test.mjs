import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GptOrchestrationStoreV1,
  buildGptOrchestrationChatMessageV1,
} from "../.tmp/runtime/packages/practice-homework/src/index.js";
import {
  VisualEffectsBrainV1,
  buildConstructionGraphV1,
  deriveEffectAnatomyV1,
} from "../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const ALL_CAPABILITIES = [
  "ae.layer.duplicate",
  "ae.layer.time.offset",
  "ae.layer.opacity.set",
  "ae.subject.isolate",
  "ae.layer.matte.set",
  "ae.effect.displacement-map",
  "ae.effect.directional-blur",
  "ae.effect.exposure",
  "ae.effect.channel-shift",
  "ae.layer.blend_mode.set",
  "ae.layer.order.set",
  "ae.precompose.layers",
  "ae.keyframe.temporal_ease.set",
  "ae.layer.transform.set",
  "ae.keyframe.spatial.set",
];

const shutterReference = () => {
  const frameIntervalMs = 1000 / 30;
  const summary = {
    frameCount: 7,
    frameIntervalMs,
    temporalStateCountPeak: 4,
    temporalPersistence: 0.55,
    motionEnergyPeak: 0.5,
    displacementPeak: 0.16,
    displacementDirection: { x: 1, y: 0 },
    scaleRange: 0,
    rotationRange: 0,
    blurPeak: 0.35,
    blurPeakPhase: 0.5,
    distortionPeak: 0.04,
    exposurePeak: 0.7,
    subjectSeparationPeak: 0.42,
    overlapDensityPeak: 0.4,
    stateSeparationPeak: 0.08,
    occlusionPeak: 0,
    accelerationPeak: 0.09,
    recoveryFrames: 3,
    opticalPeakPhase: 0.5,
    motionPeakPhase: 0.5,
  };
  const frames = Array.from({ length: 7 }, (_, index) => ({
    timeMs: index * frameIntervalMs,
    lumaMean: 0.5,
    lumaStd: 0.3,
    exposure: index === 3 ? 0.7 : 0.45,
    sharpness: 0.5,
    edgeDensity: 0.25,
    chromaticSeparation: 0.04,
    alphaCoverage: 1,
    visualDensity: 0.3,
    frameDifference: index === 3 ? 0.5 : 0.1,
    structuralDifference: index === 3 ? 0.5 : 0.1,
    motionEnergy: index === 3 ? 0.5 : 0.03,
    motionDirection: { x: 1, y: 0 },
    subjectMotion: { x: 0, y: 0 },
    backgroundMotion: { x: 0, y: 0 },
    subjectBackgroundDivergence: 0,
    displacementMagnitude: index === 3 ? 0.16 : 0.01,
    scale: 1,
    rotationDegrees: 0,
    perspectiveEnergy: 0,
    blurStrength: index === 3 ? 0.35 : 0.05,
    distortionStrength: index === 3 ? 0.04 : 0.02,
    subjectSeparation: index === 3 ? 0.42 : 0,
    overlapDensity: index === 3 ? 0.4 : 0,
    stateSeparation: index === 3 ? 0.08 : 0,
    temporalStateCount: index === 3 ? 4 : 1,
    occlusion: 0,
    maskCoverage: 0.25,
  }));
  return {
    schema: "editflow.dense-effect-evidence.v1",
    sourceId: "reference:workflow-reset",
    sourceKind: "REFERENCE",
    analyzerFingerprint: "fixture:workflow-reset",
    settingsFingerprint: "fixture:workflow-reset",
    contentKey: "fixture:workflow-reset",
    frames,
    summary,
    evidenceRefs: ["fixture:workflow-reset"],
  };
};

test("Practice orchestration brief makes cross-chat continuity and original M6 routing mandatory", () => {
  const message = buildGptOrchestrationChatMessageV1({
    sessionId: "practice:continuity",
    mode: "PRACTICE",
    practiceRole: "LEARNING",
    editTypeId: "reference-faithful",
    finish: {
      mediaId: "finish:1",
      role: "FINISH_REFERENCE",
      mediaKind: "VIDEO",
      uri: "C:\\Media\\finish.mp4",
    },
    start: [{
      mediaId: "start:1",
      role: "START_SOURCE",
      mediaKind: "VIDEO",
      uri: "C:\\Media\\raw.mp4",
    }],
    practicePolicy: null,
    artifactDir: "C:\\EditFlow\\practice",
    knowledge: null,
  });
  assert.match(message, /PRACTICE CONTINUITY IS MANDATORY/);
  assert.match(message, /new ChatGPT controller must resume the existing PENDING\/RUNNING assignment/i);
  assert.match(message, /original M6 reference-first route is authoritative/i);
  assert.match(message, /must not replace the reference-first M6 governing route/i);
});

test("a new ChatGPT controller can reclaim the same RUNNING Practice assignment", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-workflow-reset-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const store = new GptOrchestrationStoreV1(path.join(root, "gpt-orchestration.json"));
  const assignment = await store.createAssignment({
    sessionId: "practice:resume:001",
    mode: "PRACTICE",
    practiceRole: "LEARNING",
    editTypeId: "reference-faithful",
    finish: {
      mediaId: "finish:1",
      role: "FINISH_REFERENCE",
      mediaKind: "VIDEO",
      uri: "C:\\Media\\finish.mp4",
    },
    start: [{
      mediaId: "start:1",
      role: "START_SOURCE",
      mediaKind: "VIDEO",
      uri: "C:\\Media\\raw.mp4",
    }],
    artifactDir: root,
    knowledge: null,
  });
  const first = await store.claim(assignment.assignmentId, "chatgpt:first-chat");
  const second = await store.claim(assignment.assignmentId, "chatgpt:next-chat");
  assert.equal(first.status, "RUNNING");
  assert.equal(second.status, "RUNNING");
  assert.equal(second.startedAt, first.startedAt);
  assert.equal(second.claimedAt, first.claimedAt);
  assert.equal(second.claimedBy, "chatgpt:next-chat");
});

test("HIGH-risk M6 reconstruction ignores a retained learned graph as the governing construction", async () => {
  const reference = shutterReference();
  const learnedGraph = {
    ...buildConstructionGraphV1(deriveEffectAnatomyV1(reference)),
    graphId: "learned-poison-graph",
  };
  const appliedGraphIds = [];
  const brain = new VisualEffectsBrainV1();
  const result = await brain.run({
    requestId: "workflow-reset:high-risk",
    risk: "HIGH",
    learnedTechniqueId: "retained:advisory-only",
    learnedGraph,
    referenceEvidence: reference,
    availableCapabilities: ALL_CAPABILITIES,
    evidenceRefs: ["fixture:workflow-reset"],
    applyGraph: async (graph) => {
      appliedGraphIds.push(graph.graphId);
    },
    renderWindow: async () => reference,
  });
  assert.equal(result.route, "VISUAL_INTELLIGENCE");
  assert.equal(result.status, "COMPLETED");
  assert.ok(appliedGraphIds.length > 0);
  assert.ok(!appliedGraphIds.includes("learned-poison-graph"));
});
