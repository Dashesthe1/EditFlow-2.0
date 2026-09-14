import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";
import {
  transitionTrackingRepairV1,
  type AutomaticTrackingRepairEvaluationV1,
  type TrackingRepairCorrectionV1,
  type TrackingRepairStateV1,
  type TrackingRepairTriggerReasonV1,
} from "../../../tracking-state/src/index.js";
import type { TrackerAnalysisDirectionV1 } from "./m4-tracker-analysis.js";
import type { AeTrackerRepairTargetV24 } from "./protocol-v2_4.js";

export const M4_AUTOMATIC_CORRECTIVE_RECOVERY_CAPABILITY_V1: CapabilityRecord = {
  id: asCapabilityId("tracking.repair_resume.auto_correct.plan"),
  domain: "tracking",
  description: "Plan evidence-bound automatic corrective recovery by composing a latched repair trigger, exact protocol 2.4 Feature Center correction, exact readback, and guarded directional tracker resume.",
  status: "PARTIAL",
  proofMaturity: "VISUAL",
  routes: [{
    routeId: asRouteId("m4.tracking.repair-auto-correct-plan.v1"),
    kind: "SUBSYSTEM_ADAPTER",
    available: true,
    adapterVersion: "0.5.0-dev.1",
    limitations: [
      "V1 composes only exact existing point-tracker Feature Center correction and guarded point-analysis resume.",
      "Correction geometry and semantic-to-host binding must already be evidence-backed; the planner never guesses either.",
    ],
  }],
  inputSchemaRef: "M4AutomaticCorrectiveRecoveryInputV1",
  outputSchemaRef: "M4AutomaticCorrectiveRecoveryPlanV1 | null",
  readbackStrategy: "AUTO_ESCALATION_TRIGGER_PLUS_PROTOCOL_2_4_PRE_POST_READBACK_PLUS_GUARDED_PROTOCOL_2_1_POST_RESUME_TRUTH",
  visualProofProfile: "M4_AUTOMATIC_CORRECTIVE_RECOVERY_ELIGIBLE_BIDIRECTIONAL_VISUAL",
  rollbackStrategy: "PLANNER_NONE; HOST_CORRECTION_PROTOCOL_2_4_TRANSACTION_UNDO",
  riskClass: "R0_READ_ONLY",
  limitations: [
    "Automatic correction is allowed only for persistent low confidence, drift risk, or explicit identity-confidence loss.",
    "Subject occlusion is escalation-only because hidden geometry is not a safe automatic correction target.",
    "The caller must provide exact comp/layer stable and host IDs, tracker/point indices, composition time, Feature Center coordinates, normalized semantic correction, and retained mapping evidence; the planner never guesses semantic or host geometry.",
    "Retained warm real-AE evidence independently proves every V1-eligible automatic failure reason—persistent low tracking confidence, persistent drift, and explicit identity-confidence loss—through exact Feature Center correction, guarded Analyze Forward, protocol 2.1 post-analysis truth, state verification, resume, and full proof-owned cleanup.",
    "Retained automatic correction is independently live-proven for every eligible reason on guarded Analyze Forward and guarded Analyze Backward with exact correction/readback, protocol 2.1 verification, state resume, and proof-owned cleanup.",
  ],
  fallbackPolicy: "FORBID",
};

export type M4AutomaticCorrectiveReasonV1 = Extract<TrackingRepairTriggerReasonV1,
  "TRACK_CONFIDENCE_LOW" | "TRACK_DRIFT_RISK_HIGH" | "IDENTITY_UNCERTAIN">;
export type M4AutomaticCorrectivePhaseV1 = "PRE_READBACK" | "CORRECT" | "POST_READBACK";

export interface M4AutomaticCorrectiveHostBindingV1 {
  readonly target: AeTrackerRepairTargetV24;
  readonly featureCenter: readonly [number, number];
  readonly mappingEvidenceIds: readonly string[];
}

export interface M4AutomaticCorrectiveRecoveryInputV1 {
  readonly evaluation: AutomaticTrackingRepairEvaluationV1;
  readonly repairState: TrackingRepairStateV1;
  readonly beginRepairAtMs: number;
  readonly correction: TrackingRepairCorrectionV1;
  readonly hostBinding: M4AutomaticCorrectiveHostBindingV1;
  readonly resumeDirection: TrackerAnalysisDirectionV1;
  readonly requiredPointIndices?: readonly number[];
}

