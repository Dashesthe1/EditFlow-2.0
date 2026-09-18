import test from "node:test";
import assert from "node:assert/strict";

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

const environmentProbe = {
  adapterProtocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
  adapterBuild: "test-current-host",
  hostName: "Adobe After Effects",
  hostVersion: "26.0-test",
  hostBuild: "test-build",
  os: "Windows test",
  projectOpen: true,
};

const makeProject = () => ({
  hostRevision: 20,
  filePath: "C:/EditFlow/current-host-test.aep",
  activeItemHostId: null,
  itemCount: 0,
  items: [],
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
    adapterBuild: "test-current-host",
    command: request.command,
    notes: [],
  },
  proofArtifactRefs: [],
  ...overrides,
});

class StatefulMixedProtocolTransport {
  constructor() {
    this.project = makeProject();
    this.requests = [];
    this.undoStack = [];
    this.mutationCounter = 0;
  }

  pushUndo() {
    this.undoStack.push(structuredClone(this.project));
  }

  applyMutation(request) {
    this.pushUndo();
    this.mutationCounter += 1;
    const id = 1000 + this.mutationCounter;
    this.project.items.push({
      hostId: id,
      stableId: `MUTATION_${this.mutationCounter}`,
      kind: "COMPOSITION",
      name: `Mutation ${this.mutationCounter}`,
      parentHostId: null,
      comment: "",
      composition: {
        hostId: id,
        stableId: `MUTATION_${this.mutationCounter}`,
        name: `Mutation ${this.mutationCounter}`,
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
      readback: { mutationCounter: this.mutationCounter },
      hostProjectRevision: this.project.hostRevision,
    });
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
    if (request.command === "property.temporal_ease.readback") {
      return responseFor(request, {
        outcome: "NO_OP",
        readback: {
          temporalEase: {
            property: { easeCardinality: 3 },
            keyIndex: request.payload.keyIndex,
          },
        },
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
          category: "STALE_PROJECT_STATE",
          code: "HOST_REVISION_MISMATCH",
          message: "stale revision",
        },
        hostProjectRevision: this.project.hostRevision,
      });
    }
    if (request.command === "transaction.undo_last") {
      const previous = this.undoStack.pop();
      if (!previous) {
        return responseFor(request, {
          outcome: "FAILED",
          error: { code: "NO_UNDO_AVAILABLE", message: "Nothing to undo." },
          hostProjectRevision: this.project.hostRevision,
        });
      }
      const nextRevision = this.project.hostRevision + 1;
      this.project = previous;
      this.project.hostRevision = nextRevision;
      return responseFor(request, {
        outcome: "APPLIED",
        readback: { undone: true },
        hostProjectRevision: this.project.hostRevision,
      });
    }
    return this.applyMutation(request);
  }
}

const operation = ({
  id,
  capabilityId,
  routeId,
  command,
  payload = {},
}) => ({
  operationId: id,
  capabilityId,
  routeId,
  dependsOn: [],
  idempotency: "CHECK_THEN_APPLY",
  riskClass: "R1_REVERSIBLE",
  input: { command, payload },
  rollbackBoundaryId: "ROLLBACK_CURRENT",
});

const currentOperations = () => [
  operation({
    id: "OP_PRECOMPOSE",
    capabilityId: "ae.precompose.layers",
    routeId: AE_ADAPTER_ROUTE_ID_V11,
    command: "layers.precompose",
  }),
  operation({
    id: "OP_TIME_REMAP",
    capabilityId: "ae.layer.time_remap.enable",
    routeId: AE_TIME_REMAP_ROUTE_ID_V27,
    command: "layer.time_remap.enable",
    payload: {
      comp: { stableId: "COMP" },
      layer: { stableId: "LAYER" },
    },
  }),
  operation({
    id: "OP_KEYS",
    capabilityId: "ae.keyframe.set",
    routeId: AE_ADAPTER_ROUTE_ID_V11,
    command: "property.set_keyframes",
  }),
  operation({
    id: "OP_INTERPOLATION",
    capabilityId: "ae.property.temporal_interpolation.set",
    routeId: AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17,
    command: "property.temporal_interpolation.set",
  }),
  operation({
    id: "OP_EASE",
    capabilityId: "ae.property.temporal_ease.set",
    routeId: AE_TEMPORAL_EASE_ROUTE_ID_V18,
    command: "property.temporal_ease.set",
  }),
];

