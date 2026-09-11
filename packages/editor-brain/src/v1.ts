import { performance } from "node:perf_hooks";
import type { ReflexDirection } from "../../reflex-planner/src/index.js";
import {
  findHeroSubjectV1,
  isEditorCapabilityUsableV1,
  validateEditorSubjectStateV1,
  type EditorObjectContextV1,
  type EditorSubjectStateV1,
} from "../../editor-state/src/index.js";
import type {
  EditorBrainPolicyV0,
  EditorDecisionV0,
  EditorStateV0,
} from "./index.js";

export type EditorIntentV1 =
  | "DELEGATE_V0"
  | "TRACKED_REFRAME"
  | "PRESERVE_SUBJECT"
  | "REQUEST_TRACK"
  | "REPAIR_TRACK"
  | "FOREGROUND_OCCLUSION_CANDIDATE";

export interface EditorDecisionV1 {
  readonly route: "LOCAL" | "ESCALATE";
  readonly intent: EditorIntentV1;
  readonly subjectId: string | null;
  readonly confidence: number;
  readonly decisionMs: number;
  readonly rationaleCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly requiredCapabilityIds: readonly string[];
  readonly escalationReason: string | null;
  readonly delegatedStateV0: EditorStateV0 | null;
  readonly delegatedDecisionV0: EditorDecisionV0 | null;
}

export interface EditorBrainV1Options {
  /** Minimum confidence for subject identity/geometry observations. */
  readonly minObjectConfidence?: number;
  /** Minimum confidence for decisions that depend on temporal tracking. */
  readonly minTrackConfidence?: number;
  readonly decisionBudgetMs?: number;
  readonly clock?: () => number;
}

export const DEFAULT_EDITOR_BRAIN_V1_MIN_OBJECT_CONFIDENCE = 0.7;
export const DEFAULT_EDITOR_BRAIN_V1_MIN_TRACK_CONFIDENCE = 0.72;
export const DEFAULT_EDITOR_BRAIN_V1_DECISION_BUDGET_MS = 50;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const toReflexDirection = (subject: EditorSubjectStateV1): ReflexDirection => {
  if (subject.motionDirection === "LEFT") return "LEFT";
  if (subject.motionDirection === "RIGHT") return "RIGHT";
  if (subject.motionDirection === "UP") return "UP";
  if (subject.motionDirection === "DOWN") return "DOWN";
  return "NONE";
};

const subjectObjectConfidence = (subject: EditorSubjectStateV1): number =>
  Math.min(subject.observationConfidence, subject.identityConfidence, subject.geometryConfidence);

const unique = (values: readonly string[]): readonly string[] => [...new Set(values)];

export class EditorBrainV1 {
  readonly v0: EditorBrainPolicyV0;
  readonly minObjectConfidence: number;
  readonly minTrackConfidence: number;
  readonly decisionBudgetMs: number;
  readonly clock: () => number;

  constructor(v0: EditorBrainPolicyV0, options: EditorBrainV1Options = {}) {
    this.v0 = v0;
    this.minObjectConfidence = options.minObjectConfidence ?? DEFAULT_EDITOR_BRAIN_V1_MIN_OBJECT_CONFIDENCE;
    this.minTrackConfidence = options.minTrackConfidence ?? DEFAULT_EDITOR_BRAIN_V1_MIN_TRACK_CONFIDENCE;
    this.decisionBudgetMs = options.decisionBudgetMs ?? DEFAULT_EDITOR_BRAIN_V1_DECISION_BUDGET_MS;
    this.clock = options.clock ?? (() => performance.now());
  }

