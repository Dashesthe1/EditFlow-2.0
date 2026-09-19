import type {
  AdaptiveCapabilityProposalV1,
  ConstructionGraphV1,
  DenseEffectEvidenceV1,
  EffectAnatomyComponentV1,
  EffectAnatomyV1,
  EffectInvariantV1,
  NormalizedPointV1,
  SynthesisCandidateV1,
  TransitionDnaV1,
  UnknownEffectSynthesisStrategyV1,
  UnknownEffectSynthesisV1,
  VisualDimensionV1,
} from "./contracts.js";
import { buildConstructionGraphV1, compileConstructionGraphV1 } from "./construction.js";
import { resolveFragmentationEventMetricsV1 } from "./dense-evidence.js";

const invariant = (
  id: string,
  dimension: VisualDimensionV1,
  metric: string,
  comparator: EffectInvariantV1["comparator"],
  target: EffectInvariantV1["target"],
  tolerance: number,
  defining = true,
  weight = defining ? 1 : 0.25,
  rationale = `Observed ${metric} is a material part of the unknown reference behavior.`,
): EffectInvariantV1 => ({
  invariantId: id,
  dimension,
  metric,
  comparator,
  target,
  tolerance,
  defining,
  weight,
  rationale,
});

const observedRange = (value: number, low = 0.8, high = 1.25): readonly [number, number] =>
  [Math.max(0, value * low), Math.max(0, value * high)];

const rangeInvariant = (
  id: string,
  dimension: VisualDimensionV1,
  metric: string,
  value: number,
  defining = true,
  weight = defining ? 1 : 0.25,
  tolerance = Math.max(0.005, Math.abs(value) * 0.08),
  rationale?: string,
): EffectInvariantV1 => invariant(
  id,
  dimension,
  metric,
  "RANGE",
  observedRange(value),
  tolerance,
  defining,
  weight,
  rationale,
);

const maxFrame = (evidence: DenseEffectEvidenceV1, metric: string): number => {
  const values = evidence.frames.map((frame) =>
    (frame as unknown as Readonly<Record<string, unknown>>)[metric])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length === 0 ? 0 : Math.max(...values);
};

