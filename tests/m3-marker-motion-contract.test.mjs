import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import {
  AE_MARKER_MOTION_ADAPTER_BUILD_V20,
  AE_MARKER_MOTION_COMMANDS_V20,
  AE_MARKER_MOTION_PROTOCOL_VERSION_V20,
  AE_MARKER_MOTION_ROUTE_ID_V20,
  capabilityForMarkerMotionCommandV20,
  isAeMarkerMotionCommandV20,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v2_0.js";
import {
  CepEvalScriptMarkerMotionTransportV20,
  M3_MARKER_MOTION_CAPABILITIES_V20,
  buildMarkerMotionRequestV20,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-marker-motion.js";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_marker_motion.jsx";
const loaderPath = "packages/adapters/ae-cep/host/editflow_host_current_v20.jsx";

test("M3 marker-motion protocol 2.0 is bounded and remains unpromoted", () => {
  assert.equal(AE_MARKER_MOTION_PROTOCOL_VERSION_V20, "2.0.0");
  assert.equal(AE_MARKER_MOTION_ADAPTER_BUILD_V20, "0.4.0-dev.10");
  assert.equal(AE_MARKER_MOTION_ROUTE_ID_V20, "ae-cep.marker-motion.v2_0");
  assert.deepEqual([...AE_MARKER_MOTION_COMMANDS_V20], [
    "marker.set", "marker.remove", "marker.readback",
    "comp.motion.set", "comp.motion.readback",
    "layer.motion.set", "layer.motion.readback",
  ]);
  assert.equal(isAeMarkerMotionCommandV20("comp.motion.set"), true);
  assert.equal(isAeMarkerMotionCommandV20("property.spatial_graph.set"), false);
  assert.equal(capabilityForMarkerMotionCommandV20("layer.motion.set"), "ae.layer.motion.set");
  assert.equal(M3_MARKER_MOTION_CAPABILITIES_V20.length, 7);
  for (const capability of M3_MARKER_MOTION_CAPABILITIES_V20) {
    assert.equal(capability.status, "PARTIAL");
    assert.equal(capability.proofMaturity, "DECLARED");
    assert.equal(capability.routes[0].routeId, AE_MARKER_MOTION_ROUTE_ID_V20);
    assert.equal(capability.fallbackPolicy, "FORBID");
  }
});

test("request builder preserves marker and motion payloads exactly", () => {
  const marker = { comment: "Impact", duration: 0.5, label: 9, protectedRegion: true, parameters: { role: "accent" } };
  const request = buildMarkerMotionRequestV20({
    requestId: "REQ_MM", transactionId: "TX_MM", operationId: "OP_MM", command: "marker.set", expectedHostProjectRevision: 12,
    payload: { target: { kind: "COMP", comp: { stableId: "COMP" } }, time: 1.25, marker },
  });
  assert.equal(request.protocolVersion, "2.0.0");
  assert.equal(request.capabilityId, "ae.marker.set");
  assert.equal(request.readbackProfile, "M3_MARKER_MOTION_STRUCTURAL");
  assert.deepEqual(request.payload.marker, marker);
});

test("protocol 2.0 transport serializes hostile marker text as data", async () => {
  let captured = "";
  const request = buildMarkerMotionRequestV20({
    requestId: "REQ_ESCAPE", transactionId: "TX_ESCAPE", operationId: "OP_ESCAPE", command: "marker.set", expectedHostProjectRevision: 2,
    payload: { target: { kind: "COMP", comp: { stableId: "COMP" } }, time: 0, marker: { comment: "\"); app.quit(); //" } },
  });
  const bridge = { evalScript(script, callback) { captured = script; callback(JSON.stringify({ protocolVersion: "2.0.0", requestId: request.requestId, transactionId: request.transactionId, operationId: request.operationId, capabilityId: request.capabilityId, command: request.command, outcome: "NO_OP", error: null, affectedObjects: [], readback: {}, hostProjectRevision: 2, diagnostics: { adapterProtocolVersion: "2.0.0", adapterBuild: "0.4.0-dev.10", command: request.command, notes: [] } })); } };
  assert.equal((await new CepEvalScriptMarkerMotionTransportV20(bridge).dispatch(request)).outcome, "NO_OP");
  assert.equal((captured.match(/EditFlow2_dispatch/g) ?? []).length, 1);
  assert.ok(captured.startsWith("EditFlow2_dispatch(\"") && captured.endsWith("\")"));
  assert.ok(!captured.includes("); app.quit(); //\")"));
});

test("host uses native AE marker, motion blur, frame blending and shutter surfaces with guards", async () => {
  const source = await readFile(hostPath, "utf8");
  for (const token of [
    "new MarkerValue", ".markerProperty", ".marker", ".setValueAtTime(", ".removeKey(",
    ".motionBlur", ".frameBlending", ".frameBlendingType", ".shutterAngle", ".shutterPhase",
    ".motionBlurSamplesPerFrame", ".motionBlurAdaptiveSampleLimit",
    "FrameBlendingType.FRAME_MIX", "FrameBlendingType.PIXEL_MOTION", "FrameBlendingType.NO_FRAME_BLEND",
  ]) assert.ok(source.includes(token), `missing host surface ${token}`);
  for (const guard of [
    "HOST_REVISION_CONFLICT", "SHUTTER_ANGLE_INVALID", "SHUTTER_PHASE_INVALID", "MOTION_SAMPLES_INVALID",
    "MOTION_ADAPTIVE_LIMIT_INVALID", "LAYER_PROTECTED_REGION_FORBIDDEN", "COMP_MOTION_READBACK_MISMATCH",
    "LAYER_MOTION_READBACK_MISMATCH", "COMP_MOTION_ROLLBACK_READBACK_MISMATCH", "LAYER_MOTION_ROLLBACK_READBACK_MISMATCH",
    "M3_MARKER_MOTION_P4_FAILURE_INJECTION", "M3_MARKER_MOTION_P4_INDUCED_FAILURE", "MARKER_MOTION_ROLLBACK_FAILED",
  ]) assert.ok(source.includes(guard), `missing host guard ${guard}`);
  assert.match(source, /app\.beginUndoGroup/);
  assert.match(source, /app\.executeCommand\(16\)/);
  assert.match(source, /EDITFLOW_M3_MARKER_MOTION_P4_PROOF/);
  assert.match(source, /rolled back through the transaction undo boundary/);
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.doesNotThrow(() => new vm.Script(source, { filename: hostPath }));
});

test("v20 loader is additive over accepted v19 and fails closed for protocol 2.0", async () => {
  const source = await readFile(loaderPath, "utf8");
  assert.match(source, /editflow_host_current_v19\.jsx/);
  assert.match(source, /editflow_host_m3_marker_motion\.jsx/);
  assert.match(source, /M3_MARKER_MOTION_MODULE_LOAD_FAILED/);
  assert.match(source, /request\.protocolVersion === "2\.0\.0"/);
  assert.match(source, /EditFlow2_HOST_PROTOCOL_20 = true/);
  assert.doesNotThrow(() => new vm.Script(source, { filename: loaderPath }));
});