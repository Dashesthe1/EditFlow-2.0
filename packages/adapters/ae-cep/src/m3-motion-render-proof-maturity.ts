import type { CapabilityRecord, ProofMaturity } from "../../../core-contracts/src/index.js";

export const M3_MOTION_RENDER_P1_P2_ACCEPTED_SOURCE_COMMIT = "70b1549c56179689fb033db36f13fc4b6dbb5998" as const;
export const M3_MOTION_RENDER_P1_P2_ACCEPTANCE_CONTROL_COMMIT = "34adbd69d6cfb847c2900551cd5ee6caa872981a" as const;
export const M3_MOTION_RENDER_P1_P2_ACCEPTANCE_RUN = 34275036819 as const;
export const M3_MOTION_RENDER_P1_P2_ACCEPTANCE_JOB = 102225850170 as const;
export const M3_MOTION_RENDER_P1_P2_ACCEPTANCE_ARTIFACT = 10075375705 as const;
export const M3_MOTION_RENDER_P1_P2_ACCEPTANCE_ARTIFACT_SHA256 = "16ae4571d870aefba43e432016b93e8db6efc2060c49eea841315247d3ed9014" as const;
export const M3_MOTION_RENDER_P1_P2_RESULT_SHA256 = "d29b4ecb1898aacd4b706421e338254e50d525a86449b9c62b47b939e3004927" as const;

export const M3_MOTION_RENDER_P3_P4_ACCEPTED_SOURCE_COMMIT = "042a54b63a73dc3fcbcd77d5cb9d6f981492713e" as const;
export const M3_MOTION_RENDER_P3_P4_ACCEPTANCE_CONTROL_COMMIT = "b25003477abdf7001779bbdd33247e13bd30b1e9" as const;
export const M3_MOTION_RENDER_P3_P4_ACCEPTANCE_RUN = 34279808693 as const;
export const M3_MOTION_RENDER_P3_P4_ACCEPTANCE_JOB = 102241577916 as const;
export const M3_MOTION_RENDER_P3_P4_ACCEPTANCE_ARTIFACT = 10077191111 as const;
export const M3_MOTION_RENDER_P3_P4_ACCEPTANCE_ARTIFACT_SHA256 = "79651dec656bd360e14d2db351333e05cbfee4d1e2efdc0c96dc79c56d509dcf" as const;
export const M3_MOTION_RENDER_P3_P4_RESULT_SHA256 = "ca8db8ed5443dbde8f0db812584a593b34aebcde7e5aeb7bb85aff95477aae70" as const;

const M3_MOTION_RENDER_P1_P2_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.comp.motion_render.set": "STRUCTURAL",
  "ae.layer.motion_render.set": "STRUCTURAL",
  "ae.motion_render.readback": "STRUCTURAL",
});

const M3_MOTION_RENDER_P3_P4_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.comp.motion_render.set": "ROLLBACK",
  "ae.layer.motion_render.set": "ROLLBACK",
  "ae.motion_render.readback": "ROLLBACK",
});

export const m3MotionRenderP1P2MaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_MOTION_RENDER_P1_P2_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const m3MotionRenderP3P4MaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_MOTION_RENDER_P3_P4_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const applyM3MotionRenderAcceptedP1P2Evidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => ({
  ...capability,
  // Historical P1/P2-only projection retained for stage-specific tests and
  // provenance. Structural evidence alone must never promote to FULL.
  status: "PARTIAL" as const,
  proofMaturity: m3MotionRenderP1P2MaturityForCapability(String(capability.id)),
}));

export const applyM3MotionRenderAcceptedP3P4Evidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => ({
  ...capability,
  // Independent retained-artifact review accepted P3 viewer-visible motion
  // blur/frame-blending behavior, and real-AE proof-gated P4 failures restored
  // exact structural state plus pixel-exact baseline renders. P5 transfer has
  // not yet passed, so protocol 1.10 remains PARTIAL rather than FULL.
  status: "PARTIAL" as const,
  proofMaturity: m3MotionRenderP3P4MaturityForCapability(String(capability.id)),
}));
