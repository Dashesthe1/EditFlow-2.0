import type { CapabilityRecord, ProofMaturity } from "../../../core-contracts/src/index.js";

export const M3_COMPOSITE_P1_P2_ACCEPTED_SOURCE_COMMIT = "4e949b7e75367ee70c790b38f400464d13a57f98" as const;
export const M3_COMPOSITE_P1_P2_ACCEPTANCE_CONTROL_COMMIT = "b46d9e573a4a04cf679190e6a8267786cea63535" as const;
export const M3_COMPOSITE_P1_P2_ACCEPTANCE_RUN = 34077728610 as const;
export const M3_COMPOSITE_P1_P2_ACCEPTANCE_RUN_ATTEMPT = 2 as const;
export const M3_COMPOSITE_P1_P2_ACCEPTANCE_ARTIFACT = 10002742928 as const;

const M3_COMPOSITE_P1_P2_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.layer.track_matte.set": "STRUCTURAL",
  "ae.layer.track_matte.clear": "STRUCTURAL",
  "ae.layer.blend_mode.set": "STRUCTURAL",
  "ae.layer.composite.readback": "STRUCTURAL",
});

export const m3CompositeP1P2MaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_COMPOSITE_P1_P2_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const applyM3CompositeAcceptedP1P2Evidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => ({
  ...capability,
  // P1/P2 is structural evidence only. Composite capabilities remain PARTIAL
  // until visual P3, rollback P4, and transfer P5 are independently proven.
  status: "PARTIAL" as const,
  proofMaturity: m3CompositeP1P2MaturityForCapability(String(capability.id)),
}));
