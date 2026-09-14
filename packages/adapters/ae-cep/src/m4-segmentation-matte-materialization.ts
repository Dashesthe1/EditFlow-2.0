import path from "node:path";
import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";
import type { AcceptedSubjectSegmentationV1 } from "../../../tracking-state/src/index.js";
import type { AeStableObjectRefV13, AeTrackMatteTypeV13 } from "./protocol-v1_3.js";
import {
  buildSegmentationMatteExportPlanV1,
  type SegmentationMatteChannelV1,
} from "./m4-segmentation-matte-export.js";

export type SegmentationVec2V1 = readonly [number, number];

export interface VerifiedSegmentationArtifactMaterialV1 {
  readonly artifactId: string;
  readonly absolutePath: string;
  readonly contentType: string;
  readonly sha256: string;
  readonly evidenceIds: readonly string[];
}

export interface SegmentationSourceFrameGeometryV1 {
  readonly width: number;
  readonly height: number;
  readonly pixelAspect: 1;
  readonly evidenceIds: readonly string[];
}
export interface SegmentationTargetLayerStateV1 {
  readonly stableId: string;
  readonly threeDLayer: false;
  readonly transform: {
    readonly anchorPoint: SegmentationVec2V1;
    readonly position: SegmentationVec2V1;
    readonly scale: SegmentationVec2V1;
    readonly rotation: number;
  };
  readonly timing: {
    readonly startTime: number;
    readonly inPoint: number;
    readonly outPoint: number;
    readonly stretch: number;
  };
  readonly evidenceIds: readonly string[];
}

export interface SegmentationMatteMaterializationInputV1 {
  readonly segmentation: AcceptedSubjectSegmentationV1;
  readonly artifact: VerifiedSegmentationArtifactMaterialV1;
  readonly sourceFrame: SegmentationSourceFrameGeometryV1;
  readonly comp: AeStableObjectRefV13;
  readonly targetLayer: AeStableObjectRefV13;
  readonly targetState: SegmentationTargetLayerStateV1;
  readonly importItemStableId: string;
  readonly matteLayerStableId: string;
  readonly channel: SegmentationMatteChannelV1;
  readonly inverted?: boolean;
}
export interface SegmentationMatteMaterializationOperationV1 {
  readonly capabilityId: string;
  readonly command: string;
  readonly protocolVersion: "1.1.0" | "1.3.0";
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface SegmentationMatteMaterializationPlanV1 {
  readonly semanticId: string;
  readonly sourceId: string;
  readonly timestampMs: number;
  readonly artifactId: string;
  readonly importItemStableId: string;
  readonly matteLayerStableId: string;
  readonly matteTransform: {
    readonly anchorPoint: SegmentationVec2V1;
    readonly position: SegmentationVec2V1;
    readonly scale: SegmentationVec2V1;
    readonly rotation: number;
    readonly opacity: 100;
  };
  readonly matteTiming: SegmentationTargetLayerStateV1["timing"];
  readonly trackMatteType: AeTrackMatteTypeV13;
  readonly operations: readonly SegmentationMatteMaterializationOperationV1[];
  readonly evidenceIds: readonly string[];
}

export const M4_SEGMENTATION_MATTE_MATERIALIZATION_CAPABILITY_V1: CapabilityRecord = {
  id: asCapabilityId("tracking.segmentation.matte_materialize.plan"),
  domain: "tracking",
  description: "Plan exact segmentation-raster import, 2D source-space alignment, target timing, and protocol 1.3 track-matte binding by composing accepted AE protocol surfaces.",
  status: "PARTIAL",
  proofMaturity: "VISUAL",
  routes: [{
    routeId: asRouteId("m4.tracking.segmentation-matte-materialize.v1"),
    kind: "SUBSYSTEM_ADAPTER",
    available: true,
    adapterVersion: "0.5.0-dev.2",
    limitations: [
      "Retained real-AE proof covers exact materialization, structural readback, matte binding, pixel-validated viewer-visible output, guarded failure Undo/reapply, render emission, and baseline cleanup; transfer, live-provider integration, and production runtime registration remain open.",
      "V1 requires a 2D target layer and square-pixel source geometry.",
    ],
  }],
  inputSchemaRef: "SegmentationMatteMaterializationInputV1",
  outputSchemaRef: "SegmentationMatteMaterializationPlanV1 | null",
  readbackStrategy: "V11_LAYER_STRUCTURAL_PLUS_V13_COMPOSITE_READBACK",
  visualProofProfile: "SEGMENTATION_MATTE_MATERIALIZATION_CHECKPOINT",
  rollbackStrategy: "AE_UNDO_GROUP_PER_COMPOSED_OPERATION",
  riskClass: "R0_READ_ONLY",
  limitations: [
    "This capability emits a plan; it does not dispatch AE mutations by itself.",
    "3D layers, non-square-pixel source geometry, and missing geometry provenance fail closed.",
    "Temporal materialization exists as a separate VISUAL sequence-aware planner; this V1 remains intentionally static-only."
  ],
  fallbackPolicy: "FORBID",
};

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const positiveInteger = (value: unknown): value is number => Number.isInteger(value) && Number(value) > 0;
const absolutePath = (value: string): boolean => path.isAbsolute(value) || path.win32.isAbsolute(value);
const evidence = (value: unknown): readonly string[] | null => {
  if (!Array.isArray(value)) return null;
  const accepted = [...new Set(value.filter(nonEmpty))];
  return accepted.length > 0 ? accepted : null;
};
const vec2 = (value: unknown): value is SegmentationVec2V1 =>
  Array.isArray(value) && value.length === 2 && finite(value[0]) && finite(value[1]);
const stableRef = (value: unknown): value is AeStableObjectRefV13 => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return nonEmpty((value as Record<string, unknown>)["stableId"]);
};
const validBounds = (value: unknown): value is readonly [number, number, number, number] => {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(finite)) return false;
  const [x, y, width, height] = value as [number, number, number, number];
  return x >= 0 && y >= 0 && width > 0 && height > 0
    && x + width <= 1 + Number.EPSILON && y + height <= 1 + Number.EPSILON;
};

