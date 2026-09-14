import type {
  TrackingRepairTriggerReasonV1,
  TrackingRepairTriggerV1,
} from "./repair-resume.js";

export const AUTOMATIC_TRACKING_REPAIR_MONITOR_STATUSES_V1 = [
  "GOOD",
  "INSUFFICIENT_BASELINE",
  "PENDING_FAILURE",
  "ESCALATE",
  "LATCHED",
] as const;

export type AutomaticTrackingRepairMonitorStatusV1 =
  (typeof AUTOMATIC_TRACKING_REPAIR_MONITOR_STATUSES_V1)[number];

export interface AutomaticTrackingRepairPolicyV1 {
  readonly minTrackingConfidence: number;
  readonly maxDriftRisk: number;
  readonly maxOcclusion: number;
  readonly minIdentityConfidence: number;
  readonly failurePersistenceSamples: number;
}

export interface AutomaticTrackingRepairSampleV1 {
  readonly semanticId: string;
  readonly timestampMs: number;
  readonly trackConfidence: number;
  readonly driftRisk: number;
  readonly occlusion: number;
  readonly identityConfidence?: number | null;
  readonly evidenceIds: readonly string[];
}

export interface AutomaticTrackingRepairEvaluationV1 {
  readonly semanticId: string;
  readonly status: AutomaticTrackingRepairMonitorStatusV1;
  readonly primaryReason: TrackingRepairTriggerReasonV1 | null;
  readonly consecutiveFailureSamples: number;
  readonly lastGoodTimestampMs: number | null;
  readonly trigger: TrackingRepairTriggerV1 | null;
  readonly evidenceIds: readonly string[];
}

interface AutomaticTrackingRepairMonitorStateV1 {
  lastTimestampMs: number;
  lastGoodTimestampMs: number | null;
  pendingReason: TrackingRepairTriggerReasonV1 | null;
  pendingCount: number;
  pendingEvidenceIds: string[];
  firstFailureTimestampMs: number | null;
  latchedReason: TrackingRepairTriggerReasonV1 | null;
}

const finite01 = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const finiteNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const positiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) > 0;
const normalizedEvidence = (value: unknown): readonly string[] | null => {
  if (!Array.isArray(value)) return null;
  const accepted = [...new Set(value.filter(nonEmpty))];
  return accepted.length > 0 ? accepted : null;
};

const validPolicy = (policy: AutomaticTrackingRepairPolicyV1): boolean =>
  !!policy
  && finite01(policy.minTrackingConfidence)
  && finite01(policy.maxDriftRisk)
  && finite01(policy.maxOcclusion)
  && finite01(policy.minIdentityConfidence)
  && positiveInteger(policy.failurePersistenceSamples);

const failureReason = (
  sample: AutomaticTrackingRepairSampleV1,
  policy: AutomaticTrackingRepairPolicyV1,
): TrackingRepairTriggerReasonV1 | null => {
  if (sample.identityConfidence !== undefined && sample.identityConfidence !== null
    && sample.identityConfidence < policy.minIdentityConfidence) return "IDENTITY_UNCERTAIN";
  if (sample.occlusion > policy.maxOcclusion) return "SUBJECT_OCCLUDED";
  if (sample.driftRisk > policy.maxDriftRisk) return "TRACK_DRIFT_RISK_HIGH";
  if (sample.trackConfidence < policy.minTrackingConfidence) return "TRACK_CONFIDENCE_LOW";
  return null;
};

const validSample = (sample: AutomaticTrackingRepairSampleV1): boolean => {
  if (!sample || !nonEmpty(sample.semanticId) || !finiteNonNegative(sample.timestampMs)) return false;
  if (![sample.trackConfidence, sample.driftRisk, sample.occlusion].every(finite01)) return false;
  if (sample.identityConfidence !== undefined && sample.identityConfidence !== null
    && !finite01(sample.identityConfidence)) return false;
  return normalizedEvidence(sample.evidenceIds) !== null;
};

