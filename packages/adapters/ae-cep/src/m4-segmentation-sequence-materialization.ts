import path from "node:path";
import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";
import type {
  AcceptedSubjectSegmentationSequenceV1,
  AcceptedSubjectSegmentationV1,
} from "../../../tracking-state/src/index.js";
import type { AeStableObjectRefV13 } from "./protocol-v1_3.js";
import {
  buildSegmentationMatteMaterializationPlanV1,
  type SegmentationSourceFrameGeometryV1,
  type SegmentationTargetLayerStateV1,
} from "./m4-segmentation-matte-materialization.js";
import type { SegmentationMatteChannelV1 } from "./m4-segmentation-matte-export.js";

export interface VerifiedSegmentationSequenceFrameMaterialV1 {
  readonly frameIndex: number;
  readonly artifactId: string;
  readonly absolutePath: string;
  readonly contentType: string;
  readonly sha256: string;
  readonly evidenceIds: readonly string[];
}

export interface VerifiedSegmentationSequenceMaterialV1 {
  readonly frames: readonly VerifiedSegmentationSequenceFrameMaterialV1[];
  readonly evidenceIds: readonly string[];
}
export interface SegmentationSequenceMatteMaterializationInputV1 {
  readonly segmentation: AcceptedSubjectSegmentationSequenceV1;
  readonly artifactSequence: VerifiedSegmentationSequenceMaterialV1;
  readonly sourceFrame: SegmentationSourceFrameGeometryV1;
  readonly comp: AeStableObjectRefV13;
  readonly targetLayer: AeStableObjectRefV13;
  readonly targetState: SegmentationTargetLayerStateV1;
  readonly importItemStableId: string;
  readonly matteLayerStableId: string;
  readonly channel: SegmentationMatteChannelV1;
  readonly inverted?: boolean;
}

