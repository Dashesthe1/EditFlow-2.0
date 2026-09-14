import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";
import type {
  AeMaskPathKeyframeV12,
  AeMaskSetPathPayloadV12,
  AeMaskShapeV12,
  AePoint2V12,
  AeStableObjectRefV12,
  AeMaskRefV12,
} from "./protocol-v1_2.js";

export const M4_MASK_POINT_REPAIR_CAPABILITY_V1: CapabilityRecord = {
  id: asCapabilityId("tracking.mask_point_repair.plan"),
  domain: "tracking",
  description: "Plan one evidence-backed mask vertex/tangent repair through the accepted protocol 1.2 mask.set_path surface while preserving all untouched geometry and animation keys.",
  status: "PARTIAL",
  proofMaturity: "STRUCTURAL",
  routes: [{ routeId: asRouteId("m4.tracking.mask-point-repair-plan.v1"), kind: "SUBSYSTEM_ADAPTER", available: true, adapterVersion: "0.5.0-dev.1" }],
  inputSchemaRef: "M4MaskPointRepairInputV1",
  outputSchemaRef: "M4MaskPointRepairPlanV1 | null",
  readbackStrategy: "EXACT_PROTOCOL_1_2_MASK_READBACK_PLUS_POST_WRITE_MASK_READBACK",
  visualProofProfile: null,
  rollbackStrategy: "PLANNER_NONE; HOST_WRITE_INHERITS_PROTOCOL_1_2_AE_UNDO_GROUP",
  riskClass: "R0_READ_ONLY",
  limitations: [
    "The planner repairs only an existing exact mask path; it never creates a mask or guesses mask identity.",
    "Animated repair is allowed only at an exact existing keyframe time; interpolation-time repair is refused instead of inventing geometry.",
    "Production promotion still requires retained real-AE write/readback, rollback, and visual repair evidence.",
  ],
  fallbackPolicy: "FORBID",
};

export interface M4MaskPointRepairReplacementV1 {
  readonly vertex?: AePoint2V12;
  readonly inTangent?: AePoint2V12;
  readonly outTangent?: AePoint2V12;
}

export type M4MaskPointRepairPathStateV1 =
  | { readonly kind: "STATIC"; readonly shape: AeMaskShapeV12 }
  | { readonly kind: "ANIMATED"; readonly keyframes: readonly AeMaskPathKeyframeV12[] };

export interface M4MaskPointRepairInputV1 {
  readonly comp: AeStableObjectRefV12;
  readonly layer: AeStableObjectRefV12;
  readonly mask: AeMaskRefV12;
  readonly path: M4MaskPointRepairPathStateV1;
  readonly pointIndex: number;
  readonly targetTime?: number | null;
  readonly replacement: M4MaskPointRepairReplacementV1;
  readonly evidenceIds: readonly string[];
}

