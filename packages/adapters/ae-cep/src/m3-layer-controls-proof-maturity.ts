import type { CapabilityRecord, ProofMaturity } from "../../../core-contracts/src/index.js";

export const M3_LAYER_CONTROLS_P1_P2_ACCEPTED_SOURCE_COMMIT = "60fd64c67161f9799c3a123570625049c00330d5" as const;
export const M3_LAYER_CONTROLS_P1_P2_ACCEPTANCE_CONTROL_COMMIT = "fbbd203a82968cfe5e33f6c048958e823aa52981" as const;
export const M3_LAYER_CONTROLS_P1_P2_ACCEPTANCE_RUN = 34145893380 as const;
export const M3_LAYER_CONTROLS_P1_P2_ACCEPTANCE_RUN_ATTEMPT = 1 as const;
export const M3_LAYER_CONTROLS_P1_P2_ACCEPTANCE_ARTIFACT = 10027648642 as const;
export const M3_LAYER_CONTROLS_P1_P2_ACCEPTANCE_ARTIFACT_SHA256 = "44969faa55382f98319ece5b875c32422d249668caa05b1c2c1d1c20e4cce53e" as const;

const M3_LAYER_CONTROLS_P1_P2_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.layer.switches.set": "STRUCTURAL",
  "ae.layer.switches.readback": "STRUCTURAL",
});

export const m3LayerControlsP1P2MaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_LAYER_CONTROLS_P1_P2_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const applyM3LayerControlsAcceptedP1P2Evidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => ({
  ...capability,
  // P1/P2 proves deterministic rejection, host applicability, exact structural
  // mutation/readback, idempotency, and exact baseline cleanup in AE 25.6.6.
  // These capabilities remain PARTIAL until P3 visual, P4 rollback, and P5
  // save/reopen/reconnect transfer evidence are independently accepted.
  status: "PARTIAL" as const,
  proofMaturity: m3LayerControlsP1P2MaturityForCapability(String(capability.id)),
}));
