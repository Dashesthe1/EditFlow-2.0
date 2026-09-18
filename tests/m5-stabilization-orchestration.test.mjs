import test from "node:test";
import assert from "node:assert/strict";

import {
  AeCepCurrentTransactionalHostV1,
  GUARDED_STABILIZATION_RECOVERY_UNDO_LIMIT_V1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/current-transactional-host.js";
import {
  M4_STABILIZATION_GUARDED_ROUTE_ID_V1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-stabilization.js";

const environmentProbe = {
  adapterProtocolVersion: "1.1.0",
  adapterBuild: "test-stabilization-orchestration",
  hostName: "Adobe After Effects",
  hostVersion: "25.6.6x4",
  hostBuild: "4",
  os: "Windows test",
  projectOpen: true,
};

const property = (name, matchName, keyCount = 0) => ({
  name,
  matchName,
  keyCount,
  samples: Array.from({ length: keyCount }, (_, index) => ({
    time: index / 30,
    value: [500 + index, 500 - index, 0],
  })),
});

const stabilizationReadback = (trackerKeyCount, anchorKeyCount) => ({
  comp: { stableId: "COMP", hostId: 14, name: "Hero Comp", width: 1080, height: 1080 },
  layer: { stableId: "LAYER", hostId: 26, name: "Hero Layer", index: 1 },
  trackers: trackerKeyCount > 0
    ? [{
        trackerIndex: 1,
        name: "Tracker 1",
        matchName: "ADBE MTracker",
        pointIndex: 1,
        pointName: "Track Point 1",
        featureCenterKeyCount: trackerKeyCount,
        confidenceKeyCount: trackerKeyCount,
        attachPointKeyCount: trackerKeyCount,
      }]
    : [],
  transform: {
    anchorPoint: property("Anchor Point", "ADBE Anchor Point", anchorKeyCount),
    position: property("Position", "ADBE Position"),
    scale: property("Scale", "ADBE Scale"),
    rotation: property("Rotation", "ADBE Rotate Z"),
  },
});

const responseFor = (request, overrides = {}) => ({
  protocolVersion: request.protocolVersion,
  requestId: request.requestId,
  transactionId: request.transactionId,
  operationId: request.operationId,
  capabilityId: request.capabilityId,
  command: request.command,
  outcome: "NO_OP",
  error: null,
  affectedObjects: [],
  readback: null,
  projectSnapshot: null,
  environmentProbe: null,
  hostProjectRevision: null,
  diagnostics: {
    adapterProtocolVersion: request.protocolVersion,
    adapterBuild: "test-stabilization-orchestration",
    command: request.command,
    notes: [],
  },
  proofArtifactRefs: [],
  ...overrides,
});

class StabilizationTransport {
  constructor() {
    this.hostRevision = 20;
    this.trackerKeyCount = 0;
    this.anchorKeyCount = 0;
    this.requests = [];
    this.undoCalls = 0;
  }

  async dispatch(request) {
    this.requests.push(structuredClone(request));
    if (request.command === "host.probe") {
      return responseFor(request, {
        environmentProbe,
        hostProjectRevision: this.hostRevision,
      });
    }
    if (request.command === "project.inspect") {
      return responseFor(request, {
        projectSnapshot: {
          hostRevision: this.hostRevision,
          filePath: "C:/EditFlow/stabilization-orchestration.aep",
          activeItemHostId: 14,
          itemCount: 1,
          items: [{
            hostId: 14,
            stableId: "COMP",
            kind: "COMPOSITION",
            name: "Hero Comp",
            parentHostId: null,
            comment: "",
            composition: {
              hostId: 14,
              stableId: "COMP",
              name: "Hero Comp",
              width: 1080,
              height: 1080,
              pixelAspect: 1,
              duration: 4,
              frameRate: 30,
              displayStartTime: 0,
              layers: [],
            },
          }],
        },
        hostProjectRevision: this.hostRevision,
      });
    }
    if (request.command === "readback.object") {
      if (request.payload.kind === "COMPOSITION") {
        return responseFor(request, {
          readback: {
            composition: {
              hostId: 14,
              stableId: "COMP",
              name: "Hero Comp",
              width: 1080,
              height: 1080,
            },
          },
          hostProjectRevision: this.hostRevision,
        });
      }
      return responseFor(request, {
        readback: {
          layer: {
            hostId: 26,
            stableId: "LAYER",
            name: "Hero Layer",
            transform: {
              anchorPoint: [540, 540],
              position: [540, 540],
              scale: [100, 100],
            },
          },
        },
        hostProjectRevision: this.hostRevision,
      });
    }
    if (request.command === "stabilization.readback") {
      return responseFor(request, {
        readback: stabilizationReadback(this.trackerKeyCount, this.anchorKeyCount),
        hostProjectRevision: this.hostRevision,
      });
    }
    if (request.command === "transaction.undo_last") {
      this.undoCalls += 1;
      this.trackerKeyCount = 0;
      this.anchorKeyCount = 0;
      this.hostRevision += 1;
      return responseFor(request, {
        outcome: "APPLIED",
        readback: { undone: true },
        hostProjectRevision: this.hostRevision,
      });
    }
    throw new Error(`Unexpected test command '${request.command}'.`);
  }

  mutateStabilization(trackerKeyCount, anchorKeyCount) {
    this.trackerKeyCount = trackerKeyCount;
    this.anchorKeyCount = anchorKeyCount;
    this.hostRevision += 1;
  }
}

const stabilizationOperation = {
  operationId: "OP_STABILIZE",
  capabilityId: "ae.stabilization.position.guarded_visual",
  routeId: String(M4_STABILIZATION_GUARDED_ROUTE_ID_V1),
  dependsOn: [],
  idempotency: "CHECK_THEN_APPLY",
  riskClass: "R4_EXTERNAL_UI",
  input: {
    command: "stabilization.position.guarded_visual",
    payload: {
      comp: { stableId: "COMP" },
      layer: { stableId: "LAYER" },
      direction: "FORWARD",
      mode: "POSITION_XY",
      trackFeaturePolicy: "PERSISTENT_HIGH_CONTRAST_HEAD_FEATURE",
      minimumTrackConfidence: 0.75,
    },
  },
  rollbackBoundaryId: "STABILIZATION_BOUNDARY",
};

test("current AE host resolves semantic targets before guarded stabilization and requires a checkpoint", async () => {
  const transport = new StabilizationTransport();
  let captured = null;
  const driver = {
    driverId: "TEST_STABILIZATION_VISUAL",
    verifiedVision: true,
    verifiedCursorControl: true,
    supportedDirections: ["FORWARD"],
    async stabilize(request) {
      captured = structuredClone(request);
      transport.mutateStabilization(24, 24);
      return { status: "COMPLETED", visualEvidenceId: "EVIDENCE_STAB" };
    },
  };
  const host = new AeCepCurrentTransactionalHostV1(
    transport,
    "project:stabilization",
    "tx:stabilization-success",
    () => "request:test",
    undefined,
    driver,
  );

  await host.readState();
  const result = await host.apply(stabilizationOperation);
  assert.equal(result.outcome, "APPLIED");
  assert.equal(result.readback.final.trackerKeyCount, 24);
  assert.deepEqual(captured, {
    direction: "FORWARD",
    compHostId: 14,
    layerHostId: 26,
    expectedCompName: "Hero Comp",
    expectedLayerName: "Hero Layer",
    expectedControl: "STABILIZE_ANALYZE_APPLY_FORWARD",
  });

  await assert.rejects(
    host.apply({ ...stabilizationOperation, operationId: "OP_STABILIZE_2" }),
    /CHECKPOINT_REQUIRED/,
  );

  await host.readState();
  await host.captureRecoverySnapshot();
  assert.equal(transport.undoCalls, 0);
});

test("failed Analyze/Apply recovers against protocol-2.3 semantic truth even when project structure is unchanged", async () => {
  const transport = new StabilizationTransport();
  const driver = {
    driverId: "TEST_STABILIZATION_REFUSAL",
    verifiedVision: true,
    verifiedCursorControl: true,
    supportedDirections: ["FORWARD"],
    async stabilize() {
      transport.mutateStabilization(18, 0);
      return { status: "REFUSED", detail: "Synthetic refusal after Analyze." };
    },
  };
  const host = new AeCepCurrentTransactionalHostV1(
    transport,
    "project:stabilization",
    "tx:stabilization-recovery",
    () => "request:recovery",
    undefined,
    driver,
  );

  const snapshot = await host.readState();
  await assert.rejects(
    host.apply(stabilizationOperation),
    /STABILIZATION_VISUAL_ACTION_REFUSED/,
  );
  assert.equal(transport.trackerKeyCount, 18);
  assert.equal(transport.anchorKeyCount, 0);

  await host.restoreRecoverySnapshot(snapshot, 0);
  assert.equal(transport.undoCalls, 1);
  assert.equal(transport.trackerKeyCount, 0);
  assert.equal(transport.anchorKeyCount, 0);
  assert.equal(GUARDED_STABILIZATION_RECOVERY_UNDO_LIMIT_V1, 8);
});
