import type { CapabilityRecord, ProofMaturity } from "../../../core-contracts/src/index.js";

export const M3_TEMPORAL_EASE_P1_P2_ACCEPTED_SOURCE_COMMIT = "718fd72dd9b07c3605163354cf7ce7be26ef8f23" as const;
export const M3_TEMPORAL_EASE_P1_P2_ACCEPTANCE_CONTROL_COMMIT = "033e4e2f005a175f48fefaca1912dc54716d7eb4" as const;
export const M3_TEMPORAL_EASE_P1_P2_ACCEPTANCE_RUN = 34176061647 as const;
export const M3_TEMPORAL_EASE_P1_P2_ACCEPTANCE_JOB = 101905568438 as const;
export const M3_TEMPORAL_EASE_P1_P2_ACCEPTANCE_ARTIFACT = 10037290595 as const;
export const M3_TEMPORAL_EASE_P1_P2_ACCEPTANCE_ARTIFACT_SHA256 = "b1046dfe32b1b1c73a3acd65e5d5b3deb90fef50e01170ed3b8e8e04d4e2439b" as const;

export const M3_TEMPORAL_EASE_P3_P4_ACCEPTED_SOURCE_COMMIT = "2a9d50f0099278dede792ed1203e338f52dfe122" as const;
export const M3_TEMPORAL_EASE_P3_P4_ACCEPTANCE_CONTROL_COMMIT = "b1b8542b53f49ff63689ee51bf5095a767f754f5" as const;
export const M3_TEMPORAL_EASE_P3_P4_ACCEPTANCE_RUN = 34176960701 as const;
export const M3_TEMPORAL_EASE_P3_P4_ACCEPTANCE_JOB = 101908166885 as const;
export const M3_TEMPORAL_EASE_P3_P4_ACCEPTANCE_ARTIFACT = 10037617172 as const;
export const M3_TEMPORAL_EASE_P3_P4_ACCEPTANCE_ARTIFACT_SHA256 = "e12076fce752dc2eac4b23939d40d2fd839a1d44095ce0aaad3ee4b51fd15903" as const;

export const M3_TEMPORAL_EASE_P5_ACCEPTED_SOURCE_COMMIT = "2fac69c519abe9b960ffe517f744b5e824f84253" as const;
export const M3_TEMPORAL_EASE_P5_ACCEPTANCE_CONTROL_COMMIT = "277e63ef585f9266cf52574111ea90536d447f14" as const;
export const M3_TEMPORAL_EASE_P5_ACCEPTANCE_RUN = 34179909375 as const;
export const M3_TEMPORAL_EASE_P5_ACCEPTANCE_JOB = 101916716590 as const;
export const M3_TEMPORAL_EASE_P5_ACCEPTANCE_ARTIFACT = 10038543576 as const;
export const M3_TEMPORAL_EASE_P5_ACCEPTANCE_ARTIFACT_SHA256 = "826c3ace4d8aed717c979037e648406cc36f7174a8b64c2c80008d213d39d0f8" as const;
export const M3_TEMPORAL_EASE_P5_ACCEPTANCE_RESULT_SHA256 = "354601baacf1276bb9448f59f2c35bbf2af9e1bde5d2f8d36fe560486c667a02" as const;

const M3_TEMPORAL_EASE_P1_P2_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.property.temporal_ease.set": "STRUCTURAL",
  "ae.property.temporal_ease.readback": "STRUCTURAL",
});

const M3_TEMPORAL_EASE_ACCEPTED_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.property.temporal_ease.set": "TRANSFER",
  "ae.property.temporal_ease.readback": "TRANSFER",
});

export const m3TemporalEaseP1P2MaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_TEMPORAL_EASE_P1_P2_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const m3TemporalEaseAcceptedProofMaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_TEMPORAL_EASE_ACCEPTED_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const applyM3TemporalEaseAcceptedP1P2Evidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => ({
  ...capability,
  // Historical P1/P2-only projection retained for proof-stage tests and
  // provenance. Structural evidence alone must never promote to FULL.
  status: "PARTIAL" as const,
  proofMaturity: m3TemporalEaseP1P2MaturityForCapability(String(capability.id)),
}));

export const applyM3TemporalEaseAcceptedProofEvidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => {
  const proofMaturity = m3TemporalEaseAcceptedProofMaturityForCapability(String(capability.id));
  const status: CapabilityRecord["status"] = proofMaturity === "TRANSFER" || proofMaturity === "ROBUST"
    ? "FULL"
    : "PARTIAL";

  return {
    ...capability,
    // Accepted real-AE P1-P5 evidence completes protocol 1.8 through transfer:
    // deterministic validation and exact structural KeyframeEase readback,
    // viewer-visible scalar Opacity timing change, proof-gated rollback with
    // pixel-exact restoration, save/reopen persistence into a distinct
    // authenticated CEP session, and fresh-session live Scale cardinality-3
    // mutation/readback. This capability is temporal-ease only; spatial
    // tangents, roving keys, value-graph editing, and other Graph Editor
    // surfaces remain separate proof tranches.
    status,
    proofMaturity,
  };
});
