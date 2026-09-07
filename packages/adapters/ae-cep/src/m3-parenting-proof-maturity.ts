import type { CapabilityRecord, ProofMaturity } from "../../../core-contracts/src/index.js";

export const M3_PARENTING_P1_P2_ACCEPTED_SOURCE_COMMIT = "026e83dabe6e354c192f36518234f43e559048e7" as const;
export const M3_PARENTING_P1_P2_ACCEPTANCE_CONTROL_COMMIT = "9b41d8eb576fa809d4aae3ede6e381160ecb483d" as const;
export const M3_PARENTING_P1_P2_ACCEPTANCE_RUN = 34082201184 as const;
export const M3_PARENTING_P1_P2_ACCEPTANCE_RUN_ATTEMPT = 1 as const;
export const M3_PARENTING_P1_P2_ACCEPTANCE_JOB = 101619497171 as const;
export const M3_PARENTING_P1_P2_ACCEPTANCE_ARTIFACT = 10004053330 as const;

export const M3_PARENTING_P5_ACCEPTED_SOURCE_COMMIT = "59f0401d49dd0c92e86246df59c801e8ed76616f" as const;
export const M3_PARENTING_P5_ACCEPTANCE_CONTROL_COMMIT = "046d0d4bb6165875acb4965b1d6d94539714571a" as const;
export const M3_PARENTING_P5_ACCEPTANCE_RUN = 34086348504 as const;
export const M3_PARENTING_P5_ACCEPTANCE_RUN_ATTEMPT = 1 as const;
export const M3_PARENTING_P5_ACCEPTANCE_JOB = 101631020844 as const;
export const M3_PARENTING_P5_ACCEPTANCE_ARTIFACT = 10005344570 as const;

const M3_PARENTING_P1_P2_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.layer.parent.set_preserve_transform": "STRUCTURAL",
  "ae.layer.parent.clear_preserve_transform": "STRUCTURAL",
  "ae.layer.parenting.readback": "STRUCTURAL",
});

const M3_PARENTING_ACCEPTED_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.layer.parent.set_preserve_transform": "TRANSFER",
  "ae.layer.parent.clear_preserve_transform": "TRANSFER",
  "ae.layer.parenting.readback": "TRANSFER",
});

export const m3ParentingP1P2MaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_PARENTING_P1_P2_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const m3ParentingAcceptedProofMaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_PARENTING_ACCEPTED_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const applyM3ParentingAcceptedP1P2Evidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => ({
  ...capability,
  // Historical P1/P2-only projection retained for proof-stage tests.
  status: "PARTIAL" as const,
  proofMaturity: m3ParentingP1P2MaturityForCapability(String(capability.id)),
}));

export const applyM3ParentingAcceptedProofEvidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => {
  const proofMaturity = m3ParentingAcceptedProofMaturityForCapability(String(capability.id));
  const status: CapabilityRecord["status"] = proofMaturity === "TRANSFER" || proofMaturity === "ROBUST"
    ? "FULL"
    : "PARTIAL";

  return {
    ...capability,
    // Accepted real-AE P1-P5 evidence completes the representable protocol-1.4
    // preserve-transform parenting envelope through transfer. Save/reopen plus a
    // distinct authenticated reconnect preserves exact relationship/geometry and
    // fresh clear/re-parent/readback authority. Non-representable shear remains
    // fail-closed; FULL does not weaken that explicit host limitation.
    status,
    proofMaturity,
  };
});