test("current AE host streams mixed protocols from one boundary observation", async () => {
  const transport = new StatefulMixedProtocolTransport();
  let requestCounter = 0;
  const host = new AeCepCurrentTransactionalHostV1(
    transport,
    "current-host-project",
    "tx-current",
    () => `req-${++requestCounter}`,
  );

  const baseline = await host.readState();
  const beforeCaptureCount = transport.requests.length;
  const snapshot = await host.captureRecoverySnapshot();
  assert.equal(transport.requests.length, beforeCaptureCount);
  assert.deepEqual(snapshot, baseline);

  const results = [];
  for (const candidate of currentOperations()) {
    results.push(await host.apply(candidate));
  }
  assert.ok(results.every((result) => result.outcome === "APPLIED"));

  const commands = transport.requests.map((request) => request.command);
  assert.deepEqual(commands, [
    "host.probe",
    "project.inspect",
    "layers.precompose",
    "layer.time_remap.enable",
    "property.set_keyframes",
    "property.temporal_interpolation.set",
    "property.temporal_ease.set",
  ]);
  assert.deepEqual(
    transport.requests.slice(2).map((request) => request.expectedHostProjectRevision),
    [20, 21, 22, 23, 24],
  );

  await host.restoreRecoverySnapshot(snapshot, 5);
  const after = await host.readState();
  assert.equal(after.projectFingerprint, baseline.projectFingerprint);
  assert.equal(after.environmentFingerprint, baseline.environmentFingerprint);
  assert.equal(after.projectId, baseline.projectId);

  const undoRequests = transport.requests.filter(
    (request) => request.command === "transaction.undo_last",
  );
  assert.equal(undoRequests.length, 5);
  assert.deepEqual(
    undoRequests.map((request) => request.expectedHostProjectRevision),
    [25, 26, 27, 28, 29],
  );
});

test("current AE host rejects route/capability mismatches before mutation", async () => {
  const transport = new StatefulMixedProtocolTransport();
  const host = new AeCepCurrentTransactionalHostV1(
    transport,
    "current-host-project",
    "tx-current",
    () => "fixed-request",
  );
  await host.readState();
  const requestCount = transport.requests.length;

  await assert.rejects(
    () => host.apply(operation({
      id: "OP_BAD_ROUTE",
      capabilityId: "ae.layer.time_remap.enable",
      routeId: AE_ADAPTER_ROUTE_ID_V11,
      command: "layer.time_remap.enable",
      payload: {
        comp: { stableId: "COMP" },
        layer: { stableId: "LAYER" },
      },
    })),
    /route\/capability mismatch/,
  );
  assert.equal(transport.requests.length, requestCount);
});

test("current AE host carries host-revision stale-state protection between streamed actions", async () => {
  const transport = new StatefulMixedProtocolTransport();
  const host = new AeCepCurrentTransactionalHostV1(
    transport,
    "current-host-project",
    "tx-current",
    () => `req-${transport.requests.length + 1}`,
  );
  await host.readState();
  transport.project.hostRevision += 1;

  await assert.rejects(
    () => host.apply(operation({
      id: "OP_STALE",
      capabilityId: "ae.layer.time_remap.enable",
      routeId: AE_TIME_REMAP_ROUTE_ID_V27,
      command: "layer.time_remap.enable",
      payload: {
        comp: { stableId: "COMP" },
        layer: { stableId: "LAYER" },
      },
    })),
    /HOST_REVISION_MISMATCH: stale revision/,
  );
  assert.equal(transport.project.items.length, 0);
});


test("current AE host expands temporal-ease intent to live property cardinality", async () => {
  const transport = new StatefulMixedProtocolTransport();
  let requestCounter = 0;
  const host = new AeCepCurrentTransactionalHostV1(
    transport,
    "current-host-project",
    "tx-live-ease",
    () => `req-live-ease-${++requestCounter}`,
  );
  await host.readState();
  const beforeMutationCount = transport.mutationCounter;

  const result = await host.apply(operation({
    id: "OP_LIVE_EASE",
    capabilityId: "ae.property.temporal_ease.set",
    routeId: AE_TEMPORAL_EASE_ROUTE_ID_V18,
    command: "property.temporal_ease.set",
    payload: {
      comp: { stableId: "COMP" },
      layer: { stableId: "LAYER" },
      propertyPath: ["ADBE Transform Group", "ADBE Scale"],
      keyIndex: 2,
      easeIntent: {
        inEase: { speed: 12, influence: 41 },
        outEase: { speed: 18, influence: 57 },
      },
    },
  }));

  assert.equal(result.outcome, "APPLIED");
  assert.equal(transport.mutationCounter, beforeMutationCount + 1);

  const temporalRequests = transport.requests.filter((request) =>
    request.command.startsWith("property.temporal_ease."));
  assert.deepEqual(
    temporalRequests.map((request) => request.command),
    ["property.temporal_ease.readback", "property.temporal_ease.set"],
  );

  const [probe, set] = temporalRequests;
  assert.equal(probe.payload.easeIntent, undefined);
  assert.equal(set.payload.easeIntent, undefined);
  assert.equal(set.payload.ease.inEase.length, 3);
  assert.equal(set.payload.ease.outEase.length, 3);
  assert.deepEqual(set.payload.ease.inEase, [
    { speed: 12, influence: 41 },
    { speed: 12, influence: 41 },
    { speed: 12, influence: 41 },
  ]);
  assert.deepEqual(set.payload.ease.outEase, [
    { speed: 18, influence: 57 },
    { speed: 18, influence: 57 },
    { speed: 18, influence: 57 },
  ]);
});


