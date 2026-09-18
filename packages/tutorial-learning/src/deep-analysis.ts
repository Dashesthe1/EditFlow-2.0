import {
  assertValidEditingIrRecipeV1,
  type EditingIrParameterV1,
  type EditingIrPrimitiveKindV1,
  type EditingIrRecipeV1,
  type EditingIrTargetSpecV1,
  type EditingIrTimingV1,
} from "../../editing-ir/src/index.js";
import type {
  TutorialAnalysisPacketV0,
  TutorialCapabilityRequirementV0,
  TutorialLessonV0,
  TutorialSkillState,
} from "./contracts.js";
import { compileTutorialLessonV0, TutorialLessonValidationError } from "./compiler.js";

export interface TutorialWhatComponentV1 {
  readonly componentId: string;
  readonly visibleResult: string;
  readonly role: string;
  readonly interactions: readonly string[];
}

export interface TutorialWhatAnalysisV1 {
  readonly objective: string;
  readonly components: readonly TutorialWhatComponentV1[];
}

export interface TutorialWhenWhyAnalysisV1 {
  readonly creativeIntent: string;
  readonly attentionGoal: string;
  readonly emotionalPurpose: string;
  readonly pacingRole: string;
  readonly musicRelationship: string;
  readonly dialogueRelationship: string;
  readonly motionConditions: readonly string[];
  readonly compositionConditions: readonly string[];
  readonly continuityConstraints: readonly string[];
  readonly useWhen: readonly string[];
  readonly avoidWhen: readonly string[];
  readonly restraintRule: string;
}

export interface TutorialMechanismV1 {
  readonly mechanismId: string;
  readonly primitive: EditingIrPrimitiveKindV1;
  readonly startMs: number;
  readonly endMs: number;
  readonly intent: string;
  readonly construction: string;
  readonly observableResult: string;
  readonly dependsOn: readonly string[];
  readonly parameters: readonly EditingIrParameterV1[];
  readonly target?: EditingIrTargetSpecV1;
  readonly timing?: EditingIrTimingV1;
  readonly evidenceRefs?: readonly string[];
}

export interface TutorialHowAnalysisV1 {
  readonly topology: readonly string[];
  readonly timingModel: string;
  readonly easingModel: string;
  readonly adaptationRules: readonly string[];
  readonly mechanisms: readonly TutorialMechanismV1[];
}

export interface TutorialAccessBindingV1 {
  readonly mechanismId: string;
  readonly capabilityRequirements: readonly TutorialCapabilityRequirementV0[];
}

export interface TutorialAccessAnalysisV1 {
  readonly bindings: readonly TutorialAccessBindingV1[];
}

export interface TutorialFailureModeV1 {
  readonly condition: string;
  readonly diagnosis: string;
  readonly repairStrategy: string;
}

export interface TutorialProofAnalysisV1 {
  readonly validationCriteria: readonly string[];
  readonly invariants: readonly string[];
  readonly failureModes: readonly TutorialFailureModeV1[];
  readonly transferAxes: readonly string[];
  readonly robustnessAxes: readonly string[];
}

export interface TutorialKnowledgeDeltaV1 {
  readonly newConcepts: readonly string[];
  readonly reinforcedConcepts: readonly string[];
  readonly newCombinations: readonly string[];
  readonly refinements: readonly string[];
  readonly contradictions: readonly string[];
}

export interface TutorialDeepSkillAnalysisV1 {
  readonly skillId: string;
  readonly name: string;
  readonly what: TutorialWhatAnalysisV1;
  readonly whenWhy: TutorialWhenWhyAnalysisV1;
  readonly how: TutorialHowAnalysisV1;
  readonly access: TutorialAccessAnalysisV1;
  readonly proof: TutorialProofAnalysisV1;
  readonly scenePrerequisites: readonly string[];
  readonly knowledgeDelta: TutorialKnowledgeDeltaV1;
  readonly compatibleTechniques: readonly string[];
  readonly conflictingTechniques: readonly string[];
}

export interface TutorialDeepAnalysisPacketV1 {
  readonly schema: "editflow.tutorial-analysis.v1";
  readonly tutorialId: string;
  readonly title: string;
  readonly sourceRef: string;
  readonly durationMs: number;
  readonly evidenceRefs: readonly string[];
  readonly skills: readonly TutorialDeepSkillAnalysisV1[];
}

