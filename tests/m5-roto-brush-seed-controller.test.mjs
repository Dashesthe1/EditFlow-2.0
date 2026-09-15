import test from "node:test";
import assert from "node:assert/strict";

import {
  GuardedRotoBrushSeedControllerV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-roto-brush-seed-controller.js";
import {
  deriveRotoBrushEffectFingerprintV26,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-roto-brush-readback.js";

const target = {
  compHostId: 10,
  layerHostId: 20,
  expectedCompName: "Roto Proof",
  expectedLayerName: "Subject",
};
const stroke = {
  role: "FOREGROUND",
  pointsNormalized: [{ x: 0.4, y: 0.35 }, { x: 0.45, y: 0.42 }],
  radiusNormalized: 0.03,
};
const property = (value) => ({
  index: 1, name: "Strokes", matchName: "ADBE Roto Brush Strokes", propertyType: 1, propertyValueType: 1,
  numProperties: 0, numKeys: 0, canSetExpression: false, expressionEnabled: null, value, children: [],
});
const readbackValue = ({ effect = false, value = null, compName = "Roto Proof", layerName = "Subject", truncated = false, effectCount = effect ? 1 : 0 } = {}) => ({
  comp: { stableId: "COMP", hostId: 10, name: compName, width: 1920, height: 1080, time: 0.25 },
  layer: { stableId: "LAYER", hostId: 20, name: layerName, index: 1 },
  rotoBrushMatchName: "ADBE Samurai",
  effectMatchCount: effectCount,
  effect: effect ? { effectIndex: 1, name: "Roto Brush & Refine Edge", matchName: "ADBE Samurai", enabled: true, numProperties: 1, properties: [property(value)] } : null,
  propertyNodeCount: effect ? 1 : 0,
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
  driverId: "TEST_ROTO_DRIVER",
  verifiedVision: true,
  verifiedCursorControl: true,
  supportedRoles: ["FOREGROUND", "BACKGROUND"],
  calls: [],
  async seed(input) { this.calls.push(input); return { status: "COMPLETED", visualEvidenceId: "VISUAL_1", aeActionToActionLatenciesMs: [120, 180], ...overrides.result }; },
  ...overrides,
});
const runInput = (overrides = {}) => ({
  operation: "SEED_FOREGROUND",
  ...target,
  atTime: 0.25,
  stroke,
  evidenceIds: ["M5:ROTO:SEED:001"],
  ...overrides,
});

test("effect fingerprint ignores host revision but changes with native Roto property truth", () => {
  const first = response(readbackValue({ effect: true, value: "A" }), 10);
  const hostOnly = response(readbackValue({ effect: true, value: "A" }), 11);
  const changed = response(readbackValue({ effect: true, value: "B" }), 11);
  assert.equal(deriveRotoBrushEffectFingerprintV26(first), deriveRotoBrushEffectFingerprintV26(hostOnly));
  assert.notEqual(deriveRotoBrushEffectFingerprintV26(first), deriveRotoBrushEffectFingerprintV26(changed));
  assert.throws(() => deriveRotoBrushEffectFingerprintV26(response(readbackValue({ effect: true, value: "A", truncated: true }), 10)), /truncated/);
});

test("foreground seed binds typed pre-readback, one visual action, and changed native Roto truth", async () => {
  const io = transport([
    response(readbackValue({ effect: false }), 10),
    response(readbackValue({ effect: true, value: "stroke-1" }), 11),
  ]);
  const visual = driver();
  const result = await new GuardedRotoBrushSeedControllerV1(io, visual).run(runInput());
  assert.equal(result.route, "LOCAL");
  assert.equal(result.escalationReason, null);
  assert.equal(io.calls.length, 2);
  assert.equal(visual.calls.length, 1);
  assert.equal(visual.calls[0].expectedEffectMatchCount, 0);
  assert.equal(visual.calls[0].expectedTool, "ROTO_BRUSH");
  assert.match(visual.calls[0].expectedSessionRevision, /^ROTO_V26_/);
  assert.deepEqual(result.aeActionToActionLatenciesMs, [120, 180]);
  assert.equal(result.finalEffectMatchCount, 1);
  assert.notEqual(result.baselineEffectFingerprint, result.finalEffectFingerprint);
});

test("missing or unverified visual driver stops after typed pre-readback", async () => {
  const initial = response(readbackValue({ effect: false }), 10);
  const ioMissing = transport([initial]);
  const missing = await new GuardedRotoBrushSeedControllerV1(ioMissing, null).run(runInput());
  assert.equal(missing.escalationReason, "VISUAL_DRIVER_UNAVAILABLE");
  assert.equal(ioMissing.calls.length, 1);
  const ioUnverified = transport([initial]);
  const unverifiedDriver = driver({ verifiedVision: false });
  const unverified = await new GuardedRotoBrushSeedControllerV1(ioUnverified, unverifiedDriver).run(runInput());
  assert.equal(unverified.escalationReason, "VISUAL_DRIVER_UNAVAILABLE");
  assert.equal(unverifiedDriver.calls.length, 0);
});

test("unproven background role never reaches visual action", async () => {
  const io = transport([response(readbackValue({ effect: false }), 10)]);
  const visual = driver({ supportedRoles: ["FOREGROUND"] });
  const result = await new GuardedRotoBrushSeedControllerV1(io, visual).run(runInput({
    operation: "SEED_BACKGROUND",
    stroke: { ...stroke, role: "BACKGROUND" },
  }));
  assert.equal(result.escalationReason, "SEED_ROLE_UNPROVEN");
  assert.equal(visual.calls.length, 0);
});

test("visual refusal does not perform post-action readback or invent success", async () => {
  const io = transport([response(readbackValue({ effect: false }), 10)]);
  const visual = driver({ result: { status: "REFUSED", visualEvidenceId: "REFUSAL_1" } });
  const result = await new GuardedRotoBrushSeedControllerV1(io, visual).run(runInput());
  assert.equal(result.route, "ESCALATE");
  assert.equal(result.escalationReason, "VISUAL_ACTION_REFUSED");
  assert.equal(io.calls.length, 1);
  assert.equal(result.visualEvidenceId, "REFUSAL_1");
});

test("host revision drift alone cannot satisfy native Roto change verification", async () => {
  const before = response(readbackValue({ effect: true, value: "same" }), 10);
  const after = response(readbackValue({ effect: true, value: "same" }), 11);
  const result = await new GuardedRotoBrushSeedControllerV1(transport([before, after]), driver()).run(runInput());
  assert.equal(result.escalationReason, "NATIVE_ROTO_CHANGE_NOT_OBSERVED");
  assert.notEqual(result.baselineSessionRevision, result.finalSessionRevision);
  assert.equal(result.baselineEffectFingerprint, result.finalEffectFingerprint);
});

test("post-action target drift and missing exact ADBE Samurai identity fail closed", async () => {
  const before = response(readbackValue({ effect: false }), 10);
  const drift = response(readbackValue({ effect: true, value: "stroke", layerName: "Other" }), 11);
  const driftResult = await new GuardedRotoBrushSeedControllerV1(transport([before, drift]), driver()).run(runInput());
  assert.equal(driftResult.escalationReason, "POST_TARGET_DRIFT");
  const noEffect = response(readbackValue({ effect: false }), 11);
  const noEffectResult = await new GuardedRotoBrushSeedControllerV1(transport([before, noEffect]), driver()).run(runInput());
  assert.equal(noEffectResult.escalationReason, "ROTO_EFFECT_IDENTITY_NOT_ESTABLISHED");
});

test("truncated or ambiguous pre-readback refuses before visual action", async () => {
  const truncated = response(readbackValue({ effect: true, value: "x", truncated: true }), 10);
  const visual = driver();
  const result = await new GuardedRotoBrushSeedControllerV1(transport([truncated]), visual).run(runInput());
  assert.equal(result.escalationReason, "AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE");
  assert.equal(visual.calls.length, 0);
});