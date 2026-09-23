import type {
  ConstructionGraphV1,
  DenseEffectEvidenceV1,
  DenseEffectSequenceV1,
  DenseEffectWindowV1,
  FidelityComparisonV1,
  M6ProductionRequestV1,
  M6ProductionResultV1,
  SemanticPatchV1,
  TransitionDnaV1,
} from "../../visual-effects-intelligence/src/index.js";
import {
  VisualEffectsBrainV1,
  alignDenseEffectSequencesV1,
  applySemanticPatchesV1,
  buildConstructionGraphV1,
  classifyEffectFamilyV1,
  compareSemanticVisualFidelityV1,
  decomposeUnknownEffectV1,
  deriveEffectAnatomyV1,
  detectDenseEffectWindowsV1,
  synthesizeUnknownEffectV1,
} from "../../visual-effects-intelligence/src/index.js";

import type {
  EditTypeKnowledgeSnapshotV1,
  PracticeAttemptV1,
  PracticeContentBaselineV1,
  PracticeDecisionTraceV1,
  PracticeHomeworkAdaptersV1,
  PracticeReconstructionOutputV1,
  PracticeReferenceAnalysisV1,
  PracticeSceneMatchV1,
  PracticeSemanticPatchV1,
  PracticeSimilarityReportV1,
} from "./contracts.js";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export interface PracticeContentStructureEvaluationV1 {
  readonly sceneIdentity: number;
  readonly temporalAlignment: number;
  readonly cutTiming: number;
  readonly framing: number;
  readonly motion: number;
  readonly colorFinish: number;
  readonly pixelStructure: number;
  readonly wrongSceneCount: number;
  readonly unmatchedSceneCount: number;
  readonly evidenceRefs: readonly string[];
}

export interface PracticeM6RuntimeV1 {
  readonly availableCapabilities: readonly string[];
  analyzeReference(
    reference: PracticeReferenceAnalysisV1,
  ): Promise<DenseEffectEvidenceV1>;
  prepareAttempt(input: {
    readonly sessionId: string;
    readonly editTypeId: string;
    readonly editTypeKnowledge: EditTypeKnowledgeSnapshotV1;
    readonly attempt: number;
    readonly reference: PracticeReferenceAnalysisV1;
    readonly baseline: PracticeContentBaselineV1;
    readonly matches: readonly PracticeSceneMatchV1[];
    readonly priorAttempts: readonly PracticeAttemptV1[];
  }): Promise<void>;
  applyWindowGraph(input: {
    readonly sessionId: string;
    readonly attempt: number;
    readonly reference: PracticeReferenceAnalysisV1;
    readonly baseline: PracticeContentBaselineV1;
    readonly window: DenseEffectWindowV1;
    readonly graph: ConstructionGraphV1;
  }): Promise<void>;
  renderWindowEvidence(input: {
    readonly sessionId: string;
    readonly attempt: number;
    readonly reference: PracticeReferenceAnalysisV1;
    readonly baseline: PracticeContentBaselineV1;
    readonly window: DenseEffectWindowV1;
    readonly graph: ConstructionGraphV1;
  }): Promise<DenseEffectEvidenceV1>;
  renderFullEdit(input: {
    readonly sessionId: string;
    readonly attempt: number;
    readonly reference: PracticeReferenceAnalysisV1;
    readonly baseline: PracticeContentBaselineV1;
  }): Promise<{
    readonly renderRef: string;
    readonly evidenceRefs: readonly string[];
  }>;
  analyzeRender(input: {
    readonly renderRef: string;
    readonly reference: PracticeReferenceAnalysisV1;
  }): Promise<DenseEffectEvidenceV1>;
  evaluateContentStructure(input: {
    readonly renderRef: string;
    readonly reference: PracticeReferenceAnalysisV1;
    readonly baseline: PracticeContentBaselineV1;
    readonly matches: readonly PracticeSceneMatchV1[];
  }): Promise<PracticeContentStructureEvaluationV1>;
}

export interface PracticeM6BrainV1 {
  run(request: M6ProductionRequestV1): Promise<M6ProductionResultV1>;
}

interface PracticeM6AttemptStateV1 {
  readonly sessionId: string;
  readonly attempt: number;
  readonly reference: PracticeReferenceAnalysisV1;
  readonly baseline: PracticeContentBaselineV1;
  readonly matches: readonly PracticeSceneMatchV1[];
  readonly referenceEvidence: DenseEffectEvidenceV1;
  readonly referenceSequence: DenseEffectSequenceV1;
  readonly windowResults: readonly M6ProductionResultV1[];
}

