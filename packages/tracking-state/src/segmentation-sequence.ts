import {
  SEGMENTATION_MASK_ENCODINGS_V1,
  type SegmentationMaskDescriptorV1,
  type SegmentationMaskEncodingV1,
  type SegmentationPointPromptV1,
  type SegmentationPromptV1,
} from "./segmentation.js";

export interface SubjectSegmentationSequenceRequestV1 {
  readonly requestId: string;
  readonly sourceId: string;
  readonly semanticId: string;
  readonly entityClass?: string;
  readonly startTimestampMs: number;
  readonly startFrameIndex: number;
  readonly frameRate: number;
  readonly frameCount: number;
  readonly promptFrameIndex: number;
  readonly prompt?: SegmentationPromptV1;
  readonly preferredEncoding?: SegmentationMaskEncodingV1;
}

export interface SubjectSegmentationSequenceFrameV1 {
  readonly frameIndex: number;
  readonly timestampMs: number;
  readonly mask: SegmentationMaskDescriptorV1;
  readonly confidence: number;
  readonly edgeQuality: number;
  readonly temporalConsistency: number;
  readonly occlusion: number;
  readonly evidenceIds: readonly string[];
}
export interface SubjectSegmentationSequenceResultV1 {
  readonly requestId: string;
  readonly sourceId: string;
  readonly semanticId: string;
  readonly entityClass?: string;
  readonly providerId: string;
  readonly providerVersion?: string;
  readonly startTimestampMs: number;
  readonly startFrameIndex: number;
  readonly frameRate: number;
  readonly frameCount: number;
  readonly frames: readonly SubjectSegmentationSequenceFrameV1[];
  readonly evidenceIds: readonly string[];
}

export interface AcceptedSubjectSegmentationSequenceV1 extends SubjectSegmentationSequenceResultV1 {
  readonly frames: readonly SubjectSegmentationSequenceFrameV1[];
  readonly evidenceIds: readonly string[];
}

export interface SubjectSegmentationSequenceProviderV1 {
  readonly providerId: string;
  segmentSequence(request: SubjectSegmentationSequenceRequestV1): Promise<SubjectSegmentationSequenceResultV1>;
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const finite01 = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const finiteNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const positiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) > 0;
const validEncoding = (value: unknown): value is SegmentationMaskEncodingV1 =>
  typeof value === "string" && (SEGMENTATION_MASK_ENCODINGS_V1 as readonly string[]).includes(value);
const validSha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const validBox = (value: unknown): value is readonly [number, number, number, number] => {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(finite01)) return false;
  const [x, y, width, height] = value as [number, number, number, number];
  return width > 0 && height > 0
    && x + width <= 1 + Number.EPSILON
    && y + height <= 1 + Number.EPSILON;
};
const validPoint = (value: unknown): value is SegmentationPointPromptV1 => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return finite01(candidate["x"]) && finite01(candidate["y"]);
};
const validPrompt = (prompt: unknown): prompt is SegmentationPromptV1 => {
  if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)) return false;
  const value = prompt as SegmentationPromptV1;
  if (value.boundingBox !== undefined && !validBox(value.boundingBox)) return false;
  if (value.previousArtifactId !== undefined && !nonEmpty(value.previousArtifactId)) return false;
  if (value.positivePoints !== undefined && (!Array.isArray(value.positivePoints) || !value.positivePoints.every(validPoint))) return false;
  if (value.negativePoints !== undefined && (!Array.isArray(value.negativePoints) || !value.negativePoints.every(validPoint))) return false;
  return true;
};
export const validateSubjectSegmentationSequenceRequestV1 = (
  request: SubjectSegmentationSequenceRequestV1,
): boolean => {
  if (!request || typeof request !== "object") return false;
  if (!nonEmpty(request.requestId) || !nonEmpty(request.sourceId) || !nonEmpty(request.semanticId)) return false;
  if (request.entityClass !== undefined && !nonEmpty(request.entityClass)) return false;
  if (!finiteNonNegative(request.startTimestampMs)) return false;
  if (!Number.isInteger(request.startFrameIndex) || request.startFrameIndex < 0) return false;
  if (typeof request.frameRate !== "number" || !Number.isFinite(request.frameRate) || request.frameRate <= 0 || request.frameRate > 240) return false;
  if (Math.abs(request.startTimestampMs - request.startFrameIndex * 1000 / request.frameRate) > 1e-6) return false;
  if (!positiveInteger(request.frameCount) || request.frameCount > 100000) return false;
  if (!Number.isInteger(request.promptFrameIndex) || request.promptFrameIndex < 0 || request.promptFrameIndex >= request.frameCount) return false;
  if (request.preferredEncoding !== undefined && !validEncoding(request.preferredEncoding)) return false;
  if (request.prompt !== undefined && !validPrompt(request.prompt)) return false;
  return true;
};

