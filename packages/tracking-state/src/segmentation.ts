export const SEGMENTATION_MASK_ENCODINGS_V1 = [
  "BINARY",
  "ALPHA",
  "PROBABILITY",
] as const;

export type SegmentationMaskEncodingV1 =
  (typeof SEGMENTATION_MASK_ENCODINGS_V1)[number];

export interface SegmentationPointPromptV1 {
  readonly x: number;
  readonly y: number;
}

export interface SegmentationPromptV1 {
  /** Optional normalized [x, y, width, height] hint for the already-bound subject. */
  readonly boundingBox?: readonly [number, number, number, number];
  readonly positivePoints?: readonly SegmentationPointPromptV1[];
  readonly negativePoints?: readonly SegmentationPointPromptV1[];
  /** Optional prior accepted artifact for temporal propagation/refinement. */
  readonly previousArtifactId?: string;
}

export interface SubjectSegmentationRequestV1 {
  readonly requestId: string;
  readonly sourceId: string;
  readonly timestampMs: number;
  /** Exact stable subject/object identity. Class-only guessing is outside this interface. */
  readonly semanticId: string;
  readonly entityClass?: string;
  readonly prompt?: SegmentationPromptV1;
  readonly preferredEncoding?: SegmentationMaskEncodingV1;
}

export interface SegmentationArtifactRefV1 {
  /** Opaque stable artifact identity resolvable by the provider/asset layer. */
  readonly artifactId: string;
  readonly contentType: string;
  /** Optional lowercase hexadecimal SHA-256 for retained artifact integrity. */
  readonly sha256?: string;
}

export interface SegmentationMaskDescriptorV1 {
  readonly encoding: SegmentationMaskEncodingV1;
  readonly width: number;
  readonly height: number;
  /** Normalized source-space bounds covered by the raster artifact. */
  readonly boundsNormalized: readonly [number, number, number, number];
  readonly artifact: SegmentationArtifactRefV1;
}

export interface SubjectSegmentationResultV1 {
  readonly requestId: string;
  readonly sourceId: string;
  readonly timestampMs: number;
  readonly semanticId: string;
  readonly entityClass?: string;
  readonly providerId: string;
  readonly providerVersion?: string;
  readonly mask: SegmentationMaskDescriptorV1;
  readonly confidence: number;
  readonly edgeQuality: number;
  readonly temporalConsistency: number;
  readonly occlusion: number;
  readonly evidenceIds: readonly string[];
}

export interface AcceptedSubjectSegmentationV1 extends SubjectSegmentationResultV1 {
  readonly evidenceIds: readonly string[];
}

/** Provider implementations may be local, remote, model-backed, or host-native. */
export interface SubjectSegmentationProviderV1 {
  readonly providerId: string;
  segment(request: SubjectSegmentationRequestV1): Promise<SubjectSegmentationResultV1>;
}

/**
 * Additive temporal segmentation request. Each frame remains an exact V1 request so
 * accepted single-frame correlation rules are reused rather than weakened.
 */
export interface SubjectSegmentationSeriesRequestV1 {
  readonly seriesId: string;
  readonly sourceId: string;
  readonly semanticId: string;
  readonly entityClass?: string;
  /** Explicit sequence rate consumed by downstream materialization. */
  readonly frameRate: number;
  readonly preferredEncoding?: SegmentationMaskEncodingV1;
  /** Strictly timestamp-ordered, unique frame requests for one source/subject identity. */
  readonly frames: readonly SubjectSegmentationRequestV1[];
}

export interface SubjectSegmentationSeriesResultV1 {
  readonly seriesId: string;
  readonly sourceId: string;
  readonly semanticId: string;
  readonly entityClass?: string;
  readonly providerId: string;
  readonly providerVersion?: string;
  readonly frameRate: number;
  readonly frames: readonly SubjectSegmentationResultV1[];
  readonly evidenceIds: readonly string[];
}

export interface AcceptedSubjectSegmentationSeriesV1 extends Omit<SubjectSegmentationSeriesResultV1, "frames" | "evidenceIds"> {
  readonly frames: readonly AcceptedSubjectSegmentationV1[];
  readonly evidenceIds: readonly string[];
}

/**
 * Temporal providers must emit one correlated series. Adapters that merely loop a
 * single-frame provider do not satisfy this interface unless they can truthfully
 * preserve the temporal-series guarantees validated below.
 */
