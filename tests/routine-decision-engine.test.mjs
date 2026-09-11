import test from "node:test";
import assert from "node:assert/strict";

import { AeCepAdapterClientV11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/v1_1.js";
import { AE_ADAPTER_PROTOCOL_VERSION_V11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_1.js";
import { RoutineDecisionEngine, compileRoutineIntent } from "../.tmp/runtime/packages/routine-decision-engine/src/index.js";

const baselineState = () => ({
  observed: {
    projectId: "routine-test",
    projectRevision: "ae-revision:7",
    projectFingerprint: "project:sha256:routine-test",
    environmentFingerprint: "environment:sha256:routine-test",
  },
  hostRevision: 7,
  project: { hostRevision: 7, filePath: null, activeItemHostId: null, itemCount: 0, items: [] },
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

const responseFor = (request, overrides = {}) => ({
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
  hostProjectRevision: request.expectedHostProjectRevision + 1,
  diagnostics: { adapterProtocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11, adapterBuild: "test", command: request.command },
  proofArtifactRefs: [],
  ...overrides,
});

test("routine compiler maps fixed intents to typed AE commands and never accepts arbitrary command injection", () => {
  const transform = compileRoutineIntent({
    kind: "SET_LAYER_TRANSFORM",
    command: "project.save",
    comp: { stableId: "COMP" },
    layer: { stableId: "LAYER" },
    values: { position: [100, 200], opacity: 80 },
  });
  assert.equal(transform.route, "LOCAL");
  assert.equal(transform.command, "layer.set_transform");
  assert.deepEqual(transform.payload.values, { position: [100, 200], opacity: 80 });

  const destructive = compileRoutineIntent({ kind: "REMOVE_LAYER", comp: { stableId: "COMP" }, layer: { stableId: "LAYER" } });
  assert.equal(destructive.route, "ESCALATE");
  assert.equal(destructive.reason, "NOT_ROUTINE");
});

test("warm routine engine performs exactly one CEP dispatch per routine action and advances the host revision lease", async () => {
  const requests = [];
  const transport = {
    async dispatch(request) {
      requests.push(structuredClone(request));
      return responseFor(request);
    },
  };
  let id = 0;
  const client = new AeCepAdapterClientV11(transport, () => `routine-${++id}`);
  const engine = new RoutineDecisionEngine(client, baselineState(), { budgetMs: 1000, leaseTtlMs: 60_000 });

  const first = await engine.execute({
    kind: "CREATE_COMP", stableId: "COMP_FAST", name: "Fast", width: 320, height: 320, pixelAspect: 1, duration: 1, frameRate: 24,
  }, "TX");
  const second = await engine.execute({
    kind: "UPDATE_COMP_SETTINGS", comp: { stableId: "COMP_FAST" }, settings: { width: 321 },
  }, "TX");

  assert.equal(first.route, "LOCAL");
  assert.equal(second.route, "LOCAL");
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map((request) => request.command), ["comp.create", "comp.update_settings"]);
  assert.equal(requests.some((request) => request.command === "host.probe" || request.command === "project.inspect"), false);
  assert.equal(requests[0].expectedHostProjectRevision, 7);
  assert.equal(requests[1].expectedHostProjectRevision, 8);
  assert.equal(requests[0].expectedProjectFingerprint, null);
  assert.equal(engine.hostRevision, 9);
});

test("stale AE host state invalidates the warm lease and escalates without hidden retry", async () => {
  const requests = [];
  const transport = {
    async dispatch(request) {
      requests.push(structuredClone(request));
      return responseFor(request, {
        outcome: "REJECTED",
        error: { category: "STALE_PROJECT_STATE", code: "HOST_REVISION_MISMATCH", message: "stale" },
        hostProjectRevision: 12,
      });
    },
  };
  const client = new AeCepAdapterClientV11(transport, () => "stale-1");
  const engine = new RoutineDecisionEngine(client, baselineState(), { leaseTtlMs: 60_000 });
  const intent = { kind: "UPDATE_COMP_SETTINGS", comp: { stableId: "COMP" }, settings: { width: 400 } };
  const first = await engine.execute(intent);
  const second = await engine.execute(intent);

  assert.equal(first.route, "ESCALATE");
  assert.equal(first.reason, "STALE_HOST_STATE");
  assert.equal(second.route, "ESCALATE");
  assert.equal(second.reason, "LEASE_INVALID");
  assert.equal(requests.length, 1);
});
