import type {
  DenseEffectEvidenceV1,
  EffectAnatomyComponentV1,
  EffectAnatomyV1,
  EffectFamilyV1,
  EffectInvariantV1,
  NormalizedPointV1,
  TransitionDnaV1,
  VisualDimensionV1,
} from "./contracts.js";
import {
  measureFragmentationEventProminenceV1,
  resolveFragmentationEventMetricsV1,
  scoreFragmentationEventLocalizationV1,
} from "./dense-evidence.js";

// Probe v2's fragmentation-coherence score includes a temporal coordination
// decay: component peaks receive full credit within one frame and fall toward
// zero as their peak-to-peak span approaches ~90 ms. A 0.75 family gate would
// therefore require near-simultaneous peaks (~35 ms) and rejects the retained
// professional microwave/shutter reference itself. The family-level floor is
// intentionally lower: it proves that states + overlap + residual displacement
// occur within one high-frequency event; render fidelity remains reference-
// relative and can demand the professional reference's stronger observed value.
const SHUTTER_COORDINATION_MIN_V2 = 0.08;
// v6 measures overlap inside the coherent fragmentation event rather than using
// an unrelated global autocorrelation maximum elsewhere in the shot. The real
// professional microwave/shutter reference measures ~0.055 on this event-local
// scale; fidelity remains reference-relative above this family floor.
const SHUTTER_EVENT_OVERLAP_MIN_V6 = 0.04;

const shutterEventOverlapMinimum = (evidence: DenseEffectEvidenceV1): number => {
  const legacyProbe = evidence.evidenceRefs.some((ref) =>
    /^probe-algorithm:editflow\.m6\.dense-video-probe\.v[1-5]$/.test(ref));
  return legacyProbe ? 0.20 : SHUTTER_EVENT_OVERLAP_MIN_V6;
};

