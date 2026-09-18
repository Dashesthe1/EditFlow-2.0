import type { EditingContext, EvaluationDimension } from "./index.js";

export type PrincipleOrigin = "PROFESSIONAL_REFERENCE" | "TUTORIAL" | "EDITOR_FEEDBACK" | "EXPERIENCE";

export interface ReferenceSource {
  readonly sourceId: string;
  readonly title: string;
  readonly sourceRef: string;
  readonly durationSeconds: number | null;
  readonly tags: readonly string[];
}

export interface ReferencePhase {
  readonly id: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly function: string;
  readonly energy: "low" | "medium" | "high" | null;
  readonly observations: readonly string[];
  readonly audioRelationship: readonly string[];
  readonly visualHierarchy: readonly string[];
}

export interface ReferenceMoment {
  readonly id: string;
  readonly timeSeconds: number;
  readonly function: string;
  readonly observations: readonly string[];
  readonly principleIds: readonly string[];
}

export interface EditorialPrinciple {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly origin: PrincipleOrigin;
  readonly domains: readonly string[];
  readonly tags: readonly string[];
  readonly whenToApply: readonly string[];
  readonly whenNotToApply: readonly string[];
  readonly rationale: readonly string[];
  readonly positiveSignals: readonly string[];
  readonly negativeSignals: readonly string[];
  readonly sourceIds: readonly string[];
  readonly confidence: number;
}

export interface ReferenceAnalysis {
  readonly source: ReferenceSource;
  readonly overallIntent: string;
  readonly structure: readonly ReferencePhase[];
  readonly moments: readonly ReferenceMoment[];
  readonly principles: readonly EditorialPrinciple[];
  readonly shotSelectionObservations: readonly string[];
  readonly pacingObservations: readonly string[];
  readonly soundObservations: readonly string[];
  readonly restraintObservations: readonly string[];
  readonly compositionObservations: readonly string[];
  readonly effectDensityObservations: readonly string[];
}

export interface EditorFeedbackRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly contextTags: readonly string[];
  readonly feedback: string;
  readonly polarity: "POSITIVE" | "NEGATIVE" | "MIXED";
  readonly derivedPrinciples: readonly EditorialPrinciple[];
}

export interface RetrievedPrinciple {
  readonly principle: EditorialPrinciple;
  readonly score: number;
  readonly supportingReferenceMoments: readonly ReferenceMoment[];
  readonly matchingFeedback: readonly EditorFeedbackRecord[];
}

export interface TasteRetrievalResult {
  readonly queryTokens: readonly string[];
  readonly principles: readonly RetrievedPrinciple[];
}

export interface TasteEvaluationSignal {
  readonly principleId: string;
  readonly satisfied: boolean;
  readonly strength: number;
  readonly note: string;
  readonly evidenceRefs: readonly string[];
}

export interface EvidenceMetric {
  readonly dimension: EvaluationDimension;
  readonly score: number;
  readonly note: string;
  readonly evidenceRefs: readonly string[];
}

export interface CriticEvidenceBundle {
  readonly previewRefs: readonly string[];
  readonly audioEvidenceRefs: readonly string[];
  readonly technicalReadbackRefs: readonly string[];
  readonly referenceComparisonRefs: readonly string[];
  readonly metrics: readonly EvidenceMetric[];
  readonly tasteSignals: readonly TasteEvaluationSignal[];
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

const normalize = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const tokens = (values: readonly string[]): readonly string[] => {
  const result = new Set<string>();
  for (const value of values) {
    for (const token of normalize(value).split(/\s+/)) {
      if (token.length >= 2) result.add(token);
    }
  }
  return [...result].sort();
};

const overlap = (query: ReadonlySet<string>, candidate: readonly string[]): number => {
  if (query.size === 0) return 0;
  let matches = 0;
  for (const token of candidate) if (query.has(token)) matches += 1;
  return clamp01(matches / query.size);
};

const unique = (values: readonly string[]): readonly string[] => [...new Set(values)].sort();

const principleTokens = (principle: EditorialPrinciple): readonly string[] => tokens([
  principle.name,
  principle.summary,
  ...principle.domains,
  ...principle.tags,
  ...principle.whenToApply,
  ...principle.rationale,
  ...principle.positiveSignals,
  ...principle.negativeSignals,
]);

const contextTokens = (context: EditingContext): readonly string[] => tokens([
  context.goal,
  ...context.tags,
  ...(context.energy === null ? [] : [context.energy]),
  ...context.shotMotion,
  ...context.audioEvents,
  ...context.constraints,
]);

const feedbackTokens = (feedback: EditorFeedbackRecord): readonly string[] => tokens([
  feedback.feedback,
  ...feedback.contextTags,
]);

const richer = (left: readonly string[], right: readonly string[]): readonly string[] => unique([...left, ...right]);

export const mergeEditorialPrinciples = (left: EditorialPrinciple, right: EditorialPrinciple): EditorialPrinciple => {
  if (left.id !== right.id) throw new Error(`Cannot merge different principle ids '${left.id}' and '${right.id}'.`);
  return {
    id: left.id,
    name: right.name.length >= left.name.length ? right.name : left.name,
    summary: right.summary.length >= left.summary.length ? right.summary : left.summary,
    origin: left.origin === "EDITOR_FEEDBACK" || right.origin === "EDITOR_FEEDBACK" ? "EDITOR_FEEDBACK" : right.origin,
    domains: richer(left.domains, right.domains),
    tags: richer(left.tags, right.tags),
    whenToApply: richer(left.whenToApply, right.whenToApply),
    whenNotToApply: richer(left.whenNotToApply, right.whenNotToApply),
    rationale: richer(left.rationale, right.rationale),
    positiveSignals: richer(left.positiveSignals, right.positiveSignals),
    negativeSignals: richer(left.negativeSignals, right.negativeSignals),
    sourceIds: richer(left.sourceIds, right.sourceIds),
    confidence: Math.max(clamp01(left.confidence), clamp01(right.confidence)),
  };
};

export class EditorialTasteLibrary {
  readonly #sources = new Map<string, ReferenceSource>();
  readonly #phases = new Map<string, ReferencePhase>();
  readonly #moments = new Map<string, ReferenceMoment>();
  readonly #principles = new Map<string, EditorialPrinciple>();
  readonly #feedback = new Map<string, EditorFeedbackRecord>();

