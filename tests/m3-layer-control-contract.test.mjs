import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AE_LAYER_CONTROL_ADAPTER_BUILD_V16,
  AE_LAYER_CONTROL_COMMANDS_V16,
  AE_LAYER_CONTROL_PROTOCOL_VERSION_V16,
  AE_LAYER_CONTROL_ROUTE_ID_V16,
  capabilityForLayerControlCommandV16,
  isAeLayerControlCommandV16,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_6.js";
import {
  CepEvalScriptLayerControlTransportV16,
  M3_LAYER_CONTROL_CAPABILITIES_V16,
  buildLayerControlRequestV16,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-layer-control.js";
import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_layer_controls.jsx";
const loaderPath = "packages/adapters/ae-cep/host/editflow_host_current_v16.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";
const bridgePath = "packages/adapters/ae-cep/extension/client/bridge.js";
const runtimeConfigPath = "packages/adapters/ae-cep/extension/client/runtime-config.js";
const token = "m3layercontrolprotocoltoken0123456789abcdef012345";
const headers = { "Content-Type": "application/json", "X-EditFlow-Token": token };

test("M3 layer-control protocol 1.6 is a closed switch/order tranche", () => {
  assert.equal(AE_LAYER_CONTROL_PROTOCOL_VERSION_V16, "1.6.0");
  assert.equal(AE_LAYER_CONTROL_ADAPTER_BUILD_V16, "0.4.0-dev.6");
  assert.equal(AE_LAYER_CONTROL_ROUTE_ID_V16, "ae-cep.layer-control.v1_6");
  assert.deepEqual([...AE_LAYER_CONTROL_COMMANDS_V16], ["layer.switches.set", "layer.order.set", "layer.controls.readback"]);
  assert.equal(isAeLayerControlCommandV16("layer.switches.set"), true);
  assert.equal(isAeLayerControlCommandV16("layer.execute_script"), false);
  assert.equal(capabilityForLayerControlCommandV16("layer.switches.set"), "ae.layer.switches.set");
  assert.equal(capabilityForLayerControlCommandV16("layer.order.set"), "ae.layer.order.set");
  assert.equal(capabilityForLayerControlCommandV16("layer.controls.readback"), "ae.layer.controls.readback");
});

test("declared layer-control capabilities remain PARTIAL until real-AE proof", () => {
  assert.equal(M3_LAYER_CONTROL_CAPABILITIES_V16.length, AE_LAYER_CONTROL_COMMANDS_V16.length);
  for (const capability of M3_LAYER_CONTROL_CAPABILITIES_V16) {
    assert.equal(capability.status, "PARTIAL");
    assert.equal(capability.proofMaturity, "DECLARED");
    assert.equal(capability.routes[0].routeId, AE_LAYER_CONTROL_ROUTE_ID_V16);
    assert.equal(capability.routes[0].available, true);
    assert.equal(capability.fallbackPolicy, "FORBID");
  }
});

test("layer-control builder binds command/capability and expected revision", () => {
  const request = buildLayerControlRequestV16({
    requestId: "REQ_LAYER_CONTROL_BUILD",
    transactionId: "TX_LAYER_CONTROL_BUILD",
    operationId: "OP_LAYER_CONTROL_BUILD",
    command: "layer.order.set",
    expectedHostProjectRevision: 19,
    payload: { comp: { stableId: "COMP_MAIN" }, layer: { stableId: "LAYER_HERO" }, placement: { position: "BEGINNING" } },
  });
  assert.equal(request.protocolVersion, "1.6.0");
  assert.equal(request.capabilityId, "ae.layer.order.set");
  assert.equal(request.expectedHostProjectRevision, 19);
  assert.equal(request.readbackProfile, "M3_LAYER_CONTROL_STRUCTURAL");
});

test("direct protocol 1.6 transport treats hostile-looking refs as JSON data", async () => {
  let captured = null;
  const request = buildLayerControlRequestV16({
    requestId: "REQ_LAYER_CONTROL_ESCAPE",
    transactionId: "TX_LAYER_CONTROL_ESCAPE",
    operationId: "OP_LAYER_CONTROL_ESCAPE",
    command: "layer.controls.readback",
    expectedHostProjectRevision: null,
    payload: { comp: { stableId: "COMP_MAIN" }, layer: { stableId: "LAYER_\"); app.quit(); //" } },
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
        readback: { layerControls: { layer: { stableId: "LAYER_TEST", index: 1 }, switches: {}, order: { index: 1 } } },
        hostProjectRevision: 19,
        diagnostics: { adapterProtocolVersion: "1.6.0", adapterBuild: "0.4.0-dev.6", command: request.command, notes: [] },
      }));
    },
  };
  const response = await new CepEvalScriptLayerControlTransportV16(bridge).dispatch(request);
  assert.equal(response.outcome, "NO_OP");
  assert.ok(captured.startsWith("EditFlow2_dispatch(\"") && captured.endsWith("\")"));
  assert.equal((captured.match(/EditFlow2_dispatch/g) ?? []).length, 1);
  assert.ok(captured.includes("app.quit"));
  assert.ok(!captured.includes("); app.quit(); //\")"));
});