export interface SegmentationSequenceMaterializationOperationV1 {
  readonly capabilityId: string;
  readonly command: string;
  readonly protocolVersion: "1.1.0" | "1.3.0" | "2.5.0";
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface SegmentationSequenceMatteMaterializationPlanV1 {
  readonly semanticId: string;
  readonly sourceId: string;
  readonly startTimestampMs: number;
  readonly frameRate: number;
  readonly frameCount: number;
  readonly sequenceDurationSeconds: number;
  readonly firstFramePath: string;
  readonly importItemStableId: string;
  readonly matteLayerStableId: string;
  readonly matteTransform: NonNullable<ReturnType<typeof buildSegmentationMatteMaterializationPlanV1>>["matteTransform"];
  readonly matteTiming: SegmentationTargetLayerStateV1["timing"];
  readonly operations: readonly SegmentationSequenceMaterializationOperationV1[];
  readonly evidenceIds: readonly string[];
}
export const M4_SEGMENTATION_SEQUENCE_MATTE_MATERIALIZATION_CAPABILITY_V1: CapabilityRecord = {
  id: asCapabilityId("tracking.segmentation.sequence_matte_materialize.plan"),
  domain: "tracking",
  description: "Plan an integrity-verified temporal segmentation raster sequence into native After Effects sequence import, exact forward timing, alignment, and track-matte binding.",
  status: "FULL",
  proofMaturity: "TRANSFER",
  routes: [{
    routeId: asRouteId("m4.tracking.segmentation-sequence-matte-materialize.v1"),
    kind: "SUBSYSTEM_ADAPTER",
    available: true,
    adapterVersion: "0.5.0-dev.3",
    limitations: [
      "Protocol 2.5 native sequence import/readback, dynamic visual proof, materially different real-footage transfer, and save/reopen plus distinct authenticated CEP reconnect are retained through P5; live SAM 3.1 provider-generated sequence proof remains blocked by gated checkpoint access.",
      "V1 requires uniform mask geometry and forward target-layer timing; reverse-stretch sequence synchronization is refused.",
    ],
  }],
  inputSchemaRef: "SegmentationSequenceMatteMaterializationInputV1",
  outputSchemaRef: "SegmentationSequenceMatteMaterializationPlanV1 | null",
  readbackStrategy: "PER_FRAME_SHA256_PLUS_PROTOCOL_2_5_SEQUENCE_READBACK_PLUS_PROTOCOL_1_3_COMPOSITE_READBACK",
  visualProofProfile: "SEGMENTATION_SEQUENCE_MATTE_CHECKPOINT",
  rollbackStrategy: "PROTOCOL_2_5_SEQUENCE_UNDO_PLUS_COMPOSED_OPERATION_UNDO",
  riskClass: "R0_READ_ONLY",
  limitations: [
    "This capability emits a plan and never dispatches mutations by itself.",
    "Every numbered frame must match the accepted artifact identity, digest, content type, geometry, and cadence.",
    "Production runtime registration remains withheld until live temporal-provider output is retained; P5 save/reopen/reconnect transfer is accepted for the planner/materialization surface.",
  ],
  fallbackPolicy: "FORBID",
};
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const absolute = (value: string): boolean => path.isAbsolute(value) || path.win32.isAbsolute(value);
const evidence = (value: unknown): readonly string[] | null => {
  if (!Array.isArray(value)) return null;
  const accepted = [...new Set(value.filter(nonEmpty))];
  return accepted.length > 0 ? accepted : null;
};
const stableRef = (value: unknown): value is AeStableObjectRefV13 => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return nonEmpty((value as Record<string, unknown>)["stableId"]);
};
const sameBounds = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length && left.every((value, index) => Math.abs(value - Number(right[index])) <= 1e-9);
const samePath = (left: string, right: string): boolean => {
  const leftWindows = /^[A-Za-z]:[\\/]/.test(left) || left.includes("\\");
  const api = leftWindows ? path.win32 : path;
  const normalize = (value: string): string => {
    const resolved = api.resolve(value);
    return leftWindows ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
};

interface SequenceFilenamePattern {
  readonly directory: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly digits: number;
  readonly firstNumber: number;
}
const sequencePattern = (firstPath: string): SequenceFilenamePattern | null => {
  if (!absolute(firstPath)) return null;
  const api = /^[A-Za-z]:[\\/]/.test(firstPath) || firstPath.includes("\\") ? path.win32 : path;
  const parsed = api.parse(firstPath);
  const match = /^(.*?)(\d+)$/.exec(parsed.name);
  if (!match || match[1] === undefined || match[2] === undefined) return null;
  return {
    directory: api.resolve(parsed.dir),
    prefix: match[1],
    suffix: parsed.ext,
    digits: match[2].length,
    firstNumber: Number(match[2]),
  };
};

const expectedSequencePath = (pattern: SequenceFilenamePattern, frameIndex: number): string => {
  const windows = /^[A-Za-z]:[\\/]/.test(pattern.directory) || pattern.directory.includes("\\");
  const api = windows ? path.win32 : path;
  const number = String(pattern.firstNumber + frameIndex).padStart(pattern.digits, "0");
  return api.join(pattern.directory, `${pattern.prefix}${number}${pattern.suffix}`);
};

const frameMaterialMatches = (
  segmentation: AcceptedSubjectSegmentationSequenceV1,
  materials: VerifiedSegmentationSequenceMaterialV1,
): boolean => {
  if (!Array.isArray(materials.frames) || materials.frames.length !== segmentation.frameCount) return false;
  if (evidence(materials.evidenceIds) === null) return false;
  const first = materials.frames[0];
  if (!first || !nonEmpty(first.absolutePath)) return false;
  const pattern = sequencePattern(first.absolutePath);
  if (!pattern) return false;
  for (let index = 0; index < materials.frames.length; index += 1) {
    const material = materials.frames[index];
    const acceptedFrame = segmentation.frames[index];
    if (!material || !acceptedFrame || material.frameIndex !== index) return false;
    if (!nonEmpty(material.artifactId) || material.artifactId !== acceptedFrame.mask.artifact.artifactId) return false;
    if (!nonEmpty(material.absolutePath) || !absolute(material.absolutePath)) return false;
    if (!samePath(material.absolutePath, expectedSequencePath(pattern, index))) return false;
    if (material.contentType !== acceptedFrame.mask.artifact.contentType) return false;
    if (!/^[a-f0-9]{64}$/.test(material.sha256) || material.sha256 !== acceptedFrame.mask.artifact.sha256) return false;
    if (evidence(material.evidenceIds) === null) return false;
  }
  return true;
};

const firstFrameAsStill = (
  sequence: AcceptedSubjectSegmentationSequenceV1,
): AcceptedSubjectSegmentationV1 | null => {
  const frame = sequence.frames[0];
  if (!frame) return null;
  return {
    requestId: `${sequence.requestId}:frame:0`,
    sourceId: sequence.sourceId,
    timestampMs: frame.timestampMs,
    semanticId: sequence.semanticId,
    ...(sequence.entityClass === undefined ? {} : { entityClass: sequence.entityClass }),
    providerId: sequence.providerId,
    ...(sequence.providerVersion === undefined ? {} : { providerVersion: sequence.providerVersion }),
    mask: frame.mask,
    confidence: frame.confidence,
    edgeQuality: frame.edgeQuality,
    temporalConsistency: frame.temporalConsistency,
    occlusion: frame.occlusion,
    evidenceIds: [...new Set([...sequence.evidenceIds, ...frame.evidenceIds])],
  };
};
export const buildSegmentationSequenceMatteMaterializationPlanV1 = (
  input: SegmentationSequenceMatteMaterializationInputV1,
): SegmentationSequenceMatteMaterializationPlanV1 | null => {
  if (!input || typeof input !== "object" || !input.segmentation || !input.artifactSequence) return null;
  if (!stableRef(input.comp) || !stableRef(input.targetLayer)) return null;
  if (!nonEmpty(input.importItemStableId) || !nonEmpty(input.matteLayerStableId)) return null;
  if (input.importItemStableId === input.matteLayerStableId || input.matteLayerStableId === input.targetLayer.stableId) return null;
  const segmentation = input.segmentation;
  if (!finite(segmentation.startTimestampMs) || segmentation.startTimestampMs < 0
    || !finite(segmentation.frameRate) || segmentation.frameRate <= 0
    || !Number.isInteger(segmentation.frameCount) || segmentation.frameCount <= 0) return null;
  if (!Array.isArray(segmentation.frames) || segmentation.frames.length !== segmentation.frameCount) return null;
  if (!frameMaterialMatches(segmentation, input.artifactSequence)) return null;
  if (!input.targetState || input.targetState.stableId !== input.targetLayer.stableId) return null;
  const targetTiming = input.targetState.timing;
  if (!targetTiming || !finite(targetTiming.startTime) || !finite(targetTiming.inPoint)
    || !finite(targetTiming.outPoint) || !finite(targetTiming.stretch) || targetTiming.stretch <= 0) return null;

  const firstSegmentation = firstFrameAsStill(segmentation);
  const firstMaterial = input.artifactSequence.frames[0];
  if (!firstSegmentation || !firstMaterial) return null;
  const staticPlan = buildSegmentationMatteMaterializationPlanV1({
    segmentation: firstSegmentation,
    artifact: {
      artifactId: firstMaterial.artifactId,
      absolutePath: firstMaterial.absolutePath,
      contentType: firstMaterial.contentType,
      sha256: firstMaterial.sha256,
      evidenceIds: firstMaterial.evidenceIds,
    },
    sourceFrame: input.sourceFrame,
    comp: input.comp,
    targetLayer: input.targetLayer,
    targetState: input.targetState,    importItemStableId: input.importItemStableId,
    matteLayerStableId: input.matteLayerStableId,
    channel: input.channel,
    ...(input.inverted === undefined ? {} : { inverted: input.inverted }),
  });
  if (!staticPlan) return null;

  const stretchScale = targetTiming.stretch / 100;
  const sequenceDurationSeconds = segmentation.frameCount / segmentation.frameRate;
  const compInPoint = targetTiming.startTime + (segmentation.startTimestampMs / 1000) * stretchScale;
  const compOutPoint = compInPoint + sequenceDurationSeconds * stretchScale;
  const epsilon = 1e-7;
  if (!finite(compInPoint) || !finite(compOutPoint)
    || compInPoint < targetTiming.inPoint - epsilon || compOutPoint > targetTiming.outPoint + epsilon
    || compOutPoint <= compInPoint) return null;
  const matteTiming: SegmentationTargetLayerStateV1["timing"] = {
    startTime: compInPoint,
    inPoint: compInPoint,
    outPoint: compOutPoint,
    stretch: targetTiming.stretch,
  };
  const matteLayerRef: AeStableObjectRefV13 = { stableId: input.matteLayerStableId };
  const trackMattePayload = staticPlan.operations[4]?.payload;
  if (!trackMattePayload) return null;

  const operations: readonly SegmentationSequenceMaterializationOperationV1[] = [
    {
      protocolVersion: "2.5.0",
      capabilityId: "ae.media.sequence.import",
      command: "media.sequence.import",
      payload: {
        path: firstMaterial.absolutePath,
        stableId: input.importItemStableId,
        frameRate: segmentation.frameRate,
        expectedFrameCount: segmentation.frameCount,
      },
    },    {
      protocolVersion: "1.1.0",
      capabilityId: "ae.layer.create",
      command: "layer.add_media",
      payload: { comp: input.comp, item: { stableId: input.importItemStableId }, stableId: input.matteLayerStableId },
    },
    {
      protocolVersion: "1.1.0",
      capabilityId: "ae.layer.transform.set",
      command: "layer.set_transform",
      payload: { comp: input.comp, layer: matteLayerRef, values: staticPlan.matteTransform },
    },
    {
      protocolVersion: "1.1.0",
      capabilityId: "ae.layer.timing.set",
      command: "layer.set_timing",
      payload: { comp: input.comp, layer: matteLayerRef, timing: matteTiming },
    },
    {
      protocolVersion: "1.3.0",
      capabilityId: "ae.layer.track_matte.set",
      command: "layer.set_track_matte",
      payload: trackMattePayload,
    },
  ];

  const evidenceIds = [...new Set([
    ...segmentation.evidenceIds,
    ...input.artifactSequence.evidenceIds,
    ...input.artifactSequence.frames.flatMap((frame) => frame.evidenceIds),
    ...input.sourceFrame.evidenceIds,
    ...input.targetState.evidenceIds,
  ].filter(nonEmpty))];
  if (evidenceIds.length === 0) return null;
  return {
    semanticId: segmentation.semanticId,
    sourceId: segmentation.sourceId,
    startTimestampMs: segmentation.startTimestampMs,
    frameRate: segmentation.frameRate,
    frameCount: segmentation.frameCount,
    sequenceDurationSeconds,
    firstFramePath: firstMaterial.absolutePath,
    importItemStableId: input.importItemStableId,
    matteLayerStableId: input.matteLayerStableId,
    matteTransform: staticPlan.matteTransform,
    matteTiming,
    operations,
    evidenceIds,
  };
};
