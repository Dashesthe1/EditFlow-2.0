import type {
  DenseEffectEvidenceV1,
  EffectAnatomyComponentV1,
  EffectAnatomyV1,
  EffectInvariantV1,
  SynthesisCandidateV1,
  TransitionDnaV1,
  UnknownEffectSynthesisV1,
  VisualDimensionV1,
} from "./contracts.js";
import { buildConstructionGraphV1, compileConstructionGraphV1 } from "./construction.js";

const inv = (
  id: string,
  dimension: VisualDimensionV1,
  metric: string,
  target: number,
  tolerance = 0.12,
): EffectInvariantV1 => ({
  invariantId: id,
  dimension,
  metric,
  comparator: "MIN",
  target,
  tolerance,
  defining: true,
  weight: 1,
  rationale: `Observed ${metric} is a material part of the unknown reference behavior.`,
});

const maxFrame = (evidence: DenseEffectEvidenceV1, metric: string): number => {
  const values = evidence.frames.map((frame) =>
    (frame as unknown as Readonly<Record<string, unknown>>)[metric])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length === 0 ? 0 : Math.max(...values);
};

export const decomposeUnknownEffectV1 = (evidence: DenseEffectEvidenceV1): EffectAnatomyV1 => {
  const s = evidence.summary;
  const invariants: EffectInvariantV1[] = [];
  if (s.temporalStateCountPeak > 1) invariants.push(inv("unknown.temporal-states", "TEMPORAL", "temporalStateCountPeak", s.temporalStateCountPeak, 0));
  if (s.temporalPersistence > 0.2) invariants.push(inv("unknown.persistence", "TEMPORAL", "temporalPersistence", s.temporalPersistence));
  if (s.displacementPeak > 0.04) invariants.push(inv("unknown.displacement", "SPATIAL", "displacementPeak", s.displacementPeak));
  if (s.scaleRange > 0.04) invariants.push(inv("unknown.scale", "SPATIAL", "scaleRange", s.scaleRange));
  if (s.blurPeak > 0.15) invariants.push(inv("unknown.blur", "OPTICAL", "blurPeak", s.blurPeak));
  if (s.distortionPeak > 0.15) invariants.push(inv("unknown.distortion", "DISTORTION", "distortionPeak", s.distortionPeak));
  if (s.subjectSeparationPeak > 0.15) invariants.push(inv("unknown.isolation", "ISOLATION", "subjectSeparationPeak", s.subjectSeparationPeak));
  if (s.overlapDensityPeak > 0.12) invariants.push(inv("unknown.overlap", "COMPOSITING", "overlapDensityPeak", s.overlapDensityPeak));
  if (s.occlusionPeak > 0.18) invariants.push(inv("unknown.occlusion", "COMPOSITING", "occlusionPeak", s.occlusionPeak));
  if (s.accelerationPeak > 0.025) invariants.push(inv("unknown.acceleration", "MOTION_STRUCTURE", "accelerationPeak", s.accelerationPeak));
  const chroma = maxFrame(evidence, "chromaticSeparation");
  if (chroma > 0.1) invariants.push(inv("unknown.chroma", "OPTICAL", "chromaticSeparationPeak", chroma));
  const mask = maxFrame(evidence, "maskCoverage");
  if (mask > 0.06) invariants.push(inv("unknown.mask", "ISOLATION", "maskCoveragePeak", mask));
  if (invariants.length === 0) {
    invariants.push(inv("unknown.motion", "MOTION_STRUCTURE", "motionEnergyPeak", Math.max(0.05, s.motionEnergyPeak)));
  }
  const dna: TransitionDnaV1 = {
    schema: "editflow.transition-dna.v1",
    dnaId: `dna:unknown:${evidence.contentKey.slice(0, 12)}`,
    family: "UNKNOWN",
    definingInvariants: invariants,
    optionalInvariants: [],
    activationConditions: ["No learned family satisfies the observed defining behavior."],
    restraintConditions: ["Do not substitute the nearest named transition."],
    adaptableVariables: ["subject", "velocity", "frameRate", "duration", "beat", "composition", "intensity"],
    evidenceRefs: evidence.evidenceRefs,
  };
  const components: EffectAnatomyComponentV1[] = invariants.map((item) => ({
    componentId: `component:${item.invariantId}`,
    dimension: item.dimension,
    role: item.rationale,
    defining: true,
    evidenceMetrics: [item.metric],
    evidenceRefs: evidence.evidenceRefs,
  }));
  const observedMetrics: Record<string, number> = {};
  for (const item of invariants) {
    if (typeof item.target === "number") observedMetrics[item.metric] = item.target;
  }
  return {
    schema: "editflow.effect-anatomy.v1",
    anatomyId: `anatomy:unknown:${evidence.contentKey.slice(0, 12)}`,
    family: "UNKNOWN",
    components,
    dna,
    observedMetrics,
    confidence: Math.min(1, invariants.length / 4),
    evidenceRefs: evidence.evidenceRefs,
  };
};

