export const TRACKING_REPAIR_STATUSES_V1 = [
  "TRACKING",
  "REPAIR_REQUIRED",
  "REPAIR_IN_PROGRESS",
  "RESUME_READY",
  "RESUMED",
  "ABORTED",
] as const;

export type TrackingRepairStatusV1 = (typeof TRACKING_REPAIR_STATUSES_V1)[number];

export const TRACKING_REPAIR_TRIGGERS_V1 = [
  "SUBJECT_STATE_INVALID",
  "TRACK_CONFIDENCE_LOW",
  "TRACK_DRIFT_RISK_HIGH",
  "SUBJECT_OCCLUDED",
  "IDENTITY_UNCERTAIN",
  "MANUAL_REQUEST",
] as const;

export type TrackingRepairTriggerReasonV1 = (typeof TRACKING_REPAIR_TRIGGERS_V1)[number];

export interface TrackingRepairPolicyV1 {
  readonly minResumeConfidence: number;
  readonly maxResumeDriftRisk: number;
  readonly maxResumeOcclusion: number;
}

export interface TrackingRepairTriggerV1 {
  readonly reason: TrackingRepairTriggerReasonV1;
  readonly failureTimestampMs: number;
  readonly lastGoodTimestampMs: number;
  readonly evidenceIds: readonly string[];
}

export interface TrackingRepairCorrectionV1 {
  readonly timestampMs: number;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly confidence: number;
  readonly evidenceIds: readonly string[];
}

export interface TrackingRepairVerificationV1 {
  readonly timestampMs: number;
  readonly trackConfidence: number;
  readonly driftRisk: number;
  readonly occlusion: number;
  readonly accepted: boolean;
  readonly rejectionReasons: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface TrackingRepairStateV1 {
  readonly semanticId: string;
  readonly status: TrackingRepairStatusV1;
  readonly repairCycle: number;
  readonly policy: TrackingRepairPolicyV1;
  readonly trigger: TrackingRepairTriggerV1 | null;
  readonly repairStartedAtMs: number | null;
  readonly corrections: readonly TrackingRepairCorrectionV1[];
  readonly verification: TrackingRepairVerificationV1 | null;
  readonly resumedAtMs: number | null;
  readonly abortedReason: string | null;
  readonly evidenceIds: readonly string[];
}

export type TrackingRepairEventV1 =
  | { readonly type: "ESCALATE"; readonly trigger: TrackingRepairTriggerV1 }
  | { readonly type: "BEGIN_REPAIR"; readonly timestampMs: number; readonly evidenceIds?: readonly string[] }
  | { readonly type: "RECORD_CORRECTION"; readonly correction: TrackingRepairCorrectionV1 }
  | {
      readonly type: "VERIFY_REPAIR";
      readonly timestampMs: number;
      readonly trackConfidence: number;
      readonly driftRisk: number;
      readonly occlusion: number;
      readonly evidenceIds: readonly string[];
    }
  | { readonly type: "RESUME"; readonly timestampMs: number; readonly evidenceIds: readonly string[] }
  | { readonly type: "ABORT"; readonly reason: string; readonly evidenceIds: readonly string[] };

const finite01 = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const finiteNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const evidence = (value: unknown): readonly string[] | null => {
  if (!Array.isArray(value)) return null;
  const ids = [...new Set(value.filter(nonEmpty))];
  return ids.length > 0 ? ids : null;
};
const validPolicy = (value: unknown): value is TrackingRepairPolicyV1 => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const policy = value as Record<string, unknown>;
  return [policy["minResumeConfidence"], policy["maxResumeDriftRisk"], policy["maxResumeOcclusion"]].every(finite01);
};
const validTriggerReason = (value: unknown): value is TrackingRepairTriggerReasonV1 =>
  typeof value === "string" && (TRACKING_REPAIR_TRIGGERS_V1 as readonly string[]).includes(value);
const mergeEvidence = (...groups: (readonly string[])[]): readonly string[] =>
  [...new Set(groups.flat())];

export const createTrackingRepairStateV1 = (input: {
  readonly semanticId: string;
  readonly policy: TrackingRepairPolicyV1;
  readonly evidenceIds?: readonly string[];
}): TrackingRepairStateV1 | null => {
  if (!nonEmpty(input?.semanticId) || !validPolicy(input?.policy)) return null;
  const initialEvidence = input.evidenceIds === undefined ? [] : evidence(input.evidenceIds);
  if (initialEvidence === null) return null;
  return {
    semanticId: input.semanticId,
    status: "TRACKING",
    repairCycle: 0,
    policy: input.policy,
    trigger: null,
    repairStartedAtMs: null,
    corrections: [],
    verification: null,
    resumedAtMs: null,
    abortedReason: null,
    evidenceIds: initialEvidence,
  };
};

const validCorrection = (
  correction: TrackingRepairCorrectionV1,
  lastGoodTimestampMs: number,
): boolean => {
  if (!correction || !finiteNonNegative(correction.timestampMs) || correction.timestampMs < lastGoodTimestampMs) return false;
  if (![correction.x, correction.y, correction.scale, correction.confidence].every(finite01)) return false;
  return evidence(correction.evidenceIds) !== null;
};

