import type { EditingContext, EditingSkill, EvaluationDimension } from "./index.js";

export type PracticeStage = "IMITATE" | "TRANSFER" | "COMPOSE" | "INVENT";

export interface PracticeAssignment {
  readonly id: string;
  readonly stage: PracticeStage;
  readonly skillIds: readonly string[];
  readonly context: EditingContext;
  readonly objective: string;
  readonly constraints: readonly string[];
  readonly successCriteria: readonly string[];
  readonly requiredEvidence: readonly string[];
  readonly criticDimensions: readonly EvaluationDimension[];
}

export interface PracticeProgram {
  readonly skillIds: readonly string[];
  readonly assignments: readonly PracticeAssignment[];
}

export interface PracticeProgramOptions {
  readonly transferContextsPerSkill: number;
  readonly compositionCount: number;
  readonly inventionCount: number;
}

export const DEFAULT_PRACTICE_PROGRAM_OPTIONS: PracticeProgramOptions = {
  transferContextsPerSkill: 2,
  compositionCount: 2,
  inventionCount: 2,
};

const unique = (values: readonly string[]): readonly string[] => [...new Set(values)].sort();

const baseCriticDimensions: readonly EvaluationDimension[] = [
  "intent_match",
  "timing",
  "pacing",
  "readability",
  "motion_quality",
  "effect_restraint",
  "technical_integrity",
];

const defaultEvidence = (stage: PracticeStage): readonly string[] => {
  const common = [
    "before-state structural snapshot",
    "after-state structural snapshot",
    "rendered or preview evidence covering the technique",
    "critic metrics with evidence references",
  ];
  if (stage === "IMITATE") return [...common, "reference/tutor comparison evidence"];
  if (stage === "TRANSFER") return [...common, "evidence that timing/parameters were adapted to the new footage"];
  if (stage === "COMPOSE") return [...common, "evidence that each combined skill has a distinct editorial function"];
  return [...common, "evidence that the result is not a direct procedural copy of one training demonstration"];
};

const buildImitation = (skill: EditingSkill): PracticeAssignment => ({
  id: `practice.${skill.id}.imitate`,
  stage: "IMITATE",
  skillIds: [skill.id],
  context: {
    goal: `Reconstruct ${skill.name} closely enough to establish a trustworthy executable baseline.`,
    tags: unique([...skill.tags, "reconstruction", "imitation"]),
    energy: null,
    shotMotion: [],
    audioEvents: [],
    constraints: ["Do not intentionally stylize away from the source construction during this stage."],
  },
  objective: `Reproduce the demonstrated construction of '${skill.name}' and verify the intended visible result.`,
  constraints: [
    "Use the demonstrated procedure when the required capabilities are available.",
    "Do not substitute a weaker approximation without explicitly marking the reconstruction blocked.",
    "Treat tutorial-specific values as reconstruction evidence, not future universal defaults.",
  ],
  successCriteria: unique([
    "The construction completes without an unreported approximation.",
    ...skill.visualTargets,
  ]),
  requiredEvidence: defaultEvidence("IMITATE"),
  criticDimensions: baseCriticDimensions,
});

const buildTransfer = (skill: EditingSkill, context: EditingContext, index: number): PracticeAssignment => ({
  id: `practice.${skill.id}.transfer.${index + 1}`,
  stage: "TRANSFER",
  skillIds: [skill.id],
  context,
  objective: `Apply '${skill.name}' to materially different footage while preserving why the technique works rather than copying source values.`,
  constraints: unique([
    ...context.constraints,
    "Adapt timing, spatial targets, amplitudes, and effect intensity to this footage.",
    "Preserve subject readability and the intended visual hierarchy.",
    ...skill.whenNotToUse.map((condition) => `Stop or reject the technique when: ${condition}`),
  ]),
  successCriteria: unique([
    "The technique remains recognizable as the same underlying principle without feeling mechanically copied.",
    ...skill.visualTargets,
    ...skill.adaptationRules.map((rule) => `Adaptation satisfied: ${rule}`),
  ]),
  requiredEvidence: defaultEvidence("TRANSFER"),
  criticDimensions: baseCriticDimensions,
});

