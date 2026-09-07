import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AE_PARENTING_ADAPTER_BUILD_V14,
  AE_PARENTING_COMMANDS_V14,
  AE_PARENTING_PROTOCOL_VERSION_V14,
  AE_PARENTING_ROUTE_ID_V14,
  capabilityForParentingCommandV14,
  isAeParentingCommandV14,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_4.js";
import {
  M3_PARENTING_P1_P2_ACCEPTED_SOURCE_COMMIT,
  M3_PARENTING_P1_P2_ACCEPTANCE_CONTROL_COMMIT,
  M3_PARENTING_P1_P2_ACCEPTANCE_RUN,
  M3_PARENTING_P1_P2_ACCEPTANCE_RUN_ATTEMPT,
  M3_PARENTING_P1_P2_ACCEPTANCE_JOB,
  M3_PARENTING_P1_P2_ACCEPTANCE_ARTIFACT,
  M3_PARENTING_P5_ACCEPTED_SOURCE_COMMIT,
  M3_PARENTING_P5_ACCEPTANCE_CONTROL_COMMIT,
  M3_PARENTING_P5_ACCEPTANCE_RUN,
  M3_PARENTING_P5_ACCEPTANCE_RUN_ATTEMPT,
  M3_PARENTING_P5_ACCEPTANCE_JOB,
  M3_PARENTING_P5_ACCEPTANCE_ARTIFACT,
  m3ParentingAcceptedProofMaturityForCapability,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-parenting-proof-maturity.js";
import {
  CepEvalScriptParentingTransportV14,
  M3_PARENTING_CAPABILITIES_V14,
  buildParentingRequestV14,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-parenting.js";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_parenting.jsx";
const acceptedLoaderPath = "packages/adapters/ae-cep/host/editflow_host_current.jsx";
const additiveLoaderPath = "packages/adapters/ae-cep/host/editflow_host_current_v15.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";
const bridgePath = "packages/adapters/ae-cep/extension/client/bridge.js";
const runtimeConfigPath = "packages/adapters/ae-cep/extension/client/runtime-config.js";

test("M3 parenting protocol 1.4 is an explicit preserve-transform tranche", () => {
  assert.equal(AE_PARENTING_PROTOCOL_VERSION_V14, "1.4.0");
  assert.equal(AE_PARENTING_ADAPTER_BUILD_V14, "0.4.0-dev.4");
  assert.equal(AE_PARENTING_ROUTE_ID_V14, "ae-cep.parenting.v1_4");
  assert.deepEqual([...AE_PARENTING_COMMANDS_V14], [
    "layer.set_parent_preserve_transform",
    "layer.clear_parent_preserve_transform",
    "layer.parenting_readback",
  ]);
  assert.equal(isAeParentingCommandV14("layer.set_parent_preserve_transform"), true);
  assert.equal(isAeParentingCommandV14("layer.set_parent_with_jump"), false);
  assert.equal(capabilityForParentingCommandV14("layer.set_parent_preserve_transform"), "ae.layer.parent.set_preserve_transform");
  assert.equal(capabilityForParentingCommandV14("layer.clear_parent_preserve_transform"), "ae.layer.parent.clear_preserve_transform");
  assert.equal(capabilityForParentingCommandV14("layer.parenting_readback"), "ae.layer.parenting.readback");
});

test("M3 parenting registry is pinned to accepted P1-P5 real-AE evidence", () => {
  assert.equal(M3_PARENTING_P1_P2_ACCEPTED_SOURCE_COMMIT, "026e83dabe6e354c192f36518234f43e559048e7");
  assert.equal(M3_PARENTING_P1_P2_ACCEPTANCE_CONTROL_COMMIT, "9b41d8eb576fa809d4aae3ede6e381160ecb483d");
  assert.equal(M3_PARENTING_P1_P2_ACCEPTANCE_RUN, 34082201184);
  assert.equal(M3_PARENTING_P1_P2_ACCEPTANCE_RUN_ATTEMPT, 1);
  assert.equal(M3_PARENTING_P1_P2_ACCEPTANCE_JOB, 101619497171);
  assert.equal(M3_PARENTING_P1_P2_ACCEPTANCE_ARTIFACT, 10004053330);
  assert.equal(M3_PARENTING_P5_ACCEPTED_SOURCE_COMMIT, "59f0401d49dd0c92e86246df59c801e8ed76616f");
  assert.equal(M3_PARENTING_P5_ACCEPTANCE_CONTROL_COMMIT, "046d0d4bb6165875acb4965b1d6d94539714571a");
  assert.equal(M3_PARENTING_P5_ACCEPTANCE_RUN, 34086348504);
  assert.equal(M3_PARENTING_P5_ACCEPTANCE_RUN_ATTEMPT, 1);
  assert.equal(M3_PARENTING_P5_ACCEPTANCE_JOB, 101631020844);
  assert.equal(M3_PARENTING_P5_ACCEPTANCE_ARTIFACT, 10005344570);
  assert.equal(M3_PARENTING_CAPABILITIES_V14.length, AE_PARENTING_COMMANDS_V14.length);
  for (const capability of M3_PARENTING_CAPABILITIES_V14) {
    assert.equal(m3ParentingAcceptedProofMaturityForCapability(String(capability.id)), "TRANSFER");
    assert.equal(capability.status, "FULL");
    assert.equal(capability.proofMaturity, "TRANSFER");
    assert.equal(capability.routes.length, 1);
    assert.equal(capability.routes[0].routeId, AE_PARENTING_ROUTE_ID_V14);
    assert.equal(capability.routes[0].available, true);
    assert.equal(capability.fallbackPolicy, "FORBID");
  }
  assert.equal(m3ParentingAcceptedProofMaturityForCapability("ae.layer.parent.future"), "DECLARED");
});

test("parenting request builder binds the preserve-transform command to its capability", () => {
  const request = buildParentingRequestV14({
    requestId: "REQ_PARENT_BUILD",
    transactionId: "TX_PARENT_BUILD",
    operationId: "OP_PARENT_BUILD",
    command: "layer.set_parent_preserve_transform",
    expectedHostProjectRevision: 52,
    payload: {
      comp: { stableId: "COMP_PARENT" },
      layer: { stableId: "LAYER_CHILD" },
      parentLayer: { stableId: "LAYER_PARENT" },
    },
  });
  assert.equal(request.protocolVersion, "1.4.0");
  assert.equal(request.capabilityId, "ae.layer.parent.set_preserve_transform");
  assert.equal(request.expectedHostProjectRevision, 52);
  assert.equal(request.readbackProfile, "M3_PARENTING_STRUCTURAL");
});

test("direct protocol 1.4 CEP transport serializes hostile-looking layer refs as data", async () => {
  let captured = null;
  const request = buildParentingRequestV14({
    requestId: "REQ_PARENT_ESCAPE",
    transactionId: "TX_PARENT_ESCAPE",
    operationId: "OP_PARENT_ESCAPE",
    command: "layer.set_parent_preserve_transform",
    expectedHostProjectRevision: 7,
    payload: {
      comp: { stableId: "COMP_PARENT" },
      layer: { stableId: "LAYER_\"); app.quit(); //" },
      parentLayer: { stableId: "LAYER_PARENT" },
    },
  });
  const bridge = {
    evalScript(script, callback) {
      captured = script;
      callback(JSON.stringify({
        protocolVersion: "1.4.0",
        requestId: request.requestId,
        transactionId: request.transactionId,
        operationId: request.operationId,
        capabilityId: request.capabilityId,
        command: request.command,
        outcome: "APPLIED",
        error: null,
        affectedObjects: [],
        readback: { parenting: { hasParent: true } },
        hostProjectRevision: 8,
        diagnostics: {
          adapterProtocolVersion: "1.4.0",
          adapterBuild: "0.4.0-dev.4",
          command: request.command,
          notes: [],
        },
      }));
    },
  };
  const transport = new CepEvalScriptParentingTransportV14(bridge);
  const response = await transport.dispatch(request);
  assert.equal(response.outcome, "APPLIED");
  assert.ok(captured.startsWith("EditFlow2_dispatch(\"") && captured.endsWith("\")"));
  assert.equal((captured.match(/EditFlow2_dispatch/g) ?? []).length, 1);
  assert.ok(captured.includes("app.quit"));
  assert.ok(!captured.includes("); app.quit(); //\")"));
});

test("M3 parenting host encodes no-jump geometry, exact readback, rejection, and proof-gated rollback", async () => {
  const source = await readFile(hostPath, "utf8");
  for (const command of AE_PARENTING_COMMANDS_V14) {
    assert.match(source, new RegExp(`\\"${command.replaceAll(".", "\\.")}\\"`));
  }
  assert.match(source, /prepared\.layer\.parent = prepared\.parentLayer/);
  assert.match(source, /prepared\.layer\.parent = null/);
  assert.doesNotMatch(source, /\.setParentWithJump\s*\(/,
    "preserve-transform commands must never call setParentWithJump because that API can cause an apparent jump");
  assert.match(source, /PARENT_SELF_REFERENCE/);
  assert.match(source, /PARENT_CYCLE/);
  assert.match(source, /EXPECTED_HOST_REVISION_REQUIRED/);
  assert.match(source, /HOST_REVISION_CONFLICT/);
  assert.match(source, /parentingReadback/);
  assert.match(source, /localTransform/);
  assert.match(source, /ADBE Skew/);
  assert.match(source, /ADBE Skew Axis/);
  assert.match(source, /compSpaceGeometry/);
  assert.match(source, /sourceRectAtTime/);
  assert.match(source, /sourcePointToCompSnapshot/);
  for (const point of ["topLeft", "topRight", "bottomRight", "bottomLeft", "center"]) {
    assert.match(source, new RegExp(`${point}: sourcePointToCompSnapshot`));
  }
  assert.match(source, /M3_PARENTING_P4_FAILURE_INJECTION/);
  assert.match(source, /EDITFLOW_M3_PARENTING_P4_PROOF/);
  assert.match(source, /M3_PARENTING_P4_INDUCED_FAILURE/);
  assert.match(source, /Failed parenting mutation self-rolled back with AE Undo\./);
  const mutationIndex = source.indexOf("prepared.layer.parent = prepared.parentLayer");
  const injectionIndex = source.indexOf('request.readbackProfile === "M3_PARENTING_P4_FAILURE_INJECTION"');
  assert.ok(mutationIndex >= 0 && injectionIndex > mutationIndex,
    "P4 injection must occur only after a real parent mutation inside the normal undo group");
  assert.match(source, /app\.beginUndoGroup/);
  assert.match(source, /app\.endUndoGroup/);
  assert.match(source, /app\.executeCommand\(16\)/);
  assert.doesNotMatch(source, /\beval\s*\(/);
});

test("protocol 1.5 installation preserves the accepted 1.4 parenting loader and advertises both tranches", async () => {
  const [acceptedLoader, additiveLoader, installer, bridge, runtimeConfig] = await Promise.all([
    readFile(acceptedLoaderPath, "utf8"),
    readFile(additiveLoaderPath, "utf8"),
    readFile(installerPath, "utf8"),
    readFile(bridgePath, "utf8"),
    readFile(runtimeConfigPath, "utf8"),
  ]);
  assert.match(acceptedLoader, /editflow_host_m3_parenting\.jsx/);
  assert.match(acceptedLoader, /\$\.evalFile\(m3Parenting\)/);
  assert.match(acceptedLoader, /M3_PARENTING_MODULE_LOAD_FAILED/);
  assert.match(acceptedLoader, /request\.protocolVersion === "1\.4\.0"/);
  assert.match(additiveLoader, /editflow_host_current\.jsx/);
  assert.match(installer, /"editflow_host_m3_parenting\.jsx"/);
  assert.match(installer, /supportedProtocolVersions = @\("1\.5\.0", "1\.4\.0", "1\.3\.0", "1\.2\.0", "1\.1\.0"\)/);
  assert.match(bridge, /KNOWN_PROTOCOLS = \["1\.5\.0", "1\.4\.0", "1\.3\.0", "1\.2\.0", "1\.1\.0"\]/);
  assert.match(runtimeConfig, /supportedProtocolVersions: \["1\.5\.0", "1\.4\.0", "1\.3\.0", "1\.2\.0", "1\.1\.0"\]/);
});
