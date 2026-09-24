import assert from "node:assert/strict";
import test from "node:test";

import {
  PRACTICE_M6_TRACKED_MASK_SUBJECT_ISOLATION_ROUTE_ID_V1,
  PracticeM6TrackedMaskSubjectIsolationRouteV1,
} from "../.tmp/runtime/apps/desktop-host/src/practice-m6-tracked-mask-subject-isolation.js";
import {
  PracticeSubjectIsolationBackendFailureV1,
} from "../.tmp/runtime/apps/desktop-host/src/practice-m6-subject-isolation-router.js";

const reference = {
  referenceId: "finish:tracked-mask",
  sourcePath: "C:\\Practice\\finish.mp4",
  styleFingerprint: "style:test",
  video: { fps: 30, frameCount: 15, width: 1080, height: 1080, durationMs: 500 },
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
  evidenceRefs: ["source:proof"],
};

const baselinePlan = {
  schema: "editflow.practice-ae-baseline-plan.v1",
  baselineId: "baseline:tracked-mask",
  referenceId: reference.referenceId,
  compStableId: "PRACTICE_COMP_TRACKED",
  durationMs: 500,
  frameRate: 30,
  audioMatchId: null,
  operations: [{
    operationId: "baseline:tracked:timing",
    command: "layer.set_timing",
    capabilityId: "ae.layer.timing.set",
    payload: {
      comp: { stableId: "PRACTICE_COMP_TRACKED" },
      layer: { stableId: "PRACTICE_SHOT_TRACKED_0001" },
      timing: { startTime: -1, inPoint: 0, outPoint: 0.5, stretch: 100 },
    },
  }],
  evidenceRefs: ["baseline:proof"],
};

const window = {
  windowId: "window:tracked",
  startIndex: 0,
  endIndex: 3,
  anchorIndex: 1,
  startMs: 100,
  endMs: 200,
  anchorMs: 133.33333333333334,
  peakEnergy: 0.9,
  evidence: {
    schema: "editflow.dense-effect-evidence.v1",
    sourceId: reference.referenceId,
    sourceKind: "REFERENCE",
    range: { startMs: 100, endMs: 200 },
    analyzerFingerprint: "analyzer",
    settingsFingerprint: "settings",
    contentKey: "content",
    frames: [{
      timeMs: 100,
      subjectSemanticId: "subject:peter",
      subjectTrackState: "OBSERVED",
      subjectIdentityConfidence: 0.98,
      subjectVisibility: 1,
      subjectBoundingBox: [0.25, 0.12, 0.5, 0.78],
    }],
    summary: { frameIntervalMs: 33.333333333333336 },
    evidenceRefs: ["dense:proof"],
  },
};

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
    sampleTimeMs: 1100,
  },
  confidence: 0.95,
  evidenceRefs: ["cross-source-binding:verified"],
};

const prepareInput = () => ({
  sessionId: "practice:tracked-mask",
  attempt: 1,
  reference,
  sourceMatch,
  baselinePlan,
  window,
  shotId: "shot:001",
  compStableId: "PRACTICE_COMP_TRACKED",
  layerId: "PRACTICE_SHOT_TRACKED_0001",
  startMs: 100,
  endMs: 200,
  referenceSemanticId: "subject:peter",
});

