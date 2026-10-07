import test from "node:test";
import assert from "node:assert/strict";

import { AE_ADAPTER_PROTOCOL_VERSION_V11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_1.js";
import {
  DEFAULT_LOCAL_FAST_ACTION_BUDGET_MS,
  DEFAULT_LOCAL_FAST_BATCH_ACTIONS,
  LocalFastRuntimeV1,
} from "../.tmp/runtime/apps/desktop-host/src/local-fast-runtime.js";

const stateFor = (revision) => ({
  observed: {
    projectId: "local-fast-test",
    projectRevision: `ae-revision:${revision}`,
    projectFingerprint: "project:sha256:local-fast-test",
    environmentFingerprint: "environment:sha256:local-fast-test",
  },
  hostRevision: revision,
  project: { hostRevision: revision, filePath: null, activeItemHostId: null, itemCount: 0, items: [] },
  environment: {
    adapterProtocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
    adapterBuild: "test",
    hostName: "Adobe After Effects",
    hostVersion: "test",
    hostBuild: "test",
    os: "test",
    projectOpen: true,
  },
});

const responseFor = (request, revision) => ({
  protocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
  requestId: request.requestId,
  transactionId: request.transactionId,
  operationId: request.operationId,
  capabilityId: request.capabilityId,
  command: request.command,
  outcome: "APPLIED",
  error: null,
  affectedObjects: [],
  readback: {},
  projectSnapshot: null,
  environmentProbe: null,
  hostProjectRevision: revision,
  diagnostics: { adapterProtocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11, adapterBuild: "test", command: request.command },
  proofArtifactRefs: [],
});

const createFakeAdapter = (initialRevision = 7) => {
  let revision = initialRevision;
  let observes = 0;
  let requestId = 0;
  const requests = [];
  const adapter = {
    observe: async () => {
      observes += 1;
      return stateFor(revision);
    },
    requestIdFactory: () => `local-fast-${++requestId}`,
    filesystemPolicy: { assertCommandPayload() {} },
    transport: {
      async dispatch(request) {
        requests.push(structuredClone(request));
        assert.equal(request.expectedHostProjectRevision, revision);
        revision += 1;
        return responseFor(request, revision);
      },
    },
  };
  return { adapter, requests, get observes() { return observes; }, get revision() { return revision; } };
};

const transformIntents = (count) => Array.from({ length: count }, (_, index) => ({
  kind: "SET_LAYER_TRANSFORM",
  comp: { stableId: "COMP" },
  layer: { stableId: "LAYER" },
  values: { opacity: 20 + (index % 80) },
}));

test("local fast runtime executes a many-action routine batch with no observation between AE micro-actions", async () => {
  const fake = createFakeAdapter();
  const runtime = await LocalFastRuntimeV1.create(fake.adapter, { projectId: "local-fast-test" });
  const result = await runtime.runRoutineBatch(transformIntents(20), "TX_BATCH_20");

  assert.equal(result.route, "LOCAL");
  assert.equal(result.requestedActions, 20);
  assert.equal(result.completedActions, 20);
  assert.equal(result.actionTimingsMs.length, 20);
  assert.equal(result.dispatchTimingsMs.length, 20);
  assert.ok(result.actionTimingsMs.every((value) => Number.isFinite(value) && value >= 0));
  assert.ok(result.dispatchTimingsMs.every((value) => Number.isFinite(value) && value >= 0));
  assert.equal(fake.requests.length, 20);
  assert.equal(fake.observes, 1);
  assert.deepEqual(fake.requests.map((request) => request.expectedHostProjectRevision), Array.from({ length: 20 }, (_, i) => 7 + i));
  assert.equal(result.hostRevision, 27);
  assert.equal(runtime.status().architecture, "MCP_TO_LOCAL_RUNTIME_TO_AE");
  assert.equal(runtime.status().maxBatchActions, DEFAULT_LOCAL_FAST_BATCH_ACTIONS);
  assert.equal(runtime.status().actionBudgetMs, DEFAULT_LOCAL_FAST_ACTION_BUDGET_MS);
});

test("local fast runtime reuses the warm lease across batches and refreshes once after idle expiry", async () => {
  let now = 0;
  const fake = createFakeAdapter();
  const runtime = await LocalFastRuntimeV1.create(fake.adapter, {
    projectId: "local-fast-test", leaseTtlMs: 10, clock: () => now,
  });
  await runtime.runRoutineBatch(transformIntents(12), "TX_FIRST");
  assert.equal(fake.observes, 1);

  now = 5;
  await runtime.runRoutineBatch(transformIntents(8), "TX_SECOND");
  assert.equal(fake.observes, 1);
  assert.equal(fake.requests[12].expectedHostProjectRevision, 19);

  now = 11;
  const recovered = await runtime.runRoutineBatch(transformIntents(1), "TX_AFTER_IDLE");
  assert.equal(recovered.route, "LOCAL");
  assert.equal(recovered.escalationReason, null);
  assert.equal(fake.observes, 2);
  assert.equal(fake.requests[20].expectedHostProjectRevision, 27);
  assert.equal(runtime.status().hostRevision, 28);
});

test("local fast runtime rejects oversized batches before any AE dispatch", async () => {
  const fake = createFakeAdapter();
  const runtime = await LocalFastRuntimeV1.create(fake.adapter, { projectId: "local-fast-test", maxBatchActions: 4 });
  await assert.rejects(
    runtime.runRoutineBatch(transformIntents(5), "TX_TOO_LARGE"),
    /LOCAL_FAST_BATCH_TOO_LARGE/,
  );
  assert.equal(fake.requests.length, 0);
  assert.equal(fake.observes, 1);
});

test("preflight marks later references to newly created layers without skipping unrelated existing properties", async () => {
  const fake = createFakeAdapter();
  let operations;
  fake.adapter.executePublicAtKnownHostRevision = async (command, request) => {
    assert.equal(command, 'readback.object');
    operations = request.payload.operations;
    return {outcome:'NO_OP'};
  };
  const runtime = await LocalFastRuntimeV1.create(fake.adapter, {projectId:'local-fast-test'});
  const comp={stableId:'COMP'}, existing={stableId:'EXISTING'}, fresh={stableId:'TEXT'};
  const result = await runtime.runRoutineBatch([
    {kind:'ADD_TEXT_LAYER',comp,stableId:fresh.stableId,text:'New'},
    {kind:'SET_PROPERTY_VALUE',comp,layer:fresh,propertyPath:['ADBE Transform Group','ADBE Opacity'],value:50},
    {kind:'ADD_EFFECT',comp,layer:existing,matchName:'ADBE Gaussian Blur 2'},
    {kind:'SET_EFFECT_PROPERTY',comp,layer:existing,effectIndex:1,propertyPath:[1],value:2},
    {kind:'SET_PROPERTY_VALUE',comp,layer:existing,propertyPath:['ADBE Transform Group','ADBE Opacity'],value:80},
  ], 'TX_NEW_LAYER');
  assert.deepEqual(operations.map(op=>op.targetFromBatch),[false,true,false,true,false]);
  assert.equal(result.completedActions,5);
  assert.equal(fake.observes,2);
});

test("interrupted native batches retain the host failure and completed action readbacks", async () => {
  const fake = createFakeAdapter();
  const dispatch = fake.adapter.transport.dispatch;
  fake.adapter.transport.dispatch = async request => {
    const response = await dispatch(request);
    return fake.requests.length === 2 ? {...response,outcome:'FAILED',error:{code:'HOST',message:'Exact host error'}} : {...response,readback:{value:25}};
  };
  const runtime = await LocalFastRuntimeV1.create(fake.adapter, {projectId:'local-fast-test'});
  const result = await runtime.runRoutineBatch(transformIntents(3),'TX_PARTIAL');
  assert.equal(result.completedActions,1);
  assert.equal(result.escalationDetail,'Exact host error');
  assert.equal(result.readbacks[0].readback.value,25);
  assert.equal(result.readbacks[1].error.message,'Exact host error');
  assert.equal(fake.requests.length,2);
});