export interface TutorialDeepSkillLessonV1 {
  readonly analysis: TutorialDeepSkillAnalysisV1;
  readonly editingIr: EditingIrRecipeV1;
  readonly learningState: TutorialSkillState;
}

export interface TutorialDeepLessonV1 {
  readonly schema: "editflow.tutorial-deep-lesson.v1";
  readonly tutorialId: string;
  readonly title: string;
  readonly sourceRef: string;
  readonly durationMs: number;
  readonly evidenceRefs: readonly string[];
  readonly legacyLesson: TutorialLessonV0;
  readonly skills: readonly TutorialDeepSkillLessonV1[];
}

const requireText = (value: string, field: string): void => {
  if (value.trim().length === 0) throw new TutorialLessonValidationError(`${field} must not be empty.`);
};

const requireTextList = (
  values: readonly string[],
  field: string,
  minimum = 1,
): void => {
  if (values.length < minimum) throw new TutorialLessonValidationError(`${field} requires at least ${minimum} item(s).`);
  values.forEach((value, index) => requireText(value, `${field}[${index}]`));
};

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const validateSkill = (
  skill: TutorialDeepSkillAnalysisV1,
  durationMs: number,
): void => {
  requireText(skill.skillId, "skillId");
  requireText(skill.name, `skill '${skill.skillId}' name`);
  requireText(skill.what.objective, `skill '${skill.skillId}' WHAT objective`);
  if (skill.what.components.length === 0) {
    throw new TutorialLessonValidationError(`Skill '${skill.skillId}' WHAT requires visible components.`);
  }
  for (const component of skill.what.components) {
    requireText(component.componentId, `skill '${skill.skillId}' componentId`);
    requireText(component.visibleResult, `component '${component.componentId}' visibleResult`);
    requireText(component.role, `component '${component.componentId}' role`);
  }

  const judgment = skill.whenWhy;
  requireText(judgment.creativeIntent, `skill '${skill.skillId}' creativeIntent`);
  requireText(judgment.attentionGoal, `skill '${skill.skillId}' attentionGoal`);
  requireText(judgment.emotionalPurpose, `skill '${skill.skillId}' emotionalPurpose`);
  requireText(judgment.pacingRole, `skill '${skill.skillId}' pacingRole`);
  requireText(judgment.musicRelationship, `skill '${skill.skillId}' musicRelationship`);
  requireText(judgment.dialogueRelationship, `skill '${skill.skillId}' dialogueRelationship`);
  requireText(judgment.restraintRule, `skill '${skill.skillId}' restraintRule`);
  requireTextList(judgment.useWhen, `skill '${skill.skillId}' useWhen`);
  requireTextList(judgment.avoidWhen, `skill '${skill.skillId}' avoidWhen`);
  requireTextList(judgment.continuityConstraints, `skill '${skill.skillId}' continuityConstraints`);

  requireTextList(skill.scenePrerequisites, `skill '${skill.skillId}' scenePrerequisites`);
  requireTextList(skill.how.topology, `skill '${skill.skillId}' topology`);
  requireText(skill.how.timingModel, `skill '${skill.skillId}' timingModel`);
  requireText(skill.how.easingModel, `skill '${skill.skillId}' easingModel`);
  requireTextList(skill.how.adaptationRules, `skill '${skill.skillId}' adaptationRules`);
  if (skill.how.mechanisms.length === 0) {
    throw new TutorialLessonValidationError(`Skill '${skill.skillId}' HOW requires mechanisms.`);
  }

  const mechanismIds = new Set<string>();
  for (const mechanism of skill.how.mechanisms) {
    requireText(mechanism.mechanismId, `skill '${skill.skillId}' mechanismId`);
    if (mechanismIds.has(mechanism.mechanismId)) {
      throw new TutorialLessonValidationError(`Duplicate mechanismId '${mechanism.mechanismId}'.`);
    }
    mechanismIds.add(mechanism.mechanismId);
    requireText(mechanism.intent, `mechanism '${mechanism.mechanismId}' intent`);
    requireText(mechanism.construction, `mechanism '${mechanism.mechanismId}' construction`);
    requireText(mechanism.observableResult, `mechanism '${mechanism.mechanismId}' observableResult`);
    if (!Number.isFinite(mechanism.startMs) || !Number.isFinite(mechanism.endMs)
      || mechanism.startMs < 0 || mechanism.endMs <= mechanism.startMs
      || mechanism.endMs > durationMs) {
      throw new TutorialLessonValidationError(`Mechanism '${mechanism.mechanismId}' has invalid tutorial timing.`);
    }
  }

  for (const mechanism of skill.how.mechanisms) {
    for (const dependency of mechanism.dependsOn) {
      if (!mechanismIds.has(dependency)) {
        throw new TutorialLessonValidationError(
          `Mechanism '${mechanism.mechanismId}' references missing dependency '${dependency}'.`,
        );
      }
      if (dependency === mechanism.mechanismId) {
        throw new TutorialLessonValidationError(`Mechanism '${mechanism.mechanismId}' cannot depend on itself.`);
      }
    }
  }

  const bindingIds = new Set<string>();
  for (const binding of skill.access.bindings) {
    requireText(binding.mechanismId, `skill '${skill.skillId}' ACCESS mechanismId`);
    if (!mechanismIds.has(binding.mechanismId)) {
      throw new TutorialLessonValidationError(`ACCESS references unknown mechanism '${binding.mechanismId}'.`);
    }
    if (bindingIds.has(binding.mechanismId)) {
      throw new TutorialLessonValidationError(`Duplicate ACCESS binding for '${binding.mechanismId}'.`);
    }
    bindingIds.add(binding.mechanismId);
    for (const requirement of binding.capabilityRequirements) {
      requireText(String(requirement.capabilityId), `mechanism '${binding.mechanismId}' capabilityId`);
      requireText(requirement.reason, `mechanism '${binding.mechanismId}' capability reason`);
    }
  }
  for (const mechanismId of mechanismIds) {
    if (!bindingIds.has(mechanismId)) {
      throw new TutorialLessonValidationError(`Mechanism '${mechanismId}' is missing an ACCESS binding.`);
    }
  }

  requireTextList(skill.proof.validationCriteria, `skill '${skill.skillId}' validationCriteria`);
  requireTextList(skill.proof.invariants, `skill '${skill.skillId}' invariants`);
  requireTextList(skill.proof.transferAxes, `skill '${skill.skillId}' transferAxes`);
  requireTextList(skill.proof.robustnessAxes, `skill '${skill.skillId}' robustnessAxes`);
  if (skill.proof.failureModes.length === 0) {
    throw new TutorialLessonValidationError(`Skill '${skill.skillId}' PROOF requires failure modes.`);
  }
  for (const failure of skill.proof.failureModes) {
    requireText(failure.condition, `skill '${skill.skillId}' failure condition`);
    requireText(failure.diagnosis, `skill '${skill.skillId}' failure diagnosis`);
    requireText(failure.repairStrategy, `skill '${skill.skillId}' repair strategy`);
  }

  const delta = skill.knowledgeDelta;
  const deltaCount = delta.newConcepts.length + delta.reinforcedConcepts.length
    + delta.newCombinations.length + delta.refinements.length + delta.contradictions.length;
  if (deltaCount === 0) {
    throw new TutorialLessonValidationError(`Skill '${skill.skillId}' must record a knowledge delta.`);
  }
};

