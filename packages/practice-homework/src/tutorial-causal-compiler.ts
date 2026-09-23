import { createHash } from "node:crypto";

import {
  compileTutorialDeepLessonV1,
  type TutorialDeepAnalysisPacketV1,
  type TutorialDeepSkillAnalysisV1,
} from "../../tutorial-learning/src/index.js";
import type {
  GptLearnedSkillV1,
  GptResearchSourceV1,
  GptSkillCausalModelV1,
  GptTutorialCausalCompilationV1,
  GptTutorialTechniqueV1,
} from "./contracts.js";

const unique = (values: readonly string[]): readonly string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const requireText = (value: string, field: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new TypeError(field + " must not be empty.");
  return trimmed;
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
};

const analysisFingerprint = (value: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");

const list = (label: string, values: readonly string[]): string =>
  label + ": " + unique(values).join(" | ");

const techniqueFor = (skill: TutorialDeepSkillAnalysisV1): GptTutorialTechniqueV1 => ({
  what: [
    skill.what.objective,
    ...skill.what.components.map((component) =>
      component.componentId + ": " + component.visibleResult + " (" + component.role + ")"),
  ].join(" | "),
  whenWhy: [
    skill.whenWhy.creativeIntent,
    list("Use when", skill.whenWhy.useWhen),
    list("Avoid when", skill.whenWhy.avoidWhen),
    list("Motion conditions", skill.whenWhy.motionConditions),
    list("Composition conditions", skill.whenWhy.compositionConditions),
    "Restraint: " + skill.whenWhy.restraintRule,
  ].join(" | "),
  how: [
    list("Topology", skill.how.topology),
    "Timing: " + skill.how.timingModel,
    "Easing: " + skill.how.easingModel,
    ...skill.how.mechanisms.map((mechanism) =>
      mechanism.mechanismId + ": " + mechanism.construction + " => " + mechanism.observableResult),
  ].join(" | "),
  access: skill.access.bindings.map((binding) =>
    binding.mechanismId + ": " + binding.capabilityRequirements.map((requirement) =>
      String(requirement.capabilityId) + " (" + requirement.reason + ")").join(", ")).join(" | "),
  proof: [
    list("Validation", skill.proof.validationCriteria),
    list("Invariants", skill.proof.invariants),
    ...skill.proof.failureModes.map((failure) =>
      "Failure: " + failure.condition + " Diagnosis: " + failure.diagnosis
        + " Repair: " + failure.repairStrategy),
  ].join(" | "),
  transfer: [
    list("Transfer axes", skill.proof.transferAxes),
    list("Robustness axes", skill.proof.robustnessAxes),
    list("Adaptation rules", skill.how.adaptationRules),
  ].join(" | "),
});

const causalModelFor = (skill: TutorialDeepSkillAnalysisV1): GptSkillCausalModelV1 => {
  const adaptationAxes = unique([
    ...skill.proof.transferAxes,
    ...skill.proof.robustnessAxes,
    ...skill.how.mechanisms.flatMap((mechanism) =>
      mechanism.parameters.flatMap((parameter) => parameter.derivedFrom)),
  ]);
  const invariants = unique([
    ...skill.proof.invariants,
    ...skill.whenWhy.continuityConstraints,
    ...skill.proof.validationCriteria,
  ]);
  const transferAxisSummary = adaptationAxes.join(", ");
  return {
    triggerConditions: unique([
      ...skill.scenePrerequisites,
      ...skill.whenWhy.useWhen,
      ...skill.whenWhy.motionConditions,
      ...skill.whenWhy.compositionConditions,
    ]),
    invariants,
    adaptationAxes,
    failureSignals: unique(skill.proof.failureModes.map((failure) =>
      failure.condition + " Diagnosis: " + failure.diagnosis)),
    repairStrategies: unique(skill.proof.failureModes.map((failure) => failure.repairStrategy)),
    transferCriteria: unique([
      ...invariants.map((invariant) =>
        "Preserve on materially different footage: " + invariant),
      ...skill.proof.validationCriteria.map((criterion) =>
        "After adapting " + transferAxisSummary + ", verify: " + criterion),
    ]),
  };
};

const constructionPatternFor = (skill: TutorialDeepSkillAnalysisV1): string => [
  list("Topology", skill.how.topology),
  "Timing: " + skill.how.timingModel,
  "Easing: " + skill.how.easingModel,
  "Mechanisms: " + skill.how.mechanisms.map((mechanism) =>
    mechanism.mechanismId + " [" + mechanism.primitive + "] " + mechanism.construction)
    .join(" -> "),
].join(" | ");

const adaptationNotesFor = (skill: TutorialDeepSkillAnalysisV1): string => [
  list("Adapt along", [...skill.proof.transferAxes, ...skill.proof.robustnessAxes]),
  list("Rules", skill.how.adaptationRules),
].join(" | ");

const evidenceRefsFor = (
  packet: TutorialDeepAnalysisPacketV1,
  skill: TutorialDeepSkillAnalysisV1,
  fingerprint: string,
): readonly string[] => unique([
  ...packet.evidenceRefs,
  ...skill.how.mechanisms.flatMap((mechanism) => mechanism.evidenceRefs ?? []),
  "tutorial-analysis:sha256:" + fingerprint,
]);

export interface CompileGptTutorialResearchSourceInputV1 {
  readonly packet: TutorialDeepAnalysisPacketV1;
  readonly tutorialSkillId: string;
  readonly targetSkillId: string;
  readonly tutorialDriveUri: string;
  readonly sourceId?: string;
  readonly notes?: string;
}

export const compileGptTutorialResearchSourceV1 = (
  input: CompileGptTutorialResearchSourceInputV1,
): GptResearchSourceV1 => {
  const targetSkillId = requireText(input.targetSkillId, "targetSkillId");
  const tutorialSkillId = requireText(input.tutorialSkillId, "tutorialSkillId");
  const tutorialDriveUri = requireText(input.tutorialDriveUri, "tutorialDriveUri");
  if (!/^https:\/\/drive\.google\.com\/(?:file\/d\/|drive\/folders\/)/.test(tutorialDriveUri)) {
    throw new TypeError("tutorialDriveUri must reference a Google Drive tutorial file or folder.");
  }
  const lesson = compileTutorialDeepLessonV1(input.packet);
  const lessonSkill = lesson.skills.find((item) => item.analysis.skillId === tutorialSkillId);
  if (lessonSkill === undefined) {
    throw new TypeError("Unknown tutorial deep-analysis skill: " + tutorialSkillId);
  }
  const skill = lessonSkill.analysis;
  const fingerprint = analysisFingerprint({
    tutorialId: input.packet.tutorialId,
    sourceRef: input.packet.sourceRef,
    skill,
  });
  const evidenceRefs = evidenceRefsFor(input.packet, skill, fingerprint);
  if (evidenceRefs.length <= 1) {
    throw new TypeError("Tutorial causal compilation requires retained deep-analysis evidence.");
  }
  const causalModel = causalModelFor(skill);
  const compilation: GptTutorialCausalCompilationV1 = {
    schema: "editflow.gpt-tutorial-causal-compilation.v1",
    compilerVersion: 1,
    targetSkillId,
    tutorialId: input.packet.tutorialId,
    tutorialSkillId,
    sourceRef: input.packet.sourceRef,
    analysisFingerprint: fingerprint,
    constructionPattern: constructionPatternFor(skill),
    capabilityIds: unique(skill.access.bindings.flatMap((binding) =>
      binding.capabilityRequirements.map((requirement) => String(requirement.capabilityId)))),
    adaptationNotes: adaptationNotesFor(skill),
    causalModel,
    evidenceRefs,
  };
  const sourceId = input.sourceId?.trim()
    || "tutorial-drive:" + input.packet.tutorialId + ":" + tutorialSkillId;
  return {
    sourceId,
    kind: "TUTORIAL_DRIVE",
    title: input.packet.title,
    uri: tutorialDriveUri,
    ...(input.notes === undefined ? {} : { notes: input.notes.trim() }),
    tutorialTechnique: techniqueFor(skill),
    tutorialCompilation: compilation,
  };
};

const compiledForSkill = (
  skillId: string,
  sources: readonly GptResearchSourceV1[],
): readonly GptTutorialCausalCompilationV1[] =>
  sources.flatMap((source) =>
    source.tutorialCompilation?.targetSkillId === skillId
      ? [source.tutorialCompilation]
      : []);

const uniqueSources = (
  sources: readonly GptResearchSourceV1[],
): readonly GptResearchSourceV1[] => {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.sourceId)) return false;
    seen.add(source.sourceId);
    return true;
  });
};