const dnaForEvidence = (
  evidence: DenseEffectEvidenceV1,
): TransitionDnaV1 => {
  const family = classifyEffectFamilyV1(evidence);
  return family === "UNKNOWN"
    ? decomposeUnknownEffectV1(evidence).dna
    : deriveEffectAnatomyV1(evidence, family).dna;
};

const shotForWindow = (
  reference: PracticeReferenceAnalysisV1,
  window: DenseEffectWindowV1,
): string | undefined => {
  const anchor = window.anchorMs;
  const containing = reference.shots.find((shot) =>
    anchor >= shot.referenceStartMs && anchor <= shot.referenceEndMs);
  if (containing !== undefined) return containing.shotId;
  let nearest: PracticeReferenceAnalysisV1["shots"][number] | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const shot of reference.shots) {
    const center = (shot.referenceStartMs + shot.referenceEndMs) / 2;
    const distance = Math.abs(anchor - center);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = shot;
    }
  }
  return nearest?.shotId;
};

const finalGraphId = (result: M6ProductionResultV1): string | null =>
  result.correction?.graph.graphId
  ?? result.synthesis?.selected?.graph.graphId
  ?? null;

const mean = (values: readonly number[], fallback = 0): number =>
  values.length === 0
    ? fallback
    : values.reduce((sum, value) => sum + value, 0) / values.length;

const harmonic = (a: number, b: number): number =>
  a <= 0 || b <= 0 ? 0 : (2 * a * b) / (a + b);

const unique = (values: readonly string[]): readonly string[] =>
  [...new Set(values.filter((value) => value.trim().length > 0))];

const clampRange = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const semanticPatchesForFamily = (
  knowledge: EditTypeKnowledgeSnapshotV1,
  family: ReturnType<typeof classifyEffectFamilyV1>,
): readonly PracticeSemanticPatchV1[] => {
  const marker = `M6_FAMILY_${family}`;
  const stats = new Map<string, {
    success: number;
    failure: number;
    latestSuccessful: PracticeSemanticPatchV1 | null;
  }>();
  for (const evidence of knowledge.behaviorEvidence) {
    if (!evidence.rationaleCodes.includes(marker)) continue;
    for (const patch of evidence.semanticPatches ?? []) {
      const key = `${patch.invariantId}|${patch.parameter}`;
      const current = stats.get(key) ?? {
        success: 0,
        failure: 0,
        latestSuccessful: null,
      };
      if (evidence.outcome === "MASTERED_SUPPORT") {
        current.success += 1;
        current.latestSuccessful = patch;
      } else {
        current.failure += 1;
      }
      stats.set(key, current);
    }
  }
  return [...stats.values()]
    .filter((item) => item.success > item.failure && item.latestSuccessful !== null)
    .map((item) => structuredClone(item.latestSuccessful as PracticeSemanticPatchV1));
};

const transferSemanticPatch = (
  graph: ConstructionGraphV1,
  patch: PracticeSemanticPatchV1,
): SemanticPatchV1 | null => {
  const nodeId = graph.invariantCoverage[patch.invariantId]?.[0];
  const node = graph.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (node === undefined) return null;
  const current = node.parameters[patch.parameter];
  if (typeof current !== "number" || !Number.isFinite(current)) return null;

  const delta = patch.nextValue - patch.previousValue;
  const nextValue = Math.abs(patch.previousValue) > 1e-6
    ? current * clampRange(patch.nextValue / patch.previousValue, 0.35, 2.25)
    : current + delta;
  if (!Number.isFinite(nextValue) || Math.abs(nextValue - current) < 1e-6) return null;
  return {
    patchId: `edit-type-transfer:${patch.patchId}`,
    invariantId: patch.invariantId,
    nodeId: node.nodeId,
    parameter: patch.parameter,
    previousValue: current,
    nextValue,
    rationale: `Edit Type transfer: ${patch.rationale}`,
  };
};

const learnedGraphForWindow = (input: {
  readonly evidence: DenseEffectEvidenceV1;
  readonly family: ReturnType<typeof classifyEffectFamilyV1>;
  readonly availableCapabilities: readonly string[];
  readonly knowledge: EditTypeKnowledgeSnapshotV1;
}): Readonly<{
  graph: ConstructionGraphV1;
  patches: readonly SemanticPatchV1[];
}> | null => {
  const stored = semanticPatchesForFamily(input.knowledge, input.family);
  if (stored.length === 0) return null;

  const base = input.family === "UNKNOWN"
    ? synthesizeUnknownEffectV1({
      evidence: input.evidence,
      availableCapabilities: input.availableCapabilities,
    }).selected?.graph ?? null
    : buildConstructionGraphV1(deriveEffectAnatomyV1(input.evidence, input.family));
  if (base === null) return null;

  const patches = stored
    .map((patch) => transferSemanticPatch(base, patch))
    .filter((patch): patch is SemanticPatchV1 => patch !== null);
  if (patches.length === 0) return null;
  return {
    graph: applySemanticPatchesV1(base, patches),
    patches,
  };
};

