import test from "node:test";
import assert from "node:assert/strict";
import {
  GuardedMaskTrackingControllerV1,
  M4_MASK_TRACKING_CAPABILITY_V1,
  capabilityForMaskTrackingDriverV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-mask-tracking.js";

const maskReadback = (count, stableId = "MASK_1") => ({
  mask: {
    stableId,
    name: "Track Mask",
    pathKeyframes: Array.from({ length: count }, (_, i) => ({ time: i / 30, shape: {} })),
  },
});
const transport = (...reads) => ({
  calls: [],
  async dispatch(request) {
    this.calls.push(request);
    return { readback: reads.shift() ?? null };
  },
});
const input = {
  compHostId: 1, layerHostId: 2, maskStableId: "MASK_1",
  expectedCompName: "Proof Comp", expectedLayerName: "Proof Layer", direction: "FORWARD",
};
test("mask tracking capability is fail-closed until an explicit visual driver exists", () => {
  assert.equal(M4_MASK_TRACKING_CAPABILITY_V1.status, "ADAPTER_REQUIRED");
  assert.equal(M4_MASK_TRACKING_CAPABILITY_V1.riskClass, "R4_EXTERNAL_UI");
  assert.equal(M4_MASK_TRACKING_CAPABILITY_V1.routes[0].kind, "GUARDED_UI");
  assert.equal(M4_MASK_TRACKING_CAPABILITY_V1.routes[0].available, false);
});

test("missing visual driver stops after typed mask pre-readback", async () => {
  const t = transport(maskReadback(0));
  const result = await new GuardedMaskTrackingControllerV1(t, null).run(input);
  assert.equal(result.route, "ESCALATE");
  assert.equal(result.escalationReason, "VISUAL_DRIVER_UNAVAILABLE");
  assert.equal(result.baselinePathKeyCount, 0);
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].command, "mask.readback");
  assert.equal(t.calls[0].payload.mask.stableId, "MASK_1");
});

test("missing or mismatched mask target never reaches the visual action", async () => {
  let actions = 0;
  const driver = { driverId: "MASK_VIS", verifiedVision: true, verifiedCursorControl: true,
    supportedDirections: ["FORWARD"], async analyze() { actions += 1; return { status: "COMPLETED" }; } };
  const result = await new GuardedMaskTrackingControllerV1(transport(maskReadback(0, "OTHER")), driver).run(input);
  assert.equal(result.escalationReason, "MASK_TARGET_UNAVAILABLE");
  assert.equal(actions, 0);
});
test("verified mask action is rejected unless native Mask Path keyframes grow", async () => {
  const t = transport(maskReadback(2), maskReadback(2));
  const driver = { driverId: "MASK_VIS", verifiedVision: true, verifiedCursorControl: true,
    supportedDirections: ["FORWARD"], async analyze(request) {
      assert.equal(request.expectedControl, "MASK_ANALYZE_FORWARD");
      assert.equal(request.expectedMaskName, "Track Mask");
      return { status: "COMPLETED", visualEvidenceId: "MASK_VIS_1" };
    } };
  const result = await new GuardedMaskTrackingControllerV1(t, driver).run(input);
  assert.equal(result.route, "ESCALATE");
  assert.equal(result.escalationReason, "ANALYSIS_NOT_OBSERVED");
  assert.equal(result.visualEvidenceId, "MASK_VIS_1");
});

test("verified mask action succeeds after protocol 1.2 Mask Path key growth", async () => {
  const t = transport(maskReadback(0), maskReadback(22));
  let seen = null;
  const driver = { driverId: "MASK_VIS", verifiedVision: true, verifiedCursorControl: true,
    supportedDirections: ["FORWARD"], async analyze(request) {
      seen = request; return { status: "COMPLETED", visualEvidenceId: "MASK_VIS_2" };
    } };
  const result = await new GuardedMaskTrackingControllerV1(t, driver).run(input);
  assert.equal(result.route, "LOCAL");
  assert.equal(result.baselinePathKeyCount, 0);
  assert.equal(result.finalPathKeyCount, 22);
  assert.equal(result.visualEvidenceId, "MASK_VIS_2");
  assert.equal(seen.compHostId, 1);
  assert.equal(seen.layerHostId, 2);
  assert.equal(seen.maskStableId, "MASK_1");
  assert.equal(seen.expectedCompName, "Proof Comp");
  assert.equal(seen.expectedLayerName, "Proof Layer");
});

test("Forward-only proof promotes only the explicit guarded mask route", () => {
  const driver = { driverId: "MASK_VIS", verifiedVision: true, verifiedCursorControl: true,
    supportedDirections: ["FORWARD"], async analyze() { return { status: "REFUSED" }; } };
  const capability = capabilityForMaskTrackingDriverV1(driver);
  assert.equal(capability.status, "PARTIAL");
  assert.equal(capability.proofMaturity, "VISUAL");
  assert.equal(capability.routes[0].available, true);
  assert.ok(capability.limitations.some((value) => value.includes("Analyze Backward remains unavailable")));
  assert.equal(capabilityForMaskTrackingDriverV1({ ...driver, supportedDirections: ["BACKWARD"] }).routes[0].available, false);
});

test("unproven Backward never reaches the mask visual driver", async () => {
  let actions = 0;
  const driver = { driverId: "MASK_VIS", verifiedVision: true, verifiedCursorControl: true,
    supportedDirections: ["FORWARD"], async analyze() { actions += 1; return { status: "COMPLETED" }; } };
  const result = await new GuardedMaskTrackingControllerV1(transport(maskReadback(0)), driver).run({ ...input, direction: "BACKWARD" });
  assert.equal(result.escalationReason, "ANALYSIS_DIRECTION_UNPROVEN");
  assert.equal(actions, 0);
});
