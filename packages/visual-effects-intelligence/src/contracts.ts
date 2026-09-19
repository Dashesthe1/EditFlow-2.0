import type { EditingIrRecipeV1 } from "../../editing-ir/src/index.js";

export const M6_PHASE = "M6_PROFESSIONAL_EFFECTS_TRANSITIONS_INTELLIGENCE" as const;

export const VISUAL_DIMENSIONS_V1 = [
  "SPATIAL",
  "TEMPORAL",
  "ISOLATION",
  "OPTICAL",
  "DISTORTION",
  "COMPOSITING",
  "MOTION_STRUCTURE",
] as const;
export type VisualDimensionV1 = (typeof VISUAL_DIMENSIONS_V1)[number];

export const EFFECT_FAMILIES_V1 = [
  "SHUTTER_FRAGMENTATION",
  "TEMPORAL_ECHO",
  "VELOCITY_TRANSITION",
  "SUBJECT_ISOLATED_TRANSITION",
  "WHIP_SMEAR",
  "DISPLACEMENT_WARP",
  "ZOOM_IMPACT",
  "OCCLUSION_TRANSITION",
  "FREEZE_FRAGMENTATION",
  "CAMERA_MOTION_MATCH",
  "CHROMATIC_GLITCH",
  "REVERSE_TEMPORAL",
  "MASK_REVEAL",
  "COMPOUND_LAYERED",
  "UNKNOWN",
] as const;
export type EffectFamilyV1 = (typeof EFFECT_FAMILIES_V1)[number];

export interface NormalizedPointV1 {
  readonly x: number;
  readonly y: number;
}

export interface DenseFrameSemanticObservationV1 {
  readonly subjectCentroid?: NormalizedPointV1;
  readonly backgroundCentroid?: NormalizedPointV1;
  readonly displacement?: NormalizedPointV1;
  readonly scale?: number;
  readonly rotationDegrees?: number;
  readonly perspectiveEnergy?: number;
  readonly blurStrength?: number;
  readonly distortionStrength?: number;
  readonly subjectSeparation?: number;
  readonly overlapDensity?: number;
  /** Within-frame separation between simultaneously visible temporal image states. */
  readonly stateSeparation?: number;
  readonly temporalStateCount?: number;
  readonly occlusion?: number;
  readonly maskCoverage?: number;
  readonly cameraMotion?: NormalizedPointV1;
}

export interface DenseFrameInputV1 {
  readonly timeMs: number;
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  readonly subjectMask?: Uint8Array;
  readonly semantic?: DenseFrameSemanticObservationV1;
}

export interface DenseFrameMetricsV1 {
  readonly timeMs: number;
  readonly lumaMean: number;
  readonly lumaStd: number;
  readonly exposure: number;
  readonly sharpness: number;
  readonly edgeDensity: number;
  readonly chromaticSeparation: number;
  readonly alphaCoverage: number;
  readonly visualDensity: number;
  readonly frameDifference: number;
  readonly structuralDifference: number;
  readonly motionEnergy: number;
  readonly motionDirection: NormalizedPointV1;
  readonly subjectMotion: NormalizedPointV1;
  readonly backgroundMotion: NormalizedPointV1;
  readonly subjectBackgroundDivergence: number;
  readonly displacementMagnitude: number;
  readonly scale: number;
  readonly rotationDegrees: number;
  readonly perspectiveEnergy: number;
  readonly blurStrength: number;
  readonly distortionStrength: number;
  readonly subjectSeparation: number;
  readonly overlapDensity: number;
  /** Within-frame temporal-copy separation; unlike displacementMagnitude this is not inter-frame camera motion. */
  readonly stateSeparation: number;
  readonly temporalStateCount: number;
  readonly occlusion: number;
  readonly maskCoverage: number;
}

