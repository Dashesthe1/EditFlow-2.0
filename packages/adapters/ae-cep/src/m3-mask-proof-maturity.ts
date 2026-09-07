import type { CapabilityRecord, ProofMaturity } from "../../../core-contracts/src/index.js";

export const M3_MASK_P1_P2_ACCEPTED_SOURCE_COMMIT = "8a1c499ac26344e2199fa2fa816d4565769c312c" as const;
export const M3_MASK_P1_P2_ACCEPTANCE_RUN = 34045287361 as const;
export const M3_MASK_P1_P2_ACCEPTANCE_ARTIFACT = 9992921389 as const;

export const M3_MASK_P5_ACCEPTED_SOURCE_COMMIT = "2ff3e6f6278dfdabe748c2c861c7e5cc5f94d31d" as const;
export const M3_MASK_P5_ACCEPTANCE_CONTROL_COMMIT = "41dbab80cfbd81ac65294c1569f334ab7c31d168" as const;
export const M3_MASK_P5_ACCEPTANCE_RUN = 34075693434 as const;
export const M3_MASK_P5_ACCEPTANCE_JOB = 101601208548 as const;
export const M3_MASK_P5_ACCEPTANCE_ARTIFACT = 10001978740 as const;

const M3_MASK_P1_P2_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.mask.create": "STRUCTURAL",
  "ae.mask.remove": "STRUCTURAL",
  "ae.mask.duplicate": "STRUCTURAL",
  "ae.mask.order.set": "STRUCTURAL",
  "ae.mask.path.set": "STRUCTURAL",
  "ae.mask.properties.set": "STRUCTURAL",
  "ae.mask.readback": "STRUCTURAL",
});

const M3_MASK_ACCEPTED_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.mask.create": "TRANSFER",
  "ae.mask.remove": "TRANSFER",
  "ae.mask.duplicate": "TRANSFER",
  "ae.mask.order.set": "TRANSFER",
  "ae.mask.path.set": "TRANSFER",
  "ae.mask.properties.set": "TRANSFER",
  "ae.mask.readback": "TRANSFER",
});

export const m3MaskP1P2MaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_MASK_P1_P2_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const m3MaskAcceptedProofMaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_MASK_ACCEPTED_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const applyM3MaskAcceptedP1P2Evidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => ({
  ...capability,
  // Historical P1/P2-only projection: structural evidence alone must never
  // promote a capability to FULL. Keep this helper for proof-stage tests and
  // provenance even though the live registry now has accepted P5 evidence.
  status: "PARTIAL" as const,
  proofMaturity: m3MaskP1P2MaturityForCapability(String(capability.id)),
}));

export const applyM3MaskAcceptedProofEvidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => {
  const proofMaturity = m3MaskAcceptedProofMaturityForCapability(String(capability.id));
  const status: CapabilityRecord["status"] = proofMaturity === "TRANSFER" || proofMaturity === "ROBUST"
    ? "FULL"
    : "PARTIAL";

  return {
    ...capability,
    // Accepted real-AE P1-P5 evidence completes the exercised protocol-1.2
    // mask/Bezier proof ladder through save/reopen/reconnect transfer. The P5
    // acceptance explicitly preserves exact mask properties, Bezier geometry,
    // animated path keyframes, fresh post-reconnect mutation/readback, and
    // proof-owned cleanup restoration.
    status,
    proofMaturity,
  };
});
