import type { CapabilityRecord, ProofMaturity } from "../../../core-contracts/src/index.js";

export const M3_TEMPORAL_EASE_P1_P2_ACCEPTED_SOURCE_COMMIT = "718fd72dd9b07c3605163354cf7ce7be26ef8f23" as const;
export const M3_TEMPORAL_EASE_P1_P2_ACCEPTANCE_CONTROL_COMMIT = "033e4e2f005a175f48fefaca1912dc54716d7eb4" as const;
export const M3_TEMPORAL_EASE_P1_P2_ACCEPTANCE_RUN = 34176061647 as const;
export const M3_TEMPORAL_EASE_P1_P2_ACCEPTANCE_JOB = 101905568438 as const;
export const M3_TEMPORAL_EASE_P1_P2_ACCEPTANCE_ARTIFACT = 10037290595 as const;
export const M3_TEMPORAL_EASE_P1_P2_ACCEPTANCE_ARTIFACT_SHA256 = "b1046dfe32b1b1c73a3acd65e5d5b3deb90fef50e01170ed3b8e8e04d4e2439b" as const;

const M3_TEMPORAL_EASE_P1_P2_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.property.temporal_ease.set": "STRUCTURAL",
  "ae.property.temporal_ease.readback": "STRUCTURAL",
});

export const m3TemporalEaseP1P2MaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_TEMPORAL_EASE_P1_P2_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const applyM3TemporalEaseAcceptedP1P2Evidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => ({
  ...capability,
  // Accepted real-AE P1/P2 proves deterministic rejection plus exact structural
  // KeyframeEase write/readback on scalar Opacity and the live three-handle Scale
  // surface. Visual behavior, induced-failure rollback, and transfer remain
  // separate P3/P4/P5 evidence gates, so status remains PARTIAL.
  status: "PARTIAL" as const,
  proofMaturity: m3TemporalEaseP1P2MaturityForCapability(String(capability.id)),
}));