export const transitionTrackingRepairV1 = (
  state: TrackingRepairStateV1,
  event: TrackingRepairEventV1,
): TrackingRepairStateV1 | null => {
  if (!state || !event || !nonEmpty(state.semanticId) || !validPolicy(state.policy)) return null;

  if (event.type === "ESCALATE") {
    if (state.status !== "TRACKING" && state.status !== "RESUMED") return null;
    const trigger = event.trigger;
    const triggerEvidence = evidence(trigger?.evidenceIds);
    if (!trigger || !validTriggerReason(trigger.reason) || !finiteNonNegative(trigger.failureTimestampMs)
      || !finiteNonNegative(trigger.lastGoodTimestampMs) || trigger.lastGoodTimestampMs > trigger.failureTimestampMs
      || !triggerEvidence) return null;
    return {
      ...state,
      status: "REPAIR_REQUIRED",
      repairCycle: state.repairCycle + 1,
      trigger: { ...trigger, evidenceIds: triggerEvidence },
      repairStartedAtMs: null,
      corrections: [],
      verification: null,
      resumedAtMs: null,
      abortedReason: null,
      evidenceIds: mergeEvidence(state.evidenceIds, triggerEvidence),
    };
  }

  if (event.type === "BEGIN_REPAIR") {
    if (state.status !== "REPAIR_REQUIRED" || !state.trigger || !finiteNonNegative(event.timestampMs)
      || event.timestampMs < state.trigger.failureTimestampMs) return null;
    const ids = event.evidenceIds === undefined ? [] : evidence(event.evidenceIds);
    if (ids === null) return null;
    return {
      ...state,
      status: "REPAIR_IN_PROGRESS",
      repairStartedAtMs: event.timestampMs,
      evidenceIds: mergeEvidence(state.evidenceIds, ids),
    };
  }

  if (event.type === "RECORD_CORRECTION") {
    if (state.status !== "REPAIR_IN_PROGRESS" || !state.trigger || !validCorrection(event.correction, state.trigger.lastGoodTimestampMs)) return null;
    const ids = evidence(event.correction.evidenceIds)!;
    const correction = { ...event.correction, evidenceIds: ids };
    return {
      ...state,
      corrections: [...state.corrections, correction].sort((a, b) => a.timestampMs - b.timestampMs),
      verification: null,
      evidenceIds: mergeEvidence(state.evidenceIds, ids),
    };
  }

  if (event.type === "VERIFY_REPAIR") {
    if (state.status !== "REPAIR_IN_PROGRESS" || state.corrections.length === 0 || !finiteNonNegative(event.timestampMs)) return null;
    const latestCorrection = Math.max(...state.corrections.map((item) => item.timestampMs));
    if (event.timestampMs < latestCorrection) return null;
    if (![event.trackConfidence, event.driftRisk, event.occlusion].every(finite01)) return null;
    const ids = evidence(event.evidenceIds);
    if (!ids) return null;
    const rejectionReasons: string[] = [];
    if (event.trackConfidence < state.policy.minResumeConfidence) rejectionReasons.push("TRACK_CONFIDENCE_LOW");
    if (event.driftRisk > state.policy.maxResumeDriftRisk) rejectionReasons.push("TRACK_DRIFT_RISK_HIGH");
    if (event.occlusion > state.policy.maxResumeOcclusion) rejectionReasons.push("SUBJECT_OCCLUDED");
    const verification: TrackingRepairVerificationV1 = {
      timestampMs: event.timestampMs,
      trackConfidence: event.trackConfidence,
      driftRisk: event.driftRisk,
      occlusion: event.occlusion,
      accepted: rejectionReasons.length === 0,
      rejectionReasons,
      evidenceIds: ids,
    };
    return {
      ...state,
      status: verification.accepted ? "RESUME_READY" : "REPAIR_IN_PROGRESS",
      verification,
      evidenceIds: mergeEvidence(state.evidenceIds, ids),
    };
  }

  if (event.type === "RESUME") {
    if (state.status !== "RESUME_READY" || !state.verification?.accepted || !finiteNonNegative(event.timestampMs)
      || event.timestampMs < state.verification.timestampMs) return null;
    const ids = evidence(event.evidenceIds);
    if (!ids) return null;
    return {
      ...state,
      status: "RESUMED",
      resumedAtMs: event.timestampMs,
      evidenceIds: mergeEvidence(state.evidenceIds, ids),
    };
  }

  if (event.type === "ABORT") {
    if (!["REPAIR_REQUIRED", "REPAIR_IN_PROGRESS", "RESUME_READY"].includes(state.status)
      || !nonEmpty(event.reason)) return null;
    const ids = evidence(event.evidenceIds);
    if (!ids) return null;
    return {
      ...state,
      status: "ABORTED",
      abortedReason: event.reason,
      evidenceIds: mergeEvidence(state.evidenceIds, ids),
    };
  }

  return null;
};
