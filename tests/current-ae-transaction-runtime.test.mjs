import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CurrentAeTransactionRuntimeV1,
  createCurrentAeTransactionRegistryV1,
} from "../.tmp/runtime/apps/desktop-host/src/current-ae-transaction-runtime.js";
import {
  AeCepCurrentTransactionalHostV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/current-transactional-host.js";
import {
  AE_ADAPTER_PROTOCOL_VERSION_V11,
  AE_ADAPTER_ROUTE_ID_V11,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_1.js";
import {
  AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_7.js";
import {
  AE_TEMPORAL_EASE_ROUTE_ID_V18,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_8.js";
import {
  AE_TIME_REMAP_ROUTE_ID_V27,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v2_7.js";
import {
  M4_STABILIZATION_GUARDED_ROUTE_ID_V1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-stabilization.js";

const environmentProbe = {
  adapterProtocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
  adapterBuild: "test-current-runtime",
  hostName: "Adobe After Effects",
  hostVersion: "25.6.6",
  hostBuild: "4",
  os: "Windows test",
  projectOpen: true,
};

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
    adapterBuild: "test-current-runtime",
    command: request.command,
    notes: [],
  },
  proofArtifactRefs: [],
  ...overrides,
});

class RuntimeTransport {
  constructor() {
    this.requests = [];
    this.project = {
      hostRevision: 30,
      filePath: "C:/EditFlow/current-runtime-test.aep",
      activeItemHostId: null,
      itemCount: 0,
      items: [],
    };
    this.undoStack = [];
    this.mutationCount = 0;
  }

  async dispatch(request) {
    this.requests.push(structuredClone(request));
    if (request.command === "host.probe") {
      return responseFor(request, {
        environmentProbe,
        hostProjectRevision: this.project.hostRevision,
      });
    }
    if (request.command === "project.inspect") {
      return responseFor(request, {
        projectSnapshot: structuredClone(this.project),
        hostProjectRevision: this.project.hostRevision,
      });
    }
    if (
      request.expectedHostProjectRevision !== null
      && request.expectedHostProjectRevision !== undefined
      && request.expectedHostProjectRevision !== this.project.hostRevision
    ) {
      return responseFor(request, {
        outcome: "REJECTED",
        error: {
          code: "HOST_REVISION_MISMATCH",
          message: "stale revision",
        },
        hostProjectRevision: this.project.hostRevision,
      });
    }
    if (request.command === "transaction.undo_last") {
      const prior = this.undoStack.pop();
      if (!prior) {
        return responseFor(request, {
          outcome: "FAILED",
          error: { code: "NO_UNDO_AVAILABLE", message: "Nothing to undo." },
          hostProjectRevision: this.project.hostRevision,
        });
      }
      const nextRevision = this.project.hostRevision + 1;
      this.project = prior;
      this.project.hostRevision = nextRevision;
      return responseFor(request, {
        outcome: "APPLIED",
        readback: { undone: true },
        hostProjectRevision: this.project.hostRevision,
      });
    }

    this.undoStack.push(structuredClone(this.project));
    this.mutationCount += 1;
    const hostId = 2000 + this.mutationCount;
    this.project.items.push({
      hostId,
      stableId: `RUNTIME_MUTATION_${this.mutationCount}`,
      kind: "COMPOSITION",
      name: `Runtime Mutation ${this.mutationCount}`,
      parentHostId: null,
      comment: "",
      composition: {
        hostId,
        stableId: `RUNTIME_MUTATION_${this.mutationCount}`,
        name: `Runtime Mutation ${this.mutationCount}`,
        width: 100,
        height: 100,
        pixelAspect: 1,
        duration: 1,
        frameRate: 24,
        displayStartTime: 0,
        layers: [],
      },
    });
    this.project.itemCount = this.project.items.length;
    this.project.hostRevision += 1;
    return responseFor(request, {
      outcome: "APPLIED",
      readback: { mutationCount: this.mutationCount },
      hostProjectRevision: this.project.hostRevision,
    });
  }
}

const op = (id, capabilityId, routeId, command, dependsOn = []) => ({
  operationId: id,
  capabilityId,
  routeId,
  dependsOn,
  idempotency: "CHECK_THEN_APPLY",
  riskClass: "R1_REVERSIBLE",
  input: { command, payload: {} },
  rollbackBoundaryId: "ROLLBACK_CURRENT_RUNTIME",
});

const buildPlan = (observed) => {
  const operations = [
    op("OP_PRECOMPOSE", "ae.precompose.layers", AE_ADAPTER_ROUTE_ID_V11, "layers.precompose"),
    op("OP_TIME_REMAP", "ae.layer.time_remap.enable", AE_TIME_REMAP_ROUTE_ID_V27, "layer.time_remap.enable", ["OP_PRECOMPOSE"]),
    op("OP_KEYS", "ae.keyframe.set", AE_ADAPTER_ROUTE_ID_V11, "property.set_keyframes", ["OP_TIME_REMAP"]),
    op("OP_INTERPOLATION", "ae.property.temporal_interpolation.set", AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17, "property.temporal_interpolation.set", ["OP_KEYS"]),
    op("OP_EASE", "ae.property.temporal_ease.set", AE_TEMPORAL_EASE_ROUTE_ID_V18, "property.temporal_ease.set", ["OP_INTERPOLATION"]),
  ];
  return {
    planId: "current-runtime-plan",
    planRevision: 1,
    projectRevision: observed.projectRevision,
    projectFingerprint: observed.projectFingerprint,
    environmentFingerprint: observed.environmentFingerprint,
    requiredCapabilities: [
      "ae.precompose.layers",
      "ae.layer.time_remap.enable",
      "ae.keyframe.set",
      "ae.property.temporal_interpolation.set",
      "ae.property.temporal_ease.set",
    ],
    bindings: [],
    operations,
    checkpoints: [],
    invariants: { structural: [], visual: [] },
    rollbackBoundaries: [{
      id: "ROLLBACK_CURRENT_RUNTIME",
      strategy: "RESTORE_SNAPSHOT",
    }],
  };
};

test("current AE transaction runtime executes and recovers one mixed-protocol plan", async () => {
  const transport = new RuntimeTransport();
  const observer = new AeCepCurrentTransactionalHostV1(
    transport,
    "current-runtime-project",
    "observe-runtime",
    () => "observe-runtime-request",
  );
  const observed = await observer.readState();
  const runtime = new CurrentAeTransactionRuntimeV1(
    transport,
    "current-runtime-project",
  );
  const plan = buildPlan(observed);

  const first = await runtime.execute(plan);
  assert.equal(first.state, "COMMITTED");
  assert.equal(first.recovered, false);
  assert.equal(first.appliedOperations, 5);
  assert.equal(transport.mutationCount, 5);

  const second = await runtime.execute(plan);
  assert.equal(second.state, "COMMITTED");
  assert.equal(second.recovered, true);
  assert.equal(second.appliedOperations, 5);
  assert.equal(transport.mutationCount, 5);

  assert.equal(runtime.status().recoveryLedgerEntries, 1);
  assert.equal(runtime.status().maxOperations, 64);
});

test("current AE transaction runtime uses only proof-backed current routes", async () => {
  const transport = new RuntimeTransport();
  const observer = new AeCepCurrentTransactionalHostV1(
    transport,
    "registry-project",
    "observe-registry",
    () => "observe-registry-request",
  );
  const observed = await observer.readState();
  const registry = createCurrentAeTransactionRegistryV1(
    observed.environmentFingerprint,
  );

  for (const [capabilityId, routeId] of [
    ["ae.precompose.layers", AE_ADAPTER_ROUTE_ID_V11],
    ["ae.keyframe.set", AE_ADAPTER_ROUTE_ID_V11],
    ["ae.property.temporal_interpolation.set", AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17],
    ["ae.property.temporal_ease.set", AE_TEMPORAL_EASE_ROUTE_ID_V18],
    ["ae.layer.time_remap.enable", AE_TIME_REMAP_ROUTE_ID_V27],
  ]) {
    assert.equal(String(registry.assertRouteAvailable(capabilityId, routeId).routeId), routeId);
  }

  assert.throws(
    () => registry.assertRouteAvailable(
      "ae.stabilization.position.guarded_visual",
      String(M4_STABILIZATION_GUARDED_ROUTE_ID_V1),
    ),
  );

  const verifiedDriver = {
    driverId: "TEST_VERIFIED_STABILIZATION_DRIVER",
    verifiedVision: true,
    verifiedCursorControl: true,
    supportedDirections: ["FORWARD"],
    async stabilize() { return { status: "REFUSED" }; },
  };
  const stabilizationRegistry = createCurrentAeTransactionRegistryV1(
    observed.environmentFingerprint,
    undefined,
    { protocolV23Available: true, visualDriver: verifiedDriver },
  );
  assert.equal(
    String(stabilizationRegistry.assertRouteAvailable(
      "ae.stabilization.position.guarded_visual",
      String(M4_STABILIZATION_GUARDED_ROUTE_ID_V1),
    ).routeId),
    String(M4_STABILIZATION_GUARDED_ROUTE_ID_V1),
  );
  assert.equal(
    stabilizationRegistry.assertRouteAvailable(
      "ae.stabilization.readback",
      "ae-cep.stabilization.v2_3",
    ).kind,
    "HOST_ADAPTER",
  );
});

test("current AE transaction runtime rejects oversized plans before contacting AE", async () => {
  const transport = new RuntimeTransport();
  const runtime = new CurrentAeTransactionRuntimeV1(
    transport,
    "current-runtime-project",
    2,
  );
  const requestCount = transport.requests.length;

  await assert.rejects(
    runtime.execute({ operations: [{}, {}, {}] }),
    /CURRENT_AE_TRANSACTION_OPERATION_LIMIT/,
  );
  assert.equal(transport.requests.length, requestCount);
});


test("current Shadow daemon exposes typed mixed-protocol transaction execution", async () => {
  const source = await readFile("scripts/current-shadow-control-daemon.mjs", "utf8");
  assert.match(source, /CurrentAeTransactionRuntimeV1/);
  assert.match(source, /url\.pathname === "\/run-transaction"/);
  assert.match(source, /currentTransactionRuntime\.execute\(body\.plan\)/);
  assert.match(source, /EditGptStabilizationVisualDriverV1/);
  assert.match(source, /supportedProtocolVersions.*2\.3\.0/s);
  assert.match(source, /result\.state === "COMMITTED"/);
});
