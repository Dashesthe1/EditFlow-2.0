import type { CapabilityStatus, ProofMaturity } from "../../core-contracts/src/index.js";

export type EditorMotionDirectionV1 = "LEFT" | "RIGHT" | "UP" | "DOWN" | "STILL" | "UNKNOWN";
export type EditorTrackStatusV1 = "NOT_TRACKED" | "STABLE" | "AT_RISK" | "DRIFTING" | "LOST";
export type EditorIsolationStatusV1 = "NOT_NEEDED" | "AVAILABLE" | "LOW_CONFIDENCE" | "UNAVAILABLE";

export interface EditorNormalizedPointV1 {
  readonly x: number;
  readonly y: number;
}

export interface EditorNormalizedBoxV1 {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface EditorAttachPointV1 {
  readonly id: string;
  readonly kind: "CENTER" | "FACE" | "HAND" | "HEAD" | "CUSTOM";
  readonly point: EditorNormalizedPointV1;
  readonly confidence: number;
}

export interface EditorSubjectStateV1 {
  readonly entityId: string;
  readonly label?: string;
  readonly center: EditorNormalizedPointV1;
  readonly box: EditorNormalizedBoxV1;
  /** Normalized screen-area estimate in [0,1]. */
  readonly scale: number;
  /** Normalized screen-widths per second. */
  readonly speed: number;
  /** Normalized screen-widths per second squared. */
  readonly acceleration: number;
  readonly motionDirection: EditorMotionDirectionV1;
  readonly observationConfidence: number;
  readonly identityConfidence: number;
  readonly geometryConfidence: number;
  readonly trackConfidence: number;
  readonly occlusionConfidence: number;
  readonly trackStatus: EditorTrackStatusV1;
  readonly isolationStatus: EditorIsolationStatusV1;
  readonly occludedFraction: number;
  readonly foregroundOccluderEntityId?: string | null;
  readonly foregroundOccluderCoverage?: number;
  readonly framingQuality: number;
  readonly attachPoints: readonly EditorAttachPointV1[];
  readonly evidenceRefs: readonly string[];
  readonly observedAtMs: number;
}

export interface EditorCapabilityEvidenceV1 {
  readonly capabilityId: string;
  readonly status: CapabilityStatus;
  readonly proofMaturity: ProofMaturity;
  readonly available: boolean;
  readonly limitations?: readonly string[];
}

export interface EditorM4CapabilitySetV1 {
  readonly pointTracking?: EditorCapabilityEvidenceV1;
  readonly rotationScaleTracking?: EditorCapabilityEvidenceV1;
  readonly perspectiveTracking?: EditorCapabilityEvidenceV1;
  readonly maskTracking?: EditorCapabilityEvidenceV1;
  readonly faceTracking?: EditorCapabilityEvidenceV1;
  readonly stabilization?: EditorCapabilityEvidenceV1;
  readonly semanticAttachPoints?: EditorCapabilityEvidenceV1;
  readonly segmentation?: EditorCapabilityEvidenceV1;
  readonly matteExport?: EditorCapabilityEvidenceV1;
  readonly driftRepair?: EditorCapabilityEvidenceV1;
}

export interface EditorObjectContextV1 {
  readonly heroSubjectId?: string | null;
  readonly subjects: readonly EditorSubjectStateV1[];
  readonly capabilities: EditorM4CapabilitySetV1;
  readonly reframeTarget?: Readonly<Record<string, unknown>>;
}

const PROOF_RANK: Readonly<Record<ProofMaturity, number>> = {
  DECLARED: 0,
  STRUCTURAL: 1,
  VISUAL: 2,
  ROLLBACK: 3,
  TRANSFER: 4,
  ROBUST: 5,
};

export const editorFinite01V1 = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= 1;

export const isEditorCapabilityUsableV1 = (
  capability: EditorCapabilityEvidenceV1 | undefined,
  minimumProof: ProofMaturity = "STRUCTURAL",
): boolean => {
  if (!capability?.available) return false;
  if (capability.status !== "FULL" && capability.status !== "PARTIAL") return false;
  return PROOF_RANK[capability.proofMaturity] >= PROOF_RANK[minimumProof];
};

export const findHeroSubjectV1 = (context: EditorObjectContextV1): EditorSubjectStateV1 | null => {
  if (context.heroSubjectId) {
    return context.subjects.find((subject) => subject.entityId === context.heroSubjectId) ?? null;
  }
  if (context.subjects.length === 1) return context.subjects[0] ?? null;
  const ranked = [...context.subjects].sort((a, b) => {
    const aScore = a.identityConfidence * a.observationConfidence;
    const bScore = b.identityConfidence * b.observationConfidence;
    return bScore - aScore;
  });
  const first = ranked[0];
  const second = ranked[1];
  if (!first) return null;
  if (!second) return first;
  const firstScore = first.identityConfidence * first.observationConfidence;
  const secondScore = second.identityConfidence * second.observationConfidence;
  return firstScore - secondScore >= 0.15 ? first : null;
};

export const validateEditorSubjectStateV1 = (subject: EditorSubjectStateV1): readonly string[] => {
  const errors: string[] = [];
  const finite01Fields: readonly [string, number][] = [
    ["center.x", subject.center.x],
    ["center.y", subject.center.y],
    ["box.left", subject.box.left],
    ["box.top", subject.box.top],
    ["box.right", subject.box.right],
    ["box.bottom", subject.box.bottom],
    ["scale", subject.scale],
    ["observationConfidence", subject.observationConfidence],
    ["identityConfidence", subject.identityConfidence],
    ["geometryConfidence", subject.geometryConfidence],
    ["trackConfidence", subject.trackConfidence],
    ["occlusionConfidence", subject.occlusionConfidence],
    ["occludedFraction", subject.occludedFraction],
    ["framingQuality", subject.framingQuality],
  ];
  for (const [name, value] of finite01Fields) {
    if (!editorFinite01V1(value)) errors.push(`INVALID_${name.toUpperCase().replaceAll(".", "_")}`);
  }
  if (!Number.isFinite(subject.speed) || subject.speed < 0) errors.push("INVALID_SPEED");
  if (!Number.isFinite(subject.acceleration)) errors.push("INVALID_ACCELERATION");
  if (!Number.isFinite(subject.observedAtMs) || subject.observedAtMs < 0) errors.push("INVALID_OBSERVED_AT_MS");
  if (subject.box.left > subject.box.right || subject.box.top > subject.box.bottom) errors.push("INVALID_BOUNDING_BOX_ORDER");
  if (subject.foregroundOccluderCoverage !== undefined && !editorFinite01V1(subject.foregroundOccluderCoverage)) {
    errors.push("INVALID_FOREGROUND_OCCLUDER_COVERAGE");
  }
  for (const attachPoint of subject.attachPoints) {
    if (!editorFinite01V1(attachPoint.point.x) || !editorFinite01V1(attachPoint.point.y) || !editorFinite01V1(attachPoint.confidence)) {
      errors.push(`INVALID_ATTACH_POINT_${attachPoint.id}`);
    }
  }
  return errors;
};