const accessMapFor = (
  skill: TutorialDeepSkillAnalysisV1,
): ReadonlyMap<string, TutorialAccessBindingV1> =>
  new Map(skill.access.bindings.map((binding) => [binding.mechanismId, binding]));

const terminalMechanismIds = (skill: TutorialDeepSkillAnalysisV1): readonly string[] => {
  const dependedOn = new Set(skill.how.mechanisms.flatMap((mechanism) => mechanism.dependsOn));
  return skill.how.mechanisms
    .map((mechanism) => mechanism.mechanismId)
    .filter((mechanismId) => !dependedOn.has(mechanismId));
};

export const compileEditingIrFromTutorialSkillV1 = (
  skill: TutorialDeepSkillAnalysisV1,
): EditingIrRecipeV1 => {
  const access = accessMapFor(skill);
  const recipe: EditingIrRecipeV1 = {
    schema: "editflow.editing-ir.recipe.v1",
    recipeId: `tutorial:${skill.skillId}`,
    skillId: skill.skillId,
    creativeIntent: skill.whenWhy.creativeIntent,
    prerequisites: structuredClone(skill.scenePrerequisites),
    nodes: skill.how.mechanisms.map((mechanism) => {
      const binding = access.get(mechanism.mechanismId);
      if (!binding) throw new TutorialLessonValidationError(
        `Mechanism '${mechanism.mechanismId}' has no ACCESS binding.`,
      );
      const base = {
        nodeId: mechanism.mechanismId,
        kind: mechanism.primitive,
        intent: mechanism.intent,
        dependsOn: structuredClone(mechanism.dependsOn),
        capabilityIds: unique(binding.capabilityRequirements.map((requirement) => requirement.capabilityId)),
        parameters: structuredClone(mechanism.parameters),
      };
      const targeted = mechanism.target === undefined
        ? base
        : { ...base, target: structuredClone(mechanism.target) };
      return mechanism.timing === undefined
        ? targeted
        : { ...targeted, timing: structuredClone(mechanism.timing) };
    }),
    outputs: terminalMechanismIds(skill),
    validationCriteria: structuredClone(skill.proof.validationCriteria),
  };
  return assertValidEditingIrRecipeV1(recipe);
};

