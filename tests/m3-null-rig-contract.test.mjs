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
  CepEvalScriptNullRigTransportV15,
  M3_NULL_RIG_CAPABILITIES_V15,
  buildNullRigRequestV15,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-null-rigs.js";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_null_rigs.jsx";
const loaderPath = "packages/adapters/ae-cep/host/editflow_host_current.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";
const bridgePath = "packages/adapters/ae-cep/extension/client/bridge.js";
const runtimeConfigPath = "packages/adapters/ae-cep/extension/client/runtime-config.js";
const manifestPath = "packages/adapters/ae-cep/extension/CSXS/manifest.xml";

test("M3 null rigs use an explicit additive protocol 1.5 command surface", () => {
  assert.equal(AE_NULL_RIG_PROTOCOL_VERSION_V15, "1.5.0");
  assert.equal(AE_NULL_RIG_ADAPTER_BUILD_V15, "0.5.0-dev.1");
  assert.equal(AE_NULL_RIG_ROUTE_ID_V15, "ae-cep.null-rig.v1_5");
  assert.deepEqual([...AE_NULL_RIG_COMMANDS_V15], [
    "layer.null_create",
    "layer.null_readback",
    "rig.bind_children_to_null_preserve_transform",
    "rig.unbind_children_from_null_preserve_transform",
    "rig.relationship_readback",
  ]);
  assert.equal(isAeNullRigCommandV15("layer.null_create"), true);
  assert.equal(isAeNullRigCommandV15("layer.add_media"), false);
  assert.equal(capabilityForNullRigCommandV15("layer.null_create"), "ae.layer.null.create");
  assert.equal(capabilityForNullRigCommandV15("layer.null_readback"), "ae.layer.null.readback");
  assert.equal(capabilityForNullRigCommandV15("rig.bind_children_to_null_preserve_transform"), "ae.rig.null.bind_children_preserve_transform");
  assert.equal(capabilityForNullRigCommandV15("rig.unbind_children_from_null_preserve_transform"), "ae.rig.null.unbind_children_preserve_transform");
  assert.equal(capabilityForNullRigCommandV15("rig.relationship_readback"), "ae.rig.relationship.readback");
});

test("null rig foundation declares only unproved partial capability maturity", () => {
  assert.equal(M3_NULL_RIG_CAPABILITIES_V15.length, AE_NULL_RIG_COMMANDS_V15.length);
  for (const capability of M3_NULL_RIG_CAPABILITIES_V15) {
    assert.equal(capability.status, "PARTIAL");
    assert.equal(capability.proofMaturity, "DECLARED");
    assert.equal(capability.routes.length, 1);
    assert.equal(capability.routes[0].routeId, AE_NULL_RIG_ROUTE_ID_V15);
    assert.equal(capability.routes[0].available, true);
    assert.equal(capability.fallbackPolicy, "FORBID");
  }
  const create = M3_NULL_RIG_CAPABILITIES_V15.find((item) => item.id === "ae.layer.null.create");
  const readback = M3_NULL_RIG_CAPABILITIES_V15.find((item) => item.id === "ae.rig.relationship.readback");
  assert.equal(create?.riskClass, "R2_STRUCTURAL");
  assert.equal(readback?.riskClass, "R0_READ_ONLY");
});

test("null rig request builder binds commands to typed capabilities and revisions", () => {
  const request = buildNullRigRequestV15({
    requestId: "REQ_NULL_RIG_BUILD",
    transactionId: "TX_NULL_RIG_BUILD",
    operationId: "OP_NULL_RIG_BUILD",
    command: "rig.bind_children_to_null_preserve_transform",
    expectedHostProjectRevision: 88,
    payload: {
      comp: { stableId: "COMP_NULL_RIG" },
      controller: { stableId: "NULL_CTRL" },
      children: [{ stableId: "CHILD_A" }, { stableId: "CHILD_B" }],
    },
  });
  assert.equal(request.protocolVersion, "1.5.0");
  assert.equal(request.capabilityId, "ae.rig.null.bind_children_preserve_transform");
  assert.equal(request.expectedHostProjectRevision, 88);
  assert.equal(request.readbackProfile, "M3_NULL_RIG_STRUCTURAL");
});