export const decomposeUnknownEffectV1 = (evidence: DenseEffectEvidenceV1): EffectAnatomyV1 => {
  const s = evidence.summary;
  const fragmentation = resolveFragmentationEventMetricsV1(evidence);
  const defining: EffectInvariantV1[] = [];
  const optional: EffectInvariantV1[] = [];
  const observedMetrics: Record<string, number | NormalizedPointV1> = {};
  const add = (
    target: EffectInvariantV1[],
    item: EffectInvariantV1,
    observedValue: number | NormalizedPointV1,
  ): void => {
    target.push(item);
    observedMetrics[item.metric] = observedValue;
  };

  const coherentFragmentation = fragmentation.temporalStateCountPeak > 1
    && fragmentation.overlapDensityPeak >= 0.015
    && fragmentation.stateSeparationPeak >= 0.005
    && fragmentation.peak >= 0.04;

  if (coherentFragmentation) {
    add(defining, invariant(
      "unknown.fragmentation-states",
      "TEMPORAL",
      "fragmentationTemporalStateCountPeak",
      "MIN",
      fragmentation.temporalStateCountPeak,
      0,
      true,
      1,
      "Multiple temporal image states must participate in the same bounded event.",
    ), fragmentation.temporalStateCountPeak);
    add(defining, rangeInvariant(
      "unknown.fragmentation-overlap",
      "COMPOSITING",
      "fragmentationOverlapDensityPeak",
      fragmentation.overlapDensityPeak,
      true,
      1,
      Math.max(0.003, fragmentation.overlapDensityPeak * 0.08),
      "Visible temporal states must overlap at approximately the observed event-local density.",
    ), fragmentation.overlapDensityPeak);
    add(defining, rangeInvariant(
      "unknown.fragmentation-separation",
      "SPATIAL",
      "fragmentationStateSeparationPeak",
      fragmentation.stateSeparationPeak,
      true,
      1,
      Math.max(0.002, fragmentation.stateSeparationPeak * 0.08),
      "Simultaneous temporal states must retain the observed within-frame spatial separation.",
    ), fragmentation.stateSeparationPeak);
    add(defining, invariant(
      "unknown.fragmentation-coordination",
      "COMPOSITING",
      "fragmentationCoherencePeak",
      "MIN",
      fragmentation.peak * 0.75,
      Math.max(0.005, fragmentation.peak * 0.05),
      true,
      1.2,
      "Temporal states, overlap, and separation must occur as one coordinated high-frequency event.",
    ), fragmentation.peak);
    if (s.accelerationPeak > 0.02) {
      add(defining, invariant(
        "unknown.acceleration",
        "MOTION_STRUCTURE",
        "accelerationPeak",
        "MIN",
        s.accelerationPeak * 0.75,
        Math.max(0.003, s.accelerationPeak * 0.05),
        true,
        1,
        "The event requires the observed high-frequency motion impulse rather than a static layered composite.",
      ), s.accelerationPeak);
    }
    if (s.recoveryFrames > 0) {
      add(defining, invariant(
        "unknown.recovery",
        "MOTION_STRUCTURE",
        "recoveryFrames",
        "MAX",
        s.recoveryFrames,
        1,
        true,
        1,
        "The synthesized effect must converge at least as quickly as the observed reference event.",
      ), s.recoveryFrames);
    }

    if (s.temporalPersistence > 0.2) {
      add(optional, rangeInvariant("unknown.persistence", "TEMPORAL", "temporalPersistence",
        s.temporalPersistence, false), s.temporalPersistence);
    }
    if (s.scaleRange > 0.04) {
      add(optional, rangeInvariant("unknown.scale", "SPATIAL", "scaleRange",
        s.scaleRange, false), s.scaleRange);
    }
    if (s.blurPeak > 0.15) {
      add(optional, rangeInvariant("unknown.blur", "OPTICAL", "blurPeak",
        s.blurPeak, false), s.blurPeak);
    }
    if (s.distortionPeak > 0.15) {
      add(optional, rangeInvariant("unknown.distortion", "DISTORTION", "distortionPeak",
        s.distortionPeak, false), s.distortionPeak);
    }
  } else {
    if (s.temporalStateCountPeak > 1) {
      add(defining, rangeInvariant("unknown.temporal-states", "TEMPORAL", "temporalStateCountPeak",
        s.temporalStateCountPeak, true, 1, 0), s.temporalStateCountPeak);
    }
    if (s.temporalPersistence > 0.2) {
      add(defining, rangeInvariant("unknown.persistence", "TEMPORAL", "temporalPersistence",
        s.temporalPersistence), s.temporalPersistence);
    }
    if (s.displacementPeak > 0.04) {
      add(defining, rangeInvariant("unknown.displacement", "SPATIAL", "displacementPeak",
        s.displacementPeak), s.displacementPeak);
      const directionMagnitude = Math.hypot(
        s.displacementDirection.x,
        s.displacementDirection.y,
      );
      if (directionMagnitude > 1e-6) {
        add(defining, invariant(
          "unknown.displacement-direction",
          "SPATIAL",
          "displacementDirection",
          "DIRECTION",
          s.displacementDirection,
          0.1,
          true,
          0.8,
          "The synthesized spatial impulse must preserve the observed displacement direction, not only its magnitude.",
        ), s.displacementDirection);
      }
      add(defining, invariant(
        "unknown.motion-peak-phase",
        "MOTION_STRUCTURE",
        "motionPeakPhase",
        "PHASE",
        s.motionPeakPhase,
        0.12,
        true,
        0.65,
        "The displacement impulse must peak at approximately the observed phase of the effect window.",
      ), s.motionPeakPhase);
    }
    if (s.scaleRange > 0.04) {
      add(defining, rangeInvariant("unknown.scale", "SPATIAL", "scaleRange",
        s.scaleRange), s.scaleRange);
    }
    if (s.blurPeak > 0.15) {
      add(defining, rangeInvariant("unknown.blur", "OPTICAL", "blurPeak",
        s.blurPeak), s.blurPeak);
    }
    if (s.distortionPeak > 0.15) {
      add(defining, rangeInvariant("unknown.distortion", "DISTORTION", "distortionPeak",
        s.distortionPeak), s.distortionPeak);
    }
    if (s.subjectSeparationPeak > 0.15) {
      add(defining, rangeInvariant("unknown.isolation", "ISOLATION", "subjectSeparationPeak",
        s.subjectSeparationPeak), s.subjectSeparationPeak);
    }
    if (s.overlapDensityPeak > 0.12) {
      add(defining, rangeInvariant("unknown.overlap", "COMPOSITING", "overlapDensityPeak",
        s.overlapDensityPeak), s.overlapDensityPeak);
    }
    if (s.occlusionPeak > 0.18) {
      add(defining, rangeInvariant("unknown.occlusion", "COMPOSITING", "occlusionPeak",
        s.occlusionPeak), s.occlusionPeak);
    }
    if (s.accelerationPeak > 0.025) {
      add(defining, invariant(
        "unknown.acceleration",
        "MOTION_STRUCTURE",
        "accelerationPeak",
        "MIN",
        s.accelerationPeak * 0.75,
        Math.max(0.003, s.accelerationPeak * 0.05),
      ), s.accelerationPeak);
    }
  }

  const chroma = maxFrame(evidence, "chromaticSeparation");
  if (chroma > 0.1) {
    const target = coherentFragmentation ? optional : defining;
    add(target, rangeInvariant("unknown.chroma", "OPTICAL", "chromaticSeparationPeak",
      chroma, !coherentFragmentation), chroma);
  }
  const mask = maxFrame(evidence, "maskCoverage");
  if (mask > 0.06) {
    const target = coherentFragmentation ? optional : defining;
    add(target, rangeInvariant("unknown.mask", "ISOLATION", "maskCoveragePeak",
      mask, !coherentFragmentation), mask);
  }
  if (defining.length === 0) {
    const motion = Math.max(0.05, s.motionEnergyPeak);
    add(defining, rangeInvariant("unknown.motion", "MOTION_STRUCTURE", "motionEnergyPeak",
      motion), motion);
  }

  const dna: TransitionDnaV1 = {
    schema: "editflow.transition-dna.v1",
    dnaId: `dna:unknown:${evidence.contentKey.slice(0, 12)}`,
    family: "UNKNOWN",
    definingInvariants: defining,
    optionalInvariants: optional,
    activationConditions: [
      "No learned family is allowed to supply the effect identity; synthesis begins from observed visual behavior.",
    ],
    restraintConditions: [
      "Do not substitute the nearest named transition.",
      "Do not promote incidental source-content maxima over a coordinated event-local effect signature.",
    ],
    adaptableVariables: ["subject", "velocity", "frameRate", "duration", "beat", "composition", "intensity"],
    evidenceRefs: evidence.evidenceRefs,
  };
  const allInvariants = [...defining, ...optional];
  const components: EffectAnatomyComponentV1[] = allInvariants.map((item) => ({
    componentId: `component:${item.invariantId}`,
    dimension: item.dimension,
    role: item.rationale,
    defining: item.defining,
    evidenceMetrics: [item.metric],
    evidenceRefs: evidence.evidenceRefs,
  }));
  return {
    schema: "editflow.effect-anatomy.v1",
    anatomyId: `anatomy:unknown:${evidence.contentKey.slice(0, 12)}`,
    family: "UNKNOWN",
    components,
    dna,
    observedMetrics,
    confidence: Math.min(1, defining.length / 4),
    evidenceRefs: evidence.evidenceRefs,
  };
};

