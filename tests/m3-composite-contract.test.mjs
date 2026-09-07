import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AE_BLEND_MODES_V13,
  AE_COMPOSITE_ADAPTER_BUILD_V13,
  AE_COMPOSITE_COMMANDS_V13,
  AE_COMPOSITE_PROTOCOL_VERSION_V13,
  AE_COMPOSITE_ROUTE_ID_V13,
  AE_TRACK_MATTE_TYPES_V13,
  capabilityForCompositeCommandV13,
  isAeBlendModeV13,
  isAeTrackMatteTypeV13,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_3.js";
import {
  CepEvalScriptCompositeTransportV13,
  M3_COMPOSITE_CAPABILITIES_V13,
  buildCompositeRequestV13,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-composite.js";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_composite.jsx";
const loaderPath = "packages/adapters/ae-cep/host/editflow_host_current.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";
const bridgePath = "packages/adapters/ae-cep/extension/client/bridge.js";
const runtimeConfigPath = "packages/adapters/ae-cep/extension/client/runtime-config.js";

test("M3 composite protocol 1.3 exposes arbitrary track mattes and blend modes as a separate tranche", () => {
  assert.equal(AE_COMPOSITE_PROTOCOL_VERSION_V13, "1.3.0");
  assert.equal(AE_COMPOSITE_ADAPTER_BUILD_V13, "0.4.0-dev.3");
  assert.equal(AE_COMPOSITE_ROUTE_ID_V13, "ae-cep.composite.v1_3");
  assert.deepEqual([...AE_COMPOSITE_COMMANDS_V13], [
    "layer.set_track_matte",
    "layer.clear_track_matte",
    "layer.set_blend_mode",
    "layer.composite_readback",
  ]);
  assert.deepEqual([...AE_TRACK_MATTE_TYPES_V13], ["ALPHA", "ALPHA_INVERTED", "LUMA", "LUMA_INVERTED"]);
  assert.equal(AE_BLEND_MODES_V13.length, 38);
  assert.equal(new Set(AE_BLEND_MODES_V13).size, AE_BLEND_MODES_V13.length);
  for (const value of ["NORMAL", "MULTIPLY", "SCREEN", "OVERLAY", "DIVIDE", "SUBTRACT", "SILHOUETTE_ALPHA"]) {
    assert.equal(isAeBlendModeV13(value), true);
  }
  assert.equal(isAeBlendModeV13("NOT_A_MODE"), false);
  assert.equal(isAeTrackMatteTypeV13("LUMA_INVERTED"), true);
  assert.equal(isAeTrackMatteTypeV13("NO_TRACK_MATTE"), false);
  assert.equal(capabilityForCompositeCommandV13("layer.set_track_matte"), "ae.layer.track_matte.set");
  assert.equal(capabilityForCompositeCommandV13("layer.clear_track_matte"), "ae.layer.track_matte.clear");
  assert.equal(capabilityForCompositeCommandV13("layer.set_blend_mode"), "ae.layer.blend_mode.set");
  assert.equal(capabilityForCompositeCommandV13("layer.composite_readback"), "ae.layer.composite.readback");
});

test("new M3 composite capabilities remain declared-only until real-AE proof promotes them", () => {
  assert.equal(M3_COMPOSITE_CAPABILITIES_V13.length, AE_COMPOSITE_COMMANDS_V13.length);
  for (const capability of M3_COMPOSITE_CAPABILITIES_V13) {
    assert.equal(capability.status, "PARTIAL");
    assert.equal(capability.proofMaturity, "DECLARED");
    assert.equal(capability.routes.length, 1);
    assert.equal(capability.routes[0].routeId, AE_COMPOSITE_ROUTE_ID_V13);
    assert.equal(capability.routes[0].available, true);
    assert.equal(capability.fallbackPolicy, "FORBID");
  }
});

test("composite request builder binds commands to capability IDs and host revision", () => {
  const request = buildCompositeRequestV13({
    requestId: "REQ_COMPOSITE_BUILD",
    transactionId: "TX_COMPOSITE_BUILD",
    operationId: "OP_COMPOSITE_BUILD",
    command: "layer.set_track_matte",
    expectedHostProjectRevision: 44,
    payload: {
      comp: { stableId: "COMP_COMPOSITE" },
      layer: { stableId: "LAYER_TARGET" },
      matteLayer: { stableId: "LAYER_MATTE" },
      trackMatteType: "ALPHA_INVERTED",
    },
  });
  assert.equal(request.protocolVersion, "1.3.0");
  assert.equal(request.capabilityId, "ae.layer.track_matte.set");
  assert.equal(request.expectedHostProjectRevision, 44);
  assert.equal(request.readbackProfile, "M3_COMPOSITE_STRUCTURAL");
});

test("direct protocol 1.3 CEP transport serializes hostile-looking payload text as data", async () => {
  let captured = null;
  const request = buildCompositeRequestV13({
    requestId: "REQ_COMPOSITE_ESCAPE",
    transactionId: "TX_COMPOSITE_ESCAPE",
    operationId: "OP_COMPOSITE_ESCAPE",
    command: "layer.set_blend_mode",
    expectedHostProjectRevision: 7,
    payload: {
      comp: { stableId: "COMP_COMPOSITE" },
      layer: { stableId: "LAYER_\"); app.quit(); //" },
      blendMode: "MULTIPLY",
    },
  });
  const bridge = {
    evalScript(script, callback) {
      captured = script;
      callback(JSON.stringify({
        protocolVersion: "1.3.0",
        requestId: request.requestId,
        transactionId: request.transactionId,
        operationId: request.operationId,
        capabilityId: request.capabilityId,
        command: request.command,
        outcome: "APPLIED",
        error: null,
        affectedObjects: [],
        readback: { composite: { blendMode: "MULTIPLY" } },
        hostProjectRevision: 8,
        diagnostics: {
          adapterProtocolVersion: "1.3.0",
          adapterBuild: "0.4.0-dev.3",
          command: request.command,
          notes: [],
        },
      }));
    },
  };
  const transport = new CepEvalScriptCompositeTransportV13(bridge);
  const response = await transport.dispatch(request);
  assert.equal(response.outcome, "APPLIED");
  assert.ok(captured.startsWith("EditFlow2_dispatch(\"") && captured.endsWith("\")"));
  assert.equal((captured.match(/EditFlow2_dispatch/g) ?? []).length, 1);
  assert.ok(captured.includes("app.quit"));
  assert.ok(!captured.includes("); app.quit(); //\")"));
});

test("M3 composite host uses modern arbitrary-source track matte APIs and exact structural readback", async () => {
  const source = await readFile(hostPath, "utf8");
  for (const command of AE_COMPOSITE_COMMANDS_V13) {
    assert.match(source, new RegExp(`\\"${command.replaceAll(".", "\\.")}\\"`));
  }
  assert.match(source, /layer\.setTrackMatte\(matte, desired\)/);
  assert.match(source, /layer\.removeTrackMatte\(\)/);
  assert.match(source, /layer\.trackMatteLayer/);
  assert.match(source, /layer\.trackMatteType/);
  assert.match(source, /layer\.blendingMode = desired/);
  assert.match(source, /BlendingMode\.SILHOUETE_ALPHA/);
  assert.match(source, /TRACK_MATTE_SELF_REFERENCE/);
  assert.match(source, /TRACK_MATTE_API_UNAVAILABLE/);
  assert.match(source, /After Effects 23\.0 or newer is required/);
  assert.match(source, /expectedHostProjectRevision/);
  assert.match(source, /HOST_REVISION_CONFLICT/);
  assert.match(source, /app\.beginUndoGroup/);
  assert.match(source, /app\.endUndoGroup/);
  assert.match(source, /app\.executeCommand\(16\)/);
  assert.doesNotMatch(source, /moveBefore|moveAfter|moveToBeginning|moveToEnd/,
    "arbitrary matte sources must not be implemented by silently reordering layers");
  assert.doesNotMatch(source, /\beval\s*\(/);
});

test("current CEP installation advertises 1.3 additively and loads the composite host module", async () => {
  const [loader, installer, bridge, runtimeConfig] = await Promise.all([
    readFile(loaderPath, "utf8"),
    readFile(installerPath, "utf8"),
    readFile(bridgePath, "utf8"),
    readFile(runtimeConfigPath, "utf8"),
  ]);
  assert.match(loader, /editflow_host_m3_composite\.jsx/);
  assert.match(loader, /\$\.evalFile\(m3Composite\)/);
  assert.match(installer, /"editflow_host_m3_composite\.jsx"/);
  assert.match(installer, /supportedProtocolVersions = @\("1\.3\.0", "1\.2\.0", "1\.1\.0"\)/);
  assert.match(bridge, /KNOWN_PROTOCOLS = \["1\.3\.0", "1\.2\.0", "1\.1\.0"\]/);
  assert.match(runtimeConfig, /supportedProtocolVersions: \["1\.3\.0", "1\.2\.0", "1\.1\.0"\]/);
});
