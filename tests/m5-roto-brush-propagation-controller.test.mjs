import test from "node:test";
import assert from "node:assert/strict";

import {
  GuardedRotoBrushPropagationControllerV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-roto-brush-propagation-controller.js";

const frameDuration = 1 / 60;
const target = {
  compHostId: 10,
  layerHostId: 20,
  expectedCompName: "Roto Proof",
  expectedLayerName: "Subject",
};
const property = (value = "stroke-1") => ({
  index: 1, name: "Foreground 1", matchName: "ADBE Paint Atom",
  propertyType: 2, propertyValueType: null, numProperties: 0, numKeys: 0,
  canSetExpression: false, expressionEnabled: null, value, children: [],
});
const readbackValue = ({ time = 0.5, value = "stroke-1", compName = "Roto Proof",
  layerName = "Subject", truncated = false, effectCount = 1 } = {}) => ({
  comp: { stableId: "COMP", hostId: 10, name: compName, width: 1920, height: 1080,
    duration: 2, frameRate: 60, frameDuration, time },
  layer: { stableId: "LAYER", hostId: 20, name: layerName, index: 1 },
  rotoBrushMatchName: "ADBE Samurai",
  effectMatchCount: effectCount,
  effect: effectCount === 1 ? {
    effectIndex: 1, name: "Roto Brush & Refine Edge", matchName: "ADBE Samurai",
    enabled: true, numProperties: 1, properties: [property(value)],
  } : null,
  propertyNodeCount: effectCount === 1 ? 1 : 0,
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
  return { calls: [], async dispatch(request) {
    this.calls.push(request);
    const next = values[Math.min(index, values.length - 1)]; index += 1;
    return { ...next, requestId: request.requestId, transactionId: request.transactionId, operationId: request.operationId };
  } };
};
const driver = (overrides = {}) => ({
  driverId: "TEST_PROPAGATION_DRIVER",
  verifiedVision: true,
  verifiedCursorControl: true,
  supportedDirections: ["PROPAGATE_FORWARD", "PROPAGATE_BACKWARD"],
  calls: [],
  async propagate(input) {
    this.calls.push(input);
    return {
      status: "COMPLETED", propagationVisualVerified: true,
      finalVisualEvidenceId: "VIS_PROP_1", frameSteps: input.expectedFrameSteps,
      aeActionToActionLatenciesMs: [90, 95], ...overrides.result,
    };
  },
  ...overrides,
});
const runInput = (overrides = {}) => ({
  operation: "PROPAGATE_FORWARD",
  ...target,
  range: { startTime: 0.5, endTime: 0.55 },
  evidenceIds: ["M5:ROTO:PROPAGATE:001"],
  ...overrides,
});

test("forward propagation binds exact frame plan and typed pre/post readback", async () => {
  const io = transport([
    response(readbackValue({ time: 0.5 }), 10),
    response(readbackValue({ time: 0.55 }), 10),
  ]);
  const visual = driver();
  const result = await new GuardedRotoBrushPropagationControllerV1(io, visual).run(runInput());
  assert.equal(result.route, "LOCAL");
  assert.equal(result.escalationReason, null);
  assert.equal(io.calls.length, 2);
  assert.equal(visual.calls.length, 1);
  assert.equal(visual.calls[0].expectedFrameSteps, 3);
  assert.equal(visual.calls[0].expectedStartTime, 0.5);
  assert.equal(visual.calls[0].expectedEndTime, 0.55);
  assert.equal(result.finalTime, 0.55);
  assert.deepEqual(result.aeActionToActionLatenciesMs, [90, 95]);
  assert.equal(result.baselineEffectFingerprint, result.finalEffectFingerprint);
  assert.notEqual(result.baselineSessionRevision, result.finalSessionRevision);
});

test("backward propagation reverses the bounded frame plan", async () => {
  const io = transport([
    response(readbackValue({ time: 0.5 }), 10),
    response(readbackValue({ time: 0.45 }), 10),
  ]);
  const visual = driver();
  const result = await new GuardedRotoBrushPropagationControllerV1(io, visual).run(runInput({
    operation: "PROPAGATE_BACKWARD",
    range: { startTime: 0.45, endTime: 0.5 },
  }));
  assert.equal(result.route, "LOCAL");
  assert.equal(visual.calls[0].expectedFrameSteps, 3);
  assert.equal(visual.calls[0].expectedStartTime, 0.5);
  assert.equal(visual.calls[0].expectedEndTime, 0.45);
  assert.equal(result.finalTime, 0.45);
});

test("start-time mismatch refuses before any visual action", async () => {
  const io = transport([response(readbackValue({ time: 0.25 }), 10)]);
  const visual = driver();
  const result = await new GuardedRotoBrushPropagationControllerV1(io, visual).run(runInput());
  assert.equal(result.escalationReason, "START_TIME_MISMATCH");
  assert.equal(visual.calls.length, 0);
  assert.equal(io.calls.length, 1);
});

test("non-frame-aligned or oversized ranges refuse before visual action", async () => {
  const initial = response(readbackValue({ time: 0.5 }), 10);
  const visual = driver();
  const offGrid = await new GuardedRotoBrushPropagationControllerV1(transport([initial]), visual).run(runInput({
    range: { startTime: 0.5, endTime: 0.547 },
  }));
  assert.equal(offGrid.escalationReason, "RANGE_EXCEEDS_BOUNDS");
  const tooLong = await new GuardedRotoBrushPropagationControllerV1(transport([initial]), driver()).run(runInput({
    range: { startTime: 0.5, endTime: 0.5 + frameDuration * 13 },
  }));
  assert.equal(tooLong.escalationReason, "RANGE_EXCEEDS_BOUNDS");
});

test("missing, unverified, or direction-limited drivers fail closed", async () => {
  const initial = response(readbackValue({ time: 0.5 }), 10);
  const missing = await new GuardedRotoBrushPropagationControllerV1(transport([initial]), null).run(runInput());
  assert.equal(missing.escalationReason, "VISUAL_DRIVER_UNAVAILABLE");
  const unverifiedDriver = driver({ verifiedVision: false });
  const unverified = await new GuardedRotoBrushPropagationControllerV1(transport([initial]), unverifiedDriver).run(runInput());
  assert.equal(unverified.escalationReason, "VISUAL_DRIVER_UNAVAILABLE");
  assert.equal(unverifiedDriver.calls.length, 0);
  const limitedDriver = driver({ supportedDirections: ["PROPAGATE_BACKWARD"] });
  const limited = await new GuardedRotoBrushPropagationControllerV1(transport([initial]), limitedDriver).run(runInput());
  assert.equal(limited.escalationReason, "PROPAGATION_DIRECTION_UNPROVEN");
  assert.equal(limitedDriver.calls.length, 0);
});

test("visual refusal or wrong step count never invents propagation success", async () => {
  const initial = response(readbackValue({ time: 0.5 }), 10);
  const refusedDriver = driver({ result: { status: "REFUSED", propagationVisualVerified: false, frameSteps: 0 } });
  const refusedIo = transport([initial]);
  const refused = await new GuardedRotoBrushPropagationControllerV1(refusedIo, refusedDriver).run(runInput());
  assert.equal(refused.escalationReason, "VISUAL_ACTION_REFUSED");
  assert.equal(refusedIo.calls.length, 1);
  const wrongStepsDriver = driver({ result: { frameSteps: 2 } });
  const wrongStepsIo = transport([initial]);
  const wrongSteps = await new GuardedRotoBrushPropagationControllerV1(wrongStepsIo, wrongStepsDriver).run(runInput());
  assert.equal(wrongSteps.escalationReason, "VISUAL_ACTION_REFUSED");
  assert.equal(wrongStepsIo.calls.length, 1);
});

test("post-action target drift and wrong final time fail closed", async () => {
  const before = response(readbackValue({ time: 0.5 }), 10);
  const drift = response(readbackValue({ time: 0.55, layerName: "Other" }), 10);
  const driftResult = await new GuardedRotoBrushPropagationControllerV1(transport([before, drift]), driver()).run(runInput());
  assert.equal(driftResult.escalationReason, "POST_TARGET_DRIFT");
  const wrongTime = response(readbackValue({ time: 0.5 + frameDuration * 1.5 }), 10);
  const wrongTimeResult = await new GuardedRotoBrushPropagationControllerV1(transport([before, wrongTime]), driver()).run(runInput());
  assert.equal(wrongTimeResult.escalationReason, "FINAL_TIME_NOT_REACHED");
});

test("ambiguous or truncated Roto state refuses before propagation", async () => {
  const truncated = response(readbackValue({ truncated: true }), 10);
  const visual = driver();
  const truncatedResult = await new GuardedRotoBrushPropagationControllerV1(transport([truncated]), visual).run(runInput());
  assert.equal(truncatedResult.escalationReason, "AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE");
  assert.equal(visual.calls.length, 0);
  const absent = response(readbackValue({ effectCount: 0 }), 10);
  const absentResult = await new GuardedRotoBrushPropagationControllerV1(transport([absent]), driver()).run(runInput());
  assert.equal(absentResult.escalationReason, "AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE");
});
