import type { CapabilityRecord, ProofMaturity } from "../../../core-contracts/src/index.js";

export const M3_MARKER_MOTION_P1_P2_ACCEPTED_SOURCE_COMMIT = "454cc19cd7b6c676f9dab15122432ca64d82c7d8" as const;
export const M3_MARKER_MOTION_P1_P2_ACCEPTANCE_CONTROL_COMMIT = "16146cb00ebcef2b0a34ec629875dfee53f1ca73" as const;
export const M3_MARKER_MOTION_P1_P2_ACCEPTANCE_RUN = 34286914057 as const;
export const M3_MARKER_MOTION_P1_P2_ACCEPTANCE_JOB = 102264510880 as const;
export const M3_MARKER_MOTION_P1_P2_ACCEPTANCE_ARTIFACT = 10079885025 as const;
export const M3_MARKER_MOTION_P1_P2_ACCEPTANCE_ARTIFACT_SHA256 = "75bd92ea1661b0871f73b2368f6bcce217956b311aa73b722fedd2c13b420ade" as const;

export const M3_MARKER_MOTION_P3_ACCEPTED_SOURCE_COMMIT = "59688365d879530bb79efe4746745da720ecbeaa" as const;
export const M3_MARKER_MOTION_P3_ACCEPTANCE_CONTROL_COMMIT = "868246515d7cd0fb1c4dcbf84c55be57b470f896" as const;
export const M3_MARKER_MOTION_P3_ACCEPTANCE_RUN = 34506818837 as const;
export const M3_MARKER_MOTION_P3_ACCEPTANCE_JOB = 102970927495 as const;
export const M3_MARKER_MOTION_P3_ACCEPTANCE_ARTIFACT = 10164183740 as const;
export const M3_MARKER_MOTION_P3_ACCEPTANCE_ARTIFACT_SHA256 = "4c7af69295ab5f9274f63e50b7a388a211ee3c75bd3e681629986554148b5809" as const;
export const M3_MARKER_MOTION_P3_ACCEPTANCE_PROOF_CLI_SHA256 = "a86de953b5b3ccf243f8fdf89dba80af6f361f9d5354b263966b44376bcc221d" as const;

export const M3_MARKER_MOTION_P4_ACCEPTED_SOURCE_COMMIT = "62c21fa868cd19b0bc51530222cb310bc05bb524" as const;
export const M3_MARKER_MOTION_P4_ACCEPTANCE_CONTROL_COMMIT = "28c38604f7f78655c854722d874e5bf90ce3b3d1" as const;
export const M3_MARKER_MOTION_P4_ACCEPTANCE_RUN = 34508045587 as const;
export const M3_MARKER_MOTION_P4_ACCEPTANCE_JOB = 102974965343 as const;
export const M3_MARKER_MOTION_P4_ACCEPTANCE_ARTIFACT = 10164628534 as const;
export const M3_MARKER_MOTION_P4_ACCEPTANCE_ARTIFACT_SHA256 = "1785d94837928b8b56929e15e42cf8ff2d4e90072438ca9dc4a7a386293e0eb8" as const;

export const M3_MARKER_MOTION_P5_ACCEPTED_SOURCE_COMMIT = "d9bc3e4debb31bdb7c08d35f289ccabab29f3804" as const;
export const M3_MARKER_MOTION_P5_ACCEPTANCE_CONTROL_COMMIT = "1bb5dff7970877507f3814a84412d4b374c6a038" as const;
export const M3_MARKER_MOTION_P5_ACCEPTANCE_RUN = 34507680568 as const;
export const M3_MARKER_MOTION_P5_ACCEPTANCE_JOB = 102973777466 as const;
export const M3_MARKER_MOTION_P5_ACCEPTANCE_ARTIFACT = 10164488951 as const;
export const M3_MARKER_MOTION_P5_ACCEPTANCE_ARTIFACT_SHA256 = "86dce7ee3438a5bf0c4776de8bba5973f85235b88a801fe586422473d01b21fe" as const;
export const M3_MARKER_MOTION_P5_RESULT_SHA256 = "e62b3442e6341e3422d6e31855c7d8e360a35ec38f791e29f35d288c8b9933b8" as const;
export const M3_MARKER_MOTION_P5_SAVED_PROJECT_SHA256 = "a42134fb1ac6c2581cc54fd9dfc01829aabbe853c3fb52b9f2190339c75d99df" as const;

const CAPABILITIES = [
  "ae.marker.set",
  "ae.marker.remove",
  "ae.marker.readback",
  "ae.comp.motion.set",
  "ae.comp.motion.readback",
  "ae.layer.motion.set",
  "ae.layer.motion.readback",
] as const;

const P1_P2 = Object.freeze<Record<string, ProofMaturity>>(Object.fromEntries(CAPABILITIES.map((id) => [id, "STRUCTURAL"])));
const ACCEPTED = Object.freeze<Record<string, ProofMaturity>>(Object.fromEntries(CAPABILITIES.map((id) => [id, "TRANSFER"])));

export const m3MarkerMotionP1P2MaturityForCapability = (capabilityId: string): ProofMaturity => P1_P2[capabilityId] ?? "DECLARED";
export const m3MarkerMotionAcceptedProofMaturityForCapability = (capabilityId: string): ProofMaturity => ACCEPTED[capabilityId] ?? "DECLARED";

export const applyM3MarkerMotionAcceptedP1P2Evidence = (capabilities: readonly CapabilityRecord[]): readonly CapabilityRecord[] =>
  capabilities.map((capability) => ({
    ...capability,
    status: "PARTIAL" as const,
    proofMaturity: m3MarkerMotionP1P2MaturityForCapability(String(capability.id)),
  }));

export const applyM3MarkerMotionAcceptedProofEvidence = (capabilities: readonly CapabilityRecord[]): readonly CapabilityRecord[] =>
  capabilities.map((capability) => {
    const proofMaturity = m3MarkerMotionAcceptedProofMaturityForCapability(String(capability.id));
    const status: CapabilityRecord["status"] = proofMaturity === "TRANSFER" || proofMaturity === "ROBUST" ? "FULL" : "PARTIAL";
    return {
      ...capability,
      // Accepted real-AE P1-P5 evidence completes the bounded protocol-2.0 marker/motion
      // envelope through transfer: marker fields and composition/layer motion state are
      // structurally read back; shutter and frame-blending differences are viewer-visible;
      // all four mutator families restore exact structural/fingerprint state after a
      // proof-gated post-write failure; and saved state survives .aep reopen into a
      // distinct authenticated CEP session that accepts fresh post-reconnect mutations.
      // This does not claim ROBUST maturity or arbitrary third-party motion systems.
      status,
      proofMaturity,
    };
  });
