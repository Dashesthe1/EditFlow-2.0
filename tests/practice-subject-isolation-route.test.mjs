import assert from "node:assert/strict";
import test from "node:test";

import {
  PracticeM6SegmentationSubjectIsolationRouteV1,
  PRACTICE_M6_SAM31_SUBJECT_ISOLATION_ROUTE_ID_V1,
} from "../.tmp/runtime/apps/desktop-host/src/practice-m6-subject-isolation.js";

const reference = {
  referenceId: "finish:subject-isolation",
  sourcePath: "C:\\Practice\\finish.mp4",
  styleFingerprint: "style:test",
  video: {
    fps: 30,
    frameCount: 16,
    width: 1080,
    height: 1080,
    durationMs: 500,
  },
  shots: [{
    shotId: "shot:001",
    order: 0,
    referenceStartMs: 0,
    referenceEndMs: 500,
    evidenceRefs: ["reference-shot:001"],
  }],
  evidenceRefs: ["reference:proof"],
};

const sourceMatch = {
  shotId: "shot:001",
  sourceId: "raw:001",
  sourcePath: "C:\\Practice\\raw.mp4",
  sourceStartMs: 1000,
  sourceEndMs: 1500,
  direction: "FORWARD",
  playbackRate: 1,
  appearanceSimilarity: 0.98,
  temporalSimilarity: 0.97,
  motionSimilarity: 0.95,
  confidence: 0.99,
  evidenceRefs: ["source-video:sha256:raw001"],
};
const baselinePlan = {
  schema: "editflow.practice-ae-baseline-plan.v1",
  baselineId: "baseline:subject-isolation",
  referenceId: reference.referenceId,
  compStableId: "PRACTICE_COMP_ISOLATION",
  durationMs: 500,
  frameRate: 30,
  audioMatchId: null,
  operations: [{
    operationId: "baseline:subject-isolation:timing",
    command: "layer.set_timing",
    capabilityId: "ae.layer.timing.set",
    payload: {
      comp: { stableId: "PRACTICE_COMP_ISOLATION" },
      layer: { stableId: "PRACTICE_SHOT_ISOLATION_0001" },
      timing: {
        startTime: -1,
        inPoint: 0,
        outPoint: 0.5,
        stretch: 100,
      },
    },
  }],
  evidenceRefs: ["baseline:proof"],
};

const window = {
  windowId: "window:subject-isolation",
  startIndex: 0,
  endIndex: 3,
  anchorIndex: 1,
  startMs: 100,
  endMs: 200,
  anchorMs: 133.33333333333334,
  peakEnergy: 0.8,
  evidence: {
    schema: "editflow.dense-effect-evidence.v1",
    sourceId: reference.referenceId,
    sourceKind: "REFERENCE",
    range: { startMs: 100, endMs: 200 },
    analyzerFingerprint: "analyzer",
    settingsFingerprint: "settings",
    contentKey: "content",
    frames: [{
      timeMs: 133.33333333333334,
      subjectSemanticId: "subject:peter",
      subjectTrackState: "OBSERVED",
      subjectIdentityConfidence: 0.99,
      subjectVisibility: 1,
      subjectBoundingBox: [0.25, 0.12, 0.5, 0.78],
    }],
    summary: { frameIntervalMs: 33.333333333333336 },
    evidenceRefs: ["dense:proof"],
  },
};
const materialFor = (request) => {
  const frames = Array.from({ length: request.frameCount }, (_, index) => {
    const sha = String(index + 1).padStart(64, "a").slice(0, 64);
    return {
      frameIndex: index,
      artifactId: "mask:" + String(index),
      absolutePath: "C:\\Masks\\subject_"
        + String(index).padStart(4, "0") + ".png",
      contentType: "image/png",
      sha256: sha,
      evidenceIds: ["mask-frame:" + String(index)],
    };
  });
  return {
    requestId: request.requestId,
    sourceId: request.sourceId,
    semanticId: request.semanticId,
    frameRate: request.frameRate,
    frameCount: request.frameCount,
    frames,
    evidenceIds: ["mask-sequence:verified"],
  };
};

