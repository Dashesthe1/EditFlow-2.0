import test from "node:test";
import assert from "node:assert/strict";

import {
  GuardedRotoBrushRefineEdgeControllerV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-roto-brush-refine-edge-controller.js";

const target = {
  compHostId: 10,
  layerHostId: 20,
  expectedCompName: "Roto Proof",
  expectedLayerName: "Subject",
};
const stroke = {
  role: "REFINE_EDGE",
  pointsNormalized: [{ x: 0.31, y: 0.24 }, { x: 0.34, y: 0.30 }, { x: 0.36, y: 0.36 }],
  radiusNormalized: 0.02,
};
const atom = (name, value) => ({
  index: 1, name, matchName: "ADBE Paint Atom", propertyType: 2, propertyValueType: null,
  numProperties: 0, numKeys: 0, canSetExpression: false, expressionEnabled: null, value, children: [],
});
const property = (refine = false, value = "seed") => ({
  index: 1, name: "Strokes", matchName: "ADBE Samurai Strokes Group", propertyType: 1, propertyValueType: 1,
  numProperties: refine ? 2 : 1, numKeys: 0, canSetExpression: false, expressionEnabled: null, value: null,
  children: refine ? [atom("Foreground 1", "seed"), atom("Edge Refinement 1", value)] : [atom("Foreground 1", value)],
});
const readbackValue = ({ effect = true, refine = false, value = "seed", compName = "Roto Proof", layerName = "Subject", truncated = false, effectCount = effect ? 1 : 0 } = {}) => ({
  comp: { stableId: "COMP", hostId: 10, name: compName, width: 1920, height: 1080, time: 0.5 },
  layer: { stableId: "LAYER", hostId: 20, name: layerName, index: 1, time: 0.5 },
  rotoBrushMatchName: "ADBE Samurai",
  effectMatchCount: effectCount,
  effect: effect ? { effectIndex: 1, name: "Roto Brush & Refine Edge", matchName: "ADBE Samurai", enabled: true, numProperties: 1, properties: [property(refine, value)] } : null,
  propertyNodeCount: effect ? (refine ? 3 : 2) : 0,
  propertyTreeTruncated: truncated,
});
const response = (readback, hostProjectRevision = 10) => ({
  protocolVersion: "2.6.0", requestId: "IGNORED", transactionId: "IGNORED", operationId: "IGNORED",
  capabilityId: "ae.roto_brush.session.inspect", command: "roto_brush.readback", outcome: "NO_OP", error: null,
  affectedObjects: [], readback, hostProjectRevision,
  diagnostics: { adapterProtocolVersion: "2.6.0", adapterBuild: "0.6.0-dev.2", command: "roto_brush.readback", notes: [] },
});
const transport = (values) => {
  let index = 0;
  return { calls: [], async dispatch(request) { this.calls.push(request); const next = values[Math.min(index, values.length - 1)]; index += 1; return { ...next, requestId: request.requestId, transactionId: request.transactionId, operationId: request.operationId }; } };
};
const driver = (overrides = {}) => ({
  driverId: "TEST_REFINE_DRIVER",
  verifiedVision: true,
  verifiedCursorControl: true,
  supportsRefineEdge: true,
  calls: [],
  async refine(input) { this.calls.push(input); return { status: "COMPLETED", visualEvidenceId: "REFINE_VISUAL_1", aeActionToActionLatenciesMs: [80, 85, 190], ...overrides.result }; },
  ...overrides,
});
const runInput = (overrides = {}) => ({
  ...target,
  atTime: 0.5,
  stroke,
  evidenceIds: ["M5:ROTO:REFINE:001"],
  ...overrides,
});

test("Refine Edge binds exact native Roto state and accepts only a new native Refine Edge stroke", async () => {
  const io = transport([
    response(readbackValue({ effect: true, refine: false, value: "seed" }), 10),
    response(readbackValue({ effect: true, refine: true, value: "refine-1" }), 11),
  ]);
  const visual = driver();
  const result = await new GuardedRotoBrushRefineEdgeControllerV1(io, visual).run(runInput());
  assert.equal(result.route, "LOCAL");
  assert.equal(result.escalationReason, null);
  assert.equal(io.calls.length, 2);
  assert.equal(visual.calls.length, 1);
  assert.equal(visual.calls[0].operation, "REFINE_EDGE");
  assert.equal(visual.calls[0].expectedTool, "REFINE_EDGE");
  assert.equal(visual.calls[0].expectedEffectMatchCount, 1);
  assert.match(visual.calls[0].expectedSessionRevision, /^ROTO_V26_/);
  assert.match(visual.calls[0].expectedEffectFingerprint, /^ROTO_EFFECT_V26_/);
  assert.equal(result.baselineRefineEdgeStrokeCount, 0);
  assert.equal(result.finalRefineEdgeStrokeCount, 1);
  assert.deepEqual(result.aeActionToActionLatenciesMs, [80, 85, 190]);
});

test("Refine Edge refuses before visual action unless exactly one native Roto effect already exists", async () => {
  const visual = driver();
  const result = await new GuardedRotoBrushRefineEdgeControllerV1(
    transport([response(readbackValue({ effect: false }), 10)]), visual,
  ).run(runInput());
  assert.equal(result.escalationReason, "AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE");
  assert.equal(visual.calls.length, 0);
});

test("missing or unverified Refine Edge visual driver stops after pre-readback", async () => {
  const before = response(readbackValue({ effect: true }), 10);
  const ioMissing = transport([before]);
  const missing = await new GuardedRotoBrushRefineEdgeControllerV1(ioMissing, null).run(runInput());
  assert.equal(missing.escalationReason, "VISUAL_DRIVER_UNAVAILABLE");
  assert.equal(ioMissing.calls.length, 1);
  const visual = driver({ supportsRefineEdge: false });
  const result = await new GuardedRotoBrushRefineEdgeControllerV1(transport([before]), visual).run(runInput());
  assert.equal(result.escalationReason, "VISUAL_DRIVER_UNAVAILABLE");
  assert.equal(visual.calls.length, 0);
});

test("Refine Edge visual refusal never performs post-action readback", async () => {
  const io = transport([response(readbackValue({ effect: true }), 10)]);
  const visual = driver({ result: { status: "REFUSED", visualEvidenceId: "REFUSED_FRAME" } });
  const result = await new GuardedRotoBrushRefineEdgeControllerV1(io, visual).run(runInput());
  assert.equal(result.escalationReason, "VISUAL_ACTION_REFUSED");
  assert.equal(io.calls.length, 1);
  assert.equal(result.visualEvidenceId, "REFUSED_FRAME");
});

test("native effect mutation without a new Refine Edge paint atom fails closed", async () => {
  const before = response(readbackValue({ effect: true, value: "seed" }), 10);
  const after = response(readbackValue({ effect: true, value: "changed-but-no-refine" }), 11);
  const result = await new GuardedRotoBrushRefineEdgeControllerV1(transport([before, after]), driver()).run(runInput());
  assert.equal(result.escalationReason, "NATIVE_REFINE_EDGE_STROKE_NOT_OBSERVED");
  assert.equal(result.finalRefineEdgeStrokeCount, 0);
});

test("host revision drift alone cannot satisfy Refine Edge native change verification", async () => {
  const before = response(readbackValue({ effect: true, value: "same" }), 10);
  const after = response(readbackValue({ effect: true, value: "same" }), 11);
  const result = await new GuardedRotoBrushRefineEdgeControllerV1(transport([before, after]), driver()).run(runInput());
  assert.equal(result.escalationReason, "NATIVE_ROTO_CHANGE_NOT_OBSERVED");
  assert.notEqual(result.baselineSessionRevision, result.finalSessionRevision);
  assert.equal(result.baselineEffectFingerprint, result.finalEffectFingerprint);
});

test("post-action target drift fails closed", async () => {
  const before = response(readbackValue({ effect: true }), 10);
  const drift = response(readbackValue({ effect: true, refine: true, layerName: "Other" }), 11);
  const result = await new GuardedRotoBrushRefineEdgeControllerV1(transport([before, drift]), driver()).run(runInput());
  assert.equal(result.escalationReason, "POST_TARGET_DRIFT");
});

test("truncated native Roto readback refuses before Refine Edge visual action", async () => {
  const visual = driver();
  const result = await new GuardedRotoBrushRefineEdgeControllerV1(
    transport([response(readbackValue({ effect: true, truncated: true }), 10)]), visual,
  ).run(runInput());
  assert.equal(result.escalationReason, "AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE");
  assert.equal(visual.calls.length, 0);
});