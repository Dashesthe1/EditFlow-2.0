import type {
  AdaptiveCapabilityProposalV1,
  ConstructionGraphV1,
  ConstructionNodeKindV1,
  ConstructionNodeV1,
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
import { measureFragmentationEventProminenceV1, resolveFragmentationEventMetricsV1 } from "./dense-evidence.js";

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

const eventLocalMetricContrast = (
  evidence: DenseEffectEvidenceV1,
  metric: string,
  eventPhase: number,
): Readonly<{ nearMean: number; farMean: number; delta: number; absoluteDelta: number }> => {
  const denominator = Math.max(1, evidence.frames.length - 1);
  const samples = evidence.frames.flatMap((frame, index) => {
    const value = (frame as unknown as Readonly<Record<string, unknown>>)[metric];
    return typeof value === "number" && Number.isFinite(value)
      ? [{ phase: index / denominator, value }]
      : [];
  });
  const mean = (values: readonly number[]): number =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  const near = samples
    .filter((sample) => Math.abs(sample.phase - eventPhase) <= 0.12)
    .map((sample) => sample.value);
  const far = samples
    .filter((sample) => Math.abs(sample.phase - eventPhase) >= 0.22)
    .map((sample) => sample.value);
  const nearMean = mean(near);
  const farMean = mean(far);
  const delta = nearMean - farMean;
  return { nearMean, farMean, delta, absoluteDelta: Math.abs(delta) };
};

export const decomposeUnknownEffectV1 = (evidence: DenseEffectEvidenceV1): EffectAnatomyV1 => {
  const s = evidence.summary;
  const fragmentation = resolveFragmentationEventMetricsV1(evidence);
  const fragmentationProminence = measureFragmentationEventProminenceV1(evidence, fragmentation.phase);
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
    && fragmentationProminence.localized
    && fragmentation.overlapDensityPeak >= 0.015
    && fragmentation.stateSeparationPeak >= 0.005
    && fragmentation.peak >= 0.04;
  if (fragmentationProminence.applicable) {
    observedMetrics.fragmentationEventProminence = fragmentationProminence.delta;
  }
  observedMetrics.effectEventPhase = coherentFragmentation
    ? fragmentation.phase
    : (s.accelerationPeak > 0.025 || s.displacementPeak > 0.04 || s.scaleRange > 0.04
      ? s.motionPeakPhase
      : s.opticalPeakPhase);
  const analysisDurationMs = evidence.range.endMs - evidence.range.startMs;
  if (Number.isFinite(analysisDurationMs) && analysisDurationMs > 0) {
    observedMetrics.effectAnalysisDurationMs = analysisDurationMs;
  }
  if (Number.isFinite(s.frameIntervalMs) && s.frameIntervalMs > 0) {
    observedMetrics.referenceFrameIntervalMs = s.frameIntervalMs;
    if (Number.isFinite(s.recoveryFrames) && s.recoveryFrames > 0) {
      observedMetrics.effectRecoveryDurationMs = s.recoveryFrames * s.frameIntervalMs;
    }
  }

  // A coherent fragmentation signature does not automatically make every other
  // visual system decorative. Professional compound transitions often coordinate
  // a zoom, blur, exposure/chroma accent, or deformation with the temporal event.
  // Use event-local contrast against the same window's outer frames to distinguish
  // coordinated effect behavior from large source-content maxima.
  const coordinated = coherentFragmentation ? {
    scale: eventLocalMetricContrast(evidence, "scale", fragmentation.phase),
    blur: eventLocalMetricContrast(evidence, "blurStrength", fragmentation.phase),
    distortion: eventLocalMetricContrast(evidence, "distortionStrength", fragmentation.phase),
    chroma: eventLocalMetricContrast(evidence, "chromaticSeparation", fragmentation.phase),
    exposure: eventLocalMetricContrast(evidence, "exposure", fragmentation.phase),
  } : null;

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
      const eventCoordinated = coordinated !== null
        && coordinated.scale.absoluteDelta >= Math.max(0.025, s.scaleRange * 0.22);
      add(eventCoordinated ? defining : optional, rangeInvariant(
        "unknown.scale",
        "SPATIAL",
        "scaleRange",
        s.scaleRange,
        eventCoordinated,
        eventCoordinated ? 1 : 0.25,
        Math.max(0.005, Math.abs(s.scaleRange) * 0.08),
        eventCoordinated
          ? "Scale excursion is coordinated with the fragmentation event and is defining, not decorative."
          : undefined,
      ), s.scaleRange);
    }
    if (s.blurPeak > 0.15) {
      const eventCoordinated = coordinated !== null
        && coordinated.blur.delta >= Math.max(0.08, s.blurPeak * 0.2);
      add(eventCoordinated ? defining : optional, rangeInvariant(
        "unknown.blur",
        "OPTICAL",
        "blurPeak",
        s.blurPeak,
        eventCoordinated,
        eventCoordinated ? 1 : 0.25,
        Math.max(0.005, Math.abs(s.blurPeak) * 0.08),
        eventCoordinated
          ? "Optical blur rises with the fragmentation event and must survive synthesis."
          : undefined,
      ), s.blurPeak);
    }
    if (s.distortionPeak > 0.15) {
      const eventCoordinated = coordinated !== null
        && coordinated.distortion.delta >= Math.max(0.03, s.distortionPeak * 0.18);
      add(eventCoordinated ? defining : optional, rangeInvariant(
        "unknown.distortion",
        "DISTORTION",
        "distortionPeak",
        s.distortionPeak,
        eventCoordinated,
        eventCoordinated ? 1 : 0.25,
        Math.max(0.005, Math.abs(s.distortionPeak) * 0.08),
        eventCoordinated
          ? "Deformation strengthens inside the fragmentation event and is part of the compound identity."
          : undefined,
      ), s.distortionPeak);
    }
    if (s.exposurePeak > 0.15 && coordinated !== null
      && coordinated.exposure.delta >= Math.max(0.08, s.exposurePeak * 0.15)) {
      add(defining, rangeInvariant(
        "unknown.exposure",
        "OPTICAL",
        "exposurePeak",
        s.exposurePeak,
        true,
        0.8,
        Math.max(0.01, Math.abs(s.exposurePeak) * 0.1),
        "Exposure energy is event-local and participates in the compound transition.",
      ), s.exposurePeak);
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
    const eventCoordinated = coherentFragmentation && coordinated !== null
      && coordinated.chroma.delta >= Math.max(0.025, chroma * 0.2);
    const isDefining = !coherentFragmentation || eventCoordinated;
    add(isDefining ? defining : optional, rangeInvariant(
      "unknown.chroma",
      "OPTICAL",
      "chromaticSeparationPeak",
      chroma,
      isDefining,
      isDefining ? 1 : 0.25,
      Math.max(0.005, Math.abs(chroma) * 0.08),
      eventCoordinated
        ? "Chromatic separation rises inside the fragmentation event and is part of the compound identity."
        : undefined,
    ), chroma);
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

const finiteNodeParameter = (
  node: ConstructionGraphV1["nodes"][number],
  name: string,
): number | null => {
  const value = node.parameters[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const echoProofParameters = (
  node: ConstructionGraphV1["nodes"][number],
): Readonly<Record<string, number | string | boolean>> => {
  const measuredStates = finiteNodeParameter(node, "temporalStateCountPeak")
    ?? finiteNodeParameter(node, "fragmentationTemporalStateCountPeak")
    ?? 2;
  const stateCount = Math.max(2, Math.min(12, Math.round(measuredStates)));
  // AE's Number of Echoes excludes the current frame: N echoes produce N + 1
  // combined temporal states. Keep the semantic M6 state count reference-relative.
  const numberOfEchoes = Math.max(1, stateCount - 1);
  const recoveryFrames = finiteNodeParameter(node, "effectRecoveryFrames")
    ?? finiteNodeParameter(node, "recoveryFrames")
    ?? stateCount;
  const persistence = finiteNodeParameter(node, "temporalPersistence") ?? 0.5;
  const overlap = finiteNodeParameter(node, "fragmentationOverlapDensityPeak")
    ?? finiteNodeParameter(node, "overlapDensityPeak")
    ?? 0.5;
  // Convert observed temporal persistence + event-local overlap into Echo's
  // intensity envelope. This stays reference-relative: dense references retain
  // older states more strongly, while sparse references decay them faster.
  const startingIntensity = 0.5 + (overlap * 0.35) + (persistence * 0.2);
  const decay = 0.3 + (overlap * 0.4) + (persistence * 0.35);
  return {
    effectSchemaRef: "ae.effect-schema.m6.echo.v1",
    // Echo is a transition behavior, not a shot-wide treatment. Route it through
    // the Recipe Compiler's bounded accent-layer path so temporal states exist
    // only around the measured event window.
    eventLocalEffect: true,
    echoSpacingFrames: Math.max(1, Math.min(6, recoveryFrames / numberOfEchoes)),
    numberOfEchoes,
    startingIntensity: Math.max(0.35, Math.min(1, startingIntensity)),
    decay: Math.max(0.1, Math.min(0.95, decay)),
  };
};

const turbulentDisplaceProofParameters = (
  node: ConstructionGraphV1["nodes"][number],
): Readonly<Record<string, number | string | boolean>> => {
  const distortion = Math.max(0, Math.min(1,
    finiteNodeParameter(node, "distortionPeak") ?? 0.2));
  return {
    effectSchemaRef: "ae.effect-schema.m6.turbulent-displace.v2",
    // Map normalized measured deformation to AE's native Amount/Size/detail controls.
    // Evolution is retained as an independent, bounded pattern-state actuator so
    // rendered search can change the turbulence field without misusing Complexity
    // as a magnitude control. Rendered comparison remains authoritative.
    distortionAmount: Math.max(20, Math.min(100, 20 + distortion * 120)),
    distortionSize: Math.max(10, Math.min(48, 10 + distortion * 35)),
    distortionComplexity: Math.max(1.5, Math.min(4, 1.5 + distortion * 3)),
    distortionEvolution: Math.max(45, Math.min(270, 45 + distortion * 225)),
    eventLocalEffect: true,
  };
};

const evolvingTurbulentProofParameters = (
  node: ConstructionGraphV1["nodes"][number],
): Readonly<Record<string, number | string | boolean>> => {
  const distortion = Math.max(0, Math.min(1,
    finiteNodeParameter(node, "distortionPeak") ?? 0.2));
  const base = turbulentDisplaceProofParameters(node);
  return {
    ...base,
    effectSchemaRef: "ae.effect-schema.m6.turbulent-displace.v3",
    eventDynamicDistortion: true,
    // Static scalar search plateaued in real AE for the retained compound proof.
    // v3 therefore adds event-local deformation energy without rewriting the
    // retained v2 construction: Amount pulses around the event while Evolution
    // traverses a bounded pattern sweep. Both remain reference-relative.
    eventAmountPulseScale: Math.max(1.2, Math.min(2.25, 1.15 + distortion * 1.8)),
    eventEvolutionSweepDegrees: Math.max(180, Math.min(720, 180 + distortion * 720)),
    eventEvolutionSweepScale: 1,
    // Keep v3's prior linear sweep as the exact default while exposing an
    // independent timing-shape actuator. Values > 1 concentrate more of the
    // same total Evolution travel near the end of the event; they do not add
    // deformation magnitude or change the reference-derived sweep distance.
    eventEvolutionSharpnessScale: 1,
  };
};

const echoStrategyGraph = (
  base: ConstructionGraphV1,
): ConstructionGraphV1 | null => {
  const temporal = base.nodes.find((node) =>
    node.kind === "TEMPORAL_DUPLICATES" && node.dimension === "TEMPORAL");
  if (temporal === undefined) return null;

  const echoTemporal: ConstructionNodeV1 = {
    ...temporal,
    capabilityCandidates: ["ae.effect.echo"],
    parameters: {
      ...temporal.parameters,
      synthesisStrategy: "NATIVE_ECHO_HYBRID",
      ...echoProofParameters(temporal),
    },
  };

  // Echo can combine source-time motion directly. A separate precompose boundary is
  // required only when the graph also contains event-local transform/recovery motion:
  // AE evaluates layer transforms after effects, so outer-layer motion is otherwise
  // invisible to Echo. The nested boundary moves that motion into Echo's input history.
  const recovery = base.nodes.find((node) => node.kind === "RECOVERY" && !node.optional);
  if (recovery === undefined) {
    return {
      ...base,
      graphId: `${base.graphId}:native_echo_hybrid`,
      nodes: base.nodes.map((node) => node.nodeId === temporal.nodeId ? echoTemporal : node),
    };
  }

  const transform = base.nodes.find((node) =>
    node.kind === "TRANSFORM_MOTION" && node.dependsOn.includes(recovery.nodeId));
  const precomposeNodeId = `${temporal.nodeId}:echo-history-precompose`;
  const innerTailId = transform?.nodeId ?? recovery.nodeId;
  const precompose: ConstructionNodeV1 = {
    nodeId: precomposeNodeId,
    kind: "PRECOMPOSE_BOUNDARY",
    dimension: "COMPOSITING",
    dependsOn: [innerTailId],
    requiredInvariantIds: temporal.requiredInvariantIds,
    capabilityCandidates: ["ae.precompose.layers"],
    parameters: {
      causalBoundary: "ECHO_TRANSFORM_HISTORY",
    },
    optional: false,
  };

  const nodes = base.nodes.map((node): ConstructionNodeV1 => {
    if (node.nodeId === temporal.nodeId) {
      return { ...echoTemporal, dependsOn: [precomposeNodeId] };
    }
    if (node.nodeId === recovery.nodeId) {
      return {
        ...node,
        dependsOn: temporal.dependsOn,
        parameters: {
          ...node.parameters,
          motionProfile: "SHUTTER_CONVERGENCE",
        },
      };
    }
    if (node.nodeId === transform?.nodeId) return node;
    if (node.dependsOn.includes(recovery.nodeId)) {
      return {
        ...node,
        dependsOn: node.dependsOn.map((dependency) =>
          dependency === recovery.nodeId ? temporal.nodeId : dependency),
      };
    }
    return node;
  });

  const invariantCoverage = Object.fromEntries(
    Object.entries(base.invariantCoverage).map(([invariantId, nodeIds]) => [
      invariantId,
      temporal.requiredInvariantIds.includes(invariantId)
        ? [...new Set([...nodeIds, precomposeNodeId])]
        : nodeIds,
    ]),
  );
  return {
    ...base,
    graphId: `${base.graphId}:native_echo_hybrid`,
    nodes: [...nodes, precompose],
    outputs: [temporal.nodeId],
    invariantCoverage,
  };
};

const layeredPrimitiveHistoryGraph = (
  base: ConstructionGraphV1,
): ConstructionGraphV1 => {
  const temporalIndex = base.nodes.findIndex((node) =>
    !node.optional
    && node.kind === "TEMPORAL_DUPLICATES"
    && node.dimension === "TEMPORAL");
  if (temporalIndex < 0) return base;
  const temporal = base.nodes[temporalIndex];
  if (temporal === undefined) return base;

  const historyKinds = new Set<ConstructionNodeKindV1>([
    "CAMERA_MOTION",
    "TRANSFORM_MOTION",
    "RECOVERY",
  ]);
  const historyNodes = base.nodes.filter((node, index) =>
    index > temporalIndex
    && !node.optional
    && historyKinds.has(node.kind));
  if (historyNodes.length === 0) return base;

  const historyIds = new Set(historyNodes.map((node) => node.nodeId));
  const boundaryId = `${temporal.nodeId}:layered-history-precompose`;
  const originalTemporalDependencies = [...temporal.dependsOn];
  let historyTail: string | null = null;
  let externalTail = temporal.nodeId;

  const nodes = base.nodes.map((node, index): ConstructionNodeV1 => {
    if (node.nodeId === temporal.nodeId) {
      return { ...node, dependsOn: [boundaryId] };
    }
    if (historyIds.has(node.nodeId)) {
      const dependencies = historyTail === null
        ? originalTemporalDependencies
        : [historyTail];
      historyTail = node.nodeId;
      return { ...node, dependsOn: dependencies };
    }
    if (index > temporalIndex) {
      const dependencies = externalTail === null ? [] : [externalTail];
      if (!node.optional) externalTail = node.nodeId;
      return { ...node, dependsOn: dependencies };
    }
    return node;
  });
  if (historyTail === null) return base;

  const boundary: ConstructionNodeV1 = {
    nodeId: boundaryId,
    kind: "PRECOMPOSE_BOUNDARY",
    dimension: "COMPOSITING",
    dependsOn: [historyTail],
    requiredInvariantIds: [...new Set(historyNodes.flatMap((node) => node.requiredInvariantIds))],
    capabilityCandidates: ["ae.precompose.layers"],
    parameters: {
      causalBoundary: "LAYERED_TRANSFORM_HISTORY",
    },
    optional: false,
  };
  const invariantCoverage = Object.fromEntries(
    Object.entries(base.invariantCoverage).map(([invariantId, nodeIds]) => [
      invariantId,
      boundary.requiredInvariantIds.includes(invariantId)
        ? [...new Set([...nodeIds, boundaryId])]
        : nodeIds,
    ]),
  );
  return {
    ...base,
    graphId: `${base.graphId}:layered_transform_history`,
    nodes: [...nodes, boundary],
    outputs: base.outputs.map((output) =>
      historyIds.has(output) ? externalTail : output),
    invariantCoverage,
  };
};

const layeredEchoAugmentedGraph = (
  base: ConstructionGraphV1,
): ConstructionGraphV1 | null => {
  const layered = layeredPrimitiveHistoryGraph(base);
  const temporal = layered.nodes.find((node) =>
    node.kind === "TEMPORAL_DUPLICATES" && node.dimension === "TEMPORAL");
  if (temporal === undefined) return null;
  const persistenceInvariantIds = temporal.requiredInvariantIds.filter((invariantId) =>
    invariantId.toLowerCase().includes("persistence"));
  if (persistenceInvariantIds.length === 0) return null;

  const echoNodeId = `${temporal.nodeId}:echo-augmentation`;
  const echoNode: ConstructionNodeV1 = {
    nodeId: echoNodeId,
    kind: "TEMPORAL_DUPLICATES",
    dimension: "TEMPORAL",
    dependsOn: [temporal.nodeId],
    requiredInvariantIds: [...persistenceInvariantIds],
    capabilityCandidates: ["ae.effect.echo"],
    parameters: {
      ...temporal.parameters,
      synthesisStrategy: "LAYERED_ECHO_AUGMENTED",
      ...echoProofParameters(temporal),
    },
    optional: false,
  };

  const nodes = layered.nodes.map((node): ConstructionNodeV1 => {
    if (node.nodeId === temporal.nodeId) return node;
    if (!node.dependsOn.includes(temporal.nodeId)) return node;
    return {
      ...node,
      dependsOn: node.dependsOn.map((dependency) =>
        dependency === temporal.nodeId ? echoNodeId : dependency),
    };
  });
  const persistenceSet = new Set(persistenceInvariantIds);
  const invariantCoverage = Object.fromEntries(
    Object.entries(layered.invariantCoverage).map(([invariantId, nodeIds]) => [
      invariantId,
      persistenceSet.has(invariantId)
        // In the layered strategy, duration/occupancy lives on the explicit
        // temporal-state window. Echo augments those states, but spacing alone
        // cannot lengthen their bounded visibility window. Keep the layered
        // node first so comparator correction actuates temporalPersistenceScale;
        // retain Echo as secondary provenance/construction coverage.
        ? [...nodeIds.filter((nodeId) => nodeId !== echoNodeId), echoNodeId]
        : nodeIds,
    ]),
  );
  return {
    ...layered,
    graphId: `${layered.graphId}:layered_echo_augmented`,
    nodes: [...nodes, echoNode],
    outputs: layered.outputs.map((output) =>
      output === temporal.nodeId ? echoNodeId : output),
    invariantCoverage,
  };
};

const compoundNativeHybridGraph = (
  base: ConstructionGraphV1,
): ConstructionGraphV1 | null => {
  const echoAugmented = layeredEchoAugmentedGraph(base);
  if (echoAugmented === null) return null;
  const distortion = echoAugmented.nodes.find((node) =>
    node.kind === "DISTORTION" && !node.optional);
  if (distortion === undefined) return null;

  // Compound synthesis must be additive. Retain the proven semantic
  // displacement node and layer the new native warp after it instead of
  // replacing already-rendered behavior with a different effect family.
  const turbulentNodeId = `${distortion.nodeId}:turbulent-augmentation`;
  const turbulentNode: ConstructionNodeV1 = {
    nodeId: turbulentNodeId,
    kind: "DISTORTION",
    dimension: "DISTORTION",
    dependsOn: [distortion.nodeId],
    requiredInvariantIds: [...distortion.requiredInvariantIds],
    capabilityCandidates: ["ae.effect.turbulent-displace"],
    parameters: {
      ...distortion.parameters,
      synthesisStrategy: "TURBULENT_DISPLACE_HYBRID",
      ...turbulentDisplaceProofParameters(distortion),
    },
    optional: false,
  };
  const distortionInvariantIds = new Set(distortion.requiredInvariantIds);
  const compoundNodes = echoAugmented.nodes.map((node): ConstructionNodeV1 => {
    if (node.kind !== "RECOVERY"
      || !node.requiredInvariantIds.some((invariantId) =>
        invariantId.toLowerCase().includes("acceleration"))) return node;
    // A compound fragmented transition needs a zero-net convergence pulse, not
    // the generic one-direction recovery impulse. The alternating shutter
    // profile concentrates second-order motion energy near the cut while
    // minimizing broad displacement that would disturb already-proven spatial
    // fidelity. Rendered comparison remains the authority.
    return {
      ...node,
      parameters: {
        ...node.parameters,
        // Preserve causal provenance for escalation ranking: this recovery node is
        // the compound strategy's explicit acceleration intervention, not untouched
        // base anatomy. primitiveFor() still lowers RECOVERY through MOTION_SHAPING.
        synthesisStrategy: "COMPOUND_NATIVE_HYBRID",
        motionProfile: "SHUTTER_CONVERGENCE",
      },
    };
  });
  const invariantCoverage = Object.fromEntries(
    Object.entries(echoAugmented.invariantCoverage).map(([invariantId, nodeIds]) => [
      invariantId,
      distortionInvariantIds.has(invariantId)
        ? [turbulentNodeId, ...nodeIds.filter((nodeId) => nodeId !== turbulentNodeId)]
        : nodeIds,
    ]),
  );
  return {
    ...echoAugmented,
    graphId: `${base.graphId}:compound_native_hybrid`,
    nodes: [...compoundNodes, turbulentNode],
    outputs: echoAugmented.outputs.map((output) =>
      output === distortion.nodeId ? turbulentNodeId : output),
    invariantCoverage,
  };
};

const compoundEvolvingWarpGraph = (
  base: ConstructionGraphV1,
): ConstructionGraphV1 | null => {
  const compoundSource = compoundNativeHybridGraph(base);
  if (compoundSource === null) return null;
  // Isolate the escalation hypothesis from retained candidates. Construction
  // graphs deliberately reuse immutable evidence-derived nodes elsewhere, but a
  // synthesis escalation must never be able to invalidate a previously proven
  // candidate through shared nested parameter objects.
  const compound = structuredClone(compoundSource);
  const turbulent = compound.nodes.find((node) =>
    node.parameters["synthesisStrategy"] === "TURBULENT_DISPLACE_HYBRID"
    && node.requiredInvariantIds.some((invariantId) =>
      invariantId.toLowerCase().includes("distortion")));
  const recovery = compound.nodes.find((node) =>
    node.kind === "RECOVERY"
    && node.requiredInvariantIds.some((invariantId) =>
      invariantId.toLowerCase().includes("acceleration")));
  if (turbulent === undefined || recovery === undefined) return null;

  const accelerationInvariantIds = recovery.requiredInvariantIds.filter((invariantId) =>
    invariantId.toLowerCase().includes("acceleration"));
  const requiredInvariantIds = [...new Set([
    ...turbulent.requiredInvariantIds,
    ...accelerationInvariantIds,
  ])];
  // Escalate the already-retained Turbulent Displace stage in place. Adding a
  // second event-local effect system exceeded the 96-operation correction
  // transaction ceiling on compound references. v3 intentionally keeps v2's
  // static property map and only adds dynamic Amount/Evolution expressions, so
  // the retained static construction remains intact while the proof boundary is
  // upgraded without duplicating layers/effects.
  const evolvingNode: ConstructionNodeV1 = {
    ...turbulent,
    requiredInvariantIds,
    parameters: {
      ...turbulent.parameters,
      synthesisStrategy: "COMPOUND_EVOLVING_WARP_HYBRID",
      ...evolvingTurbulentProofParameters(turbulent),
    },
  };
  const targeted = new Set(requiredInvariantIds);
  const invariantCoverage = Object.fromEntries(
    Object.entries(compound.invariantCoverage).map(([invariantId, nodeIds]) => [
      invariantId,
      targeted.has(invariantId)
        ? [turbulent.nodeId, ...nodeIds.filter((nodeId) => nodeId !== turbulent.nodeId)]
        : nodeIds,
    ]),
  );
  return {
    ...compound,
    graphId: `${compound.graphId}:evolving_warp`,
    nodes: compound.nodes.map((node) =>
      node.nodeId === turbulent.nodeId ? evolvingNode : node),
    invariantCoverage,
  };
};

const compoundCompositeWarpGraph = (
  base: ConstructionGraphV1,
): ConstructionGraphV1 | null => {
  const evolving = compoundEvolvingWarpGraph(base);
  if (evolving === null) return null;
  const warpIndex = evolving.nodes.findIndex((node) =>
    node.parameters["synthesisStrategy"] === "COMPOUND_EVOLVING_WARP_HYBRID");
  if (warpIndex < 0) return null;
  const warp = evolving.nodes[warpIndex];
  if (warp === undefined || warp.dependsOn.length === 0) return null;

  // The v3 per-state warp is already proven to respond in real AE, but its
  // deformation plateau remains far below the active reference. Test a new
  // causal topology before adding more scalar strength: flatten the already
  // reconstructed fragmented states, then deform their composite once. This
  // also reduces native operation count because one effect replaces the same
  // effect repeated across every temporal state.
  const boundaryId = `${warp.nodeId}:composite-precompose`;
  const boundary: ConstructionNodeV1 = {
    nodeId: boundaryId,
    kind: "PRECOMPOSE_BOUNDARY",
    dimension: "COMPOSITING",
    dependsOn: [...warp.dependsOn],
    requiredInvariantIds: [...warp.requiredInvariantIds],
    capabilityCandidates: ["ae.precompose.layers"],
    parameters: {
      causalBoundary: "COMPOSITE_WARP_INPUT",
      groupTargets: true,
    },
    optional: false,
  };
  const compositeWarp: ConstructionNodeV1 = {
    ...warp,
    dependsOn: [boundaryId],
    parameters: {
      ...warp.parameters,
      synthesisStrategy: "COMPOUND_COMPOSITE_WARP_HYBRID",
      // Preserve the causal lineage for escalation ranking. The composite graph
      // is not an unrelated replacement for v3; it retains the evolving warp's
      // construction and inserts one grouped precompose boundary before the
      // same event-local deformation stage.
      extendsSynthesisStrategy: "COMPOUND_EVOLVING_WARP_HYBRID",
      // Unlike the per-state v3 hypothesis, the grouped replacement already is
      // the complete reconstructed visual. Apply the event-gated deformation to
      // that composite itself instead of mixing a warped accent over an untouched
      // copy, which dilutes both deformation magnitude and motion acceleration.
      eventLocalEffectApplication: "IN_PLACE",
      eventLocalEffectRecoveryBounded: true,
    },
  };
  const targeted = new Set(warp.requiredInvariantIds);
  const invariantCoverage = Object.fromEntries(
    Object.entries(evolving.invariantCoverage).map(([invariantId, nodeIds]) => [
      invariantId,
      targeted.has(invariantId)
        ? [warp.nodeId, boundaryId, ...nodeIds.filter((nodeId) =>
          nodeId !== warp.nodeId && nodeId !== boundaryId)]
        : nodeIds,
    ]),
  );
  return {
    ...evolving,
    graphId: `${evolving.graphId}:composite_warp`,
    nodes: [
      ...evolving.nodes.slice(0, warpIndex),
      boundary,
      compositeWarp,
      ...evolving.nodes.slice(warpIndex + 1),
    ],
    invariantCoverage,
  };
};

const compoundDualWarpGraph = (
  base: ConstructionGraphV1,
): ConstructionGraphV1 | null => {
  const evolving = compoundEvolvingWarpGraph(base);
  if (evolving === null) return null;
  const warp = evolving.nodes.find((node) =>
    node.parameters["synthesisStrategy"] === "COMPOUND_EVOLVING_WARP_HYBRID");
  if (warp === undefined) return null;

  // Real-AE evidence shows that moving the retained per-state warp behind a
  // grouped precompose reduces measured deformation. Preserve that proven
  // per-state stage and add one macro deformation on the primary visual only.
  // The first dual-warp proof also showed that the macro stage can resolve the
  // acceleration deficit while its Amount control is a poor distortion
  // actuator. Keep distortion ownership on the retained per-state warp and
  // assign the additive stage only the acceleration invariants it was created
  // to address. One additional v3 Turbulent Displace costs five native
  // operations, keeping the active 91-operation retained plan within the
  // 96-operation correction transaction ceiling without dropping a temporal
  // state.
  const accelerationInvariantIds = warp.requiredInvariantIds.filter((invariantId) =>
    invariantId.toLowerCase().includes("acceleration"));
  const augmentId = `${warp.nodeId}:primary-warp-augmentation`;
  const augment: ConstructionNodeV1 = {
    ...warp,
    nodeId: augmentId,
    dependsOn: [warp.nodeId],
    requiredInvariantIds: accelerationInvariantIds.length > 0
      ? accelerationInvariantIds
      : warp.requiredInvariantIds,
    parameters: {
      ...warp.parameters,
      synthesisStrategy: "COMPOUND_DUAL_WARP_HYBRID",
      extendsSynthesisStrategy: "COMPOUND_EVOLVING_WARP_HYBRID",
      inheritsPhysicalParametersFromNodeId: warp.nodeId,
      eventLocalEffectApplication: "IN_PLACE",
      eventLocalEffectTargetScope: "PRIMARY",
      eventLocalEffectRecoveryBounded: true,
    },
  };
  const targeted = new Set(augment.requiredInvariantIds);
  const invariantCoverage = Object.fromEntries(
    Object.entries(evolving.invariantCoverage).map(([invariantId, nodeIds]) => [
      invariantId,
      targeted.has(invariantId)
        ? [augmentId, ...nodeIds.filter((nodeId) => nodeId !== augmentId)]
        : nodeIds,
    ]),
  );
  return {
    ...evolving,
    graphId: `${evolving.graphId}:dual_warp`,
    nodes: [...evolving.nodes, augment],
    outputs: evolving.outputs.map((output) => output === warp.nodeId ? augmentId : output),
    invariantCoverage,
  };
};

const strategyGraph = (
  base: ConstructionGraphV1,
  strategy: UnknownEffectSynthesisStrategyV1,
): ConstructionGraphV1 | null => {
  if (strategy === "LAYERED_PRIMITIVES") return layeredPrimitiveHistoryGraph(base);
  if (strategy === "LAYERED_ECHO_AUGMENTED") return layeredEchoAugmentedGraph(base);
  if (strategy === "COMPOUND_NATIVE_HYBRID") return compoundNativeHybridGraph(base);
  if (strategy === "COMPOUND_EVOLVING_WARP_HYBRID") return compoundEvolvingWarpGraph(base);
  if (strategy === "COMPOUND_COMPOSITE_WARP_HYBRID") return compoundCompositeWarpGraph(base);
  if (strategy === "COMPOUND_DUAL_WARP_HYBRID") return compoundDualWarpGraph(base);
  if (strategy === "NATIVE_ECHO_HYBRID") return echoStrategyGraph(base);
  let changed = false;
  const nodes = base.nodes.map((node) => {
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
        parameters: {
          ...node.parameters,
          synthesisStrategy: "TURBULENT_DISPLACE_HYBRID",
          ...turbulentDisplaceProofParameters(node),
        },
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

const MATERIALIZED_NATIVE_SCHEMA_BY_STRATEGY: Readonly<
  Partial<Record<UnknownEffectSynthesisStrategyV1, string>>
> = Object.freeze({
  NATIVE_ECHO_HYBRID: "ae.effect-schema.m6.echo.v1",
  LAYERED_ECHO_AUGMENTED: "ae.effect-schema.m6.echo.v1",
  TURBULENT_DISPLACE_HYBRID: "ae.effect-schema.m6.turbulent-displace.v2",
  COMPOUND_EVOLVING_WARP_HYBRID: "ae.effect-schema.m6.turbulent-displace.v3",
  COMPOUND_COMPOSITE_WARP_HYBRID: "ae.effect-schema.m6.turbulent-displace.v3",
  COMPOUND_DUAL_WARP_HYBRID: "ae.effect-schema.m6.turbulent-displace.v3",
});

const nativeRealizationGaps = (graph: ConstructionGraphV1): readonly string[] =>
  [...new Set(graph.nodes.flatMap((node) => {
    const strategy = node.parameters["synthesisStrategy"];
    if (strategy !== "NATIVE_ECHO_HYBRID"
      && strategy !== "LAYERED_ECHO_AUGMENTED"
      && strategy !== "TIME_DISPLACEMENT_HYBRID"
      && strategy !== "TURBULENT_DISPLACE_HYBRID"
      && strategy !== "COMPOUND_EVOLVING_WARP_HYBRID"
      && strategy !== "COMPOUND_COMPOSITE_WARP_HYBRID"
      && strategy !== "COMPOUND_DUAL_WARP_HYBRID") return [];
    const capability = node.capabilityCandidates[0] ?? String(strategy);
    const expectedSchemaRef = MATERIALIZED_NATIVE_SCHEMA_BY_STRATEGY[strategy];
    const actualSchemaRef = node.parameters["effectSchemaRef"];
    if (expectedSchemaRef !== undefined && actualSchemaRef === expectedSchemaRef) return [];
    return [`PROOF_REQUIRED_NATIVE_EFFECT_SCHEMA:${capability}`];
  }))].sort();

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
  const capabilityGaps = [...new Set([
    ...compilation.capabilityGaps,
    ...nativeRealizationGaps(graph),
  ])].sort();
  const gapPenalty = capabilityGaps.length * 0.22;
  const proposals = adaptiveCapabilityProposals(graph, compilation.capabilityGaps);
  return {
    candidateId: id,
    strategy,
    graph,
    definingCoverage,
    complexity,
    capabilityGaps,
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
    { strategy: "LAYERED_ECHO_AUGMENTED", id: "adaptive:layered-echo-augmented", complexityPenalty: 0.5 },
    { strategy: "COMPOUND_NATIVE_HYBRID", id: "adaptive:compound-native-hybrid", complexityPenalty: 1 },
    { strategy: "COMPOUND_EVOLVING_WARP_HYBRID", id: "adaptive:compound-evolving-warp-hybrid", complexityPenalty: 1.5 },
    { strategy: "COMPOUND_DUAL_WARP_HYBRID", id: "adaptive:compound-dual-warp-hybrid", complexityPenalty: 1.75 },
    { strategy: "COMPOUND_COMPOSITE_WARP_HYBRID", id: "adaptive:compound-composite-warp-hybrid", complexityPenalty: 2 },
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

export const selectSynthesisEscalationCandidateV1 = (input: Readonly<{
  synthesis: UnknownEffectSynthesisV1;
  currentStrategy?: UnknownEffectSynthesisStrategyV1 | null;
  requiredInvariantIds: readonly string[];
}>): SynthesisCandidateV1 | null => {
  const required = new Set(input.requiredInvariantIds);
  if (required.size === 0) return null;
  const interventionStrategies = (graph: ConstructionGraphV1): ReadonlySet<string> =>
    new Set(graph.nodes.flatMap((node) => {
      const strategy = node.parameters["synthesisStrategy"];
      const extendsStrategy = node.parameters["extendsSynthesisStrategy"];
      return [
        ...(typeof strategy === "string" ? [strategy] : []),
        ...(typeof extendsStrategy === "string" ? [extendsStrategy] : []),
      ];
    }));
  const currentCandidate = input.currentStrategy === null || input.currentStrategy === undefined
    ? undefined
    : input.synthesis.candidates.find((candidate) => candidate.strategy === input.currentStrategy);
  const currentInterventions = currentCandidate === undefined
    ? new Set<string>()
    : interventionStrategies(currentCandidate.graph);
  const ranked = input.synthesis.candidates
    .filter((candidate) => {
      if (candidate.strategy === input.currentStrategy
        || candidate.definingCoverage !== 1
        || candidate.capabilityGaps.length > 0) return false;
      const candidateInterventions = interventionStrategies(candidate.graph);
      const isInterventionSubset = candidateInterventions.size > 0
        && currentInterventions.size > 0
        && [...candidateInterventions].every((strategy) => currentInterventions.has(strategy));
      // Structural escalation must add causal machinery, not replace a richer
      // retained construction with a strict subset of mechanisms it already
      // contains. The rendered current state remains authoritative.
      return !isInterventionSubset;
    })
    .map((candidate) => {
      const candidateInterventions = interventionStrategies(candidate.graph);
      const interventionInvariantIds = new Set(candidate.graph.nodes.flatMap((node) => {
        const strategy = node.parameters["synthesisStrategy"];
        const extendsStrategy = node.parameters["extendsSynthesisStrategy"];
        return typeof strategy === "string" || typeof extendsStrategy === "string"
          ? node.requiredInvariantIds
          : [];
      }));
      const targetedInvariantCount = [...required]
        .filter((invariantId) => interventionInvariantIds.has(invariantId)).length;
      const collateralInvariantCount = [...interventionInvariantIds]
        .filter((invariantId) => !required.has(invariantId)).length;
      // Escalation should be monotonic when possible: if the current rendered
      // strategy already solved defining behavior, prefer a candidate that
      // preserves that intervention and layers the new synthesis on top.
      // Explicit lineage counts as preservation because the successor graph is
      // required to retain the parent's causal construction.
      const preservesCurrentStrategy = input.currentStrategy !== null
        && input.currentStrategy !== undefined
        && candidateInterventions.has(input.currentStrategy);
      return { candidate, targetedInvariantCount, collateralInvariantCount, preservesCurrentStrategy };
    })
    .filter((entry) => entry.targetedInvariantCount > 0)
    .sort((left, right) =>
      right.targetedInvariantCount - left.targetedInvariantCount
      || Number(right.preservesCurrentStrategy) - Number(left.preservesCurrentStrategy)
      || left.collateralInvariantCount - right.collateralInvariantCount
      || right.candidate.score - left.candidate.score
      || left.candidate.complexity - right.candidate.complexity
      || left.candidate.candidateId.localeCompare(right.candidate.candidateId));
  return ranked[0]?.candidate ?? null;
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
