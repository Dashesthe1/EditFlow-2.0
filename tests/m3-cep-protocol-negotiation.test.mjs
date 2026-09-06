import test from "node:test";
import assert from "node:assert/strict";

import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";
import { AE_ADAPTER_PROTOCOL_VERSION_V11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_1.js";
import { AE_MASK_PROTOCOL_VERSION_V12 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_2.js";
import { buildMaskRequestV12 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-mask.js";

const token = "m3protocolnegotiationtoken0123456789abcdef0123456789";
const headers = { "Content-Type": "application/json", "X-EditFlow-Token": token };

const register = async (port, body) => {
  const response = await fetch(`http://127.0.0.1:${port}/v1/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      extensionId: "com.editflow2.bridge.panel",
      extensionVersion: "0.1.0-dev.4",
      ...body,
    }),
  });
  return { response, value: await response.json() };
};

const v11Request = (requestId = "REQ_V11_NEGOTIATED") => ({
  protocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
  requestId,
  transactionId: "TX_V11_NEGOTIATED",
  operationId: `OP_${requestId}`,
  capabilityId: "ae.host.probe",
  command: "host.probe",
  expectedProjectRevision: null,
  expectedProjectFingerprint: null,
  expectedHostProjectRevision: null,
  payload: {},
  readbackProfile: null,
});

const v11Response = (request) => ({
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
  environmentProbe: null,
  hostProjectRevision: 1,
  diagnostics: {
    adapterProtocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
    adapterBuild: "0.1.0-dev.3",
    command: request.command,
  },
  proofArtifactRefs: [],
});

const v12Response = (request) => ({
  protocolVersion: AE_MASK_PROTOCOL_VERSION_V12,
  requestId: request.requestId,
  transactionId: request.transactionId,
  operationId: request.operationId,
  capabilityId: request.capabilityId,
  command: request.command,
  outcome: "NO_OP",
  error: null,
  affectedObjects: [],
  readback: { mask: { stableId: "MASK_NEGOTIATED" } },
  hostProjectRevision: 1,
  diagnostics: {
    adapterProtocolVersion: AE_MASK_PROTOCOL_VERSION_V12,
    adapterBuild: "0.4.0-dev.1",
    command: request.command,
    notes: [],
  },
});

const leaseAndRespond = async (port, sessionId, responseFactory) => {
  const next = await fetch(`http://127.0.0.1:${port}/v1/next?sessionId=${encodeURIComponent(sessionId)}`, { headers });
  assert.equal(next.status, 200);
  const request = await next.json();
  const responseValue = responseFactory(request);
  const accepted = await fetch(`http://127.0.0.1:${port}/v1/response`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sessionId, response: responseValue }),
  });
  assert.equal(accepted.status, 200);
  return { request, responseValue };
};

test("dual-capability panel negotiates 1.2 and carries both M2 1.1 and M3 1.2 requests", async () => {
  const broker = new LoopbackCepBroker({ port: 0, token, commandTimeoutMs: 2000, commandLeaseMs: 50 });
  const port = await broker.start();
  try {
    const registration = await register(port, {
      protocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
      supportedProtocolVersions: [AE_MASK_PROTOCOL_VERSION_V12, AE_ADAPTER_PROTOCOL_VERSION_V11],
    });
    assert.equal(registration.response.status, 200);
    assert.equal(registration.value.protocolVersion, AE_MASK_PROTOCOL_VERSION_V12);
    assert.deepEqual(registration.value.supportedProtocolVersions, [AE_MASK_PROTOCOL_VERSION_V12, AE_ADAPTER_PROTOCOL_VERSION_V11]);

    const request11 = v11Request();
    const dispatch11 = broker.dispatch(request11);
    const leased11 = await leaseAndRespond(port, registration.value.sessionId, v11Response);
    assert.equal(leased11.request.protocolVersion, AE_ADAPTER_PROTOCOL_VERSION_V11);
    assert.deepEqual(await dispatch11, leased11.responseValue);

    const request12 = buildMaskRequestV12({
      requestId: "REQ_V12_NEGOTIATED",
      transactionId: "TX_V12_NEGOTIATED",
      operationId: "OP_V12_NEGOTIATED",
      command: "mask.readback",
      expectedHostProjectRevision: null,
      payload: {
        comp: { stableId: "COMP_NEGOTIATED" },
        layer: { stableId: "LAYER_NEGOTIATED" },
        mask: { stableId: "MASK_NEGOTIATED" },
      },
    });
    const dispatch12 = broker.dispatch(request12);
    const leased12 = await leaseAndRespond(port, registration.value.sessionId, v12Response);
    assert.equal(leased12.request.protocolVersion, AE_MASK_PROTOCOL_VERSION_V12);
    assert.deepEqual(await dispatch12, leased12.responseValue);
  } finally {
    await broker.stop();
  }
});

test("legacy 1.1 panel remains valid and M3 1.2 dispatch fails before leasing", async () => {
  const broker = new LoopbackCepBroker({ port: 0, token, commandTimeoutMs: 2000, commandLeaseMs: 50 });
  const port = await broker.start();
  try {
    const registration = await register(port, { protocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11 });
    assert.equal(registration.response.status, 200);
    assert.equal(registration.value.protocolVersion, AE_ADAPTER_PROTOCOL_VERSION_V11);

    const request12 = buildMaskRequestV12({
      requestId: "REQ_V12_LEGACY_PANEL",
      transactionId: "TX_V12_LEGACY_PANEL",
      operationId: "OP_V12_LEGACY_PANEL",
      command: "mask.readback",
      expectedHostProjectRevision: null,
      payload: {
        comp: { stableId: "COMP_LEGACY" },
        layer: { stableId: "LAYER_LEGACY" },
        mask: { stableId: "MASK_LEGACY" },
      },
    });
    await assert.rejects(broker.dispatch(request12), /CEP_BROKER_PROTOCOL_UNAVAILABLE: 1\.2\.0/);

    const request11 = v11Request("REQ_V11_LEGACY_PANEL");
    const dispatch11 = broker.dispatch(request11);
    const leased11 = await leaseAndRespond(port, registration.value.sessionId, v11Response);
    assert.equal(leased11.request.protocolVersion, AE_ADAPTER_PROTOCOL_VERSION_V11);
    assert.deepEqual(await dispatch11, leased11.responseValue);
  } finally {
    await broker.stop();
  }
});

test("registration rejects sessions with no mutually supported protocol", async () => {
  const broker = new LoopbackCepBroker({ port: 0, token, commandTimeoutMs: 2000 });
  const port = await broker.start();
  try {
    const registration = await register(port, {
      protocolVersion: "9.9.9",
      supportedProtocolVersions: ["9.9.9"],
    });
    assert.equal(registration.response.status, 409);
    assert.equal(registration.value.error, "PROTOCOL_VERSION_MISMATCH");
    assert.deepEqual(registration.value.supportedProtocolVersions, [AE_MASK_PROTOCOL_VERSION_V12, AE_ADAPTER_PROTOCOL_VERSION_V11]);
  } finally {
    await broker.stop();
  }
});
