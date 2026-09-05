import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AE_CEP_CAPABILITIES,
  AeCepAdapterClient,
  CepEvalScriptTransport,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/index.js";
import {
  AE_ADAPTER_BUILD,
  AE_ADAPTER_COMMANDS,
  AE_ADAPTER_PROTOCOL_VERSION,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol.js";
import { createDesktopAeSession } from "../.tmp/runtime/apps/desktop-host/src/index.js";
import { asCapabilityId } from "../.tmp/runtime/packages/core-contracts/src/index.js";

const environmentProbe = {
  adapterProtocolVersion: AE_ADAPTER_PROTOCOL_VERSION,
  adapterBuild: AE_ADAPTER_BUILD,
  hostName: "Adobe After Effects",
  hostVersion: "26.0-test",
  hostBuild: "test-build",
  os: "Windows test",
  projectOpen: true,
};

const makeProject = () => ({
  hostRevision: 7,
  filePath: "C:/EditFlow/test.aep",
  activeItemHostId: null,
  itemCount: 0,
  items: [],
});

const responseFor = (request, overrides = {}) => ({
  protocolVersion: AE_ADAPTER_PROTOCOL_VERSION,
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
    adapterProtocolVersion: AE_ADAPTER_PROTOCOL_VERSION,
    adapterBuild: AE_ADAPTER_BUILD,
    command: request.command,
  },
  proofArtifactRefs: [],
  ...overrides,
});

class FakeAeTransport {
  constructor() {
    this.project = makeProject();
    this.requests = [];
    this.mutations = 0;
  }

  async dispatch(request) {
    this.requests.push(structuredClone(request));
    if (request.command === "host.probe") {
      return responseFor(request, { environmentProbe, hostProjectRevision: this.project.hostRevision });
    }
    if (request.command === "project.inspect") {
      return responseFor(request, { projectSnapshot: structuredClone(this.project), hostProjectRevision: this.project.hostRevision });
    }
    if (request.command === "comp.create") {
      if (request.expectedHostProjectRevision !== this.project.hostRevision) {
        return responseFor(request, {
          outcome: "REJECTED",
          error: { category: "STALE_PROJECT_STATE", code: "HOST_REVISION_MISMATCH", message: "stale" },
          hostProjectRevision: this.project.hostRevision,
        });
      }
      this.mutations += 1;
      this.project.hostRevision += 1;
      const item = {
        hostId: 100 + this.mutations,
        stableId: request.payload.stableId,
        kind: "COMPOSITION",
        name: request.payload.name,
        parentHostId: null,
        comment: `[[EDITFLOW2_STABLE:${request.payload.stableId}]]`,
        composition: {
          hostId: 100 + this.mutations,
          stableId: request.payload.stableId,
          name: request.payload.name,
          width: request.payload.width,
          height: request.payload.height,
          pixelAspect: request.payload.pixelAspect,
          duration: request.payload.duration,
          frameRate: request.payload.frameRate,
          displayStartTime: 0,
          layers: [],
        },
      };
      this.project.items.push(item);
      this.project.itemCount = this.project.items.length;
      return responseFor(request, {
        outcome: "APPLIED",
        affectedObjects: [{ stableId: request.payload.stableId, hostId: item.hostId, kind: "COMPOSITION" }],
        readback: { composition: item.composition },
        hostProjectRevision: this.project.hostRevision,
      });
    }
    throw new Error(`Fake transport does not implement ${request.command}`);
  }
}

test("AE adapter command surface is fixed and contains no arbitrary script command", () => {
  assert.equal(AE_ADAPTER_COMMANDS.includes("comp.create"), true);
  assert.equal(AE_ADAPTER_COMMANDS.includes("project.inspect"), true);
  assert.equal(AE_ADAPTER_COMMANDS.some((command) => /jsx|javascript|script\.execute|eval/i.test(command)), false);
  assert.equal(AE_CEP_CAPABILITIES.length, AE_ADAPTER_COMMANDS.length);
});

