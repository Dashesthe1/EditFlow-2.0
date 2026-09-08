import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import {
  AE_SPATIAL_GRAPH_ADAPTER_BUILD_V19,
  AE_SPATIAL_GRAPH_COMMANDS_V19,
  AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19,
  AE_SPATIAL_GRAPH_ROUTE_ID_V19,
  capabilityForSpatialGraphCommandV19,
  isAeSpatialGraphCommandV19,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_9.js";
import {
  CepEvalScriptSpatialGraphTransportV19,
  M3_SPATIAL_GRAPH_CAPABILITIES_V19,
  buildSpatialGraphRequestV19,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-spatial-graph.js";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_spatial_graph.jsx";
const loaderPath = "packages/adapters/ae-cep/host/editflow_host_current_v19.jsx";

test("M3 spatial Graph Editor protocol 1.9 is a bounded additive surface", () => {
  assert.equal(AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19, "1.9.0");
  assert.equal(AE_SPATIAL_GRAPH_ADAPTER_BUILD_V19, "0.4.0-dev.9");
  assert.equal(AE_SPATIAL_GRAPH_ROUTE_ID_V19, "ae-cep.spatial-graph.v1_9");
  assert.deepEqual([...AE_SPATIAL_GRAPH_COMMANDS_V19], ["property.spatial_graph.set", "property.spatial_graph.readback"]);
  assert.equal(isAeSpatialGraphCommandV19("property.spatial_graph.set"), true);
  assert.equal(isAeSpatialGraphCommandV19("property.temporal_ease.set"), false);
  assert.equal(capabilityForSpatialGraphCommandV19("property.spatial_graph.set"), "ae.property.spatial_graph.set");
});

test("spatial Graph Editor capabilities remain PARTIAL DECLARED before real-AE proof", () => {
  assert.equal(M3_SPATIAL_GRAPH_CAPABILITIES_V19.length, 2);
  for (const capability of M3_SPATIAL_GRAPH_CAPABILITIES_V19) {
    assert.equal(capability.status, "PARTIAL");
    assert.equal(capability.proofMaturity, "DECLARED");
    assert.equal(capability.routes[0].routeId, AE_SPATIAL_GRAPH_ROUTE_ID_V19);
    assert.equal(capability.fallbackPolicy, "FORBID");
  }
});

test("request builder preserves exact MANUAL spatial state", () => {
  const state = { mode: "MANUAL", inTangent: [-120, 30], outTangent: [140, -20], continuous: false, roving: true };
  const request = buildSpatialGraphRequestV19({
    requestId: "REQ_SPATIAL_BUILD", transactionId: "TX_SPATIAL_BUILD", operationId: "OP_SPATIAL_BUILD",
    command: "property.spatial_graph.set", expectedHostProjectRevision: 101,
    payload: { comp: { stableId: "COMP" }, layer: { stableId: "LAYER" }, propertyPath: ["ADBE Transform Group", "ADBE Position"], keyIndex: 2, state },
  });
  assert.equal(request.protocolVersion, "1.9.0");
  assert.equal(request.capabilityId, "ae.property.spatial_graph.set");
  assert.equal(request.expectedHostProjectRevision, 101);
  assert.equal(request.readbackProfile, "M3_SPATIAL_GRAPH_STRUCTURAL");
  assert.deepEqual(request.payload.state, state);
});

test("protocol 1.9 transport serializes hostile property path as data", async () => {
  let captured = "";
  const request = buildSpatialGraphRequestV19({
    requestId: "REQ_SPATIAL_ESCAPE", transactionId: "TX_SPATIAL_ESCAPE", operationId: "OP_SPATIAL_ESCAPE",
    command: "property.spatial_graph.readback", expectedHostProjectRevision: null,
    payload: { comp: { stableId: "COMP" }, layer: { stableId: "LAYER" }, propertyPath: ["\"); app.quit(); //"], keyIndex: 1 },
  });
  const bridge = { evalScript(script, callback) { captured = script; callback(JSON.stringify({ protocolVersion: "1.9.0", requestId: request.requestId, transactionId: request.transactionId, operationId: request.operationId, capabilityId: request.capabilityId, command: request.command, outcome: "NO_OP", error: null, affectedObjects: [], readback: {}, hostProjectRevision: 1, diagnostics: { adapterProtocolVersion: "1.9.0", adapterBuild: "0.4.0-dev.9", command: request.command, notes: [] } })); } };
  assert.equal((await new CepEvalScriptSpatialGraphTransportV19(bridge).dispatch(request)).outcome, "NO_OP");
  assert.ok(captured.startsWith("EditFlow2_dispatch(\"") && captured.endsWith("\")"));
  assert.equal((captured.match(/EditFlow2_dispatch/g) ?? []).length, 1);
  assert.ok(!captured.includes("); app.quit(); //\")"));
});

test("host encodes dimensionality, endpoint-roving, host-owned Auto-Bezier, readback and rollback guards", async () => {
  const source = await readFile(hostPath, "utf8");
  for (const method of ["keyInSpatialTangent", "keyOutSpatialTangent", "keySpatialContinuous", "keySpatialAutoBezier", "keyRoving", "setSpatialTangentsAtKey", "setSpatialContinuousAtKey", "setSpatialAutoBezierAtKey", "setRovingAtKey"]) {
    assert.match(source, new RegExp(`\\.${method}\\(`));
  }
  assert.match(source, /PropertyValueType\.TwoD_SPATIAL/);
  assert.match(source, /PropertyValueType\.ThreeD_SPATIAL/);
  assert.match(source, /SPATIAL_TANGENT_DIMENSION_MISMATCH/);
  assert.match(source, /ROVING_ENDPOINT_FORBIDDEN/);
  assert.match(source, /AUTO_BEZIER_TANGENTS_FORBIDDEN/);
  assert.match(source, /requested\.mode === "AUTO_BEZIER"/);
  assert.match(source, /SPATIAL_GRAPH_READBACK_MISMATCH/);
  assert.match(source, /SPATIAL_GRAPH_ROLLBACK_READBACK_MISMATCH/);
  assert.match(source, /HOST_REVISION_CONFLICT/);
  assert.match(source, /app\.beginUndoGroup/);
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.doesNotThrow(() => new vm.Script(source, { filename: hostPath }));
});

test("v19 loader is additive over accepted v18 and fails closed for protocol 1.9", async () => {
  const source = await readFile(loaderPath, "utf8");
  assert.match(source, /editflow_host_current_v18\.jsx/);
  assert.match(source, /editflow_host_m3_spatial_graph\.jsx/);
  assert.match(source, /M3_SPATIAL_GRAPH_MODULE_LOAD_FAILED/);
  assert.match(source, /request\.protocolVersion === "1\.9\.0"/);
  assert.match(source, /EditFlow2_HOST_PROTOCOL_19 = true/);
  assert.doesNotThrow(() => new vm.Script(source, { filename: loaderPath }));
});
