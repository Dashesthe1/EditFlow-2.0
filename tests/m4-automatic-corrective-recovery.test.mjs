import test from "node:test";
import assert from "node:assert/strict";
import {
  AutomaticTrackingRepairMonitorV1,
  createTrackingRepairStateV1,
} from "../.tmp/runtime/packages/tracking-state/src/index.js";
import {
  buildM4AutomaticCorrectiveRecoveryPlanV1,
  M4_AUTOMATIC_CORRECTIVE_RECOVERY_CAPABILITY_V1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-automatic-corrective-recovery.js";

const monitorPolicy = {
  minTrackingConfidence: 0.75,
  maxDriftRisk: 0.3,
  maxOcclusion: 0.45,
  minIdentityConfidence: 0.8,
  failurePersistenceSamples: 2,
};
const resumePolicy = {
  minResumeConfidence: 0.82,
  maxResumeDriftRisk: 0.2,
  maxResumeOcclusion: 0.3,
};
const semanticId = "PERSON_PETER_01";
const goodSample = (timestampMs, evidenceId = `GOOD:${timestampMs}`) => ({
  semanticId,
  timestampMs,
  trackConfidence: 0.95,
  driftRisk: 0.08,
  occlusion: 0.05,
  identityConfidence: 0.98,
  evidenceIds: [evidenceId],
});

const failureSample = (reason, timestampMs) => ({
  ...goodSample(timestampMs, `FAIL:${reason}:${timestampMs}`),
  ...(reason === "TRACK_DRIFT_RISK_HIGH" ? { driftRisk: 0.8 } : {}),
  ...(reason === "TRACK_CONFIDENCE_LOW" ? { trackConfidence: 0.3 } : {}),
  ...(reason === "IDENTITY_UNCERTAIN" ? { identityConfidence: 0.25 } : {}),
  ...(reason === "SUBJECT_OCCLUDED" ? { occlusion: 0.9 } : {}),
});

const escalationFor = (reason) => {
  const monitor = new AutomaticTrackingRepairMonitorV1(monitorPolicy);
  assert.equal(monitor.update(goodSample(1000))?.status, "GOOD");
  assert.equal(monitor.update(failureSample(reason, 1100))?.status, "PENDING_FAILURE");
  const evaluation = monitor.update(failureSample(reason, 1200));
  assert.equal(evaluation?.status, "ESCALATE");
  return evaluation;
};
const createRepairState = (id = semanticId) => createTrackingRepairStateV1({
  semanticId: id,
  policy: resumePolicy,
  evidenceIds: ["TRACK:BOUND:EXACT"],
});

const hostBinding = {
  target: {
    comp: { stableId: "COMP_RECOVERY_01", hostId: 101 },
    layer: { stableId: "LAYER_RECOVERY_01", hostId: 202 },
    trackerIndex: 1,
    pointIndex: 1,
    time: 1.2,
  },
  featureCenter: [48, 36],
  mappingEvidenceIds: ["MAP:SEMANTIC_TO_FEATURE_CENTER:EXACT"],
};
const correction = {
  timestampMs: 1150,
  x: 0.5,
  y: 0.4,
  scale: 0.22,
  confidence: 0.97,
  evidenceIds: ["CORRECTION:EXACT:1150"],
};

const inputFor = (reason) => ({
  evaluation: escalationFor(reason),
  repairState: createRepairState(),
  beginRepairAtMs: 1200,
  correction,
  hostBinding,
  resumeDirection: "FORWARD",
  requiredPointIndices: [1],
});

test("automatic corrective recovery capability is structural, read-only, and evidence-gated", () => {
  const capability = M4_AUTOMATIC_CORRECTIVE_RECOVERY_CAPABILITY_V1;
  assert.equal(capability.status, "PARTIAL");
  assert.equal(capability.proofMaturity, "STRUCTURAL");
  assert.equal(capability.riskClass, "R0_READ_ONLY");
  assert.equal(capability.fallbackPolicy, "FORBID");
  assert.equal(capability.visualProofProfile, null);
  assert.ok(capability.limitations.some((value) => value.includes("Subject occlusion")));
  assert.ok(capability.limitations.some((value) => value.includes("never guesses")));
});

test("persistent drift composes exact correction and guarded resume without inventing host geometry", () => {
  const plan = buildM4AutomaticCorrectiveRecoveryPlanV1(inputFor("TRACK_DRIFT_RISK_HIGH"));
  assert.ok(plan);
  assert.equal(plan.reason, "TRACK_DRIFT_RISK_HIGH");
  assert.equal(plan.semanticId, semanticId);
  assert.equal(plan.stateAfterCorrection.status, "REPAIR_IN_PROGRESS");
  assert.equal(plan.stateAfterCorrection.repairCycle, 1);
  assert.equal(plan.stateAfterCorrection.corrections.length, 1);
  assert.deepEqual(plan.stateAfterCorrection.corrections[0], correction);
  assert.equal(plan.postAnalysisGate, "VERIFY_REPAIR_THRESHOLDS_THEN_RESUME");
  assert.deepEqual(plan.operations.map((item) => item.phase), ["PRE_READBACK", "CORRECT", "POST_READBACK"]);
  assert.deepEqual(plan.operations.map((item) => item.command), ["tracker.repair.readback", "tracker.repair.set_feature_center", "tracker.repair.readback"]);
});
test("corrective plan preserves the exact protocol 2.4 target and correction value", () => {
  const plan = buildM4AutomaticCorrectiveRecoveryPlanV1(inputFor("TRACK_CONFIDENCE_LOW"));
  assert.ok(plan);
  assert.equal(plan.reason, "TRACK_CONFIDENCE_LOW");
  assert.deepEqual(plan.operations[0].payload, hostBinding.target);
  assert.deepEqual(plan.operations[1].payload, { ...hostBinding.target, featureCenter: [48, 36] });
  assert.deepEqual(plan.operations[2].payload, hostBinding.target);
  assert.deepEqual(plan.analysis, {
    capabilityId: "ae.tracker.analysis.guarded_visual",
    direction: "FORWARD",
    compHostId: 101,
    layerHostId: 202,
    trackerIndex: 1,
    pointIndex: 1,
    requiredPointIndices: [1],
  });
  assert.ok(plan.evidenceIds.includes("MAP:SEMANTIC_TO_FEATURE_CENTER:EXACT"));
  assert.ok(plan.evidenceIds.includes("CORRECTION:EXACT:1150"));
});

test("explicit identity-confidence loss can recover only with the same exact evidence-bound mapping", () => {
  const input = { ...inputFor("IDENTITY_UNCERTAIN"), resumeDirection: "BACKWARD" };
  const plan = buildM4AutomaticCorrectiveRecoveryPlanV1(input);
  assert.ok(plan);
  assert.equal(plan.reason, "IDENTITY_UNCERTAIN");
  assert.equal(plan.analysis.direction, "BACKWARD");
  assert.equal(plan.stateAfterCorrection.trigger.reason, "IDENTITY_UNCERTAIN");
});
test("occlusion remains escalation-only and cannot produce an automatic correction plan", () => {
  const input = inputFor("SUBJECT_OCCLUDED");
  assert.equal(buildM4AutomaticCorrectiveRecoveryPlanV1(input), null);
});

test("automatic correction refuses semantic mismatch, ambiguous host identity, and missing mapping evidence", () => {
  const base = inputFor("TRACK_DRIFT_RISK_HIGH");
  assert.equal(buildM4AutomaticCorrectiveRecoveryPlanV1({
    ...base,
    repairState: createRepairState("PERSON_OTHER_02"),
  }), null);
  assert.equal(buildM4AutomaticCorrectiveRecoveryPlanV1({
    ...base,
    hostBinding: { ...hostBinding, target: { ...hostBinding.target, layer: { hostId: 202 } } },
  }), null);
  assert.equal(buildM4AutomaticCorrectiveRecoveryPlanV1({
    ...base,
    hostBinding: { ...hostBinding, mappingEvidenceIds: [] },
  }), null);
});

test("automatic correction refuses stale correction timing and incomplete point-resume binding", () => {
  const base = inputFor("TRACK_CONFIDENCE_LOW");
  assert.equal(buildM4AutomaticCorrectiveRecoveryPlanV1({
    ...base,
    correction: { ...correction, timestampMs: 900 },
  }), null);
  assert.equal(buildM4AutomaticCorrectiveRecoveryPlanV1({
    ...base,
    requiredPointIndices: [2],
  }), null);
});
