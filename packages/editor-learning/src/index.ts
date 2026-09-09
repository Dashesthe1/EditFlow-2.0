export const EDITOR_LEARNING_SCHEMA_VERSION = "1.0.0" as const;

export type SkillMastery =
  | "OBSERVED"
  | "RECONSTRUCTED"
  | "VISUAL_MATCH_VERIFIED"
  | "TRANSFER_VERIFIED"
  | "OBJECT_AWARE_VERIFIED"
  | "ROBUST";

export type ExperienceOutcome = "SUCCESS" | "MIXED" | "FAILURE";
export type PracticeKind = "RECONSTRUCTION" | "TRANSFER" | "OBJECT_AWARE" | "COMPOSITION" | "PRODUCTION";
export type SkillRelation = "PREREQUISITE" | "VARIANT" | "COMBINES_WITH" | "CONFLICTS_WITH" | "OFTEN_PRECEDES";

export type EvaluationDimension =
  | "intent_match"
  | "timing"
  | "pacing"
  | "continuity"
  | "readability"
  | "motion_quality"
  | "color_consistency"
  | "sound_sync"
  | "effect_restraint"
  | "technical_integrity";

export interface TutorialSource {
  readonly sourceId: string;
  readonly title: string;
  readonly sourceRef: string;
  readonly durationSeconds: number | null;
  readonly tags: readonly string[];
}

export interface TutorialAction {
  readonly id: string;
  readonly timeSeconds: number | null;
  readonly intent: string;
  readonly action: string;
  readonly target: string | null;
  readonly parameters: Readonly<Record<string, string | number | boolean | null>>;
  readonly expectedVisualChange: string;
}

export interface TutorialDemonstration {
  readonly demonstrationId: string;
  readonly sourceId: string;
  readonly title: string;
  readonly objective: string;
  readonly contextTags: readonly string[];
  readonly actions: readonly TutorialAction[];
  readonly observations: readonly string[];
  readonly inferredPrinciples: readonly string[];
  readonly candidateSkillIds: readonly string[];
}

export interface SkillProcedureStep {
  readonly id: string;
  readonly intent: string;
  readonly action: string;
  readonly expectedOutcome: string;
  readonly requiredCapabilities: readonly string[];
}

export interface SkillParameterGuidance {
  readonly parameter: string;
  readonly guidance: string;
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly unit: string | null;
}

export interface EditingSkill {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly domains: readonly string[];
  readonly tags: readonly string[];
  readonly intents: readonly string[];
  readonly prerequisites: readonly string[];
  readonly whenToUse: readonly string[];
  readonly whenNotToUse: readonly string[];
  readonly whyItWorks: readonly string[];
  readonly procedure: readonly SkillProcedureStep[];
  readonly parameterGuidance: readonly SkillParameterGuidance[];
  readonly visualTargets: readonly string[];
  readonly failureModes: readonly string[];
  readonly adaptationRules: readonly string[];
  readonly variants: readonly string[];
  readonly sourceIds: readonly string[];
  readonly confidence: number;
  readonly mastery: SkillMastery;
}

export interface SkillEdge {
  readonly fromSkillId: string;
  readonly toSkillId: string;
  readonly relation: SkillRelation;
  readonly rationale: string;
}

export interface EvaluationMetric {
  readonly dimension: EvaluationDimension;
  readonly score: number;
  readonly note: string;
}

export interface EvaluationSummary {
  readonly overallScore: number;
  readonly passed: boolean;
  readonly metrics: readonly EvaluationMetric[];
  readonly failedCriticalDimensions: readonly EvaluationDimension[];
}

export interface ExperienceRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly outcome: ExperienceOutcome;
  readonly practiceKind: PracticeKind;
  readonly skillIds: readonly string[];
  readonly contextSignature: string;
  readonly contextTags: readonly string[];
  readonly decision: string;
  readonly result: string;
  readonly lessons: readonly string[];
  readonly evaluation: EvaluationSummary;
}

export interface TutorialExtraction {
  readonly source: TutorialSource;
  readonly demonstrations: readonly TutorialDemonstration[];
  readonly skills: readonly EditingSkill[];
  readonly edges: readonly SkillEdge[];
}

export interface EditingContext {
  readonly goal: string;
  readonly tags: readonly string[];
  readonly energy: "low" | "medium" | "high" | null;
  readonly shotMotion: readonly string[];
  readonly audioEvents: readonly string[];
  readonly constraints: readonly string[];
}

