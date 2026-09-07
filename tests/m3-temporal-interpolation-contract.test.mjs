import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import {
  AE_KEYFRAME_INTERPOLATION_TYPES_V17,
  AE_TEMPORAL_INTERPOLATION_ADAPTER_BUILD_V17,
  AE_TEMPORAL_INTERPOLATION_COMMANDS_V17,
  AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17,
  AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17,
  capabilityForTemporalInterpolationCommandV17,
  isAeTemporalInterpolationCommandV17,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_7.js";
import {
  CepEvalScriptTemporalInterpolationTransportV17,
  M3_TEMPORAL_INTERPOLATION_CAPABILITIES_V17,
  buildTemporalInterpolationRequestV17,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-temporal-interpolation.js";
import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_temporal_interpolation.jsx";
const loaderPath = "packages/adapters/ae-cep/host/editflow_host_current_v17.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";
const bridgePath = "packages/adapters/ae-cep/extension/client/bridge.js";
const runtimeConfigPath = "packages/adapters/ae-cep/extension/client/runtime-config.js";
const foundationPath = "docs/15_M3_TEMPORAL_INTERPOLATION_FOUNDATION.md";
const token = "m3temporalinterpolationtoken0123456789abcdef0123456789";
const headers = { "Content-Type": "application/json", "X-EditFlow-Token": token };

test("M3 temporal interpolation protocol 1.7 is a fixed item-9 tranche", () => {
  assert.equal(AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17, "1.7.0");
  assert.equal(AE_TEMPORAL_INTERPOLATION_ADAPTER_BUILD_V17, "0.4.0-dev.7");
  assert.equal(AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17, "ae-cep.temporal-interpolation.v1_7");
  assert.deepEqual([...AE_TEMPORAL_INTERPOLATION_COMMANDS_V17], [
    "property.temporal_interpolation.set",
    "property.temporal_interpolation.readback",
  ]);
  assert.deepEqual([...AE_KEYFRAME_INTERPOLATION_TYPES_V17], ["LINEAR", "BEZIER", "HOLD"]);
  assert.equal(isAeTemporalInterpolationCommandV17("property.temporal_interpolation.set"), true);
  assert.equal(isAeTemporalInterpolationCommandV17("property.temporal_ease.set"), false);
  assert.equal(capabilityForTemporalInterpolationCommandV17("property.temporal_interpolation.set"), "ae.property.temporal_interpolation.set");
  assert.equal(capabilityForTemporalInterpolationCommandV17("property.temporal_interpolation.readback"), "ae.property.temporal_interpolation.readback");
});

test("temporal interpolation capabilities remain PARTIAL DECLARED until real-AE evidence", () => {
  assert.equal(M3_TEMPORAL_INTERPOLATION_CAPABILITIES_V17.length, 2);
  for (const capability of M3_TEMPORAL_INTERPOLATION_CAPABILITIES_V17) {
    assert.equal(capability.status, "PARTIAL");
    assert.equal(capability.proofMaturity, "DECLARED");
    assert.equal(capability.routes.length, 1);
    assert.equal(capability.routes[0].routeId, AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17);
    assert.equal(capability.routes[0].available, true);
    assert.equal(capability.fallbackPolicy, "FORBID");
  }
});

test("temporal interpolation request builder binds exact four-field state and stable target", () => {
  const request = buildTemporalInterpolationRequestV17({
    requestId: "REQ_TEMPORAL_BUILD",
    transactionId: "TX_TEMPORAL_BUILD",
    operationId: "OP_TEMPORAL_BUILD",
    command: "property.temporal_interpolation.set",
    expectedHostProjectRevision: 88,
    payload: {
      comp: { stableId: "COMP_TEMPORAL" },
      layer: { stableId: "LAYER_TEMPORAL" },
      propertyPath: ["ADBE Transform Group", "ADBE Opacity"],
      keyIndex: 2,
      interpolation: {
        inType: "BEZIER",
        outType: "BEZIER",
        temporalContinuous: true,
        temporalAutoBezier: false,
      },
    },
  });
  assert.equal(request.protocolVersion, "1.7.0");
  assert.equal(request.capabilityId, "ae.property.temporal_interpolation.set");
  assert.equal(request.expectedHostProjectRevision, 88);
  assert.equal(request.readbackProfile, "M3_TEMPORAL_INTERPOLATION_STRUCTURAL");
});

test("direct protocol 1.7 CEP transport serializes hostile-looking property paths as data", async () => {
  let captured = null;
  const request = buildTemporalInterpolationRequestV17({
    requestId: "REQ_TEMPORAL_ESCAPE",
    transactionId: "TX_TEMPORAL_ESCAPE",
    operationId: "OP_TEMPORAL_ESCAPE",
    command: "property.temporal_interpolation.readback",
    expectedHostProjectRevision: null,
    payload: {
      comp: { stableId: "COMP_TEMPORAL" },
      layer: { stableId: "LAYER_TEMPORAL" },
      propertyPath: ["ADBE Transform Group", "\"); app.quit(); //"],
      keyIndex: 1,
    },
  });
  const bridge = {
    evalScript(script, callback) {
      captured = script;
      callback(JSON.stringify({
        protocolVersion: "1.7.0",
        requestId: request.requestId,
        transactionId: request.transactionId,
        operationId: request.operationId,
        capabilityId: request.capabilityId,
        command: request.command,
        outcome: "NO_OP",
        error: null,
        affectedObjects: [],
        readback: { temporalInterpolation: { keyIndex: 1 } },
        hostProjectRevision: 88,
        diagnostics: { adapterProtocolVersion: "1.7.0", adapterBuild: "0.4.0-dev.7", command: request.command, notes: [] },
      }));
    },
  };
  const response = await new CepEvalScriptTemporalInterpolationTransportV17(bridge).dispatch(request);
  assert.equal(response.outcome, "NO_OP");
  assert.ok(captured.startsWith("EditFlow2_dispatch(\"") && captured.endsWith("\")"));
  assert.equal((captured.match(/EditFlow2_dispatch/g) ?? []).length, 1);
  assert.ok(captured.includes("app.quit"));
  assert.ok(!captured.includes("); app.quit(); //\")"));
});

test("temporal interpolation host is exact, transactional, and excludes item-10/11 controls", async () => {
  const source = await readFile(hostPath, "utf8");
  for (const command of AE_TEMPORAL_INTERPOLATION_COMMANDS_V17) {
    assert.match(source, new RegExp(`\\"${command.replaceAll(".", "\\.")}\\"`));
  }
  for (const method of [
    "isInterpolationTypeValid",
    "keyInInterpolationType",
    "keyOutInterpolationType",
    "keyTemporalContinuous",
    "keyTemporalAutoBezier",
    "setInterpolationTypeAtKey",
    "setTemporalContinuousAtKey",
    "setTemporalAutoBezierAtKey",
  ]) assert.match(source, new RegExp(method));
  assert.match(source, /KeyframeInterpolationType\.LINEAR/);
  assert.match(source, /KeyframeInterpolationType\.BEZIER/);
  assert.match(source, /KeyframeInterpolationType\.HOLD/);
  assert.match(source, /TEMPORAL_BEZIER_FLAG_REQUIRES_BEZIER/);
  assert.match(source, /EXPECTED_HOST_REVISION_REQUIRED/);
  assert.match(source, /HOST_REVISION_CONFLICT/);
  assert.match(source, /TEMPORAL_INTERPOLATION_READBACK_MISMATCH/);
  assert.match(source, /app\.beginUndoGroup/);
  assert.match(source, /app\.executeCommand\(16\)/);

  assert.doesNotMatch(source, /setTemporalEaseAtKey/);
  assert.doesNotMatch(source, /keyInTemporalEase/);
  assert.doesNotMatch(source, /keyOutTemporalEase/);
  assert.doesNotMatch(source, /KeyframeEase/);
  assert.doesNotMatch(source, /setSpatialTangentsAtKey/);
  assert.doesNotMatch(source, /setSpatialAutoBezierAtKey/);
  assert.doesNotMatch(source, /setSpatialContinuousAtKey/);
  assert.doesNotMatch(source, /setRovingAtKey/);
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.doesNotThrow(() => new vm.Script(source, { filename: hostPath }));
});

test("protocol 1.7 loader fails closed without breaking accepted 1.1-1.6 dispatch", async () => {
  const source = await readFile(loaderPath, "utf8");
  assert.match(source, /editflow_host_current_v16\.jsx/);
  assert.match(source, /editflow_host_m3_temporal_interpolation\.jsx/);
  assert.match(source, /M3_TEMPORAL_INTERPOLATION_MODULE_LOAD_FAILED/);
  assert.match(source, /request\.protocolVersion === "1\.7\.0"/);
  assert.match(source, /accepted protocol 1\.1-1\.6 dispatch remains available/);
  assert.match(source, /EditFlow2_HOST_PROTOCOL_17 = true/);
  assert.doesNotThrow(() => new vm.Script(source, { filename: loaderPath }));
});

test("CEP installation and client advertise 1.7 additively and bootstrap v17", async () => {
  const [installer, bridge, runtimeConfig] = await Promise.all([
    readFile(installerPath, "utf8"),
    readFile(bridgePath, "utf8"),
    readFile(runtimeConfigPath, "utf8"),
  ]);
  const expectedProtocols = '["1.7.0", "1.6.0", "1.5.0", "1.4.0", "1.3.0", "1.2.0", "1.1.0"]';
  assert.match(installer, /editflow_host_m3_temporal_interpolation\.jsx/);
  assert.match(installer, /editflow_host_current_v17\.jsx/);
  assert.match(installer, /0\.1\.0-dev\.7/);
  assert.match(installer, /supportedProtocolVersions = @\("1\.7\.0", "1\.6\.0", "1\.5\.0", "1\.4\.0", "1\.3\.0", "1\.2\.0", "1\.1\.0"\)/);
  assert.ok(bridge.includes(`KNOWN_PROTOCOLS = ${expectedProtocols}`));
  assert.match(bridge, /editflow_host_current_v17\.jsx/);
  assert.match(bridge, /EditFlow2_HOST_PROTOCOL_17/);
  assert.ok(runtimeConfig.includes(`supportedProtocolVersions: ${expectedProtocols}`));
  assert.match(runtimeConfig, /0\.1\.0-dev\.7/);
});

test("explicit broker negotiates 1.7 and carries typed temporal interpolation readback", async () => {
  const protocols = ["1.7.0", "1.6.0", "1.5.0", "1.4.0", "1.3.0", "1.2.0", "1.1.0"];
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
        extensionVersion: "0.1.0-dev.7",
      }),
    });
    const registration = await registrationResponse.json();
    assert.equal(registrationResponse.status, 200);
    assert.equal(registration.protocolVersion, "1.7.0");

    const request = buildTemporalInterpolationRequestV17({
      requestId: "REQ_TEMPORAL_BROKER",
      transactionId: "TX_TEMPORAL_BROKER",
      operationId: "OP_TEMPORAL_BROKER",
      command: "property.temporal_interpolation.readback",
      expectedHostProjectRevision: null,
      payload: {
        comp: { stableId: "COMP_TEMPORAL" },
        layer: { stableId: "LAYER_TEMPORAL" },
        propertyPath: ["ADBE Transform Group", "ADBE Opacity"],
        keyIndex: 1,
      },
    });
    const dispatched = broker.dispatch(request);
    const nextResponse = await fetch(`http://127.0.0.1:${port}/v1/next?sessionId=${encodeURIComponent(registration.sessionId)}`, { headers });
    assert.equal(nextResponse.status, 200);
    const leased = await nextResponse.json();
    assert.equal(leased.protocolVersion, "1.7.0");
    assert.equal(leased.command, "property.temporal_interpolation.readback");

    const response = {
      protocolVersion: "1.7.0",
      requestId: request.requestId,
      transactionId: request.transactionId,
      operationId: request.operationId,
      capabilityId: request.capabilityId,
      command: request.command,
      outcome: "NO_OP",
      error: null,
      affectedObjects: [],
      readback: { temporalInterpolation: { keyIndex: 1 } },
      hostProjectRevision: 1,
      diagnostics: { adapterProtocolVersion: "1.7.0", adapterBuild: "0.4.0-dev.7", command: request.command, notes: [] },
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

test("temporal interpolation foundation explicitly preserves later Graph Editor and spatial tranches", async () => {
  const source = await readFile(foundationPath, "utf8");
  assert.match(source, /Milestone 3 item 9/);
  assert.match(source, /item 10: Graph Editor speed\/value controls/);
  assert.match(source, /item 11: spatial Bezier paths\/tangents/);
  assert.match(source, /setTemporalEaseAtKey/);
  assert.match(source, /KeyframeEase/);
  assert.match(source, /PARTIAL \/ DECLARED/);
});
