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
import {
  NATIVE_AE_LIVE_CURVE_INTENT_SCHEMA_V1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/native-curve-materialization.js";

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
    if (request.command === "readback.object") {
      if (request.payload.kind === "LAYER") {
        return responseFor(request, {
          readback: {
            layer: {
              stableId: "LAYER",
              transform: {
                anchorPoint: [100, 200],
                position: [500, 600],
                scale: [80, 120],
              },
            },
          },
          hostProjectRevision: this.project.hostRevision,
        });
      }
      return responseFor(request, {
        readback: {
          composition: {
            stableId: "COMP",
            width: 1080,
            height: 1920,
          },
        },
        hostProjectRevision: this.project.hostRevision,
      });
    }
    if (request.command === "layer.time_remap.readback") {
      return responseFor(request, {
        readback: {
          timeRemapEnabled: true,
          propertyAvailable: true,
          keys: [
            { index: 1, time: 0, value: 0 },
            { index: 2, time: 3, value: 3 },
          ],
        },
        hostProjectRevision: this.project.hostRevision,
      });
    }
    if (request.command === "property.temporal_ease.readback") {
      const leaf = request.payload.propertyPath?.at(-1);
      const cardinality = leaf === "ADBE Scale"
        ? 3
        : leaf === "ADBE Position"
          ? 2
          : 1;
      const defaultEase = Array.from(
        { length: cardinality },
        () => ({ speed: 0, influence: 33.333 }),
      );
      return responseFor(request, {
        outcome: "NO_OP",
        readback: {
          temporalEase: {
            property: { easeCardinality: cardinality },
            keyIndex: request.payload.keyIndex,
            state: {
              inEase: structuredClone(defaultEase),
              outEase: structuredClone(defaultEase),
            },
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

test("current AE host materializes a live Time Remap curve and reuses its derived ease", async () => {
  const transport = new StatefulMixedProtocolTransport();
  let requestCounter = 0;
  const host = new AeCepCurrentTransactionalHostV1(
    transport,
    "current-host-project",
    "tx-live-retime",
    () => `req-live-retime-${++requestCounter}`,
  );
  await host.readState();

  await host.apply(operation({
    id: "OP_LIVE_RETIME_KEYS",
    capabilityId: "ae.keyframe.set",
    routeId: AE_ADAPTER_ROUTE_ID_V11,
    command: "property.set_keyframes",
    payload: {
      comp: { stableId: "COMP" },
      layer: { stableId: "LAYER" },
      propertyPath: ["ADBE Time Remapping"],
      liveCurveIntent: {
        schema: NATIVE_AE_LIVE_CURVE_INTENT_SCHEMA_V1,
        kind: "TIME_REMAP_PULSE",
        keyTimesSeconds: [1, 1.5, 2],
        velocityContrast: 0.4,
      },
    },
  }));
  await host.apply(operation({
    id: "OP_LIVE_RETIME_EASE",
    capabilityId: "ae.property.temporal_ease.set",
    routeId: AE_TEMPORAL_EASE_ROUTE_ID_V18,
    command: "property.temporal_ease.set",
    payload: {
      comp: { stableId: "COMP" },
      layer: { stableId: "LAYER" },
      propertyPath: ["ADBE Time Remapping"],
      keyIndex: 2,
      liveCurveEaseIntent: { keyIndex: 2 },
    },
  }));

  const remapReadbacks = transport.requests.filter((request) =>
    request.command === "layer.time_remap.readback");
  assert.equal(remapReadbacks.length, 1);

  const setKeys = transport.requests.find((request) =>
    request.command === "property.set_keyframes"
    && request.payload.propertyPath?.at(-1) === "ADBE Time Remapping");
  assert.ok(setKeys);
  assert.equal(setKeys.payload.liveCurveIntent, undefined);
  assert.deepEqual(
    setKeys.payload.keyframes.map((keyframe) => keyframe.value),
    [1, 1.5, 2],
  );

  const easeSet = transport.requests.find((request) =>
    request.command === "property.temporal_ease.set");
  assert.ok(easeSet);
  assert.equal(easeSet.payload.liveCurveEaseIntent, undefined);
  assert.equal(easeSet.payload.ease.inEase.length, 1);
  assert.ok(easeSet.payload.ease.inEase[0].speed > 0);
  assert.ok(easeSet.payload.ease.inEase[0].influence > 50);
});

test("current AE host materializes camera scale and position from one live baseline", async () => {
  const transport = new StatefulMixedProtocolTransport();
  let requestCounter = 0;
  const host = new AeCepCurrentTransactionalHostV1(
    transport,
    "current-host-project",
    "tx-live-camera",
    () => `req-live-camera-${++requestCounter}`,
  );
  await host.readState();

  const applyCurve = async (id, component, propertyPath) => host.apply(operation({
    id,
    capabilityId: "ae.keyframe.set",
    routeId: AE_ADAPTER_ROUTE_ID_V11,
    command: "property.set_keyframes",
    payload: {
      comp: { stableId: "COMP" },
      layer: { stableId: "LAYER" },
      propertyPath,
      liveCurveIntent: {
        schema: NATIVE_AE_LIVE_CURVE_INTENT_SCHEMA_V1,
        kind: "CAMERA_PUSH",
        component,
        keyTimesSeconds: [1.8, 2, 2.2],
        zoomIntensity: 0.3,
        zoomCenter: [0.62, 0.44],
      },
    },
  }));
  await applyCurve(
    "OP_LIVE_CAMERA_SCALE",
    "SCALE",
    ["ADBE Transform Group", "ADBE Scale"],
  );
  await applyCurve(
    "OP_LIVE_CAMERA_POSITION",
    "POSITION",
    ["ADBE Transform Group", "ADBE Position"],
  );

  const readbacks = transport.requests.filter((request) =>
    request.command === "readback.object");
  assert.equal(readbacks.filter((request) => request.payload.kind === "LAYER").length, 1);
  assert.equal(readbacks.filter((request) => request.payload.kind === "COMPOSITION").length, 1);

  const keyWrites = transport.requests.filter((request) =>
    request.command === "property.set_keyframes");
  assert.equal(keyWrites.length, 2);
  assert.deepEqual(keyWrites[0].payload.keyframes[1].value, [104, 156]);
  assert.notDeepEqual(keyWrites[1].payload.keyframes[1].value, [500, 600]);
  assert.equal(keyWrites.every((request) => request.payload.liveCurveIntent === undefined), true);
});

test("live adaptive ease authors legal boundary state and reuses one cardinality probe", async () => {
  const transport = new StatefulMixedProtocolTransport();
  let requestCounter = 0;
  const host = new AeCepCurrentTransactionalHostV1(
    transport,
    "current-host-project",
    "tx-live-boundary-ease",
    () => `req-live-boundary-${++requestCounter}`,
  );
  await host.readState();

  await host.apply(operation({
    id: "OP_LIVE_BOUNDARY_KEYS",
    capabilityId: "ae.keyframe.set",
    routeId: AE_ADAPTER_ROUTE_ID_V11,
    command: "property.set_keyframes",
    payload: {
      comp: { stableId: "COMP" },
      layer: { stableId: "LAYER" },
      propertyPath: ["ADBE Time Remapping"],
      liveCurveIntent: {
        schema: NATIVE_AE_LIVE_CURVE_INTENT_SCHEMA_V1,
        kind: "TIME_REMAP_PULSE",
        keyTimesSeconds: [1, 1.5, 2],
        velocityContrast: 0.4,
      },
    },
  }));

  for (const keyIndex of [1, 3]) {
    await host.apply(operation({
      id: `OP_LIVE_BOUNDARY_EASE_${keyIndex}`,
      capabilityId: "ae.property.temporal_ease.set",
      routeId: AE_TEMPORAL_EASE_ROUTE_ID_V18,
      command: "property.temporal_ease.set",
      payload: {
        comp: { stableId: "COMP" },
        layer: { stableId: "LAYER" },
        propertyPath: ["ADBE Time Remapping"],
        keyIndex,
        liveCurveEaseIntent: { keyIndex },
      },
    }));
  }

  const easeReadbacks = transport.requests.filter((request) =>
    request.command === "property.temporal_ease.readback");
  const easeSets = transport.requests.filter((request) =>
    request.command === "property.temporal_ease.set");
  assert.equal(easeReadbacks.length, 1);
  assert.equal(easeSets.length, 2);

  for (const request of easeSets) {
    for (const side of ["inEase", "outEase"]) {
      assert.equal(request.payload.ease[side].length, 1);
      assert.ok(Number.isFinite(request.payload.ease[side][0].speed));
      assert.ok(request.payload.ease[side][0].influence >= 0.1);
      assert.ok(request.payload.ease[side][0].influence <= 100);
    }
  }
  assert.ok(easeSets[0].payload.ease.outEase[0].speed > 0);
  assert.ok(easeSets[1].payload.ease.inEase[0].speed > 0);
});
