import test from "node:test";
import assert from "node:assert/strict";

import {
  AutomaticTrackingRepairMonitorV1,
} from "../.tmp/runtime/packages/tracking-state/src/automatic-repair.js";
import {
  createTrackingRepairStateV1,
  transitionTrackingRepairV1,
} from "../.tmp/runtime/packages/tracking-state/src/repair-resume.js";
import {
  M4_TRACKING_AUTO_ESCALATION_CAPABILITY_V1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-repair-resume.js";

const policy = {
  minTrackingConfidence: 0.8,
  maxDriftRisk: 0.25,
  maxOcclusion: 0.4,
  minIdentityConfidence: 0.75,
  failurePersistenceSamples: 2,
};

const sample = (timestampMs, overrides = {}) => ({
  semanticId: "PERSON_PETER_01",
  timestampMs,
  trackConfidence: 0.95,
  driftRisk: 0.05,
  occlusion: 0.05,
  evidenceIds: [`TRACK:${timestampMs}`],
  ...overrides,
});

test("automatic escalation capability is read-only and structurally bounded", () => {
  assert.equal(M4_TRACKING_AUTO_ESCALATION_CAPABILITY_V1.status, "PARTIAL");
  assert.equal(M4_TRACKING_AUTO_ESCALATION_CAPABILITY_V1.proofMaturity, "STRUCTURAL");
  assert.equal(M4_TRACKING_AUTO_ESCALATION_CAPABILITY_V1.riskClass, "R0_READ_ONLY");
  assert.equal(M4_TRACKING_AUTO_ESCALATION_CAPABILITY_V1.fallbackPolicy, "FORBID");
  assert.ok(M4_TRACKING_AUTO_ESCALATION_CAPABILITY_V1.limitations.some((value) => value.includes("Identity uncertainty")));
  assert.ok(M4_TRACKING_AUTO_ESCALATION_CAPABILITY_V1.limitations.some((value) => value.includes("does not move tracker features")));
});

test("monitor requires a verified last-good baseline before automatic escalation", () => {
  const monitor = new AutomaticTrackingRepairMonitorV1(policy);
  const first = monitor.update(sample(1000, { driftRisk: 0.8 }));
  assert.equal(first.status, "INSUFFICIENT_BASELINE");
  assert.equal(first.trigger, null);
  const good = monitor.update(sample(1100));
  assert.equal(good.status, "GOOD");
  assert.equal(good.lastGoodTimestampMs, 1100);
});

test("persistent drift emits one exact trigger and then latches", () => {
  const monitor = new AutomaticTrackingRepairMonitorV1(policy);
  assert.equal(monitor.update(sample(1000)).status, "GOOD");
  const pending = monitor.update(sample(1100, { driftRisk: 0.6, evidenceIds: ["DRIFT:1"] }));
  assert.equal(pending.status, "PENDING_FAILURE");
  assert.equal(pending.consecutiveFailureSamples, 1);
  const escalated = monitor.update(sample(1200, { driftRisk: 0.7, evidenceIds: ["DRIFT:2"] }));
  assert.equal(escalated.status, "ESCALATE");
  assert.deepEqual(escalated.trigger, {
    reason: "TRACK_DRIFT_RISK_HIGH",
    failureTimestampMs: 1100,
    lastGoodTimestampMs: 1000,
    evidenceIds: ["DRIFT:1", "DRIFT:2"],
  });
  const latched = monitor.update(sample(1300, { driftRisk: 0.8 }));
  assert.equal(latched.status, "LATCHED");
  assert.equal(latched.trigger, null);
  monitor.reset("PERSON_PETER_01");
  assert.equal(monitor.update(sample(1400, { driftRisk: 0.8 })).status, "INSUFFICIENT_BASELINE");
});

test("a changing failure reason restarts persistence instead of combining unrelated failures", () => {
  const monitor = new AutomaticTrackingRepairMonitorV1(policy);
  monitor.update(sample(1000));
  const confidence = monitor.update(sample(1100, { trackConfidence: 0.5 }));
  assert.equal(confidence.primaryReason, "TRACK_CONFIDENCE_LOW");
  assert.equal(confidence.consecutiveFailureSamples, 1);
  const drift = monitor.update(sample(1200, { driftRisk: 0.6 }));
  assert.equal(drift.primaryReason, "TRACK_DRIFT_RISK_HIGH");
  assert.equal(drift.status, "PENDING_FAILURE");
  assert.equal(drift.consecutiveFailureSamples, 1);
});

test("identity uncertainty requires explicit identity-confidence evidence", () => {
  const monitor = new AutomaticTrackingRepairMonitorV1(policy);
  monitor.update(sample(1000));
  const noIdentitySignal = monitor.update(sample(1100));
  assert.equal(noIdentitySignal.status, "GOOD");
  const pending = monitor.update(sample(1200, { identityConfidence: 0.4, evidenceIds: ["IDENTITY:1"] }));
  assert.equal(pending.primaryReason, "IDENTITY_UNCERTAIN");
  const escalated = monitor.update(sample(1300, { identityConfidence: 0.3, evidenceIds: ["IDENTITY:2"] }));
  assert.equal(escalated.status, "ESCALATE");
  assert.equal(escalated.trigger.reason, "IDENTITY_UNCERTAIN");
});

test("identity uncertainty has deterministic priority over simultaneous motion-quality failures", () => {
  const monitor = new AutomaticTrackingRepairMonitorV1({ ...policy, failurePersistenceSamples: 1 });
  monitor.update(sample(1000));
  const result = monitor.update(sample(1100, {
    identityConfidence: 0.2,
    occlusion: 0.9,
    driftRisk: 0.9,
    trackConfidence: 0.2,
  }));
  assert.equal(result.status, "ESCALATE");
  assert.equal(result.primaryReason, "IDENTITY_UNCERTAIN");
});

test("automatic trigger feeds the existing repair/resume state without bypassing its gates", () => {
  const monitor = new AutomaticTrackingRepairMonitorV1({ ...policy, failurePersistenceSamples: 1 });
  monitor.update(sample(1000));
  const automatic = monitor.update(sample(1100, { occlusion: 0.9, evidenceIds: ["OCCLUSION:1100"] }));
  let state = createTrackingRepairStateV1({
    semanticId: "PERSON_PETER_01",
    policy: { minResumeConfidence: 0.8, maxResumeDriftRisk: 0.25, maxResumeOcclusion: 0.4 },
    evidenceIds: ["TRACK:BOUND"],
  });
  state = transitionTrackingRepairV1(state, { type: "ESCALATE", trigger: automatic.trigger });
  assert.equal(state.status, "REPAIR_REQUIRED");
  assert.equal(state.trigger.reason, "SUBJECT_OCCLUDED");
  assert.equal(state.trigger.lastGoodTimestampMs, 1000);
  assert.equal(state.trigger.failureTimestampMs, 1100);
});

test("invalid and non-monotonic samples fail closed without corrupting monitor state", () => {
  const monitor = new AutomaticTrackingRepairMonitorV1(policy);
  assert.equal(monitor.update(sample(1000)).status, "GOOD");
  assert.equal(monitor.update(sample(900)), null);
  assert.equal(monitor.update(sample(1100, { evidenceIds: [] })), null);
  const good = monitor.update(sample(1200));
  assert.equal(good.status, "GOOD");
  assert.equal(good.lastGoodTimestampMs, 1200);
});

test("policy boundaries are inclusive-good and invalid policy is rejected", () => {
  const monitor = new AutomaticTrackingRepairMonitorV1(policy);
  const boundary = monitor.update(sample(1000, {
    trackConfidence: policy.minTrackingConfidence,
    driftRisk: policy.maxDriftRisk,
    occlusion: policy.maxOcclusion,
    identityConfidence: policy.minIdentityConfidence,
  }));
  assert.equal(boundary.status, "GOOD");
  assert.throws(() => new AutomaticTrackingRepairMonitorV1({ ...policy, failurePersistenceSamples: 0 }), TypeError);
  assert.throws(() => new AutomaticTrackingRepairMonitorV1({ ...policy, minIdentityConfidence: 2 }), TypeError);
});
