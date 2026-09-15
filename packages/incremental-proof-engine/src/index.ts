import { createHash } from "node:crypto";

export type ProofStrategy = "INCREMENTAL_FIRST" | "FULL_ACCEPTANCE";
export type IncrementalProofAction = "REUSE_PASS" | "RUN_DELTA" | "RUN_FULL" | "ESCALATE";

export interface ProofDependencyDigestV1 {
  readonly id: string;
  readonly sha256: string;
}

export interface IncrementalProofNodeV1 {
  readonly proofId: string;
  readonly nodeId: string;
  readonly strategy: ProofStrategy;
  readonly environmentFingerprint: string;
  readonly checkpointKey?: string | null;
  readonly dependencies: readonly ProofDependencyDigestV1[];
  readonly allowEvidenceReuse?: boolean;
}

export interface IncrementalProofTokenV1 {
  readonly schema: "editflow.incremental-proof-token.v1";
  readonly proofId: string;
  readonly nodeId: string;
  readonly contentKey: string;
  readonly classification: "PASS";
  readonly producedAt: string;
  readonly resultDigest: string;
}

export interface IncrementalProofDecisionV1 {
  readonly action: IncrementalProofAction;
  readonly contentKey: string;
  readonly reason: string;
  readonly reusableToken: IncrementalProofTokenV1 | null;
}

export interface VisualStateLeaseV1 {
  readonly schema: "editflow.visual-state-lease.v1";
  readonly leaseId: string;
  readonly aePid: number;
  readonly projectRevision: number;
  readonly targetBindingHash: string;
  readonly windowGeometryHash: string;
  readonly roiHashes: Readonly<Record<string, string>>;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}

export interface VisualStateObservationV1 {
  readonly aePid: number;
  readonly projectRevision: number;
  readonly targetBindingHash: string;
  readonly windowGeometryHash: string;
  readonly roiHashes: Readonly<Record<string, string>>;
  readonly nowMs: number;
}

export interface FailureCapsuleV1 {
  readonly schema: "editflow.failure-capsule.v1";
  readonly proofId: string;
  readonly nodeId: string;
  readonly failureClass: string;
  readonly detail: string;
  readonly lastAcceptedNodeId: string | null;
  readonly codeDiffDigest: string | null;
  readonly targetBindingHash: string | null;
  readonly projectRevision: number | null;
  readonly evidenceIds: readonly string[];
  readonly diagnosticResults: Readonly<Record<string, unknown>>;
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const target: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) target[key] = canonicalize(source[key]);
    return target;
  }
  return value;
};

export const sha256Text = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

export const contentKeyForProofNode = (node: IncrementalProofNodeV1): string => {
  const payload = canonicalize({
    proofId: node.proofId,
    nodeId: node.nodeId,
    environmentFingerprint: node.environmentFingerprint,
    checkpointKey: node.checkpointKey ?? null,
    dependencies: [...node.dependencies].sort((a, b) => a.id.localeCompare(b.id)),
  });
  return `IPV1_${sha256Text(JSON.stringify(payload))}`;
};

export const decideIncrementalProof = (
  node: IncrementalProofNodeV1,
  token: IncrementalProofTokenV1 | null,
): IncrementalProofDecisionV1 => {
  const contentKey = contentKeyForProofNode(node);
  if (node.strategy === "FULL_ACCEPTANCE") {
    return { action: "RUN_FULL", contentKey, reason: "Acceptance mode always re-runs the complete proof chain.", reusableToken: null };
  }
  if (node.allowEvidenceReuse === false) {
    return { action: "RUN_DELTA", contentKey, reason: "This proof node explicitly forbids evidence reuse.", reusableToken: null };
  }
  if (!token) return { action: "RUN_DELTA", contentKey, reason: "No reusable PASS token exists.", reusableToken: null };
  if (token.proofId !== node.proofId || token.nodeId !== node.nodeId || token.contentKey !== contentKey) {
    return { action: "RUN_DELTA", contentKey, reason: "Cached evidence dependencies no longer match.", reusableToken: null };
  }
  return { action: "REUSE_PASS", contentKey, reason: "All content-addressed dependencies still match the accepted PASS token.", reusableToken: token };
};

export const validateVisualStateLease = (
  lease: VisualStateLeaseV1,
  observed: VisualStateObservationV1,
): Readonly<{ valid: boolean; reason: string }> => {
  if (observed.nowMs > lease.expiresAtMs) return { valid: false, reason: "LEASE_EXPIRED" };
  if (observed.aePid !== lease.aePid) return { valid: false, reason: "AE_PROCESS_CHANGED" };
  if (observed.projectRevision !== lease.projectRevision) return { valid: false, reason: "PROJECT_REVISION_CHANGED" };
  if (observed.targetBindingHash !== lease.targetBindingHash) return { valid: false, reason: "TARGET_BINDING_CHANGED" };
  if (observed.windowGeometryHash !== lease.windowGeometryHash) return { valid: false, reason: "WINDOW_GEOMETRY_CHANGED" };
  for (const [roi, expected] of Object.entries(lease.roiHashes)) {
    if (observed.roiHashes[roi] !== expected) return { valid: false, reason: `ROI_CHANGED:${roi}` };
  }
  return { valid: true, reason: "LEASE_VALID" };
};

export const buildFailureCapsule = (input: Omit<FailureCapsuleV1, "schema">): FailureCapsuleV1 => ({
  schema: "editflow.failure-capsule.v1",
  ...input,
});

export const createProofToken = (
  node: IncrementalProofNodeV1,
  resultDigest: string,
  producedAt = new Date().toISOString(),
): IncrementalProofTokenV1 => ({
  schema: "editflow.incremental-proof-token.v1",
  proofId: node.proofId,
  nodeId: node.nodeId,
  contentKey: contentKeyForProofNode(node),
  classification: "PASS",
  producedAt,
  resultDigest,
});
