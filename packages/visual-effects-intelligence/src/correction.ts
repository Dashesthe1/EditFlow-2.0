import type {
  ConstructionGraphV1,
  CorrectionLoopResultV1,
  EffectInvariantV1,
  FidelityComparisonV1,
  SemanticPatchV1,
  TransitionDnaV1,
  DenseEffectEvidenceV1,
} from "./contracts.js";
import { compileConstructionGraphV1 } from "./construction.js";
import { compareSemanticVisualFidelityV1, evaluateProfessionalFidelityGateV1 } from "./fidelity.js";

const invariantMap = (dna: TransitionDnaV1): ReadonlyMap<string, EffectInvariantV1> =>
  new Map([...dna.definingInvariants, ...dna.optionalInvariants].map((item) => [item.invariantId, item] as const));

const numeric = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const patchValue = (
  prior: number,
  invariant: EffectInvariantV1,
  comparison: FidelityComparisonV1["metrics"][number],
): number => {
  const reference = numeric(comparison.referenceValue);
  const render = numeric(comparison.renderValue);
  if (reference === null || render === null) return prior;
  if (invariant.comparator === "MAX") return Math.max(0, prior * Math.max(0.5, 1 - comparison.normalizedError * 0.6));
  if (invariant.comparator === "PHASE") return prior + (reference - render) * 0.65;
  const ratio = render <= 1e-6 ? 1.75 : Math.min(1.75, Math.max(0.6, reference / render));
  return prior * (1 + ((ratio - 1) * 0.65));
};

export const proposeSemanticPatchesV1 = (
  graph: ConstructionGraphV1,
  dna: TransitionDnaV1,
  comparison: FidelityComparisonV1,
  iteration: number,
): readonly SemanticPatchV1[] => {
  const invariants = invariantMap(dna);
  const patches: SemanticPatchV1[] = [];
  for (const failure of comparison.metrics.filter((metric) => !metric.passed)) {
    const invariant = invariants.get(failure.invariantId);
    const nodeId = graph.invariantCoverage[failure.invariantId]?.[0];
    const node = graph.nodes.find((candidate) => candidate.nodeId === nodeId);
    if (invariant === undefined || node === undefined) continue;
    const prior = numeric(node.parameters[invariant.metric]);
    if (prior === null) continue;
    const next = patchValue(prior, invariant, failure);
    if (Math.abs(next - prior) < 1e-6) continue;
    patches.push({
      patchId: `patch:${iteration}:${failure.invariantId}`,
      invariantId: failure.invariantId,
      nodeId: node.nodeId,
      parameter: invariant.metric,
      previousValue: prior,
      nextValue: next,
      rationale: failure.diagnosis,
    });
  }
  return patches;
};

export const applySemanticPatchesV1 = (
  graph: ConstructionGraphV1,
  patches: readonly SemanticPatchV1[],
): ConstructionGraphV1 => ({
  ...graph,
  nodes: graph.nodes.map((node) => {
    const nodePatches = patches.filter((patch) => patch.nodeId === node.nodeId);
    if (nodePatches.length === 0) return node;
    const parameters = { ...node.parameters };
    for (const patch of nodePatches) parameters[patch.parameter] = patch.nextValue;
    return { ...node, parameters };
  }),
});

export interface AutomaticCorrectionInputV1 {
  readonly reference: DenseEffectEvidenceV1;
  readonly dna: TransitionDnaV1;
  readonly initialGraph: ConstructionGraphV1;
  readonly availableCapabilities: readonly string[];
  readonly applyGraph: (graph: ConstructionGraphV1) => Promise<void>;
  readonly renderLocalWindow: (graph: ConstructionGraphV1) => Promise<DenseEffectEvidenceV1>;
  readonly maxIterations?: number;
  readonly minimumImprovement?: number;
}

export const runAutomaticVisualCorrectionLoopV1 = async (
  input: AutomaticCorrectionInputV1,
): Promise<CorrectionLoopResultV1> => {
  const maxIterations = Math.max(1, Math.min(5, input.maxIterations ?? 3));
  const minimumImprovement = input.minimumImprovement ?? 0.015;
  const passes: CorrectionLoopResultV1["passes"][number][] = [];
  const learnedPatches: SemanticPatchV1[] = [];
  let graph = input.initialGraph;
  let priorFidelity = -1;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const compilation = compileConstructionGraphV1(graph, input.availableCapabilities);
    if (compilation.recipe === null) {
      const emptyComparison: FidelityComparisonV1 = {
        schema: "editflow.semantic-fidelity-comparison.v1",
        family: input.dna.family,
        alignment: "SEMANTIC",
        metrics: [],
        definingCoverage: 0,
        weightedFidelity: 0,
        passed: false,
        diagnoses: compilation.capabilityGaps,
        referenceEvidenceKey: input.reference.contentKey,
        renderEvidenceKey: "not-rendered",
      };
      const gate = evaluateProfessionalFidelityGateV1({
        comparison: emptyComparison,
        compilation,
        synthesisPossible: false,
      });
      passes.push({ iteration, comparison: emptyComparison, gate, patches: [] });
      return {
        schema: "editflow.visual-correction-loop.v1",
        status: "CAPABILITY_GAP",
        graph,
        passes,
        learnedPatches,
      };
    }

    await input.applyGraph(graph);
    const render = await input.renderLocalWindow(graph);
    const comparison = compareSemanticVisualFidelityV1({
      reference: input.reference,
      render,
      dna: input.dna,
      alignment: "SEMANTIC",
    });
    const gate = evaluateProfessionalFidelityGateV1({ comparison, compilation, synthesisPossible: true });
    if (gate.certified) {
      passes.push({ iteration, comparison, gate, patches: [] });
      return {
        schema: "editflow.visual-correction-loop.v1",
        status: "PASSED",
        graph,
        passes,
        learnedPatches,
      };
    }
    const patches = proposeSemanticPatchesV1(graph, input.dna, comparison, iteration);
    passes.push({ iteration, comparison, gate, patches });
    if (patches.length === 0 || (priorFidelity >= 0
      && comparison.weightedFidelity - priorFidelity < minimumImprovement)) {
      return {
        schema: "editflow.visual-correction-loop.v1",
        status: "STALLED",
        graph,
        passes,
        learnedPatches,
      };
    }
    learnedPatches.push(...patches);
    graph = applySemanticPatchesV1(graph, patches);
    priorFidelity = comparison.weightedFidelity;
  }
  return {
    schema: "editflow.visual-correction-loop.v1",
    status: "ITERATION_LIMIT",
    graph,
    passes,
    learnedPatches,
  };
};