const resultFor = (request, material) => ({
  requestId: request.requestId,
  sourceId: request.sourceId,
  semanticId: request.semanticId,
  providerId: "sam3.1.local",
  providerVersion: "sam3.1:test",
  startTimestampMs: request.startTimestampMs,
  startFrameIndex: request.startFrameIndex,
  frameRate: request.frameRate,
  frameCount: request.frameCount,
  frames: material.frames.map((frame, index) => ({
    frameIndex: index,
    timestampMs: request.startTimestampMs + index * 1000 / request.frameRate,
    mask: {
      encoding: "ALPHA",
      width: 1920,
      height: 1080,
      boundsNormalized: [0, 0, 1, 1],
      artifact: {
        artifactId: frame.artifactId,
        contentType: frame.contentType,
        sha256: frame.sha256,
      },
    },
    confidence: 0.98,
    edgeQuality: 0.95,
    temporalConsistency: 0.96,
    occlusion: 0.02,
    evidenceIds: frame.evidenceIds,
  })),
  evidenceIds: ["mask-sequence:verified"],
});
const binding = {
  schema: "editflow.practice-cross-source-subject-binding.v1",
  algorithmId: "test-binder",
  verified: true,
  reason: null,
  referenceSemanticId: "subject:peter",
  sourceSemanticId: "practice-source-subject:raw:001:peter",
  referenceSubjectBox: [0.25, 0.12, 0.5, 0.78],
  sourceSubjectBox: [0.2, 0.1, 0.48, 0.8],
  sourceVideo: {
    fps: 30,
    frameCount: 300,
    width: 1920,
    height: 1080,
    durationMs: 10000,
    sampleTimeMs: 1133.3333333333333,
  },
  confidence: 0.92,
  evidenceRefs: ["cross-source-binding:verified"],
};

const makeRoute = ({ bindingOverride, baselineOverride } = {}) => {
  let material = null;
  let providerCalls = 0;
  let capturedPlan = null;
  const route = new PracticeM6SegmentationSubjectIsolationRouteV1({
    runtimeGate: {
      async verify() {
        return ["sam31-runtime-proof:test"];
      },
    },
    media: {
      async bindCrossSourceSubject() {
        return bindingOverride ?? binding;
      },
    },
    provider: {
      async segmentSequence(request) {
        providerCalls += 1;
        material = materialFor(request);
        return resultFor(request, material);
      },
      resolveSequence() {
        return material;
      },
    },
    transaction: {
      maxOperations: 64,
      async observe() {
        return {
          projectId: "project",
          projectRevision: "1",
          projectFingerprint: "project-fingerprint",
          environmentFingerprint: "environment-fingerprint",
        };
      },
      async execute(plan) {
        capturedPlan = plan;
        return {
          transactionId: "tx:subject-isolation",
          state: "COMMITTED",
          recovered: false,
          appliedOperations: plan.operations.length,
        };
      },
      async executeCorrection(plan) {
        return this.execute(plan);
      },
    },
  });
  return {
    route,
    get providerCalls() { return providerCalls; },
    get capturedPlan() { return capturedPlan; },
    baseline: baselineOverride ?? baselinePlan,
  };
};
const prepareInput = (baseline = baselinePlan) => ({
  sessionId: "practice:subject-isolation",
  attempt: 1,
  reference,
  sourceMatch,
  baselinePlan: baseline,
  window,
  shotId: "shot:001",
  compStableId: "PRACTICE_COMP_ISOLATION",
  layerId: "PRACTICE_SHOT_ISOLATION_0001",
  startMs: 100,
  endMs: 200,
  referenceSemanticId: "subject:peter",
});

