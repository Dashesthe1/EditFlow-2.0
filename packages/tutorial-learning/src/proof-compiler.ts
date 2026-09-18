import type {
  TutorialCapabilityDiscoveryReportV0,
  TutorialCapabilityFindingV0,
  TutorialSkillState,
} from "./contracts.js";
import type { TutorialDeepSkillLessonV1 } from "./deep-analysis.js";

export type TutorialProofLevelV1 = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type TutorialProofRiskV1 = "LOW" | "MEDIUM" | "HIGH";

export interface TutorialProofStageV1 {
  readonly level: TutorialProofLevelV1;
  readonly stageId: string;
  readonly kind:
    | "IR_CONTRACT"
    | "VIRTUAL_AE_STRUCTURE"
    | "LIVE_AE_MICROPROOF"
    | "SPARSE_VISUAL"
    | "SHORT_MOTION"
    | "TUTORIAL_RECONSTRUCTION"
    | "TRANSFER"
    | "BROAD_PRODUCTION";
  readonly required: boolean;
  readonly liveAeRequired: boolean;
  readonly assertions: readonly string[];
  readonly rationale: string;
}

export interface TutorialProofPlanV1 {
  readonly schema: "editflow.tutorial-proof-plan.v1";
  readonly skillId: string;
  readonly risk: TutorialProofRiskV1;
  readonly targetState: TutorialSkillState;
  readonly blockedByCapabilities: readonly string[];
  readonly reusableCapabilityProofs: readonly string[];
  readonly stages: readonly TutorialProofStageV1[];
  readonly evidenceStopRule: string;
}

const temporalKinds = new Set([
  "TEMPORAL_DUPLICATION",
  "TRANSFORM_ANIMATION",
  "CAMERA_PUSH",
  "TIME_REMAP",
  "REVERSE_TIME",
  "FREEZE_FRAME",
  "MASK_ANIMATION",
  "MOTION_BLUR",
  "BEAT_SYNC",
  "AUDIO_SYNC",
]);

const highRiskKinds = new Set([
  "SUBJECT_ISOLATION",
  "TRACKING",
  "TIME_REMAP",
  "MASK_ANIMATION",
  "MATTE_RELATION",
  "PRECOMPOSE",
]);

const findingsForSkill = (
  report: TutorialCapabilityDiscoveryReportV0,
  skillId: string,
): readonly TutorialCapabilityFindingV0[] =>
  report.findings.filter((finding) => finding.uses.some((use) => use.skillId === skillId));

const stateRank: Readonly<Record<TutorialSkillState, number>> = {
  OBSERVED: 0,
  RECONSTRUCTED: 1,
  TRANSFER_VERIFIED: 2,
  ROBUST: 3,
};

const riskFor = (
  skill: TutorialDeepSkillLessonV1,
  findings: readonly TutorialCapabilityFindingV0[],
): TutorialProofRiskV1 => {
  if (skill.editingIr.nodes.some((node) => highRiskKinds.has(node.kind))) return "HIGH";
  if (findings.some((finding) => finding.state !== "READY")
    || skill.editingIr.nodes.some((node) => temporalKinds.has(node.kind))) return "MEDIUM";
  return "LOW";
};