const rotate = (x: number, y: number, degrees: number): SegmentationVec2V1 => {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [x * cosine - y * sine, x * sine + y * cosine];
};
const artifactMatches = (
  segmentation: AcceptedSubjectSegmentationV1,
  artifact: VerifiedSegmentationArtifactMaterialV1,
): boolean => {
  const expected = segmentation.mask.artifact;
  return nonEmpty(artifact.artifactId)
    && artifact.artifactId === expected.artifactId
    && nonEmpty(artifact.absolutePath)
    && absolutePath(artifact.absolutePath)
    && artifact.contentType === expected.contentType
    && nonEmpty(artifact.sha256)
    && artifact.sha256 === expected.sha256
    && evidence(artifact.evidenceIds) !== null;
};

const targetStateValid = (state: SegmentationTargetLayerStateV1): boolean => {
  if (!state || typeof state !== "object" || !nonEmpty(state.stableId) || state.threeDLayer !== false) return false;
  const transform = state.transform;
  const timing = state.timing;
  if (!transform || !vec2(transform.anchorPoint) || !vec2(transform.position) || !vec2(transform.scale)) return false;
  if (!finite(transform.rotation) || transform.scale[0] === 0 || transform.scale[1] === 0) return false;
  if (!timing || !finite(timing.startTime) || !finite(timing.inPoint) || !finite(timing.outPoint) || !finite(timing.stretch)) return false;
  if (timing.outPoint < timing.inPoint || timing.stretch === 0) return false;
  return evidence(state.evidenceIds) !== null;
};

