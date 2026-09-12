import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AE_FACE_TRACKING_ADAPTER_BUILD_V22,
  AE_FACE_TRACKING_COMMANDS_V22,
  AE_FACE_TRACKING_PROTOCOL_VERSION_V22,
  AE_FACE_TRACKING_ROUTE_ID_V22,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v2_2.js";
import {
  CepEvalScriptFaceTrackingTransportV22,
  GuardedFaceTrackingControllerV1,
  M4_FACE_READBACK_CAPABILITIES_V22,
  M4_FACE_TRACKING_CAPABILITY_V1,
  buildFaceTrackingRequestV22,
  capabilityForFaceTrackingDriverV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-face-tracking.js";

const prop = (name, count = 3, dimensions = 2) => ({
  propertyIndex: 1,
  name,
  matchName: `Pseudo/ADBE Animal Head66-${name.replace(/\W/g, "")}`,
  valueDimensions: dimensions,
  keyedSampleCount: count,
  samples: Array.from({ length: count }, (_, i) => ({ time: 5 + i / 30, value: dimensions === 1 ? i : Array(dimensions).fill(i) })),
});
const readback = ({ maskKeys = 0, face = null, stableId = "FACE_MASK" } = {}) => ({
  comp: { stableId: null, hostId: 10, name: "Face Comp", width: 1080, height: 1080 },
  layer: { stableId: "FACE_LAYER", hostId: 20, name: "Face Layer", index: 1 },
  mask: { stableId, name: "Face Mask", pathKeyCount: maskKeys, lastPathKeyTime: maskKeys ? 5 + (maskKeys - 1) / 30 : null },
  faceTrackPoints: face,
});
const faceTruth = (count = 3) => {
  const properties = ["Left Eye Inner", "Right Eye Inner", "Nose Tip", "Mouth Left", "Chin"].map((name) => prop(name, count));
  return {
    effectIndex: 1,
    name: "Face Track Points",
    matchName: "Pseudo/ADBE Animal Head66",
    keyedPropertyCount: properties.length,
    maxKeyCount: count,
    properties,
  };
};
const transport = (...reads) => ({
  calls: [],
  async dispatch(request) {
    this.calls.push(request);
    return { readback: reads.shift() ?? null };
  },
});
const input = {
  compHostId: 10,
  layerHostId: 20,
  maskStableId: "FACE_MASK",
  expectedCompName: "Face Comp",
  expectedLayerName: "Face Layer",
  direction: "FORWARD",
};
const forwardDriver = {
  driverId: "FACE_VIS",
  verifiedVision: true,
  verifiedCursorControl: true,
  supportedDirections: ["FORWARD"],
  async analyze(request) {
    assert.equal(request.expectedControl, "FACE_ANALYZE_FORWARD");
    assert.equal(request.expectedMaskName, "Face Mask");
    return { status: "COMPLETED", visualEvidenceId: "FACE_VIS_1" };
  },
};

test("M4 Detailed Face Tracking protocol 2.2 is a read-only face-specific surface", () => {
  assert.equal(AE_FACE_TRACKING_PROTOCOL_VERSION_V22, "2.2.0");
  assert.equal(AE_FACE_TRACKING_ADAPTER_BUILD_V22, "0.5.0-dev.1");
  assert.equal(AE_FACE_TRACKING_ROUTE_ID_V22, "ae-cep.face-tracking.v2_2");
  assert.deepEqual([...AE_FACE_TRACKING_COMMANDS_V22], ["face.readback"]);
  assert.equal(M4_FACE_READBACK_CAPABILITIES_V22[0].id, "ae.face.readback");
  assert.equal(M4_FACE_READBACK_CAPABILITIES_V22[0].riskClass, "R0_READ_ONLY");
  assert.equal(M4_FACE_TRACKING_CAPABILITY_V1.routes[0].available, false);
});

test("protocol 2.2 transport serializes the face target as data in one dispatcher call", async () => {
  let captured = "";
  const request = buildFaceTrackingRequestV22({
    requestId: "REQ_FACE", transactionId: "TX_FACE", operationId: "OP_FACE", command: "face.readback",
    payload: { comp: { hostId: 10 }, layer: { hostId: 20 }, mask: { stableId: "FACE_MASK\"); evil() //" } },
  });
  const bridge = { evalScript(script, callback) {
    captured = script;
    callback(JSON.stringify({
      protocolVersion: "2.2.0", requestId: "REQ_FACE", transactionId: "TX_FACE", operationId: "OP_FACE",
      capabilityId: "ae.face.readback", command: "face.readback", outcome: "NO_OP", error: null,
      affectedObjects: [], readback: readback(), hostProjectRevision: 0,
      diagnostics: { adapterProtocolVersion: "2.2.0", adapterBuild: "0.5.0-dev.1", command: "face.readback", notes: [] },
    }));
  } };
  const response = await new CepEvalScriptFaceTrackingTransportV22(bridge).dispatch(request);
  assert.equal(response.outcome, "NO_OP");
  assert.equal((captured.match(/EditFlow2_dispatch/g) ?? []).length, 1);
  assert.ok(captured.startsWith("EditFlow2_dispatch(\"") && captured.endsWith("\")"));
});

test("Detailed Face Tracking refuses to act without typed face target/readback or verified driver", async () => {
  assert.equal((await new GuardedFaceTrackingControllerV1(transport(null), forwardDriver).run(input)).escalationReason, "FACE_TARGET_UNAVAILABLE");
  const t = transport(readback());
  const result = await new GuardedFaceTrackingControllerV1(t, null).run(input);
  assert.equal(result.escalationReason, "VISUAL_DRIVER_UNAVAILABLE");
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].command, "face.readback");
  assert.equal(t.calls[0].payload.mask.stableId, "FACE_MASK");
});

