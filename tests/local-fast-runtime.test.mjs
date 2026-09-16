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

test("local fast runtime refreshes once at the next batch boundary, not once per action", async () => {
  const fake = createFakeAdapter();
  const runtime = await LocalFastRuntimeV1.create(fake.adapter, { projectId: "local-fast-test" });
  await runtime.runRoutineBatch(transformIntents(12), "TX_FIRST");
  assert.equal(fake.observes, 1);
  await runtime.runRoutineBatch(transformIntents(8), "TX_SECOND");

  assert.equal(fake.requests.length, 20);
  assert.equal(fake.observes, 2);
  assert.equal(fake.requests[12].expectedHostProjectRevision, 19);
  assert.equal(runtime.status().hostRevision, 27);
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
