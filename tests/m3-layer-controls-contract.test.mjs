import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AE_LAYER_CONTROLS_ADAPTER_BUILD_V16,
  AE_LAYER_CONTROLS_COMMANDS_V16,
  AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16,
  AE_LAYER_CONTROLS_ROUTE_ID_V16,
  AE_LAYER_QUALITY_V16,
  AE_LAYER_SAMPLING_QUALITY_V16,
  capabilityForLayerControlsCommandV16,
  isAeLayerControlsCommandV16,
  isAeLayerQualityV16,
  isAeLayerSamplingQualityV16,
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

test("M3 layer-controls protocol 1.6 exposes fixed typed layer and comp control commands", () => {
  assert.equal(AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16, "1.6.0");
  assert.equal(AE_LAYER_CONTROLS_ADAPTER_BUILD_V16, "0.4.0-dev.6");
  assert.equal(AE_LAYER_CONTROLS_ROUTE_ID_V16, "ae-cep.layer-controls.v1_6");
  assert.deepEqual([...AE_LAYER_CONTROLS_COMMANDS_V16], [
    "layer.controls.set",
    "layer.controls.readback",
    "comp.layer_controls.set",
    "comp.layer_controls.readback",
  ]);
  assert.deepEqual([...AE_LAYER_QUALITY_V16], ["BEST", "DRAFT", "WIREFRAME"]);
  assert.deepEqual([...AE_LAYER_SAMPLING_QUALITY_V16], ["BILINEAR", "BICUBIC"]);
  assert.equal(isAeLayerControlsCommandV16("layer.controls.set"), true);
  assert.equal(isAeLayerControlsCommandV16("layer.controls.frame_blending"), false);
  assert.equal(isAeLayerQualityV16("WIREFRAME"), true);
  assert.equal(isAeLayerQualityV16("ULTRA"), false);
  assert.equal(isAeLayerSamplingQualityV16("BICUBIC"), true);
  assert.equal(capabilityForLayerControlsCommandV16("layer.controls.set"), "ae.layer.controls.set");
  assert.equal(capabilityForLayerControlsCommandV16("layer.controls.readback"), "ae.layer.controls.readback");
  assert.equal(capabilityForLayerControlsCommandV16("comp.layer_controls.set"), "ae.comp.layer_controls.set");
  assert.equal(capabilityForLayerControlsCommandV16("comp.layer_controls.readback"), "ae.comp.layer_controls.readback");
});

test("unproven protocol 1.6 capabilities remain PARTIAL and DECLARED until real-AE evidence", () => {
  assert.equal(M3_LAYER_CONTROLS_CAPABILITIES_V16.length, AE_LAYER_CONTROLS_COMMANDS_V16.length);
  for (const capability of M3_LAYER_CONTROLS_CAPABILITIES_V16) {
    assert.equal(capability.status, "PARTIAL");
    assert.equal(capability.proofMaturity, "DECLARED");
    assert.equal(capability.routes[0].routeId, AE_LAYER_CONTROLS_ROUTE_ID_V16);
    assert.equal(capability.routes[0].available, true);
    assert.equal(capability.fallbackPolicy, "FORBID");
  }
});

test("layer-controls request builder binds exact command capability and host revision", () => {
  const request = buildLayerControlsRequestV16({
    requestId: "REQ_CONTROLS_BUILD",
    transactionId: "TX_CONTROLS_BUILD",
    operationId: "OP_CONTROLS_BUILD",
    command: "layer.controls.set",
    expectedHostProjectRevision: 77,
    payload: {
      comp: { stableId: "COMP_CONTROLS" },
      layer: { stableId: "LAYER_CONTROLS" },
      controls: { shy: true, quality: "BEST" },
    },
  });
  assert.equal(request.protocolVersion, "1.6.0");
  assert.equal(request.capabilityId, "ae.layer.controls.set");
  assert.equal(request.expectedHostProjectRevision, 77);
  assert.equal(request.readbackProfile, "M3_LAYER_CONTROLS_STRUCTURAL");
});

test("direct protocol 1.6 CEP transport serializes hostile-looking stable IDs as data", async () => {
  let captured = null;
  const request = buildLayerControlsRequestV16({
    requestId: "REQ_CONTROLS_ESCAPE",
    transactionId: "TX_CONTROLS_ESCAPE",
    operationId: "OP_CONTROLS_ESCAPE",
    command: "layer.controls.readback",
    expectedHostProjectRevision: null,
    payload: { comp: { stableId: "COMP_CONTROLS" }, layer: { stableId: "LAYER_\"); app.quit(); //" } },
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
        readback: { layerControls: { controls: { enabled: true } } },
        hostProjectRevision: 1,
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

test("layer-controls host is fail-closed, legality-aware, lock-safe, exact-readback, and undo-backed", async () => {
  const source = await readFile(hostPath, "utf8");
  for (const command of AE_LAYER_CONTROLS_COMMANDS_V16) assert.match(source, new RegExp(`\\"${command.replaceAll(".", "\\.")}\\"`));
  for (const property of [
    "enabled", "solo", "shy", "locked", "audioEnabled", "adjustmentLayer", "collapseTransformation",
    "effectsActive", "guideLayer", "preserveTransparency", "quality", "samplingQuality", "threeDLayer",
  ]) assert.match(source, new RegExp(property));
  assert.match(source, /canSetEnabled/);
  assert.match(source, /hasAudio/);
  assert.match(source, /canSetCollapseTransformation/);
  assert.match(source, /LayerQuality\.BEST/);
  assert.match(source, /LayerSamplingQuality\.BICUBIC/);
  assert.match(source, /comp\.hideShyLayers/);
  assert.match(source, /LAYER_LOCKED/);
  assert.match(source, /layer\.locked = false/);
  assert.match(source, /if \(own\(controls, "locked"\)\) layer\.locked = controls\.locked/);
  assert.match(source, /LAYER_CONTROLS_READBACK_MISMATCH/);
  assert.match(source, /expectedHostProjectRevision/);
  assert.match(source, /HOST_REVISION_CONFLICT/);
  assert.match(source, /app\.beginUndoGroup/);
  assert.match(source, /app\.executeCommand\(16\)/);
  assert.doesNotMatch(source, /frameBlending|motionBlur/,
    "protocol 1.6 host must not absorb frame blending or motion blur from roadmap item 12");
  assert.doesNotMatch(source, /moveBefore|moveAfter|moveToBeginning|moveToEnd/,
    "protocol 1.6 must compose with the accepted layer-order route rather than silently reordering layers");
  assert.doesNotMatch(source, /\beval\s*\(/);
});

test("protocol 1.6 installs additively, boots v16, and retains protocols 1.1-1.5", async () => {
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

test("explicit broker negotiates protocol 1.6 and carries a typed readback request", async () => {
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
      requestId: "REQ_CONTROLS_BROKER",
      transactionId: "TX_CONTROLS_BROKER",
      operationId: "OP_CONTROLS_BROKER",
      command: "comp.layer_controls.readback",
      expectedHostProjectRevision: null,
      payload: { comp: { stableId: "COMP_CONTROLS" } },
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
      readback: { compLayerControls: { hideShyLayers: false } },
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