export const comparePracticeM6AlignedWindowsV1 = (
  reference: DenseEffectSequenceV1,
  render: DenseEffectSequenceV1,
): Readonly<{
  comparisons: readonly FidelityComparisonV1[];
  definingCoverage: number;
  effectFidelity: number;
  transitionFidelity: number;
  diagnoses: readonly string[];
  evidenceRefs: readonly string[];
}> => {
  const alignment = alignDenseEffectSequencesV1(reference, render);
  const comparisons: FidelityComparisonV1[] = [];
  const diagnoses: string[] = [];
  let definingPassed = 0;
  let definingTotal = 0;

  for (const pair of alignment.pairs) {
    const referenceWindow = reference.windows[pair.referenceIndex];
    const renderWindow = render.windows[pair.renderIndex];
    if (referenceWindow === undefined || renderWindow === undefined) continue;
    const dna = dnaForEvidence(referenceWindow.evidence);
    const comparison = compareSemanticVisualFidelityV1({
      reference: referenceWindow.evidence,
      render: renderWindow.evidence,
      dna,
      alignment: "SEMANTIC",
    });
    comparisons.push(comparison);
    diagnoses.push(...comparison.diagnoses);
    for (const metric of comparison.metrics.filter((item) => item.defining)) {
      definingTotal += 1;
      if (metric.passed) definingPassed += 1;
    }
  }

  const referenceRecall = reference.windows.length === 0
    ? 0
    : alignment.pairs.length / reference.windows.length;
  const renderPrecision = render.windows.length === 0
    ? 0
    : alignment.pairs.length / render.windows.length;
  const sequenceCoverage = harmonic(referenceRecall, renderPrecision);
  const semanticSequenceScore = alignment.pairs.length === 0
    ? 0
    : clamp01(1 - mean(alignment.pairs.map((pair) => pair.semanticCost)));
  const rawDefiningCoverage = definingTotal === 0
    ? 0 : definingPassed / definingTotal;

  if (alignment.unmatchedReferenceWindowIds.length > 0) {
    diagnoses.push(
      `Unmatched reference effect windows: ${alignment.unmatchedReferenceWindowIds.join(", ")}.`,
    );
  }
  if (alignment.unmatchedRenderWindowIds.length > 0) {
    diagnoses.push(
      `Unexpected rendered effect windows: ${alignment.unmatchedRenderWindowIds.join(", ")}.`,
    );
  }

  return {
    comparisons,
    definingCoverage: clamp01(rawDefiningCoverage * referenceRecall),
    effectFidelity: clamp01(mean(
      comparisons.map((comparison) => comparison.weightedFidelity),
      0,
    ) * referenceRecall),
    transitionFidelity: clamp01(sequenceCoverage * semanticSequenceScore),
    diagnoses,
    evidenceRefs: unique([
      ...reference.evidenceRefs,
      ...render.evidenceRefs,
      ...comparisons.flatMap((comparison) => [
        `m6-reference-evidence:${comparison.referenceEvidenceKey}`,
        `m6-render-evidence:${comparison.renderEvidenceKey}`,
      ]),
    ]),
  };
};

