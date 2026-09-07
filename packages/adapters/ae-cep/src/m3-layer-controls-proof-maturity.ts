import type { CapabilityRecord, ProofMaturity } from "../../../core-contracts/src/index.js";

export const M3_LAYER_CONTROLS_P1_P2_ACCEPTED_SOURCE_COMMIT = "60fd64c67161f9799c3a123570625049c00330d5" as const;
export const M3_LAYER_CONTROLS_P1_P2_ACCEPTANCE_CONTROL_COMMIT = "fbbd203a82968cfe5e33f6c048958e823aa52981" as const;
export const M3_LAYER_CONTROLS_P1_P2_ACCEPTANCE_RUN = 34145893380 as const;
export const M3_LAYER_CONTROLS_P1_P2_ACCEPTANCE_RUN_ATTEMPT = 1 as const;
export const M3_LAYER_CONTROLS_P1_P2_ACCEPTANCE_ARTIFACT = 10027648642 as const;
export const M3_LAYER_CONTROLS_P1_P2_ACCEPTANCE_ARTIFACT_SHA256 = "44969faa55382f98319ece5b875c32422d249668caa05b1c2c1d1c20e4cce53e" as const;

export const M3_LAYER_CONTROLS_P3_P4_ACCEPTED_SOURCE_COMMIT = "93b24ac73d93997021e2911b33d58d0cc581ae9d" as const;
export const M3_LAYER_CONTROLS_P3_P4_ACCEPTANCE_CONTROL_COMMIT = "88f5f6ea91a7566bfbd38998b02d4aa5fb750692" as const;
export const M3_LAYER_CONTROLS_P3_P4_ACCEPTANCE_RUN = 34147459879 as const;
export const M3_LAYER_CONTROLS_P3_P4_ACCEPTANCE_RUN_ATTEMPT = 1 as const;
export const M3_LAYER_CONTROLS_P3_P4_ACCEPTANCE_ARTIFACT = 10028180326 as const;
export const M3_LAYER_CONTROLS_P3_P4_ACCEPTANCE_ARTIFACT_SHA256 = "0ef700c058674c01b4ea4f64dea52b47c4ecd5e03e41644477d9f8803d027fc2" as const;
export const M3_LAYER_CONTROLS_P3_ENABLED_FRAME_SHA256 = "f418efd40f346eb601f2293bf3bad687abadf1934d67a437b318459a08ed9659" as const;
export const M3_LAYER_CONTROLS_P3_DISABLED_FRAME_SHA256 = "02b758b136d2da389a5f01ee31076e199d7002fa95b30767a94ec80a70ee78fa" as const;
export const M3_LAYER_CONTROLS_P3_RESTORED_FRAME_SHA256 = M3_LAYER_CONTROLS_P3_ENABLED_FRAME_SHA256;
export const M3_LAYER_CONTROLS_P4_RECOVERY_FRAME_SHA256 = M3_LAYER_CONTROLS_P3_ENABLED_FRAME_SHA256;

const M3_LAYER_CONTROLS_ACCEPTED_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  // P1/P2 established exact structural mutation/readback for the setter. The
  // independently reviewed P3 render sequence then proved viewer-visible enable
  // behavior, and P4 proved a fixed post-mutation failure returns through the
  // normal AE Undo path to the exact project fingerprint/switch state before the
  // recovery render. P5 transfer remains outstanding, so this is not TRANSFER.
  "ae.layer.switches.set": "ROLLBACK",
  // The read-only capability has no mutation/rollback obligation of its own; its
  // accepted proof remains exact structural host readback from P1/P2.
  "ae.layer.switches.readback": "STRUCTURAL",
});

export const m3LayerControlsAcceptedMaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_LAYER_CONTROLS_ACCEPTED_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const applyM3LayerControlsAcceptedEvidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => ({
  ...capability,
  // P1/P2, independently reviewed P3, and injected-failure P4 are accepted on
  // real AE 25.6.6. Keep the tranche PARTIAL until a separate P5 save/reopen/
  // reconnect transfer proof is accepted; do not infer transfer from lower levels.
  status: "PARTIAL" as const,
  proofMaturity: m3LayerControlsAcceptedMaturityForCapability(String(capability.id)),
}));
