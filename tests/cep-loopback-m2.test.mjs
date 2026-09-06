import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";
import { AE_ADAPTER_PROTOCOL_VERSION_V11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_1.js";

const token = "0123456789abcdef0123456789abcdef0123456789abcdef";

const headers = { "Content-Type": "application/json", "X-EditFlow-Token": token };

const registerPanel = async (port, extensionVersion = "0.1.0-dev.4") => {
  const response = await fetch(`http://127.0.0.1:${port}/v1/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      protocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
      extensionId: "com.editflow2.bridge.panel",
      extensionVersion,
    }),
  });
  assert.equal(response.status, 200);
  return await response.json();
};

const makeRequest = (requestId = "REQ_LOOPBACK_1") => ({
  protocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
  requestId,
  transactionId: "TX_LOOPBACK",
  operationId: `OP_${requestId}`,
  capabilityId: "ae.host.probe",
  command: "host.probe",
  expectedProjectRevision: null,
  expectedProjectFingerprint: null,
  expectedHostProjectRevision: null,
  payload: {},
  readbackProfile: null,
});

const makeResponse = (request) => ({
  protocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
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
  environmentProbe: {
    adapterProtocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
    adapterBuild: "0.1.0-dev.4",
    hostName: "Adobe After Effects",
    hostVersion: "26.0-test",
    hostBuild: "test",
    os: "Windows test",
    projectOpen: true,
  },
  hostProjectRevision: 1,
  diagnostics: {
    adapterProtocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
    adapterBuild: "0.1.0-dev.4",
    command: request.command,
  },
  proofArtifactRefs: [],
});

test("loopback CEP broker binds locally, rejects bad tokens, and correlates panel responses", async () => {
  const broker = new LoopbackCepBroker({ port: 0, token, commandTimeoutMs: 2000, commandLeaseMs: 50 });
  const port = await broker.start();
  try {
    const unauthorized = await fetch(`http://127.0.0.1:${port}/v1/status`);
    assert.equal(unauthorized.status, 401);

    const registered = await registerPanel(port);
    assert.equal(registered.protocolVersion, AE_ADAPTER_PROTOCOL_VERSION_V11);

    const request = makeRequest();
    const dispatchPromise = broker.dispatch(request);
    const next = await fetch(`http://127.0.0.1:${port}/v1/next?sessionId=${encodeURIComponent(registered.sessionId)}`, { headers });
    assert.equal(next.status, 200);
    assert.deepEqual(await next.json(), request);

    const responseValue = makeResponse(request);
    const accepted = await fetch(`http://127.0.0.1:${port}/v1/response`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId: registered.sessionId, response: responseValue }),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await dispatchPromise, responseValue);
  } finally {
    await broker.stop();
  }
});

test("a re-registered CEP panel receives an unacknowledged leased request", async () => {
  const broker = new LoopbackCepBroker({ port: 0, token, commandTimeoutMs: 2000, commandLeaseMs: 5000 });
  const port = await broker.start();
  try {
    const first = await registerPanel(port);
    const request = makeRequest("REQ_RECONNECT");
    const dispatchPromise = broker.dispatch(request);

    const leased = await fetch(`http://127.0.0.1:${port}/v1/next?sessionId=${encodeURIComponent(first.sessionId)}`, { headers });
    assert.equal(leased.status, 200);
    assert.equal((await leased.json()).requestId, request.requestId);

    const second = await registerPanel(port);
    assert.notEqual(second.sessionId, first.sessionId);
    const redelivered = await fetch(`http://127.0.0.1:${port}/v1/next?sessionId=${encodeURIComponent(second.sessionId)}`, { headers });
    assert.equal(redelivered.status, 200);
    assert.equal((await redelivered.json()).requestId, request.requestId);

    const responseValue = makeResponse(request);
    const accepted = await fetch(`http://127.0.0.1:${port}/v1/response`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId: second.sessionId, response: responseValue }),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await dispatchPromise, responseValue);
  } finally {
    await broker.stop();
  }
});

test("CEP extension uses the fixed dispatcher and a CEP 12 AE manifest", async () => {
  const manifest = await readFile("packages/adapters/ae-cep/extension/CSXS/manifest.xml", "utf8");
  const client = await readFile("packages/adapters/ae-cep/extension/client/bridge.js", "utf8");
  const bootstrap = await readFile("packages/adapters/ae-cep/extension/host/bootstrap.jsx", "utf8");

  assert.match(manifest, /Version="12\.0"/);
  assert.match(manifest, /Host Name="AEFT"/);
  assert.match(manifest, /RequiredRuntime Name="CSXS" Version="12\.0"/);
  assert.match(manifest, /ScriptPath>\.\/host\/bootstrap\.jsx/);
  assert.match(client, /EditFlow2_dispatch\(/);
  assert.match(client, /window\.__adobe_cep__/);
  assert.match(client, /getSystemPath\("extension"\)/);
  assert.match(client, /editflow_host_current\.jsx/);
  assert.match(client, /\$\.evalFile\(hostFile\)/);
  assert.match(client, /X-EditFlow-Token/);
  assert.doesNotMatch(client, /new\s+Function\s*\(/);
  assert.doesNotMatch(client, /\beval\s*\(/);
  assert.match(bootstrap, /EditFlow2_CEP_SCRIPT_PATH_LOADED/);
  assert.doesNotMatch(bootstrap, /\$\.fileName/);
  assert.doesNotMatch(bootstrap, /editflow_host_current\.jsx/);
});

test("Windows CEP installer preserves authentication across ordinary reinstalls and rotates only explicitly", async () => {
  const installer = await readFile("scripts/windows/install-editflow-cep.ps1", "utf8");
  assert.match(installer, /APPDATA.*Adobe\\CEP\\extensions\\com\.editflow2\.bridge/);
  assert.match(installer, /LOCALAPPDATA.*EditFlow2/);
  assert.match(installer, /\[switch\]\$RotateToken/);
  assert.match(installer, /Test-Path \$ConfigPath -PathType Leaf/);
  assert.match(installer, /ConvertFrom-Json/);
  assert.match(installer, /\$Token = \$ExistingConfig\.token/);
  assert.match(installer, /if \(-not \$Token\) \{/);
  assert.match(installer, /RandomNumberGenerator/);
  assert.match(installer, /CSXS\.12/);
  assert.match(installer, /PlayerDebugMode/);
  assert.match(installer, /Authentication token preserved/);
  assert.doesNotMatch(installer, /Write-Host\s+.*\$Token/);
});
