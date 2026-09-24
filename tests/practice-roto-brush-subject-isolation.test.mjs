import assert from "node:assert/strict";
import test from "node:test";

import {
  PRACTICE_M6_ROTO_BRUSH_SUBJECT_ISOLATION_ROUTE_ID_V1,
  PracticeM6RotoBrushSubjectIsolationRouteV1,
} from "../.tmp/runtime/apps/desktop-host/src/practice-m6-roto-brush-subject-isolation.js";

const reference = {
  referenceId: "finish:roto",
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
  baselineId: "baseline:roto",
  referenceId: reference.referenceId,
  compStableId: "PRACTICE_COMP_ROTO",
  durationMs: 500,
  frameRate: 30,
  audioMatchId: null,
  operations: [{
    operationId: "baseline:roto:timing",
    command: "layer.set_timing",
    capabilityId: "ae.layer.timing.set",
    payload: {
      comp: { stableId: "PRACTICE_COMP_ROTO" },
      layer: { stableId: "PRACTICE_SHOT_ROTO_0001" },
      timing: { startTime: -1, inPoint: 0, outPoint: 0.5, stretch: 100 },
    },
  }],
  evidenceRefs: ["baseline:proof"],
};

const window = {
  windowId: "window:roto",
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
    frames: [
      {
        timeMs: 50,
        subjectSemanticId: "subject:peter",
        subjectTrackState: "OBSERVED",
        subjectIdentityConfidence: 1,
        subjectVisibility: 1,
        subjectBoundingBox: [0.1, 0.1, 0.8, 0.8],
      },
      {
        timeMs: 133.33333333333334,
        subjectSemanticId: "subject:peter",
        subjectTrackState: "OBSERVED",
        subjectIdentityConfidence: 0.98,
        subjectVisibility: 1,
        subjectBoundingBox: [0.25, 0.12, 0.5, 0.78],
      },
    ],
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
    sampleTimeMs: 1133.3333333333333,
  },
  confidence: 0.95,
  evidenceRefs: ["cross-source-binding:verified"],
};

const prepareInput = () => ({
  sessionId: "practice:roto",
  attempt: 1,
  reference,
  sourceMatch,
  baselinePlan,
  window,
  shotId: "shot:001",
  compStableId: "PRACTICE_COMP_ROTO",
  layerId: "PRACTICE_SHOT_ROTO_0001",
  startMs: 100,
  endMs: 200,
  referenceSemanticId: "subject:peter",
});

