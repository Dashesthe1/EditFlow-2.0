import type { CapabilityRecord, ProofMaturity } from "../../../core-contracts/src/index.js";

export const M3_PARENTING_P1_P2_ACCEPTED_SOURCE_COMMIT = "026e83dabe6e354c192f36518234f43e559048e7" as const;
export const M3_PARENTING_P1_P2_ACCEPTANCE_CONTROL_COMMIT = "9b41d8eb576fa809d4aae3ede6e381160ecb483d" as const;
export const M3_PARENTING_P1_P2_ACCEPTANCE_RUN = 34082201184 as const;
export const M3_PARENTING_P1_P2_ACCEPTANCE_RUN_ATTEMPT = 1 as const;
export const M3_PARENTING_P1_P2_ACCEPTANCE_JOB = 101619497171 as const;
export const M3_PARENTING_P1_P2_ACCEPTANCE_ARTIFACT = 10004053330 as const;

const M3_PARENTING_P1_P2_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.layer.parent.set_preserve_transform": "STRUCTURAL",
  "ae.layer.parent.clear_preserve_transform": "STRUCTURAL",
  "ae.layer.parenting.readback": "STRUCTURAL",
});

export const m3ParentingP1P2MaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_PARENTING_P1_P2_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const applyM3ParentingAcceptedP1P2Evidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => ({
  ...capability,
  // P1/P2 proves real-AE validation, exact parent identity, idempotency,
  // comp-space no-jump geometry, and cleanup restoration. Parenting remains
  // PARTIAL until visual P3, induced-failure rollback P4, and transfer P5 are
  // independently accepted.
  status: "PARTIAL" as const,
  proofMaturity: m3ParentingP1P2MaturityForCapability(String(capability.id)),
}));
