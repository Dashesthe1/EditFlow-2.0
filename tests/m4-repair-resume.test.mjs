import test from "node:test";
import assert from "node:assert/strict";
import {
  createTrackingRepairStateV1,
  transitionTrackingRepairV1,
} from "../.tmp/runtime/packages/tracking-state/src/repair-resume.js";
import {
  M4_TRACKING_REPAIR_RESUME_CAPABILITY_V1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-repair-resume.js";

const policy = {
  minResumeConfidence: 0.8,
  maxResumeDriftRisk: 0.2,
  maxResumeOcclusion: 0.35,
};

const createState = () => createTrackingRepairStateV1({
  semanticId: "PERSON_PETER_01",
  policy,
  evidenceIds: ["TRACK:BOUND:1"],
});

const escalate = (state) => transitionTrackingRepairV1(state, {
  type: "ESCALATE",
  trigger: {
    reason: "TRACK_DRIFT_RISK_HIGH",
    failureTimestampMs: 1500,
    lastGoodTimestampMs: 1200,
    evidenceIds: ["TRACK:DRIFT:1500"],
  },
});

const begin = (state) => transitionTrackingRepairV1(state, {
  type: "BEGIN_REPAIR",
  timestampMs: 1510,
  evidenceIds: ["REPAIR:OPENED"],
});

const correction = (state, timestampMs = 1450) => transitionTrackingRepairV1(state, {
  type: "RECORD_CORRECTION",
  correction: {
    timestampMs,
    x: 0.42,
    y: 0.36,
    scale: 0.31,
    confidence: 0.97,
    evidenceIds: [`REPAIR:CORRECTION:${timestampMs}`],
  },
});

test("repair/resume capability stays declared and read-only until host repair proof exists", () => {
  assert.equal(M4_TRACKING_REPAIR_RESUME_CAPABILITY_V1.status, "PARTIAL");
  assert.equal(M4_TRACKING_REPAIR_RESUME_CAPABILITY_V1.proofMaturity, "DECLARED");
  assert.equal(M4_TRACKING_REPAIR_RESUME_CAPABILITY_V1.riskClass, "R0_READ_ONLY");
  assert.equal(M4_TRACKING_REPAIR_RESUME_CAPABILITY_V1.fallbackPolicy, "FORBID");
});

test("state creation requires exact identity and explicit normalized resume policy", () => {
  const state = createState();
  assert.ok(state);
  assert.equal(state.status, "TRACKING");
  assert.equal(state.repairCycle, 0);
  assert.deepEqual(state.policy, policy);

  assert.equal(createTrackingRepairStateV1({ semanticId: "", policy }), null);
  assert.equal(createTrackingRepairStateV1({ semanticId: "X", policy: { ...policy, minResumeConfidence: 2 } }), null);
  assert.equal(createTrackingRepairStateV1({ semanticId: "X", policy, evidenceIds: ["", " "] }), null);
});

test("happy path gates resume on escalation, correction evidence, and accepted verification", () => {
  let state = createState();
  state = escalate(state);
  assert.equal(state.status, "REPAIR_REQUIRED");
  assert.equal(state.repairCycle, 1);

  state = begin(state);
  assert.equal(state.status, "REPAIR_IN_PROGRESS");
  assert.equal(state.repairStartedAtMs, 1510);

  state = correction(state, 1450);
  state = correction(state, 1300);
  assert.deepEqual(state.corrections.map((item) => item.timestampMs), [1300, 1450]);

  state = transitionTrackingRepairV1(state, {
    type: "VERIFY_REPAIR",
    timestampMs: 1520,
    trackConfidence: 0.92,
    driftRisk: 0.12,
    occlusion: 0.1,
    evidenceIds: ["VERIFY:PASS"],
  });
  assert.equal(state.status, "RESUME_READY");
  assert.equal(state.verification.accepted, true);
  assert.deepEqual(state.verification.rejectionReasons, []);

  state = transitionTrackingRepairV1(state, {
    type: "RESUME",
    timestampMs: 1530,
    evidenceIds: ["TRACK:RESUMED"],
  });
  assert.equal(state.status, "RESUMED");
  assert.equal(state.resumedAtMs, 1530);
  assert.ok(state.evidenceIds.includes("TRACK:DRIFT:1500"));
  assert.ok(state.evidenceIds.includes("VERIFY:PASS"));
  assert.ok(state.evidenceIds.includes("TRACK:RESUMED"));
});

test("failed verification stays in repair and reports every violated resume threshold", () => {
  let state = correction(begin(escalate(createState())), 1450);
  state = transitionTrackingRepairV1(state, {
    type: "VERIFY_REPAIR",
    timestampMs: 1520,
    trackConfidence: 0.7,
    driftRisk: 0.3,
    occlusion: 0.5,
    evidenceIds: ["VERIFY:FAIL"],
  });
  assert.equal(state.status, "REPAIR_IN_PROGRESS");
  assert.equal(state.verification.accepted, false);
  assert.deepEqual(state.verification.rejectionReasons, [
    "TRACK_CONFIDENCE_LOW",
    "TRACK_DRIFT_RISK_HIGH",
    "SUBJECT_OCCLUDED",
  ]);
  assert.equal(transitionTrackingRepairV1(state, {
    type: "RESUME",
    timestampMs: 1530,
    evidenceIds: ["INVALID:RESUME"],
  }), null);
});

test("repair cannot verify before a correction or before the latest correction time", () => {
  const repairing = begin(escalate(createState()));
  assert.equal(transitionTrackingRepairV1(repairing, {
    type: "VERIFY_REPAIR",
    timestampMs: 1520,
    trackConfidence: 0.9,
    driftRisk: 0.1,
    occlusion: 0.1,
    evidenceIds: ["VERIFY"],
  }), null);

  const corrected = correction(repairing, 1450);
  assert.equal(transitionTrackingRepairV1(corrected, {
    type: "VERIFY_REPAIR",
    timestampMs: 1400,
    trackConfidence: 0.9,
    driftRisk: 0.1,
    occlusion: 0.1,
    evidenceIds: ["VERIFY"],
  }), null);
});

test("corrections fail closed when they precede last-good evidence or contain invalid geometry", () => {
  const repairing = begin(escalate(createState()));
  assert.equal(correction(repairing, 1100), null);
  assert.equal(transitionTrackingRepairV1(repairing, {
    type: "RECORD_CORRECTION",
    correction: {
      timestampMs: 1400,
      x: 1.2,
      y: 0.2,
      scale: 0.3,
      confidence: 0.9,
      evidenceIds: ["BAD"],
    },
  }), null);
  assert.equal(transitionTrackingRepairV1(repairing, {
    type: "RECORD_CORRECTION",
    correction: {
      timestampMs: 1400,
      x: 0.2,
      y: 0.2,
      scale: 0.3,
      confidence: 0.9,
      evidenceIds: [],
    },
  }), null);
});

test("abort is explicit and terminal for the repair session", () => {
  const repairing = begin(escalate(createState()));
  const aborted = transitionTrackingRepairV1(repairing, {
    type: "ABORT",
    reason: "Operator rejected identity binding",
    evidenceIds: ["REPAIR:ABORT"],
  });
  assert.ok(aborted);
  assert.equal(aborted.status, "ABORTED");
  assert.equal(aborted.abortedReason, "Operator rejected identity binding");
  assert.equal(transitionTrackingRepairV1(aborted, {
    type: "BEGIN_REPAIR",
    timestampMs: 1600,
  }), null);
});

test("a resumed track may escalate into a fresh repair cycle with old correction state cleared", () => {
  let state = correction(begin(escalate(createState())), 1450);
  state = transitionTrackingRepairV1(state, {
    type: "VERIFY_REPAIR",
    timestampMs: 1520,
    trackConfidence: 0.9,
    driftRisk: 0.1,
    occlusion: 0.1,
    evidenceIds: ["VERIFY:1"],
  });
  state = transitionTrackingRepairV1(state, {
    type: "RESUME",
    timestampMs: 1530,
    evidenceIds: ["RESUME:1"],
  });
  state = transitionTrackingRepairV1(state, {
    type: "ESCALATE",
    trigger: {
      reason: "SUBJECT_OCCLUDED",
      failureTimestampMs: 2500,
      lastGoodTimestampMs: 2400,
      evidenceIds: ["TRACK:OCCLUDED:2500"],
    },
  });
  assert.equal(state.status, "REPAIR_REQUIRED");
  assert.equal(state.repairCycle, 2);
  assert.equal(state.trigger.reason, "SUBJECT_OCCLUDED");
  assert.deepEqual(state.corrections, []);
  assert.equal(state.verification, null);
  assert.equal(state.resumedAtMs, null);
});

test("invalid transition order and malformed escalation evidence fail closed", () => {
  const tracking = createState();
  assert.equal(transitionTrackingRepairV1(tracking, {
    type: "BEGIN_REPAIR",
    timestampMs: 100,
  }), null);
  assert.equal(transitionTrackingRepairV1(tracking, {
    type: "ESCALATE",
    trigger: {
      reason: "UNKNOWN",
      failureTimestampMs: 100,
      lastGoodTimestampMs: 90,
      evidenceIds: ["X"],
    },
  }), null);
  assert.equal(transitionTrackingRepairV1(tracking, {
    type: "ESCALATE",
    trigger: {
      reason: "MANUAL_REQUEST",
      failureTimestampMs: 90,
      lastGoodTimestampMs: 100,
      evidenceIds: ["X"],
    },
  }), null);
});
