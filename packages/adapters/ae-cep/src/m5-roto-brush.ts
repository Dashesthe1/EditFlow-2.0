import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";

export const M5_ROTO_BRUSH_ADAPTER_VERSION = "0.6.0-dev.1";

export type RotoBrushOperationV1 =
  | "INSPECT_SESSION"
  | "SEED_FOREGROUND"
  | "SEED_BACKGROUND"
  | "PROPAGATE_FORWARD"
  | "PROPAGATE_BACKWARD"
  | "REFINE_EDGE"
  | "FREEZE"
  | "UNFREEZE"
  | "REPAIR_STROKE"
  | "EXPORT_MATTE";

export type RotoBrushStrokeRoleV1 = "FOREGROUND" | "BACKGROUND" | "REFINE_EDGE";
export type RotoBrushExportKindV1 = "MASK" | "TRACK_MATTE";

export interface RotoBrushTargetV1 {
  readonly compHostId: number;
  readonly layerHostId: number;
  readonly expectedCompName: string;
  readonly expectedLayerName: string;
}

export interface RotoBrushPointV1 {
  readonly x: number;
  readonly y: number;
}

export interface RotoBrushStrokeV1 {
  readonly role: RotoBrushStrokeRoleV1;
  readonly pointsNormalized: readonly RotoBrushPointV1[];
  readonly radiusNormalized: number;
}

export interface RotoBrushTimeRangeV1 {
  readonly startTime: number;
  readonly endTime: number;
}

export interface RotoBrushExportV1 {
  readonly kind: RotoBrushExportKindV1;
  readonly stableId: string;
}

export interface RotoBrushActionRequestV1 {
  readonly operation: RotoBrushOperationV1;
  readonly target: RotoBrushTargetV1;
  readonly expectedSessionRevision?: string | null;
  readonly atTime?: number | null;
  readonly range?: RotoBrushTimeRangeV1 | null;
  readonly stroke?: RotoBrushStrokeV1 | null;
  readonly export?: RotoBrushExportV1 | null;
  readonly evidenceIds?: readonly string[];
}

export interface RotoBrushSemanticActionV1 extends RotoBrushActionRequestV1 {
  readonly expectedSessionRevision: string | null;
  readonly atTime: number | null;
  readonly range: RotoBrushTimeRangeV1 | null;
  readonly stroke: RotoBrushStrokeV1 | null;
  readonly export: RotoBrushExportV1 | null;
  readonly evidenceIds: readonly string[];
}

const OPERATIONS = new Set<RotoBrushOperationV1>([
  "INSPECT_SESSION",
  "SEED_FOREGROUND",
  "SEED_BACKGROUND",
  "PROPAGATE_FORWARD",
  "PROPAGATE_BACKWARD",
  "REFINE_EDGE",
  "FREEZE",
  "UNFREEZE",
  "REPAIR_STROKE",
  "EXPORT_MATTE",
]);

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const exactEvidence = (values: readonly string[] | undefined): readonly string[] => {
  if (!values) return [];
  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => value.length === 0)) throw new TypeError("evidenceIds cannot contain empty values.");
  return Object.freeze([...new Set(normalized)]);
};
const validTarget = (target: RotoBrushTargetV1): boolean =>
  Number.isInteger(target.compHostId) && target.compHostId > 0
  && Number.isInteger(target.layerHostId) && target.layerHostId > 0
  && nonEmptyString(target.expectedCompName)
  && nonEmptyString(target.expectedLayerName);
const validPoint = (point: RotoBrushPointV1): boolean =>
  finite(point.x) && finite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