const evaluation = (
  sample: AutomaticTrackingRepairSampleV1,
  state: AutomaticTrackingRepairMonitorStateV1,
  status: AutomaticTrackingRepairMonitorStatusV1,
  reason: TrackingRepairTriggerReasonV1 | null,
  trigger: TrackingRepairTriggerV1 | null,
  evidenceIds: readonly string[],
): AutomaticTrackingRepairEvaluationV1 => ({
  semanticId: sample.semanticId,
  status,
  primaryReason: reason,
  consecutiveFailureSamples: state.pendingCount,
  lastGoodTimestampMs: state.lastGoodTimestampMs,
  trigger,
  evidenceIds,
});

export class AutomaticTrackingRepairMonitorV1 {
  readonly policy: AutomaticTrackingRepairPolicyV1;
  #states = new Map<string, AutomaticTrackingRepairMonitorStateV1>();

  constructor(policy: AutomaticTrackingRepairPolicyV1) {
    if (!validPolicy(policy)) throw new TypeError("Invalid automatic tracking repair policy.");
    this.policy = { ...policy };
  }

  update(sample: AutomaticTrackingRepairSampleV1): AutomaticTrackingRepairEvaluationV1 | null {
    if (!validSample(sample)) return null;
    const ids = normalizedEvidence(sample.evidenceIds)!;
    const existing = this.#states.get(sample.semanticId);
    if (existing && sample.timestampMs <= existing.lastTimestampMs) return null;
    const state: AutomaticTrackingRepairMonitorStateV1 = existing ?? {
      lastTimestampMs: -1,
      lastGoodTimestampMs: null,
      pendingReason: null,
      pendingCount: 0,
      pendingEvidenceIds: [],
      firstFailureTimestampMs: null,
      latchedReason: null,
    };
    state.lastTimestampMs = sample.timestampMs;

    if (state.latchedReason) {
      this.#states.set(sample.semanticId, state);
      return evaluation(sample, state, "LATCHED", state.latchedReason, null, ids);
    }

    const reason = failureReason(sample, this.policy);
    if (reason === null) {
      state.lastGoodTimestampMs = sample.timestampMs;
      state.pendingReason = null;
      state.pendingCount = 0;
      state.pendingEvidenceIds = [];
      state.firstFailureTimestampMs = null;
      this.#states.set(sample.semanticId, state);
      return evaluation(sample, state, "GOOD", null, null, ids);
    }

    if (state.lastGoodTimestampMs === null) {
      state.pendingReason = null;
      state.pendingCount = 0;
      state.pendingEvidenceIds = [];
      state.firstFailureTimestampMs = null;
      this.#states.set(sample.semanticId, state);
      return evaluation(sample, state, "INSUFFICIENT_BASELINE", reason, null, ids);
    }

    if (state.pendingReason !== reason) {
      state.pendingReason = reason;
      state.pendingCount = 1;
      state.pendingEvidenceIds = [...ids];
      state.firstFailureTimestampMs = sample.timestampMs;
    } else {
      state.pendingCount += 1;
      state.pendingEvidenceIds = [...new Set([...state.pendingEvidenceIds, ...ids])];
    }

    if (state.pendingCount < this.policy.failurePersistenceSamples) {
      this.#states.set(sample.semanticId, state);
      return evaluation(sample, state, "PENDING_FAILURE", reason, null, state.pendingEvidenceIds);
    }

    const trigger: TrackingRepairTriggerV1 = {
      reason,
      failureTimestampMs: state.firstFailureTimestampMs!,
      lastGoodTimestampMs: state.lastGoodTimestampMs,
      evidenceIds: [...state.pendingEvidenceIds],
    };
    state.latchedReason = reason;
    this.#states.set(sample.semanticId, state);
    return evaluation(sample, state, "ESCALATE", reason, trigger, trigger.evidenceIds);
  }

  reset(semanticId?: string): void {
    if (semanticId) this.#states.delete(semanticId);
    else this.#states.clear();
  }
}