const buildComposition = (skills: readonly EditingSkill[], context: EditingContext, index: number): PracticeAssignment => ({
  id: `practice.composition.${index + 1}`,
  stage: "COMPOSE",
  skillIds: skills.map((skill) => skill.id),
  context,
  objective: `Combine ${skills.map((skill) => `'${skill.name}'`).join(" + ")} only where each technique contributes a distinct editorial function.`,
  constraints: unique([
    ...context.constraints,
    "Do not stack techniques merely to increase effect count.",
    "Assign each technique a clear purpose such as timing, hierarchy, transition, readability, color, or sound relationship.",
    "Remove any technique whose contribution is not viewer-visible or harms readability.",
  ]),
  successCriteria: unique([
    "The combined result feels like one coherent edit decision rather than a tutorial collage.",
    "Each included technique has a defensible editorial purpose.",
    "No critical readability or technical-integrity regression is introduced by the combination.",
    ...skills.flatMap((skill) => skill.visualTargets),
  ]),
  requiredEvidence: defaultEvidence("COMPOSE"),
  criticDimensions: [
    ...baseCriticDimensions,
    "continuity",
    "color_consistency",
    "sound_sync",
  ],
});

const buildInvention = (skills: readonly EditingSkill[], context: EditingContext, index: number): PracticeAssignment => ({
  id: `practice.invention.${index + 1}`,
  stage: "INVENT",
  skillIds: skills.map((skill) => skill.id),
  context,
  objective: "Create an original solution for the current footage using learned principles as constraints and inspiration, not as a step-by-step recipe.",
  constraints: unique([
    ...context.constraints,
    "Do not duplicate the complete action sequence of a single tutorial demonstration.",
    "Use learned WHY/WHEN principles to justify the design before selecting HOW operations.",
    "Prefer the simplest construction that achieves the intended viewer effect.",
    "Preview and revise based on the actual result rather than adding complexity by default.",
  ]),
  successCriteria: unique([
    "The result solves the stated editorial goal and is materially adapted to the new footage.",
    "At least one learned principle is used in a new combination, timing relationship, or visual construction.",
    "The result remains technically clean and readable.",
    "The design can be explained in terms of viewer impact rather than only named effects/plugins.",
  ]),
  requiredEvidence: defaultEvidence("INVENT"),
  criticDimensions: [
    "intent_match",
    "timing",
    "pacing",
    "continuity",
    "readability",
    "motion_quality",
    "color_consistency",
    "sound_sync",
    "effect_restraint",
    "technical_integrity",
  ],
});

export const createPracticeProgram = (
  skills: readonly EditingSkill[],
  transferContexts: readonly EditingContext[],
  options: PracticeProgramOptions = DEFAULT_PRACTICE_PROGRAM_OPTIONS,
): PracticeProgram => {
  if (skills.length === 0) return { skillIds: [], assignments: [] };
  const assignments: PracticeAssignment[] = [];

  for (const skill of skills) {
    assignments.push(buildImitation(skill));
    for (let index = 0; index < Math.min(options.transferContextsPerSkill, transferContexts.length); index += 1) {
      const context = transferContexts[index];
      if (context !== undefined) assignments.push(buildTransfer(skill, context, index));
    }
  }

  if (skills.length >= 2 && transferContexts.length > 0) {
    for (let index = 0; index < options.compositionCount; index += 1) {
      const context = transferContexts[index % transferContexts.length];
      if (context === undefined) break;
      const first = skills[index % skills.length];
      const second = skills[(index + 1) % skills.length];
      if (first === undefined || second === undefined) continue;
      assignments.push(buildComposition([first, second], context, index));
    }
  }

  for (let index = 0; index < options.inventionCount; index += 1) {
    const context = transferContexts[index % transferContexts.length];
    if (context === undefined) break;
    assignments.push(buildInvention(skills.slice(0, Math.min(3, skills.length)), context, index));
  }

  return {
    skillIds: skills.map((skill) => skill.id),
    assignments,
  };
};

export const nextPracticeStage = (
  evidence: {
    readonly imitationPassed: boolean;
    readonly distinctTransferPasses: number;
    readonly compositionPasses: number;
  },
): PracticeStage => {
  if (!evidence.imitationPassed) return "IMITATE";
  if (evidence.distinctTransferPasses < 2) return "TRANSFER";
  if (evidence.compositionPasses < 1) return "COMPOSE";
  return "INVENT";
};
