import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const M5_ROTO_BRUSH_RUNTIME_EVIDENCE_SCHEMA_V1 =
  "editflow.m5.roto-brush-runtime-evidence.v1" as const;
const LOWER_SHA256 = /^[0-9a-f]{64}$/;
const EVIDENCE_ID_V1 = /^[A-Za-z0-9][A-Za-z0-9:._/-]{2,127}$/;

const EXPECTED_PROOF_IDS = Object.freeze({
  foregroundSeed: "M5_ROTO_BRUSH_FOREGROUND_SEED_RETAINED_REAL_AE_V1",
  backgroundSeed: "M5_ROTO_BRUSH_BACKGROUND_SEED_RETAINED_REAL_AE_V1",
  propagationForward: "M5_ROTO_BRUSH_PROPAGATION_FORWARD_RETAINED_REAL_AE_V1",
  propagationBackward: "M5_ROTO_BRUSH_PROPAGATION_BACKWARD_RETAINED_REAL_AE_V1",
  refineEdge: "M5_ROTO_BRUSH_REFINE_EDGE_RETAINED_REAL_AE_V1",
  freezeState: "M5_ROTO_BRUSH_FREEZE_STATE_DISCOVERY_RETAINED_REAL_AE_V1",
  repairStroke: "M5_ROTO_BRUSH_REPAIR_STROKE_RETAINED_REAL_AE_V1",
  trackMatteExport: "M5_ROTO_BRUSH_TRACK_MATTE_EXPORT_RETAINED_REAL_AE_V1",
  materialTransfer: "M5_ROTO_BRUSH_MATERIAL_TRANSFER_RETAINED_REAL_AE_V1",
  popupFault: "M5_ROTO_BRUSH_POPUP_FAULT_HANDLING_RETAINED_REAL_AE_V1",
} as const);

type ProofKeyV1 = keyof typeof EXPECTED_PROOF_IDS;
export interface M5RotoBrushRuntimeProofEvidenceV1 {
  readonly proofId: string;
  readonly resultSha256: string;
}
export type M5RotoBrushRuntimeProofsV1 = Readonly<Record<ProofKeyV1, M5RotoBrushRuntimeProofEvidenceV1>>;

export interface M5RotoBrushRuntimeEvidenceV1 {
  readonly schema: typeof M5_ROTO_BRUSH_RUNTIME_EVIDENCE_SCHEMA_V1;
  readonly evidenceId: string;
  readonly proofs: M5RotoBrushRuntimeProofsV1;
  readonly sourceFixtureCount: number;
  readonly sameProcessAccepted: true;
  readonly exactRestoreAccepted: true;
  readonly materiallyDifferentTransferAccepted: true;
  readonly popupFaultRecoveryAccepted: true;
  readonly trackMatteExportAccepted: true;
  readonly maskExportAccepted: false;
  readonly maxMeasuredWarmAeActionGapMs: number;
  readonly popupRecoveryRoundtripMs: number;
}
export interface M5RotoBrushRuntimeEvidenceFileV1 {
  readonly evidencePath: string;
  readonly sha256Path?: string;
}
export interface TrustedM5RotoBrushRuntimeEvidenceV1 {
  readonly evidence: M5RotoBrushRuntimeEvidenceV1;
  readonly evidencePath: string;
  readonly evidenceFileSha256: string;
}

const ROOT_KEYS = Object.freeze([
  "evidenceId", "exactRestoreAccepted", "maskExportAccepted", "materiallyDifferentTransferAccepted",
  "maxMeasuredWarmAeActionGapMs", "popupFaultRecoveryAccepted", "popupRecoveryRoundtripMs", "proofs",
  "sameProcessAccepted", "schema", "sourceFixtureCount", "trackMatteExportAccepted",
] as const);
const PROOF_KEYS = Object.freeze(Object.keys(EXPECTED_PROOF_IDS).sort());
const PROOF_RECORD_KEYS = Object.freeze(["proofId", "resultSha256"] as const);
const TRUSTED_ATTESTATIONS = new WeakSet<object>();