export const applyCompiledTutorialCausalModelV1 = (
  skill: GptLearnedSkillV1,
  researchSources: readonly GptResearchSourceV1[],
): GptLearnedSkillV1 => {
  const compilations = compiledForSkill(skill.skillId, researchSources);
  if (compilations.length === 0) {
    return {
      ...structuredClone(skill),
      researchSources: uniqueSources(researchSources).map((source) => structuredClone(source)),
    };
  }
  const mergedCausalModel: GptSkillCausalModelV1 = {
    triggerConditions: unique(compilations.flatMap((item) => item.causalModel.triggerConditions)),
    invariants: unique(compilations.flatMap((item) => item.causalModel.invariants)),
    adaptationAxes: unique(compilations.flatMap((item) => item.causalModel.adaptationAxes)),
    failureSignals: unique(compilations.flatMap((item) => item.causalModel.failureSignals)),
    repairStrategies: unique(compilations.flatMap((item) => item.causalModel.repairStrategies)),
    transferCriteria: unique(compilations.flatMap((item) => item.causalModel.transferCriteria)),
  };
  const compiledPattern = compilations.map((item) =>
    "[" + item.tutorialId + "/" + item.tutorialSkillId + "] " + item.constructionPattern)
    .join(" || ");
  return {
    ...structuredClone(skill),
    constructionPattern: compiledPattern,
    capabilityIds: unique(compilations.flatMap((item) => item.capabilityIds)),
    adaptationNotes: compilations.map((item) => item.adaptationNotes).join(" || "),
    causalModel: mergedCausalModel,
    researchSources: uniqueSources(researchSources).map((source) => structuredClone(source)),
  };
};
