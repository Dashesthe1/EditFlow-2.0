import assert from "node:assert/strict";
import test from "node:test";

import { buildM6MotionPeakCompilerContextV1 } from "../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const reference = (phase) => ({
  summary: { motionPeakPhase: phase },
});

test("M6 adapts measured motion phase to the target effect window", () => {
  const context = buildM6MotionPeakCompilerContextV1({
    reference: reference(0.35),
    compId: "comp.target",
    targetRangeMs: { startMs: 2000, endMs: 5000 },
    roleBindings: [{ role: "hero", layerIds: ["hero"] }],
  });
  assert.equal(context.eventTimesMs["m6.effectPeak"], 3050);
  assert.deepEqual(context.parameterValues, {});
  assert.deepEqual(context.roleBindings, [{ role: "hero", layerIds: ["hero"] }]);
});

test("M6 motion-peak context rejects invalid transfer windows and phases", () => {
  assert.throws(() => buildM6MotionPeakCompilerContextV1({
    reference: reference(0.5),
    compId: "comp",
    targetRangeMs: { startMs: 1000, endMs: 1000 },
    roleBindings: [],
  }), /endMs must be greater/);
  assert.throws(() => buildM6MotionPeakCompilerContextV1({
    reference: reference(1.1),
    compId: "comp",
    targetRangeMs: { startMs: 0, endMs: 1000 },
    roleBindings: [],
  }), /normalized to \[0, 1\]/);
  assert.throws(() => buildM6MotionPeakCompilerContextV1({
    reference: reference(0.5),
    compId: " ",
    targetRangeMs: { startMs: 0, endMs: 1000 },
    roleBindings: [],
  }), /compId must not be empty/);
});
