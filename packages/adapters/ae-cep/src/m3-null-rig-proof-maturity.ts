import type { CapabilityRecord, ProofMaturity } from "../../../core-contracts/src/index.js";

export const M3_NULL_RIG_P1_P2_ACCEPTED_SOURCE_COMMIT = "955e24401ee37febf998d8ec4c544e345aebab6d" as const;
export const M3_NULL_RIG_P1_P2_ACCEPTANCE_CONTROL_COMMIT = "9db379f53812abacc3771e3206e279dd5bca5b5f" as const;
export const M3_NULL_RIG_P1_P2_ACCEPTANCE_RUN = 34139625065 as const;
export const M3_NULL_RIG_P1_P2_ACCEPTANCE_RUN_ATTEMPT = 1 as const;
export const M3_NULL_RIG_P1_P2_ACCEPTANCE_JOB = 101798432327 as const;
export const M3_NULL_RIG_P1_P2_ACCEPTANCE_ARTIFACT = 10025391737 as const;

const M3_NULL_RIG_P1_P2_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.rig.null.create": "STRUCTURAL",
  "ae.rig.null.remove": "STRUCTURAL",
  "ae.rig.null.readback": "STRUCTURAL",
});

export const m3NullRigP1P2MaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_NULL_RIG_P1_P2_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const applyM3NullRigAcceptedP1P2Evidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => ({
  ...capability,
  // Accepted real-AE P1/P2 proves deterministic rejection, exact managed-null
  // identity/lifecycle, relationship-topology readback through accepted 1.4
  // parenting, idempotency, protected deletion, and exact baseline restoration.
  // Null rigs remain PARTIAL until visual P3, induced-failure rollback P4, and
  // save/reopen/reconnect transfer P5 are independently accepted.
  status: "PARTIAL" as const,
  proofMaturity: m3NullRigP1P2MaturityForCapability(String(capability.id)),
}));
