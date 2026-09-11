import test from "node:test";
import assert from "node:assert/strict";

import { AE_ADAPTER_PROTOCOL_VERSION_V11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_1.js";
import { AeCepAdapterClientV11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/v1_1.js";
import { ContinuousFastLoop } from "../.tmp/runtime/packages/continuous-fast-loop/src/index.js";
import { ReflexPlanner } from "../.tmp/runtime/packages/reflex-planner/src/index.js";
import { createDesktopAeSessionV11, DEFAULT_AE_EXECUTION_MODE } from "../.tmp/runtime/apps/desktop-host/src/v1_1.js";

const baselineState = () => ({
  observed: {
    projectId: "reflex-test",
    projectRevision: "ae-revision:10",
    projectFingerprint: "project:sha256:reflex-test",
    environmentFingerprint: "environment:sha256:reflex-test",
  },
  hostRevision: 10,
  project: {
    hostRevision: 10,
    filePath: null,
    activeItemHostId: 1,
    itemCount: 1,
    items: [{ hostId: 1, stableId: "COMP", kind: "COMPOSITION", name: "Comp", parentHostId: 0, comment: "", composition: {      hostId: 1, stableId: "COMP", name: "Comp", width: 1920, height: 1080, pixelAspect: 1,
      duration: 10, frameRate: 30, displayStartTime: 0,
      layers: [{ hostId: 14, stableId: "LAYER", index: 1, name: "Layer", kind: "LAYER_AV",
        sourceHostId: 2, sourceStableId: "MEDIA", startTime: 0, inPoint: 0, outPoint: 10, stretch: 100,
        parentStableId: null, transform: { position: [960, 540, 0], scale: [100, 100, 100], rotation: 0, opacity: 100 },
        enabled: true, locked: false, shy: false, solo: false, threeDLayer: false, adjustmentLayer: false }],
    } }],
  },
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
  command: request.command,  outcome: "APPLIED",
  error: null,
  affectedObjects: [],
  readback: {},
  projectSnapshot: null,
  environmentProbe: null,
  hostProjectRevision: revision,
  diagnostics: { adapterProtocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11, adapterBuild: "test", command: request.command },
  proofArtifactRefs: [],
});

test("reflex planner expands one impact goal into a three-action local horizon with recovery", () => {
  const planner = new ReflexPlanner();
  const plan = planner.compile({ kind: "IMPACT_PULSE", comp: { stableId: "COMP" }, layer: { stableId: "LAYER" }, intensity: 0.7, direction: "RIGHT" }, baselineState());
  assert.equal(plan.route, "LOCAL");
  assert.equal(plan.intents.length, 3);
  assert.equal(plan.intents.every((intent) => intent.kind === "SET_LAYER_TRANSFORM"), true);
  assert.deepEqual(plan.intents.at(-1).values, { position: [960, 540, 0], scale: [100, 100, 100], rotation: 0, opacity: 100 });
});

test("continuous fast loop executes a reflex horizon without observation between micro-actions", async () => {
  const requests = [];
  const transport = { async dispatch(request) {
    requests.push(structuredClone(request));
    return responseFor(request, request.expectedHostProjectRevision + 1);
  } };
  const client = new AeCepAdapterClientV11(transport, () => `reflex-${requests.length + 1}`);
  const runner = new ContinuousFastLoop(client, baselineState(), { budgetMs: 2000, leaseTtlMs: 60_000 });  const result = await runner.run({
    kind: "IMPACT_PULSE",
    comp: { stableId: "COMP" },
    layer: { stableId: "LAYER" },
    intensity: 0.8,
    direction: "LEFT",
  }, "TX_REFLEX");
  assert.equal(result.route, "LOCAL");
  assert.equal(result.completedActions, 3);
  assert.equal(result.withinBudget, true);
  assert.deepEqual(requests.map((request) => request.command), [
    "layer.set_transform",
    "layer.set_transform",
    "layer.set_transform",
  ]);
  assert.equal(requests.some((request) => request.command === "host.probe" || request.command === "project.inspect"), false);
  assert.deepEqual(requests.map((request) => request.expectedHostProjectRevision), [10, 11, 12]);
});

test("current desktop v1.1 session installs the continuous reflex loop as the default execution runner", async () => {
  const state = baselineState();
  let reads = 0;
  const adapter = {
    observe: async () => { reads += 1; return state; },
  };
  const session = await createDesktopAeSessionV11(adapter, "reflex-test");
  assert.equal(reads, 1);
  assert.equal(session.executionMode, DEFAULT_AE_EXECUTION_MODE);
  assert.equal(session.executionMode, "REFLEX_CONTINUOUS_FAST_LOOP_V1");
  assert.ok(session.runner instanceof ContinuousFastLoop);
});