export class PracticeM6ExecutionBridgeV1
implements Pick<PracticeHomeworkAdaptersV1, "reconstruct" | "evaluate"> {
  readonly runtime: PracticeM6RuntimeV1;
  readonly brain: PracticeM6BrainV1;
  readonly #referenceCache = new Map<string, {
    readonly evidence: DenseEffectEvidenceV1;
    readonly sequence: DenseEffectSequenceV1;
  }>();
  readonly #attemptByRenderRef = new Map<string, PracticeM6AttemptStateV1>();

  constructor(
    runtime: PracticeM6RuntimeV1,
    brain: PracticeM6BrainV1 = new VisualEffectsBrainV1(),
  ) {
    this.runtime = runtime;
    this.brain = brain;
  }

  async #referenceAnalysis(
    reference: PracticeReferenceAnalysisV1,
  ): Promise<{
    readonly evidence: DenseEffectEvidenceV1;
    readonly sequence: DenseEffectSequenceV1;
  }> {
    const cached = this.#referenceCache.get(reference.referenceId);
    if (cached !== undefined) return cached;
    const evidence = await this.runtime.analyzeReference(reference);
    if (evidence.sourceKind !== "REFERENCE") {
      throw new TypeError("Practice M6 reference analysis must return REFERENCE dense evidence.");
    }
    const sequence = detectDenseEffectWindowsV1(evidence);
    const value = { evidence, sequence };
    this.#referenceCache.set(reference.referenceId, value);
    return value;
  }

  reconstruct = async (input: {
    readonly sessionId: string;
    readonly editTypeId: string;
    readonly editTypeKnowledge: EditTypeKnowledgeSnapshotV1;
    readonly attempt: number;
    readonly reference: PracticeReferenceAnalysisV1;
    readonly baseline: PracticeContentBaselineV1;
    readonly matches: readonly PracticeSceneMatchV1[];
    readonly priorAttempts: readonly PracticeAttemptV1[];
  }): Promise<PracticeReconstructionOutputV1> => {
    const analysis = await this.#referenceAnalysis(input.reference);
    await this.runtime.prepareAttempt(input);

    const decisionTraces: PracticeDecisionTraceV1[] = [];
    const evidenceRefs: string[] = [
      ...analysis.evidence.evidenceRefs,
      ...analysis.sequence.evidenceRefs,
    ];
    const windowResults: M6ProductionResultV1[] = [];

    for (const window of analysis.sequence.windows) {
      const family = classifyEffectFamilyV1(window.evidence);
      const learned = learnedGraphForWindow({
        evidence: window.evidence,
        family,
        availableCapabilities: this.runtime.availableCapabilities,
        knowledge: input.editTypeKnowledge,
      });
      const result = await this.brain.run({
        requestId: `${input.sessionId}:attempt:${input.attempt}:${window.windowId}`,
        risk: "HIGH",
        ...(learned === null
          ? {}
          : {
            learnedTechniqueId: `edit-type:${input.editTypeId}:${family}`,
            learnedGraph: learned.graph,
          }),
        referenceEvidence: window.evidence,
        availableCapabilities: this.runtime.availableCapabilities,
        evidenceRefs: [
          ...window.evidence.evidenceRefs,
          `practice-session:${input.sessionId}`,
          `practice-attempt:${input.attempt}`,
          `practice-window:${window.windowId}`,
          `practice-edit-type:${input.editTypeId}`,
          `practice-edit-type-revision:${input.editTypeKnowledge.revision}`,
          ...(learned === null
            ? []
            : [`practice-edit-type-transferred-patches:${learned.patches.length}`]),
        ],
        applyGraph: async (graph) => this.runtime.applyWindowGraph({
          sessionId: input.sessionId,
          attempt: input.attempt,
          reference: input.reference,
          baseline: input.baseline,
          window,
          graph,
        }),
        renderWindow: async (graph) => this.runtime.renderWindowEvidence({
          sessionId: input.sessionId,
          attempt: input.attempt,
          reference: input.reference,
          baseline: input.baseline,
          window,
          graph,
        }),
      });
      windowResults.push(result);
      evidenceRefs.push(...result.evidenceRefs);
      const graphId = finalGraphId(result);
      const shotId = shotForWindow(input.reference, window);
      decisionTraces.push({
        decisionId: `${input.sessionId}:attempt:${input.attempt}:${window.windowId}`,
        ...(shotId === undefined ? {} : { shotId }),
        cueIds: [
          `effect-window:${window.windowId}`,
          `effect-family:${family}`,
        ],
        constructionIds: graphId === null ? [] : [graphId],
        rationaleCodes: [
          `M6_ROUTE_${result.route}`,
          `M6_STATUS_${result.status}`,
          `M6_FAMILY_${family}`,
          ...(learned === null ? [] : ["EDIT_TYPE_TRANSFER_APPLIED"]),
        ],
        semanticPatches: result.correction?.learnedPatches ?? [],
      });
    }

    const rendered = await this.runtime.renderFullEdit({
      sessionId: input.sessionId,
      attempt: input.attempt,
      reference: input.reference,
      baseline: input.baseline,
    });
    evidenceRefs.push(...rendered.evidenceRefs);
    this.#attemptByRenderRef.set(rendered.renderRef, {
      sessionId: input.sessionId,
      attempt: input.attempt,
      reference: input.reference,
      baseline: input.baseline,
      matches: input.matches,
      referenceEvidence: analysis.evidence,
      referenceSequence: analysis.sequence,
      windowResults,
    });

    return {
      renderRef: rendered.renderRef,
      decisionTraces,
      evidenceRefs: unique(evidenceRefs),
    };
  };

  evaluate = async (input: {
    readonly reference: PracticeReferenceAnalysisV1;
    readonly renderRef: string;
    readonly minimumSimilarity: number;
  }): Promise<PracticeSimilarityReportV1> => {
    const attempt = this.#attemptByRenderRef.get(input.renderRef);
    if (attempt === undefined || attempt.reference.referenceId !== input.reference.referenceId) {
      throw new TypeError(
        "Practice M6 evaluation requires the reconstruction state that produced the render.",
      );
    }

    const content = await this.runtime.evaluateContentStructure({
      renderRef: input.renderRef,
      reference: input.reference,
      baseline: attempt.baseline,
      matches: attempt.matches,
    });

    let effectFidelity = 0;
    let transitionFidelity = 0;
    let definingEffectCoverage = 0;
    const reasons: string[] = [];
    const evidenceRefs: string[] = [...content.evidenceRefs];

    try {
      const renderEvidence = await this.runtime.analyzeRender({
        renderRef: input.renderRef,
        reference: input.reference,
      });
      if (renderEvidence.sourceKind !== "RENDER") {
        throw new TypeError("Practice M6 render analysis must return RENDER dense evidence.");
      }
      const renderSequence = detectDenseEffectWindowsV1(renderEvidence);
      const compared = comparePracticeM6AlignedWindowsV1(
        attempt.referenceSequence,
        renderSequence,
      );
      effectFidelity = compared.effectFidelity;
      transitionFidelity = compared.transitionFidelity;
      definingEffectCoverage = compared.definingCoverage;
      reasons.push(...compared.diagnoses);
      evidenceRefs.push(...compared.evidenceRefs);
    } catch (error) {
      reasons.push(
        `M6 semantic render comparison failed closed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    for (const [index, result] of attempt.windowResults.entries()) {
      if (result.status !== "COMPLETED") {
        reasons.push(
          `Reference effect window ${index + 1} did not complete through M6: ${result.status}.`,
        );
      }
    }

    return {
      schema: "editflow.practice-similarity.v1",
      breakdown: {
        sceneIdentity: clamp01(content.sceneIdentity),
        temporalAlignment: clamp01(content.temporalAlignment),
        cutTiming: clamp01(content.cutTiming),
        framing: clamp01(content.framing),
        motion: clamp01(content.motion),
        effectFidelity,
        transitionFidelity,
        colorFinish: clamp01(content.colorFinish),
        pixelStructure: clamp01(content.pixelStructure),
      },
      definingEffectCoverage,
      wrongSceneCount: Math.max(0, Math.floor(content.wrongSceneCount)),
      unmatchedSceneCount: Math.max(0, Math.floor(content.unmatchedSceneCount)),
      overallSimilarity: 0,
      passed: false,
      reasons: unique(reasons),
      evidenceRefs: unique([
        ...attempt.referenceEvidence.evidenceRefs,
        ...attempt.referenceSequence.evidenceRefs,
        ...attempt.windowResults.flatMap((result) => result.evidenceRefs),
        ...evidenceRefs,
        `practice-target:${clamp01(input.minimumSimilarity).toFixed(6)}`,
      ]),
    };
  };
}

export const composePracticeM6ExecutionAdaptersV1 = (
  bridge: PracticeM6ExecutionBridgeV1,
  other: Pick<
    PracticeHomeworkAdaptersV1,
    "analyzeFinish" | "indexStart" | "matchScenes" | "buildContentBaseline"
  > & Partial<Pick<PracticeHomeworkAdaptersV1, "matchAudio" | "recordEpisode">>,
): PracticeHomeworkAdaptersV1 => ({
  analyzeFinish: (finish) => other.analyzeFinish(finish),
  indexStart: (start) => other.indexStart(start),
  matchScenes: (input) => other.matchScenes(input),
  ...(other.matchAudio === undefined
    ? {}
    : { matchAudio: (input) => other.matchAudio?.(input) ?? Promise.resolve(null) }),
  buildContentBaseline: (input) => other.buildContentBaseline(input),
  reconstruct: (input) => bridge.reconstruct(input),
  evaluate: (input) => bridge.evaluate(input),
  ...(other.recordEpisode === undefined
    ? {}
    : { recordEpisode: (episode) => other.recordEpisode?.(episode) ?? Promise.resolve() }),
});