const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
};
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export const isAcceptedM5RotoBrushRuntimeEvidenceV1 = (value: unknown): value is M5RotoBrushRuntimeEvidenceV1 => {
  const evidence = record(value);
  if (!evidence || !exactKeys(evidence, ROOT_KEYS)) return false;
  const proofs = record(evidence["proofs"]);
  if (!proofs || !exactKeys(proofs, PROOF_KEYS)) return false;
  for (const key of PROOF_KEYS) {
    const proof = record(proofs[key]);
    if (!proof || !exactKeys(proof, PROOF_RECORD_KEYS)) return false;
    const expectedId = EXPECTED_PROOF_IDS[key as ProofKeyV1];
    if (proof["proofId"] !== expectedId || typeof proof["resultSha256"] !== "string" || !LOWER_SHA256.test(proof["resultSha256"])) return false;
  }
  return evidence["schema"] === M5_ROTO_BRUSH_RUNTIME_EVIDENCE_SCHEMA_V1
    && typeof evidence["evidenceId"] === "string" && EVIDENCE_ID_V1.test(evidence["evidenceId"])
    && Number.isInteger(evidence["sourceFixtureCount"]) && (evidence["sourceFixtureCount"] as number) >= 2
    && evidence["sameProcessAccepted"] === true
    && evidence["exactRestoreAccepted"] === true
    && evidence["materiallyDifferentTransferAccepted"] === true
    && evidence["popupFaultRecoveryAccepted"] === true
    && evidence["trackMatteExportAccepted"] === true
    && evidence["maskExportAccepted"] === false
    && typeof evidence["maxMeasuredWarmAeActionGapMs"] === "number" && Number.isFinite(evidence["maxMeasuredWarmAeActionGapMs"]) && (evidence["maxMeasuredWarmAeActionGapMs"] as number) >= 0 && (evidence["maxMeasuredWarmAeActionGapMs"] as number) <= 3000
    && typeof evidence["popupRecoveryRoundtripMs"] === "number" && Number.isFinite(evidence["popupRecoveryRoundtripMs"]) && (evidence["popupRecoveryRoundtripMs"] as number) >= 0 && (evidence["popupRecoveryRoundtripMs"] as number) <= 3000;
};

export const isTrustedM5RotoBrushRuntimeEvidenceV1 = (value: unknown): value is TrustedM5RotoBrushRuntimeEvidenceV1 => {
  const candidate = record(value);
  return !!candidate && TRUSTED_ATTESTATIONS.has(candidate)
    && typeof candidate["evidencePath"] === "string"
    && typeof candidate["evidenceFileSha256"] === "string" && LOWER_SHA256.test(candidate["evidenceFileSha256"])
    && isAcceptedM5RotoBrushRuntimeEvidenceV1(candidate["evidence"]);
};
const normalizeDigestSidecar = (value: string): string | null => {
  const normalized = value.endsWith("\r\n") ? value.slice(0, -2) : value.endsWith("\n") ? value.slice(0, -1) : value;
  return LOWER_SHA256.test(normalized) ? normalized : null;
};

export const loadTrustedM5RotoBrushRuntimeEvidenceV1 = async (
  source: M5RotoBrushRuntimeEvidenceFileV1,
): Promise<TrustedM5RotoBrushRuntimeEvidenceV1 | null> => {
  try {
    const sha256Path = source.sha256Path ?? `${source.evidencePath}.sha256`;
    const [evidenceBytes, digestText] = await Promise.all([readFile(source.evidencePath), readFile(sha256Path, "utf8")]);
    const expectedDigest = normalizeDigestSidecar(digestText);
    if (expectedDigest === null) return null;
    const actualDigest = createHash("sha256").update(evidenceBytes).digest("hex");
    if (actualDigest !== expectedDigest) return null;
    const parsed = JSON.parse(evidenceBytes.toString("utf8")) as unknown;
    if (!isAcceptedM5RotoBrushRuntimeEvidenceV1(parsed)) return null;
    const proofs = Object.freeze(Object.fromEntries(PROOF_KEYS.map((key) => [key, Object.freeze({ ...parsed.proofs[key as ProofKeyV1] })]))) as M5RotoBrushRuntimeProofsV1;
    const evidence = Object.freeze({ ...parsed, proofs });
    const attestation = Object.freeze({ evidence, evidencePath: source.evidencePath, evidenceFileSha256: actualDigest });
    TRUSTED_ATTESTATIONS.add(attestation);
    return attestation;
  } catch {
    return null;
  }
};