test("layer-control host exposes explicit switches/order, stale-state checks, readback, and undo recovery", async () => {
  const source = await readFile(hostPath, "utf8");
  for (const command of AE_LAYER_CONTROL_COMMANDS_V16) assert.match(source, new RegExp(`\\"${command.replaceAll(".", "\\.")}\\"`));
  for (const key of ["enabled", "solo", "shy", "locked", "guideLayer", "adjustmentLayer", "threeDLayer", "collapseTransformation", "audioEnabled"]) assert.match(source, new RegExp(`\\"${key}\\"`));
  assert.match(source, /moveToBeginning\(\)/);
  assert.match(source, /moveToEnd\(\)/);
  assert.match(source, /moveBefore\(referenceLayer\)/);
  assert.match(source, /moveAfter\(referenceLayer\)/);
  assert.match(source, /EXPECTED_HOST_REVISION_REQUIRED/);
  assert.match(source, /HOST_REVISION_CONFLICT/);
  assert.match(source, /LAYER_ORDER_SELF_REFERENCE/);
  assert.match(source, /LAYER_SWITCH_READBACK_MISMATCH/);
  assert.match(source, /app\.beginUndoGroup/);
  assert.match(source, /findMenuCommandId\("Undo"\)/);
  assert.doesNotMatch(source, /\beval\s*\(/);
});

test("CEP installation advertises 1.6 additively and boots the fail-closed v16 loader", async () => {
  const [loader, installer, bridge, runtimeConfig] = await Promise.all([
    readFile(loaderPath, "utf8"), readFile(installerPath, "utf8"), readFile(bridgePath, "utf8"), readFile(runtimeConfigPath, "utf8"),
  ]);
  assert.match(loader, /editflow_host_current_v15\.jsx/);
  assert.match(loader, /editflow_host_m3_layer_controls\.jsx/);
  assert.match(loader, /M3_LAYER_CONTROL_MODULE_LOAD_FAILED/);
  assert.match(loader, /request\.protocolVersion === "1\.6\.0"/);
  assert.match(installer, /"editflow_host_m3_layer_controls\.jsx"/);
  assert.match(installer, /"editflow_host_current_v16\.jsx"/);
  assert.match(installer, /supportedProtocolVersions = @\("1\.6\.0", "1\.5\.0", "1\.4\.0", "1\.3\.0", "1\.2\.0", "1\.1\.0"\)/);
  assert.match(bridge, /KNOWN_PROTOCOLS = \["1\.6\.0", "1\.5\.0", "1\.4\.0", "1\.3\.0", "1\.2\.0", "1\.1\.0"\]/);
  assert.match(bridge, /editflow_host_current_v16\.jsx/);
  assert.match(runtimeConfig, /supportedProtocolVersions: \["1\.6\.0", "1\.5\.0", "1\.4\.0", "1\.3\.0", "1\.2\.0", "1\.1\.0"\]/);
});

test("explicit broker negotiates 1.6 and carries a typed layer-control request", async () => {
  const protocols = ["1.6.0", "1.5.0", "1.4.0", "1.3.0", "1.2.0", "1.1.0"];
  const broker = new LoopbackCepBroker({ port: 0, token, commandTimeoutMs: 2000, commandLeaseMs: 50, supportedProtocolVersions: protocols });
  const port = await broker.start();
  try {
    const registrationResponse = await fetch(`http://127.0.0.1:${port}/v1/register`, {
      method: "POST", headers,
      body: JSON.stringify({ protocolVersion: "1.1.0", supportedProtocolVersions: protocols, extensionId: "com.editflow2.bridge.panel", extensionVersion: "0.1.0-dev.6" }),
    });
    const registration = await registrationResponse.json();
    assert.equal(registrationResponse.status, 200);
    assert.equal(registration.protocolVersion, "1.6.0");

    const request = buildLayerControlRequestV16({
      requestId: "REQ_LAYER_CONTROL_BROKER",
      transactionId: "TX_LAYER_CONTROL_BROKER",
      operationId: "OP_LAYER_CONTROL_BROKER",
      command: "layer.controls.readback",
      expectedHostProjectRevision: null,
      payload: { comp: { stableId: "COMP_MAIN" }, layer: { stableId: "LAYER_HERO" } },
    });
    const dispatched = broker.dispatch(request);
    const leasedResponse = await fetch(`http://127.0.0.1:${port}/v1/next?sessionId=${encodeURIComponent(registration.sessionId)}`, { method: "GET", headers });
    const leased = await leasedResponse.json();
    assert.equal(leasedResponse.status, 200);
    assert.equal(leased.protocolVersion, "1.6.0");
    assert.equal(leased.command, "layer.controls.readback");

    const hostResponse = {
      protocolVersion: "1.6.0", requestId: request.requestId, transactionId: request.transactionId,
      operationId: request.operationId, capabilityId: request.capabilityId, command: request.command,
      outcome: "NO_OP", error: null, affectedObjects: [], readback: { layerControls: { order: { index: 2 } } }, hostProjectRevision: 19,
      diagnostics: { adapterProtocolVersion: "1.6.0", adapterBuild: "0.4.0-dev.6", command: request.command, notes: [] },
    };
    const postResponse = await fetch(`http://127.0.0.1:${port}/v1/response`, { method: "POST", headers, body: JSON.stringify({ sessionId: registration.sessionId, response: hostResponse }) });
    assert.equal(postResponse.status, 200);
    const resolved = await dispatched;
    assert.equal(resolved.protocolVersion, "1.6.0");
    assert.equal(resolved.outcome, "NO_OP");
  } finally {
    await broker.stop();
  }
});
