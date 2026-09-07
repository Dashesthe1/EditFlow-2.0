import type { CapabilityRecord, ProofMaturity } from "../../../core-contracts/src/index.js";

export const M3_LAYER_CONTROLS_P1_P2_ACCEPTED_SOURCE_COMMIT = "bf26b3a4351a947d130f792ca7a1a26aa6091a2c" as const;
export const M3_LAYER_CONTROLS_P1_P2_ACCEPTANCE_COMMIT = "48055f15bd7856f3aad8cde762c58b521324f187" as const;
export const M3_LAYER_CONTROLS_P1_P2_ACCEPTANCE_RUN = 34156910741 as const;
export const M3_LAYER_CONTROLS_P1_P2_ACCEPTANCE_ARTIFACT = 10031293005 as const;

export const M3_LAYER_CONTROLS_P3_P4_ACCEPTED_SOURCE_COMMIT = "2aa9b979c80ca4c4f025918943e725a345cd29f6" as const;
export const M3_LAYER_CONTROLS_P3_P4_ACCEPTANCE_CONTROL_COMMIT = "7e493aa05af5d0cb98ad242c9b752f96fa14b14b" as const;
export const M3_LAYER_CONTROLS_P3_P4_ACCEPTANCE_RUN = 34159635705 as const;
export const M3_LAYER_CONTROLS_P3_P4_ACCEPTANCE_JOB = 101858554842 as const;
export const M3_LAYER_CONTROLS_P3_P4_ACCEPTANCE_ARTIFACT = 10032176111 as const;

export const M3_LAYER_CONTROLS_P5_ACCEPTED_SOURCE_COMMIT = "a6181c0af2f22fd83141625f6c5852ae0a27b786" as const;
export const M3_LAYER_CONTROLS_P5_ACCEPTANCE_CONTROL_COMMIT = "82e55f8b2c8ee868cf2ac168e27b0ef5c4579340" as const;
export const M3_LAYER_CONTROLS_P5_ACCEPTANCE_RUN = 34160617926 as const;
export const M3_LAYER_CONTROLS_P5_ACCEPTANCE_JOB = 101861547189 as const;
export const M3_LAYER_CONTROLS_P5_ACCEPTANCE_ARTIFACT = 10032484694 as const;

const M3_LAYER_CONTROLS_P1_P2_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.layer.controls.readback": "STRUCTURAL",
  "ae.layer.switches.set": "STRUCTURAL",
  "ae.layer.order.set": "STRUCTURAL",
});

const M3_LAYER_CONTROLS_ACCEPTED_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.layer.controls.readback": "TRANSFER",
  "ae.layer.switches.set": "TRANSFER",
  "ae.layer.order.set": "TRANSFER",
});

export const m3LayerControlsP1P2MaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_LAYER_CONTROLS_P1_P2_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const m3LayerControlsAcceptedProofMaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_LAYER_CONTROLS_ACCEPTED_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const applyM3LayerControlsAcceptedP1P2Evidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => ({
  ...capability,
  // Historical P1/P2-only projection retained for proof-stage tests and
  // provenance. Structural evidence alone must never promote to FULL.
  status: "PARTIAL" as const,
  proofMaturity: m3LayerControlsP1P2MaturityForCapability(String(capability.id)),
}));

export const applyM3LayerControlsAcceptedProofEvidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => {
  const proofMaturity = m3LayerControlsAcceptedProofMaturityForCapability(String(capability.id));
  const status: CapabilityRecord["status"] = proofMaturity === "TRANSFER" || proofMaturity === "ROBUST"
    ? "FULL"
    : "PARTIAL";

  return {
    ...capability,
    // Accepted real-AE P1-P5 evidence completes protocol 1.6 through transfer:
    // all declared layer-switch support/value readbacks and stacking order
    // survive save/reopen/reconnect exactly, native Layer.id continuity is
    // preserved, and a fresh authenticated session retains switch/order
    // mutation and exact readback authority.
    status,
    proofMaturity,
  };
});