const validateStroke = (stroke: RotoBrushStrokeV1 | null, expectedRole: RotoBrushStrokeRoleV1 | null): void => {
  if (!stroke) throw new TypeError("This Roto Brush operation requires stroke geometry.");
  if (expectedRole !== null && stroke.role !== expectedRole) throw new TypeError("Roto Brush stroke role does not match the semantic operation.");
  if (!Array.isArray(stroke.pointsNormalized) || stroke.pointsNormalized.length < 2 || stroke.pointsNormalized.some((point) => !validPoint(point))) {
    throw new TypeError("Roto Brush strokes require at least two finite normalized layer-space points in [0,1].");
  }
  if (!finite(stroke.radiusNormalized) || stroke.radiusNormalized <= 0 || stroke.radiusNormalized > 0.25) {
    throw new RangeError("Roto Brush radiusNormalized must be within (0, 0.25].");
  }
};
const validateRange = (range: RotoBrushTimeRangeV1 | null): void => {
  if (!range || !finite(range.startTime) || !finite(range.endTime) || range.startTime < 0 || range.endTime <= range.startTime) {
    throw new RangeError("Roto Brush propagation requires a finite non-negative increasing time range.");
  }
};
const requireMutationGuard = (revision: string | null, evidenceIds: readonly string[]): void => {
  if (!nonEmptyString(revision)) throw new TypeError("Mutating Roto Brush operations require expectedSessionRevision.");
  if (evidenceIds.length === 0) throw new TypeError("Mutating Roto Brush operations require at least one evidenceId.");
};

export const prepareRotoBrushSemanticActionV1 = (input: RotoBrushActionRequestV1): RotoBrushSemanticActionV1 => {
  if (!OPERATIONS.has(input.operation)) throw new TypeError("Unsupported Roto Brush semantic operation.");
  if (!input.target || !validTarget(input.target)) throw new TypeError("Roto Brush action requires an exact comp/layer target binding.");
  const expectedSessionRevision = input.expectedSessionRevision ?? null;
  const atTime = input.atTime ?? null;
  const range = input.range ?? null;
  const stroke = input.stroke ?? null;
  const exportValue = input.export ?? null;
  const evidenceIds = exactEvidence(input.evidenceIds);
  if (input.operation === "INSPECT_SESSION") {
    return Object.freeze({ ...input, expectedSessionRevision, atTime, range, stroke, export: exportValue, evidenceIds });
  }
  requireMutationGuard(expectedSessionRevision, evidenceIds);
  if (input.operation === "SEED_FOREGROUND" || input.operation === "SEED_BACKGROUND" || input.operation === "REPAIR_STROKE") {
    if (!finite(atTime) || atTime < 0) throw new RangeError("Stroke operations require a finite non-negative atTime.");
    const expectedRole = input.operation === "SEED_FOREGROUND" ? "FOREGROUND"
      : input.operation === "SEED_BACKGROUND" ? "BACKGROUND" : null;
    validateStroke(stroke, expectedRole);
  }
  if (input.operation === "PROPAGATE_FORWARD" || input.operation === "PROPAGATE_BACKWARD") validateRange(range);
  if (input.operation === "REFINE_EDGE") {
    if (!finite(atTime) || atTime < 0) throw new RangeError("REFINE_EDGE requires a finite non-negative atTime.");
    validateStroke(stroke, "REFINE_EDGE");
  }
  if (input.operation === "EXPORT_MATTE") {
    if (!exportValue || (exportValue.kind !== "MASK" && exportValue.kind !== "TRACK_MATTE") || !nonEmptyString(exportValue.stableId)) {
      throw new TypeError("EXPORT_MATTE requires an explicit MASK or TRACK_MATTE stable export identity.");
    }
  }
  return Object.freeze({ ...input, expectedSessionRevision, atTime, range, stroke, export: exportValue, evidenceIds });
};

const route = (suffix: string) => Object.freeze({
  routeId: asRouteId(`ae.m5.roto-brush.${suffix}.v1`),
  kind: "SUBSYSTEM_ADAPTER" as const,
  available: false,
  adapterVersion: M5_ROTO_BRUSH_ADAPTER_VERSION,
  limitations: Object.freeze([
    "Declared semantic adapter contract only; no production execution route is registered.",
    "Any future UI-backed implementation must use verified target binding and pre/post session evidence.",
  ]),
});

