import test from "node:test";
import assert from "node:assert/strict";

import { GuardedRotoBrushRepairControllerV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-roto-brush-repair-controller.js";

const target = { compHostId: 10, layerHostId: 20, expectedCompName: "Roto Proof", expectedLayerName: "Subject" };
const stroke = {
  role: "FOREGROUND",
  pointsNormalized: [{ x: 0.48, y: 0.4 }, { x: 0.52, y: 0.55 }],
  radiusNormalized: 0.03,
};
const atom = (name, value) => ({
  index: 1, name, matchName: "ADBE Paint Atom", propertyType: 2, propertyValueType: null,
  numProperties: 0, numKeys: 0, canSetExpression: false, expressionEnabled: null, value, children: [],
});
const readbackValue = ({ foreground = ["seed"], background = ["defect"], layerName = "Subject", truncated = false } = {}) => {
  const children = [
    ...foreground.map((value, i) => atom(`Foreground ${i + 1}`, value)),
    ...background.map((value, i) => atom(`Background ${i + 1}`, value)),
  ];
  return {
    comp: { stableId: "COMP", hostId: 10, name: "Roto Proof", width: 1920, height: 1080, time: 0.5 },
    layer: { stableId: "LAYER", hostId: 20, name: layerName, index: 1 },
    rotoBrushMatchName: "ADBE Samurai", effectMatchCount: 1,
    effect: { effectIndex: 1, name: "Roto Brush & Refine Edge", matchName: "ADBE Samurai", enabled: true,
      numProperties: 1, properties: [{ index: 1, name: "Strokes", matchName: "ADBE Samurai Strokes Group",
        propertyType: 1, propertyValueType: 1, numProperties: children.length, numKeys: 0,
        canSetExpression: false, expressionEnabled: null, value: null, children }] },
    propertyNodeCount: children.length + 1, propertyTreeTruncated: truncated,
  };
};
const response = (readback, hostProjectRevision = 10) => ({
  protocolVersion: "2.6.0", requestId: "IGNORED", transactionId: "IGNORED", operationId: "IGNORED",
  capabilityId: "ae.roto_brush.session.inspect", command: "roto_brush.readback", outcome: "NO_OP", error: null,
  affectedObjects: [], readback, hostProjectRevision,
  diagnostics: { adapterProtocolVersion: "2.6.0", adapterBuild: "0.6.0-dev.2", command: "roto_brush.readback", notes: [] },
});
const transport = (values) => {
  let index = 0;
  return { calls: [], async dispatch(request) {
    this.calls.push(request);
    const next = values[Math.min(index, values.length - 1)]; index += 1;
    return { ...next, requestId: request.requestId, transactionId: request.transactionId, operationId: request.operationId };
  } };
};
const driver = (overrides = {}) => ({
  driverId: "TEST_REPAIR", verifiedVision: true, verifiedCursorControl: true,
  supportedRoles: ["FOREGROUND", "BACKGROUND"], calls: [],
  async repair(input) {
    this.calls.push(input);
    return { status: "COMPLETED", visualEvidenceId: "REPAIR_1", visibleRepairChangeObserved: true,
      aeActionToActionLatenciesMs: [175], ...overrides.result };
  },
  ...overrides,
});
const runInput = (overrides = {}) => ({
  ...target, atTime: 0.5, stroke, evidenceIds: ["M5:ROTO:REPAIR:001"], ...overrides,
});

test("foreground repair requires visible change plus a new native foreground stroke", async () => {
  const io = transport([
    response(readbackValue({ foreground: ["seed"], background: ["defect"] }), 10),
    response(readbackValue({ foreground: ["seed", "repair"], background: ["defect"] }), 11),
  ]);
  const visual = driver();
  const result = await new GuardedRotoBrushRepairControllerV1(io, visual).run(runInput());
  assert.equal(result.route, "LOCAL");
  assert.equal(result.repairRole, "FOREGROUND");
  assert.equal(result.visibleRepairChangeObserved, true);
  assert.equal(result.baselineRepairRoleStrokeCount, 1);
  assert.equal(result.finalRepairRoleStrokeCount, 2);
  assert.deepEqual(result.aeActionToActionLatenciesMs, [175]);
  assert.equal(visual.calls[0].operation, "REPAIR_STROKE");
  assert.equal(visual.calls[0].expectedEffectMatchCount, 1);
  assert.match(visual.calls[0].expectedEffectFingerprint, /^ROTO_EFFECT_V26_/);
});
test("background repair is supported but Refine Edge is not a repair role", async () => {
  const backgroundIo = transport([
    response(readbackValue({ foreground: ["seed"], background: ["defect"] }), 10),
    response(readbackValue({ foreground: ["seed"], background: ["defect", "repair"] }), 11),
  ]);
  const result = await new GuardedRotoBrushRepairControllerV1(backgroundIo, driver()).run(runInput({
    stroke: { ...stroke, role: "BACKGROUND" },
  }));
  assert.equal(result.route, "LOCAL");
  assert.equal(result.repairRole, "BACKGROUND");
  const refused = await new GuardedRotoBrushRepairControllerV1(
    transport([response(readbackValue(), 10)]), driver(),
  ).run(runInput({ stroke: { ...stroke, role: "REFINE_EDGE" } }));
  assert.equal(refused.escalationReason, "REPAIR_ROLE_UNPROVEN");
});

test("repair fails closed when visible proof or native stroke truth is missing", async () => {
  const before = response(readbackValue(), 10);
  const invisible = await new GuardedRotoBrushRepairControllerV1(
    transport([before]), driver({ result: { visibleRepairChangeObserved: false } }),
  ).run(runInput());
  assert.equal(invisible.escalationReason, "VISUAL_ACTION_REFUSED");
  const unchanged = await new GuardedRotoBrushRepairControllerV1(
    transport([before, response(readbackValue(), 11)]), driver(),
  ).run(runInput());
  assert.equal(unchanged.escalationReason, "NATIVE_ROTO_CHANGE_NOT_OBSERVED");
});
test("repair refuses target drift, truncated state, and missing verified driver", async () => {
  const before = response(readbackValue(), 10);
  const drift = response(readbackValue({ layerName: "Other", foreground: ["seed", "repair"] }), 11);
  const driftResult = await new GuardedRotoBrushRepairControllerV1(transport([before, drift]), driver()).run(runInput());
  assert.equal(driftResult.escalationReason, "POST_TARGET_DRIFT");
  const visual = driver();
  const truncated = await new GuardedRotoBrushRepairControllerV1(
    transport([response(readbackValue({ truncated: true }), 10)]), visual,
  ).run(runInput());
  assert.equal(truncated.escalationReason, "AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE");
  assert.equal(visual.calls.length, 0);
  const missing = await new GuardedRotoBrushRepairControllerV1(transport([before]), null).run(runInput());
  assert.equal(missing.escalationReason, "VISUAL_DRIVER_UNAVAILABLE");
});
