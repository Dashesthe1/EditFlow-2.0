import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AE_MASK_ADAPTER_BUILD_V12,
  AE_MASK_COMMANDS_V12,
  AE_MASK_PROTOCOL_VERSION_V12,
  AE_MASK_ROUTE_ID_V12,
  capabilityForMaskCommandV12,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_2.js";
import {
  CepEvalScriptMaskTransportV12,
  M3_MASK_CAPABILITIES_V12,
  buildMaskRequestV12,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-mask.js";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_masks.jsx";
const loaderPath = "packages/adapters/ae-cep/host/editflow_host_current.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";
const bridgePath = "packages/adapters/ae-cep/extension/client/bridge.js";
const runtimeConfigPath = "packages/adapters/ae-cep/extension/client/runtime-config.js";

test("M3 mask protocol 1.2 exposes the first human-parity dependency tranche", () => {
  assert.equal(AE_MASK_PROTOCOL_VERSION_V12, "1.2.0");
  assert.equal(AE_MASK_ADAPTER_BUILD_V12, "0.4.0-dev.1");
  assert.equal(AE_MASK_ROUTE_ID_V12, "ae-cep.mask.v1_2");
  assert.deepEqual([...AE_MASK_COMMANDS_V12], [
    "mask.create",
    "mask.remove",
    "mask.duplicate",
    "mask.reorder",
    "mask.set_path",
    "mask.set_properties",
    "mask.readback",
  ]);
  assert.equal(capabilityForMaskCommandV12("mask.create"), "ae.mask.create");
  assert.equal(capabilityForMaskCommandV12("mask.set_path"), "ae.mask.path.set");
  assert.equal(capabilityForMaskCommandV12("mask.set_properties"), "ae.mask.properties.set");
  assert.equal(capabilityForMaskCommandV12("mask.readback"), "ae.mask.readback");
});

test("negotiated M3 mask capabilities expose transport but do not inherit real-AE proof maturity", () => {
  assert.equal(M3_MASK_CAPABILITIES_V12.length, AE_MASK_COMMANDS_V12.length);
  for (const capability of M3_MASK_CAPABILITIES_V12) {
    assert.equal(capability.status, "PARTIAL");
    assert.equal(capability.proofMaturity, "DECLARED");
    assert.equal(capability.routes.length, 1);
    assert.equal(capability.routes[0].routeId, AE_MASK_ROUTE_ID_V12);
    assert.equal(capability.routes[0].available, true);
    assert.equal(capability.fallbackPolicy, "FORBID");
  }
});

test("M3 request builder correlates typed command and capability without inheriting M2 proof", () => {
  const request = buildMaskRequestV12({
    requestId: "REQ_M3_1",
    transactionId: "TX_M3_1",
    operationId: "OP_M3_1",
    command: "mask.set_path",
    expectedHostProjectRevision: 42,
    payload: {
      comp: { stableId: "COMP_M3" },
      layer: { stableId: "LAYER_M3" },
      mask: { stableId: "MASK_M3" },
      shape: {
        closed: true,
        vertices: [[0, 0], [100, 0], [100, 100]],
        inTangents: [[0, 0], [-10, 0], [0, -10]],
        outTangents: [[10, 0], [0, 10], [0, 0]],
      },
    },
  });
  assert.equal(request.protocolVersion, "1.2.0");
  assert.equal(request.capabilityId, "ae.mask.path.set");
  assert.equal(request.expectedHostProjectRevision, 42);
  assert.equal(request.readbackProfile, "M3_MASK_STRUCTURAL");
});

test("direct protocol 1.2 CEP transport serializes the whole request as data in one fixed dispatcher call", async () => {
  let captured = null;
  const request = buildMaskRequestV12({
    requestId: "REQ_M3_ESCAPE",
    transactionId: "TX_M3_ESCAPE",
    operationId: "OP_M3_ESCAPE",
    command: "mask.create",
    expectedHostProjectRevision: 7,
    payload: {
      comp: { stableId: "COMP_M3" },
      layer: { stableId: "LAYER_M3" },
      stableId: "MASK_M3_\"); app.quit(); //",
      name: "Mask with \\ slash and \" quote",
    },
  });
  const bridge = {
    evalScript(script, callback) {
      captured = script;
      callback(JSON.stringify({
        protocolVersion: "1.2.0",
        requestId: request.requestId,
        transactionId: request.transactionId,
        operationId: request.operationId,
        capabilityId: request.capabilityId,
        command: request.command,
        outcome: "APPLIED",
        error: null,
        affectedObjects: [],
        readback: { mask: { stableId: request.payload.stableId } },
        hostProjectRevision: 8,
        diagnostics: {
          adapterProtocolVersion: "1.2.0",
          adapterBuild: "0.4.0-dev.1",
          command: request.command,
          notes: [],
        },
      }));
    },
  };
  const transport = new CepEvalScriptMaskTransportV12(bridge);
  const response = await transport.dispatch(request);
  assert.equal(response.outcome, "APPLIED");
  assert.ok(captured.startsWith("EditFlow2_dispatch(\"") && captured.endsWith("\")"));
  assert.equal((captured.match(/EditFlow2_dispatch/g) ?? []).length, 1);
  assert.ok(captured.includes("app.quit"), "hostile-looking text is present only inside the serialized request literal");
  assert.ok(!captured.includes("); app.quit(); //\")"), "hostile-looking payload must not terminate the dispatcher argument");
});

test("M3 AE host layer implements mask CRUD, exact Shape geometry, animation, properties, readback and self-rollback", async () => {
  const source = await readFile(hostPath, "utf8");
  for (const command of AE_MASK_COMMANDS_V12) assert.match(source, new RegExp(`\\"${command.replaceAll(".", "\\.")}\\"`));
  assert.match(source, /ADBE Mask Parade/);
  assert.match(source, /ADBE Mask Atom/);
  assert.match(source, /new Shape\(\)/);
  assert.match(source, /shape\.vertices = validated\.vertices/);
  assert.match(source, /shape\.inTangents = validated\.inTangents/);
  assert.match(source, /shape\.outTangents = validated\.outTangents/);
  assert.match(source, /shape\.featherSegLocs/);
  assert.match(source, /shape\.featherRelSegLocs/);
  assert.match(source, /shape\.featherRadii/);
  assert.match(source, /shape\.featherInterps/);
  assert.match(source, /shape\.featherTensions/);
  assert.match(source, /shape\.featherTypes/);
  assert.match(source, /shape\.featherRelCornerAngles/);
  assert.match(source, /setValueAtTime/);
  assert.match(source, /Static mask path write refuses to erase existing animation/);
  assert.match(source, /ADBE Mask Feather/);
  assert.match(source, /ADBE Mask Offset/);
  assert.match(source, /ADBE Mask Opacity/);
  assert.match(source, /mask\.maskMode/);
  assert.match(source, /mask\.inverted/);
  assert.match(source, /cloneMask/);
  assert.match(source, /mask\.moveTo\(payload\.index\)/);
  assert.match(source, /mask\.remove\(\)/);
  assert.match(source, /pathKeyframes/);
  assert.match(source, /expectedHostProjectRevision/);
  assert.match(source, /HOST_REVISION_CONFLICT/);
  assert.match(source, /app\.beginUndoGroup/);
  assert.match(source, /app\.endUndoGroup/);
  assert.match(source, /app\.executeCommand\(16\)/);
  assert.doesNotMatch(source, /\beval\s*\(/);
});

test("current installer and CEP panel negotiate 1.2 while preserving the accepted 1.1 fallback", async () => {
  const [loader, installer, bridge, runtimeConfig] = await Promise.all([
    readFile(loaderPath, "utf8"),
    readFile(installerPath, "utf8"),
    readFile(bridgePath, "utf8"),
    readFile(runtimeConfigPath, "utf8"),
  ]);
  assert.match(loader, /editflow_host_m3_masks\.jsx/);
  assert.match(loader, /\$\.evalFile\(m3Masks\)/);
  assert.match(installer, /"editflow_host_m3_masks\.jsx"/);
  assert.match(installer, /protocolVersion = "1\.1\.0"/);
  assert.match(installer, /supportedProtocolVersions = @\("1\.2\.0", "1\.1\.0"\)/);
  assert.match(installer, /highest mutually supported version is negotiated per session/);
  assert.match(bridge, /supportedProtocolVersions/);
  assert.match(bridge, /response\.protocolVersion !== request\.protocolVersion/);
  assert.match(bridge, /Broker negotiated an unsupported CEP protocol/);
  assert.doesNotMatch(bridge, /response\.protocolVersion !== "1\.1\.0"/);
  assert.match(runtimeConfig, /schemaVersion: 2/);
  assert.match(runtimeConfig, /supportedProtocolVersions: \["1\.2\.0", "1\.1\.0"\]/);
});