const operation = (
  protocolVersion: "1.1.0" | "1.3.0",
  capabilityId: string,
  command: string,
  payload: Readonly<Record<string, unknown>>,
): SegmentationMatteMaterializationOperationV1 => ({ protocolVersion, capabilityId, command, payload });
export const buildSegmentationMatteMaterializationPlanV1 = (
  input: SegmentationMatteMaterializationInputV1,
): SegmentationMatteMaterializationPlanV1 | null => {
  if (!input || typeof input !== "object" || !input.segmentation || !input.artifact) return null;
  if (!stableRef(input.comp) || !stableRef(input.targetLayer)) return null;
  if (!nonEmpty(input.importItemStableId) || !nonEmpty(input.matteLayerStableId)) return null;
  if (input.importItemStableId === input.matteLayerStableId || input.matteLayerStableId === input.targetLayer.stableId) return null;
  if (!artifactMatches(input.segmentation, input.artifact) || !targetStateValid(input.targetState)) return null;
  if (input.targetState.stableId !== input.targetLayer.stableId) return null;
  if (!positiveInteger(input.sourceFrame?.width) || !positiveInteger(input.sourceFrame?.height)) return null;
  if (input.sourceFrame.pixelAspect !== 1 || evidence(input.sourceFrame.evidenceIds) === null) return null;

  const mask = input.segmentation.mask;
  if (!positiveInteger(mask.width) || !positiveInteger(mask.height) || !validBounds(mask.boundsNormalized)) return null;
  const [x, y, width, height] = mask.boundsNormalized;
  const sourceWidth = input.sourceFrame.width;
  const sourceHeight = input.sourceFrame.height;
  const cropCenterX = (x + width / 2) * sourceWidth;
  const cropCenterY = (y + height / 2) * sourceHeight;
  const target = input.targetState.transform;
  const localDx = (cropCenterX - target.anchorPoint[0]) * target.scale[0] / 100;
  const localDy = (cropCenterY - target.anchorPoint[1]) * target.scale[1] / 100;
  const [rotatedDx, rotatedDy] = rotate(localDx, localDy, target.rotation);
  const mattePosition: SegmentationVec2V1 = [target.position[0] + rotatedDx, target.position[1] + rotatedDy];
  const matteScale: SegmentationVec2V1 = [
    target.scale[0] * (width * sourceWidth / mask.width),
    target.scale[1] * (height * sourceHeight / mask.height),
  ];
  if (!matteScale.every(finite) || matteScale[0] === 0 || matteScale[1] === 0) return null;
  const matteLayerRef: AeStableObjectRefV13 = { stableId: input.matteLayerStableId };
  const exportPlan = buildSegmentationMatteExportPlanV1({
    segmentation: input.segmentation,
    comp: input.comp,
    targetLayer: input.targetLayer,
    matteLayer: matteLayerRef,
    channel: input.channel,
    ...(input.inverted === undefined ? {} : { inverted: input.inverted }),
  });
  if (!exportPlan) return null;

  const matteTransform = {
    anchorPoint: [mask.width / 2, mask.height / 2] as SegmentationVec2V1,
    position: mattePosition,
    scale: matteScale,
    rotation: target.rotation,
    opacity: 100 as const,
  };
  const matteTiming = { ...input.targetState.timing };
  const operations: readonly SegmentationMatteMaterializationOperationV1[] = [
    operation("1.1.0", "ae.media.import", "media.import", {
      path: input.artifact.absolutePath,
      stableId: input.importItemStableId,
      sequence: false,
    }),
    operation("1.1.0", "ae.layer.create", "layer.add_media", {
      comp: input.comp,
      item: { stableId: input.importItemStableId },
      stableId: input.matteLayerStableId,
    }),
    operation("1.1.0", "ae.layer.transform.set", "layer.set_transform", {
      comp: input.comp,
      layer: matteLayerRef,
      values: matteTransform,
    }),
    operation("1.1.0", "ae.layer.timing.set", "layer.set_timing", {
      comp: input.comp,
      layer: matteLayerRef,
      timing: matteTiming,
    }),
    operation("1.3.0", "ae.layer.track_matte.set", "layer.set_track_matte", { ...exportPlan.compositePayload }),
  ];

  const evidenceIds = [...new Set([
    ...input.segmentation.evidenceIds,
    ...input.artifact.evidenceIds,
    ...input.sourceFrame.evidenceIds,
    ...input.targetState.evidenceIds,
  ].filter(nonEmpty))];
  if (evidenceIds.length === 0) return null;

  return {
    semanticId: input.segmentation.semanticId,
    sourceId: input.segmentation.sourceId,
    timestampMs: input.segmentation.timestampMs,
    artifactId: input.artifact.artifactId,
    importItemStableId: input.importItemStableId,
    matteLayerStableId: input.matteLayerStableId,
    matteTransform,
    matteTiming,
    trackMatteType: exportPlan.trackMatteType,
    operations,
    evidenceIds,
  };
};
