import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const codecPath = "packages/adapters/ae-cep/host/editflow_json.jsx";
const currentHostPath = "packages/adapters/ae-cep/host/editflow_host_current.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";
const bridgePath = "packages/adapters/ae-cep/extension/client/bridge.js";

const loadCodec = async () => {
  const source = await readFile(codecPath, "utf8");
  const context = { $: { global: {} }, Error, String, Number, Object, Array, isFinite, parseInt };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: codecPath });
  return { codec: context.$.global.EditFlow2_JSON, source };
};

test("AE JSON runtime parses and stringifies protocol-shaped data without ambient JSON", async () => {
  const { codec } = await loadCodec();
  assert.equal(typeof codec.parse, "function");
  assert.equal(typeof codec.stringify, "function");

  const request = {
    protocolVersion: "1.1.0",
    requestId: "req-1",
    transactionId: "tx-1",
    operationId: "op-1",
    capabilityId: "ae.host.probe",
    command: "host.probe",
    expectedProjectRevision: null,
    expectedProjectFingerprint: null,
    expectedHostProjectRevision: null,
    payload: { text: "line 1\nline 2", values: [1, true, false, null, -1.25e3] },
    readbackProfile: null,
  };

  const encoded = codec.stringify(request);
  assert.deepEqual(JSON.parse(encoded), request);
  assert.deepEqual(codec.parse(JSON.stringify(request)), request);
});

test("AE JSON runtime is non-eval and rejects prototype-polluting keys", async () => {
  const { codec, source } = await loadCodec();
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.doesNotMatch(source, /new\s+Function\s*\(/);
  assert.throws(() => codec.parse('{"__proto__":{"polluted":true}}'), /Unsafe object key rejected/);

  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => codec.stringify(cyclic), /cyclic structures/);
});

test("current AE host installs fallback JSON, scopes dispatcher JSON, and installer deploys codec", async () => {
  const [currentHost, installer] = await Promise.all([
    readFile(currentHostPath, "utf8"),
    readFile(installerPath, "utf8"),
  ]);

  assert.match(currentHost, /editflow_json\.jsx/);
  assert.match(currentHost, /\$\.global\.EditFlow2_JSON/);
  assert.match(currentHost, /if \(typeof \$\.global\.JSON === "undefined"\) \$\.global\.JSON = \$\.global\.EditFlow2_JSON/);
  assert.match(currentHost, /var hadJson = typeof \$\.global\.JSON !== "undefined"/);
  assert.match(currentHost, /\$\.global\.JSON = \$\.global\.EditFlow2_JSON/);
  assert.match(currentHost, /if \(hadJson\) \$\.global\.JSON = previousJson/);
  assert.match(installer, /"editflow_json\.jsx"/);
});

test("CEP panel wrapper is syntactically valid and returns explicit host errors instead of parsing empty responses", async () => {
  const source = await readFile(bridgePath, "utf8");
  new vm.Script(source, { filename: bridgePath });
  assert.match(source, /\$\.global\.EditFlow2_dispatch/);
  assert.match(source, /__EDITFLOW2_HOST_ERROR__:/);
  assert.match(source, /dispatcher returned an empty evalScript result/);
});
