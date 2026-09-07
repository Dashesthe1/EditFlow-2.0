import type { CapabilityRecord, ProofMaturity } from "../../../core-contracts/src/index.js";

export const M3_TEMPORAL_INTERPOLATION_P1_P2_ACCEPTED_SOURCE_COMMIT = "9b660195c265f35fff79616b1ae345c01aeaec78" as const;
export const M3_TEMPORAL_INTERPOLATION_P1_P2_ACCEPTANCE_CONTROL_COMMIT = "bfa22a7f6f7254325899e6b3d3b07d14b2fdadd7" as const;
export const M3_TEMPORAL_INTERPOLATION_P1_P2_ACCEPTANCE_RUN = 34163522485 as const;
export const M3_TEMPORAL_INTERPOLATION_P1_P2_ACCEPTANCE_JOB = 101869972996 as const;
export const M3_TEMPORAL_INTERPOLATION_P1_P2_ACCEPTANCE_ARTIFACT = 10033403065 as const;
export const M3_TEMPORAL_INTERPOLATION_P1_P2_ACCEPTANCE_ARTIFACT_SHA256 = "a029092ae5a0b0a3f492abd3c71276816081d36b2b7e00e3ccc08a5537406977" as const;

const M3_TEMPORAL_INTERPOLATION_P1_P2_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.property.temporal_interpolation.set": "STRUCTURAL",
  "ae.property.temporal_interpolation.readback": "STRUCTURAL",
});

export const m3TemporalInterpolationP1P2MaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_TEMPORAL_INTERPOLATION_P1_P2_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const applyM3TemporalInterpolationAcceptedP1P2Evidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => ({
  ...capability,
  // Accepted real-AE P1/P2 evidence proves deterministic rejection plus exact
  // host structural readback for protocol 1.7. P3 visual proof, P4 induced-
  // failure rollback, and P5 save/reopen/reconnect transfer remain unproven,
  // so structural evidence must never promote this tranche to FULL.
  status: "PARTIAL" as const,
  proofMaturity: m3TemporalInterpolationP1P2MaturityForCapability(String(capability.id)),
}));