const PROPOSABLE_NATIVE_EFFECTS: Readonly<Record<string, Readonly<{
  nativeEffect: string;
  rationale: string;
}>>> = {
  "ae.effect.echo": {
    nativeEffect: "Echo",
    rationale: "Native Echo can combine multiple source times and control temporal spacing/intensity when a temporal-state hypothesis needs an alternate implementation.",
  },
  "ae.effect.time-displacement": {
    nativeEffect: "Time Displacement",
    rationale: "Native Time Displacement can create spatially varying temporal offsets from a map when layer-wide offsets cannot reproduce the observed temporal field.",
  },
  "ae.effect.turbulent-displace": {
    nativeEffect: "Turbulent Displace",
    rationale: "Native Turbulent Displace can provide a procedural warp hypothesis when a displacement-map construction cannot reproduce the observed deformation.",
  },
};

const strategyGraph = (
  base: ConstructionGraphV1,
  strategy: UnknownEffectSynthesisStrategyV1,
): ConstructionGraphV1 | null => {
  if (strategy === "LAYERED_PRIMITIVES") return base;
  let changed = false;
  const nodes = base.nodes.map((node) => {
    if (strategy === "NATIVE_ECHO_HYBRID"
      && node.kind === "TEMPORAL_DUPLICATES"
      && node.dimension === "TEMPORAL") {
      changed = true;
      return {
        ...node,
        capabilityCandidates: ["ae.effect.echo"],
        parameters: { ...node.parameters, synthesisStrategy: "NATIVE_ECHO_HYBRID" },
      };
    }
    if (strategy === "TIME_DISPLACEMENT_HYBRID"
      && node.kind === "TEMPORAL_DUPLICATES"
      && (node.dimension === "TEMPORAL" || node.dimension === "SPATIAL")) {
      changed = true;
      return {
        ...node,
        capabilityCandidates: ["ae.effect.time-displacement"],
        parameters: { ...node.parameters, synthesisStrategy: "TIME_DISPLACEMENT_HYBRID" },
      };
    }
    if (strategy === "TURBULENT_DISPLACE_HYBRID" && node.kind === "DISTORTION") {
      changed = true;
      return {
        ...node,
        capabilityCandidates: ["ae.effect.turbulent-displace"],
        parameters: { ...node.parameters, synthesisStrategy: "TURBULENT_DISPLACE_HYBRID" },
      };
    }
    return node;
  });
  return changed
    ? { ...base, graphId: `${base.graphId}:${strategy.toLowerCase()}`, nodes }
    : null;
};

