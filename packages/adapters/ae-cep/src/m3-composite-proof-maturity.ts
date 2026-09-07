import type { CapabilityRecord, ProofMaturity } from "../../../core-contracts/src/index.js";

export const M3_COMPOSITE_P1_P2_ACCEPTED_SOURCE_COMMIT = "4e949b7e75367ee70c790b38f400464d13a57f98" as const;
export const M3_COMPOSITE_P1_P2_ACCEPTANCE_CONTROL_COMMIT = "b46d9e573a4a04cf679190e6a8267786cea63535" as const;
export const M3_COMPOSITE_P1_P2_ACCEPTANCE_RUN = 34077728610 as const;
export const M3_COMPOSITE_P1_P2_ACCEPTANCE_RUN_ATTEMPT = 2 as const;
export const M3_COMPOSITE_P1_P2_ACCEPTANCE_ARTIFACT = 10002742928 as const;

export const M3_COMPOSITE_P5_ACCEPTED_SOURCE_COMMIT = "37e7e0417ec3e7d9e8f1a2df172ff06ecfa26d4b" as const;
export const M3_COMPOSITE_P5_ACCEPTANCE_CONTROL_COMMIT = "a4a34318072c4b19a2efa8590af401e63c97e369" as const;
export const M3_COMPOSITE_P5_ACCEPTANCE_RUN = 34080055645 as const;
export const M3_COMPOSITE_P5_ACCEPTANCE_RUN_ATTEMPT = 2 as const;
export const M3_COMPOSITE_P5_ACCEPTANCE_JOB = 101614103943 as const;
export const M3_COMPOSITE_P5_ACCEPTANCE_ARTIFACT = 10003461751 as const;

const M3_COMPOSITE_P1_P2_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.layer.track_matte.set": "STRUCTURAL",
  "ae.layer.track_matte.clear": "STRUCTURAL",
  "ae.layer.blend_mode.set": "STRUCTURAL",
  "ae.layer.composite.readback": "STRUCTURAL",
});

const M3_COMPOSITE_ACCEPTED_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.layer.track_matte.set": "TRANSFER",
  "ae.layer.track_matte.clear": "TRANSFER",
  "ae.layer.blend_mode.set": "TRANSFER",
  "ae.layer.composite.readback": "TRANSFER",
});

export const m3CompositeP1P2MaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_COMPOSITE_P1_P2_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const m3CompositeAcceptedProofMaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_COMPOSITE_ACCEPTED_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const applyM3CompositeAcceptedP1P2Evidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => ({
  ...capability,
  // Historical P1/P2-only projection retained for proof-stage tests.
  status: "PARTIAL" as const,
  proofMaturity: m3CompositeP1P2MaturityForCapability(String(capability.id)),
}));

export const applyM3CompositeAcceptedProofEvidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => {
  const proofMaturity = m3CompositeAcceptedProofMaturityForCapability(String(capability.id));
  const status: CapabilityRecord["status"] = proofMaturity === "TRANSFER" || proofMaturity === "ROBUST"
    ? "FULL"
    : "PARTIAL";

  return {
    ...capability,
    // Accepted real-AE P1-P5 evidence completes protocol 1.3 through transfer:
    // arbitrary-source matte state and blend mode survive save/reopen/reconnect,
    // and a fresh authenticated session successfully clears/reassigns the matte,
    // changes blend mode, and reads the exact final composite state.
    status,
    proofMaturity,
  };
});
