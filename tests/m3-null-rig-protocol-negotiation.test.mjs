import test from "node:test";
import assert from "node:assert/strict";

import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";
import { AE_ADAPTER_PROTOCOL_VERSION_V11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_1.js";
import { AE_MASK_PROTOCOL_VERSION_V12 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_2.js";
import { AE_COMPOSITE_PROTOCOL_VERSION_V13 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_3.js";
import { AE_PARENTING_PROTOCOL_VERSION_V14 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_4.js";
import { AE_NULL_RIG_PROTOCOL_VERSION_V15 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_5.js";
import { buildNullRigRequestV15 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-null-rigs.js";

const token = "m3nullrigprotocoltoken0123456789abcdef0123456789";
const headers = { "Content-Type": "application/json", "X-EditFlow-Token": token };
const protocols = [
  AE_NULL_RIG_PROTOCOL_VERSION_V15,
  AE_PARENTING_PROTOCOL_VERSION_V14,
  AE_COMPOSITE_PROTOCOL_VERSION_V13,
  AE_MASK_PROTOCOL_VERSION_V12,
  AE_ADAPTER_PROTOCOL_VERSION_V11,
];

const register = async (port, supportedProtocolVersions = protocols) => {
  const response = await fetch(`http://127.0.0.1:${port}/v1/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      protocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
      supportedProtocolVersions,
      extensionId: "com.editflow2.bridge.panel",
      extensionVersion: "0.1.0-dev.5",
    }),
  });
  return { response, value: await response.json() };
};

const nullRigResponse = (request) => ({
  protocolVersion: AE_NULL_RIG_PROTOCOL_VERSION_V15,
  requestId: request.requestId,
  transactionId: request.transactionId,
  operationId: request.operationId,
  capabilityId: request.capabilityId,
  command: request.command,
  outcome: "NO_OP",
  error: null,
  affectedObjects: [],
  readback: { relationship: { controller: { isNull: true }, childCount: 0, directChildren: [] } },
  hostProjectRevision: 1,
  diagnostics: {
    adapterProtocolVersion: AE_NULL_RIG_PROTOCOL_VERSION_V15,
    adapterBuild: "0.5.0-dev.1",
    command: request.command,
    notes: [],
  },
});

test("explicit null-rig broker negotiates protocol 1.5 and transports a typed request", async () => {
  const broker = new LoopbackCepBroker({
    port: 0,
    token,
    commandTimeoutMs: 2000,
    commandLeaseMs: 50,
    supportedProtocolVersions: protocols,
  });
  const port = await broker.start();
  try {
    const registration = await register(port);
    assert.equal(registration.response.status, 200);
    assert.equal(registration.value.protocolVersion, AE_NULL_RIG_PROTOCOL_VERSION_V15);
    assert.deepEqual(registration.value.supportedProtocolVersions, protocols);

    const request = buildNullRigRequestV15({
      requestId: "REQ_V15_NEGOTIATED",
      transactionId: "TX_V15_NEGOTIATED",
      operationId: "OP_V15_NEGOTIATED",
      command: "rig.relationship_readback",
      expectedHostProjectRevision: null,
      payload: {
        comp: { stableId: "COMP_V15" },
        controller: { stableId: "NULL_V15" },
      },
    });
    const dispatch = broker.dispatch(request);
    const next = await fetch(`http://127.0.0.1:${port}/v1/next?sessionId=${encodeURIComponent(registration.value.sessionId)}`, { headers });
    assert.equal(next.status, 200);
    assert.deepEqual(await next.json(), request);

    const responseValue = nullRigResponse(request);
    const accepted = await fetch(`http://127.0.0.1:${port}/v1/response`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId: registration.value.sessionId, response: responseValue }),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await dispatch, responseValue);
  } finally {
    await broker.stop();
  }
});

test("a panel that omits 1.5 cannot lease null-rig commands even when the broker supports them", async () => {
  const broker = new LoopbackCepBroker({
    port: 0,
    token,
    commandTimeoutMs: 2000,
    supportedProtocolVersions: protocols,
  });
  const port = await broker.start();
  try {
    const registration = await register(port, [AE_PARENTING_PROTOCOL_VERSION_V14, AE_COMPOSITE_PROTOCOL_VERSION_V13, AE_MASK_PROTOCOL_VERSION_V12, AE_ADAPTER_PROTOCOL_VERSION_V11]);
    assert.equal(registration.response.status, 200);
    assert.equal(registration.value.protocolVersion, AE_PARENTING_PROTOCOL_VERSION_V14);

    const request = buildNullRigRequestV15({
      requestId: "REQ_V15_NOT_NEGOTIATED",
      transactionId: "TX_V15_NOT_NEGOTIATED",
      operationId: "OP_V15_NOT_NEGOTIATED",
      command: "rig.relationship_readback",
      expectedHostProjectRevision: null,
      payload: {
        comp: { stableId: "COMP_V15" },
        controller: { stableId: "NULL_V15" },
      },
    });
    await assert.rejects(broker.dispatch(request), /CEP_BROKER_PROTOCOL_UNAVAILABLE: 1\.5\.0/);
  } finally {
    await broker.stop();
  }
});

test("default broker remains the accepted 1.1-only runtime until a caller opts into newer protocols", async () => {
  const broker = new LoopbackCepBroker({ port: 0, token, commandTimeoutMs: 2000 });
  const port = await broker.start();
  try {
    const registration = await register(port);
    assert.equal(registration.response.status, 200);
    assert.equal(registration.value.protocolVersion, AE_ADAPTER_PROTOCOL_VERSION_V11);
    assert.deepEqual(registration.value.supportedProtocolVersions, [AE_ADAPTER_PROTOCOL_VERSION_V11]);
  } finally {
    await broker.stop();
  }
});