export interface RetrievedSkill {
  readonly skill: EditingSkill;
  readonly score: number;
  readonly supportingExperiences: readonly ExperienceRecord[];
  readonly warningExperiences: readonly ExperienceRecord[];
}

export interface RetrievalResult {
  readonly queryTokens: readonly string[];
  readonly skills: readonly RetrievedSkill[];
}

export interface TransferExercise {
  readonly id: string;
  readonly skillId: string;
  readonly practiceKind: PracticeKind;
  readonly context: EditingContext;
  readonly objective: string;
  readonly invariants: readonly string[];
  readonly adaptationPrompts: readonly string[];
  readonly successCriteria: readonly string[];
}

export interface EvaluationCriterion {
  readonly dimension: EvaluationDimension;
  readonly weight: number;
  readonly critical: boolean;
  readonly minimumScore: number;
}

export interface EvaluationRubric {
  readonly minimumOverallScore: number;
  readonly criteria: readonly EvaluationCriterion[];
}

export interface KnowledgeSnapshot {
  readonly schemaVersion: typeof EDITOR_LEARNING_SCHEMA_VERSION;
  readonly tutorialSources: readonly TutorialSource[];
  readonly demonstrations: readonly TutorialDemonstration[];
  readonly skills: readonly EditingSkill[];
  readonly edges: readonly SkillEdge[];
  readonly experiences: readonly ExperienceRecord[];
}

const MASTERY_ORDER: readonly SkillMastery[] = [
  "OBSERVED",
  "RECONSTRUCTED",
  "VISUAL_MATCH_VERIFIED",
  "TRANSFER_VERIFIED",
  "OBJECT_AWARE_VERIFIED",
  "ROBUST",
];

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

const normalizeToken = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const tokenize = (values: readonly string[]): readonly string[] => {
  const result = new Set<string>();
  for (const value of values) {
    for (const token of normalizeToken(value).split(/\s+/)) {
      if (token.length >= 2) {
        result.add(token);
      }
    }
  }
  return [...result].sort();
};

const overlapScore = (query: ReadonlySet<string>, candidate: readonly string[]): number => {
  if (query.size === 0) return 0;
  let matches = 0;
  for (const token of candidate) {
    if (query.has(token)) matches += 1;
  }
  return clamp01(matches / query.size);
};

const unique = (values: readonly string[]): readonly string[] => [...new Set(values)].sort();

const mergeProcedure = (left: readonly SkillProcedureStep[], right: readonly SkillProcedureStep[]): readonly SkillProcedureStep[] => {
  const byId = new Map<string, SkillProcedureStep>();
  for (const step of [...left, ...right]) byId.set(step.id, step);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
};

const mergeParameterGuidance = (
  left: readonly SkillParameterGuidance[],
  right: readonly SkillParameterGuidance[],
): readonly SkillParameterGuidance[] => {
  const byParameter = new Map<string, SkillParameterGuidance>();
  for (const entry of [...left, ...right]) byParameter.set(entry.parameter, entry);
  return [...byParameter.values()].sort((a, b) => a.parameter.localeCompare(b.parameter));
};

const higherMastery = (a: SkillMastery, b: SkillMastery): SkillMastery =>
  MASTERY_ORDER.indexOf(a) >= MASTERY_ORDER.indexOf(b) ? a : b;

export const mergeEditingSkills = (left: EditingSkill, right: EditingSkill): EditingSkill => {
  if (left.id !== right.id) throw new Error(`Cannot merge different skill ids '${left.id}' and '${right.id}'.`);
  return {
    id: left.id,
    name: right.name || left.name,
    summary: right.summary.length >= left.summary.length ? right.summary : left.summary,
    domains: unique([...left.domains, ...right.domains]),
    tags: unique([...left.tags, ...right.tags]),
    intents: unique([...left.intents, ...right.intents]),
    prerequisites: unique([...left.prerequisites, ...right.prerequisites]),
    whenToUse: unique([...left.whenToUse, ...right.whenToUse]),
    whenNotToUse: unique([...left.whenNotToUse, ...right.whenNotToUse]),
    whyItWorks: unique([...left.whyItWorks, ...right.whyItWorks]),
    procedure: mergeProcedure(left.procedure, right.procedure),
    parameterGuidance: mergeParameterGuidance(left.parameterGuidance, right.parameterGuidance),
    visualTargets: unique([...left.visualTargets, ...right.visualTargets]),
    failureModes: unique([...left.failureModes, ...right.failureModes]),
    adaptationRules: unique([...left.adaptationRules, ...right.adaptationRules]),
    variants: unique([...left.variants, ...right.variants]),
    sourceIds: unique([...left.sourceIds, ...right.sourceIds]),
    confidence: Math.max(clamp01(left.confidence), clamp01(right.confidence)),
    mastery: higherMastery(left.mastery, right.mastery),
  };
};

