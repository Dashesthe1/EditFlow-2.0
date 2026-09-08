import type { CapabilityRecord, ProofMaturity } from "../../../core-contracts/src/index.js";

export const M3_SPATIAL_GRAPH_P1_P2_ACCEPTED_SOURCE_COMMIT = "041f2db8ee01095dfa6de7ecf9c2de29a232c17b" as const;
export const M3_SPATIAL_GRAPH_P1_P2_ACCEPTANCE_CONTROL_COMMIT = "b3d9bfbe2a1ce2c4712525df99b82be171252b01" as const;
export const M3_SPATIAL_GRAPH_P1_P2_ACCEPTANCE_RUN = 34182897797 as const;
export const M3_SPATIAL_GRAPH_P1_P2_ACCEPTANCE_JOB = 101925388116 as const;
export const M3_SPATIAL_GRAPH_P1_P2_ACCEPTANCE_ARTIFACT = 10039524832 as const;
export const M3_SPATIAL_GRAPH_P1_P2_ACCEPTANCE_ARTIFACT_SHA256 = "51967c55811db23f296c3c0f9d0e6800ecc8ba037bcff8283ec801c3cf5b87f5" as const;

export const M3_SPATIAL_GRAPH_P3_P4_ACCEPTED_SOURCE_COMMIT = "0c297200af3563d2f714d61a2df718af81cd1d4c" as const;
export const M3_SPATIAL_GRAPH_P3_P4_ACCEPTANCE_CONTROL_COMMIT = "5dedd0355959fbf24fd0d3d7960abb870389879b" as const;
export const M3_SPATIAL_GRAPH_P3_P4_ACCEPTANCE_RUN = 34184591197 as const;
export const M3_SPATIAL_GRAPH_P3_P4_ACCEPTANCE_JOB = 102183384263 as const;
export const M3_SPATIAL_GRAPH_P3_P4_ACCEPTANCE_ARTIFACT = 10070526495 as const;
export const M3_SPATIAL_GRAPH_P3_P4_ACCEPTANCE_ARTIFACT_SHA256 = "122342798174a2c451a1b94f03a1e79bfa8e9b643ce23d9db607d1d7775ca70a" as const;

export const M3_SPATIAL_GRAPH_P5_ACCEPTED_SOURCE_COMMIT = "d42600e0d1004c71d91296bc6e4c31981d9a62a6" as const;
export const M3_SPATIAL_GRAPH_P5_ACCEPTANCE_CONTROL_COMMIT = "5ebff93d9e13681914da558eb16c1c9b96f27617" as const;
export const M3_SPATIAL_GRAPH_P5_ACCEPTANCE_RUN = 34264619734 as const;
export const M3_SPATIAL_GRAPH_P5_ACCEPTANCE_JOB = 102190765510 as const;
export const M3_SPATIAL_GRAPH_P5_ACCEPTANCE_ARTIFACT = 10071318446 as const;
export const M3_SPATIAL_GRAPH_P5_ACCEPTANCE_ARTIFACT_SHA256 = "66cf3d6b119115c948cfbdc908ac1f9c10d4893d953c3f44c8ae7527c8beaa55" as const;

const M3_SPATIAL_GRAPH_P1_P2_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.property.spatial_graph.set": "STRUCTURAL",
  "ae.property.spatial_graph.readback": "STRUCTURAL",
});

const M3_SPATIAL_GRAPH_ACCEPTED_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.property.spatial_graph.set": "TRANSFER",
  "ae.property.spatial_graph.readback": "TRANSFER",
});

export const m3SpatialGraphP1P2MaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_SPATIAL_GRAPH_P1_P2_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const m3SpatialGraphAcceptedProofMaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_SPATIAL_GRAPH_ACCEPTED_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const applyM3SpatialGraphAcceptedP1P2Evidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => ({
  ...capability,
  status: "PARTIAL" as const,
  proofMaturity: m3SpatialGraphP1P2MaturityForCapability(String(capability.id)),
}));

export const applyM3SpatialGraphAcceptedProofEvidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => {
  const proofMaturity = m3SpatialGraphAcceptedProofMaturityForCapability(String(capability.id));
  const status: CapabilityRecord["status"] = proofMaturity === "TRANSFER" || proofMaturity === "ROBUST"
    ? "FULL"
    : "PARTIAL";

  return {
    ...capability,
    // Accepted real-AE P1-P5 evidence completes the bounded protocol 1.9
    // spatial Graph Editor envelope through transfer: exact spatial tangent,
    // Continuous/Auto-Bezier and roving state are structurally read back;
    // manual tangent curvature is viewer-visible; proof-gated failure restores
    // baseline pixels; and the saved host-owned state plus native Layer.id
    // survive .aep reopen into a distinct authenticated CEP session that can
    // perform a fresh spatial mutation and exact readback. This does not claim
    // ROBUST maturity or custom third-party graph/curve editors.
    status,
    proofMaturity,
  };
});
