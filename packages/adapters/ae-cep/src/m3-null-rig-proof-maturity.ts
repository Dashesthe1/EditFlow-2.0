import type { CapabilityRecord, ProofMaturity } from "../../../core-contracts/src/index.js";

export const M3_NULL_RIG_P1_P2_ACCEPTED_SOURCE_COMMIT = "955e24401ee37febf998d8ec4c544e345aebab6d" as const;
export const M3_NULL_RIG_P1_P2_ACCEPTANCE_CONTROL_COMMIT = "9db379f53812abacc3771e3206e279dd5bca5b5f" as const;
export const M3_NULL_RIG_P1_P2_ACCEPTANCE_RUN = 34139625065 as const;
export const M3_NULL_RIG_P1_P2_ACCEPTANCE_RUN_ATTEMPT = 1 as const;
export const M3_NULL_RIG_P1_P2_ACCEPTANCE_JOB = 101798432327 as const;
export const M3_NULL_RIG_P1_P2_ACCEPTANCE_ARTIFACT = 10025391737 as const;

export const M3_NULL_RIG_P5_ACCEPTED_SOURCE_COMMIT = "4736f4ceee6e578cda0a199137295644eeb92607" as const;
export const M3_NULL_RIG_P5_ACCEPTANCE_CONTROL_COMMIT = "ddfb8fb52a850c7efdaf61287bf9572c669b7408" as const;
export const M3_NULL_RIG_P5_ACCEPTANCE_RUN = 34142031586 as const;
export const M3_NULL_RIG_P5_ACCEPTANCE_JOB = 101805908584 as const;
export const M3_NULL_RIG_P5_ACCEPTANCE_ARTIFACT = 10026273271 as const;

const M3_NULL_RIG_P1_P2_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.rig.null.create": "STRUCTURAL",
  "ae.rig.null.remove": "STRUCTURAL",
  "ae.rig.null.readback": "STRUCTURAL",
});

const M3_NULL_RIG_ACCEPTED_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.rig.null.create": "TRANSFER",
  "ae.rig.null.remove": "TRANSFER",
  "ae.rig.null.readback": "TRANSFER",
});

export const m3NullRigP1P2MaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_NULL_RIG_P1_P2_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const m3NullRigAcceptedProofMaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_NULL_RIG_ACCEPTED_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const applyM3NullRigAcceptedP1P2Evidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => ({
  ...capability,
  // Historical P1/P2-only projection retained for proof-stage tests.
  status: "PARTIAL" as const,
  proofMaturity: m3NullRigP1P2MaturityForCapability(String(capability.id)),
}));

export const applyM3NullRigAcceptedProofEvidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => {
  const proofMaturity = m3NullRigAcceptedProofMaturityForCapability(String(capability.id));
  const status: CapabilityRecord["status"] = proofMaturity === "TRANSFER" || proofMaturity === "ROBUST"
    ? "FULL"
    : "PARTIAL";

  return {
    ...capability,
    // Accepted real-AE P1-P5 evidence completes the exercised protocol-1.5
    // managed true-null lifecycle/topology envelope through transfer, including
    // viewer-visible controller behavior, induced-failure rollback, exact stable
    // identity after save/reopen/reconnect, owned-source reclamation, and a fresh
    // post-reconnect create/readback/remove cycle.
    status,
    proofMaturity,
  };
});
