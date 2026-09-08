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
import {
  applyM3TemporalEaseAcceptedP1P2Evidence,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-temporal-ease-proof-maturity.js";
import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_temporal_ease.jsx";
const loaderPath = "packages/adapters/ae-cep/host/editflow_host_current_v18.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";
const bridgePath = "packages/adapters/ae-cep/extension/client/bridge.js";
const runtimeConfigPath = "packages/adapters/ae-cep/extension/client/runtime-config.js";
const maturityPath = "packages/adapters/ae-cep/src/m3-temporal-ease-proof-maturity.ts";
const foundationPath = "docs/16_M3_GRAPH_EDITOR_TEMPORAL_EASE_FOUNDATION.md";
const acceptancePath = "proofs/diagnostics/m3-temporal-ease-p1-p2-run2-acceptance.md";
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

test("historical accepted real-AE P1/P2 projection remains PARTIAL STRUCTURAL after later proof acceptance", () => {
  const historicalP1P2 = applyM3TemporalEaseAcceptedP1P2Evidence(M3_TEMPORAL_EASE_CAPABILITIES_V18);
  assert.equal(historicalP1P2.length, 2);
  for (const capability of historicalP1P2) {
    assert.equal(capability.status, "PARTIAL");
    assert.equal(capability.proofMaturity, "STRUCTURAL");
    assert.equal(capability.routes.length, 1);
    assert.equal(capability.routes[0].routeId, AE_TEMPORAL_EASE_ROUTE_ID_V18);
    assert.equal(capability.routes[0].available, true);
    assert.equal(capability.fallbackPolicy, "FORBID");
  }
});

test("accepted temporal-ease P1/P2 provenance remains exact without constraining later accepted P3-P5 evidence", async () => {
  const [maturity, acceptance] = await Promise.all([
    readFile(maturityPath, "utf8"),
    readFile(acceptancePath, "utf8"),
  ]);
  assert.match(maturity, /718fd72dd9b07c3605163354cf7ce7be26ef8f23/);
  assert.match(maturity, /033e4e2f005a175f48fefaca1912dc54716d7eb4/);
  assert.match(maturity, /34176061647/);
  assert.match(maturity, /101905568438/);
  assert.match(maturity, /10037290595/);
  assert.match(maturity, /b1046dfe32b1b1c73a3acd65e5d5b3deb90fef50e01170ed3b8e8e04d4e2439b/);
  assert.match(maturity, /"ae\.property\.temporal_ease\.set": "STRUCTURAL"/);
  assert.match(maturity, /"ae\.property\.temporal_ease\.readback": "STRUCTURAL"/);
  assert.match(maturity, /export const applyM3TemporalEaseAcceptedP1P2Evidence/);
  assert.match(maturity, /status: "PARTIAL"/);
  assert.match(maturity, /proofMaturity: m3TemporalEaseP1P2MaturityForCapability/);

  assert.match(acceptance, /status: PASS/);
  assert.match(acceptance, /all 44 bounded checks `true`/);
  assert.match(acceptance, /Scale state is written and read back exactly at live cardinality three/);
  assert.match(acceptance, /P3_visual_proof: false/);
  assert.match(acceptance, /P4_failure_injection_rollback: false/);
  assert.match(acceptance, /P5_save_reopen_reconnect_transfer: false/);
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

test("host exposes only item-10 temporal ease APIs with live per-key cardinality, exact validation, and rollback", async () => {
  const source = await readFile(hostPath, "utf8");
  for (const command of AE_TEMPORAL_EASE_COMMANDS_V18) assert.ok(source.includes(`"${command}"`));
  for (const method of ["keyInTemporalEase", "keyOutTemporalEase", "setTemporalEaseAtKey"]) {
    assert.match(source, new RegExp(`\\.${method}\\(`));
  }
  assert.match(source, /new\s+KeyframeEase\s*\(/);
  assert.match(source, /function easeCardinality\(property, keyIndex\)/);
  assert.match(source, /property\.keyInTemporalEase\(keyIndex\)/);
  assert.match(source, /property\.keyOutTemporalEase\(keyIndex\)/);
  assert.match(source, /inLength !== outLength \|\| inLength < 1 \|\| inLength > 3/);
  assert.match(source, /TEMPORAL_EASE_CARDINALITY_READBACK_FAILED/);
  assert.match(source, /TEMPORAL_EASE_CARDINALITY_INVALID/);
  assert.match(source, /TEMPORAL_EASE_CARDINALITY_MISMATCH/);
  assert.doesNotMatch(source, /PropertyValueType\.TwoD|PropertyValueType\.ThreeD/);
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

test("foundation keeps host-truth cardinality and spatial/rendering controls in later tranches", async () => {
  const source = await readFile(foundationPath, "utf8");
  assert.match(source, /PARTIAL \/ STRUCTURAL/);
  assert.match(source, /Milestone 3 item 10/);
  assert.match(source, /KeyframeEase/);
  assert.match(source, /0\.1\.\.100\.0/);
  assert.match(source, /keyInTemporalEase\(keyIndex\)/);
  assert.match(source, /keyOutTemporalEase\(keyIndex\)/);
  assert.match(source, /exposed \*\*three\*\* incoming and \*\*three\*\* outgoing `KeyframeEase` objects/);
  assert.match(source, /scale\.setValue\(\[50, 50\]\)/);
  assert.match(source, /After Effects 25\.6\.6/);
  assert.match(source, /34176061647/);
  assert.match(source, /does \*\*not\*\* infer ease cardinality from `PropertyValueType`/);
  assert.match(source, /P1 — deterministic validation\/rejection: ACCEPTED/);
  assert.match(source, /P2 — exact structural readback: ACCEPTED/);
  assert.match(source, /P3 — viewer-visible proof: OUTSTANDING/);
  assert.match(source, /P4 — induced-failure rollback: OUTSTANDING/);
  assert.match(source, /P5 — save\/reopen\/reconnect transfer: OUTSTANDING/);
  assert.match(source, /Milestone 3 item 11 spatial Bezier paths\/tangents/);
  assert.match(source, /Milestone 3 item 12 markers, motion blur, frame blending/);
});