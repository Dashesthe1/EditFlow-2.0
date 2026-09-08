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

export const M3_MOTION_RENDER_P5_ACCEPTED_SOURCE_COMMIT = "79dabd7573d99fc8b0664032d54658d65bc1cf02" as const;
export const M3_MOTION_RENDER_P5_ACCEPTANCE_CONTROL_COMMIT = "364055888dcb404ea4dbc06e44619c33d16a348a" as const;
export const M3_MOTION_RENDER_P5_ACCEPTANCE_RUN = 34281332554 as const;
export const M3_MOTION_RENDER_P5_ACCEPTANCE_JOB = 102246528340 as const;
export const M3_MOTION_RENDER_P5_ACCEPTANCE_ARTIFACT = 10077917851 as const;
export const M3_MOTION_RENDER_P5_ACCEPTANCE_ARTIFACT_SHA256 = "91efbbfc8a3c7a2cf742d669ea4d6fafc0c49f80e90eb692df3835bdf834ce34" as const;
export const M3_MOTION_RENDER_P5_RESULT_SHA256 = "89aa0465ae6e5291ddf4d936233e793c1587f3e97213313fc16f1b873e3aade6" as const;
export const M3_MOTION_RENDER_P5_PROJECT_SHA256 = "ff045e3a444eac59f4e51ee3d818d08a5d078ed5a198d12d4f883c28f09f26bb" as const;

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

const M3_MOTION_RENDER_P5_MATURITY_BY_CAPABILITY = Object.freeze<Record<string, ProofMaturity>>({
  "ae.comp.motion_render.set": "TRANSFER",
  "ae.layer.motion_render.set": "TRANSFER",
  "ae.motion_render.readback": "TRANSFER",
});

export const m3MotionRenderP1P2MaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_MOTION_RENDER_P1_P2_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const m3MotionRenderP3P4MaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_MOTION_RENDER_P3_P4_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const m3MotionRenderP5MaturityForCapability = (capabilityId: string): ProofMaturity =>
  M3_MOTION_RENDER_P5_MATURITY_BY_CAPABILITY[capabilityId] ?? "DECLARED";

export const applyM3MotionRenderAcceptedP1P2Evidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => ({
  ...capability,
  status: "PARTIAL" as const,
  proofMaturity: m3MotionRenderP1P2MaturityForCapability(String(capability.id)),
}));

export const applyM3MotionRenderAcceptedP3P4Evidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => ({
  ...capability,
  status: "PARTIAL" as const,
  proofMaturity: m3MotionRenderP3P4MaturityForCapability(String(capability.id)),
}));

export const applyM3MotionRenderAcceptedP5Evidence = (
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityRecord[] => capabilities.map((capability) => {
  const proofMaturity = m3MotionRenderP5MaturityForCapability(String(capability.id));
  const status: CapabilityRecord["status"] = proofMaturity === "TRANSFER" || proofMaturity === "ROBUST"
    ? "FULL"
    : "PARTIAL";

  return {
    ...capability,
    // Accepted real-AE P1-P5 evidence completes the bounded protocol 1.10
    // motion-render envelope through transfer. Composition motion-render and
    // layer motion blur/frame-blending state are structurally read back;
    // viewer-visible P3 output is independently accepted; proof-gated P4
    // failures restore baseline state/pixels; and P5 proves the saved host-owned
    // state plus native Layer.id survive .aep reopen into a distinct authenticated
    // CEP session that can perform fresh protocol-1.10 mutations and exact
    // readback. This does not claim ROBUST maturity or arbitrary optical-flow
    // visual quality.
    status,
    proofMaturity,
  };
});