const validMask = (mask: SegmentationMaskDescriptorV1, preferred?: SegmentationMaskEncodingV1): boolean => {
  if (!mask || typeof mask !== "object" || !validEncoding(mask.encoding)) return false;
  if (preferred !== undefined && mask.encoding !== preferred) return false;
  if (!positiveInteger(mask.width) || !positiveInteger(mask.height) || !validBox(mask.boundsNormalized)) return false;
  const artifact = mask.artifact;
  return !!artifact && typeof artifact === "object"
    && nonEmpty(artifact.artifactId) && nonEmpty(artifact.contentType) && validSha256(artifact.sha256);
};

const sameBounds = (
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
): boolean => left.every((value, index) => Math.abs(value - right[index]!) <= 1e-9);
export const acceptSubjectSegmentationSequenceResultV1 = (
  request: SubjectSegmentationSequenceRequestV1,
  result: SubjectSegmentationSequenceResultV1,
): AcceptedSubjectSegmentationSequenceV1 | null => {
  if (!validateSubjectSegmentationSequenceRequestV1(request) || !result || typeof result !== "object") return null;
  if (result.requestId !== request.requestId || result.sourceId !== request.sourceId
    || result.semanticId !== request.semanticId || result.startTimestampMs !== request.startTimestampMs
    || result.startFrameIndex !== request.startFrameIndex
    || result.frameRate !== request.frameRate || result.frameCount !== request.frameCount) return null;
  if (request.entityClass !== undefined && result.entityClass !== request.entityClass) return null;
  if (result.entityClass !== undefined && !nonEmpty(result.entityClass)) return null;
  if (!nonEmpty(result.providerId) || (result.providerVersion !== undefined && !nonEmpty(result.providerVersion))) return null;
  if (!Array.isArray(result.frames) || result.frames.length !== request.frameCount) return null;

  const sequenceEvidence = [...new Set(result.evidenceIds?.filter(nonEmpty) ?? [])];
  if (sequenceEvidence.length === 0) return null;
  const first = result.frames[0];
  if (!first || !validMask(first.mask, request.preferredEncoding)) return null;
  const expectedEncoding = first.mask.encoding;
  const expectedWidth = first.mask.width;
  const expectedHeight = first.mask.height;
  const expectedBounds = first.mask.boundsNormalized;
  const expectedContentType = first.mask.artifact.contentType;
  const seenArtifacts = new Set<string>();
  const acceptedFrames: SubjectSegmentationSequenceFrameV1[] = [];

  for (let index = 0; index < result.frames.length; index += 1) {
    const frame = result.frames[index];
    if (!frame || frame.frameIndex !== index) return null;
    const expectedTimestamp = request.startTimestampMs + (index * 1000 / request.frameRate);
    if (!Number.isFinite(frame.timestampMs) || Math.abs(frame.timestampMs - expectedTimestamp) > 1e-6) return null;
    if (![frame.confidence, frame.edgeQuality, frame.temporalConsistency, frame.occlusion].every(finite01)) return null;
    if (!validMask(frame.mask, request.preferredEncoding)) return null;
    if (frame.mask.encoding !== expectedEncoding || frame.mask.width !== expectedWidth || frame.mask.height !== expectedHeight) return null;
    if (!sameBounds(frame.mask.boundsNormalized, expectedBounds) || frame.mask.artifact.contentType !== expectedContentType) return null;
    if (seenArtifacts.has(frame.mask.artifact.artifactId)) return null;
    seenArtifacts.add(frame.mask.artifact.artifactId);
    const frameEvidence = [...new Set(frame.evidenceIds?.filter(nonEmpty) ?? [])];
    if (frameEvidence.length === 0) return null;
    acceptedFrames.push({ ...frame, evidenceIds: frameEvidence });
  }

  return {
    ...result,
    frames: acceptedFrames,
    evidenceIds: sequenceEvidence,
  };
};
