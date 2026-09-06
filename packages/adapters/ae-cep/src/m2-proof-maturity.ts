import type { CapabilityRecord, ProofMaturity } from "../../../core-contracts/src/index.js";

export const M2_ACCEPTED_SOURCE_COMMIT = "8d5f8ddf0143ce0e1ec33cff14269ecab8769d60" as const;
export const M2_REAL_AE_ACCEPTANCE_RUN = 34022332767 as const;
export const M2_P4_P5_ACCEPTANCE_RUN = 34013038916 as const;

const M2_PROOF_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.host.probe": "STRUCTURAL",
  "ae.project.inspect": "STRUCTURAL",
  "ae.project.save": "TRANSFER",
  "ae.comp.create": "TRANSFER",
  "ae.comp.settings.set": "STRUCTURAL",
  "ae.comp.remove": "TRANSFER",
  "ae.media.import": "ROLLBACK",
  "ae.layer.create": "TRANSFER",
  "ae.layer.duplicate": "TRANSFER",
  "ae.layer.remove": "STRUCTURAL",
  "ae.layer.order.set": "TRANSFER",
  "ae.layer.transform.set": "VISUAL",
  "ae.layer.timing.set": "VISUAL",
  "ae.effect.add": "VISUAL",
  "ae.effect.remove": "STRUCTURAL",
  "ae.effect.property.set": "VISUAL",
  "ae.keyframe.set": "VISUAL",
  "ae.expression.set": "STRUCTURAL",
  "ae.precompose.layers": "TRANSFER",
  "ae.render.capture": "VISUAL",
  "ae.object.readback": "TRANSFER",
  "ae.transaction.undo_last": "ROLLBACK",
});

export const m2ProofMaturityForCapability = (capabilityId: string): ProofMaturity =>
  M2_PROOF_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const applyM2AcceptedProofEvidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => {
  const proofMaturity = m2ProofMaturityForCapability(String(capability.id));
  const status: CapabilityRecord["status"] = proofMaturity === "TRANSFER" || proofMaturity === "ROBUST"
    ? "FULL"
    : "PARTIAL";

  return {
    ...capability,
    status,
    proofMaturity,
  };
});
