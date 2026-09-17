import { PROOF_MATURITY, type ProofMaturity } from "../../core-contracts/src/index.js";
import type {
  TutorialAnalysisPacketV0,
  TutorialCapabilityRequirementV0,
  TutorialLessonV0,
  TutorialSkillProofV0,
  TutorialSkillState,
  TutorialSkillV0,
} from "./contracts.js";

export class TutorialLessonValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TutorialLessonValidationError";
  }
}

const maturityRank = (value: ProofMaturity): number => PROOF_MATURITY.indexOf(value);
const requireText = (value: string, field: string): void => {
  if (value.trim().length === 0) throw new TutorialLessonValidationError(`${field} must not be empty.`);
};

const mergeRequirements = (
  requirements: readonly TutorialCapabilityRequirementV0[],
): readonly TutorialCapabilityRequirementV0[] => {
  const grouped = new Map<string, TutorialCapabilityRequirementV0[]>();
  for (const requirement of requirements) {
    const key = String(requirement.capabilityId);
    grouped.set(key, [...(grouped.get(key) ?? []), requirement]);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, values]) => {
    const first = values[0];
    if (!first) throw new TutorialLessonValidationError("Capability requirement group is empty.");
    const strongest = values.reduce((best, candidate) =>
      maturityRank(candidate.minimumProofMaturity) > maturityRank(best.minimumProofMaturity) ? candidate : best,
    );
    const reasons = [...new Set(values.map((item) => item.reason.trim()).filter(Boolean))];
    const preferredRouteKinds = [...new Set(values.flatMap((item) => item.preferredRouteKinds ?? []))];
    const base = {
      capabilityId: first.capabilityId,
      reason: reasons.join(" | "),
      minimumProofMaturity: strongest.minimumProofMaturity,
      optional: values.every((item) => item.optional === true),
    };
    return preferredRouteKinds.length > 0 ? { ...base, preferredRouteKinds } : base;
  });
};

const validatePacket = (packet: TutorialAnalysisPacketV0): void => {
  requireText(packet.tutorialId, "tutorialId");
  requireText(packet.title, "title");
  requireText(packet.sourceRef, "sourceRef");
  if (!Number.isFinite(packet.durationMs) || packet.durationMs <= 0) {
    throw new TutorialLessonValidationError("durationMs must be a positive finite number.");
  }
  if (packet.skills.length === 0) throw new TutorialLessonValidationError("At least one skill is required.");
  const skillIds = new Set<string>();
  for (const skill of packet.skills) {
    requireText(skill.skillId, "skillId");
    requireText(skill.name, `skill '${skill.skillId}' name`);
    requireText(skill.objective, `skill '${skill.skillId}' objective`);
    requireText(skill.whenToUse, `skill '${skill.skillId}' whenToUse`);
    if (skillIds.has(skill.skillId)) throw new TutorialLessonValidationError(`Duplicate skillId '${skill.skillId}'.`);
    skillIds.add(skill.skillId);
    if (skill.steps.length === 0) throw new TutorialLessonValidationError(`Skill '${skill.skillId}' has no steps.`);
    const stepIds = new Set<string>();
    for (const step of skill.steps) {
      requireText(step.stepId, `skill '${skill.skillId}' stepId`);
      if (stepIds.has(step.stepId)) throw new TutorialLessonValidationError(`Duplicate stepId '${step.stepId}' in '${skill.skillId}'.`);
      stepIds.add(step.stepId);
      if (!Number.isFinite(step.startMs) || !Number.isFinite(step.endMs) || step.startMs < 0 || step.endMs <= step.startMs) {
        throw new TutorialLessonValidationError(`Step '${step.stepId}' has an invalid time range.`);
      }
      if (step.endMs > packet.durationMs) throw new TutorialLessonValidationError(`Step '${step.stepId}' exceeds tutorial duration.`);
      requireText(step.intent, `step '${step.stepId}' intent`);
      requireText(step.action, `step '${step.stepId}' action`);
      requireText(step.observableResult, `step '${step.stepId}' observableResult`);
      for (const requirement of step.capabilityRequirements) {
        requireText(String(requirement.capabilityId), `step '${step.stepId}' capabilityId`);
        requireText(requirement.reason, `step '${step.stepId}' capability reason`);
      }
    }
  }
};
export const compileTutorialLessonV0 = (packet: TutorialAnalysisPacketV0): TutorialLessonV0 => {
  validatePacket(packet);
  const skills: TutorialSkillV0[] = packet.skills.map((skill) => ({
    ...structuredClone(skill),
    learningState: "OBSERVED",
    requiredCapabilities: mergeRequirements(skill.steps.flatMap((step) => step.capabilityRequirements)),
  }));
  return {
    schemaVersion: 1,
    tutorialId: packet.tutorialId,
    title: packet.title,
    sourceRef: packet.sourceRef,
    durationMs: packet.durationMs,
    evidenceRefs: [...new Set(packet.evidenceRefs)],
    skills,
  };
};

export const deriveTutorialSkillStateV0 = (
  skillId: string,
  proofs: readonly TutorialSkillProofV0[],
): TutorialSkillState => {
  const passed = new Set(proofs.filter((proof) => proof.skillId === skillId && proof.passed).map((proof) => proof.kind));
  if (!passed.has("RECONSTRUCTION")) return "OBSERVED";
  if (!passed.has("TRANSFER")) return "RECONSTRUCTED";
  return passed.has("ROBUSTNESS") ? "ROBUST" : "TRANSFER_VERIFIED";
};