const capability = (
  id: string,
  description: string,
  suffix: string,
  riskClass: CapabilityRecord["riskClass"],
  rollbackStrategy: string,
): CapabilityRecord => Object.freeze({
  id: asCapabilityId(id),
  domain: "tracking",
  description,
  status: "ADAPTER_REQUIRED",
  proofMaturity: "DECLARED",
  routes: Object.freeze([route(suffix)]),
  requiredEnvironment: Object.freeze({ afterEffects: true, interactiveSubsystem: "ROTO_BRUSH_REFINE_EDGE" }),
  inputSchemaRef: "RotoBrushActionRequestV1",
  outputSchemaRef: "RotoBrushSessionEvidenceV1 (future retained adapter readback)",
  readbackStrategy: riskClass === "R0_READ_ONLY"
    ? "EXACT_ROTO_BRUSH_SESSION_READBACK_REQUIRED"
    : "PRE_POST_EXACT_ROTO_BRUSH_SESSION_READBACK_REQUIRED",
  visualProofProfile: null,
  rollbackStrategy,
  riskClass,
  limitations: Object.freeze([
    "Roto Brush / Refine Edge is an interactive AE subsystem and must not be represented as ordinary effect-property access.",
    "No screen coordinates, raw mouse commands, inferred subject identity, or unverified session state are accepted by this semantic contract.",
  ]),
  fallbackPolicy: "EXPLICIT_ONLY",
});

export const M5_ROTO_BRUSH_SESSION_INSPECT_CAPABILITY_V1 = capability(
  "ae.roto_brush.session.inspect",
  "Inspect exact Roto Brush / Refine Edge session identity and progress state without mutation.",
  "session-inspect",
  "R0_READ_ONLY",
  "NONE_REQUIRED",
);
export const M5_ROTO_BRUSH_SEED_CAPABILITY_V1 = capability(
  "ae.roto_brush.seed.apply",
  "Apply evidence-bound foreground/background Roto Brush seed strokes in normalized layer space.",
  "seed-apply",
  "R4_EXTERNAL_UI",
  "SESSION_CHECKPOINT_OR_PROOF_OWNED_CLEANUP",
);
export const M5_ROTO_BRUSH_PROPAGATE_CAPABILITY_V1 = capability(
  "ae.roto_brush.propagate",
  "Propagate an exact Roto Brush session forward or backward over a bounded time range.",
  "propagate",
  "R4_EXTERNAL_UI",
  "SESSION_CHECKPOINT_OR_PROOF_OWNED_CLEANUP",
);
export const M5_ROTO_BRUSH_REFINE_EDGE_CAPABILITY_V1 = capability(
  "ae.roto_brush.refine_edge.apply",
  "Apply bounded Refine Edge semantics to an evidence-bound Roto Brush session.",
  "refine-edge",
  "R4_EXTERNAL_UI",
  "SESSION_CHECKPOINT_OR_PROOF_OWNED_CLEANUP",
);
export const M5_ROTO_BRUSH_FREEZE_CAPABILITY_V1 = capability(
  "ae.roto_brush.freeze.set",
  "Freeze or unfreeze a verified Roto Brush session without conflating freeze with ordinary effect toggles.",
  "freeze-set",
  "R4_EXTERNAL_UI",
  "SESSION_CHECKPOINT_OR_PROOF_OWNED_CLEANUP",
);
export const M5_ROTO_BRUSH_REPAIR_CAPABILITY_V1 = capability(
  "ae.roto_brush.repair.apply",
  "Apply an evidence-bound manual Roto Brush repair stroke after drift or matte failure.",
  "repair-apply",
  "R4_EXTERNAL_UI",
  "SESSION_CHECKPOINT_OR_PROOF_OWNED_CLEANUP",
);
export const M5_ROTO_BRUSH_EXPORT_CAPABILITY_V1 = capability(
  "ae.roto_brush.export_matte",
  "Export a verified Roto Brush result into an explicitly identified AE mask or track-matte output.",
  "export-matte",
  "R4_EXTERNAL_UI",
  "REMOVE_TRANSACTION_OWNED_EXPORT_OR_RESTORE_CHECKPOINT",
);

export const M5_ROTO_BRUSH_CAPABILITIES_V1: readonly CapabilityRecord[] = Object.freeze([
  M5_ROTO_BRUSH_SESSION_INSPECT_CAPABILITY_V1,
  M5_ROTO_BRUSH_SEED_CAPABILITY_V1,
  M5_ROTO_BRUSH_PROPAGATE_CAPABILITY_V1,
  M5_ROTO_BRUSH_REFINE_EDGE_CAPABILITY_V1,
  M5_ROTO_BRUSH_FREEZE_CAPABILITY_V1,
  M5_ROTO_BRUSH_REPAIR_CAPABILITY_V1,
  M5_ROTO_BRUSH_EXPORT_CAPABILITY_V1,
]);