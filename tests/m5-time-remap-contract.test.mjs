import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import {
  sha256RepositoryTextHex,
} from "../.tmp/runtime/packages/fingerprints/src/index.js";

import {
  AE_TIME_REMAP_ADAPTER_BUILD_V27,
  AE_TIME_REMAP_COMMANDS_V27,
  AE_TIME_REMAP_PROTOCOL_VERSION_V27,
  AE_TIME_REMAP_ROUTE_ID_V27,
  capabilityForTimeRemapCommandV27,
  isAeTimeRemapCommandV27,
  isAeTimeRemapMutationCommandV27,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v2_7.js";
import {
  CepEvalScriptTimeRemapTransportV27,
  M5_TIME_REMAP_CAPABILITIES_V27,
  buildTimeRemapRequestV27,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-time-remap.js";
import {
  M5_TIME_REMAP_V27_ACCEPTANCE_RESULT,
  M5_TIME_REMAP_V27_ACCEPTANCE_RESULT_SHA256,
  M5_TIME_REMAP_V27_ACCEPTED_AE_VERSION,
  M5_TIME_REMAP_V27_ACCEPTED_SOURCE_COMMIT,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-time-remap-proof-maturity.js";
import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";

const brokerToken = "m5timeremapwarmbrokertoken0123456789abcdef0123456789";
const brokerHeaders = { "Content-Type": "application/json", "X-EditFlow-Token": brokerToken };
const warmProtocols = ["2.7.0", "2.6.0", "2.5.0", "2.4.0", "2.3.0", "2.2.0", "2.1.0", "2.0.0", "1.9.0", "1.8.0", "1.7.0", "1.6.0", "1.5.0", "1.4.0", "1.3.0", "1.2.0", "1.1.0"];

test("protocol 2.7 exposes only native Time Remap enable and readback", () => {
  assert.equal(AE_TIME_REMAP_PROTOCOL_VERSION_V27, "2.7.0");
  assert.equal(AE_TIME_REMAP_ADAPTER_BUILD_V27, "0.7.0-dev.1");
  assert.equal(AE_TIME_REMAP_ROUTE_ID_V27, "ae-cep.time-remap.v2_7");
  assert.deepEqual([...AE_TIME_REMAP_COMMANDS_V27], [
    "layer.time_remap.enable",
    "layer.time_remap.readback",
  ]);
  assert.equal(isAeTimeRemapCommandV27("layer.time_remap.enable"), true);
  assert.equal(isAeTimeRemapCommandV27("layer.time_remap.disable"), false);
  assert.equal(isAeTimeRemapMutationCommandV27("layer.time_remap.enable"), true);
  assert.equal(isAeTimeRemapMutationCommandV27("layer.time_remap.readback"), false);
  assert.equal(
    capabilityForTimeRemapCommandV27("layer.time_remap.enable"),
    "ae.layer.time_remap.enable",
  );
  assert.equal(
    capabilityForTimeRemapCommandV27("layer.time_remap.readback"),
    "ae.layer.time_remap.readback",
  );
});

test("Time Remap capabilities are structural-only after retained real-AE proof", () => {
  assert.equal(M5_TIME_REMAP_CAPABILITIES_V27.length, 2);
  const byId = new Map(M5_TIME_REMAP_CAPABILITIES_V27.map((item) => [String(item.id), item]));
  const enable = byId.get("ae.layer.time_remap.enable");
  const readback = byId.get("ae.layer.time_remap.readback");
  assert.ok(enable);
  assert.ok(readback);
  assert.equal(enable.status, "PARTIAL");
  assert.equal(enable.proofMaturity, "STRUCTURAL");
  assert.equal(enable.riskClass, "R2_STRUCTURAL");
  assert.equal(enable.rollbackStrategy, "AE_TRANSACTION_UNDO_PLUS_EXACT_BASELINE_READBACK");
  assert.equal(readback.status, "PARTIAL");
  assert.equal(readback.proofMaturity, "STRUCTURAL");
  assert.equal(readback.riskClass, "R0_READ_ONLY");
  assert.equal(enable.routes[0].routeId, AE_TIME_REMAP_ROUTE_ID_V27);
  assert.equal(enable.fallbackPolicy, "FORBID");
});

test("request builder revision-gates enable but keeps readback read-only", () => {
  const payload = { comp: { stableId: "COMP" }, layer: { stableId: "LAYER" } };
  const enable = buildTimeRemapRequestV27({
    requestId: "REQ_E",
    transactionId: "TX_E",
    operationId: "OP_E",
    command: "layer.time_remap.enable",
    expectedHostProjectRevision: 42,
    payload,
  });
  assert.equal(enable.protocolVersion, "2.7.0");
  assert.equal(enable.capabilityId, "ae.layer.time_remap.enable");
  assert.equal(enable.expectedHostProjectRevision, 42);
  assert.equal(enable.readbackProfile, "M5_TIME_REMAP_STRUCTURAL");

  const readback = buildTimeRemapRequestV27({
    requestId: "REQ_R",
    transactionId: "TX_R",
    operationId: "OP_R",
    command: "layer.time_remap.readback",
    expectedHostProjectRevision: 999,
    payload,
  });
  assert.equal(readback.capabilityId, "ae.layer.time_remap.readback");
  assert.equal(readback.expectedHostProjectRevision, null);
});

test("generic loopback broker negotiates 2.7 and transports typed Time Remap traffic", async () => {
  const broker = new LoopbackCepBroker({
    port: 0,
    token: brokerToken,
    commandTimeoutMs: 2000,
    commandLeaseMs: 50,
    supportedProtocolVersions: warmProtocols,
  });
  const port = await broker.start();
  try {
    assert.deepEqual([...broker.options.supportedProtocolVersions], warmProtocols);
    const registrationResponse = await fetch(`http://127.0.0.1:${port}/v1/register`, {
      method: "POST",
      headers: brokerHeaders,
      body: JSON.stringify({
        protocolVersion: "1.1.0",
        supportedProtocolVersions: warmProtocols,
        extensionId: "com.editflow2.bridge.panel",
        extensionVersion: "0.1.0-dev.12",
      }),
    });
    const registration = await registrationResponse.json();
    assert.equal(registrationResponse.status, 200);
    assert.equal(registration.protocolVersion, "2.7.0");

    const request = buildTimeRemapRequestV27({
      requestId: "REQ_WARM_V27",
      transactionId: "TX_WARM_V27",
      operationId: "OP_WARM_V27",
      command: "layer.time_remap.readback",
      payload: { comp: { stableId: "COMP" }, layer: { stableId: "LAYER" } },
    });
    const dispatched = broker.dispatch(request);
    const nextResponse = await fetch(`http://127.0.0.1:${port}/v1/next?sessionId=${encodeURIComponent(registration.sessionId)}`, {
      headers: brokerHeaders,
    });
    const leased = await nextResponse.json();
    assert.equal(nextResponse.status, 200);
    assert.equal(leased.protocolVersion, "2.7.0");
    assert.equal(leased.command, "layer.time_remap.readback");

    const response = {
      protocolVersion: "2.7.0",
      requestId: request.requestId,
      transactionId: request.transactionId,
      operationId: request.operationId,
      capabilityId: request.capabilityId,
      command: request.command,
      outcome: "NO_OP",
      error: null,
      affectedObjects: [],
      readback: {
        layer: { stableId: "LAYER", hostId: 2, name: "Clip", index: 1 },
        canSetTimeRemapEnabled: true,
        timeRemapEnabled: true,
        propertyAvailable: true,
        propertyMatchName: "ADBE Time Remapping",
        numKeys: 2,
        keys: [{ index: 1, time: 0, value: 0 }, { index: 2, time: 1, value: 1 }],
      },
      hostProjectRevision: 7,
      diagnostics: {
        adapterProtocolVersion: "2.7.0",
        adapterBuild: "0.7.0-dev.1",
        command: request.command,
        notes: [],
      },
    };
    const accepted = await fetch(`http://127.0.0.1:${port}/v1/response`, {
      method: "POST",
      headers: brokerHeaders,
      body: JSON.stringify({ sessionId: registration.sessionId, response }),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await dispatched, response);
  } finally {
    await broker.stop();
  }
});

test("standard CEP installer carries the retained additive host chain through 2.7", async () => {
  const source = await readFile("scripts/windows/install-editflow-cep.ps1", "utf8");
  for (const file of [
    "editflow_host_m4_point_tracking.jsx",
    "editflow_host_m4_face_tracking.jsx",
    "editflow_host_m4_stabilization.jsx",
    "editflow_host_m4_repair_resume.jsx",
    "editflow_host_m4_media_sequence.jsx",
    "editflow_host_m5_roto_brush.jsx",
    "editflow_host_m5_time_remap.jsx",
    "editflow_host_current_v21.jsx",
    "editflow_host_current_v22.jsx",
    "editflow_host_current_v23.jsx",
    "editflow_host_current_v24.jsx",
    "editflow_host_current_v25.jsx",
    "editflow_host_current_v26.jsx",
    "editflow_host_current_v27.jsx",
  ]) assert.ok(source.includes(`"${file}"`), `installer missing ${file}`);

  assert.match(source, /\$ExtensionVersion = "0\.1\.0-dev\.12"/);
  assert.match(source, /\$KnownV27 = 'var KNOWN_PROTOCOLS = \["2\.7\.0","2\.6\.0","2\.5\.0"/);
  assert.match(source, /Replace\('editflow_host_current_v18\.jsx', 'editflow_host_current_v27\.jsx'\)/);
  assert.match(source, /Replace\('EditFlow2_HOST_PROTOCOL_18', 'EditFlow2_HOST_PROTOCOL_27'\)/);
  assert.match(source, /supportedProtocolVersions = @\("2\.7\.0", "2\.6\.0", "2\.5\.0", "2\.4\.0", "2\.3\.0", "2\.2\.0", "2\.1\.0", "2\.0\.0"/);
  assert.match(source, /Panel protocols advertised: 2\.7\.0, 2\.6\.0, 2\.5\.0, 2\.4\.0, 2\.3\.0, 2\.2\.0, 2\.1\.0, 2\.0\.0/);
  assert.match(source, /Reopen the EditFlow CEP panel after updating installed extension files/);
  assert.match(source, /Restart After Effects only if the panel cannot reload safely/);
  assert.doesNotMatch(source, /Restart After Effects after updating installed extension files/);
});

test("Time Remap transport serializes hostile stable IDs as data", async () => {
  let captured = "";
  const request = buildTimeRemapRequestV27({
    requestId: "REQ_ESCAPE",
    transactionId: "TX_ESCAPE",
    operationId: "OP_ESCAPE",
    command: "layer.time_remap.readback",
    payload: {
      comp: { stableId: "COMP\"); app.quit(); //" },
      layer: { stableId: "LAYER" },
    },
  });
  const bridge = {
    evalScript(script, callback) {
      captured = script;
      callback(JSON.stringify({
        protocolVersion: "2.7.0",
        requestId: request.requestId,
        transactionId: request.transactionId,
        operationId: request.operationId,
        capabilityId: request.capabilityId,
        command: request.command,
        outcome: "NO_OP",
        error: null,
        affectedObjects: [],
        readback: {
          layer: { stableId: "LAYER", hostId: 2, name: "Clip", index: 1 },
          canSetTimeRemapEnabled: true,
          timeRemapEnabled: false,
          propertyAvailable: false,
          propertyMatchName: null,
          numKeys: 0,
          keys: [],
        },
        hostProjectRevision: 7,
        diagnostics: {
          adapterProtocolVersion: "2.7.0",
          adapterBuild: "0.7.0-dev.1",
          command: request.command,
          notes: [],
        },
      }));
    },
  };
  const response = await new CepEvalScriptTimeRemapTransportV27(bridge).dispatch(request);
  assert.equal(response.outcome, "NO_OP");
  assert.equal((captured.match(/EditFlow2_dispatch/g) ?? []).length, 1);
  assert.ok(captured.startsWith("EditFlow2_dispatch(\"") && captured.endsWith("\")"));
  assert.ok(!captured.includes("); app.quit(); //\")"));
});

test("host uses native Time Remap API with exact structural readback and undo rollback", async () => {
  const source = await readFile(
    "packages/adapters/ae-cep/host/editflow_host_m5_time_remap.jsx",
    "utf8",
  );
  for (const token of [
    ".canSetTimeRemapEnabled",
    ".timeRemapEnabled = true",
    'layer.property("ADBE Time Remapping")',
    ".keyTime(",
    ".keyValue(",
    "EXPECTED_HOST_REVISION_REQUIRED",
    "HOST_REVISION_CONFLICT",
    "TIME_REMAP_ENABLE_READBACK_MISMATCH",
    "M5_TIME_REMAP_P4_FAILURE_INJECTION",
    "M5_TIME_REMAP_P4_INDUCED_FAILURE",
    "TIME_REMAP_ROLLBACK_READBACK_MISMATCH",
    "app.beginUndoGroup",
    "app.executeCommand(16)",
  ]) {
    assert.ok(source.includes(token), `missing host behavior ${token}`);
  }
  assert.doesNotMatch(source, /timeRemapEnabled\s*=\s*false/);
  assert.doesNotMatch(source, /SetCursorPos|mouse_event|SendKeys|system\.callSystem/);
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.doesNotThrow(() => new vm.Script(source, {
    filename: "editflow_host_m5_time_remap.jsx",
  }));
});

test("v27 loader is additive over accepted v26 and fails closed only for 2.7", async () => {
  const source = await readFile(
    "packages/adapters/ae-cep/host/editflow_host_current_v27.jsx",
    "utf8",
  );
  assert.match(source, /editflow_host_current_v26\.jsx/);
  assert.match(source, /editflow_host_m5_time_remap\.jsx/);
  assert.match(source, /M5_TIME_REMAP_MODULE_LOAD_FAILED/);
  assert.match(source, /request\.protocolVersion === "2\.7\.0"/);
  assert.match(source, /EditFlow2_HOST_PROTOCOL_27 = true/);
  assert.doesNotThrow(() => new vm.Script(source, {
    filename: "editflow_host_current_v27.jsx",
  }));
});

test("Time Remap live proof is warm-process-safe and disposable-project-state only", async () => {
  const runner = await readFile(
    "scripts/windows/run-m5-time-remap-v27-live.ps1",
    "utf8",
  );
  const proof = await readFile(
    "scripts/windows/m5-time-remap-v27-live-proof.jsx",
    "utf8",
  );
  assert.match(runner, /Start-Process -FilePath \$AfterFxPath -ArgumentList/);
  assert.match(runner, /Warm proof requires an already-running After Effects process/);
  assert.match(runner, /beforeAfterFxPids/);
  assert.match(runner, /afterAfterFxPids/);
  assert.doesNotMatch(runner, /Stop-Process.*AfterFX|taskkill/i);
  assert.match(proof, /editflow_host_current_v27\.jsx/);
  assert.match(proof, /app\.project\.items\.addComp/);
  assert.match(proof, /M5_TIME_REMAP_P4_FAILURE_INJECTION/);
  assert.match(proof, /solidSource = solidLayer\.source/);
  assert.match(proof, /solidSource\.remove\(\)/);
  assert.match(proof, /itemCountRestored/);
  assert.doesNotMatch(proof, /app\.project\.save|app\.project\.close|app\.quit\s*\(/);
});

test("retained Time Remap proof authority is source- and digest-bound", async () => {
  const resultText = await readFile(M5_TIME_REMAP_V27_ACCEPTANCE_RESULT, "utf8");
  const digest = sha256RepositoryTextHex(resultText);
  assert.equal(digest, M5_TIME_REMAP_V27_ACCEPTANCE_RESULT_SHA256);
  assert.equal(
    sha256RepositoryTextHex(
      resultText.replace(/\r\n|\r|\n/g, "\r\n"),
    ),
    M5_TIME_REMAP_V27_ACCEPTANCE_RESULT_SHA256,
  );
  assert.equal(
    M5_TIME_REMAP_V27_ACCEPTED_SOURCE_COMMIT,
    "e6bfa2b5e540767d60a2b13e883b2acbef374cab",
  );
  assert.equal(M5_TIME_REMAP_V27_ACCEPTED_AE_VERSION, "25.6.6");

  const authority = JSON.parse(await readFile(
    "proofs/diagnostics/m5-time-remap-v27-live-acceptance.json",
    "utf8",
  ));
  assert.equal(authority.status, "PASS");
  assert.equal(authority.promotionMaturity, "STRUCTURAL");
  assert.equal(authority.sourceCommit, M5_TIME_REMAP_V27_ACCEPTED_SOURCE_COMMIT);
  assert.equal(
    authority.authoritativeEvidence.resultSha256,
    M5_TIME_REMAP_V27_ACCEPTANCE_RESULT_SHA256,
  );
  assert.equal(authority.checks.unsupportedRejectedWithoutMutation, true);
  assert.equal(authority.checks.rollbackRestoredExact, true);
  assert.equal(authority.checks.itemCountRestored, true);

  const runtimeSource = await readFile(
    "apps/desktop-host/src/ae-runtime-capabilities.ts",
    "utf8",
  );
  assert.doesNotMatch(runtimeSource, /M5_TIME_REMAP_CAPABILITIES_V27/);
});