const makeHarness = ({ finalLastKeyTime = 0.2 } = {}) => {
  const state = { maskCreated: false };
  const plans = [];
  const trackerCalls = [];
  const binderCalls = [];
  const prepareCalls = [];
  const transport = {
    async dispatch(request) {
      if (request.command !== "project.inspect") {
        throw new Error("Unexpected transport request: " + String(request.command));
      }
      return {
        outcome: "NO_OP",
        hostProjectRevision: 10,
        projectSnapshot: {
          items: [{
            kind: "COMPOSITION",
            stableId: "PRACTICE_COMP_TRACKED",
            hostId: 101,
            name: "Practice Comp",
            composition: {
              layers: [{
                stableId: "PRACTICE_SHOT_TRACKED_0001",
                hostId: 201,
                name: "Practice Shot",
              }],
            },
          }],
        },
      };
    },
  };
  const transaction = {
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
      plans.push(plan);
      const command = plan.operations[0].input.command;
      if (command === "mask.create") state.maskCreated = true;
      if (command === "mask.remove") state.maskCreated = false;
      return {
        transactionId: "tx:" + plans.length,
        state: "COMMITTED",
        recovered: false,
        appliedOperations: 1,
      };
    },
    async executeCorrection(plan) {
      return this.execute(plan);
    },
  };
  const route = new PracticeM6TrackedMaskSubjectIsolationRouteV1({
    transaction,
    transport,
    media: {
      async bindCrossSourceSubject(request) {
        binderCalls.push(request);
        return binding;
      },
    },
    runtimeGate: {
      async verify() {
        return ["m4-mask-tracking-proof:test"];
      },
    },
    targetPreparer: {
      async prepare(request) {
        prepareCalls.push(request);
        return {
          atTimeSeconds: request.atTimeSeconds,
          frameDuration: 1 / 30,
          duration: 0.5,
          evidenceRefs: ["tracked-mask-target:prepared"],
        };
      },
    },
    trackerFactory: {
      create(input) {
        return {
          async run(request) {
            trackerCalls.push({ input, request });
            return {
              route: "LOCAL",
              baselinePathKeyCount: 0,
              finalPathKeyCount: 4,
              baselineLastKeyTime: null,
              finalLastKeyTime,
              visualEvidenceId: "tracked-mask-visual:1",
              escalationReason: null,
            };
          },
        };
      },
    },
  });
  return {
    route,
    state,
    plans,
    trackerCalls,
    binderCalls,
    prepareCalls,
  };
};

test("Practice tracked-mask fallback binds identity and accepts only native Mask Path coverage", async () => {
  const harness = makeHarness();
  const proof = await harness.route.prepare(prepareInput());

  assert.equal(
    proof.routeId,
    PRACTICE_M6_TRACKED_MASK_SUBJECT_ISOLATION_ROUTE_ID_V1,
  );
  assert.equal(proof.maskSource, "AE_TRACKED_MASK");
  assert.equal(proof.crossSourceIdentityVerified, true);
  assert.equal(proof.targetBindingVerified, true);
  assert.equal(proof.targetShotId, "shot:001");
  assert.equal(proof.targetCompStableId, "PRACTICE_COMP_TRACKED");
  assert.equal(proof.targetLayerStableId, "PRACTICE_SHOT_TRACKED_0001");
  assert.equal(proof.appliedOperations, 2);
  assert.equal(harness.state.maskCreated, true);
  assert.equal(harness.binderCalls.length, 1);
  assert.equal(harness.binderCalls[0].referenceTimeMs, 100);
  assert.equal(harness.prepareCalls[0].atTimeSeconds, 0.1);
  assert.equal(harness.trackerCalls.length, 1);
  assert.equal(harness.trackerCalls[0].request.direction, "FORWARD");
  assert.deepEqual(
    harness.plans.map((plan) => plan.operations[0].input.command),
    ["mask.create"],
  );
  const createPayload = harness.plans[0].operations[0].input.payload;
  assert.equal(createPayload.properties.mode, "ADD");
  assert.equal(createPayload.shape.vertices.length, 4);
  assert.ok(proof.evidenceRefs.includes("cross-source-binding:verified"));
  assert.ok(proof.evidenceRefs.includes(
    "practice-tracked-mask-applied-undo-entries:2",
  ));
});

test("Practice tracked-mask fallback fails closed and removes its owned mask when coverage is incomplete", async () => {
  const harness = makeHarness({ finalLastKeyTime: 0.1 });
  const failure = await harness.route.prepare(prepareInput()).then(
    () => null,
    (error) => error,
  );
  assert.ok(failure instanceof PracticeSubjectIsolationBackendFailureV1);
  assert.match(failure.message, /PRACTICE_TRACKED_MASK_COVERAGE_INCOMPLETE/);
  assert.equal(failure.appliedOperations, 3);
  assert.equal(failure.fallbackSafe, true);
  assert.equal(harness.state.maskCreated, false);
  assert.deepEqual(
    harness.plans.map((plan) => plan.operations[0].input.command),
    ["mask.create", "mask.remove"],
  );
});
