import type {
  CapabilityRecord,
  ProofMaturity,
} from "../../../core-contracts/src/index.js";

export const M5_TIME_REMAP_V27_ACCEPTED_SOURCE_COMMIT =
  "e6bfa2b5e540767d60a2b13e883b2acbef374cab" as const;
export const M5_TIME_REMAP_V27_ACCEPTANCE_RESULT =
  "proofs/diagnostics/m5-time-remap-v27-live-result.json" as const;
export const M5_TIME_REMAP_V27_ACCEPTANCE_RESULT_SHA256 =
  "3b6e55b51bc97bd7144aa767ad840228faa917e838ad7b871053925066b83a45" as const;
export const M5_TIME_REMAP_V27_ACCEPTED_AE_VERSION = "25.6.6" as const;

const ACCEPTED_CAPABILITIES = new Set<string>([
  "ae.layer.time_remap.enable",
  "ae.layer.time_remap.readback",
]);

export const m5TimeRemapAcceptedProofMaturityForCapability = (
  capabilityId: string,
): ProofMaturity =>
  ACCEPTED_CAPABILITIES.has(capabilityId) ? "STRUCTURAL" : "DECLARED";

export const applyM5TimeRemapAcceptedStructuralEvidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] =>
  capabilities.map((capability) => {
    const proofMaturity = m5TimeRemapAcceptedProofMaturityForCapability(
      String(capability.id),
    );
    return {
      ...capability,
      status: "PARTIAL" as const,
      proofMaturity,
    };
  });