export const compileTutorialProofPlanV1 = (
  skill: TutorialDeepSkillLessonV1,
  report: TutorialCapabilityDiscoveryReportV0,
  targetState: TutorialSkillState = "TRANSFER_VERIFIED",
): TutorialProofPlanV1 => {
  const findings = findingsForSkill(report, skill.analysis.skillId);
  const requiredFindings = findings.filter((finding) =>
    finding.uses.some((use) => !use.optional));
  const blocked = requiredFindings
    .filter((finding) => ["UNREGISTERED", "ADAPTER_REQUIRED", "UNAVAILABLE", "PARTIAL"].includes(finding.state))
    .map((finding) => String(finding.capabilityId));
  const proofNeeded = requiredFindings
    .filter((finding) => finding.state === "PROOF_REQUIRED");
  const reusable = requiredFindings
    .filter((finding) => finding.state === "READY")
    .map((finding) => String(finding.capabilityId));
  const reconstruct = stateRank[targetState] >= stateRank.RECONSTRUCTED;
  const transfer = stateRank[targetState] >= stateRank.TRANSFER_VERIFIED;
  const robust = stateRank[targetState] >= stateRank.ROBUST;
  const temporal = skill.editingIr.nodes.some((node) => temporalKinds.has(node.kind));

  const stages: TutorialProofStageV1[] = [
    {
      level: 0,
      stageId: `${skill.analysis.skillId}:L0`,
      kind: "IR_CONTRACT",
      required: true,
      liveAeRequired: false,
      assertions: [
        ...skill.analysis.proof.invariants,
        ...skill.analysis.how.adaptationRules.map((rule) => `Adaptation invariant: ${rule}`),
      ],
      rationale: "Disprove recipe, dependency, parameter, and adaptation errors before contacting After Effects.",
    },
    {
      level: 1,
      stageId: `${skill.analysis.skillId}:L1`,
      kind: "VIRTUAL_AE_STRUCTURE",
      required: true,
      liveAeRequired: false,
      assertions: skill.analysis.how.topology.map((item) => `Topology: ${item}`),
      rationale: "Validate composition/layer/effect/timing relationships in Virtual AE first.",
    },
    {
      level: 2,
      stageId: `${skill.analysis.skillId}:L2`,
      kind: "LIVE_AE_MICROPROOF",
      required: proofNeeded.length > 0,
      liveAeRequired: proofNeeded.length > 0,
      assertions: proofNeeded.map((finding) =>
        `${String(finding.capabilityId)} must reach ${finding.requiredProofMaturity} from ${finding.actualProofMaturity ?? "NONE"}`),
      rationale: proofNeeded.length > 0
        ? "Only capability evidence below the tutorial requirement receives a live structural microproof."
        : "All required capability evidence remains reusable; no live AE re-proof adds information.",
    },
  ];

  stages.push(
    {
      level: 3,
      stageId: `${skill.analysis.skillId}:L3`,
      kind: "SPARSE_VISUAL",
      required: reconstruct,
      liveAeRequired: reconstruct,
      assertions: structuredClone(skill.analysis.proof.validationCriteria),
      rationale: "Structural correctness is insufficient; inspect only critical frames needed to judge the visible principle.",
    },
    {
      level: 4,
      stageId: `${skill.analysis.skillId}:L4`,
      kind: "SHORT_MOTION",
      required: reconstruct && temporal,
      liveAeRequired: reconstruct && temporal,
      assertions: temporal
        ? [
            `Timing model: ${skill.analysis.how.timingModel}`,
            `Easing model: ${skill.analysis.how.easingModel}`,
          ]
        : [],
      rationale: temporal
        ? "The recipe has temporal mechanisms, so a bounded motion window is needed."
        : "No temporal mechanism requires a motion proof.",
    },
    {
      level: 5,
      stageId: `${skill.analysis.skillId}:L5`,
      kind: "TUTORIAL_RECONSTRUCTION",
      required: reconstruct,
      liveAeRequired: reconstruct,
      assertions: structuredClone(skill.analysis.proof.validationCriteria),
      rationale: "Reconstruct the demonstrated professional principle rather than merely explaining it.",
    },

    {
      level: 6,
      stageId: `${skill.analysis.skillId}:L6`,
      kind: "TRANSFER",
      required: transfer,
      liveAeRequired: transfer,
      assertions: skill.analysis.proof.transferAxes.map((axis) => `Transfer axis: ${axis}`),
      rationale: "Autonomous availability requires adaptation to materially different footage.",
    },
    {
      level: 7,
      stageId: `${skill.analysis.skillId}:L7`,
      kind: "BROAD_PRODUCTION",
      required: robust,
      liveAeRequired: robust,
      assertions: skill.analysis.proof.robustnessAxes.map((axis) => `Robustness axis: ${axis}`),
      rationale: robust
        ? "ROBUST maturity requires selected cross-condition production coverage."
        : "Broad production coverage is deferred until ROBUST maturity is the target.",
    },
  );

  return {
    schema: "editflow.tutorial-proof-plan.v1",
    skillId: skill.analysis.skillId,
    risk: riskFor(skill, requiredFindings),
    targetState,
    blockedByCapabilities: [...new Set(blocked)].sort(),
    reusableCapabilityProofs: [...new Set(reusable)].sort(),
    stages,
    evidenceStopRule:
      "Stop when every required stage for the target maturity passes. Reuse valid capability evidence and do not re-run equivalent proofs without dependency or environment invalidation.",
  };
};