test("Practice subject isolation binds raw identity, accepts temporal SAM proof, and materializes one native AE matte transaction", async () => {
  const harness = makeRoute();
  const proof = await harness.route.prepare(prepareInput(harness.baseline));

  assert.equal(proof.verified, true);
  assert.equal(proof.routeId, PRACTICE_M6_SAM31_SUBJECT_ISOLATION_ROUTE_ID_V1);
  assert.equal(proof.crossSourceIdentityVerified, true);
  assert.equal(proof.maskSource, "SEGMENTATION");
  assert.equal(proof.referenceSemanticId, "subject:peter");
  assert.equal(proof.sourceSemanticId, binding.sourceSemanticId);
  assert.equal(harness.providerCalls, 1);
  assert.ok(harness.capturedPlan);
  assert.deepEqual(
    harness.capturedPlan.operations.map((operation) => operation.input.command),
    [
      "media.sequence.import",
      "layer.add_media",
      "layer.set_transform",
      "layer.set_timing",
      "layer.set_track_matte",
    ],
  );
  assert.match(JSON.stringify(harness.capturedPlan), /PRACTICE_SHOT_ISOLATION_0001/);
  assert.ok(proof.evidenceRefs.some((item) =>
    item === "cross-source-binding:verified"));
  assert.ok(proof.evidenceRefs.some((item) =>
    item.includes("tx:subject-isolation:COMMITTED")));
});

test("Practice subject isolation keeps a temporal SAM matte locked to measured shot framing", async () => {
  const framedBaseline = {
    ...baselinePlan,
    operations: [
      ...baselinePlan.operations,
      {
        operationId: "baseline:subject-isolation:position",
        command: "property.set_keyframes",
        capabilityId: "ae.keyframe.set",
        payload: {
          comp: { stableId: "PRACTICE_COMP_ISOLATION" },
          layer: { stableId: "PRACTICE_SHOT_ISOLATION_0001" },
          propertyPath: ["ADBE Transform Group", "ADBE Position"],
          keyframes: [
            { time: 0, value: [540, 540] },
            { time: 0.25, value: [590, 520] },
            { time: 0.5, value: [640, 500] },
          ],
        },
      },
      {
        operationId: "baseline:subject-isolation:scale",
        command: "property.set_keyframes",
        capabilityId: "ae.keyframe.set",
        payload: {
          comp: { stableId: "PRACTICE_COMP_ISOLATION" },
          layer: { stableId: "PRACTICE_SHOT_ISOLATION_0001" },
          propertyPath: ["ADBE Transform Group", "ADBE Scale"],
          keyframes: [
            { time: 0, value: [100, 100] },
            { time: 0.25, value: [112, 112] },
            { time: 0.5, value: [124, 124] },
          ],
        },
      },
      {
        operationId: "baseline:subject-isolation:rotation",
        command: "property.set_keyframes",
        capabilityId: "ae.keyframe.set",
        payload: {
          comp: { stableId: "PRACTICE_COMP_ISOLATION" },
          layer: { stableId: "PRACTICE_SHOT_ISOLATION_0001" },
          propertyPath: ["ADBE Transform Group", "ADBE Rotate Z"],
          keyframes: [
            { time: 0, value: 0 },
            { time: 0.25, value: 1.5 },
            { time: 0.5, value: 3 },
          ],
        },
      },
      {
        operationId: "baseline:subject-isolation:position-spatial",
        command: "property.spatial_graph.set",
        capabilityId: "ae.property.spatial_graph.set",
        payload: {
          comp: { stableId: "PRACTICE_COMP_ISOLATION" },
          layer: { stableId: "PRACTICE_SHOT_ISOLATION_0001" },
          propertyPath: ["ADBE Transform Group", "ADBE Position"],
          keyIndex: 2,
          state: {
            mode: "MANUAL",
            inTangent: [-18, 8],
            outTangent: [24, -10],
            continuous: true,
            roving: false,
          },
        },
      },
      {
        operationId: "baseline:subject-isolation:scale-interpolation",
        command: "property.temporal_interpolation.set",
        capabilityId: "ae.property.temporal_interpolation.set",
        payload: {
          comp: { stableId: "PRACTICE_COMP_ISOLATION" },
          layer: { stableId: "PRACTICE_SHOT_ISOLATION_0001" },
          propertyPath: ["ADBE Transform Group", "ADBE Scale"],
          keyIndex: 2,
          interpolation: {
            inType: "BEZIER",
            outType: "BEZIER",
            temporalContinuous: false,
            temporalAutoBezier: false,
          },
        },
      },
      {
        operationId: "baseline:subject-isolation:scale-ease",
        command: "property.temporal_ease.set",
        capabilityId: "ae.property.temporal_ease.set",
        payload: {
          comp: { stableId: "PRACTICE_COMP_ISOLATION" },
          layer: { stableId: "PRACTICE_SHOT_ISOLATION_0001" },
          propertyPath: ["ADBE Transform Group", "ADBE Scale"],
          keyIndex: 2,
          easeIntent: {
            inEase: { speed: 72, influence: 61 },
            outEase: { speed: 54, influence: 73 },
          },
        },
      },
    ],
  };
  const harness = makeRoute({ baselineOverride: framedBaseline });
  const proof = await harness.route.prepare(prepareInput(framedBaseline));

  const syncOperations = harness.capturedPlan.operations.slice(5);
  assert.deepEqual(
    syncOperations.map((operation) => operation.input.command),
    [
      "property.set_keyframes",
      "property.set_keyframes",
      "property.set_keyframes",
      "property.spatial_graph.set",
      "property.temporal_interpolation.set",
      "property.temporal_ease.set",
    ],
  );
  assert.equal(syncOperations.length, 6);
  assert.ok(syncOperations.every((operation) =>
    operation.input.payload.layer.stableId.startsWith("PRACTICE_MATTE_LAYER_")));
  assert.ok(syncOperations.every((operation) =>
    operation.input.payload.layer.stableId !== "PRACTICE_SHOT_ISOLATION_0001"));
  assert.deepEqual(
    syncOperations[0].input.payload.keyframes,
    framedBaseline.operations[1].payload.keyframes,
  );
  assert.deepEqual(
    syncOperations[3].input.payload.state,
    framedBaseline.operations[4].payload.state,
  );
  assert.deepEqual(
    syncOperations[5].input.payload.easeIntent,
    framedBaseline.operations[6].payload.easeIntent,
  );
  assert.ok(harness.capturedPlan.requiredCapabilities.includes("ae.keyframe.set"));
  assert.ok(harness.capturedPlan.requiredCapabilities.includes(
    "ae.property.spatial_graph.set",
  ));
  assert.ok(proof.evidenceRefs.includes(
    "practice-subject-isolation-framing-sync-count:6",
  ));
  assert.ok(proof.evidenceRefs.includes(
    "practice-subject-isolation-framing-sync:baseline:subject-isolation:position",
  ));
});