export interface M4AutomaticCorrectiveOperationV1 {
  readonly phase: M4AutomaticCorrectivePhaseV1;
  readonly protocolVersion: "2.4.0";
  readonly capabilityId: "ae.tracker.repair.readback" | "ae.tracker.repair.feature_center.set";
  readonly command: "tracker.repair.readback" | "tracker.repair.set_feature_center";
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface M4AutomaticCorrectiveAnalysisDirectiveV1 {
  readonly capabilityId: "ae.tracker.analysis.guarded_visual";
  readonly direction: TrackerAnalysisDirectionV1;
  readonly compHostId: number;
  readonly layerHostId: number;
  readonly trackerIndex: number;
  readonly pointIndex: number;
  readonly requiredPointIndices: readonly number[];
}

export interface M4AutomaticCorrectiveRecoveryPlanV1 {
  readonly capabilityId: "tracking.repair_resume.auto_correct.plan";
  readonly semanticId: string;
  readonly reason: M4AutomaticCorrectiveReasonV1;
  readonly stateAfterCorrection: TrackingRepairStateV1;
  readonly operations: readonly M4AutomaticCorrectiveOperationV1[];
  readonly analysis: M4AutomaticCorrectiveAnalysisDirectiveV1;
  readonly postAnalysisGate: "VERIFY_REPAIR_THRESHOLDS_THEN_RESUME";
  readonly evidenceIds: readonly string[];
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const finiteNonNegative = (value: unknown): value is number =>
  finite(value) && value >= 0;
const positiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) > 0;
const finite01 = (value: unknown): value is number =>
  finite(value) && value >= 0 && value <= 1;
const evidence = (value: unknown): readonly string[] | null => {
  if (!Array.isArray(value)) return null;
  const ids = [...new Set(value.filter(nonEmpty))];
  return ids.length > 0 ? ids : null;
};
const includesAll = (container: readonly string[], required: readonly string[]): boolean =>
  required.every((item) => container.includes(item));
const validReason = (value: unknown): value is M4AutomaticCorrectiveReasonV1 =>
  value === "TRACK_CONFIDENCE_LOW" || value === "TRACK_DRIFT_RISK_HIGH" || value === "IDENTITY_UNCERTAIN";
const validRef = (value: unknown): value is { readonly stableId: string; readonly hostId: number } => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const ref = value as Record<string, unknown>;
  return nonEmpty(ref["stableId"]) && positiveInteger(ref["hostId"]);
};
const validTarget = (target: AeTrackerRepairTargetV24): boolean =>
  !!target
  && validRef(target.comp)
  && validRef(target.layer)
  && positiveInteger(target.trackerIndex)
  && positiveInteger(target.pointIndex)
  && finiteNonNegative(target.time);
const validFeatureCenter = (value: unknown): value is readonly [number, number] =>
  Array.isArray(value) && value.length === 2 && finite(value[0]) && finite(value[1]);
const validCorrection = (correction: TrackingRepairCorrectionV1): boolean =>
  !!correction
  && finiteNonNegative(correction.timestampMs)
  && finite01(correction.x)
  && finite01(correction.y)
  && finite01(correction.scale)
  && finite01(correction.confidence)
  && evidence(correction.evidenceIds) !== null;
const validDirection = (value: unknown): value is TrackerAnalysisDirectionV1 =>
  value === "FORWARD" || value === "BACKWARD";
const normalizedPointIndices = (
  value: readonly number[] | undefined,
  primary: number,
): readonly number[] | null => {
  const points = value === undefined ? [primary] : [...new Set(value)];
  if (points.length === 0 || points.some((item) => !positiveInteger(item)) || !points.includes(primary)) return null;
  return points;
};
const operation = (
  phase: M4AutomaticCorrectivePhaseV1,
  capabilityId: M4AutomaticCorrectiveOperationV1["capabilityId"],
  command: M4AutomaticCorrectiveOperationV1["command"],
  payload: Readonly<Record<string, unknown>>,
): M4AutomaticCorrectiveOperationV1 => ({
  phase,
  protocolVersion: "2.4.0",
  capabilityId,
  command,
  payload,
});