test("CEP transport serializes hostile payload as data inside the one fixed dispatcher call", async () => {
  let capturedScript = "";
  const bridge = {
    evalScript(script, callback) {
      capturedScript = script;
      const prefix = "EditFlow2_dispatch(";
      const argumentLiteral = script.slice(prefix.length, -1);
      const requestJson = JSON.parse(argumentLiteral);
      const request = JSON.parse(requestJson);
      callback(JSON.stringify(responseFor(request)));
    },
  };
  const transport = new CepEvalScriptTransport(bridge);
  const hostile = "x'); app.quit(); $.global.pwned = true; //";
  const request = {
    protocolVersion: AE_ADAPTER_PROTOCOL_VERSION,
    requestId: "req-safe",
    transactionId: "tx-safe",
    operationId: "op-safe",
    capabilityId: "ae.comp.create",
    command: "comp.create",
    expectedProjectRevision: "ae-revision:7",
    expectedProjectFingerprint: "project:sha256:test",
    expectedHostProjectRevision: 7,
    payload: { name: hostile },
    readbackProfile: null,
  };

  await transport.dispatch(request);
  assert.match(capturedScript, /^EditFlow2_dispatch\(/);
  assert.equal((capturedScript.match(/EditFlow2_dispatch/g) ?? []).length, 1);
  const argumentLiteral = capturedScript.slice("EditFlow2_dispatch(".length, -1);
  const roundTripped = JSON.parse(JSON.parse(argumentLiteral));
  assert.equal(roundTripped.payload.name, hostile);
});

test("desktop session activates the typed AE route only after adapter observation", async () => {
  const transport = new FakeAeTransport();
  const adapter = new AeCepAdapterClient(transport, () => `req-${transport.requests.length + 1}`);
  const session = await createDesktopAeSession(adapter, "project-m2");
  const resolution = session.registry.resolve(asCapabilityId("ae.comp.create"));
  assert.equal(resolution.route.kind, "HOST_ADAPTER");
  assert.equal(resolution.route.routeId, "ae-cep.v1");
  assert.equal(resolution.capability.proofMaturity, "DECLARED");
});

test("adapter sends host revision guard and returns structural readback for a typed comp.create", async () => {
  const transport = new FakeAeTransport();
  const adapter = new AeCepAdapterClient(transport, () => `req-${transport.requests.length + 1}`);
  const state = await adapter.observe("project-create");
  const response = await adapter.execute("comp.create", {
    transactionId: "tx-create",
    operationId: "op-create",
    payload: {
      stableId: "COMP_M2_001",
      name: "M2 Proof",
      width: 1080,
      height: 1080,
      pixelAspect: 1,
      duration: 4,
      frameRate: 24,
    },
    expectedState: state.observed,
    readbackProfile: "COMPOSITION",
  });
  assert.equal(response.outcome, "APPLIED");
  assert.equal(response.hostProjectRevision, 8);
  assert.equal(response.affectedObjects[0]?.stableId, "COMP_M2_001");
  const mutation = transport.requests.find((request) => request.command === "comp.create");
  assert.equal(mutation.expectedHostProjectRevision, 7);
  assert.equal(mutation.expectedProjectRevision, "ae-revision:7");
  assert.equal(transport.mutations, 1);
});

test("adapter refuses a mutation when structural fingerprint changes even if host revision is unchanged", async () => {
  const transport = new FakeAeTransport();
  const adapter = new AeCepAdapterClient(transport, () => `req-${transport.requests.length + 1}`);
  const state = await adapter.observe("project-drift");
  transport.project.items.push({
    hostId: 777,
    stableId: null,
    kind: "FOOTAGE",
    name: "external-change.mov",
    parentHostId: null,
    comment: "",
  });
  transport.project.itemCount = transport.project.items.length;

  await assert.rejects(
    () => adapter.execute("comp.create", {
      transactionId: "tx-stale",
      operationId: "op-stale",
      payload: { stableId: "COMP_STALE", name: "Should Not Exist", width: 10, height: 10, pixelAspect: 1, duration: 1, frameRate: 24 },
      expectedState: state.observed,
    }),
    /STALE_PROJECT_FINGERPRINT/,
  );
  assert.equal(transport.mutations, 0);
});

test("host ExtendScript exposes a fixed dispatcher and contains no dynamic code evaluator", async () => {
  const source = await readFile("packages/adapters/ae-cep/host/editflow_host.jsx", "utf8");
  assert.match(source, /EditFlow2_dispatch/);
  assert.match(source, /var handlers = \{\}/);
  assert.match(source, /handlers\["comp\.create"\]/);
  assert.match(source, /HOST_REVISION_MISMATCH/);
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.doesNotMatch(source, /new\s+Function\s*\(/);
});