export const DEFAULT_EDITORIAL_RUBRIC: EvaluationRubric = {
  minimumOverallScore: 0.78,
  criteria: [
    { dimension: "intent_match", weight: 1.4, critical: true, minimumScore: 0.72 },
    { dimension: "timing", weight: 1.3, critical: true, minimumScore: 0.7 },
    { dimension: "pacing", weight: 1.0, critical: false, minimumScore: 0.65 },
    { dimension: "continuity", weight: 0.9, critical: false, minimumScore: 0.65 },
    { dimension: "readability", weight: 1.3, critical: true, minimumScore: 0.72 },
    { dimension: "motion_quality", weight: 1.0, critical: false, minimumScore: 0.66 },
    { dimension: "color_consistency", weight: 0.7, critical: false, minimumScore: 0.62 },
    { dimension: "sound_sync", weight: 0.9, critical: false, minimumScore: 0.65 },
    { dimension: "effect_restraint", weight: 0.8, critical: false, minimumScore: 0.62 },
    { dimension: "technical_integrity", weight: 1.2, critical: true, minimumScore: 0.75 },
  ],
};

export const evaluateEdit = (
  metrics: readonly EvaluationMetric[],
  rubric: EvaluationRubric = DEFAULT_EDITORIAL_RUBRIC,
): EvaluationSummary => {
  const byDimension = new Map<EvaluationDimension, EvaluationMetric>();
  for (const metric of metrics) byDimension.set(metric.dimension, { ...metric, score: clamp01(metric.score) });

  let weighted = 0;
  let totalWeight = 0;
  const failedCriticalDimensions: EvaluationDimension[] = [];
  const normalized: EvaluationMetric[] = [];

  for (const criterion of rubric.criteria) {
    const metric = byDimension.get(criterion.dimension) ?? {
      dimension: criterion.dimension,
      score: 0,
      note: "Missing evaluation evidence.",
    };
    normalized.push(metric);
    weighted += metric.score * criterion.weight;
    totalWeight += criterion.weight;
    if (criterion.critical && metric.score < criterion.minimumScore) failedCriticalDimensions.push(criterion.dimension);
  }

  const overallScore = totalWeight === 0 ? 0 : clamp01(weighted / totalWeight);
  return {
    overallScore,
    passed: overallScore >= rubric.minimumOverallScore && failedCriticalDimensions.length === 0,
    metrics: normalized,
    failedCriticalDimensions,
  };
};

const skillTokens = (skill: EditingSkill): readonly string[] =>
  tokenize([
    skill.name,
    skill.summary,
    ...skill.domains,
    ...skill.tags,
    ...skill.intents,
    ...skill.whenToUse,
    ...skill.whyItWorks,
    ...skill.visualTargets,
    ...skill.adaptationRules,
  ]);

const contextTokens = (context: EditingContext): readonly string[] =>
  tokenize([
    context.goal,
    ...context.tags,
    ...(context.energy === null ? [] : [context.energy]),
    ...context.shotMotion,
    ...context.audioEvents,
    ...context.constraints,
  ]);

const experienceRelevance = (experience: ExperienceRecord, query: ReadonlySet<string>): number =>
  overlapScore(query, tokenize([...experience.contextTags, experience.decision, experience.result, ...experience.lessons]));

export class EditorKnowledgeBase {
  readonly #tutorialSources = new Map<string, TutorialSource>();
  readonly #demonstrations = new Map<string, TutorialDemonstration>();
  readonly #skills = new Map<string, EditingSkill>();
  readonly #edges = new Map<string, SkillEdge>();
  readonly #experiences = new Map<string, ExperienceRecord>();

