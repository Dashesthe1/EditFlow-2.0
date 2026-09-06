import type { CapabilityRecord, ProofMaturity } from "../../../core-contracts/src/index.js";

export const M3_MASK_P1_P2_ACCEPTED_SOURCE_COMMIT = "8a1c499ac26344e2199fa2fa816d4565769c312c" as const;
export const M3_MASK_P1_P2_ACCEPTANCE_RUN = 34045287361 as const;
export const M3_MASK_P1_P2_ACCEPTANCE_ARTIFACT = 9992921389 as const;

const M3_MASK_P1_P2_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.mask.create": "STRUCTURAL",
  "ae.mask.remove": "STRUCTURAL",
  "ae.mask.duplicate": "STRUCTURAL",
  "ae.mask.order.set": "STRUCTURAL",
  "ae.mask.path.set": "STRUCTURAL",
  "ae.mask.properties.set": "STRUCTURAL",
  "ae.mask.readback": "STRUCTURAL",
});

export const m3MaskP1P2MaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_MASK_P1_P2_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const applyM3MaskAcceptedP1P2Evidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => ({
  ...capability,
  // P1/P2 is structural evidence only. The mask tranche remains PARTIAL until
  // the capability independently reaches P5 TRANSFER or higher.
  status: "PARTIAL" as const,
  proofMaturity: m3MaskP1P2MaturityForCapability(String(capability.id)),
}));
