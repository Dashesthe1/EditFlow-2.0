import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const M4_SEGMENTATION_RUNTIME_EVIDENCE_SCHEMA_V1 =
  "editflow.m4.segmentation-runtime-evidence.v1" as const;
const M4_SEGMENTATION_RUNTIME_PROVIDER_ID_V1 = "sam3.1.local" as const;
const M4_SEGMENTATION_RUNTIME_SIDECAR_SCHEMA_V1 =
  "editflow.segmentation.sam3.1.sequence.v1" as const;
const M4_SEGMENTATION_RUNTIME_MODEL_FAMILY_V1 = "sam3.1" as const;
const LOWER_SHA256 = /^[0-9a-f]{64}$/;
const EVIDENCE_ID_V1 = /^[A-Za-z0-9][A-Za-z0-9:._/-]{2,127}$/;

export interface M4SegmentationRuntimeEvidenceV1 {
  readonly schema: typeof M4_SEGMENTATION_RUNTIME_EVIDENCE_SCHEMA_V1;
  readonly providerId: typeof M4_SEGMENTATION_RUNTIME_PROVIDER_ID_V1;
  readonly sidecarSchema: typeof M4_SEGMENTATION_RUNTIME_SIDECAR_SCHEMA_V1;
  readonly modelFamily: typeof M4_SEGMENTATION_RUNTIME_MODEL_FAMILY_V1;
  readonly evidenceId: string;
  readonly checkpointSha256: string;
  readonly resultSha256: string;
  readonly sourceFixtureCount: number;
  readonly liveInferenceAccepted: true;
  readonly exactCorrelationAccepted: true;
  readonly perFrameSha256Accepted: true;
  readonly materiallyDifferentTransferAccepted: true;
  readonly noHiddenFallbackAccepted: true;
  readonly temporalMaterialAccepted: true;
}
export interface M4SegmentationRuntimeEvidenceFileV1 {
  readonly evidencePath: string;
  readonly sha256Path?: string;
}

export interface TrustedM4SegmentationRuntimeEvidenceV1 {
  readonly evidence: M4SegmentationRuntimeEvidenceV1;
  readonly evidencePath: string;
  readonly evidenceFileSha256: string;
}

const EXACT_KEYS = Object.freeze([
  "checkpointSha256",
  "evidenceId",
  "exactCorrelationAccepted",
  "liveInferenceAccepted",
  "materiallyDifferentTransferAccepted",
  "modelFamily",
  "noHiddenFallbackAccepted",
  "perFrameSha256Accepted",
  "providerId",
  "resultSha256",
  "schema",
  "sidecarSchema",
  "sourceFixtureCount",
  "temporalMaterialAccepted",
] as const);
const TRUSTED_ATTESTATIONS = new WeakSet<object>();

const hasExactKeys = (value: Record<string, unknown>): boolean => {
  const keys = Object.keys(value).sort();
  return keys.length === EXACT_KEYS.length &&
    keys.every((key, index) => key === EXACT_KEYS[index]);
};
export const isAcceptedM4SegmentationRuntimeEvidenceV1 = (
  value: unknown,
): value is M4SegmentationRuntimeEvidenceV1 => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const evidence = value as Record<string, unknown>;
  if (!hasExactKeys(evidence)) return false;
  return evidence.schema === M4_SEGMENTATION_RUNTIME_EVIDENCE_SCHEMA_V1 &&
    evidence.providerId === M4_SEGMENTATION_RUNTIME_PROVIDER_ID_V1 &&
    evidence.sidecarSchema === M4_SEGMENTATION_RUNTIME_SIDECAR_SCHEMA_V1 &&
    evidence.modelFamily === M4_SEGMENTATION_RUNTIME_MODEL_FAMILY_V1 &&
    typeof evidence.evidenceId === "string" && EVIDENCE_ID_V1.test(evidence.evidenceId) &&
    typeof evidence.checkpointSha256 === "string" && LOWER_SHA256.test(evidence.checkpointSha256) &&
    typeof evidence.resultSha256 === "string" && LOWER_SHA256.test(evidence.resultSha256) &&
    Number.isInteger(evidence.sourceFixtureCount) && (evidence.sourceFixtureCount as number) >= 2 &&
    evidence.liveInferenceAccepted === true &&
    evidence.exactCorrelationAccepted === true &&
    evidence.perFrameSha256Accepted === true &&
    evidence.materiallyDifferentTransferAccepted === true &&
    evidence.noHiddenFallbackAccepted === true &&
    evidence.temporalMaterialAccepted === true;
};

export const isTrustedM4SegmentationRuntimeEvidenceV1 = (
  value: unknown,
): value is TrustedM4SegmentationRuntimeEvidenceV1 => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (!TRUSTED_ATTESTATIONS.has(value as object)) return false;
  const candidate = value as Partial<TrustedM4SegmentationRuntimeEvidenceV1>;
  return typeof candidate.evidencePath === "string" &&
    typeof candidate.evidenceFileSha256 === "string" &&
    LOWER_SHA256.test(candidate.evidenceFileSha256) &&
    isAcceptedM4SegmentationRuntimeEvidenceV1(candidate.evidence);
};
const normalizeDigestSidecar = (value: string): string | null => {
  const normalized = value.endsWith("\r\n")
    ? value.slice(0, -2)
    : value.endsWith("\n")
      ? value.slice(0, -1)
      : value;
  return LOWER_SHA256.test(normalized) ? normalized : null;
};

export const loadTrustedM4SegmentationRuntimeEvidenceV1 = async (
  source: M4SegmentationRuntimeEvidenceFileV1,
): Promise<TrustedM4SegmentationRuntimeEvidenceV1 | null> => {
  try {
    const sha256Path = source.sha256Path ?? `${source.evidencePath}.sha256`;
    const [evidenceBytes, digestText] = await Promise.all([
      readFile(source.evidencePath),
      readFile(sha256Path, "utf8"),
    ]);
    const expectedDigest = normalizeDigestSidecar(digestText);
    if (expectedDigest === null) return null;
    const actualDigest = createHash("sha256").update(evidenceBytes).digest("hex");
    if (actualDigest !== expectedDigest) return null;

    const parsed = JSON.parse(evidenceBytes.toString("utf8")) as unknown;
    if (!isAcceptedM4SegmentationRuntimeEvidenceV1(parsed)) return null;
    const evidence = Object.freeze({ ...parsed });
    const attestation = Object.freeze({
      evidence,
      evidencePath: source.evidencePath,
      evidenceFileSha256: actualDigest,
    });
    TRUSTED_ATTESTATIONS.add(attestation);
    return attestation;
  } catch {
    return null;
  }
};
