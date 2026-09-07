import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AE_NULL_RIG_ADAPTER_BUILD_V15,
  AE_NULL_RIG_COMMANDS_V15,
  AE_NULL_RIG_PROTOCOL_VERSION_V15,
  AE_NULL_RIG_ROUTE_ID_V15,
  capabilityForNullRigCommandV15,
  isAeNullRigCommandV15,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_5.js";
import {
  M3_NULL_RIG_P1_P2_ACCEPTED_SOURCE_COMMIT,
  M3_NULL_RIG_P1_P2_ACCEPTANCE_CONTROL_COMMIT,
  M3_NULL_RIG_P1_P2_ACCEPTANCE_RUN,
  M3_NULL_RIG_P1_P2_ACCEPTANCE_RUN_ATTEMPT,
  M3_NULL_RIG_P1_P2_ACCEPTANCE_JOB,
  M3_NULL_RIG_P1_P2_ACCEPTANCE_ARTIFACT,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-null-rig-proof-maturity.js";
import {
  CepEvalScriptNullRigTransportV15,
  M3_NULL_RIG_CAPABILITIES_V15,
  buildNullRigRequestV15,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-null-rig.js";
import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_null_rigs.jsx";
const loaderPath = "packages/adapters/ae-cep/host/editflow_host_current_v15.jsx";
const currentLoaderPath = "packages/adapters/ae-cep/host/editflow_host_current_v16.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";
const bridgePath = "packages/adapters/ae-cep/extension/client/bridge.js";
const runtimeConfigPath = "packages/adapters/ae-cep/extension/client/runtime-config.js";

const token = "m3nullrigprotocoltoken0123456789abcdef0123456789";
const headers = { "Content-Type": "application/json", "X-EditFlow-Token": token };

test("M3 null-rig protocol 1.5 is a fixed managed-null tranche", () => {
  assert.equal(AE_NULL_RIG_PROTOCOL_VERSION_V15, "1.5.0");
  assert.equal(AE_NULL_RIG_ADAPTER_BUILD_V15, "0.4.0-dev.5");
  assert.equal(AE_NULL_RIG_ROUTE_ID_V15, "ae-cep.null-rig.v1_5");
  assert.deepEqual([...AE_NULL_RIG_COMMANDS_V15], ["rig.null.create", "rig.null.remove", "rig.null.readback"]);
  assert.equal(isAeNullRigCommandV15("rig.null.create"), true);
  assert.equal(isAeNullRigCommandV15("rig.execute_script"), false);
  assert.equal(capabilityForNullRigCommandV15("rig.null.create"), "ae.rig.null.create");
  assert.equal(capabilityForNullRigCommandV15("rig.null.remove"), "ae.rig.null.remove");
  assert.equal(capabilityForNullRigCommandV15("rig.null.readback"), "ae.rig.null.readback");
});

test("accepted real-AE null-rig P1/P2 evidence promotes only structural maturity", () => {
  assert.equal(M3_NULL_RIG_P1_P2_ACCEPTED_SOURCE_COMMIT, "955e24401ee37febf998d8ec4c544e345aebab6d");
  assert.equal(M3_NULL_RIG_P1_P2_ACCEPTANCE_CONTROL_COMMIT, "9db379f53812abacc3771e3206e279dd5bca5b5f");
  assert.equal(M3_NULL_RIG_P1_P2_ACCEPTANCE_RUN, 34139625065);
  assert.equal(M3_NULL_RIG_P1_P2_ACCEPTANCE_RUN_ATTEMPT, 1);
  assert.equal(M3_NULL_RIG_P1_P2_ACCEPTANCE_JOB, 101798432327);
  assert.equal(M3_NULL_RIG_P1_P2_ACCEPTANCE_ARTIFACT, 10025391737);
  assert.equal(M3_NULL_RIG_CAPABILITIES_V15.length, AE_NULL_RIG_COMMANDS_V15.length);
  for (const capability of M3_NULL_RIG_CAPABILITIES_V15) {
    assert.equal(capability.status, "PARTIAL");
    assert.equal(capability.proofMaturity, "STRUCTURAL");
    assert.equal(capability.routes.length, 1);
    assert.equal(capability.routes[0].routeId, AE_NULL_RIG_ROUTE_ID_V15);
    assert.equal(capability.routes[0].available, true);
    assert.equal(capability.fallbackPolicy, "FORBID");
  }
});

test("null-rig request builder binds caller-owned stable identity to typed create capability", () => {
  const request = buildNullRigRequestV15({
    requestId: "REQ_NULL_BUILD",
    transactionId: "TX_NULL_BUILD",
    operationId: "OP_NULL_BUILD",
    command: "rig.null.create",
    expectedHostProjectRevision: 61,
    payload: { comp: { stableId: "COMP_NULL" }, rig: { stableId: "RIG_MAIN", name: "Main Control" } },
  });
  assert.equal(request.protocolVersion, "1.5.0");
  assert.equal(request.capabilityId, "ae.rig.null.create");
  assert.equal(request.expectedHostProjectRevision, 61);
  assert.equal(request.readbackProfile, "M3_NULL_RIG_STRUCTURAL");
});

test("direct protocol 1.5 CEP transport serializes hostile-looking rig refs as data", async () => {
  let captured = null;
  const request = buildNullRigRequestV15({
    requestId: "REQ_NULL_ESCAPE",
    transactionId: "TX_NULL_ESCAPE",
    operationId: "OP_NULL_ESCAPE",
    command: "rig.null.readback",
    expectedHostProjectRevision: null,
    payload: { comp: { stableId: "COMP_NULL" }, rig: { stableId: "RIG_\"); app.quit(); //" } },
  });
  const bridge = {
    evalScript(script, callback) {
      captured = script;
      callback(JSON.stringify({
        protocolVersion: "1.5.0",
        requestId: request.requestId,
        transactionId: request.transactionId,
        operationId: request.operationId,
        capabilityId: request.capabilityId,
        command: request.command,
        outcome: "NO_OP",
        error: null,
        affectedObjects: [],
        readback: { nullRig: { isNull: true, children: [] } },
        hostProjectRevision: 61,
        diagnostics: { adapterProtocolVersion: "1.5.0", adapterBuild: "0.4.0-dev.5", command: request.command, notes: [] },
      }));
    },
  };
  const response = await new CepEvalScriptNullRigTransportV15(bridge).dispatch(request);
  assert.equal(response.outcome, "NO_OP");
  assert.ok(captured.startsWith("EditFlow2_dispatch(\"") && captured.endsWith("\")"));
  assert.equal((captured.match(/EditFlow2_dispatch/g) ?? []).length, 1);
  assert.ok(captured.includes("app.quit"));
  assert.ok(!captured.includes("); app.quit(); //\")"));
});

test("null-rig host encodes identity, topology readback, child-protected deletion, stale-state checks, and undo recovery", async () => {
  const source = await readFile(hostPath, "utf8");
  for (const command of AE_NULL_RIG_COMMANDS_V15) assert.match(source, new RegExp(`\\"${command.replaceAll(".", "\\.")}\\"`));
  assert.match(source, /layers\.addNull/);
  assert.match(source, /nullLayer === true/);
  assert.match(source, /stableMarker\(prepared\.createSpec\.stableId\)/);
  assert.match(source, /childrenOf\(comp, rig\)/);
  assert.match(source, /NULL_RIG_HAS_CHILDREN/);
  assert.match(source, /protocol 1\.4/);
  assert.match(source, /EXPECTED_HOST_REVISION_REQUIRED/);
  assert.match(source, /HOST_REVISION_CONFLICT/);
  assert.match(source, /NULL_RIG_STABLE_ID_COLLISION/);
  assert.match(source, /NULL_RIG_CREATE_READBACK_MISMATCH/);
  assert.match(source, /NULL_RIG_REMOVE_READBACK_MISMATCH/);
  assert.match(source, /NULL_RIG_SOURCE_OWNERSHIP_MISMATCH/);
  assert.match(source, /NULL_RIG_SOURCE_IN_USE/);
  assert.match(source, /NULL_RIG_SOURCE_REMOVE_READBACK_MISMATCH/);
  assert.match(source, /app\.beginUndoGroup/);
  assert.match(source, /app\.executeCommand\(16\)/);
  assert.doesNotMatch(source, /\beval\s*\(/);
});

test("CEP installation keeps accepted 1.5 available beneath the additive 1.6 loader", async () => {
  const [loader, currentLoader, installer, bridge, runtimeConfig] = await Promise.all([
    readFile(loaderPath, "utf8"),
    readFile(currentLoaderPath, "utf8"),
    readFile(installerPath, "utf8"),
    readFile(bridgePath, "utf8"),
    readFile(runtimeConfigPath, "utf8"),
  ]);
  assert.match(loader, /editflow_host_current\.jsx/);
  assert.match(loader, /editflow_host_m3_null_rigs\.jsx/);
  assert.match(loader, /M3_NULL_RIG_MODULE_LOAD_FAILED/);
  assert.match(loader, /request\.protocolVersion === "1\.5\.0"/);
  assert.match(currentLoader, /editflow_host_current_v15\.jsx/);
  assert.match(installer, /"editflow_host_m3_null_rigs\.jsx"/);
  assert.match(installer, /"editflow_host_current_v15\.jsx"/);
  assert.match(installer, /"editflow_host_current_v16\.jsx"/);
  for (const protocol of ["1.5.0", "1.4.0", "1.3.0", "1.2.0", "1.1.0"]) {
    assert.match(installer, new RegExp(`\\"${protocol.replaceAll(".", "\\.")}\\"`));
    assert.match(bridge, new RegExp(`\\"${protocol.replaceAll(".", "\\.")}\\"`));
    assert.match(runtimeConfig, new RegExp(`\\"${protocol.replaceAll(".", "\\.")}\\"`));
  }
  assert.match(bridge, /editflow_host_current_v16\.jsx/);
});

test("explicit broker negotiates 1.5 and carries a typed null-rig request", async () => {
  const protocols = ["1.5.0", "1.4.0", "1.3.0", "1.2.0", "1.1.0"];
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
        extensionVersion: "0.1.0-dev.5",
      }),
    });
    const registration = await registrationResponse.json();
    assert.equal(registrationResponse.status, 200);
    assert.equal(registration.protocolVersion, "1.5.0");

    const request = buildNullRigRequestV15({
      requestId: "REQ_NULL_BROKER",
      transactionId: "TX_NULL_BROKER",
      operationId: "OP_NULL_BROKER",
      command: "rig.null.readback",
      expectedHostProjectRevision: null,
      payload: { comp: { stableId: "COMP_NULL" }, rig: { stableId: "RIG_NULL" } },
    });
    const dispatched = broker.dispatch(request);
    const nextResponse = await fetch(`http://127.0.0.1:${port}/v1/next?sessionId=${encodeURIComponent(registration.sessionId)}`, { headers });
    assert.equal(nextResponse.status, 200);
    const leased = await nextResponse.json();
    assert.equal(leased.protocolVersion, "1.5.0");
    const response = {
      protocolVersion: "1.5.0",
      requestId: request.requestId,
      transactionId: request.transactionId,
      operationId: request.operationId,
      capabilityId: request.capabilityId,
      command: request.command,
      outcome: "NO_OP",
      error: null,
      affectedObjects: [],
      readback: { nullRig: { isNull: true, children: [] } },
      hostProjectRevision: 1,
      diagnostics: { adapterProtocolVersion: "1.5.0", adapterBuild: "0.4.0-dev.5", command: request.command, notes: [] },
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
