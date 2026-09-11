import type { ReflexDirection } from "../../reflex-planner/src/index.js";
import {
  EditorBrainV0,
  type EditorBrainOptionsV0,
  type EditorDecisionV0,
  type EditorStateV0,
} from "./index.js";

export interface TrackedSubjectStateV1 {
  readonly semanticId: string;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly accelerationX: number;
  readonly accelerationY: number;
  readonly trackConfidence: number;
  readonly driftRisk: number;
  readonly occlusion: number;
  readonly framingQuality: number;
  readonly isolationAvailable: boolean;
  readonly evidenceIds?: readonly string[];
}

export interface EditorStateV1 extends Omit<EditorStateV0,
  "motionMagnitude" | "motionDirection" | "subjectX" | "subjectY"> {
  readonly subject: TrackedSubjectStateV1 | null;
}
export type EditorBrainV1EscalationReason =
  | "SUBJECT_STATE_INVALID"
  | "TRACK_CONFIDENCE_LOW"
  | "TRACK_DRIFT_RISK_HIGH"
  | "SUBJECT_OCCLUDED"
  | "REFRAME_TARGET_REQUIRED";

export interface EditorDecisionV1 extends EditorDecisionV0 {
  readonly subjectId: string | null;
  readonly objectRationaleCodes: readonly string[];
  readonly objectEvidenceIds: readonly string[];
}

export interface EditorBrainOptionsV1 extends EditorBrainOptionsV0 {
  readonly minTrackConfidence?: number;
  readonly maxDriftRisk?: number;
  readonly maxOcclusion?: number;
  readonly edgeRiskThreshold?: number;
}

export const DEFAULT_EDITOR_BRAIN_V1_MIN_TRACK_CONFIDENCE = 0.62;
export const DEFAULT_EDITOR_BRAIN_V1_MAX_DRIFT_RISK = 0.35;
export const DEFAULT_EDITOR_BRAIN_V1_MAX_OCCLUSION = 0.85;
export const DEFAULT_EDITOR_BRAIN_V1_EDGE_RISK = 0.72;

const clamp01v1 = (value: number): number => Math.min(1, Math.max(0, value));
const finite01v1 = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1;
const motionDirection = (x: number, y: number): ReflexDirection => {
  if (Math.abs(x) < 0.02 && Math.abs(y) < 0.02) return "NONE";
  if (Math.abs(x) >= Math.abs(y)) return x >= 0 ? "RIGHT" : "LEFT";
  return y >= 0 ? "DOWN" : "UP";
};

const objectEscalation = (
  reason: EditorBrainV1EscalationReason,
  state: EditorStateV1,
): EditorDecisionV1 => ({
  route: "ESCALATE",
  technique: null,
  program: null,
  scores: [],
  confidence: 0,
  decisionMs: 0,
  rationaleCodes: [reason],
  evidenceIds: state.style.evidenceIds,
  escalationReason: reason,
  subjectId: state.subject?.semanticId ?? null,
  objectRationaleCodes: [reason],
  objectEvidenceIds: state.subject?.evidenceIds ?? [],
});

const subjectStateValid = (subject: TrackedSubjectStateV1): boolean =>
  subject.semanticId.length > 0
  && [subject.x, subject.y, subject.scale, subject.trackConfidence, subject.driftRisk,
    subject.occlusion, subject.framingQuality].every(finite01v1)
  && [subject.velocityX, subject.velocityY, subject.accelerationX,
    subject.accelerationY].every(Number.isFinite);
export class EditorBrainV1 {
  readonly v0: EditorBrainV0;
  readonly minTrackConfidence: number;
  readonly maxDriftRisk: number;
  readonly maxOcclusion: number;
  readonly edgeRiskThreshold: number;

  constructor(options: EditorBrainOptionsV1 = {}) {
    this.v0 = new EditorBrainV0(options);
    this.minTrackConfidence = options.minTrackConfidence ?? DEFAULT_EDITOR_BRAIN_V1_MIN_TRACK_CONFIDENCE;
    this.maxDriftRisk = options.maxDriftRisk ?? DEFAULT_EDITOR_BRAIN_V1_MAX_DRIFT_RISK;
    this.maxOcclusion = options.maxOcclusion ?? DEFAULT_EDITOR_BRAIN_V1_MAX_OCCLUSION;
    this.edgeRiskThreshold = options.edgeRiskThreshold ?? DEFAULT_EDITOR_BRAIN_V1_EDGE_RISK;
  }

  decide(state: EditorStateV1): EditorDecisionV1 {
    const subject = state.subject;
    if (!subject) return objectEscalation("SUBJECT_STATE_INVALID", state);
    if (!subjectStateValid(subject)) return objectEscalation("SUBJECT_STATE_INVALID", state);
    if (subject.trackConfidence < this.minTrackConfidence) {
      return objectEscalation("TRACK_CONFIDENCE_LOW", state);
    }
    if (subject.driftRisk > this.maxDriftRisk) {
      return objectEscalation("TRACK_DRIFT_RISK_HIGH", state);
    }
    if (subject.occlusion > this.maxOcclusion) {
      return objectEscalation("SUBJECT_OCCLUDED", state);
    }
    const edgeRisk = Math.max(Math.abs(subject.x - 0.5), Math.abs(subject.y - 0.5)) * 2;
    if ((edgeRisk >= this.edgeRiskThreshold || subject.framingQuality < 0.3) && !state.reframeTarget) {
      return objectEscalation("REFRAME_TARGET_REQUIRED", state);
    }

    const motionMagnitude = clamp01v1(Math.hypot(subject.velocityX, subject.velocityY));
    const baseDecision = this.v0.decide({
      ...state,
      motionMagnitude,
      motionDirection: motionDirection(subject.velocityX, subject.velocityY),
      subjectX: subject.x,
      subjectY: subject.y,
    });
    const objectRationaleCodes: string[] = ["TRACKED_SUBJECT_BOUND"];
    if (edgeRisk >= 0.5) objectRationaleCodes.push("TRACKED_SUBJECT_EDGE_RISK");
    if (subject.isolationAvailable) objectRationaleCodes.push("SUBJECT_ISOLATION_AVAILABLE");
    if (motionMagnitude >= 0.55) objectRationaleCodes.push("TRACKED_SUBJECT_HIGH_MOTION");
    if (subject.occlusion >= 0.45) objectRationaleCodes.push("PARTIAL_OCCLUSION_PRESENT");

    return {
      ...baseDecision,
      rationaleCodes: [...baseDecision.rationaleCodes, ...objectRationaleCodes],
      evidenceIds: [...new Set([...baseDecision.evidenceIds, ...(subject.evidenceIds ?? [])])],
      subjectId: subject.semanticId,
      objectRationaleCodes,
      objectEvidenceIds: subject.evidenceIds ?? [],
    };
  }
}
