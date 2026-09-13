import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AE_STABILIZATION_ADAPTER_BUILD_V23,
  AE_STABILIZATION_COMMANDS_V23,
  AE_STABILIZATION_PROTOCOL_VERSION_V23,
  AE_STABILIZATION_ROUTE_ID_V23,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v2_3.js";
import {
  CepEvalScriptStabilizationTransportV23,
  GuardedStabilizationControllerV1,
  M4_STABILIZATION_GUARDED_CAPABILITY_V1,
  M4_STABILIZATION_READBACK_CAPABILITIES_V23,
  buildStabilizationRequestV23,
  capabilityForStabilizationDriverV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-stabilization.js";

const property = (name, matchName, keyCount = 0) => ({
  name, matchName, keyCount,
  samples: Array.from({ length: keyCount }, (_, i) => ({ time: 5 + i / 30, value: [540 + i, 540 - i, 0] })),
});
const readback = ({ trackerKeys = 0, anchorKeys = 0 } = {}) => ({
  comp: { stableId: null, hostId: 14, name: "Stabilize Comp", width: 1080, height: 1080 },
  layer: { stableId: "STAB_LAYER", hostId: 26, name: "Stabilize Target", index: 1 },
  trackers: trackerKeys ? [{ trackerIndex: 1, name: "Tracker 1", matchName: "ADBE MTracker", pointIndex: 1, pointName: "Track Point 1", featureCenterKeyCount: trackerKeys, confidenceKeyCount: trackerKeys, attachPointKeyCount: trackerKeys }] : [],
  transform: {
    anchorPoint: property("Anchor Point", "ADBE Anchor Point", anchorKeys),
    position: property("Position", "ADBE Position", 0),
    scale: property("Scale", "ADBE Scale", 0),
    rotation: property("Rotation", "ADBE Rotate Z", 0),
  },
});
const transport = (...reads) => ({ calls: [], async dispatch(request) { this.calls.push(request); return { readback: reads.shift() ?? null }; } });
const input = { compHostId: 14, layerHostId: 26, expectedCompName: "Stabilize Comp", expectedLayerName: "Stabilize Target", direction: "FORWARD" };
const driver = {
  driverId: "STAB_VIS", verifiedVision: true, verifiedCursorControl: true, supportedDirections: ["FORWARD"],
  async stabilize(request) { assert.equal(request.expectedControl, "STABILIZE_ANALYZE_APPLY_FORWARD"); return { status: "COMPLETED", visualEvidenceId: "STAB_EVIDENCE" }; },
};

test("M4 stabilization protocol 2.3 is read-only and stabilization-specific", () => {
  assert.equal(AE_STABILIZATION_PROTOCOL_VERSION_V23, "2.3.0");
  assert.equal(AE_STABILIZATION_ADAPTER_BUILD_V23, "0.5.0-dev.1");
  assert.equal(AE_STABILIZATION_ROUTE_ID_V23, "ae-cep.stabilization.v2_3");
  assert.deepEqual([...AE_STABILIZATION_COMMANDS_V23], ["stabilization.readback"]);
  assert.equal(M4_STABILIZATION_READBACK_CAPABILITIES_V23[0].id, "ae.stabilization.readback");
  assert.equal(M4_STABILIZATION_READBACK_CAPABILITIES_V23[0].riskClass, "R0_READ_ONLY");
  assert.equal(M4_STABILIZATION_GUARDED_CAPABILITY_V1.routes[0].available, false);
});

test("protocol 2.3 transport serializes the stabilization target in one dispatcher call", async () => {
  let captured = "";
  const request = buildStabilizationRequestV23({ requestId: "REQ_STAB", transactionId: "TX_STAB", operationId: "OP_STAB", command: "stabilization.readback", payload: { comp: { hostId: 14 }, layer: { hostId: 26 } } });
  const bridge = { evalScript(script, callback) { captured = script; callback(JSON.stringify({ protocolVersion: "2.3.0", requestId: "REQ_STAB", transactionId: "TX_STAB", operationId: "OP_STAB", capabilityId: "ae.stabilization.readback", command: "stabilization.readback", outcome: "NO_OP", error: null, affectedObjects: [], readback: readback(), hostProjectRevision: 1, diagnostics: { adapterProtocolVersion: "2.3.0", adapterBuild: "0.5.0-dev.1", command: "stabilization.readback", notes: [] } })); } };
  const response = await new CepEvalScriptStabilizationTransportV23(bridge).dispatch(request);
  assert.equal(response.outcome, "NO_OP");
  assert.equal((captured.match(/EditFlow2_dispatch/g) ?? []).length, 1);
});

test("guarded stabilization fails closed without target truth, verified driver, or post-action compensation", async () => {
  assert.equal((await new GuardedStabilizationControllerV1(transport(null), driver).run(input)).escalationReason, "STABILIZATION_TARGET_UNAVAILABLE");
  assert.equal((await new GuardedStabilizationControllerV1(transport(readback()), null).run(input)).escalationReason, "VISUAL_DRIVER_UNAVAILABLE");
  const missed = await new GuardedStabilizationControllerV1(transport(readback(), readback({ trackerKeys: 50, anchorKeys: 0 })), driver).run(input);
  assert.equal(missed.escalationReason, "STABILIZATION_NOT_OBSERVED");
});

test("native position stabilization succeeds only when tracker samples and Anchor Point compensation both grow", async () => {
  const result = await new GuardedStabilizationControllerV1(transport(readback(), readback({ trackerKeys: 50, anchorKeys: 50 })), driver).run(input);
  assert.equal(result.route, "LOCAL");
  assert.equal(result.finalTrackerKeyCount, 50);
  assert.equal(result.finalAnchorKeyCount, 50);
  assert.equal(result.visualEvidenceId, "STAB_EVIDENCE");
  assert.equal(capabilityForStabilizationDriverV1(driver).routes[0].available, true);
});

test("Backward stabilization remains unregistered without retained evidence", async () => {
  let actions = 0;
  const forwardOnly = { ...driver, async stabilize() { actions += 1; return { status: "COMPLETED" }; } };
  const result = await new GuardedStabilizationControllerV1(transport(readback()), forwardOnly).run({ ...input, direction: "BACKWARD" });
  assert.equal(result.escalationReason, "ANALYSIS_DIRECTION_UNPROVEN");
  assert.equal(actions, 0);
});

test("protocol 2.3 host reads tracker and transform keys but never mutates AE", async () => {
  const source = await readFile("packages/adapters/ae-cep/host/editflow_host_m4_stabilization.jsx", "utf8");
  for (const token of ["ADBE MTrackers", "ADBE MTracker Pt Feature Center", "ADBE Anchor Point", "ADBE Position", "ADBE Scale", "ADBE Rotate Z", "property.keyValue(i)", "property.keyTime(i)"]) assert.ok(source.includes(token), `host missing ${token}`);
  for (const mutation of ["addProperty(", "executeCommand(", "beginUndoGroup(", "setValue(", "setValueAtTime("]) assert.equal(source.includes(mutation), false, `host unexpectedly contains ${mutation}`);
});

test("v23 loader is additive over v22 and fails closed only for protocol 2.3", async () => {
  const source = await readFile("packages/adapters/ae-cep/host/editflow_host_current_v23.jsx", "utf8");
  assert.ok(source.includes("editflow_host_current_v22.jsx"));
  assert.ok(source.includes("editflow_host_m4_stabilization.jsx"));
  assert.ok(source.includes("M4_STABILIZATION_MODULE_LOAD_FAILED"));
  assert.ok(source.includes('request.protocolVersion === "2.3.0"'));
  assert.ok(source.includes("EditFlow2_HOST_PROTOCOL_23 = true"));
});