const invariant = (
  id: string,
  dimension: VisualDimensionV1,
  metric: string,
  comparator: EffectInvariantV1["comparator"],
  target: EffectInvariantV1["target"],
  tolerance: number,
  defining: boolean,
  rationale: string,
  weight = defining ? 1 : 0.35,
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

const FAMILY_CONTRACTS: Readonly<Record<Exclude<EffectFamilyV1, "UNKNOWN">, readonly EffectInvariantV1[]>> = {
  SHUTTER_FRAGMENTATION: [
    invariant("shutter.states", "TEMPORAL", "temporalStateCountPeak", "MIN", 2, 0, true,
      "Multiple simultaneously readable temporal image states define shutter fragmentation."),
    invariant("shutter.coordination", "COMPOSITING", "fragmentationCoherencePeak", "MIN", SHUTTER_COORDINATION_MIN_V2, 0.02, true,
      "Temporal states, overlap, and spatial separation must occur as one bounded high-frequency event rather than unrelated peaks in the same window.", 1.2),
    invariant("shutter.event-locality", "COMPOSITING", "fragmentationEventLocalization", "MIN", 1, 0.05, true,
      "The coordinated fragmentation tuple must be materially concentrated around the transition event rather than persist as source texture throughout the window.", 1.2),
    invariant("shutter.overlap", "COMPOSITING", "overlapDensityPeak", "MIN", 0.24, 0.01, true,
      "Temporal states must visibly overlap inside the coherent shutter event rather than borrowing a global scene-texture maximum."),
    invariant("shutter.displacement", "SPATIAL", "fragmentationStateSeparationPeak", "RANGE", [0.015, 0.08], 0.005, true,
      "States require visible within-frame spatial separation during the coordinated fragmentation event before convergence; unrelated source-texture echoes or camera/content motion cannot substitute."),
    invariant("shutter.acceleration", "MOTION_STRUCTURE", "accelerationPeak", "MIN", 0.02, 0.0075, true,
      "High-frequency acceleration and convergence create the shutter cadence."),
    invariant("shutter.recovery", "MOTION_STRUCTURE", "recoveryFrames", "MAX", 5, 1, true,
      "The transition must resolve quickly after the cut."),
    invariant("shutter.blur", "OPTICAL", "blurPeak", "MIN", 0.18, 0.05, false,
      "Directional blur can reinforce, but cannot replace, temporal fragmentation."),
    invariant("shutter.exposure", "OPTICAL", "exposurePeak", "MIN", 0.56, 0.08, false,
      "An exposure accent is optional decoration rather than defining behavior."),
  ],
  TEMPORAL_ECHO: [
    invariant("echo.states", "TEMPORAL", "temporalStateCountPeak", "MIN", 2, 0, true, "Echo requires repeated temporal states."),
    invariant("echo.persistence", "TEMPORAL", "temporalPersistence", "MIN", 0.42, 0.08, true, "Echo states persist across a meaningful portion of the window."),
    invariant("echo.overlap", "COMPOSITING", "overlapDensityPeak", "MIN", 0.18, 0.05, true, "The trail must visibly overlap the moving subject."),
  ],
  VELOCITY_TRANSITION: [
    invariant("velocity.energy", "MOTION_STRUCTURE", "motionEnergyPeak", "MIN", 0.28, 0.06, true, "A clear velocity impulse drives the cut."),
    invariant("velocity.acceleration", "MOTION_STRUCTURE", "accelerationPeak", "MIN", 0.05, 0.02, true, "Acceleration and recovery distinguish a shaped velocity transition."),
    invariant("velocity.recovery", "MOTION_STRUCTURE", "recoveryFrames", "MAX", 8, 2, true, "Motion energy must recover after the transition."),
  ],
  SUBJECT_ISOLATED_TRANSITION: [
    invariant("isolation.separation", "ISOLATION", "subjectSeparationPeak", "MIN", 0.3, 0.06, true, "Foreground and background require materially different behavior."),
    invariant("isolation.mask", "ISOLATION", "maskCoveragePeak", "MIN", 0.06, 0.02, true, "A subject matte or equivalent separation must be evidenced."),
  ],
  WHIP_SMEAR: [
    invariant("whip.motion", "SPATIAL", "displacementPeak", "MIN", 0.18, 0.04, true, "Large directional displacement defines a whip."),
    invariant("whip.blur", "OPTICAL", "blurPeak", "MIN", 0.42, 0.08, true, "Smear/blur must carry the directional motion."),
    invariant("whip.recovery", "MOTION_STRUCTURE", "recoveryFrames", "MAX", 7, 2, true, "The smear resolves rapidly into the destination shot."),
  ],
  DISPLACEMENT_WARP: [
    invariant("warp.distortion", "DISTORTION", "distortionPeak", "MIN", 0.35, 0.07, true, "Non-rigid deformation is defining."),
    invariant("warp.energy", "MOTION_STRUCTURE", "motionEnergyPeak", "MIN", 0.16, 0.04, false, "Motion energy may reinforce the deformation."),
  ],
  ZOOM_IMPACT: [
    invariant("zoom.scale", "SPATIAL", "scaleRange", "MIN", 0.12, 0.03, true, "A material scale pulse defines the zoom impact."),
    invariant("zoom.motion", "MOTION_STRUCTURE", "motionEnergyPeak", "MIN", 0.12, 0.03, true, "The scale pulse must have visible energy."),
    invariant("zoom.recovery", "MOTION_STRUCTURE", "recoveryFrames", "MAX", 9, 2, true, "The push must recover rather than drift."),
  ],
  OCCLUSION_TRANSITION: [
    invariant("occlusion.coverage", "COMPOSITING", "occlusionPeak", "MIN", 0.65, 0.08, true, "A foreground object must materially cover the frame."),
    invariant("occlusion.motion", "MOTION_STRUCTURE", "motionEnergyPeak", "MIN", 0.12, 0.03, true, "Occlusion must move through the transition."),
  ],
  FREEZE_FRAGMENTATION: [
    invariant("freeze.states", "TEMPORAL", "temporalStateCountPeak", "MIN", 2, 0, true, "Freeze fragmentation needs multiple held states."),
    invariant("freeze.coordination", "COMPOSITING", "fragmentationCoherencePeak", "MIN", 0.65, 0.1, true, "Held states, overlap, and spatial placement must belong to the same local fragmentation event."),
    invariant("freeze.overlap", "COMPOSITING", "overlapDensityPeak", "MIN", 0.22, 0.05, true, "Held fragments must coexist visibly."),
    invariant("freeze.motion", "SPATIAL", "stateSeparationPeak", "MIN", 0.05, 0.02, true, "Held fragments need differentiated within-frame spatial placement."),
  ],
  CAMERA_MOTION_MATCH: [
    invariant("camera.direction", "SPATIAL", "displacementDirection", "DIRECTION", { x: 1, y: 0 }, 0.28, true, "Outgoing and incoming camera motion must align semantically."),
    invariant("camera.energy", "MOTION_STRUCTURE", "motionEnergyPeak", "MIN", 0.2, 0.05, true, "Matched direction without sufficient motion energy is not convincing."),
  ],
  CHROMATIC_GLITCH: [
    invariant("chroma.separation", "OPTICAL", "chromaticSeparationPeak", "MIN", 0.18, 0.04, true, "Visible channel separation defines the chromatic treatment."),
    invariant("chroma.persistence", "TEMPORAL", "temporalPersistence", "MAX", 0.55, 0.1, true, "The accent should remain temporally bounded."),
  ],
  REVERSE_TEMPORAL: [
    invariant("reverse.energy", "MOTION_STRUCTURE", "motionEnergyPeak", "MIN", 0.14, 0.03, true, "Reverse motion must remain visually readable."),
    invariant("reverse.acceleration", "MOTION_STRUCTURE", "accelerationPeak", "MIN", 0.025, 0.01, true, "A shaped reversal needs a direction/velocity inflection."),
  ],
  MASK_REVEAL: [
    invariant("mask.coverage", "ISOLATION", "maskCoveragePeak", "MIN", 0.12, 0.03, true, "A changing matte or mask must drive the reveal."),
    invariant("mask.occlusion", "COMPOSITING", "occlusionPeak", "MIN", 0.18, 0.04, false, "Occlusion evidence can strengthen the reveal."),
  ],
  COMPOUND_LAYERED: [
    invariant("compound.states", "TEMPORAL", "temporalStateCountPeak", "MIN", 2, 0, true, "A compound transition must contain more than one temporal state."),
    invariant("compound.dimensions", "COMPOSITING", "activeDimensionCount", "MIN", 4, 0, true, "At least four coordinated visual systems must materially contribute."),
    invariant("compound.recovery", "MOTION_STRUCTURE", "recoveryFrames", "MAX", 10, 2, true, "Layered energy must converge and recover."),
  ],
};

const maxFrame = (evidence: DenseEffectEvidenceV1, key: keyof DenseEffectEvidenceV1["frames"][number]): number => {
  const values = evidence.frames.map((frame) => frame[key]).filter((value): value is number => typeof value === "number");
  return values.length === 0 ? 0 : Math.max(...values);
};

const stateSeparation = (evidence: DenseEffectEvidenceV1): number => {
  const retained = evidence.summary.stateSeparationPeak;
  if (typeof retained === "number" && Number.isFinite(retained)) return retained;
  return maxFrame(evidence, "stateSeparation");
};

const fragmentationCoherence = (evidence: DenseEffectEvidenceV1): number =>
  resolveFragmentationEventMetricsV1(evidence).peak;

export const classifyEffectFamilyV1 = (evidence: DenseEffectEvidenceV1): EffectFamilyV1 => {
  const s = evidence.summary;
  const chroma = maxFrame(evidence, "chromaticSeparation");
  const mask = maxFrame(evidence, "maskCoverage");
  // Classification is proof-gated by the same defining thresholds used by
  // Transition DNA. A family must not be selected if its own contract would
  // immediately reject the reference that triggered the selection.
  const fragmentation = resolveFragmentationEventMetricsV1(evidence);
  const fragmentationProminence = measureFragmentationEventProminenceV1(evidence, fragmentation.phase);
  if (fragmentation.temporalStateCountPeak >= 2
    && fragmentationProminence.localized
    && fragmentation.overlapDensityPeak >= shutterEventOverlapMinimum(evidence)
    && fragmentation.stateSeparationPeak >= 0.015
    && fragmentation.peak >= SHUTTER_COORDINATION_MIN_V2
    && s.accelerationPeak >= 0.02 && s.recoveryFrames <= 6) return "SHUTTER_FRAGMENTATION";
  if (s.temporalStateCountPeak >= 2 && s.overlapDensityPeak >= 0.22
    && stateSeparation(evidence) >= 0.05 && fragmentationCoherence(evidence) >= 0.65) return "FREEZE_FRAGMENTATION";
  if (s.temporalStateCountPeak >= 2 && s.temporalPersistence >= 0.42
    && s.overlapDensityPeak >= 0.18) return "TEMPORAL_ECHO";
  if (s.occlusionPeak >= 0.65 && s.motionEnergyPeak >= 0.12) return "OCCLUSION_TRANSITION";
  if (s.subjectSeparationPeak >= 0.3 && mask >= 0.06) return "SUBJECT_ISOLATED_TRANSITION";
  if (s.displacementPeak >= 0.18 && s.blurPeak >= 0.42
    && s.recoveryFrames <= 7) return "WHIP_SMEAR";
  if (s.distortionPeak >= 0.35) return "DISPLACEMENT_WARP";
  if (chroma >= 0.18 && s.temporalPersistence <= 0.55) return "CHROMATIC_GLITCH";
  if (s.scaleRange >= 0.12 && s.motionEnergyPeak >= 0.12
    && s.recoveryFrames <= 9) return "ZOOM_IMPACT";
  if (mask >= 0.12) return "MASK_REVEAL";
  if (s.motionEnergyPeak >= 0.28 && s.accelerationPeak >= 0.05
    && s.recoveryFrames <= 8) return "VELOCITY_TRANSITION";
  return "UNKNOWN";
};

export const canonicalTransitionDnaV1 = (
  family: Exclude<EffectFamilyV1, "UNKNOWN">,
  evidenceRefs: readonly string[] = [],
): TransitionDnaV1 => {
  const invariants = FAMILY_CONTRACTS[family];
  return {
    schema: "editflow.transition-dna.v1",
    dnaId: `dna:${family.toLowerCase()}:v1`,
    family,
    definingInvariants: invariants.filter((item) => item.defining),
    optionalInvariants: invariants.filter((item) => !item.defining),
    activationConditions: ["Reference evidence materially exhibits every defining invariant."],
    restraintConditions: ["Do not activate when required source handles, isolation, or visual readability are unavailable."],
    adaptableVariables: ["subject", "velocity", "frameRate", "duration", "beat", "composition", "intensity"],
    evidenceRefs: [...new Set(evidenceRefs)],
  };
};

const dimensionsForEvidence = (evidence: DenseEffectEvidenceV1): readonly VisualDimensionV1[] => {
  const s = evidence.summary;
  const dimensions: VisualDimensionV1[] = [];
  if (s.displacementPeak > 0.025 || (s.stateSeparationPeak ?? 0) > 0.015 || s.scaleRange > 0.025 || s.rotationRange > 2) dimensions.push("SPATIAL");
  if (s.temporalStateCountPeak > 1 || s.temporalPersistence > 0.2) dimensions.push("TEMPORAL");
  if (s.subjectSeparationPeak > 0.12 || maxFrame(evidence, "maskCoverage") > 0.05) dimensions.push("ISOLATION");
  if (s.blurPeak > 0.12 || s.exposurePeak > 0.55 || maxFrame(evidence, "chromaticSeparation") > 0.08) dimensions.push("OPTICAL");
  if (s.distortionPeak > 0.12) dimensions.push("DISTORTION");
  if (s.overlapDensityPeak > 0.1 || s.occlusionPeak > 0.1) dimensions.push("COMPOSITING");
  if (s.motionEnergyPeak > 0.08 || s.accelerationPeak > 0.02) dimensions.push("MOTION_STRUCTURE");
  return dimensions;
};

const observedMetricValue = (
  evidence: DenseEffectEvidenceV1,
  metric: string,
  family: EffectFamilyV1,
): number | NormalizedPointV1 | null => {
  const fragmentation = resolveFragmentationEventMetricsV1(evidence);
  if (family === "SHUTTER_FRAGMENTATION") {
    if (metric === "temporalStateCountPeak") return fragmentation.temporalStateCountPeak;
    if (metric === "overlapDensityPeak") return fragmentation.overlapDensityPeak;
  }
  const summary = evidence.summary as unknown as Readonly<Record<string, unknown>>;
  const value = summary[metric];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (metric === "displacementDirection") return evidence.summary.displacementDirection;
  if (metric === "maskCoveragePeak") return maxFrame(evidence, "maskCoverage");
  if (metric === "chromaticSeparationPeak") return maxFrame(evidence, "chromaticSeparation");
  if (metric === "stateSeparationPeak") return stateSeparation(evidence);
  if (metric === "fragmentationCoherencePeak") return fragmentation.peak;
  if (metric === "fragmentationEventLocalization") {
    return scoreFragmentationEventLocalizationV1(evidence, fragmentation.phase);
  }
  if (metric === "fragmentationStateSeparationPeak") return fragmentation.stateSeparationPeak;
  if (metric === "activeDimensionCount") return dimensionsForEvidence(evidence).length;
  return null;
};

export const deriveEffectAnatomyV1 = (
  evidence: DenseEffectEvidenceV1,
  familyOverride?: Exclude<EffectFamilyV1, "UNKNOWN">,
): EffectAnatomyV1 => {
  const family = familyOverride ?? classifyEffectFamilyV1(evidence);
  if (family === "UNKNOWN") {
    throw new TypeError("Unknown effect evidence must be synthesized before it can receive canonical Transition DNA.");
  }
  const dna = canonicalTransitionDnaV1(family, evidence.evidenceRefs);
  const activeDimensions = new Set(dimensionsForEvidence(evidence));
  const allInvariants = [...dna.definingInvariants, ...dna.optionalInvariants];
  const observedMetrics: Record<string, number | NormalizedPointV1> = {};
  for (const item of allInvariants) {
    const observed = observedMetricValue(evidence, item.metric, family);
    if (observed !== null) observedMetrics[item.metric] = observed;
  }
  const analysisDurationMs = evidence.range.endMs - evidence.range.startMs;
  if (Number.isFinite(analysisDurationMs) && analysisDurationMs > 0) {
    observedMetrics.effectAnalysisDurationMs = analysisDurationMs;
  }
  if (Number.isFinite(evidence.summary.frameIntervalMs) && evidence.summary.frameIntervalMs > 0) {
    observedMetrics.referenceFrameIntervalMs = evidence.summary.frameIntervalMs;
    if (Number.isFinite(evidence.summary.recoveryFrames) && evidence.summary.recoveryFrames > 0) {
      observedMetrics.effectRecoveryDurationMs = evidence.summary.recoveryFrames * evidence.summary.frameIntervalMs;
    }
  }
  const components: EffectAnatomyComponentV1[] = [];
  for (const item of allInvariants) {
    if (!item.defining && !activeDimensions.has(item.dimension)) continue;
    components.push({
      componentId: `component:${item.invariantId}`,
      dimension: item.dimension,
      role: item.rationale,
      defining: item.defining,
      evidenceMetrics: [item.metric],
      evidenceRefs: evidence.evidenceRefs,
    });
  }
  const definingActive = dna.definingInvariants.filter((item) => activeDimensions.has(item.dimension)).length;
  return {
    schema: "editflow.effect-anatomy.v1",
    anatomyId: `anatomy:${evidence.sourceId}:${family.toLowerCase()}`,
    family,
    components,
    dna,
    observedMetrics,
    confidence: dna.definingInvariants.length === 0 ? 0 : definingActive / dna.definingInvariants.length,
    evidenceRefs: evidence.evidenceRefs,
  };
};

export const distinguishShutterFromFlashZoomV1 = (
  evidence: DenseEffectEvidenceV1,
): Readonly<{ shutter: boolean; reasons: readonly string[] }> => {
  const s = evidence.summary;
  const fragmentation = resolveFragmentationEventMetricsV1(evidence);
  const fragmentationProminence = measureFragmentationEventProminenceV1(evidence, fragmentation.phase);
  const reasons: string[] = [];
  if (fragmentation.temporalStateCountPeak < 2) reasons.push("MISSING_MULTIPLE_TEMPORAL_STATES");
  if (fragmentationProminence.applicable && !fragmentationProminence.localized) {
    reasons.push("FRAGMENTATION_NOT_EVENT_LOCAL");
  }
  if (fragmentation.overlapDensityPeak < shutterEventOverlapMinimum(evidence)) reasons.push("MISSING_OVERLAPPING_FRAGMENTATION");
  if (fragmentation.stateSeparationPeak < 0.015) reasons.push("MISSING_SPATIAL_STATE_SEPARATION");
  if (fragmentation.peak < SHUTTER_COORDINATION_MIN_V2) reasons.push("MISSING_COORDINATED_FRAGMENTATION");
  if (s.accelerationPeak < 0.02) reasons.push("MISSING_HIGH_FREQUENCY_CONVERGENCE");
  if (s.recoveryFrames > 6) reasons.push("RECOVERY_TOO_LONG_FOR_SHUTTER");
  return { shutter: reasons.length === 0, reasons };
};