const candidate = (
  id: string,
  anatomy: EffectAnatomyV1,
  availableCapabilities: readonly string[],
  complexityPenalty: number,
): SynthesisCandidateV1 => {
  const graph = buildConstructionGraphV1(anatomy);
  const compilation = compileConstructionGraphV1(graph, availableCapabilities);
  const definingCount = anatomy.dna.definingInvariants.length;
  const covered = definingCount - graph.missingInvariantIds.length;
  const definingCoverage = definingCount === 0 ? 0 : covered / definingCount;
  const complexity = graph.nodes.length + complexityPenalty;
  const gapPenalty = compilation.capabilityGaps.length * 0.22;
  return {
    candidateId: id,
    graph,
    definingCoverage,
    complexity,
    capabilityGaps: compilation.capabilityGaps,
    score: definingCoverage - gapPenalty - complexity * 0.01,
  };
};

export const synthesizeUnknownEffectV1 = (input: {
  readonly evidence: DenseEffectEvidenceV1;
  readonly availableCapabilities: readonly string[];
}): UnknownEffectSynthesisV1 => {
  const anatomy = decomposeUnknownEffectV1(input.evidence);
  const candidates = [
    candidate("adaptive:balanced", anatomy, input.availableCapabilities, 0),
    candidate("adaptive:fidelity-first", anatomy, input.availableCapabilities, 2),
    candidate("adaptive:minimal-safe", anatomy, input.availableCapabilities, -1),
  ].sort((a, b) => b.score - a.score);
  const selected = candidates.find((item) => item.definingCoverage === 1 && item.capabilityGaps.length === 0) ?? null;
  return {
    schema: "editflow.unknown-effect-synthesis.v1",
    status: selected === null ? "CAPABILITY_GAP" : "READY_FOR_PROOF",
    selected,
    candidates,
    provenance: [input.evidence.contentKey, ...input.evidence.evidenceRefs],
    gapReasons: selected === null
      ? [...new Set(candidates.flatMap((item) => item.capabilityGaps))]
      : [],
  };
};

export class SynthesizedEffectMemoryV1 {
  readonly #entries = new Map<string, UnknownEffectSynthesisV1>();

  constructor(snapshot: Readonly<Record<string, UnknownEffectSynthesisV1>> = {}) {
    for (const [key, synthesis] of Object.entries(snapshot)) {
      if (key.trim().length > 0 && synthesis.status === "READY_FOR_PROOF" && synthesis.selected !== null) {
        this.#entries.set(key, structuredClone(synthesis));
      }
    }
  }

  remember(key: string, synthesis: UnknownEffectSynthesisV1, proofPassed: boolean): boolean {
    if (!proofPassed || synthesis.status !== "READY_FOR_PROOF" || synthesis.selected === null) return false;
    this.#entries.set(key, structuredClone(synthesis));
    return true;
  }

  recall(key: string): UnknownEffectSynthesisV1 | null {
    const value = this.#entries.get(key);
    return value === undefined ? null : structuredClone(value);
  }

  snapshot(): Readonly<Record<string, UnknownEffectSynthesisV1>> {
    return Object.fromEntries([...this.#entries].map(([key, synthesis]) =>
      [key, structuredClone(synthesis)]));
  }
}
