import type { CapabilityRecord, ProofMaturity } from "../../../core-contracts/src/index.js";

export const M3_TEMPORAL_INTERPOLATION_P1_P2_ACCEPTED_SOURCE_COMMIT = "9b660195c265f35fff79616b1ae345c01aeaec78" as const;
export const M3_TEMPORAL_INTERPOLATION_P1_P2_ACCEPTANCE_CONTROL_COMMIT = "bfa22a7f6f7254325899e6b3d3b07d14b2fdadd7" as const;
export const M3_TEMPORAL_INTERPOLATION_P1_P2_ACCEPTANCE_RUN = 34163522485 as const;
export const M3_TEMPORAL_INTERPOLATION_P1_P2_ACCEPTANCE_JOB = 101869972996 as const;
export const M3_TEMPORAL_INTERPOLATION_P1_P2_ACCEPTANCE_ARTIFACT = 10033403065 as const;
export const M3_TEMPORAL_INTERPOLATION_P1_P2_ACCEPTANCE_ARTIFACT_SHA256 = "a029092ae5a0b0a3f492abd3c71276816081d36b2b7e00e3ccc08a5537406977" as const;

export const M3_TEMPORAL_INTERPOLATION_P3_P4_ACCEPTED_SOURCE_COMMIT = "6b218bf3f6ba0014a6a78fa33769f170dc300fa3" as const;
export const M3_TEMPORAL_INTERPOLATION_P3_P4_ACCEPTANCE_CONTROL_COMMIT = "5cb3e7bd9fd1fc5cf0d6ff5c17ff7946566c9e45" as const;
export const M3_TEMPORAL_INTERPOLATION_P3_P4_ACCEPTANCE_RUN = 34166441340 as const;
export const M3_TEMPORAL_INTERPOLATION_P3_P4_ACCEPTANCE_JOB = 101878333951 as const;
export const M3_TEMPORAL_INTERPOLATION_P3_P4_ACCEPTANCE_ARTIFACT = 10034335983 as const;
export const M3_TEMPORAL_INTERPOLATION_P3_P4_ACCEPTANCE_ARTIFACT_SHA256 = "f66aeb095e28e14d736689a038045f306d5324803c8c49bd29177220ec38ae6a" as const;

export const M3_TEMPORAL_INTERPOLATION_P5_ACCEPTED_SOURCE_COMMIT = "9d7533cd5c3a3964ffd8ce82cd17cd6c718d43f9" as const;
export const M3_TEMPORAL_INTERPOLATION_P5_ACCEPTANCE_CONTROL_COMMIT = "fa6e7f9e07fef32b5bf79ec4a3c1fcdbddac4f57" as const;
export const M3_TEMPORAL_INTERPOLATION_P5_ACCEPTANCE_RUN = 34167719180 as const;
export const M3_TEMPORAL_INTERPOLATION_P5_ACCEPTANCE_JOB = 101881984709 as const;
export const M3_TEMPORAL_INTERPOLATION_P5_ACCEPTANCE_ARTIFACT = 10034708844 as const;
export const M3_TEMPORAL_INTERPOLATION_P5_ACCEPTANCE_ARTIFACT_SHA256 = "463fd32231e5689b8f8f2a1827470310e9ccdaaf83a006ba8c492677b4128132" as const;

const M3_TEMPORAL_INTERPOLATION_P1_P2_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.property.temporal_interpolation.set": "STRUCTURAL",
  "ae.property.temporal_interpolation.readback": "STRUCTURAL",
});

const M3_TEMPORAL_INTERPOLATION_ACCEPTED_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.property.temporal_interpolation.set": "TRANSFER",
  "ae.property.temporal_interpolation.readback": "TRANSFER",
});

export const m3TemporalInterpolationP1P2MaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_TEMPORAL_INTERPOLATION_P1_P2_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const m3TemporalInterpolationAcceptedProofMaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_TEMPORAL_INTERPOLATION_ACCEPTED_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const applyM3TemporalInterpolationAcceptedP1P2Evidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => ({
  ...capability,
  // Historical P1/P2-only projection retained for proof-stage tests and
  // provenance. Structural evidence alone must never promote to FULL.
  status: "PARTIAL" as const,
  proofMaturity: m3TemporalInterpolationP1P2MaturityForCapability(String(capability.id)),
}));

export const applyM3TemporalInterpolationAcceptedProofEvidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => {
  const proofMaturity = m3TemporalInterpolationAcceptedProofMaturityForCapability(String(capability.id));
  const status: CapabilityRecord["status"] = proofMaturity === "TRANSFER" || proofMaturity === "ROBUST"
    ? "FULL"
    : "PARTIAL";

  return {
    ...capability,
    // Accepted real-AE P1-P5 evidence completes protocol 1.7 through transfer:
    // exact directional interpolation and temporal flags are structurally and
    // visually proven, proof-gated post-mutation failure self-rolls back through
    // the AE Undo boundary, the saved state survives reopen into a distinct
    // authenticated CEP session, and that fresh session retains exact temporal
    // mutation/readback authority. Later Graph Editor numeric ease/influence,
    // spatial interpolation, and rendering-control tranches remain separate.
    status,
    proofMaturity,
  };
});
