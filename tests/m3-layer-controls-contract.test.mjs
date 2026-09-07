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
const schemaPath = "spec/ae-layer-controls-request-v1_6.schema.json";

const token = "m3layercontrolsprotocoltoken0123456789abcdef0123456789";
const headers = { "Content-Type": "application/json", "X-EditFlow-Token": token };

test("M3 layer-controls protocol 1.6 owns switches while order stays on accepted 1.1", () => {
  assert.equal(AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16, "1.6.0");
  assert.equal(AE_LAYER_CONTROLS_ADAPTER_BUILD_V16, "0.4.0-dev.6");
  assert.equal(AE_LAYER_CONTROLS_ROUTE_ID_V16, "ae-cep-layer-controls-v1.6");
  assert.deepEqual([...AE_LAYER_CONTROLS_COMMANDS_V16], ["layer.switches.set", "layer.switches_readback"]);
  assert.equal(isAeLayerControlsCommandV16("layer.switches.set"), true);
  assert.equal(isAeLayerControlsCommandV16("layer.reorder"), false);
  assert.equal(capabilityForLayerControlsCommandV16("layer.switches.set"), "ae.layer.switches.set");
  assert.equal(capabilityForLayerControlsCommandV16("layer.switches_readback"), "ae.layer.switches.readback");
  assert.equal(M3_LAYER_CONTROLS_CAPABILITIES_V16.length, 2);
  for (const capability of M3_LAYER_CONTROLS_CAPABILITIES_V16) {
    assert.equal(capability.status, "PARTIAL");
    assert.equal(capability.proofMaturity, "DECLARED");
    assert.equal(capability.routes[0].routeId, AE_LAYER_CONTROLS_ROUTE_ID_V16);
    assert.equal(capability.fallbackPolicy, "FORBID");
    assert.match(capability.description, /layer\.reorder/);
    assert.match(capability.description, /motion blur and frame blending remain reserved/);
  }
});

test("layer-controls request builder binds switch patches to typed capability", () => {
  const request = buildLayerControlsRequestV16({
    requestId: "REQ_LAYER_CONTROLS_BUILD",
    transactionId: "TX_LAYER_CONTROLS_BUILD",
    operationId: "OP_LAYER_CONTROLS_BUILD",
    command: "layer.switches.set",
    expectedHostProjectRevision: 77,
    payload: {
      comp: { stableId: "COMP_LAYER_CONTROLS" },
      layer: { stableId: "LAYER_LAYER_CONTROLS" },
      switches: { enabled: false, solo: true, quality: "DRAFT" },
    },
  });
  assert.equal(request.protocolVersion, "1.6.0");
  assert.equal(request.capabilityId, "ae.layer.switches.set");
  assert.equal(request.expectedHostProjectRevision, 77);
  assert.equal(request.readbackProfile, "M3_LAYER_SWITCHES_STRUCTURAL");
});