test("a visual click cannot masquerade as Detailed Face Tracking without native facial-point truth", async () => {
  const result = await new GuardedFaceTrackingControllerV1(
    transport(readback(), readback({ maskKeys: 10, face: null })),
    forwardDriver,
  ).run(input);
  assert.equal(result.route, "ESCALATE");
  assert.equal(result.escalationReason, "ANALYSIS_NOT_OBSERVED");
  assert.equal(result.visualEvidenceId, "FACE_VIS_1");
});

test("Detailed Face Tracking succeeds only after mask growth plus keyed facial landmarks", async () => {
  const result = await new GuardedFaceTrackingControllerV1(
    transport(readback(), readback({ maskKeys: 21, face: faceTruth(21) })),
    forwardDriver,
  ).run(input);
  assert.equal(result.route, "LOCAL");
  assert.equal(result.baselineMaskPathKeyCount, 0);
  assert.equal(result.finalMaskPathKeyCount, 21);
  assert.equal(result.finalFaceKeyedPropertyCount, 5);
  assert.equal(result.finalFaceMaxKeyCount, 21);
  assert.equal(result.finalLandmarkKeyedPropertyCount, 5);
  assert.equal(result.visualEvidenceId, "FACE_VIS_1");
});

test("an existing Detailed Face Track can be extended without inventing new landmark properties", async () => {
  const beforeFace = faceTruth(8);
  const afterFace = faceTruth(15);
  const result = await new GuardedFaceTrackingControllerV1(
    transport(readback({ maskKeys: 8, face: beforeFace }), readback({ maskKeys: 15, face: afterFace })),
    forwardDriver,
  ).run(input);
  assert.equal(result.route, "LOCAL");
  assert.equal(result.baselineFaceKeyedPropertyCount, result.finalFaceKeyedPropertyCount);
  assert.equal(result.baselineFaceMaxKeyCount, 8);
  assert.equal(result.finalFaceMaxKeyCount, 15);
});

test("Forward-only retained proof promotes only the guarded Detailed Features route", async () => {
  const capability = capabilityForFaceTrackingDriverV1(forwardDriver);
  assert.equal(capability.status, "PARTIAL");
  assert.equal(capability.proofMaturity, "VISUAL");
  assert.equal(capability.routes[0].available, true);
  let actions = 0;
  const driver = { ...forwardDriver, async analyze() { actions += 1; return { status: "COMPLETED" }; } };
  const result = await new GuardedFaceTrackingControllerV1(transport(readback()), driver).run({ ...input, direction: "BACKWARD" });
  assert.equal(result.escalationReason, "ANALYSIS_DIRECTION_UNPROVEN");
  assert.equal(actions, 0);
});

test("protocol 2.2 host reads only the exact Face Track Points effect and never starts analysis", async () => {
  const source = await readFile("packages/adapters/ae-cep/host/editflow_host_m4_face_tracking.jsx", "utf8");
  for (const token of [
    'var FACE_EFFECT_NAME = "Face Track Points"',
    'var FACE_EFFECT_MATCH = "Pseudo/ADBE Animal Head66"',
    'layer.property("ADBE Mask Parade")',
    'layer.property("ADBE Effect Parade")',
    "p.keyValue(j)",
    "p.keyTime(j)",
    "MASK_PREFIX",
  ]) assert.ok(source.includes(token), `host missing ${token}`);
  assert.equal(source.includes("addProperty("), false);
  assert.equal(source.includes("executeCommand("), false);
  assert.equal(source.includes("beginUndoGroup("), false);
  assert.equal(source.includes("setValue("), false);
});

test("v22 loader is additive over v21 and fails closed only for protocol 2.2", async () => {
  const source = await readFile("packages/adapters/ae-cep/host/editflow_host_current_v22.jsx", "utf8");
  assert.ok(source.includes("editflow_host_current_v21.jsx"));
  assert.ok(source.includes("editflow_host_m4_face_tracking.jsx"));
  assert.ok(source.includes("M4_FACE_TRACKING_MODULE_LOAD_FAILED"));
  assert.ok(source.includes('request.protocolVersion === "2.2.0"'));
  assert.ok(source.includes("EditFlow2_HOST_PROTOCOL_22 = true"));
});
