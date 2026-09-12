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
  proofMaturity: "DECLARED",
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
  readbackStrategy: "EVIDENCE_BACKED_REPAIR_STATE_TRANSITIONS",
  visualProofProfile: null,
  rollbackStrategy: "NONE_REQUIRED",
  riskClass: "R0_READ_ONLY",
  limitations: [
    "Repair corrections are normalized semantic tracking observations, not direct After Effects property writes.",
    "Runtime capability registration is withheld until tracker/mask repair writes, verification readback, and live resume proof are retained.",
  ],
  fallbackPolicy: "FORBID",
};