test("direct protocol 1.6 CEP transport serializes hostile-looking refs as data", async () => {
  let captured = null;
  const request = buildLayerControlsRequestV16({
    requestId: "REQ_LAYER_CONTROLS_ESCAPE",
    transactionId: "TX_LAYER_CONTROLS_ESCAPE",
    operationId: "OP_LAYER_CONTROLS_ESCAPE",
    command: "layer.switches_readback",
    expectedHostProjectRevision: null,
    payload: { comp: { stableId: "COMP_SWITCHES" }, layer: { stableId: "LAYER_\"); app.quit(); //" } },
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
        readback: { layerSwitches: { switches: { enabled: true }, applicability: { enabled: true } } },
        hostProjectRevision: 77,
        diagnostics: { adapterProtocolVersion: "1.6.0", adapterBuild: "0.4.0-dev.6", command: request.command, durationMs: 1, notes: [] },
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

test("layer-controls host exposes the complete item-8 switch set with guarded atomic lock ordering", async () => {
  const source = await readFile(hostPath, "utf8");
  for (const command of AE_LAYER_CONTROLS_COMMANDS_V16) assert.match(source, new RegExp(`\\"${command.replaceAll(".", "\\.")}\\"`));
  for (const key of [
    "enabled", "solo", "shy", "locked", "quality", "adjustmentLayer", "guideLayer",
    "threeDLayer", "effectsActive", "collapseTransformation", "preserveTransparency",
  ]) assert.match(source, new RegExp(`\\"${key}\\"`));
  assert.match(source, /LAYER_SWITCH_UNSUPPORTED_FOR_TARGET/);
  assert.match(source, /LAYER_LOCKED_REQUIRES_EXPLICIT_UNLOCK/);
  assert.match(source, /EXPECTED_HOST_REVISION_REQUIRED/);
  assert.match(source, /HOST_REVISION_CONFLICT/);
  assert.match(source, /LAYER_SWITCH_READBACK_MISMATCH/);
  assert.match(source, /if \(own\(patch, "locked"\) && patch\.locked === false\)/);
  assert.match(source, /if \(own\(patch, "locked"\) && patch\.locked === true\)/);
  assert.ok(source.indexOf('patch.locked === false') < source.indexOf('patch.locked === true'));
  assert.match(source, /app\.beginUndoGroup/);
  assert.match(source, /app\.executeCommand\(16\)/);
  assert.doesNotMatch(source, /\bmotionBlur\b/);
  assert.doesNotMatch(source, /\bframeBlending\b/);
  assert.doesNotMatch(source, /\blayer\.reorder\b/);
  assert.doesNotMatch(source, /\beval\s*\(/);
});

test("protocol 1.6 schema rejects item-12 motion blur leakage", async () => {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  assert.equal(schema.properties.protocolVersion.const, "1.6.0");
  assert.deepEqual(schema.properties.command.enum, ["layer.switches.set", "layer.switches_readback"]);
  const patch = schema.$defs.switchPatch.properties;
  assert.deepEqual(Object.keys(patch).sort(), [
    "adjustmentLayer", "collapseTransformation", "effectsActive", "enabled", "guideLayer", "locked",
    "preserveTransparency", "quality", "shy", "solo", "threeDLayer",
  ].sort());
  assert.equal(Object.hasOwn(patch, "motionBlur"), false);
  assert.equal(Object.hasOwn(patch, "frameBlending"), false);
});

test("CEP installation advertises 1.6 additively and boots the fail-contained v16 loader", async () => {
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
  assert.match(installer, /\$ExtensionVersion = "0\.1\.0-dev\.6"/);
  assert.match(installer, /"editflow_host_m3_layer_controls\.jsx"/);
  assert.match(installer, /"editflow_host_current_v16\.jsx"/);
  assert.match(installer, /supportedProtocolVersions = @\("1\.6\.0", "1\.5\.0", "1\.4\.0", "1\.3\.0", "1\.2\.0", "1\.1\.0"\)/);
  assert.match(bridge, /KNOWN_PROTOCOLS = \["1\.6\.0", "1\.5\.0", "1\.4\.0", "1\.3\.0", "1\.2\.0", "1\.1\.0"\]/);
  assert.match(bridge, /editflow_host_current_v16\.jsx/);
  assert.match(runtimeConfig, /supportedProtocolVersions: \["1\.6\.0", "1\.5\.0", "1\.4\.0", "1\.3\.0", "1\.2\.0", "1\.1\.0"\]/);
  assert.match(runtimeConfig, /extensionVersion: "0\.1\.0-dev\.6"/);
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
      requestId: "REQ_LAYER_CONTROLS_BROKER",
      transactionId: "TX_LAYER_CONTROLS_BROKER",
      operationId: "OP_LAYER_CONTROLS_BROKER",
      command: "layer.switches_readback",
      expectedHostProjectRevision: null,
      payload: { comp: { stableId: "COMP_SWITCHES" }, layer: { stableId: "LAYER_SWITCHES" } },
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
      readback: { layerSwitches: { switches: { enabled: true }, applicability: { enabled: true } } },
      hostProjectRevision: 1,
      diagnostics: { adapterProtocolVersion: "1.6.0", adapterBuild: "0.4.0-dev.6", command: request.command, durationMs: 1, notes: [] },
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