  ingestReference(analysis: ReferenceAnalysis): void {
    this.#sources.set(analysis.source.sourceId, analysis.source);
    for (const phase of analysis.structure) this.#phases.set(`${analysis.source.sourceId}|${phase.id}`, phase);
    for (const moment of analysis.moments) this.#moments.set(`${analysis.source.sourceId}|${moment.id}`, moment);
    for (const principle of analysis.principles) {
      if (!principle.sourceIds.includes(analysis.source.sourceId)) {
        throw new Error(`Principle '${principle.id}' does not cite reference source '${analysis.source.sourceId}'.`);
      }
      this.upsertPrinciple(principle);
    }
  }

  upsertPrinciple(principle: EditorialPrinciple): void {
    const current = this.#principles.get(principle.id);
    this.#principles.set(principle.id, current === undefined ? principle : mergeEditorialPrinciples(current, principle));
  }

  recordEditorFeedback(feedback: EditorFeedbackRecord): void {
    this.#feedback.set(feedback.id, feedback);
    for (const principle of feedback.derivedPrinciples) this.upsertPrinciple(principle);
  }

  getPrinciple(id: string): EditorialPrinciple | null {
    return this.#principles.get(id) ?? null;
  }

  retrieve(context: EditingContext, limit = 6): TasteRetrievalResult {
    const queryTokens = contextTokens(context);
    const query = new Set(queryTokens);
    const ranked: RetrievedPrinciple[] = [];

    for (const principle of this.#principles.values()) {
      const semantic = overlap(query, principleTokens(principle));
      const sourceBreadth = Math.min(1, principle.sourceIds.length / 4);
      const editorFeedbackBonus = principle.origin === "EDITOR_FEEDBACK" ? 0.1 : 0;
      const score = clamp01(semantic * 0.72 + clamp01(principle.confidence) * 0.16 + sourceBreadth * 0.12 + editorFeedbackBonus);
      const supportingReferenceMoments = [...this.#moments.entries()]
        .filter(([, moment]) => moment.principleIds.includes(principle.id))
        .map(([, moment]) => moment)
        .slice(0, 3);
      const matchingFeedback = [...this.#feedback.values()]
        .map((feedback) => ({ feedback, score: overlap(query, feedbackTokens(feedback)) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || b.feedback.createdAt.localeCompare(a.feedback.createdAt))
        .map((entry) => entry.feedback)
        .slice(0, 2);
      ranked.push({ principle, score, supportingReferenceMoments, matchingFeedback });
    }

    ranked.sort((a, b) => b.score - a.score || a.principle.id.localeCompare(b.principle.id));
    return { queryTokens, principles: ranked.slice(0, Math.max(0, limit)) };
  }

  snapshot(): {
    readonly sources: readonly ReferenceSource[];
    readonly principles: readonly EditorialPrinciple[];
    readonly feedback: readonly EditorFeedbackRecord[];
  } {
    return {
      sources: [...this.#sources.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
      principles: [...this.#principles.values()].sort((a, b) => a.id.localeCompare(b.id)),
      feedback: [...this.#feedback.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    };
  }
}

export const assertCriticEvidenceGrounded = (
  evidence: CriticEvidenceBundle,
  criticalDimensions: readonly EvaluationDimension[] = ["intent_match", "timing", "readability", "technical_integrity"],
): void => {
  const byDimension = new Map(evidence.metrics.map((metric) => [metric.dimension, metric] as const));
  for (const dimension of criticalDimensions) {
    const metric = byDimension.get(dimension);
    if (metric === undefined) throw new Error(`Critic is missing critical dimension '${dimension}'.`);
    if (metric.evidenceRefs.length === 0) throw new Error(`Critical dimension '${dimension}' has no evidence references.`);
  }

  const hasPreview = evidence.previewRefs.length > 0;
  const hasTechnical = evidence.technicalReadbackRefs.length > 0;
  if (!hasPreview) throw new Error("Critic requires at least one preview/render evidence reference.");
  if (!hasTechnical) throw new Error("Critic requires at least one technical readback evidence reference.");
};

export const selectRefinementFocus = (
  evidence: CriticEvidenceBundle,
  minimumByDimension: Readonly<Partial<Record<EvaluationDimension, number>>>,
  maxDimensions = 3,
): readonly EvidenceMetric[] => {
  assertCriticEvidenceGrounded(evidence);
  return evidence.metrics
    .filter((metric) => metric.score < (minimumByDimension[metric.dimension] ?? 0.75))
    .sort((a, b) => a.score - b.score || a.dimension.localeCompare(b.dimension))
    .slice(0, Math.max(0, maxDimensions));
};