const adaptiveCapabilityProposals = (
  graph: ConstructionGraphV1,
  capabilityGaps: readonly string[],
): readonly AdaptiveCapabilityProposalV1[] => {
  const gaps = new Set(capabilityGaps);
  return Object.entries(PROPOSABLE_NATIVE_EFFECTS)
    .filter(([capabilityId]) => gaps.has(capabilityId))
    .map(([capabilityId, proposal]) => ({
      capabilityId,
      nativeEffect: proposal.nativeEffect,
      invariantIds: [...new Set(graph.nodes
        .filter((node) => !node.optional && node.capabilityCandidates.includes(capabilityId))
        .flatMap((node) => node.requiredInvariantIds))],
      proofRequirement: "REAL_AE_RENDER" as const,
      rationale: proposal.rationale,
    }));
};

const candidate = (
  id: string,
  strategy: UnknownEffectSynthesisStrategyV1,
  graph: ConstructionGraphV1,
  definingCount: number,
  availableCapabilities: readonly string[],
  complexityPenalty: number,
): SynthesisCandidateV1 => {
  const compilation = compileConstructionGraphV1(graph, availableCapabilities);
  const covered = definingCount - graph.missingInvariantIds.length;
  const definingCoverage = definingCount === 0 ? 0 : covered / definingCount;
  const complexity = graph.nodes.length + complexityPenalty;
  const gapPenalty = compilation.capabilityGaps.length * 0.22;
  const proposals = adaptiveCapabilityProposals(graph, compilation.capabilityGaps);
  return {
    candidateId: id,
    strategy,
    graph,
    definingCoverage,
    complexity,
    capabilityGaps: compilation.capabilityGaps,
    adaptiveCapabilityProposals: proposals,
    score: definingCoverage - gapPenalty - complexity * 0.01 - proposals.length * 0.03,
  };
};

export const synthesizeUnknownEffectV1 = (input: {
  readonly evidence: DenseEffectEvidenceV1;
  readonly availableCapabilities: readonly string[];
}): UnknownEffectSynthesisV1 => {
  const anatomy = decomposeUnknownEffectV1(input.evidence);
  const base = buildConstructionGraphV1(anatomy);
  const definingCount = anatomy.dna.definingInvariants.length;
  const strategies: readonly Readonly<{
    strategy: UnknownEffectSynthesisStrategyV1;
    id: string;
    complexityPenalty: number;
  }>[] = [
    { strategy: "LAYERED_PRIMITIVES", id: "adaptive:layered-primitives", complexityPenalty: 0 },
    { strategy: "NATIVE_ECHO_HYBRID", id: "adaptive:native-echo-hybrid", complexityPenalty: 1.5 },
    { strategy: "TIME_DISPLACEMENT_HYBRID", id: "adaptive:time-displacement-hybrid", complexityPenalty: 2 },
    { strategy: "TURBULENT_DISPLACE_HYBRID", id: "adaptive:turbulent-displace-hybrid", complexityPenalty: 1.5 },
  ];
  const candidates = strategies.flatMap((item) => {
    const graph = strategyGraph(base, item.strategy);
    return graph === null ? [] : [
      candidate(
        item.id,
        item.strategy,
        graph,
        definingCount,
        input.availableCapabilities,
        item.complexityPenalty,
      ),
    ];
  }).sort((a, b) => b.score - a.score || a.candidateId.localeCompare(b.candidateId));
  const selected = candidates.find((item) =>
    item.definingCoverage === 1 && item.capabilityGaps.length === 0) ?? null;
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