export interface M4MaskPointRepairPlanV1 {
  readonly capabilityId: "tracking.mask_point_repair.plan";
  readonly command: "mask.set_path";
  readonly hostCapabilityId: "ae.mask.path.set";
  readonly pointIndex: number;
  readonly targetTime: number | null;
  readonly payload: AeMaskSetPathPayloadV12;
  readonly before: {
    readonly vertex: AePoint2V12;
    readonly inTangent: AePoint2V12;
    readonly outTangent: AePoint2V12;
  };
  readonly after: {
    readonly vertex: AePoint2V12;
    readonly inTangent: AePoint2V12;
    readonly outTangent: AePoint2V12;
  };
  readonly evidenceIds: readonly string[];
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const validPoint = (value: unknown): value is AePoint2V12 =>
  Array.isArray(value) && value.length === 2 && value.every(finite);
const copyPoint = (value: AePoint2V12): AePoint2V12 => [value[0], value[1]];
const validVariableFeather = (value: AeMaskShapeV12["variableFeather"]): boolean => {
  if (value === undefined || value === null) return true;
  const groups = [value.segLocs, value.relSegLocs, value.radii, value.interps,
    value.tensions, value.types, value.relCornerAngles];
  if (!groups.every((group) => Array.isArray(group) && group.every(finite))) return false;
  return groups.every((group) => group.length === groups[0]!.length);
};

const validShape = (shape: AeMaskShapeV12): boolean => {
  if (!shape || typeof shape.closed !== "boolean") return false;
  if (!Array.isArray(shape.vertices) || shape.vertices.length < 2) return false;
  if (!Array.isArray(shape.inTangents) || !Array.isArray(shape.outTangents)) return false;
  if (shape.inTangents.length !== shape.vertices.length || shape.outTangents.length !== shape.vertices.length) return false;
  if (![...shape.vertices, ...shape.inTangents, ...shape.outTangents].every(validPoint)) return false;
  return validVariableFeather(shape.variableFeather);
};

const cloneShape = (shape: AeMaskShapeV12): AeMaskShapeV12 => {
  const base = {
    closed: shape.closed,
    vertices: shape.vertices.map(copyPoint),
    inTangents: shape.inTangents.map(copyPoint),
    outTangents: shape.outTangents.map(copyPoint),
  };
  if (shape.variableFeather === undefined) return base;
  if (shape.variableFeather === null) return { ...base, variableFeather: null };
  return {
    ...base,
    variableFeather: {
      segLocs: [...shape.variableFeather.segLocs],
      relSegLocs: [...shape.variableFeather.relSegLocs],
      radii: [...shape.variableFeather.radii],
      interps: [...shape.variableFeather.interps],
      tensions: [...shape.variableFeather.tensions],
      types: [...shape.variableFeather.types],
      relCornerAngles: [...shape.variableFeather.relCornerAngles],
    },
  };
};

const validStableRef = (value: AeStableObjectRefV12 | AeMaskRefV12): boolean =>
  !!value && nonEmpty(value.stableId);
const evidence = (value: unknown): readonly string[] | null => {
  if (!Array.isArray(value)) return null;
  const ids = [...new Set(value.filter(nonEmpty))];
  return ids.length > 0 ? ids : null;
};
const validReplacement = (replacement: M4MaskPointRepairReplacementV1): boolean => {
  if (!replacement || typeof replacement !== "object") return false;
  const supplied = [replacement.vertex, replacement.inTangent, replacement.outTangent]
    .filter((item) => item !== undefined);
  return supplied.length > 0 && supplied.every(validPoint);
};

const repairShape = (
  source: AeMaskShapeV12,
  pointIndex: number,
  replacement: M4MaskPointRepairReplacementV1,
): { shape: AeMaskShapeV12; before: M4MaskPointRepairPlanV1["before"]; after: M4MaskPointRepairPlanV1["after"] } | null => {
  if (!validShape(source) || !Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= source.vertices.length) return null;
  if (!validReplacement(replacement)) return null;
  const shape = cloneShape(source);
  const before = {
    vertex: copyPoint(source.vertices[pointIndex]!),
    inTangent: copyPoint(source.inTangents[pointIndex]!),
    outTangent: copyPoint(source.outTangents[pointIndex]!),
  };
  if (replacement.vertex !== undefined) (shape.vertices as AePoint2V12[])[pointIndex] = copyPoint(replacement.vertex);
  if (replacement.inTangent !== undefined) (shape.inTangents as AePoint2V12[])[pointIndex] = copyPoint(replacement.inTangent);
  if (replacement.outTangent !== undefined) (shape.outTangents as AePoint2V12[])[pointIndex] = copyPoint(replacement.outTangent);
  const after = {
    vertex: copyPoint(shape.vertices[pointIndex]!),
    inTangent: copyPoint(shape.inTangents[pointIndex]!),
    outTangent: copyPoint(shape.outTangents[pointIndex]!),
  };
  return { shape, before, after };
};

const validKeyframes = (keyframes: readonly AeMaskPathKeyframeV12[]): boolean => {
  if (!Array.isArray(keyframes) || keyframes.length < 1) return false;
  let previous = -Infinity;
  for (const keyframe of keyframes) {
    if (!keyframe || !finite(keyframe.time) || keyframe.time <= previous || !validShape(keyframe.shape)) return false;
    previous = keyframe.time;
  }
  return true;
};

export const planM4MaskPointRepairV1 = (
  input: M4MaskPointRepairInputV1,
): M4MaskPointRepairPlanV1 | null => {
  if (!input || !validStableRef(input.comp) || !validStableRef(input.layer) || !validStableRef(input.mask)) return null;
  const ids = evidence(input.evidenceIds);
  if (!ids || !Number.isInteger(input.pointIndex) || input.pointIndex < 0 || !validReplacement(input.replacement)) return null;
  if (input.path.kind === "STATIC") {
    if (input.targetTime !== undefined && input.targetTime !== null) return null;
    const repaired = repairShape(input.path.shape, input.pointIndex, input.replacement);
    if (!repaired) return null;
    return {
      capabilityId: "tracking.mask_point_repair.plan",
      command: "mask.set_path",
      hostCapabilityId: "ae.mask.path.set",
      pointIndex: input.pointIndex,
      targetTime: null,
      payload: { comp: input.comp, layer: input.layer, mask: input.mask, shape: repaired.shape },
      before: repaired.before,
      after: repaired.after,
      evidenceIds: ids,
    };
  }

  if (input.path.kind !== "ANIMATED" || !finite(input.targetTime) || !validKeyframes(input.path.keyframes)) return null;
  const targetIndex = input.path.keyframes.findIndex((keyframe) => keyframe.time === input.targetTime);
  if (targetIndex < 0) return null;
  const target = input.path.keyframes[targetIndex]!;
  const repaired = repairShape(target.shape, input.pointIndex, input.replacement);
  if (!repaired) return null;
  const keyframes = input.path.keyframes.map((keyframe, index) => ({
    time: keyframe.time,
    shape: index === targetIndex ? repaired.shape : cloneShape(keyframe.shape),
  }));
  return {
    capabilityId: "tracking.mask_point_repair.plan",
    command: "mask.set_path",
    hostCapabilityId: "ae.mask.path.set",
    pointIndex: input.pointIndex,
    targetTime: input.targetTime,
    payload: { comp: input.comp, layer: input.layer, mask: input.mask, keyframes },
    before: repaired.before,
    after: repaired.after,
    evidenceIds: ids,
  };
};