test("current AE host reuses one temporal-ease cardinality probe across keys on the same property", async () => {
  const transport = new StatefulMixedProtocolTransport();
  let requestCounter = 0;
  const host = new AeCepCurrentTransactionalHostV1(
    transport,
    "current-host-project",
    "tx-ease-cache",
    () => `req-ease-cache-${++requestCounter}`,
  );
  await host.readState();

  const applyEase = async (id, keyIndex) => host.apply(operation({
    id,
    capabilityId: "ae.property.temporal_ease.set",
    routeId: AE_TEMPORAL_EASE_ROUTE_ID_V18,
    command: "property.temporal_ease.set",
    payload: {
      comp: { stableId: "COMP" },
      layer: { stableId: "LAYER" },
      propertyPath: ["ADBE Transform Group", "ADBE Scale"],
      keyIndex,
      easeIntent: {
        inEase: { speed: 12, influence: 41 },
        outEase: { speed: 18, influence: 57 },
      },
    },
  }));

  await applyEase("OP_EASE_1", 1);
  await applyEase("OP_EASE_2", 2);
  await applyEase("OP_EASE_3", 3);

  const temporalRequests = transport.requests.filter((request) =>
    request.command.startsWith("property.temporal_ease."));
  assert.deepEqual(
    temporalRequests.map((request) => request.command),
    [
      "property.temporal_ease.readback",
      "property.temporal_ease.set",
      "property.temporal_ease.set",
      "property.temporal_ease.set",
    ],
  );
});

test("current AE host invalidates temporal-ease cardinality cache after target-changing structure", async () => {
  const transport = new StatefulMixedProtocolTransport();
  let requestCounter = 0;
  const host = new AeCepCurrentTransactionalHostV1(
    transport,
    "current-host-project",
    "tx-ease-cache-invalidation",
    () => `req-ease-invalidation-${++requestCounter}`,
  );
  await host.readState();

  const easePayload = (keyIndex) => ({
    comp: { stableId: "COMP" },
    layer: { stableId: "LAYER" },
    propertyPath: ["ADBE Transform Group", "ADBE Scale"],
    keyIndex,
    easeIntent: {
      inEase: { speed: 12, influence: 41 },
      outEase: { speed: 18, influence: 57 },
    },
  });

  await host.apply(operation({
    id: "OP_EASE_BEFORE_STRUCTURE",
    capabilityId: "ae.property.temporal_ease.set",
    routeId: AE_TEMPORAL_EASE_ROUTE_ID_V18,
    command: "property.temporal_ease.set",
    payload: easePayload(1),
  }));
  await host.apply(operation({
    id: "OP_STRUCTURE_CHANGE",
    capabilityId: "ae.precompose.layers",
    routeId: AE_ADAPTER_ROUTE_ID_V11,
    command: "layers.precompose",
  }));
  await host.apply(operation({
    id: "OP_EASE_AFTER_STRUCTURE",
    capabilityId: "ae.property.temporal_ease.set",
    routeId: AE_TEMPORAL_EASE_ROUTE_ID_V18,
    command: "property.temporal_ease.set",
    payload: easePayload(2),
  }));

  const temporalRequests = transport.requests.filter((request) =>
    request.command.startsWith("property.temporal_ease."));
  assert.deepEqual(
    temporalRequests.map((request) => request.command),
    [
      "property.temporal_ease.readback",
      "property.temporal_ease.set",
      "property.temporal_ease.readback",
      "property.temporal_ease.set",
    ],
  );
});