export interface SubjectSegmentationSeriesProviderV1 {
  readonly providerId: string;
  segmentSeries(request: SubjectSegmentationSeriesRequestV1): Promise<SubjectSegmentationSeriesResultV1>;
}

const finite01 = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

const finiteNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const validNormalizedBox = (value: unknown): value is readonly [number, number, number, number] => {
  if (!Array.isArray(value) || value.length !== 4) return false;
  const [x, y, width, height] = value;
  if (![x, y, width, height].every(finite01)) return false;
  return width > 0
    && height > 0
    && x + width <= 1 + Number.EPSILON
    && y + height <= 1 + Number.EPSILON;
};

const validPoint = (value: unknown): value is SegmentationPointPromptV1 => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return finite01(candidate["x"]) && finite01(candidate["y"]);
};

const validEncoding = (value: unknown): value is SegmentationMaskEncodingV1 =>
  typeof value === "string"
  && (SEGMENTATION_MASK_ENCODINGS_V1 as readonly string[]).includes(value);

const validSha256 = (value: unknown): boolean =>
  value === undefined || (typeof value === "string" && /^[a-f0-9]{64}$/.test(value));

const requiredSha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

const sameNormalizedBox = (
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
): boolean => left.length === right.length && left.every((value, index) => value === right[index]);

export const validateSubjectSegmentationRequestV1 = (
  request: SubjectSegmentationRequestV1,
): boolean => {
  if (!request || typeof request !== "object" || !nonEmpty(request.requestId) || !nonEmpty(request.sourceId)
    || !nonEmpty(request.semanticId) || !finiteNonNegative(request.timestampMs)) return false;
  if (request.entityClass !== undefined && !nonEmpty(request.entityClass)) return false;
  if (request.preferredEncoding !== undefined && !validEncoding(request.preferredEncoding)) return false;

  const prompt = request.prompt;
  if (!prompt) return true;
  if (typeof prompt !== "object" || Array.isArray(prompt)) return false;
  if (prompt.boundingBox !== undefined && !validNormalizedBox(prompt.boundingBox)) return false;
  if (prompt.previousArtifactId !== undefined && !nonEmpty(prompt.previousArtifactId)) return false;
  if (prompt.positivePoints !== undefined
    && (!Array.isArray(prompt.positivePoints) || !prompt.positivePoints.every(validPoint))) return false;
  if (prompt.negativePoints !== undefined
    && (!Array.isArray(prompt.negativePoints) || !prompt.negativePoints.every(validPoint))) return false;
  return true;
};

export const validateSubjectSegmentationSeriesRequestV1 = (
  request: SubjectSegmentationSeriesRequestV1,
): boolean => {
  if (!request || typeof request !== "object"
    || !nonEmpty(request.seriesId)
    || !nonEmpty(request.sourceId)
    || !nonEmpty(request.semanticId)
    || typeof request.frameRate !== "number"
    || !Number.isFinite(request.frameRate)
    || request.frameRate <= 0
    || request.frameRate > 99
    || !Array.isArray(request.frames)
    || request.frames.length === 0) return false;
  if (request.entityClass !== undefined && !nonEmpty(request.entityClass)) return false;
  if (request.preferredEncoding !== undefined && !validEncoding(request.preferredEncoding)) return false;

  const seenRequestIds = new Set<string>();
  let previousTimestamp = -1;
  for (const frame of request.frames) {
    if (!validateSubjectSegmentationRequestV1(frame)) return false;
    if (frame.sourceId !== request.sourceId || frame.semanticId !== request.semanticId) return false;
    if (frame.entityClass !== request.entityClass) return false;
    if (frame.timestampMs <= previousTimestamp) return false;
    if (seenRequestIds.has(frame.requestId)) return false;
    if (request.preferredEncoding !== undefined
      && frame.preferredEncoding !== undefined
      && frame.preferredEncoding !== request.preferredEncoding) return false;
    seenRequestIds.add(frame.requestId);
    previousTimestamp = frame.timestampMs;
  }
  return true;
};

/**
 * Validate and correlate a provider result before downstream mask/matte application.
 * This never repairs output, guesses identity, coerces time, or substitutes encodings.
 */