export const buildM4AutomaticCorrectiveRecoveryPlanV1 = (
  input: M4AutomaticCorrectiveRecoveryInputV1,
): M4AutomaticCorrectiveRecoveryPlanV1 | null => {
  if (!input || typeof input !== "object") return null;
  const evaluation = input.evaluation;
  const state = input.repairState;
  if (!evaluation || !state || evaluation.status !== "ESCALATE" || !evaluation.trigger) return null;
  if (!validReason(evaluation.primaryReason) || evaluation.trigger.reason !== evaluation.primaryReason) return null;
  if (evaluation.semanticId !== state.semanticId || evaluation.semanticId.trim().length === 0) return null;
  if (state.status !== "TRACKING" && state.status !== "RESUMED") return null;
  const evaluationEvidence = evidence(evaluation.evidenceIds);
  const triggerEvidence = evidence(evaluation.trigger.evidenceIds);
  if (!evaluationEvidence || !triggerEvidence || !includesAll(evaluationEvidence, triggerEvidence)) return null;
  if (!finiteNonNegative(input.beginRepairAtMs)
    || input.beginRepairAtMs < evaluation.trigger.failureTimestampMs) return null;
  if (!validCorrection(input.correction)
    || input.correction.timestampMs < evaluation.trigger.lastGoodTimestampMs) return null;
  if (!input.hostBinding || !validTarget(input.hostBinding.target)
    || !validFeatureCenter(input.hostBinding.featureCenter)) return null;
  const mappingEvidence = evidence(input.hostBinding.mappingEvidenceIds);
  const correctionEvidence = evidence(input.correction.evidenceIds);
  if (!mappingEvidence || !correctionEvidence || !validDirection(input.resumeDirection)) return null;
  const points = normalizedPointIndices(input.requiredPointIndices, input.hostBinding.target.pointIndex);
  if (!points) return null;

  const escalated = transitionTrackingRepairV1(state, {
    type: "ESCALATE",
    trigger: evaluation.trigger,
  });
  if (!escalated) return null;
  const repairing = transitionTrackingRepairV1(escalated, {
    type: "BEGIN_REPAIR",
    timestampMs: input.beginRepairAtMs,
    evidenceIds: evaluationEvidence,
  });
  if (!repairing) return null;
  const corrected = transitionTrackingRepairV1(repairing, {
    type: "RECORD_CORRECTION",
    correction: input.correction,
  });
  if (!corrected) return null;
  const target = input.hostBinding.target;
  const targetPayload = {
    comp: target.comp,
    layer: target.layer,
    trackerIndex: target.trackerIndex,
    pointIndex: target.pointIndex,
    time: target.time,
  };
  const operations: readonly M4AutomaticCorrectiveOperationV1[] = [
    operation("PRE_READBACK", "ae.tracker.repair.readback", "tracker.repair.readback", targetPayload),
    operation("CORRECT", "ae.tracker.repair.feature_center.set", "tracker.repair.set_feature_center", {
      ...targetPayload,
      featureCenter: [...input.hostBinding.featureCenter],
    }),
    operation("POST_READBACK", "ae.tracker.repair.readback", "tracker.repair.readback", targetPayload),
  ];
  const evidenceIds = [...new Set([
    ...evaluationEvidence,
    ...triggerEvidence,
    ...correctionEvidence,
    ...mappingEvidence,
  ])];

  return {
    capabilityId: "tracking.repair_resume.auto_correct.plan",
    semanticId: evaluation.semanticId,
    reason: evaluation.primaryReason,
    stateAfterCorrection: corrected,
    operations,
    analysis: {
      capabilityId: "ae.tracker.analysis.guarded_visual",
      direction: input.resumeDirection,
      compHostId: target.comp.hostId as number,
      layerHostId: target.layer.hostId as number,
      trackerIndex: target.trackerIndex,
      pointIndex: target.pointIndex,
      requiredPointIndices: points,
    },
    postAnalysisGate: "VERIFY_REPAIR_THRESHOLDS_THEN_RESUME",
    evidenceIds,
  };
};
