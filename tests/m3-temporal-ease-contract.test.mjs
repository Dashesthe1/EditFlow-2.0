import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import {
  AE_TEMPORAL_EASE_ADAPTER_BUILD_V18,
  AE_TEMPORAL_EASE_COMMANDS_V18,
  AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18,
  AE_TEMPORAL_EASE_ROUTE_ID_V18,
  capabilityForTemporalEaseCommandV18,
  isAeTemporalEaseCommandV18,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_8.js";
import {
  CepEvalScriptTemporalEaseTransportV18,
  M3_TEMPORAL_EASE_CAPABILITIES_V18,
  buildTemporalEaseRequestV18,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-temporal-ease.js";
import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_temporal_ease.jsx";
const loaderPath = "packages/adapters/ae-cep/host/editflow_host_current_v18.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";
const bridgePath = "packages/adapters/ae-cep/extension/client/bridge.js";
const runtimeConfigPath = "packages/adapters/ae-cep/extension/client/runtime-config.js";
const foundationPath = "docs/16_M3_GRAPH_EDITOR_TEMPORAL_EASE_FOUNDATION.md";
const token = "m3temporaleasetoken0123456789abcdef0123456789abcdef";
const headers = { "Content-Type": "application/json", "X-EditFlow-Token": token };

const protocols = ["1.8.0", "1.7.0", "1.6.0", "1.5.0", "1.4.0", "1.3.0", "1.2.0", "1.1.0"];

test("M3 temporal ease protocol 1.8 is fixed to roadmap item 10 numeric Graph Editor handles", () => {
  assert.equal(AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18, "1.8.0");
  assert.equal(AE_TEMPORAL_EASE_ADAPTER_BUILD_V18, "0.4.0-dev.8");
  assert.equal(AE_TEMPORAL_EASE_ROUTE_ID_V18, "ae-cep.temporal-ease.v1_8");
  assert.deepEqual([...AE_TEMPORAL_EASE_COMMANDS_V18], [
    "property.temporal_ease.set",
    "property.temporal_ease.readback",
  ]);
  assert.equal(isAeTemporalEaseCommandV18("property.temporal_ease.set"), true);
  assert.equal(isAeTemporalEaseCommandV18("property.spatial_tangents.set"), false);
  assert.equal(capabilityForTemporalEaseCommandV18("property.temporal_ease.set"), "ae.property.temporal_ease.set");
  assert.equal(capabilityForTemporalEaseCommandV18("property.temporal_ease.readback"), "ae.property.temporal_ease.readback");
});

test("protocol 1.8 capabilities stay PARTIAL DECLARED until real-AE proof is accepted", () => {
  assert.equal(M3_TEMPORAL_EASE_CAPABILITIES_V18.length, 2);
  for (const capability of M3_TEMPORAL_EASE_CAPABILITIES_V18) {
    assert.equal(capability.status, "PARTIAL");
    assert.equal(capability.proofMaturity, "DECLARED");
    assert.equal(capability.routes.length, 1);
    assert.equal(capability.routes[0].routeId, AE_TEMPORAL_EASE_ROUTE_ID_V18);
    assert.equal(capability.routes[0].available, true);
    assert.equal(capability.fallbackPolicy, "FORBID");
  }
});

test("request builder carries exact incoming and outgoing speed/influence arrays", () => {
  const request = buildTemporalEaseRequestV18({
    requestId: "REQ_EASE_BUILD",
    transactionId: "TX_EASE_BUILD",
    operationId: "OP_EASE_BUILD",
    command: "property.temporal_ease.set",
    expectedHostProjectRevision: 91,
    payload: {
      comp: { stableId: "COMP_EASE" },
      layer: { stableId: "LAYER_EASE" },
      propertyPath: ["ADBE Transform Group", "ADBE Scale"],
      keyIndex: 2,
      ease: {
        inEase: [{ speed: 0, influence: 33.333333 }, { speed: 10, influence: 45 }],
        outEase: [{ speed: 125, influence: 70 }, { speed: 95, influence: 55 }],
      },
    },
  });
  assert.equal(request.protocolVersion, "1.8.0");
  assert.equal(request.capabilityId, "ae.property.temporal_ease.set");
  assert.equal(request.expectedHostProjectRevision, 91);
  assert.equal(request.readbackProfile, "M3_TEMPORAL_EASE_STRUCTURAL");
});

test("protocol 1.8 transport serializes hostile property-path text as data", async () => {
  let captured = null;
  const hostileCall = "app" + ".quit";
  const request = buildTemporalEaseRequestV18({
    requestId: "REQ_EASE_ESCAPE",
    transactionId: "TX_EASE_ESCAPE",
    operationId: "OP_EASE_ESCAPE",
    command: "property.temporal_ease.readback",
    expectedHostProjectRevision: null,
    payload: { comp: { stableId: "COMP" }, layer: { stableId: "LAYER" }, propertyPath: ["\"); " + hostileCall + "(); //"], keyIndex: 1 },
  });
  const bridge = {
    evalScript(script, callback) {
      captured = script;
      callback(JSON.stringify({
        protocolVersion: "1.8.0", requestId: request.requestId, transactionId: request.transactionId,
        operationId: request.operationId, capabilityId: request.capabilityId, command: request.command,
        outcome: "NO_OP", error: null, affectedObjects: [], readback: { temporalEase: { keyIndex: 1 } },
        hostProjectRevision: 91,
        diagnostics: { adapterProtocolVersion: "1.8.0", adapterBuild: "0.4.0-dev.8", command: request.command, notes: [] },
      }));
    },
  };
  assert.equal((await new CepEvalScriptTemporalEaseTransportV18(bridge).dispatch(request)).outcome, "NO_OP");
  assert.ok(captured.startsWith("EditFlow2_dispatch(\"") && captured.endsWith("\")"));
  assert.equal((captured.match(/EditFlow2_dispatch/g) ?? []).length, 1);
  assert.ok(captured.includes(hostileCall));
  assert.ok(!captured.includes("); " + hostileCall + "(); //\")"));
});

test("host exposes only item-10 temporal ease APIs with exact validation and rollback", async () => {
  const source = await readFile(hostPath, "utf8");
  for (const command of AE_TEMPORAL_EASE_COMMANDS_V18) assert.ok(source.includes(`"${command}"`));
  for (const method of ["keyInTemporalEase", "keyOutTemporalEase", "setTemporalEaseAtKey"]) {
    assert.match(source, new RegExp(`\\.${method}\\(`));
  }
  assert.match(source, /new\s+KeyframeEase\s*\(/);
  assert.match(source, /PropertyValueType\.TwoD/);
  assert.match(source, /PropertyValueType\.ThreeD/);
  assert.match(source, /TEMPORAL_EASE_CARDINALITY_MISMATCH/);
  assert.match(source, /influence < 0\.1 \|\| value\.influence > 100\.0/);
  assert.match(source, /TEMPORAL_EASE_REQUIRES_BEZIER_INTERPOLATION/);
  assert.match(source, /TEMPORAL_EASE_REQUIRES_MANUAL_BEZIER/);
  assert.match(source, /EXPECTED_HOST_REVISION_REQUIRED/);
  assert.match(source, /HOST_REVISION_CONFLICT/);
  assert.match(source, /TEMPORAL_EASE_READBACK_MISMATCH/);
  assert.match(source, /app\.beginUndoGroup/);
  assert.match(source, /app\.executeCommand\(16\)/);
  for (const forbiddenCall of [
    "setSpatialTangentsAtKey", "keyInSpatialTangent", "keyOutSpatialTangent",
    "setSpatialAutoBezierAtKey", "setSpatialContinuousAtKey", "setRovingAtKey",
  ]) assert.doesNotMatch(source, new RegExp(`\\.${forbiddenCall}\\(`));
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.doesNotThrow(() => new vm.Script(source, { filename: hostPath }));
});

test("v18 loader fails closed only for 1.8 and preserves accepted 1.1-1.7 dispatch", async () => {
  const source = await readFile(loaderPath, "utf8");
  assert.match(source, /editflow_host_current_v17\.jsx/);
  assert.match(source, /editflow_host_m3_temporal_ease\.jsx/);
  assert.match(source, /M3_TEMPORAL_EASE_MODULE_LOAD_FAILED/);
  assert.match(source, /request\.protocolVersion === "1\.8\.0"/);
  assert.match(source, /accepted protocol 1\.1-1\.7 dispatch remains available/);
  assert.match(source, /EditFlow2_HOST_PROTOCOL_18 = true/);
  assert.doesNotThrow(() => new vm.Script(source, { filename: loaderPath }));
});

test("installer and CEP client advertise 1.8 additively and bootstrap v18", async () => {
  const [installer, bridge, runtimeConfig] = await Promise.all([
    readFile(installerPath, "utf8"), readFile(bridgePath, "utf8"), readFile(runtimeConfigPath, "utf8"),
  ]);
  const expectedProtocols = JSON.stringify(protocols);
  assert.match(installer, /editflow_host_m3_temporal_ease\.jsx/);
  assert.match(installer, /editflow_host_current_v18\.jsx/);
  assert.match(installer, /0\.1\.0-dev\.8/);
  assert.match(installer, /supportedProtocolVersions = @\("1\.8\.0", "1\.7\.0", "1\.6\.0", "1\.5\.0", "1\.4\.0", "1\.3\.0", "1\.2\.0", "1\.1\.0"\)/);
  assert.ok(bridge.includes(`KNOWN_PROTOCOLS = ${expectedProtocols}`));
  assert.match(bridge, /editflow_host_current_v18\.jsx/);
  assert.match(bridge, /EditFlow2_HOST_PROTOCOL_18/);
  assert.ok(runtimeConfig.includes(`supportedProtocolVersions: ${expectedProtocols}`));
  assert.match(runtimeConfig, /0\.1\.0-dev\.8/);
});

test("loopback broker negotiates 1.8 and carries typed temporal ease readback", async () => {
  const broker = new LoopbackCepBroker({ port: 0, token, commandTimeoutMs: 2000, commandLeaseMs: 50, supportedProtocolVersions: protocols });
  const port = await broker.start();
  try {
    const registrationResponse = await fetch(`http://127.0.0.1:${port}/v1/register`, {
      method: "POST", headers,
      body: JSON.stringify({ protocolVersion: "1.1.0", supportedProtocolVersions: protocols, extensionId: "com.editflow2.bridge.panel", extensionVersion: "0.1.0-dev.8" }),
    });
    const registration = await registrationResponse.json();
    assert.equal(registrationResponse.status, 200);
    assert.equal(registration.protocolVersion, "1.8.0");

    const request = buildTemporalEaseRequestV18({
      requestId: "REQ_EASE_BROKER", transactionId: "TX_EASE_BROKER", operationId: "OP_EASE_BROKER",
      command: "property.temporal_ease.readback", expectedHostProjectRevision: null,
      payload: { comp: { stableId: "COMP" }, layer: { stableId: "LAYER" }, propertyPath: ["ADBE Transform Group", "ADBE Opacity"], keyIndex: 1 },
    });
    const dispatched = broker.dispatch(request);
    const nextResponse = await fetch(`http://127.0.0.1:${port}/v1/next?sessionId=${encodeURIComponent(registration.sessionId)}`, { headers });
    const leased = await nextResponse.json();
    assert.equal(nextResponse.status, 200);
    assert.equal(leased.protocolVersion, "1.8.0");

    const response = {
      protocolVersion: "1.8.0", requestId: request.requestId, transactionId: request.transactionId,
      operationId: request.operationId, capabilityId: request.capabilityId, command: request.command,
      outcome: "NO_OP", error: null, affectedObjects: [], readback: { temporalEase: { keyIndex: 1 } }, hostProjectRevision: 1,
      diagnostics: { adapterProtocolVersion: "1.8.0", adapterBuild: "0.4.0-dev.8", command: request.command, notes: [] },
    };
    const accepted = await fetch(`http://127.0.0.1:${port}/v1/response`, {
      method: "POST", headers, body: JSON.stringify({ sessionId: registration.sessionId, response }),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await dispatched, response);
  } finally {
    await broker.stop();
  }
});

test("foundation keeps spatial tangent, roving, and rendering controls in later tranches", async () => {
  const source = await readFile(foundationPath, "utf8");
  assert.match(source, /Milestone 3 item 10/);
  assert.match(source, /KeyframeEase/);
  assert.match(source, /0\.1\.\.100\.0/);
  assert.match(source, /PropertyValueType\.TwoD/);
  assert.match(source, /PropertyValueType\.ThreeD/);
  assert.match(source, /P1 — exact structural readback/);
  assert.match(source, /P5 — transfer/);
  assert.match(source, /Milestone 3 item 11 spatial Bezier paths\/tangents/);
  assert.match(source, /Milestone 3 item 12 markers, motion blur, frame blending/);
  assert.match(source, /PARTIAL \/ DECLARED/);
});
