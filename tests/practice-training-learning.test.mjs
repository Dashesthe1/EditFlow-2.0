import assert from "node:assert/strict";
import test from "node:test";

import {
  EditTypeRegistryV1,
  PracticeM6ExecutionBridgeV1,
  ProCreationPreparationEngineV1,
} from "../.tmp/runtime/packages/practice-homework/src/index.js";
import {
  buildConstructionGraphV1,
  classifyEffectFamilyV1,
  deriveEffectAnatomyV1,
} from "../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const passedReport = (value = 0.98) => ({
  schema: "editflow.practice-similarity.v1",
  breakdown: {
    sceneIdentity: value,
    temporalAlignment: value,
    cutTiming: value,
    framing: value,
    motion: value,
    effectFidelity: value,
    transitionFidelity: value,
    colorFinish: value,
    pixelStructure: value,
  },
  definingEffectCoverage: 1,
  wrongSceneCount: 0,
  unmatchedSceneCount: 0,
  overallSimilarity: value,
  passed: true,
  reasons: [],
  evidenceRefs: ["test:report"],
});

const failedReport = () => ({
  ...passedReport(0.7),
  passed: false,
  definingEffectCoverage: 0.5,
});

const samplePatch = {
  patchId: "patch:1:distortion",
  invariantId: "inv:distortion",
  nodeId: "node:distortion",
  parameter: "distortionPeak",
  previousValue: 0.2,
  nextValue: 0.32,
  rationale: "Reference distortion was stronger.",
};

const episode = {
  sessionId: "practice:learning:001",
  selectedEditTypeId: "spider-man-high-potency",
  styleFingerprint: "style:high-potency",
  baselineId: "baseline:001",
  matches: [],
  audioMatch: null,
  attempts: [
    {
      attempt: 1,
      renderRef: "render:1",
      report: failedReport(),
      decisionTraces: [{
        decisionId: "decision:1",
        cueIds: ["effect-window:w1"],
        constructionIds: ["graph:failed"],
        rationaleCodes: ["M6_FAMILY_SHUTTER_FRAGMENTATION"],
        semanticPatches: [samplePatch],
      }],
      elapsedMs: 1200,
      evidenceRefs: ["attempt:1"],
    },
    {
      attempt: 2,
      renderRef: "render:2",
      report: passedReport(),
      decisionTraces: [{
        decisionId: "decision:2",
        cueIds: ["effect-window:w1"],
        constructionIds: ["graph:passed"],
        rationaleCodes: ["M6_FAMILY_SHUTTER_FRAGMENTATION"],
        semanticPatches: [{
          ...samplePatch,
          patchId: "patch:2:distortion",
          nextValue: 0.38,
        }],
      }],
      elapsedMs: 900,
      evidenceRefs: ["attempt:2"],
    },
  ],
  mastered: true,
  bestAttempt: null,
};
episode.bestAttempt = episode.attempts[1];

test("Edit Type allocation retains success, failure, efficiency, and semantic correction evidence", () => {
  const registry = new EditTypeRegistryV1();
  registry.create({
    editTypeId: "spider-man-high-potency",
    title: "Spider-Man High Potency",
    choiceWords: ["spidey potency"],
  });

  const profile = registry.allocateEpisode(episode, "spider-man-high-potency");
  assert.equal(profile.sessionIds.length, 1);
  assert.equal(profile.masteredSessionIds.length, 1);
  assert.equal(profile.behaviorEvidence.length, 2);

  const knowledge = registry.knowledge("spider-man-high-potency");
  assert.ok(knowledge);
  assert.deepEqual(knowledge.successfulConstructionIds, ["graph:passed"]);
  assert.deepEqual(knowledge.failedConstructionIds, ["graph:failed"]);
  assert.equal(knowledge.successfulSemanticPatches.length, 1);
  assert.equal(knowledge.failedSemanticPatches.length, 1);
  assert.equal(knowledge.behaviorEvidence[0].elapsedMs, 1200);
});
test("Pro Creation stays blocked until its Edit Type has allocated Practice learning", () => {
  const registry = new EditTypeRegistryV1();
  registry.create({
    editTypeId: "spider-man-high-potency",
    title: "Spider-Man High Potency",
  });
  const engine = new ProCreationPreparationEngineV1(registry);
  const request = {
    sessionId: "pro:create:001",
    mode: "PRO_CREATION",
    editTypeId: "spider-man-high-potency",
    start: [
      {
        mediaId: "raw:video",
        role: "START_SOURCE",
        mediaKind: "VIDEO",
        uri: "file:///raw.mp4",
      },
      {
        mediaId: "raw:song",
        role: "START_SOURCE",
        mediaKind: "AUDIO",
        uri: "file:///song.wav",
      },
    ],
  };

  assert.equal(engine.prepare(request).status, "BLOCKED");
  registry.allocateEpisode(episode, "spider-man-high-potency");
  const ready = engine.prepare(request);
  assert.equal(ready.status, "READY");
  assert.equal(ready.knowledge?.totalSessionCount, 1);
  assert.equal(ready.start.some((item) => item.mediaKind === "AUDIO"), true);
});