test("Practice subject isolation rejects unverified Finish-to-raw identity before SAM or AE mutation", async () => {
  const harness = makeRoute({
    bindingOverride: {
      ...binding,
      verified: false,
      reason: "CROSS_SOURCE_IDENTITY_BELOW_PROOF_FLOOR",
      sourceSemanticId: null,
      sourceSubjectBox: null,
    },
  });
  await assert.rejects(
    () => harness.route.prepare(prepareInput(harness.baseline)),
    /PRACTICE_SUBJECT_ISOLATION_CROSS_SOURCE_BINDING_REJECTED/,
  );
  assert.equal(harness.providerCalls, 0);
  assert.equal(harness.capturedPlan, null);
});
test("Practice subject isolation fails closed instead of desynchronizing a Time Remap shot", async () => {
  const remappedBaseline = {
    ...baselinePlan,
    operations: [
      ...baselinePlan.operations,
      {
        operationId: "baseline:subject-isolation:remap",
        command: "layer.time_remap.enable",
        capabilityId: "ae.layer.time_remap.enable",
        payload: {
          comp: { stableId: "PRACTICE_COMP_ISOLATION" },
          layer: { stableId: "PRACTICE_SHOT_ISOLATION_0001" },
        },
      },
    ],
  };
  const harness = makeRoute({ baselineOverride: remappedBaseline });
  await assert.rejects(
    () => harness.route.prepare(prepareInput(remappedBaseline)),
    /PRACTICE_SUBJECT_ISOLATION_TIME_REMAP_UNSUPPORTED/,
  );
  assert.equal(harness.providerCalls, 0);
  assert.equal(harness.capturedPlan, null);
});