test("direct protocol 1.5 CEP transport serializes hostile-looking stable IDs as data", async () => {
  let captured = null;
  const request = buildNullRigRequestV15({
    requestId: "REQ_NULL_RIG_ESCAPE",
    transactionId: "TX_NULL_RIG_ESCAPE",
    operationId: "OP_NULL_RIG_ESCAPE",
    command: "layer.null_readback",
    expectedHostProjectRevision: null,
    payload: {
      comp: { stableId: "COMP_NULL_RIG" },
      layer: { stableId: "NULL_\"); app.quit(); //" },
    },
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
        readback: { nullLayer: { isNull: true } },
        hostProjectRevision: 8,
        diagnostics: {
          adapterProtocolVersion: "1.5.0",
          adapterBuild: "0.5.0-dev.1",
          command: request.command,
          notes: [],
        },
      }));
    },
  };
  const transport = new CepEvalScriptNullRigTransportV15(bridge);
  const response = await transport.dispatch(request);
  assert.equal(response.outcome, "NO_OP");
  assert.ok(captured.startsWith("EditFlow2_dispatch(\"") && captured.endsWith("\")"));
  assert.equal((captured.match(/EditFlow2_dispatch/g) ?? []).length, 1);
  assert.ok(captured.includes("app.quit"));
  assert.ok(!captured.includes("); app.quit(); //\")"));
});

test("null rig host creates true nulls and enforces atomic 2D no-jump multi-child relationships", async () => {
  const source = await readFile(hostPath, "utf8");
  for (const command of AE_NULL_RIG_COMMANDS_V15) {
    assert.match(source, new RegExp(`\\"${command.replaceAll(".", "\\.")}\\"`));
  }
  assert.match(source, /comp\.layers\.addNull\(comp\.duration\)/);
  assert.match(source, /layer\.nullLayer === true/);
  assert.match(source, /NULL_STABLE_ID_COLLISION/);
  assert.match(source, /NULL_CONTROLLER_REQUIRED/);
  assert.match(source, /NULL_RIG_DUPLICATE_CHILD/);
  assert.match(source, /NULL_RIG_SELF_REFERENCE/);
  assert.match(source, /NULL_RIG_PARENT_CYCLE/);
  assert.match(source, /NULL_RIG_CHILD_NOT_BOUND/);
  assert.match(source, /NULL_RIG_3D_UNSUPPORTED/);
  assert.match(source, /EXPECTED_HOST_REVISION_REQUIRED/);
  assert.match(source, /HOST_REVISION_CONFLICT/);
  assert.match(source, /child\.parent = prepared\.controller/);
  assert.match(source, /child\.parent = null/);
  assert.doesNotMatch(source, /\.setParentWithJump\s*\(/);
  assert.match(source, /sourceRectAtTime/);
  assert.match(source, /sourcePointToCompSnapshot/);
  for (const point of ["topLeft", "topRight", "bottomRight", "bottomLeft", "center"]) {
    assert.match(source, new RegExp(`${point}: sourcePointToCompSnapshot`));
  }
  assert.match(source, /NULL_RIG_PRESERVE_VISUAL_UNREPRESENTABLE/);
  assert.match(source, /app\.beginUndoGroup/);
  assert.match(source, /app\.endUndoGroup/);
  assert.match(source, /app\.executeCommand\(16\)/);
  assert.doesNotMatch(source, /\beval\s*\(/);
});

test("current CEP install advertises 1.5 additively and loads null rigs fail-closed", async () => {
  const [loader, installer, bridge, runtimeConfig, manifest] = await Promise.all([
    readFile(loaderPath, "utf8"),
    readFile(installerPath, "utf8"),
    readFile(bridgePath, "utf8"),
    readFile(runtimeConfigPath, "utf8"),
    readFile(manifestPath, "utf8"),
  ]);
  assert.match(loader, /editflow_host_m3_null_rigs\.jsx/);
  assert.match(loader, /\$\.evalFile\(m3NullRigs\)/);
  assert.match(loader, /M3_NULL_RIG_MODULE_LOAD_FAILED/);
  assert.match(loader, /request\.protocolVersion === "1\.5\.0"/);
  assert.match(installer, /"editflow_host_m3_null_rigs\.jsx"/);
  assert.match(installer, /supportedProtocolVersions = @\("1\.5\.0", "1\.4\.0", "1\.3\.0", "1\.2\.0", "1\.1\.0"\)/);
  assert.match(installer, /ExtensionVersion = "0\.1\.0-dev\.5"/);
  assert.match(bridge, /KNOWN_PROTOCOLS = \["1\.5\.0", "1\.4\.0", "1\.3\.0", "1\.2\.0", "1\.1\.0"\]/);
  assert.match(runtimeConfig, /supportedProtocolVersions: \["1\.5\.0", "1\.4\.0", "1\.3\.0", "1\.2\.0", "1\.1\.0"\]/);
  assert.match(runtimeConfig, /extensionVersion: "0\.1\.0-dev\.5"/);
  assert.match(manifest, /ExtensionBundleVersion="0\.1\.0\.dev-5"/);
  assert.match(manifest, /Version="0\.1\.0\.dev-5"/);
});
