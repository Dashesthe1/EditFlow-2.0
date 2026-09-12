import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";
import type { AcceptedSubjectSegmentationV1 } from "../../../tracking-state/src/index.js";
import type {
  AeSetTrackMattePayloadV13,
  AeStableObjectRefV13,
  AeTrackMatteTypeV13,
} from "./protocol-v1_3.js";

export type SegmentationMatteChannelV1 = "ALPHA" | "LUMA";

export interface SegmentationMatteExportInputV1 {
  readonly segmentation: AcceptedSubjectSegmentationV1;
  readonly comp: AeStableObjectRefV13;
  readonly targetLayer: AeStableObjectRefV13;
  /** Existing AE layer that has already been materialized from the exact segmentation artifact. */
  readonly matteLayer: AeStableObjectRefV13;
  /** Explicit raster channel interpretation. Never inferred from mask encoding or content type. */
  readonly channel: SegmentationMatteChannelV1;
  readonly inverted?: boolean;
}

export interface SegmentationMatteMaterializationPreconditionV1 {
  readonly artifactId: string;
  readonly contentType: string;
  readonly width: number;
  readonly height: number;
  readonly boundsNormalized: readonly [number, number, number, number];
  readonly matteLayerStableId: string;
  readonly requiresExactArtifactProof: true;
}

export interface SegmentationMatteExportPlanV1 {
  readonly semanticId: string;
  readonly sourceId: string;
  readonly timestampMs: number;
  readonly materialization: SegmentationMatteMaterializationPreconditionV1;
  readonly compositePayload: AeSetTrackMattePayloadV13;
  readonly requiredWriteCapabilityId: "ae.layer.track_matte.set";
  readonly trackMatteType: AeTrackMatteTypeV13;
  readonly evidenceIds: readonly string[];
}

export const M4_SEGMENTATION_MATTE_EXPORT_CAPABILITY_V1: CapabilityRecord = {
  id: asCapabilityId("tracking.segmentation.matte_export.plan"),
  domain: "tracking",
  description: "Plan an explicit segmentation-raster to After Effects track-matte binding using the proven protocol 1.3 matte contract, while requiring separate proof that the matte layer was materialized from the exact segmentation artifact.",
  status: "PARTIAL",
  proofMaturity: "DECLARED",
  routes: [{
    routeId: asRouteId("m4.tracking.segmentation-matte-export.v1"),
    kind: "SUBSYSTEM_ADAPTER",
    available: true,
    adapterVersion: "0.5.0-dev.1",
    limitations: [
      "Planning only; this tranche does not import/materialize the raster artifact or write the track matte.",
      "ALPHA versus LUMA interpretation must be supplied explicitly and is never inferred from mask encoding/content type.",
    ],
  }],
  inputSchemaRef: "SegmentationMatteExportInputV1",
  outputSchemaRef: "SegmentationMatteExportPlanV1 | null",
  readbackStrategy: "SEGMENTATION_ARTIFACT_PROVENANCE_PLUS_PROTOCOL_1_3_COMPOSITE_READBACK",
  visualProofProfile: null,
  rollbackStrategy: "NONE_REQUIRED",
  riskClass: "R0_READ_ONLY",
  limitations: [
    "A future write executor must prove that matteLayer originates from the exact artifactId before dispatching ae.layer.track_matte.set.",
    "Cropped raster bounds still require truthful layer placement/alignment before matte binding.",
    "Runtime capability registration is withheld until materialization, alignment, write, readback, rollback, and live visual proof are retained.",
  ],
  fallbackPolicy: "FORBID",
};

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const validStableRef = (value: unknown): value is AeStableObjectRefV13 => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return nonEmpty((value as Record<string, unknown>)["stableId"]);
};

const validBounds = (value: unknown): value is readonly [number, number, number, number] => {
  if (!Array.isArray(value) || value.length !== 4) return false;
  const [x, y, width, height] = value;
  if (![x, y, width, height].every((item) => typeof item === "number" && Number.isFinite(item))) return false;
  return x >= 0 && y >= 0 && width > 0 && height > 0
    && x + width <= 1 + Number.EPSILON && y + height <= 1 + Number.EPSILON;
};

const matteTypeFor = (channel: SegmentationMatteChannelV1, inverted: boolean): AeTrackMatteTypeV13 => {
  if (channel === "ALPHA") return inverted ? "ALPHA_INVERTED" : "ALPHA";
  return inverted ? "LUMA_INVERTED" : "LUMA";
};

export const buildSegmentationMatteExportPlanV1 = (
  input: SegmentationMatteExportInputV1,
): SegmentationMatteExportPlanV1 | null => {
  if (!input || typeof input !== "object") return null;
  if (input.channel !== "ALPHA" && input.channel !== "LUMA") return null;
  if (input.inverted !== undefined && typeof input.inverted !== "boolean") return null;
  if (!validStableRef(input.comp) || !validStableRef(input.targetLayer) || !validStableRef(input.matteLayer)) return null;
  if (input.targetLayer.stableId === input.matteLayer.stableId) return null;

  const segmentation = input.segmentation;
  if (!segmentation || typeof segmentation !== "object"
    || !nonEmpty(segmentation.semanticId) || !nonEmpty(segmentation.sourceId)
    || typeof segmentation.timestampMs !== "number" || !Number.isFinite(segmentation.timestampMs)
    || segmentation.timestampMs < 0) return null;
  const mask = segmentation.mask;
  if (!mask || typeof mask !== "object" || !Number.isInteger(mask.width) || mask.width <= 0
    || !Number.isInteger(mask.height) || mask.height <= 0 || !validBounds(mask.boundsNormalized)) return null;
  if (!mask.artifact || typeof mask.artifact !== "object"
    || !nonEmpty(mask.artifact.artifactId) || !nonEmpty(mask.artifact.contentType)) return null;
  if (!Array.isArray(segmentation.evidenceIds)) return null;
  const evidenceIds = [...new Set(segmentation.evidenceIds.filter(nonEmpty))];
  if (evidenceIds.length === 0) return null;

  const trackMatteType = matteTypeFor(input.channel, input.inverted ?? false);
  const compositePayload: AeSetTrackMattePayloadV13 = {
    comp: input.comp,
    layer: input.targetLayer,
    matteLayer: input.matteLayer,
    trackMatteType,
  };

  return {
    semanticId: segmentation.semanticId,
    sourceId: segmentation.sourceId,
    timestampMs: segmentation.timestampMs,
    materialization: {
      artifactId: mask.artifact.artifactId,
      contentType: mask.artifact.contentType,
      width: mask.width,
      height: mask.height,
      boundsNormalized: mask.boundsNormalized,
      matteLayerStableId: input.matteLayer.stableId,
      requiresExactArtifactProof: true,
    },
    compositePayload,
    requiredWriteCapabilityId: "ae.layer.track_matte.set",
    trackMatteType,
    evidenceIds,
  };
};
