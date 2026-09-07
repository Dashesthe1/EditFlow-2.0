import test from "node:test";
import assert from "node:assert/strict";

import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";
import { AE_ADAPTER_PROTOCOL_VERSION_V11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_1.js";
import { AE_MASK_PROTOCOL_VERSION_V12 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_2.js";
import { AE_COMPOSITE_PROTOCOL_VERSION_V13 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_3.js";
import { buildCompositeRequestV13 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-composite.js";

const token = "m3compositeprotocoltoken0123456789abcdef0123456789";
const headers = { "Content-Type": "application/json", "X-EditFlow-Token": token };
const protocols = [AE_COMPOSITE_PROTOCOL_VERSION_V13, AE_MASK_PROTOCOL_VERSION_V12, AE_ADAPTER_PROTOCOL_VERSION_V11];

const register = async (port, supportedProtocolVersions = protocols) => {
  const response = await fetch(`http://127.0.0.1:${port}/v1/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      protocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
      supportedProtocolVersions,
      extensionId: "com.editflow2.bridge.panel",
      extensionVersion: "0.1.0-dev.4",
    }),
  });
  return { response, value: await response.json() };
};

const compositeResponse = (request) => ({
  protocolVersion: AE_COMPOSITE_PROTOCOL_VERSION_V13,
  requestId: request.requestId,
  transactionId: request.transactionId,
  operationId: request.operationId,
  capabilityId: request.capabilityId,
  command: request.command,
  outcome: "NO_OP",
  error: null,
  affectedObjects: [],
  readback: { composite: { blendMode: "NORMAL", hasTrackMatte: false } },
  hostProjectRevision: 1,
  diagnostics: {
    adapterProtocolVersion: AE_COMPOSITE_PROTOCOL_VERSION_V13,
    adapterBuild: "0.4.0-dev.3",
    command: request.command,
    notes: [],
  },
});

test("explicit composite broker negotiates protocol 1.3 and transports a typed request", async () => {
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
    assert.equal(registration.value.protocolVersion, AE_COMPOSITE_PROTOCOL_VERSION_V13);
    assert.deepEqual(registration.value.supportedProtocolVersions, protocols);

    const request = buildCompositeRequestV13({
      requestId: "REQ_V13_NEGOTIATED",
      transactionId: "TX_V13_NEGOTIATED",
      operationId: "OP_V13_NEGOTIATED",
      command: "layer.composite_readback",
      expectedHostProjectRevision: null,
      payload: {
        comp: { stableId: "COMP_V13" },
        layer: { stableId: "LAYER_V13" },
      },
    });
    const dispatch = broker.dispatch(request);
    const next = await fetch(`http://127.0.0.1:${port}/v1/next?sessionId=${encodeURIComponent(registration.value.sessionId)}`, { headers });
    assert.equal(next.status, 200);
    assert.deepEqual(await next.json(), request);

    const responseValue = compositeResponse(request);
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

test("a panel that omits 1.3 cannot lease composite commands even when the broker supports them", async () => {
  const broker = new LoopbackCepBroker({
    port: 0,
    token,
    commandTimeoutMs: 2000,
    supportedProtocolVersions: protocols,
  });
  const port = await broker.start();
  try {
    const registration = await register(port, [AE_MASK_PROTOCOL_VERSION_V12, AE_ADAPTER_PROTOCOL_VERSION_V11]);
    assert.equal(registration.response.status, 200);
    assert.equal(registration.value.protocolVersion, AE_MASK_PROTOCOL_VERSION_V12);

    const request = buildCompositeRequestV13({
      requestId: "REQ_V13_NOT_NEGOTIATED",
      transactionId: "TX_V13_NOT_NEGOTIATED",
      operationId: "OP_V13_NOT_NEGOTIATED",
      command: "layer.composite_readback",
      expectedHostProjectRevision: null,
      payload: {
        comp: { stableId: "COMP_V13" },
        layer: { stableId: "LAYER_V13" },
      },
    });
    await assert.rejects(broker.dispatch(request), /CEP_BROKER_PROTOCOL_UNAVAILABLE: 1\.3\.0/);
  } finally {
    await broker.stop();
  }
});
