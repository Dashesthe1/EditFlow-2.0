import type { CapabilityRecord, ProofMaturity } from "../../../core-contracts/src/index.js";

export const M3_MOTION_RENDER_P1_P2_ACCEPTED_SOURCE_COMMIT = "70b1549c56179689fb033db36f13fc4b6dbb5998" as const;
export const M3_MOTION_RENDER_P1_P2_ACCEPTANCE_CONTROL_COMMIT = "34adbd69d6cfb847c2900551cd5ee6caa872981a" as const;
export const M3_MOTION_RENDER_P1_P2_ACCEPTANCE_RUN = 34275036819 as const;
export const M3_MOTION_RENDER_P1_P2_ACCEPTANCE_JOB = 102225850170 as const;
export const M3_MOTION_RENDER_P1_P2_ACCEPTANCE_ARTIFACT = 10075375705 as const;
export const M3_MOTION_RENDER_P1_P2_ACCEPTANCE_ARTIFACT_SHA256 = "16ae4571d870aefba43e432016b93e8db6efc2060c49eea841315247d3ed9014" as const;
export const M3_MOTION_RENDER_P1_P2_RESULT_SHA256 = "d29b4ecb1898aacd4b706421e338254e50d525a86449b9c62b47b939e3004927" as const;

const M3_MOTION_RENDER_P1_P2_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.comp.motion_render.set": "STRUCTURAL",
  "ae.layer.motion_render.set": "STRUCTURAL",
  "ae.motion_render.readback": "STRUCTURAL",
});

export const m3MotionRenderP1P2MaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_MOTION_RENDER_P1_P2_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const applyM3MotionRenderAcceptedP1P2Evidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => ({
  ...capability,
  // Real-AE P1/P2 proves only validation behavior plus exact structural
  // readback. Motion blur/frame blending remain PARTIAL until viewer-visible
  // P3, transactional P4 rollback, and P5 save/reopen/reconnect transfer pass.
  status: "PARTIAL" as const,
  proofMaturity: m3MotionRenderP1P2MaturityForCapability(String(capability.id)),
}));