const summary = {
  frameCount: 7,
  frameIntervalMs: 1000 / 30,
  temporalStateCountPeak: 4,
  temporalPersistence: 0.55,
  motionEnergyPeak: 0.5,
  displacementPeak: 0.16,
  displacementDirection: { x: 1, y: 0 },
  scaleRange: 0,
  rotationRange: 0,
  blurPeak: 0.35,
  blurPeakPhase: 0.5,
  distortionPeak: 0.2,
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
const frame = (index) => ({
  timeMs: index * summary.frameIntervalMs,
  lumaMean: 0.5,
  lumaStd: 0.3,
  exposure: index === 3 ? 0.7 : 0.45,
  sharpness: 0.5,
  edgeDensity: 0.25,
  chromaticSeparation: 0.04,
  alphaCoverage: 1,
  visualDensity: 0.3,
  frameDifference: index === 3 ? 0.45 : 0.05,
  structuralDifference: index === 3 ? 0.4 : 0.05,
  motionEnergy: index === 3 ? 0.5 : 0.03,
  motionDirection: { x: 1, y: 0 },
  subjectMotion: { x: 0.2, y: 0 },
  backgroundMotion: { x: 0.02, y: 0 },
  subjectBackgroundDivergence: index === 3 ? 0.18 : 0,
  displacementMagnitude: index === 3 ? 0.16 : 0.01,
  scale: 1,
  rotationDegrees: 0,
  perspectiveEnergy: 0,
  blurStrength: index === 3 ? 0.35 : 0.05,
  distortionStrength: index === 3 ? 0.2 : 0.02,
  subjectSeparation: index === 3 ? 0.42 : 0,
  overlapDensity: index === 3 ? 0.4 : 0,
  stateSeparation: index === 3 ? 0.08 : 0,
  temporalStateCount: index === 3 ? 4 : 1,
  occlusion: 0,
  maskCoverage: 0.25,
});

const referenceEvidence = {
  schema: "editflow.dense-effect-evidence.v1",
  sourceId: "reference:learning-transfer",
  sourceKind: "REFERENCE",
  range: { startMs: 0, endMs: 200 },
  analyzerFingerprint: "fixture-analyzer-v1",
  settingsFingerprint: "fixture-settings-v1",
  contentKey: "fixture-content",
  frames: Array.from({ length: 7 }, (_, index) => frame(index)),
  summary,
  evidenceRefs: ["fixture:reference"],
};

const reference = {
  referenceId: "finish:learning-transfer",
  styleFingerprint: "style:learning-transfer",
  shots: [{
    shotId: "shot:001",
    order: 0,
    referenceStartMs: 0,
    referenceEndMs: 500,
    evidenceRefs: ["shot:001"],
  }],
  evidenceRefs: ["reference:analysis"],
};
test("M6 Practice seeds a new reference with transferable Edit Type corrections", async () => {
  const family = classifyEffectFamilyV1(referenceEvidence);
  assert.notEqual(family, "UNKNOWN");
  const anatomy = deriveEffectAnatomyV1(referenceEvidence, family);
  const baseGraph = buildConstructionGraphV1(anatomy);
  const invariant = anatomy.dna.definingInvariants.find((candidate) => {
    const nodeId = baseGraph.invariantCoverage[candidate.invariantId]?.[0];
    const node = baseGraph.nodes.find((item) => item.nodeId === nodeId);
    return typeof node?.parameters[candidate.metric] === "number";
  });
  assert.ok(invariant);
  const nodeId = baseGraph.invariantCoverage[invariant.invariantId][0];
  const node = baseGraph.nodes.find((item) => item.nodeId === nodeId);
  const prior = node.parameters[invariant.metric];
  assert.equal(typeof prior, "number");

  const transferredSourcePatch = {
    patchId: "patch:mastered:1",
    invariantId: invariant.invariantId,
    nodeId,
    parameter: invariant.metric,
    previousValue: prior,
    nextValue: prior * 1.5,
    rationale: "Mastered Practice correction",
  };

  let capturedRequest = null;
  const brain = {
    async run(requestValue) {
      capturedRequest = requestValue;
      return {
        schema: "editflow.m6-production-result.v1",
        route: "VISUAL_INTELLIGENCE",
        status: "COMPLETED",
        correction: null,
        synthesis: null,
        evidenceRefs: requestValue.evidenceRefs,
      };
    },
  };
  const runtime = {
    availableCapabilities: [],
    async analyzeReference() {
      return referenceEvidence;
    },
    async prepareAttempt() {},
    async applyWindowGraph() {},
    async renderWindowEvidence() {
      throw new Error("custom brain should not render a window in this test");
    },
    async renderFullEdit() {
      return { renderRef: "render:learning-transfer", evidenceRefs: ["render:full"] };
    },
    async analyzeRender() {
      throw new Error("not used");
    },
    async evaluateContentStructure() {
      throw new Error("not used");
    },
  };
  const knowledge = {
    editTypeId: "spider-man-high-potency",
    title: "Spider-Man High Potency",
    revision: 4,
    masteredSessionCount: 1,
    totalSessionCount: 1,
    successfulConstructionIds: ["graph:passed"],
    failedConstructionIds: [],
    successfulSemanticPatches: [transferredSourcePatch],
    failedSemanticPatches: [],
    behaviorEvidence: [{
      evidenceId: "edit-type-evidence:mastered",
      sessionId: "practice:mastered",
      attempt: 2,
      outcome: "MASTERED_SUPPORT",
      cueIds: ["effect-window:mastered"],
      constructionIds: ["graph:passed"],
      rationaleCodes: [`M6_FAMILY_${family}`],
      semanticPatches: [transferredSourcePatch],
      overallSimilarity: 0.98,
      definingEffectCoverage: 1,
      elapsedMs: 900,
    }],
  };

  const bridge = new PracticeM6ExecutionBridgeV1(runtime, brain);
  await bridge.reconstruct({
    sessionId: "practice:new",
    editTypeId: knowledge.editTypeId,
    editTypeKnowledge: knowledge,
    attempt: 1,
    reference,
    baseline: {
      baselineId: "baseline:new",
      timelineRef: "ae:comp:new",
      evidenceRefs: ["baseline:new"],
    },
    matches: [],
    priorAttempts: [],
  });

  assert.ok(capturedRequest);
  assert.equal(capturedRequest.risk, "HIGH");
  assert.match(capturedRequest.learnedTechniqueId, /^edit-type:/);
  assert.ok(capturedRequest.learnedGraph);
  assert.ok(
    capturedRequest.evidenceRefs.some((item) =>
      item === "practice-edit-type-transferred-patches:1"),
  );

  const learnedNode = capturedRequest.learnedGraph.nodes
    .find((item) => item.nodeId === nodeId);
  assert.ok(learnedNode);
  assert.ok(learnedNode.parameters[invariant.metric] > prior);
});