export interface DenseEvidenceSummaryV1 {
  readonly frameCount: number;
  readonly frameIntervalMs: number;
  readonly temporalStateCountPeak: number;
  readonly temporalPersistence: number;
  readonly motionEnergyPeak: number;
  readonly displacementPeak: number;
  readonly displacementDirection: NormalizedPointV1;
  readonly scaleRange: number;
  readonly rotationRange: number;
  readonly blurPeak: number;
  readonly blurPeakPhase: number;
  readonly distortionPeak: number;
  readonly exposurePeak: number;
  readonly subjectSeparationPeak: number;
  readonly overlapDensityPeak: number;
  /** Peak within-frame separation of simultaneously visible temporal states. */
  readonly stateSeparationPeak?: number;
  /**
   * Highest locally coordinated shutter/fragmentation evidence. Unlike the
   * independent summary maxima, this requires temporal states, visible overlap,
   * and spatial separation to occur inside the same short visual event.
   * Optional for backward compatibility with retained pre-M6.1 evidence.
   */
  readonly fragmentationCoherencePeak?: number;
  readonly fragmentationCoherencePhase?: number;
  /** Event-local shutter metrics captured from the winning coherent fragmentation neighborhood. */
  readonly fragmentationTemporalStateCountPeak?: number;
  readonly fragmentationOverlapDensityPeak?: number;
  readonly fragmentationStateSeparationPeak?: number;
  readonly occlusionPeak: number;
  readonly accelerationPeak: number;
  readonly recoveryFrames: number;
  readonly opticalPeakPhase: number;
  readonly motionPeakPhase: number;
}

export interface DenseEffectEvidenceV1 {
  readonly schema: "editflow.dense-effect-evidence.v1";
  readonly sourceId: string;
  readonly sourceKind: "REFERENCE" | "RENDER";
  readonly range: Readonly<{ startMs: number; endMs: number }>;
  /**
   * Fingerprint of the measurement implementation, not the source footage.
   * Real reference/render evidence is comparable only when this matches.
   */
  readonly analyzerFingerprint: string;
  readonly settingsFingerprint: string;
  readonly contentKey: string;
  readonly frames: readonly DenseFrameMetricsV1[];
  readonly summary: DenseEvidenceSummaryV1;
  readonly evidenceRefs: readonly string[];
}

export interface DenseEvidenceSettingsV1 {
  readonly expectedFps: number;
  readonly differenceThreshold?: number;
  readonly edgeThreshold?: number;
  readonly recoveryEnergyRatio?: number;
  readonly requireEveryFrame?: boolean;
}

export interface DenseEffectWindowV1 {
  readonly windowId: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly anchorIndex: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly anchorMs: number;
  readonly peakEnergy: number;
  readonly evidence: DenseEffectEvidenceV1;
}

export interface DenseEffectSequenceV1 {
  readonly schema: "editflow.dense-effect-sequence.v1";
  readonly sourceId: string;
  readonly windows: readonly DenseEffectWindowV1[];
  readonly evidenceRefs: readonly string[];
}

export interface SemanticWindowPairV1 {
  readonly referenceWindowId: string;
  readonly renderWindowId: string;
  readonly referenceIndex: number;
  readonly renderIndex: number;
  readonly semanticCost: number;
}

export interface SemanticEffectSequenceAlignmentV1 {
  readonly schema: "editflow.semantic-effect-sequence-alignment.v1";
  readonly pairs: readonly SemanticWindowPairV1[];
  readonly unmatchedReferenceWindowIds: readonly string[];
  readonly unmatchedRenderWindowIds: readonly string[];
}

export interface TutorialActionObservationV1 {
  readonly actionId: string;
  readonly tutorialId: string;
  readonly action: string;
  readonly aeChange: string;
  readonly editorialPurpose: string;
  readonly before: DenseEffectEvidenceV1;
  readonly after: DenseEffectEvidenceV1;
  readonly literalValues?: Readonly<Record<string, number | string | boolean>>;
  readonly adaptationInputs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly major: boolean;
}

export interface DimensionDeltaV1 {
  readonly dimension: VisualDimensionV1;
  readonly metric: string;
  readonly before: number;
  readonly after: number;
  readonly delta: number;
  readonly material: boolean;
}