  constructor(snapshot?: KnowledgeSnapshot) {
    if (snapshot !== undefined) {
      if (snapshot.schemaVersion !== EDITOR_LEARNING_SCHEMA_VERSION) {
        throw new Error(`Unsupported editor-learning schema '${snapshot.schemaVersion}'.`);
      }
      for (const source of snapshot.tutorialSources) this.#tutorialSources.set(source.sourceId, source);
      for (const demonstration of snapshot.demonstrations) this.#demonstrations.set(demonstration.demonstrationId, demonstration);
      for (const skill of snapshot.skills) this.#skills.set(skill.id, skill);
      for (const edge of snapshot.edges) this.#edges.set(this.#edgeKey(edge), edge);
      for (const experience of snapshot.experiences) this.#experiences.set(experience.id, experience);
    }
  }

  ingestTutorial(extraction: TutorialExtraction): void {
    this.#tutorialSources.set(extraction.source.sourceId, extraction.source);
    for (const demonstration of extraction.demonstrations) {
      if (demonstration.sourceId !== extraction.source.sourceId) {
        throw new Error(`Demonstration '${demonstration.demonstrationId}' references a different tutorial source.`);
      }
      this.#demonstrations.set(demonstration.demonstrationId, demonstration);
    }
    for (const skill of extraction.skills) {
      if (!skill.sourceIds.includes(extraction.source.sourceId)) {
        throw new Error(`Skill '${skill.id}' does not cite tutorial source '${extraction.source.sourceId}'.`);
      }
      const existing = this.#skills.get(skill.id);
      this.#skills.set(skill.id, existing === undefined ? skill : mergeEditingSkills(existing, skill));
    }
    for (const edge of extraction.edges) this.#edges.set(this.#edgeKey(edge), edge);
  }

  upsertSkill(skill: EditingSkill): void {
    const existing = this.#skills.get(skill.id);
    this.#skills.set(skill.id, existing === undefined ? skill : mergeEditingSkills(existing, skill));
  }

  addEdge(edge: SkillEdge): void {
    this.#edges.set(this.#edgeKey(edge), edge);
  }

  recordExperience(experience: ExperienceRecord): void {
    for (const skillId of experience.skillIds) {
      if (!this.#skills.has(skillId)) throw new Error(`Experience '${experience.id}' references unknown skill '${skillId}'.`);
    }
    this.#experiences.set(experience.id, experience);
  }

  getSkill(skillId: string): EditingSkill | null {
    return this.#skills.get(skillId) ?? null;
  }

  retrieve(context: EditingContext, limit = 5): RetrievalResult {
    const tokens = contextTokens(context);
    const query = new Set(tokens);
    const ranked: RetrievedSkill[] = [];

    for (const skill of this.#skills.values()) {
      const semantic = overlapScore(query, skillTokens(skill));
      const mastery = MASTERY_ORDER.indexOf(skill.mastery) / (MASTERY_ORDER.length - 1);
      const relatedExperiences = [...this.#experiences.values()]
        .filter((experience) => experience.skillIds.includes(skill.id))
        .sort((a, b) => {
          const relevanceDelta = experienceRelevance(b, query) - experienceRelevance(a, query);
          if (Math.abs(relevanceDelta) > Number.EPSILON) return relevanceDelta;
          return b.createdAt.localeCompare(a.createdAt);
        });
      const evidenceBonus = Math.min(1, relatedExperiences.length / 5);
      const score = clamp01(semantic * 0.68 + mastery * 0.14 + clamp01(skill.confidence) * 0.1 + evidenceBonus * 0.08);
      const supportingExperiences = relatedExperiences.filter((experience) => experience.outcome === "SUCCESS").slice(0, 2);
      const warningExperiences = relatedExperiences.filter((experience) => experience.outcome !== "SUCCESS").slice(0, 2);
      ranked.push({ skill, score, supportingExperiences, warningExperiences });
    }

    ranked.sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id));
    return { queryTokens: tokens, skills: ranked.slice(0, Math.max(0, limit)) };
  }

