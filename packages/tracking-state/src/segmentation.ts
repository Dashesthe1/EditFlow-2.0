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