export const toTutorialAnalysisPacketV0 = (
  packet: TutorialDeepAnalysisPacketV1,
): TutorialAnalysisPacketV0 => ({
  tutorialId: packet.tutorialId,
  title: packet.title,
  sourceRef: packet.sourceRef,
  durationMs: packet.durationMs,
  evidenceRefs: structuredClone(packet.evidenceRefs),
  skills: packet.skills.map((skill) => {
    const access = accessMapFor(skill);
    const adaptationVariables = unique(skill.how.mechanisms.flatMap((mechanism) =>
      mechanism.parameters.flatMap((parameter) => parameter.derivedFrom)));
    return {
      skillId: skill.skillId,
      name: skill.name,
      objective: skill.what.objective,
      whenToUse: skill.whenWhy.useWhen.join(" | "),
      adaptationVariables,
      validationCriteria: structuredClone(skill.proof.validationCriteria),
      steps: [...skill.how.mechanisms]
        .sort((a, b) => a.startMs - b.startMs || a.mechanismId.localeCompare(b.mechanismId))
        .map((mechanism) => {
          const binding = access.get(mechanism.mechanismId);
          if (!binding) throw new TutorialLessonValidationError(
            `Mechanism '${mechanism.mechanismId}' has no ACCESS binding.`,
          );
          const base = {
            stepId: mechanism.mechanismId,
            startMs: mechanism.startMs,
            endMs: mechanism.endMs,
            intent: mechanism.intent,
            action: mechanism.construction,
            observableResult: mechanism.observableResult,
            capabilityRequirements: structuredClone(binding.capabilityRequirements),
          };
          return mechanism.evidenceRefs === undefined
            ? base
            : { ...base, evidenceRefs: structuredClone(mechanism.evidenceRefs) };
        }),
    };
  }),
});

export const compileTutorialDeepLessonV1 = (
  packet: TutorialDeepAnalysisPacketV1,
): TutorialDeepLessonV1 => {
  requireText(packet.tutorialId, "tutorialId");
  requireText(packet.title, "title");
  requireText(packet.sourceRef, "sourceRef");
  if (!Number.isFinite(packet.durationMs) || packet.durationMs <= 0) {
    throw new TutorialLessonValidationError("durationMs must be a positive finite number.");
  }
  if (packet.skills.length === 0) {
    throw new TutorialLessonValidationError("Deep tutorial analysis requires at least one skill.");
  }
  const skillIds = new Set<string>();
  for (const skill of packet.skills) {
    if (skillIds.has(skill.skillId)) {
      throw new TutorialLessonValidationError(`Duplicate skillId '${skill.skillId}'.`);
    }
    skillIds.add(skill.skillId);
    validateSkill(skill, packet.durationMs);
  }
  const legacyLesson = compileTutorialLessonV0(toTutorialAnalysisPacketV0(packet));
  return {
    schema: "editflow.tutorial-deep-lesson.v1",
    tutorialId: packet.tutorialId,
    title: packet.title,
    sourceRef: packet.sourceRef,
    durationMs: packet.durationMs,
    evidenceRefs: unique(packet.evidenceRefs),
    legacyLesson,
    skills: packet.skills.map((analysis) => ({
      analysis: structuredClone(analysis),
      editingIr: compileEditingIrFromTutorialSkillV1(analysis),
      learningState: "OBSERVED",
    })),
  };
};