  decide(baseState: EditorStateV0, context: EditorObjectContextV1): EditorDecisionV1 {
    const started = this.clock();
    const subject = findHeroSubjectV1(context);

    if (!subject) {
      return this.#delegate(started, baseState, null, [
        "NO_UNAMBIGUOUS_HERO_SUBJECT",
        "OBJECT_AWARE_ACTION_NOT_REQUIRED",
      ]);
    }

    const validationErrors = validateEditorSubjectStateV1(subject);
    if (validationErrors.length > 0) {
      return this.#escalate(started, "DELEGATE_V0", subject, "INVALID_OBJECT_STATE", validationErrors);
    }

    const objectConfidence = subjectObjectConfidence(subject);
    if (objectConfidence < this.minObjectConfidence) {
      return this.#escalate(started, "DELEGATE_V0", subject, "LOW_OBJECT_CONFIDENCE", [
        "SUBJECT_IDENTITY_OR_GEOMETRY_UNTRUSTED",
      ], [], objectConfidence);
    }

    if (subject.trackStatus === "DRIFTING" || subject.trackStatus === "LOST") {
      const repair = context.capabilities.driftRepair;
      if (!isEditorCapabilityUsableV1(repair, "STRUCTURAL")) {
        return this.#escalate(started, "REPAIR_TRACK", subject, "DRIFT_REPAIR_CAPABILITY_UNAVAILABLE", [
          `TRACK_${subject.trackStatus}`,
          "DO_NOT_CONTINUE_DRIFTING_TRACK",
        ], repair ? [repair.capabilityId] : []);
      }
      return this.#escalate(started, "REPAIR_TRACK", subject, "TRACK_REPAIR_EXECUTION_HANDOFF_REQUIRED", [
        `TRACK_${subject.trackStatus}`,
        "DRIFT_REPAIR_CAPABILITY_PROVEN",
        "DO_NOT_MUTATE_FROM_BRAIN",
      ], [repair.capabilityId], Math.min(objectConfidence, subject.trackConfidence));
    }

    if (subject.trackStatus === "AT_RISK" ||
      (subject.trackStatus === "STABLE" && subject.trackConfidence < this.minTrackConfidence)) {
      return this.#escalate(started, "REQUEST_TRACK", subject, "UNRELIABLE_SUBJECT_TRACK", [
        "TRACK_CONFIDENCE_BELOW_DECISION_FLOOR",
        "REJECT_UNRELIABLE_TRACK",
      ], [], Math.min(objectConfidence, subject.trackConfidence));
    }

    const foregroundCoverage = subject.foregroundOccluderCoverage ?? 0;
    const occlusionCandidate = subject.foregroundOccluderEntityId &&
      foregroundCoverage >= 0.55 &&
      subject.occlusionConfidence >= 0.7 &&
      baseState.transitionPressure >= 0.6;

    if (occlusionCandidate) {
      const pointTracking = context.capabilities.pointTracking;
      if (!isEditorCapabilityUsableV1(pointTracking, "STRUCTURAL")) {
        return this.#escalate(started, "FOREGROUND_OCCLUSION_CANDIDATE", subject,
          "POINT_TRACKING_CAPABILITY_UNAVAILABLE", [
            "FOREGROUND_OCCLUDER_COVERS_TRANSITION_REGION",
            "TRANSITION_PRESSURE_HIGH",
            "CAPABILITY_GATE_BLOCKED",
          ], pointTracking ? [pointTracking.capabilityId] : []);
      }
      return this.#escalate(started, "FOREGROUND_OCCLUSION_CANDIDATE", subject,
        "OCCLUSION_TECHNIQUE_RECIPE_HANDOFF_REQUIRED", [
          "FOREGROUND_OCCLUDER_COVERS_TRANSITION_REGION",
          "TRANSITION_PRESSURE_HIGH",
          "POINT_TRACKING_CAPABILITY_PROVEN",
          "TECHNIQUE_REQUIRES_DETERMINISTIC_RECIPE",
        ], [pointTracking.capabilityId], Math.min(objectConfidence, subject.occlusionConfidence));
    }

    if (subject.occludedFraction >= 0.5 || subject.framingQuality < 0.25) {
      return this.#localNoMutation(started, "PRESERVE_SUBJECT", subject, [
        subject.occludedFraction >= 0.5 ? "SUBJECT_HEAVILY_OCCLUDED" : "SUBJECT_FRAMING_CRITICAL",
        "PRESERVE_SUBJECT_READABILITY",
      ], Math.min(objectConfidence, Math.max(subject.occlusionConfidence, 1 - subject.framingQuality)));
    }

    const derivedState = this.#deriveV0State(baseState, context, subject);
    const delegated = this.v0.decide(derivedState);
    const offCenter = Math.max(Math.abs(subject.center.x - 0.5) * 2, Math.abs(subject.center.y - 0.5) * 2);

    if (delegated.route === "LOCAL" && delegated.technique === "REFRAME") {
      if (subject.trackStatus !== "STABLE" || subject.trackConfidence < this.minTrackConfidence) {
        return this.#escalate(started, "REQUEST_TRACK", subject, "TRACK_REQUIRED_FOR_OBJECT_REFRAME", [
          "SUBJECT_COMPOSITION_OFF_CENTER",
          "REFRAME_TARGET_PRESENT",
          "TRACK_NOT_TRUSTED",
        ], [], Math.min(objectConfidence, subject.trackConfidence));
      }
      return this.#delegatedDecision(started, "TRACKED_REFRAME", subject, derivedState, delegated, [
        "PERSISTENT_SUBJECT_IDENTITY",
        "TRACK_CONFIDENCE_ACCEPTED",
        offCenter >= 0.35 ? "SUBJECT_COMPOSITION_OFF_CENTER" : "SUBJECT_REFRAME_REQUESTED",
      ]);
    }

    const extraRationale: string[] = ["OBJECT_STATE_ACCEPTED"];
    if (subject.isolationStatus === "NOT_NEEDED") extraRationale.push("ISOLATION_UNNECESSARY");
    if (subject.acceleration > 0.25) extraRationale.push("SUBJECT_ACCELERATING");
    if (subject.trackStatus === "STABLE") extraRationale.push("MOTION_CONTINUITY_TRUSTED");
    return this.#delegatedDecision(started, "DELEGATE_V0", subject, derivedState, delegated, extraRationale);
  }

  #deriveV0State(
    baseState: EditorStateV0,
    context: EditorObjectContextV1,
    subject: EditorSubjectStateV1,
  ): EditorStateV0 {
    return {
      ...baseState,
      subjectX: subject.center.x,
      subjectY: subject.center.y,
      motionMagnitude: clamp01(subject.speed),
      motionDirection: toReflexDirection(subject),
      reframeTarget: context.reframeTarget ?? baseState.reframeTarget,
    };
  }

  #delegate(
    started: number,
    state: EditorStateV0,
    subject: EditorSubjectStateV1 | null,
    rationale: readonly string[],
  ): EditorDecisionV1 {
    const decision = this.v0.decide(state);
    return this.#delegatedDecision(started, "DELEGATE_V0", subject, state, decision, rationale);
  }

  #delegatedDecision(
    started: number,
    intent: EditorIntentV1,
    subject: EditorSubjectStateV1 | null,
    state: EditorStateV0,
    delegated: EditorDecisionV0,
    rationale: readonly string[],
  ): EditorDecisionV1 {
    const elapsed = this.clock() - started;
    if (elapsed > this.decisionBudgetMs) {
      return this.#escalate(started, intent, subject, "DECISION_BUDGET_EXCEEDED", rationale);
    }
    if (delegated.route === "ESCALATE") {
      return this.#escalate(started, intent, subject, delegated.escalationReason ?? "V0_ESCALATION", [
        ...rationale,
        ...delegated.rationaleCodes,
      ], [], delegated.confidence);
    }
    return {
      route: "LOCAL",
      intent,
      subjectId: subject?.entityId ?? null,
      confidence: subject ? Math.min(subjectObjectConfidence(subject), delegated.confidence) : delegated.confidence,
      decisionMs: elapsed,
      rationaleCodes: unique([...rationale, ...delegated.rationaleCodes]),
      evidenceRefs: unique([...(subject?.evidenceRefs ?? []), ...delegated.evidenceIds]),
      requiredCapabilityIds: [],
      escalationReason: null,
      delegatedStateV0: state,
      delegatedDecisionV0: delegated,
    };
  }

  #localNoMutation(
    started: number,
    intent: EditorIntentV1,
    subject: EditorSubjectStateV1,
    rationale: readonly string[],
    confidence: number,
  ): EditorDecisionV1 {
    const elapsed = this.clock() - started;
    if (elapsed > this.decisionBudgetMs) {
      return this.#escalate(started, intent, subject, "DECISION_BUDGET_EXCEEDED", rationale, [], confidence);
    }
    return {
      route: "LOCAL",
      intent,
      subjectId: subject.entityId,
      confidence: clamp01(confidence),
      decisionMs: elapsed,
      rationaleCodes: [...rationale],
      evidenceRefs: [...subject.evidenceRefs],
      requiredCapabilityIds: [],
      escalationReason: null,
      delegatedStateV0: null,
      delegatedDecisionV0: null,
    };
  }

  #escalate(
    started: number,
    intent: EditorIntentV1,
    subject: EditorSubjectStateV1 | null,
    reason: string,
    rationale: readonly string[],
    requiredCapabilityIds: readonly string[] = [],
    confidence = 0,
  ): EditorDecisionV1 {
    return {
      route: "ESCALATE",
      intent,
      subjectId: subject?.entityId ?? null,
      confidence: clamp01(confidence),
      decisionMs: this.clock() - started,
      rationaleCodes: unique([reason, ...rationale]),
      evidenceRefs: [...(subject?.evidenceRefs ?? [])],
      requiredCapabilityIds: unique(requiredCapabilityIds),
      escalationReason: reason,
      delegatedStateV0: null,
      delegatedDecisionV0: null,
    };
  }
}