export interface ActionPixelCausalRuleV1 {
  readonly schema: "editflow.action-pixel-causal-rule.v1";
  readonly actionId: string;
  readonly tutorialId: string;
  readonly action: string;
  readonly aeChange: string;
  readonly pixelConsequences: readonly DimensionDeltaV1[];
  readonly editorialPurpose: string;
  readonly omissionConsequence: string;
  readonly transferableRule: string;
  readonly adaptationInputs: readonly string[];
  readonly literalValues: Readonly<Record<string, number | string | boolean>>;
  readonly evidenceRefs: readonly string[];
  readonly traceable: boolean;
}

export interface EffectInvariantV1 {
  readonly invariantId: string;
  readonly dimension: VisualDimensionV1;
  readonly metric: string;
  readonly comparator: "MIN" | "MAX" | "RANGE" | "DIRECTION" | "PHASE";
  readonly target: number | NormalizedPointV1 | readonly [number, number];
  readonly tolerance: number;
  readonly defining: boolean;
  readonly weight: number;
  readonly rationale: string;
}

export interface TransitionDnaV1 {
  readonly schema: "editflow.transition-dna.v1";
  readonly dnaId: string;
  readonly family: EffectFamilyV1;
  readonly definingInvariants: readonly EffectInvariantV1[];
  readonly optionalInvariants: readonly EffectInvariantV1[];
  readonly activationConditions: readonly string[];
  readonly restraintConditions: readonly string[];
  readonly adaptableVariables: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface EffectAnatomyComponentV1 {
  readonly componentId: string;
  readonly dimension: VisualDimensionV1;
  readonly role: string;
  readonly defining: boolean;
  readonly evidenceMetrics: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface EffectAnatomyV1 {
  readonly schema: "editflow.effect-anatomy.v1";
  readonly anatomyId: string;
  readonly family: EffectFamilyV1;
  readonly components: readonly EffectAnatomyComponentV1[];
  readonly dna: TransitionDnaV1;
  /** Measured reference values keyed by semantic metric. Family DNA defines acceptable behavior; these values define what reconstruction should actually target. */
  readonly observedMetrics: Readonly<Record<string, number | NormalizedPointV1>>;
  readonly confidence: number;
  readonly evidenceRefs: readonly string[];
}

export type ConstructionNodeKindV1 =
  | "BASE_TIMING"
  | "TEMPORAL_DUPLICATES"
  | "SUBJECT_ISOLATION"
  | "CAMERA_MOTION"
  | "TRANSFORM_MOTION"
  | "DISTORTION"
  | "OPTICAL_TREATMENT"
  | "EXPOSURE_ACCENT"
  | "CHROMATIC_TREATMENT"
  | "OCCLUSION_COMPOSITE"
  | "RECOVERY";

export interface ConstructionNodeV1 {
  readonly nodeId: string;
  readonly kind: ConstructionNodeKindV1;
  readonly dimension: VisualDimensionV1;
  readonly dependsOn: readonly string[];
  readonly requiredInvariantIds: readonly string[];
  readonly capabilityCandidates: readonly string[];
  readonly parameters: Readonly<Record<string, number | string | boolean | readonly number[]>>;
  readonly optional: boolean;
}

export interface ConstructionGraphV1 {
  readonly schema: "editflow.effect-construction-graph.v1";
  readonly graphId: string;
  readonly family: EffectFamilyV1;
  readonly nodes: readonly ConstructionNodeV1[];
  readonly outputs: readonly string[];
  readonly invariantCoverage: Readonly<Record<string, readonly string[]>>;
  readonly missingInvariantIds: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface ConstructionCompilationV1 {
  readonly graph: ConstructionGraphV1;
  readonly recipe: EditingIrRecipeV1 | null;
  readonly capabilityGaps: readonly string[];
  readonly definingCoverageComplete: boolean;
}

export interface FidelityMetricResultV1 {
  readonly invariantId: string;
  readonly dimension: VisualDimensionV1;
  readonly metric: string;
  readonly referenceValue: number | NormalizedPointV1;
  readonly renderValue: number | NormalizedPointV1;
  readonly normalizedError: number;
  readonly passed: boolean;
  readonly defining: boolean;
  readonly weight: number;
  readonly diagnosis: string;
}

export interface FidelityComparisonV1 {
  readonly schema: "editflow.semantic-fidelity-comparison.v1";
  readonly family: EffectFamilyV1;
  readonly alignment: "FRAME" | "SEMANTIC";
  readonly metrics: readonly FidelityMetricResultV1[];
  readonly definingCoverage: number;
  readonly weightedFidelity: number;
  readonly passed: boolean;
  readonly diagnoses: readonly string[];
  readonly referenceEvidenceKey: string;
  readonly renderEvidenceKey: string;
}

export type FidelityGateOutcomeV1 =
  | "PASS"
  | "CORRECTION_REQUIRED"
  | "SYNTHESIS_REQUIRED"
  | "CAPABILITY_GAP";

export interface FidelityGateResultV1 {
  readonly schema: "editflow.professional-fidelity-gate.v1";
  readonly outcome: FidelityGateOutcomeV1;
  readonly certified: boolean;
  readonly missingDefiningInvariantIds: readonly string[];
  readonly underDrivenInvariantIds: readonly string[];
  readonly weakerSubstitutionDetected: boolean;
  readonly reasons: readonly string[];
}

export interface SemanticPatchV1 {
  readonly patchId: string;
  readonly invariantId: string;
  readonly nodeId: string;
  readonly parameter: string;
  readonly previousValue: number;
  readonly nextValue: number;
  readonly rationale: string;
}

export const CONSTRUCTION_CONTROL_KINDS_V1 = [
  "TEMPORAL_COPY_COUNT",
  "TEMPORAL_FRAGMENT_DENSITY",
  "TEMPORAL_BAND_MIX",
  "TEMPORAL_PERSISTENCE",
  "DUPLICATE_OPACITY",
  "DUPLICATE_SPREAD",
  "SPATIAL_SEPARATION",
  "SPATIAL_DIRECTION",
  "MOTION_IMPULSE",
  "RECOVERY_DURATION",
  "BLUR_STRENGTH",
  "EXPOSURE_STRENGTH",
  "DISTORTION_STRENGTH",
  "SUBJECT_ISOLATION",
  "OCCLUSION_COVERAGE",
  "CHROMATIC_SEPARATION",
  "SCALE_PULSE",
  "ROTATION_PULSE",
  "COORDINATED_DIMENSION_COUNT",
] as const;
export type ConstructionControlKindV1 = (typeof CONSTRUCTION_CONTROL_KINDS_V1)[number];

export interface ConstructionControlInstructionV1 {
  readonly instructionId: string;
  readonly invariantId: string;
  readonly nodeId: string;
  readonly metric: string;
  /** Viewer-visible deficit this control was introduced to correct. */
  readonly deficitMetric?: string;
  /** Reference/render values for the viewer-visible deficit when metric is a coupled actuator-safety metric. */
  readonly deficitReferenceValue?: number | NormalizedPointV1;
  readonly deficitRenderValue?: number | NormalizedPointV1;
  readonly control: ConstructionControlKindV1;
  readonly direction: "INCREASE" | "DECREASE" | "SET";
  readonly referenceValue: number | NormalizedPointV1;
  readonly renderValue: number | NormalizedPointV1;
  readonly multiplier: number;
  readonly normalizedError: number;
  readonly defining: boolean;
  readonly rationale: string;
}

export interface ConstructionActuationPlanV1 {
  readonly schema: "editflow.construction-actuation-plan.v1";
  readonly family: EffectFamilyV1;
  readonly comparisonKey: string;
  readonly instructions: readonly ConstructionControlInstructionV1[];
  readonly unresolvedInvariantIds: readonly string[];
}

export interface CorrectionPassV1 {
  readonly iteration: number;
  readonly comparison: FidelityComparisonV1;
  readonly gate: FidelityGateResultV1;
  readonly patches: readonly SemanticPatchV1[];
}

export interface CorrectionLoopResultV1 {
  readonly schema: "editflow.visual-correction-loop.v1";
  readonly status: "PASSED" | "CAPABILITY_GAP" | "STALLED" | "ITERATION_LIMIT";
  readonly graph: ConstructionGraphV1;
  readonly passes: readonly CorrectionPassV1[];
  readonly learnedPatches: readonly SemanticPatchV1[];
}

export type UnknownEffectSynthesisStrategyV1 =
  | "LAYERED_PRIMITIVES"
  | "NATIVE_ECHO_HYBRID"
  | "TIME_DISPLACEMENT_HYBRID"
  | "TURBULENT_DISPLACE_HYBRID";

export interface AdaptiveCapabilityProposalV1 {
  readonly capabilityId: string;
  readonly nativeEffect: string;
  readonly invariantIds: readonly string[];
  readonly proofRequirement: "REAL_AE_RENDER";
  readonly rationale: string;
}

export interface SynthesisCandidateV1 {
  readonly candidateId: string;
  readonly strategy: UnknownEffectSynthesisStrategyV1;
  readonly graph: ConstructionGraphV1;
  readonly definingCoverage: number;
  readonly complexity: number;
  readonly capabilityGaps: readonly string[];
  readonly adaptiveCapabilityProposals: readonly AdaptiveCapabilityProposalV1[];
  readonly score: number;
}

export interface UnknownEffectSynthesisV1 {
  readonly schema: "editflow.unknown-effect-synthesis.v1";
  readonly status: "READY_FOR_PROOF" | "CAPABILITY_GAP";
  readonly selected: SynthesisCandidateV1 | null;
  readonly candidates: readonly SynthesisCandidateV1[];
  readonly provenance: readonly string[];
  readonly gapReasons: readonly string[];
}

export const PROFESSIONAL_FIDELITY_LEVELS_V1 = [
  "FUNCTIONALLY_PRESENT",
  "STRUCTURAL",
  "VISUALLY_RECOGNIZABLE",
  "REFERENCE_FAITHFUL",
  "TRANSFER_VERIFIED",
  "PROFESSIONAL_FIDELITY_VERIFIED",
  "ROBUST",
] as const;
export type ProfessionalFidelityLevelV1 = (typeof PROFESSIONAL_FIDELITY_LEVELS_V1)[number];

export interface ProfessionalBenchmarkCaseV1 {
  readonly caseId: string;
  readonly family: EffectFamilyV1;
  readonly sourceKind: "TUTORIAL" | "REFERENCE_ONLY" | "HELD_OUT";
  readonly transferAxes: readonly string[];
  readonly referenceEvidenceRef: string;
  readonly expectedLevel: ProfessionalFidelityLevelV1;
}

export interface ProfessionalBenchmarkResultV1 {
  readonly schema: "editflow.professional-benchmark-result.v1";
  readonly passed: boolean;
  readonly total: number;
  readonly passedCases: number;
  readonly familyCoverage: readonly EffectFamilyV1[];
  readonly heldOutCases: number;
  readonly transferAxes: readonly string[];
  readonly failures: readonly string[];
}

export interface M6ProductionRequestV1 {
  readonly requestId: string;
  readonly risk: "LOW" | "HIGH";
  readonly learnedTechniqueId?: string;
  readonly learnedGraph?: ConstructionGraphV1;
  readonly referenceEvidence?: DenseEffectEvidenceV1;
  readonly renderWindow: (graph: ConstructionGraphV1) => Promise<DenseEffectEvidenceV1>;
  readonly applyGraph: (graph: ConstructionGraphV1) => Promise<void>;
  readonly availableCapabilities: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface M6ProductionResultV1 {
  readonly schema: "editflow.m6-production-result.v1";
  readonly route: "FAST_PATH" | "VISUAL_INTELLIGENCE" | "FAIL_CLOSED";
  readonly status: "COMPLETED" | "CAPABILITY_GAP" | "FIDELITY_FAILED";
  readonly correction: CorrectionLoopResultV1 | null;
  readonly synthesis: UnknownEffectSynthesisV1 | null;
  readonly evidenceRefs: readonly string[];
}
