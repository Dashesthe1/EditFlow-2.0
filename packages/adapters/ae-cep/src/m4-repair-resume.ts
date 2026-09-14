import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";

export const M4_TRACKING_REPAIR_RESUME_CAPABILITY_V1: CapabilityRecord = {
  id: asCapabilityId("tracking.repair_resume.state"),
  domain: "tracking",
  description: "Deterministic manual tracking repair/resume state model with explicit escalation, correction evidence, verification thresholds, resume gating, and abort semantics.",
  status: "PARTIAL",
  proofMaturity: "VISUAL",
  routes: [{
    routeId: asRouteId("m4.tracking.repair-resume-state.v1"),
    kind: "SUBSYSTEM_ADAPTER",
    available: true,
    adapterVersion: "0.5.0-dev.1",
    limitations: [
      "State model only; this tranche does not move AE tracker features, mask points, or UI controls.",
      "Resume thresholds are explicit caller policy and are never silently relaxed.",
    ],
  }],
  inputSchemaRef: "TrackingRepairStateV1 + TrackingRepairEventV1",
  outputSchemaRef: "TrackingRepairStateV1 | null",
  readbackStrategy: "EVIDENCE_BACKED_REPAIR_STATE_PLUS_PROTOCOL_2_4_WRITE_AND_PROTOCOL_2_1_POST_RESUME_READBACK",
  visualProofProfile: "M4_TRACKER_REPAIR_RESUME_BIDIRECTIONAL_VISUAL",
  rollbackStrategy: "STATE_NONE; HOST_CORRECTION_PROTOCOL_2_4_TRANSACTION_UNDO",
  riskClass: "R0_READ_ONLY",
  limitations: [
    "Repair corrections remain normalized semantic tracking observations; the proven host mapping currently covers exact Motion Tracker Feature Center correction only.",
    "Retained live proof covers guarded native Analyze Forward and Analyze Backward resume after exact Feature Center correction; mask-point repair and automatic corrective host actions for drift, identity loss, and occlusion remain unclaimed. Deterministic automatic escalation is declared separately.",
  ],
  fallbackPolicy: "FORBID",
};

export const M4_TRACKING_AUTO_ESCALATION_CAPABILITY_V1: CapabilityRecord = {
  id: asCapabilityId("tracking.repair_resume.auto_escalate"),
  domain: "tracking",
  description: "Deterministic evidence-gated monitor that converts persistent low confidence, drift, occlusion, or explicit identity-confidence loss into one latched repair trigger.",
  status: "PARTIAL",
  proofMaturity: "STRUCTURAL",
  routes: [{ routeId: asRouteId("m4.tracking.repair-auto-escalate.v1"), kind: "SUBSYSTEM_ADAPTER", available: true, adapterVersion: "0.5.0-dev.1", limitations: ["Requires a verified last-good baseline and caller-owned persistence thresholds before escalation."] }],
  inputSchemaRef: "AutomaticTrackingRepairPolicyV1 + AutomaticTrackingRepairSampleV1",
  outputSchemaRef: "AutomaticTrackingRepairEvaluationV1 | null",
  readbackStrategy: "TRACKING_ESTIMATE_PLUS_EXPLICIT_IDENTITY_CONFIDENCE_EVIDENCE",
  visualProofProfile: null,
  rollbackStrategy: "NONE_REQUIRED",
  riskClass: "R0_READ_ONLY",
  limitations: [
    "Identity uncertainty is evaluated only when the caller supplies explicit normalized identity confidence; it is never inferred from motion alone.",
    "A trigger is emitted once and latched until the caller explicitly resets the monitor after repair/resume.",
    "This monitor escalates into repair state only; it does not move tracker features, mask points, or issue AE analysis commands.",
  ],
  fallbackPolicy: "FORBID",
};

export const M4_TRACKER_REPAIR_READBACK_CAPABILITY_V24: CapabilityRecord = {
  id: asCapabilityId("ae.tracker.repair.readback"),
  domain: "tracking",
  description: "Read one exact Motion Tracker point Feature Center timeline, including full key samples and target-time value, for repair verification.",
  status: "PARTIAL",
  proofMaturity: "STRUCTURAL",
  routes: [{ routeId: asRouteId("ae.m4.tracker.repair.readback.v24"), kind: "HOST_ADAPTER", available: true, adapterVersion: "2.4.0", limitations: ["Retained real-AE protocol 2.4 acceptance covers exact Feature Center key/value readback."] }],
  inputSchemaRef: "AeTrackerRepairTargetV24",
  outputSchemaRef: "AeTrackerRepairReadbackV24",
  readbackStrategy: "PROTOCOL_2_4_EXACT_FEATURE_CENTER_KEYS",
  visualProofProfile: null,
  rollbackStrategy: "NONE_REQUIRED",
  riskClass: "R0_READ_ONLY",
  limitations: ["Readback addresses an existing tracker/point by exact positive indices; it never guesses a semantic point."],
  fallbackPolicy: "FORBID",
};

export const M4_TRACKER_REPAIR_WRITE_CAPABILITY_V24: CapabilityRecord = {
  id: asCapabilityId("ae.tracker.repair.feature_center.set"),
  domain: "tracking",
  description: "Repair one existing Motion Tracker Feature Center at an exact composition time with revision gating, exact readback, idempotency, and transaction undo rollback.",
  status: "PARTIAL",
  proofMaturity: "ROLLBACK",
  routes: [{ routeId: asRouteId("ae.m4.tracker.repair.feature-center-set.v24"), kind: "HOST_ADAPTER", available: true, adapterVersion: "2.4.0", limitations: ["Retained real-AE acceptance covers exact Feature Center write, idempotency, stale-revision rejection, and undo rollback restoration."] }],
  inputSchemaRef: "AeTrackerRepairTargetV24 + featureCenter",
  outputSchemaRef: "AeTrackerRepairReadbackV24",
  readbackStrategy: "PRE_POST_PROTOCOL_2_4_FEATURE_CENTER_KEYS",
  visualProofProfile: null,
  rollbackStrategy: "AE_UNDO_TRANSACTION_PLUS_EXACT_KEY_READBACK",
  riskClass: "R1_REVERSIBLE",
  limitations: [
    "This primitive repairs Feature Center only; feature/search region size and attach-point repair remain separate operations.",
    "Native Analyze Forward/Backward resume is not claimed by this host write alone.",
  ],
  fallbackPolicy: "FORBID",
};

export const M4_TRACKER_REPAIR_PROTOCOL_24_CAPABILITIES = [
  M4_TRACKER_REPAIR_READBACK_CAPABILITY_V24,
  M4_TRACKER_REPAIR_WRITE_CAPABILITY_V24,
] as const;