const makeHarness = ({ exportAccepted = true } = {}) => {
  const state = {
    workStableId: null,
    workCreated: false,
    preparedTime: 4 / 30,
  };
  const plans = [];
  const binderCalls = [];
  const seedCalls = [];
  const propagationCalls = [];
  const exportCalls = [];
  const projectSnapshot = () => ({
    items: [{
      kind: "COMPOSITION",
      stableId: "PRACTICE_COMP_ROTO",
      hostId: 101,
      name: "Practice Comp",
      composition: {
        layers: [
          {
            stableId: "PRACTICE_SHOT_ROTO_0001",
            hostId: 201,
            name: "Original Layer",
          },
          ...(state.workCreated && state.workStableId
            ? [{
                stableId: state.workStableId,
                hostId: 202,
                name: "Working Layer",
              }]
            : []),
        ],
      },
    }],
  });

  const transport = {
    async dispatch(request) {
      if (request.command === "project.inspect") {
        return {
          outcome: "NO_OP",
          projectSnapshot: projectSnapshot(),
          hostProjectRevision: 9,
        };
      }
      if (request.command === "roto_brush.readback") {
        return {
          outcome: "NO_OP",
          readback: {
            comp: {
              hostId: 101,
              name: "Practice Comp",
              time: state.preparedTime,
              frameDuration: 1 / 30,
              duration: 0.5,
            },
            layer: {
              hostId: 202,
              name: "Working Layer",
            },
          },
        };
      }
      throw new Error("Unexpected transport request: " + String(request.command));
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
      for (const operation of plan.operations) {
        const command = operation.input.command;
        const payload = operation.input.payload;
        if (command === "layer.duplicate") {
          state.workStableId = payload.stableId;
          state.workCreated = true;
        } else if (command === "layer.remove"
          && payload.layer?.stableId === state.workStableId) {
          state.workCreated = false;
        }
      }
      return {
        transactionId: "tx:" + String(plans.length),
        state: "COMMITTED",
        recovered: false,
        appliedOperations: plan.operations.length,
      };
    },
    async executeCorrection(plan) {
      return this.execute(plan);
    },
  };

  const route = new PracticeM6RotoBrushSubjectIsolationRouteV1({
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
        return ["m5-roto-runtime-proof:test"];
      },
    },
    targetPreparer: {
      async prepare(request) {
        state.preparedTime = Math.round(request.atTimeSeconds * 30) / 30;
        return {
          atTimeSeconds: state.preparedTime,
          evidenceRefs: ["roto-target:prepared"],
        };
      },
    },
    seedController: {
      async run(request) {
        seedCalls.push(request);
        return {
          route: "LOCAL",
          finalEffectMatchCount: 1,
          finalSessionRevision: "roto-session:1",
          visualEvidenceId: "seed-visual:1",
          escalationReason: null,
        };
      },
    },
    propagationController: {
      async run(request) {
        propagationCalls.push(request);
        return {
          route: "LOCAL",
          expectedFrameSteps: Math.round(
            Math.abs(request.range.endTime - request.range.startTime) * 30,
          ),
          escalationReason: null,
        };
      },
    },
    exportController: {
      async run(request) {
        exportCalls.push(request);
        return exportAccepted
          ? {
              route: "LOCAL",
              structuralOutputVerified: true,
              nativeRotoOutputVerified: true,
              outputLayerHostId: 203,
              escalationReason: null,
            }
          : {
              route: "ESCALATED",
              structuralOutputVerified: false,
              nativeRotoOutputVerified: false,
              outputLayerHostId: null,
              escalationReason: "EXPORT_UNVERIFIED",
            };
      },
    },
  });

  return {
    route,
    state,
    plans,
    binderCalls,
    seedCalls,
    propagationCalls,
    exportCalls,
  };
};

test("Practice Roto fallback binds the matched subject, propagates both ways, and returns undo-accounted proof", async () => {
  const harness = makeHarness();
  const proof = await harness.route.prepare(prepareInput());

  assert.equal(proof.routeId, PRACTICE_M6_ROTO_BRUSH_SUBJECT_ISOLATION_ROUTE_ID_V1);
  assert.equal(proof.maskSource, "ROTO_BRUSH");
  assert.equal(proof.appliedOperations, 5);
  assert.equal(proof.crossSourceIdentityVerified, true);
  assert.equal(proof.targetBindingVerified, true);
  assert.equal(proof.targetShotId, "shot:001");
  assert.equal(proof.targetCompStableId, "PRACTICE_COMP_ROTO");
  assert.equal(proof.targetLayerStableId, "PRACTICE_SHOT_ROTO_0001");
  assert.equal(harness.binderCalls.length, 1);
  assert.equal(harness.binderCalls[0].referenceTimeMs, 133.33333333333334);
  assert.equal(harness.seedCalls.length, 1);
  assert.equal(harness.seedCalls[0].operation, "SEED_FOREGROUND");
  assert.deepEqual(
    harness.propagationCalls.map((call) => call.operation).sort(),
    ["PROPAGATE_BACKWARD", "PROPAGATE_FORWARD"],
  );
  assert.equal(harness.exportCalls.length, 1);
  assert.equal(harness.exportCalls[0].export.kind, "TRACK_MATTE");
  assert.deepEqual(
    harness.plans.map((plan) => plan.operations.map((op) => op.input.command)),
    [
      ["layer.duplicate"],
      ["layer.set_track_matte", "layer.remove"],
    ],
  );
  assert.equal(harness.state.workCreated, false);
  assert.ok(proof.evidenceRefs.includes("cross-source-binding:verified"));
  assert.ok(proof.evidenceRefs.includes("practice-roto-applied-undo-entries:5"));
});

test("Practice Roto fallback cleans its proof-owned working layer when export proof fails", async () => {
  const harness = makeHarness({ exportAccepted: false });
  await assert.rejects(
    () => harness.route.prepare(prepareInput()),
    /PRACTICE_ROTO_EXPORT_REJECTED:EXPORT_UNVERIFIED/,
  );
  assert.equal(harness.state.workCreated, false);
  assert.deepEqual(
    harness.plans.at(-1).operations.map((op) => op.input.command),
    ["layer.remove"],
  );
});
