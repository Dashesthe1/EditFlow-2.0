import test from "node:test";
import assert from "node:assert/strict";
import {
  GuardedTrackerAnalysisControllerV1,
  M4_TRACKER_ANALYSIS_CAPABILITY_V1,
  capabilityForTrackerAnalysisDriverV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-tracker-analysis.js";

const readback = (count, includePoint = true) => ({
  comp: { hostId: 1, stableId: null, name: "Proof Comp", width: 1920, height: 1080 },
  layer: { hostId: 2, stableId: null, name: "Proof Layer" },
  trackers: includePoint ? [{
    trackerIndex: 1,
    name: "Tracker 1",
    points: [{ pointIndex: 1, samples: Array.from({ length: count }, (_, i) => ({ time: i / 30 })) }],
  }] : [],
});

const transport = (...reads) => ({
  calls: [],
  async dispatch(request) {
    this.calls.push(request);
    return { readback: reads.shift() ?? null };
  },
});

const runInput = { compHostId: 1, layerHostId: 2, direction: "FORWARD" };
test("analysis capability stays explicit guarded UI until a visual driver is proven", () => {
  assert.equal(M4_TRACKER_ANALYSIS_CAPABILITY_V1.status, "ADAPTER_REQUIRED");
  assert.equal(M4_TRACKER_ANALYSIS_CAPABILITY_V1.riskClass, "R4_EXTERNAL_UI");
  assert.equal(M4_TRACKER_ANALYSIS_CAPABILITY_V1.routes[0].kind, "GUARDED_UI");
  assert.equal(M4_TRACKER_ANALYSIS_CAPABILITY_V1.routes[0].available, false);
  assert.ok(M4_TRACKER_ANALYSIS_CAPABILITY_V1.limitations.some((value) => value.includes("Analyze Forward has real-AE vision+cursor proof")));
  assert.ok(M4_TRACKER_ANALYSIS_CAPABILITY_V1.limitations.some((value) => value.includes("Analyze Backward") && value.includes("unproven")));
});

test("missing verified visual driver fails closed after typed pre-readback", async () => {
  const t = transport(readback(1));
  const result = await new GuardedTrackerAnalysisControllerV1(t, null).run(runInput);
  assert.equal(result.route, "ESCALATE");
  assert.equal(result.escalationReason, "VISUAL_DRIVER_UNAVAILABLE");
  assert.equal(result.baselineSampleCount, 1);
  assert.equal(t.calls.length, 1);
});

test("unverified cursor driver cannot press Analyze", async () => {
  let actionCalls = 0;
  const driver = { driverId: "UNVERIFIED", verifiedVision: true, verifiedCursorControl: false, supportedDirections: ["FORWARD"],
    async analyze() { actionCalls += 1; return { status: "COMPLETED" }; } };
  const result = await new GuardedTrackerAnalysisControllerV1(transport(readback(1)), driver).run(runInput);
  assert.equal(result.escalationReason, "VISUAL_DRIVER_UNAVAILABLE");
  assert.equal(actionCalls, 0);
});
test("verified visual action is rejected when native tracker samples do not increase", async () => {
  const t = transport(readback(2), readback(2));
  const driver = { driverId: "VISION_CURSOR", verifiedVision: true, verifiedCursorControl: true, supportedDirections: ["FORWARD"],
    async analyze(input) { assert.equal(input.expectedControl, "TRACKER_ANALYZE_FORWARD"); return { status: "COMPLETED", visualEvidenceId: "VIS_1" }; } };
  const result = await new GuardedTrackerAnalysisControllerV1(t, driver).run(runInput);
  assert.equal(result.route, "ESCALATE");
  assert.equal(result.escalationReason, "ANALYSIS_NOT_OBSERVED");
  assert.equal(result.visualEvidenceId, "VIS_1");
  assert.equal(t.calls.length, 2);
});

test("verified visual action succeeds only after native tracker samples increase", async () => {
  const t = transport(readback(1), readback(5));
  const driver = { driverId: "VISION_CURSOR", verifiedVision: true, verifiedCursorControl: true, supportedDirections: ["FORWARD"],
    async analyze() { return { status: "COMPLETED", visualEvidenceId: "VIS_2" }; } };
  const result = await new GuardedTrackerAnalysisControllerV1(t, driver).run(runInput);
  assert.equal(result.route, "LOCAL");
  assert.equal(result.escalationReason, null);
  assert.equal(result.baselineSampleCount, 1);
  assert.equal(result.finalSampleCount, 5);
  assert.equal(result.visualEvidenceId, "VIS_2");
});

test("missing tracker target escalates before any visual action", async () => {
  let actionCalls = 0;
  const driver = { driverId: "VISION_CURSOR", verifiedVision: true, verifiedCursorControl: true, supportedDirections: ["FORWARD"],
    async analyze() { actionCalls += 1; return { status: "COMPLETED" }; } };
  const result = await new GuardedTrackerAnalysisControllerV1(transport(readback(0, false)), driver).run(runInput);
  assert.equal(result.escalationReason, "TRACKER_TARGET_UNAVAILABLE");
  assert.equal(actionCalls, 0);
});

test("accepted Forward driver promotes only the guarded Forward route", () => {
  const driver = {
    driverId: "EDITGPT_FORWARD",
    verifiedVision: true,
    verifiedCursorControl: true,
    supportedDirections: ["FORWARD"],
    async analyze() { return { status: "REFUSED" }; },
  };
  const capability = capabilityForTrackerAnalysisDriverV1(driver);
  assert.equal(capability.status, "PARTIAL");
  assert.equal(capability.proofMaturity, "VISUAL");
  assert.equal(capability.routes[0].available, true);
  assert.ok(capability.limitations.some((value) => value.includes("Analyze Backward remains unavailable")));

  const backwardOnly = { ...driver, supportedDirections: ["BACKWARD"] };
  assert.equal(capabilityForTrackerAnalysisDriverV1(backwardOnly).routes[0].available, false);
});

test("controller binds the visual action to typed pre-readback identity", async () => {
  const t = transport(readback(1), readback(4));
  let seen = null;
  const driver = {
    driverId: "EDITGPT_FORWARD",
    verifiedVision: true,
    verifiedCursorControl: true,
    supportedDirections: ["FORWARD"],
    async analyze(input) { seen = input; return { status: "COMPLETED", visualEvidenceId: "VIS_BOUND" }; },
  };
  const result = await new GuardedTrackerAnalysisControllerV1(t, driver).run(runInput);
  assert.equal(result.route, "LOCAL");
  assert.equal(seen.compHostId, 1);
  assert.equal(seen.layerHostId, 2);
  assert.equal(seen.expectedCompName, "Proof Comp");
  assert.equal(seen.expectedLayerName, "Proof Layer");
  assert.equal(seen.expectedTrackerName, "Tracker 1");
  assert.equal(seen.expectedControl, "TRACKER_ANALYZE_FORWARD");
});

test("unproven Analyze Backward never reaches the visual driver", async () => {
  let calls = 0;
  const driver = {
    driverId: "EDITGPT_FORWARD",
    verifiedVision: true,
    verifiedCursorControl: true,
    supportedDirections: ["FORWARD"],
    async analyze() { calls += 1; return { status: "COMPLETED" }; },
  };
  const result = await new GuardedTrackerAnalysisControllerV1(transport(readback(1)), driver).run({
    ...runInput,
    direction: "BACKWARD",
  });
  assert.equal(result.route, "ESCALATE");
  assert.equal(result.escalationReason, "ANALYSIS_DIRECTION_UNPROVEN");
  assert.equal(calls, 0);
});

test("dual-direction verified driver executes Backward only after typed pre-readback binding", async () => {
  const t = transport(readback(1), readback(6));
  let seen = null;
  const driver = {
    driverId: "EDITGPT_DUAL", verifiedVision: true, verifiedCursorControl: true,
    supportedDirections: ["FORWARD", "BACKWARD"],
    async analyze(input) { seen = input; return { status: "COMPLETED", visualEvidenceId: "VIS_BACKWARD" }; },
  };
  const result = await new GuardedTrackerAnalysisControllerV1(t, driver).run({ ...runInput, direction: "BACKWARD" });
  assert.equal(result.route, "LOCAL");
  assert.equal(result.baselineSampleCount, 1);
  assert.equal(result.finalSampleCount, 6);
  assert.equal(seen.direction, "BACKWARD");
  assert.equal(seen.expectedControl, "TRACKER_ANALYZE_BACKWARD");
  assert.equal(seen.expectedCompName, "Proof Comp");
  assert.equal(seen.expectedLayerName, "Proof Layer");
  const capability = capabilityForTrackerAnalysisDriverV1(driver);
  assert.ok(capability.limitations.some((value) => value.includes("Analyze Forward and Analyze Backward")));
  assert.ok(!capability.limitations.some((value) => value.includes("Analyze Backward remains unavailable")));
});