export const acceptSubjectSegmentationResultV1 = (
  request: SubjectSegmentationRequestV1,
  result: SubjectSegmentationResultV1,
): AcceptedSubjectSegmentationV1 | null => {
  if (!validateSubjectSegmentationRequestV1(request) || !result || typeof result !== "object") return null;
  if (result.requestId !== request.requestId
    || result.sourceId !== request.sourceId
    || result.semanticId !== request.semanticId
    || result.timestampMs !== request.timestampMs) return null;
  if (request.entityClass !== undefined && result.entityClass !== request.entityClass) return null;
  if (result.entityClass !== undefined && !nonEmpty(result.entityClass)) return null;
  if (!nonEmpty(result.providerId)) return null;
  if (result.providerVersion !== undefined && !nonEmpty(result.providerVersion)) return null;
  if (![result.confidence, result.edgeQuality, result.temporalConsistency, result.occlusion].every(finite01)) {
    return null;
  }

  const mask = result.mask;
  if (!mask || typeof mask !== "object" || !validEncoding(mask.encoding)) return null;
  if (request.preferredEncoding !== undefined && mask.encoding !== request.preferredEncoding) return null;
  if (!Number.isInteger(mask.width) || mask.width <= 0 || !Number.isInteger(mask.height) || mask.height <= 0) {
    return null;
  }
  if (!validNormalizedBox(mask.boundsNormalized)) return null;
  if (!mask.artifact || typeof mask.artifact !== "object"
    || !nonEmpty(mask.artifact.artifactId) || !nonEmpty(mask.artifact.contentType)
    || !validSha256(mask.artifact.sha256)) return null;
  if (!Array.isArray(result.evidenceIds)) return null;

  const evidenceIds = [...new Set(result.evidenceIds.filter(nonEmpty))];
  if (evidenceIds.length === 0) return null;

  return {
    ...result,
    evidenceIds,
  };
};

/**
 * Correlate a temporal provider result against every exact frame request. This is
 * intentionally stricter than single-frame acceptance because downstream native
 * image-sequence materialization requires homogeneous raster geometry and explicit
 * integrity evidence for every frame.
 */
export const acceptSubjectSegmentationSeriesResultV1 = (
  request: SubjectSegmentationSeriesRequestV1,
  result: SubjectSegmentationSeriesResultV1,
): AcceptedSubjectSegmentationSeriesV1 | null => {
  if (!validateSubjectSegmentationSeriesRequestV1(request) || !result || typeof result !== "object") return null;
  if (result.seriesId !== request.seriesId
    || result.sourceId !== request.sourceId
    || result.semanticId !== request.semanticId
    || result.entityClass !== request.entityClass
    || result.frameRate !== request.frameRate
    || !nonEmpty(result.providerId)
    || !Array.isArray(result.frames)
    || result.frames.length !== request.frames.length
    || !Array.isArray(result.evidenceIds)) return null;
  if (result.providerVersion !== undefined && !nonEmpty(result.providerVersion)) return null;

  const evidenceIds = [...new Set(result.evidenceIds.filter(nonEmpty))];
  if (evidenceIds.length === 0) return null;

  const acceptedFrames: AcceptedSubjectSegmentationV1[] = [];
  let referenceMask: SegmentationMaskDescriptorV1 | null = null;
  for (let index = 0; index < request.frames.length; index += 1) {
    const accepted = acceptSubjectSegmentationResultV1(request.frames[index], result.frames[index]);
    if (!accepted) return null;
    if (accepted.providerId !== result.providerId || accepted.providerVersion !== result.providerVersion) return null;
    if (request.preferredEncoding !== undefined && accepted.mask.encoding !== request.preferredEncoding) return null;
    if (!requiredSha256(accepted.mask.artifact.sha256)) return null;

    if (referenceMask === null) {
      referenceMask = accepted.mask;
    } else if (accepted.mask.encoding !== referenceMask.encoding
      || accepted.mask.width !== referenceMask.width
      || accepted.mask.height !== referenceMask.height
      || accepted.mask.artifact.contentType !== referenceMask.artifact.contentType
      || !sameNormalizedBox(accepted.mask.boundsNormalized, referenceMask.boundsNormalized)) {
      return null;
    }
    acceptedFrames.push(accepted);
  }

  return {
    ...result,
    frames: acceptedFrames,
    evidenceIds,
  };
};