  generateTransferCurriculum(skillId: string, contexts: readonly EditingContext[], limit = 6): readonly TransferExercise[] {
    const skill = this.#skills.get(skillId);
    if (skill === undefined) throw new Error(`Unknown skill '${skillId}'.`);

    const exercises: TransferExercise[] = [];
    const reconstructionContext: EditingContext = {
      goal: `Reconstruct ${skill.name} as demonstrated before adapting it.`,
      tags: unique([...skill.tags, "reconstruction"]),
      energy: null,
      shotMotion: [],
      audioEvents: [],
      constraints: ["Preserve the demonstrated construction before introducing creative variation."],
    };
    exercises.push({
      id: `${skill.id}:reconstruction`,
      skillId: skill.id,
      practiceKind: "RECONSTRUCTION",
      context: reconstructionContext,
      objective: `Reproduce '${skill.name}' closely enough to verify the construction and visual target.`,
      invariants: skill.visualTargets,
      adaptationPrompts: ["Do not improve or stylize yet; establish a trustworthy baseline."],
      successCriteria: ["Procedure completes without approximation.", ...skill.visualTargets],
    });

    for (let index = 0; index < contexts.length && exercises.length < Math.max(1, limit); index += 1) {
      const context = contexts[index];
      if (context === undefined) continue;
      exercises.push({
        id: `${skill.id}:transfer:${index + 1}`,
        skillId: skill.id,
        practiceKind: "TRANSFER",
        context,
        objective: `Apply '${skill.name}' to materially different footage while preserving the underlying editorial principle.`,
        invariants: skill.visualTargets,
        adaptationPrompts: unique([
          ...skill.adaptationRules,
          "Adapt timing to the new motion and audio rather than copying absolute tutorial values.",
          "Preserve subject readability and the intended visual hierarchy.",
        ]),
        successCriteria: unique([
          "The technique remains recognizable without looking mechanically copied.",
          ...skill.visualTargets,
          ...skill.whenNotToUse.map((condition) => `Avoid failure condition: ${condition}`),
        ]),
      });
    }

    return exercises;
  }

  deriveMastery(skillId: string): SkillMastery {
    const skill = this.#skills.get(skillId);
    if (skill === undefined) throw new Error(`Unknown skill '${skillId}'.`);
    const experiences = [...this.#experiences.values()].filter(
      (experience) => experience.skillIds.includes(skillId) && experience.outcome === "SUCCESS" && experience.evaluation.passed,
    );
    if (experiences.length === 0) return skill.mastery;

    const reconstructions = experiences.filter((experience) => experience.practiceKind === "RECONSTRUCTION");
    const transfers = experiences.filter((experience) => experience.practiceKind === "TRANSFER");
    const objectAware = experiences.filter((experience) => experience.practiceKind === "OBJECT_AWARE");
    const distinctTransferContexts = new Set(transfers.map((experience) => experience.contextSignature));
    const distinctContexts = new Set(experiences.map((experience) => experience.contextSignature));
    const average = experiences.reduce((sum, experience) => sum + experience.evaluation.overallScore, 0) / experiences.length;

    let derived: SkillMastery = skill.mastery;
    if (reconstructions.length >= 1) derived = higherMastery(derived, "RECONSTRUCTED");
    if (reconstructions.some((experience) => experience.evaluation.overallScore >= 0.82)) {
      derived = higherMastery(derived, "VISUAL_MATCH_VERIFIED");
    }
    if (distinctTransferContexts.size >= 2) derived = higherMastery(derived, "TRANSFER_VERIFIED");
    if (objectAware.length >= 1) derived = higherMastery(derived, "OBJECT_AWARE_VERIFIED");
    if (distinctContexts.size >= 5 && average >= 0.86 && objectAware.length >= 1 && distinctTransferContexts.size >= 2) {
      derived = higherMastery(derived, "ROBUST");
    }
    return derived;
  }

  snapshot(): KnowledgeSnapshot {
    return {
      schemaVersion: EDITOR_LEARNING_SCHEMA_VERSION,
      tutorialSources: [...this.#tutorialSources.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
      demonstrations: [...this.#demonstrations.values()].sort((a, b) => a.demonstrationId.localeCompare(b.demonstrationId)),
      skills: [...this.#skills.values()].sort((a, b) => a.id.localeCompare(b.id)),
      edges: [...this.#edges.values()].sort((a, b) => this.#edgeKey(a).localeCompare(this.#edgeKey(b))),
      experiences: [...this.#experiences.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    };
  }

  #edgeKey(edge: SkillEdge): string {
    return `${edge.fromSkillId}|${edge.relation}|${edge.toSkillId}`;
  }
}
