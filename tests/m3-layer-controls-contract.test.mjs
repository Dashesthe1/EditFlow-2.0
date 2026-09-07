import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AE_LAYER_CONTROLS_ADAPTER_BUILD_V16,
  AE_LAYER_CONTROLS_COMMANDS_V16,
  AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16,
  AE_LAYER_CONTROLS_ROUTE_ID_V16,
  capabilityForLayerControlsCommandV16,
  isAeLayerControlsCommandV16,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_6.js";
import {
  CepEvalScriptLayerControlsTransportV16,
  M3_LAYER_CONTROLS_CAPABILITIES_V16,
  buildLayerControlsRequestV16,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-layer-controls.js";
import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_layer_controls.jsx";
const loaderPath = "packages/adapters/ae-cep/host/editflow_host_current_v16.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";
const bridgePath = "packages/adapters/ae-cep/extension/client/bridge.js";
const runtimeConfigPath = "packages/adapters/ae-cep/extension/client/runtime-config.js";
const token = "m3layercontrolsprotocoltoken0123456789abcdef0123456789";
const headers = { "Content-Type": "application/json", "X-EditFlow-Token": token };

test("M3 layer-controls protocol 1.6 is a fixed switch/order tranche", () => {
  assert.equal(AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16, "1.6.0");
  assert.equal(AE_LAYER_CONTROLS_ADAPTER_BUILD_V16, "0.4.0-dev.6");
  assert.equal(AE_LAYER_CONTROLS_ROUTE_ID_V16, "ae-cep.layer-controls.v1_6");
  assert.deepEqual([...AE_LAYER_CONTROLS_COMMANDS_V16], ["layer.switches.set", "layer.order.set", "layer.controls.readback"]);
  assert.equal(isAeLayerControlsCommandV16("layer.order.set"), true);
  assert.equal(isAeLayerControlsCommandV16("layer.execute_script"), false);
  assert.equal(capabilityForLayerControlsCommandV16("layer.switches.set"), "ae.layer.switches.set");
  assert.equal(capabilityForLayerControlsCommandV16("layer.order.set"), "ae.layer.order.set");
  assert.equal(capabilityForLayerControlsCommandV16("layer.controls.readback"), "ae.layer.controls.readback");
});

test("M3 layer-controls registry reflects accepted real-AE P1-P5 transfer evidence", () => {
  assert.equal(M3_LAYER_CONTROLS_CAPABILITIES_V16.length, AE_LAYER_CONTROLS_COMMANDS_V16.length);
  for (const capability of M3_LAYER_CONTROLS_CAPABILITIES_V16) {
    assert.equal(capability.status, "FULL");
    assert.equal(capability.proofMaturity, "TRANSFER");
    assert.equal(capability.routes.length, 1);
    assert.equal(capability.routes[0].routeId, AE_LAYER_CONTROLS_ROUTE_ID_V16);
    assert.equal(capability.routes[0].available, true);
    assert.equal(capability.fallbackPolicy, "FORBID");
  }
});

test("layer-controls request builder binds typed stable-ref switch mutation", () => {
  const request = buildLayerControlsRequestV16({
    requestId: "REQ_LAYER_BUILD",
    transactionId: "TX_LAYER_BUILD",
    operationId: "OP_LAYER_BUILD",
    command: "layer.switches.set",
    expectedHostProjectRevision: 73,
    payload: {
      comp: { stableId: "COMP_LAYER" },
      layer: { stableId: "LAYER_HERO" },
      switches: { enabled: true, quality: "BEST" },
    },
  });
  assert.equal(request.protocolVersion, "1.6.0");
  assert.equal(request.capabilityId, "ae.layer.switches.set");
  assert.equal(request.expectedHostProjectRevision, 73);
  assert.equal(request.readbackProfile, "M3_LAYER_CONTROLS_STRUCTURAL");
});

test("direct protocol 1.6 CEP transport serializes hostile-looking refs as data", async () => {
  let captured = null;
  const request = buildLayerControlsRequestV16({
    requestId: "REQ_LAYER_ESCAPE",
    transactionId: "TX_LAYER_ESCAPE",
    operationId: "OP_LAYER_ESCAPE",
    command: "layer.controls.readback",
    expectedHostProjectRevision: null,
    payload: { comp: { stableId: "COMP_LAYER" }, layer: { stableId: "LAYER_\"); app.quit(); //" } },
  });
  const bridge = {
    evalScript(script, callback) {
      captured = script;
      callback(JSON.stringify({
        protocolVersion: "1.6.0",
        requestId: request.requestId,
        transactionId: request.transactionId,
        operationId: request.operationId,
        capabilityId: request.capabilityId,
        command: request.command,
        outcome: "NO_OP",
        error: null,
        affectedObjects: [],
        readback: { layerControls: { order: { index: 1 } } },
        hostProjectRevision: 73,
        diagnostics: { adapterProtocolVersion: "1.6.0", adapterBuild: "0.4.0-dev.6", command: request.command, notes: [] },
      }));
    },
  };
  const response = await new CepEvalScriptLayerControlsTransportV16(bridge).dispatch(request);
  assert.equal(response.outcome, "NO_OP");
  assert.ok(captured.startsWith("EditFlow2_dispatch(\"") && captured.endsWith("\")"));
  assert.equal((captured.match(/EditFlow2_dispatch/g) ?? []).length, 1);
  assert.ok(captured.includes("app.quit"));
  assert.ok(!captured.includes("); app.quit(); //\")"));
});

test("layer-controls host encodes switch capability checks, order primitives, readback, stale-state checks, and undo recovery", async () => {
  const source = await readFile(hostPath, "utf8");
  for (const command of AE_LAYER_CONTROLS_COMMANDS_V16) assert.match(source, new RegExp(`\\"${command.replaceAll(".", "\\.")}\\"`));
  for (const method of ["moveToBeginning", "moveToEnd", "moveBefore", "moveAfter"]) assert.match(source, new RegExp(method));
  for (const key of ["enabled", "audioEnabled", "solo", "locked", "shy", "collapseTransformation", "quality", "effectsActive", "adjustmentLayer", "threeDLayer", "preserveTransparency", "samplingQuality"]) assert.match(source, new RegExp(key));
  assert.match(source, /canSetCollapseTransformation/);
  assert.match(source, /LAYER_SWITCH_NOT_SUPPORTED/);
  assert.match(source, /LAYER_SWITCH_READBACK_MISMATCH/);
  assert.match(source, /LAYER_ORDER_READBACK_MISMATCH/);
  assert.match(source, /EXPECTED_HOST_REVISION_REQUIRED/);
  assert.match(source, /HOST_REVISION_CONFLICT/);
  assert.match(source, /app\.beginUndoGroup/);
  assert.match(source, /app\.executeCommand\(16\)/);
  assert.match(source, /if \(wasLocked\) layer\.locked = false/);
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.doesNotMatch(source, /motionBlur\s*:/);
  assert.doesNotMatch(source, /frameBlending/);
});

test("CEP installation advertises 1.6 additively and boots the fail-closed v16 loader", async () => {
  const [loader, installer, bridge, runtimeConfig] = await Promise.all([
    readFile(loaderPath, "utf8"),
    readFile(installerPath, "utf8"),
    readFile(bridgePath, "utf8"),
    readFile(runtimeConfigPath, "utf8"),
  ]);
  assert.match(loader, /editflow_host_current_v15\.jsx/);
  assert.match(loader, /editflow_host_m3_layer_controls\.jsx/);
  assert.match(loader, /M3_LAYER_CONTROLS_MODULE_LOAD_FAILED/);
  assert.match(loader, /request\.protocolVersion === "1\.6\.0"/);
  assert.match(installer, /"editflow_host_m3_layer_controls\.jsx"/);
  assert.match(installer, /"editflow_host_current_v16\.jsx"/);
  assert.match(installer, /supportedProtocolVersions = @\("1\.6\.0", "1\.5\.0", "1\.4\.0", "1\.3\.0", "1\.2\.0", "1\.1\.0"\)/);
  assert.match(bridge, /KNOWN_PROTOCOLS = \["1\.6\.0", "1\.5\.0", "1\.4\.0", "1\.3\.0", "1\.2\.0", "1\.1\.0"\]/);
  assert.match(bridge, /editflow_host_current_v16\.jsx/);
  assert.match(runtimeConfig, /supportedProtocolVersions: \["1\.6\.0", "1\.5\.0", "1\.4\.0", "1\.3\.0", "1\.2\.0", "1\.1\.0"\]/);
});

test("explicit broker negotiates 1.6 and carries a typed layer-controls request", async () => {
  const protocols = ["1.6.0", "1.5.0", "1.4.0", "1.3.0", "1.2.0", "1.1.0"];
  const broker = new LoopbackCepBroker({ port: 0, token, commandTimeoutMs: 2000, commandLeaseMs: 50, supportedProtocolVersions: protocols });
  const port = await broker.start();
  try {
    const registrationResponse = await fetch(`http://127.0.0.1:${port}/v1/register`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        protocolVersion: "1.1.0",
        supportedProtocolVersions: protocols,
        extensionId: "com.editflow2.bridge.panel",
        extensionVersion: "0.1.0-dev.6",
      }),
    });
    const registration = await registrationResponse.json();
    assert.equal(registrationResponse.status, 200);
    assert.equal(registration.protocolVersion, "1.6.0");

    const request = buildLayerControlsRequestV16({
      requestId: "REQ_LAYER_BROKER",
      transactionId: "TX_LAYER_BROKER",
      operationId: "OP_LAYER_BROKER",
      command: "layer.controls.readback",
      expectedHostProjectRevision: null,
      payload: { comp: { stableId: "COMP_LAYER" }, layer: { stableId: "LAYER_HERO" } },
    });
    const dispatched = broker.dispatch(request);
    const nextResponse = await fetch(`http://127.0.0.1:${port}/v1/next?sessionId=${encodeURIComponent(registration.sessionId)}`, { headers });
    assert.equal(nextResponse.status, 200);
    const leased = await nextResponse.json();
    assert.equal(leased.protocolVersion, "1.6.0");
    const response = {
      protocolVersion: "1.6.0",
      requestId: request.requestId,
      transactionId: request.transactionId,
      operationId: request.operationId,
      capabilityId: request.capabilityId,
      command: request.command,
      outcome: "NO_OP",
      error: null,
      affectedObjects: [],
      readback: { layerControls: { order: { index: 1 } } },
      hostProjectRevision: 1,
      diagnostics: { adapterProtocolVersion: "1.6.0", adapterBuild: "0.4.0-dev.6", command: request.command, notes: [] },
    };
    const accepted = await fetch(`http://127.0.0.1:${port}/v1/response`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId: registration.sessionId, response }),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await dispatched, response);
  } finally {
    await broker.stop();
  }
});
