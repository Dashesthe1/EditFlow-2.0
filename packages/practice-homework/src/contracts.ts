export type EditFlowOperatingModeV1 = "PRACTICE" | "PRO_CREATION";
export type PracticeMediaRoleV1 = "FINISH_REFERENCE" | "START_SOURCE";
export type PracticeMediaKindV1 = "VIDEO" | "AUDIO";
export type PracticeSessionStatusV1 =
  | "READY"
  | "ANALYZING"
  | "MATCHING"
  | "RECONSTRUCTING"
  | "MASTERED"
  | "HUMAN_REVIEW_REQUIRED"
  | "BLOCKED";

export interface PracticeMediaInputV1 {
  readonly mediaId: string;
  readonly role: PracticeMediaRoleV1;
  readonly mediaKind: PracticeMediaKindV1;
  readonly uri: string;
  readonly checksum?: string;
  readonly durationMs?: number;
}

export interface PracticeReferenceShotV1 {
  readonly shotId: string;
  readonly order: number;
  readonly referenceStartMs: number;
  readonly referenceEndMs: number;
  readonly evidenceRefs: readonly string[];
}

export interface PracticeReferenceExcludedRangeV1 {
  readonly kind: "STATIC_LOW_INFORMATION_TAIL";
  readonly referenceStartMs: number;
  readonly referenceEndMs: number;
  readonly confidence: number;
  readonly evidenceRefs: readonly string[];
}

export interface PracticeReferenceVideoV1 {
  readonly fps: number;
  readonly frameCount: number;
  readonly width: number;
  readonly height: number;
  /** Effective edit-content duration after confidently excluded appended tail artifacts. */
  readonly durationMs: number;
  /** Original Finish media duration before any retained tail-artifact exclusion. */
  readonly sourceDurationMs?: number;
}

export interface PracticeReferenceAnalysisV1 {
  readonly referenceId: string;
  readonly sourcePath?: string;
  readonly shots: readonly PracticeReferenceShotV1[];
  readonly styleFingerprint: string;
  readonly perceptualSignature?: string;
  readonly video?: PracticeReferenceVideoV1;
  readonly excludedRanges?: readonly PracticeReferenceExcludedRangeV1[];
  readonly evidenceRefs: readonly string[];
}

export interface PracticeSourceIndexV1 {
  readonly indexId: string;
  readonly sourceIds: readonly string[];
  readonly videoSourceIds: readonly string[];
  readonly audioSourceIds: readonly string[];
  readonly videoPerceptualSignatures?: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface PracticeSceneSourceTimePointV1 {
  readonly referenceTimeMs: number;
  readonly sourceTimeMs: number;
  readonly similarity: number;
}

export type PracticeSceneTemporalBehaviorV1 =
  | "FORWARD"
  | "REVERSE"
  | "FORWARD_THEN_REWIND"
  | "COMPLEX";

export interface PracticeTemporalRewindV1 {
  readonly detected: true;
  readonly referenceStartMs: number;
  readonly referenceEndMs: number;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly rewindSpanMs: number;
  readonly confidence: number;
}

export type PracticeSceneSelectionModeV1 =
  | "VISUAL_BEST"
  | "REFERENCE_CONTINUITY_PRIOR"
  | "GEOMETRIC_RESCUE";

export interface PracticeSceneFramingPointV1 {
  readonly referenceTimeMs: number;
  readonly positionX: number;
  readonly positionY: number;
  readonly scalePercent: number;
  readonly rotationDegrees: number;
  readonly confidence: number;
}

export interface PracticeSceneFramingProofV1 {
  readonly stable: boolean;
  readonly dynamic?: boolean;
  readonly anchorCount: number;
  readonly stableAnchorCount: number;
  readonly stableAnchorFraction: number;
  readonly positionX: number;
  readonly positionY: number;
  readonly scalePercent: number;
  readonly rotationDegrees: number;
  readonly maxPositionDriftPx: number;
  readonly maxScaleDeviationPercent: number;
  readonly maxRotationDeviationDegrees: number;
  readonly confidence: number;
  readonly dynamicConfidence?: number;
  readonly trajectory?: readonly PracticeSceneFramingPointV1[];
}

export interface PracticeSceneGeometricProofV1 {
  readonly anchorCount: number;
  readonly strongAnchorCount: number;
  readonly strongAnchorFraction: number;
  readonly meanSupport: number;
  readonly minimumSupport: number;
  readonly maximumInlierCount: number;
  readonly meanInlierRatio: number;
  readonly meanCoverage: number;
  readonly framing?: PracticeSceneFramingProofV1;
}

export interface PracticeSceneMatchV1 {
  readonly shotId: string;
  readonly sourceId: string;
  readonly sourcePath?: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly direction: "FORWARD" | "REVERSE";
  readonly playbackRate: number;
  readonly trajectory?: readonly PracticeSceneSourceTimePointV1[];
  readonly temporalBehavior?: PracticeSceneTemporalBehaviorV1;
  readonly rewind?: PracticeTemporalRewindV1;
  readonly appearanceSimilarity: number;
  readonly temporalSimilarity: number;
  readonly motionSimilarity: number;
  readonly geometricProof?: PracticeSceneGeometricProofV1;
  readonly confidence: number;
  readonly candidateScore?: number;
  readonly runnerUpScore?: number;
  readonly candidateMargin?: number;
  readonly referenceBoundaryContinuity?: number;
  readonly selectionMode?: PracticeSceneSelectionModeV1;
  readonly evidenceRefs: readonly string[];
}

export type PracticeReferenceWindowRelationV1 =
  | "SHOT_INTERIOR"
  | "CUT_IN"
  | "CUT_OUT"
  | "CUT_SPAN";

export type PracticeBeatAlignmentV1 = "ON_BEAT" | "NEAR_BEAT" | "OFF_BEAT";

export interface PracticeReferenceBeatCueV1 {
  readonly eventMs: number;
  readonly nearestBeatMs: number;
  readonly beatIntervalMs: number;
  readonly offsetMs: number;
  readonly offsetBeats: number;
  readonly alignment: PracticeBeatAlignmentV1;
  readonly confidence: number;
  readonly evidenceRefs: readonly string[];
}

export interface PracticeReferenceMotionEnvelopeV1 {
  readonly peakEnergy: number;
  readonly motionPeakPhase: number;
  readonly accelerationPeak: number;
  readonly displacementPeak: number;
  readonly displacementDirection: Readonly<{ x: number; y: number }>;
  readonly blurPeak: number;
  readonly distortionPeak: number;
  readonly scaleRange: number;
  readonly rotationRange: number;
  readonly recoveryDurationMs: number;
}

export type PracticeObjectMotionRelationV1 =
  | "CO_MOVING"
  | "SUBJECT_DOMINANT"
  | "BACKGROUND_DOMINANT"
  | "DIVERGENT"
  | "MASK_DRIVEN"
  | "OCCLUSION_DRIVEN";

export interface PracticeReferenceObjectCueV1 {
  readonly objectAware: boolean;
  readonly relation: PracticeObjectMotionRelationV1;
  readonly evidencePersistence: number;
  readonly subjectSeparationPeak: number;
  readonly subjectBackgroundDivergencePeak: number;
  readonly subjectMotionPeak: number;
  readonly backgroundMotionPeak: number;
  readonly subjectMotionDirection: Readonly<{ x: number; y: number }>;
  readonly backgroundMotionDirection: Readonly<{ x: number; y: number }>;
  readonly maskCoveragePeak: number;
  readonly validatedMaskCoveragePeak?: number;
  readonly maskTruthValidated?: boolean;
  readonly subjectIdentityContinuityVerified?: boolean;
  readonly subjectIdentityCoverage?: number;
  readonly occlusionPeak: number;
}

export interface PracticeReferenceSubjectMotionSampleV1 {
  readonly timeMs: number;
  readonly trackState: "OBSERVED" | "PREDICTED_LOW_MOTION" | "PREDICTED_OCCLUDED";
  readonly identityConfidence: number;
  readonly visibility: number;
  readonly subjectMotion: Readonly<{ x: number; y: number }>;
  readonly backgroundMotion: Readonly<{ x: number; y: number }>;
  readonly relativeMotion: Readonly<{ x: number; y: number }>;
  readonly subjectBoundingBox?: readonly [number, number, number, number];
  readonly evidenceRefs: readonly string[];
}

export interface PracticeReferenceSubjectMotionTrackV1 {
  readonly schema: "editflow.practice-reference-subject-motion-track.v1";
  readonly trackId: string;
  readonly shotId: string;
  readonly semanticId: string;
  readonly referenceStartMs: number;
  readonly referenceEndMs: number;
  readonly sampleCount: number;
  readonly identityCoverage: number;
  readonly observedCoverage: number;
  readonly meanIdentityConfidence: number;
  readonly continuityVerified: boolean;
  readonly usableForReconstruction: boolean;
  readonly relativeMotionPeak: number;
  readonly relativeMotionMean: number;
  readonly relativeMotionDirection: Readonly<{ x: number; y: number }>;
  readonly samples: readonly PracticeReferenceSubjectMotionSampleV1[];
  readonly evidenceRefs: readonly string[];
}

export interface PracticeReferenceTemporalCueV1 {
  readonly behavior: PracticeSceneTemporalBehaviorV1;
  readonly rewind: PracticeTemporalRewindV1 | null;
  readonly evidenceShotIds: readonly string[];
}

export interface PracticeReferenceEffectWindowV1 {
  readonly windowId: string;
  readonly effectFamilyId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly anchorMs: number;
  readonly shotIds: readonly string[];
  readonly relation: PracticeReferenceWindowRelationV1;
  readonly transitionBoundaryMs: number | null;
  readonly anchorBeatCue?: PracticeReferenceBeatCueV1;
  readonly transitionBeatCue?: PracticeReferenceBeatCueV1;
  readonly motion: PracticeReferenceMotionEnvelopeV1;
  readonly objectCue: PracticeReferenceObjectCueV1;
  readonly temporalCue: PracticeReferenceTemporalCueV1;
  readonly evidenceRefs: readonly string[];
}

export interface PracticeReferenceCutV1 {
  readonly cutId: string;
  readonly atMs: number;
  readonly outgoingShotId: string;
  readonly incomingShotId: string;
  readonly transitionWindowIds: readonly string[];
  readonly beatCue?: PracticeReferenceBeatCueV1;
}

export interface PracticeReferenceAnatomyV1 {
  readonly schema: "editflow.practice-reference-anatomy.v1";
  readonly referenceId: string;
  readonly cuts: readonly PracticeReferenceCutV1[];
  readonly effectWindows: readonly PracticeReferenceEffectWindowV1[];
  readonly subjectMotionTracks: readonly PracticeReferenceSubjectMotionTrackV1[];
  readonly rewindShotIds: readonly string[];
  readonly objectAwareWindowIds: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface PracticeAudioSegmentMatchV1 {
  readonly segmentId: string;
  readonly referenceStartMs: number;
  readonly referenceEndMs: number;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly playbackRate: number;
  readonly correlation: number;
  readonly confidence: number;
  readonly evidenceRefs: readonly string[];
}

export interface PracticeAudioBeatGridV1 {
  readonly beatTimesMs: readonly number[];
  readonly estimatedBpm: number;
  readonly confidence: number;
  readonly evidenceRefs: readonly string[];
}

export interface PracticeAudioMatchV1 {
  readonly matchId: string;
  readonly sourceId: string;
  readonly sourcePath?: string;
  readonly segments: readonly PracticeAudioSegmentMatchV1[];
  readonly beatGrid?: PracticeAudioBeatGridV1;
  readonly overallConfidence: number;
  readonly evidenceRefs: readonly string[];
}

export interface PracticeContentBaselineV1 {
  readonly baselineId: string;
  readonly timelineRef: string;
  readonly audioTimelineRef?: string;
  readonly evidenceRefs: readonly string[];
}

export interface PracticeSimilarityBreakdownV1 {
  readonly sceneIdentity: number;
  readonly temporalAlignment: number;
  readonly cutTiming: number;
  readonly framing: number;
  readonly motion: number;
  readonly effectFidelity: number;
  readonly transitionFidelity: number;
  readonly colorFinish: number;
  readonly pixelStructure: number;
}

export interface PracticeSimilarityReportV1 {
  readonly schema: "editflow.practice-similarity.v1";
  readonly breakdown: PracticeSimilarityBreakdownV1;
  readonly definingEffectCoverage: number;
  readonly wrongSceneCount: number;
  readonly unmatchedSceneCount: number;
  readonly overallSimilarity: number;
  readonly passed: boolean;
  readonly reasons: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface PracticeSemanticPatchV1 {
  readonly patchId: string;
  readonly invariantId: string;
  readonly nodeId: string;
  readonly parameter: string;
  readonly previousValue: number;
  readonly nextValue: number;
  readonly rationale: string;
}

export interface PracticeDecisionTraceV1 {
  readonly decisionId: string;
  readonly shotId?: string;
  readonly cueIds: readonly string[];
  readonly constructionIds: readonly string[];
  readonly rationaleCodes: readonly string[];
  readonly semanticPatches?: readonly PracticeSemanticPatchV1[];
}

export interface PracticeReconstructionOutputV1 {
  readonly renderRef: string;
  readonly decisionTraces: readonly PracticeDecisionTraceV1[];
  readonly evidenceRefs: readonly string[];
}

export interface PracticeAttemptV1 {
  readonly attempt: number;
  readonly renderRef: string;
  readonly report: PracticeSimilarityReportV1;
  readonly decisionTraces: readonly PracticeDecisionTraceV1[];
  readonly elapsedMs: number;
  readonly evidenceRefs: readonly string[];
}

export interface PracticeEpisodeV1 {
  readonly sessionId: string;
  readonly selectedEditTypeId: string;
  readonly allocatedEditTypeId?: string;
  readonly styleFingerprint: string;
  readonly baselineId: string;
  readonly matches: readonly PracticeSceneMatchV1[];
  readonly audioMatch: PracticeAudioMatchV1 | null;
  readonly attempts: readonly PracticeAttemptV1[];
  readonly mastered: boolean;
  readonly bestAttempt: PracticeAttemptV1 | null;
}

export interface PracticeSubjectIdentitySummaryV1 {
  readonly tracked: boolean;
  readonly continuityVerified: boolean;
  readonly dominantSemanticId: string | null;
  readonly semanticIdentityCount: number;
  readonly identitySwitchCount: number;
  readonly frameCount: number;
  readonly trackedFrameCount: number;
  readonly observedFrameCount: number;
  readonly predictedFrameCount: number;
  readonly lostFrameCount: number;
  readonly identityCoverage: number;
  readonly observedCoverage: number;
  readonly meanIdentityConfidence: number;
  readonly lowMotionFrameCount: number;
  readonly lowMotionSurvived: boolean;
  readonly occlusionFrameCount: number;
  readonly occlusionSurvived: boolean;
  readonly validatedMaskFrameCount: number;
  readonly validatedMaskCoverage: number;
  readonly validatedMaskSources: readonly string[];
  readonly reasons: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface PracticeObjectAwareWindowProofV1 {
  readonly referenceWindowId: string;
  readonly renderWindowId: string | null;
  readonly effectFamilyId: string;
  readonly relation: PracticeObjectMotionRelationV1;
  readonly relationMatched: boolean;
  readonly subjectRelativeDirectionRequired: boolean;
  readonly subjectRelativeDirectionVerified: boolean;
  readonly subjectRelativeDirectionScore: number;
  readonly referenceSubjectRelativeDirection: Readonly<{ x: number; y: number }>;
  readonly renderSubjectRelativeDirection: Readonly<{ x: number; y: number }> | null;
  readonly subjectIdentityRequired?: boolean;
  readonly subjectIdentityVerified?: boolean;
  readonly maskTruthRequired?: boolean;
  readonly maskTruthVerified?: boolean;
  readonly referenceSubjectIdentity?: PracticeSubjectIdentitySummaryV1;
  readonly renderSubjectIdentity?: PracticeSubjectIdentitySummaryV1 | null;
  readonly score: number;
  readonly passed: boolean;
  readonly reasons: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface PracticeObjectAwareProofV1 {
  readonly schema: "editflow.practice-object-aware-proof.v1";
  readonly required: boolean;
  readonly referenceWindowCount: number;
  readonly matchedWindowCount: number;
  readonly passedWindowCount: number;
  readonly overallScore: number;
  readonly verified: boolean;
  readonly windows: readonly PracticeObjectAwareWindowProofV1[];
  readonly reasons: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface PracticeCrossSourceSubjectBindingProofV1 {
  readonly referenceWindowId: string;
  readonly shotId: string;
  readonly sourceId: string;
  readonly referenceTimeMs: number;
  readonly sourceTimeMs: number;
  readonly referenceSemanticId: string;
  readonly sourceSemanticId: string | null;
  readonly referenceSubjectBox: readonly [number, number, number, number];
  readonly sourceSubjectBox: readonly [number, number, number, number] | null;
  readonly confidence: number;
  readonly verified: boolean;
  readonly reason: string | null;
  readonly algorithmId?: string;
  readonly sourceVideo?: Readonly<{
    fps: number;
    frameCount: number;
    width: number;
    height: number;
    durationMs: number;
    sampleTimeMs: number;
  }>;
  readonly evidenceRefs: readonly string[];
}

export interface PracticeCrossSourceSubjectProofV1 {
  readonly schema: "editflow.practice-cross-source-subject-proof.v1";
  readonly required: boolean;
  readonly referenceWindowCount: number;
  readonly requiredBindingCount: number;
  readonly verifiedBindingCount: number;
  readonly verifiedWindowCount: number;
  readonly verified: boolean;
  readonly bindings: readonly PracticeCrossSourceSubjectBindingProofV1[];
  readonly reasons: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface PracticeMasteryProofV1 {
  readonly schema: "editflow.practice-mastery-proof.v1";
  readonly sessionId: string;
  readonly editTypeId: string;
  readonly referenceId: string;
  readonly sourceIndexId: string;
  readonly referenceFingerprint: string;
  readonly sourceFingerprint: string;
  readonly sourceMediaSha256?: readonly string[];
  readonly referencePerceptualSignature?: string;
  readonly sourcePerceptualSignatures?: readonly string[];
  readonly finalRenderRef: string;
  readonly minimumSimilarity: number;
  readonly exactSceneConfidence: number;
  readonly effectFamilyIds: readonly string[];
  readonly objectAwareProof?: PracticeObjectAwareProofV1;
  readonly crossSourceSubjectProof?: PracticeCrossSourceSubjectProofV1;
  readonly report: PracticeSimilarityReportV1;
  readonly matches: readonly PracticeSceneMatchV1[];
  readonly audioMatch: PracticeAudioMatchV1 | null;
  readonly evidenceRefs: readonly string[];
  readonly verifiedAt: string;
}

export type EditTypeBehaviorOutcomeV1 =
  | "MASTERED_SUPPORT"
  | "FAILED_ATTEMPT"
  | "HUMAN_REVIEW";

export interface EditTypeBehaviorEvidenceV1 {
  readonly evidenceId: string;
  readonly sessionId: string;
  readonly attempt: number;
  readonly outcome: EditTypeBehaviorOutcomeV1;
  readonly cueIds: readonly string[];
  readonly constructionIds: readonly string[];
  readonly rationaleCodes: readonly string[];
  readonly semanticPatches: readonly PracticeSemanticPatchV1[];
  readonly overallSimilarity: number;
  readonly definingEffectCoverage: number;
  readonly elapsedMs: number;
}

export type GptCapabilityGapKindV1 = "RECIPE_SKILL" | "EXECUTION_CAPABILITY";
export type GptCapabilityGapStatusV1 = "OPEN" | "RESOLVED" | "BLOCKED";
export type GptResearchSourceKindV1 =
  | "TUTORIAL_DRIVE"
  | "ADOBE_DOCUMENTATION"
  | "INSTALLED_ADOBE_FEATURE"
  | "PLUGIN_DOCUMENTATION"
  | "PROFESSIONAL_TUTORIAL"
  | "WEB"
  | "INTERNAL_EVIDENCE";
export type GptSkillMaturityV1 =
  | "HYPOTHESIS"
  | "RECONSTRUCTED"
  | "AE_PROVEN"
  | "TRANSFER_VERIFIED";

export interface GptTutorialTechniqueV1 {
  readonly what: string;
  readonly whenWhy: string;
  readonly how: string;
  readonly access: string;
  readonly proof: string;
  readonly transfer: string;
}

export interface GptTutorialCausalCompilationV1 {
  readonly schema: "editflow.gpt-tutorial-causal-compilation.v1";
  readonly compilerVersion: 1;
  readonly targetSkillId: string;
  readonly tutorialId: string;
  readonly tutorialSkillId: string;
  readonly sourceRef: string;
  readonly analysisFingerprint: string;
  readonly constructionPattern: string;
  readonly capabilityIds: readonly string[];
  readonly adaptationNotes: string;
  readonly causalModel: GptSkillCausalModelV1;
  readonly evidenceRefs: readonly string[];
}

export interface GptResearchSourceV1 {
  readonly sourceId: string;
  readonly kind: GptResearchSourceKindV1;
  readonly title: string;
  readonly uri?: string;
  readonly notes?: string;
  readonly tutorialTechnique?: GptTutorialTechniqueV1;
  readonly tutorialCompilation?: GptTutorialCausalCompilationV1;
}

export interface GptCapabilityGapV1 {
  readonly gapId: string;
  readonly kind: GptCapabilityGapKindV1;
  readonly requestedBehavior: string;
  readonly missingCapabilityIds: readonly string[];
  readonly status: GptCapabilityGapStatusV1;
  readonly resolutionSkillId?: string;
  readonly evidenceRefs: readonly string[];
}

export interface GptSkillCausalModelV1 {
  readonly triggerConditions: readonly string[];
  readonly invariants: readonly string[];
  readonly adaptationAxes: readonly string[];
  readonly failureSignals: readonly string[];
  readonly repairStrategies: readonly string[];
  readonly transferCriteria: readonly string[];
}

export type GptSkillMachineEvidenceSourceV1 =
  | "CUE_ID"
  | "RATIONALE_CODE"
  | "CONSTRUCTION_ID"
  | "EVIDENCE_REF"
  | "PROOF_EFFECT_FAMILY"
  | "PROOF_OBJECT_AWARE";

export type GptSkillMachineEvidenceMatchV1 = "EXACT" | "PREFIX";

export interface GptSkillMachineEvidencePredicateV1 {
  readonly source: GptSkillMachineEvidenceSourceV1;
  readonly match: GptSkillMachineEvidenceMatchV1;
  readonly value: string;
}

export interface GptSkillMachineInvariantRuleV1 {
  readonly invariant: string;
  readonly evidence: readonly GptSkillMachineEvidencePredicateV1[];
}

export interface GptSkillMachineUseSignatureV1 {
  readonly schema: "editflow.gpt-skill-machine-use-signature.v1";
  readonly invariantRules: readonly GptSkillMachineInvariantRuleV1[];
}

export interface GptLearnedSkillV1 {
  readonly skillId: string;
  readonly title: string;
  readonly requestedBehavior: string;
  readonly maturity: GptSkillMaturityV1;
  readonly constructionPattern: string;
  readonly capabilityIds: readonly string[];
  readonly adaptationNotes?: string;
  readonly causalModel?: GptSkillCausalModelV1;
  readonly machineUseSignature?: GptSkillMachineUseSignatureV1;
  readonly provenSessionIds?: readonly string[];
  readonly researchSources: readonly GptResearchSourceV1[];
  readonly evidenceRefs: readonly string[];
  readonly learnedAt: string;
}

export type PracticeMasteryScopeV1 =
  | "REFERENCE_VERIFIED"
  | "TRANSFER_VERIFIED";

export type PracticeVerifiedSubjectMaskSourceV1 =
  | "SEGMENTATION"
  | "AE_TRACKED_MASK"
  | "ROTO_BRUSH";

export interface PracticeSubjectIdentityMemoryV1 {
  readonly memoryId: string;
  readonly sessionId: string;
  readonly referenceFingerprint: string;
  readonly sourceFingerprint: string;
  readonly sourceMediaSha256: readonly string[];
  readonly sourceVideoSha256: string;
  readonly referenceWindowId: string;
  readonly shotId: string;
  readonly sourceId: string;
  readonly referenceSemanticId: string;
  readonly sourceSemanticId: string;
  readonly referenceTimeMs: number;
  readonly sourceTimeMs: number;
  readonly referenceSubjectBox: readonly [number, number, number, number];
  readonly sourceSubjectBox: readonly [number, number, number, number];
  readonly confidence: number;
  readonly algorithmId: string;
  readonly sourceVideo: Readonly<{
    fps: number;
    frameCount: number;
    width: number;
    height: number;
    durationMs: number;
    sampleTimeMs: number;
  }>;
  readonly maskSources: readonly PracticeVerifiedSubjectMaskSourceV1[];
  readonly evidenceRefs: readonly string[];
  readonly verifiedAt: string;
}

export interface PracticeMasteryRecordV1 {
  readonly sessionId: string;
  readonly scope: PracticeMasteryScopeV1;
  readonly proofRef: string;
  readonly referenceId: string;
  readonly sourceIndexId: string;
  readonly referenceFingerprint: string;
  readonly sourceFingerprint: string;
  readonly sourceMediaSha256?: readonly string[];
  readonly referencePerceptualSignature?: string;
  readonly sourcePerceptualSignatures?: readonly string[];
  readonly finalRenderRef: string;
  readonly overallSimilarity: number;
  readonly definingEffectCoverage: number;
  readonly effectFamilyIds: readonly string[];
  readonly subjectIdentityMemories?: readonly PracticeSubjectIdentityMemoryV1[];
  readonly verifiedAt: string;
}

export interface PracticeSkillUseAttestationV1 {
  readonly skillId: string;
  readonly verified: boolean;
  readonly matchedInvariantCount: number;
  readonly requiredInvariantCount: number;
  readonly matchedConstructionIds: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly reasons: readonly string[];
}

export interface PracticeHeldOutBenchmarkCaseV1 {
  readonly caseId: string;
  readonly sessionId: string;
  readonly referenceFingerprint: string;
  readonly sourceFingerprint: string;
  readonly sourceMediaSha256?: readonly string[];
  readonly referencePerceptualSignature?: string;
  readonly sourcePerceptualSignatures?: readonly string[];
  readonly effectFamilyIds: readonly string[];
  /** Non-authoritative GPT audit claims retained for diagnostics only. */
  readonly appliedSkillIds: readonly string[];
  /** TRANSFER_VERIFIED skills independently proven from persisted Practice/AE evidence. */
  readonly verifiedSkillUseIds: readonly string[];
  readonly skillUseAttestations: readonly PracticeSkillUseAttestationV1[];
  readonly objectAwareVerified: boolean;
  readonly subjectRelativeDirectionWindowCount: number;
  readonly subjectRelativeDirectionVerified: boolean;
  readonly overallSimilarity: number;
  readonly definingEffectCoverage: number;
  readonly passed: boolean;
  readonly reasons: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface PracticeHeldOutBenchmarkPolicyV1 {
  readonly minimumCases: number;
  readonly maximumCases: number;
  readonly minimumSimilarity: number;
  readonly minimumDefiningEffectCoverage: number;
  readonly minimumObjectAwareCases: number;
  readonly minimumSubjectRelativeDirectionCases: number;
}

export interface PracticeHeldOutBenchmarkReportV1 {
  readonly schema: "editflow.practice-held-out-benchmark.v1";
  readonly editTypeId: string;
  readonly policy: PracticeHeldOutBenchmarkPolicyV1;
  readonly caseCount: number;
  readonly passedCaseCount: number;
  readonly distinctMaterialPairCount: number;
  /** Effect families demonstrated by held-out cases that actually passed the machine gate. */
  readonly distinctEffectFamilyCount: number;
  /** Authoritative effect families present in TRANSFER_VERIFIED Practice mastery records. */
  readonly requiredEffectFamilyIds: readonly string[];
  /** Required effect families covered by at least one passing held-out case. */
  readonly verifiedEffectFamilyIds: readonly string[];
  readonly missingEffectFamilyIds: readonly string[];
  readonly effectFamilyCoverageVerified: boolean;
  /** TRANSFER_VERIFIED learned skills retained for this Edit Type. */
  readonly requiredLearnedSkillIds: readonly string[];
  /** Required learned skills explicitly exercised by passing held-out cases. */
  readonly verifiedLearnedSkillIds: readonly string[];
  readonly missingLearnedSkillIds: readonly string[];
  readonly learnedSkillCoverageVerified: boolean;
  /** M6.9 professional-benchmark families that passed their canonical machine gates. */
  readonly professionalBenchmarkVerifiedEffectFamilyIds: readonly string[];
  readonly professionalBenchmarkMissingEffectFamilyIds: readonly string[];
  readonly professionalBenchmarkCoverageVerified: boolean;
  readonly professionalBenchmarkFailures: readonly string[];
  readonly professionalBenchmarkEvidenceRefs: readonly string[];
  readonly objectAwareCaseCount: number;
  readonly objectAwareVerified: boolean;
  readonly subjectRelativeDirectionCaseCount: number;
  readonly subjectRelativeDirectionVerified: boolean;
  readonly robust: boolean;
  readonly reasons: readonly string[];
  readonly cases: readonly PracticeHeldOutBenchmarkCaseV1[];
  readonly evidenceRefs: readonly string[];
  readonly evaluatedAt: string;
}

export interface EditTypeGptLearningSummaryV1 {
  readonly practiceSessionIds: readonly string[];
  readonly proCreationSessionIds: readonly string[];
  readonly masteredPracticeSessionIds: readonly string[];
  readonly masteryRecords: readonly PracticeMasteryRecordV1[];
  readonly heldOutCases: readonly PracticeHeldOutBenchmarkCaseV1[];
  readonly heldOutBenchmarks: readonly PracticeHeldOutBenchmarkReportV1[];
  readonly eventCount: number;
  readonly successLessons: readonly string[];
  readonly failureAvoidanceLessons: readonly string[];
  readonly developmentPatterns: readonly string[];
  readonly capabilityGaps: readonly GptCapabilityGapV1[];
  readonly learnedSkills: readonly GptLearnedSkillV1[];
  readonly lastUpdatedAt?: string;
}

export interface EditTypeProfileV1 {
  readonly schema: "editflow.edit-type-profile.v1";
  readonly editTypeId: string;
  readonly title: string;
  readonly choiceWords: readonly string[];
  readonly description?: string;
  readonly revision: number;
  readonly sessionIds: readonly string[];
  readonly masteredSessionIds: readonly string[];
  readonly behaviorEvidence: readonly EditTypeBehaviorEvidenceV1[];
  readonly gptLearning?: EditTypeGptLearningSummaryV1;
}

export type PracticeMaturityStageV1 =
  | "OBSERVED"
  | "RECONSTRUCTED"
  | "VISUAL_MATCH_VERIFIED"
  | "TRANSFER_VERIFIED"
  | "OBJECT_AWARE_VERIFIED"
  | "ROBUST";

export type EditTypeKnowledgeScopeV1 = "ALL_RETAINED" | "TRANSFER_VERIFIED_ONLY";

export interface EditTypeKnowledgeSnapshotV1 {
  readonly editTypeId: string;
  readonly title: string;
  readonly revision: number;
  readonly maturityStage: PracticeMaturityStageV1 | null;
  readonly knowledgeScope: EditTypeKnowledgeScopeV1;
  readonly masteredSessionCount: number;
  readonly referenceVerifiedPracticeSessionCount: number;
  readonly transferVerifiedPracticeSessionCount: number;
  readonly totalSessionCount: number;
  readonly successfulConstructionIds: readonly string[];
  readonly failedConstructionIds: readonly string[];
  readonly successfulSemanticPatches: readonly PracticeSemanticPatchV1[];
  readonly failedSemanticPatches: readonly PracticeSemanticPatchV1[];
  readonly behaviorEvidence: readonly EditTypeBehaviorEvidenceV1[];
  readonly gptLearning: EditTypeGptLearningSummaryV1;
}

export interface PracticeLearningAllocationPromptV1 {
  readonly id: "allocate-practice-learning";
  readonly required: true;
  readonly defaultEditTypeId: string;
  readonly sessionId: string;
  readonly message: string;
}

export interface PracticeSessionRequestV1 {
  readonly sessionId: string;
  readonly mode: EditFlowOperatingModeV1;
  readonly editTypeId: string;
  readonly finish: PracticeMediaInputV1;
  readonly start: readonly PracticeMediaInputV1[];
  readonly minimumSimilarity?: number;
  readonly stretchSimilarity?: number;
  readonly maxAttempts?: number;
  readonly exactSceneConfidence?: number;
  readonly minimumAudioConfidence?: number;
}

export interface PracticeSessionResultV1 {
  readonly schema: "editflow.practice-session-result.v1";
  readonly sessionId: string;
  readonly editTypeId: string;
  readonly status: PracticeSessionStatusV1;
  readonly reference: PracticeReferenceAnalysisV1 | null;
  readonly sourceIndex: PracticeSourceIndexV1 | null;
  readonly matches: readonly PracticeSceneMatchV1[];
  readonly audioMatch: PracticeAudioMatchV1 | null;
  readonly baseline: PracticeContentBaselineV1 | null;
  readonly attempts: readonly PracticeAttemptV1[];
  readonly bestAttempt: PracticeAttemptV1 | null;
  readonly targetSimilarity: number;
  readonly stretchSimilarity: number;
  readonly evidenceRefs: readonly string[];
  readonly reasons: readonly string[];
  readonly allocationPrompt: PracticeLearningAllocationPromptV1 | null;
}

export interface PracticeHomeworkAdaptersV1 {
  analyzeFinish(
    finish: PracticeMediaInputV1,
  ): Promise<PracticeReferenceAnalysisV1>;
  indexStart(
    start: readonly PracticeMediaInputV1[],
  ): Promise<PracticeSourceIndexV1>;
  matchScenes(input: {
    readonly reference: PracticeReferenceAnalysisV1;
    readonly sourceIndex: PracticeSourceIndexV1;
    readonly minimumConfidence: number;
  }): Promise<readonly PracticeSceneMatchV1[]>;
  matchAudio?(input: {
    readonly reference: PracticeReferenceAnalysisV1;
    readonly sourceIndex: PracticeSourceIndexV1;
    readonly minimumConfidence: number;
  }): Promise<PracticeAudioMatchV1 | null>;
  buildContentBaseline(input: {
    readonly reference: PracticeReferenceAnalysisV1;
    readonly matches: readonly PracticeSceneMatchV1[];
    readonly audioMatch: PracticeAudioMatchV1 | null;
  }): Promise<PracticeContentBaselineV1>;
  reconstruct(input: {
    readonly sessionId: string;
    readonly editTypeId: string;
    readonly editTypeKnowledge: EditTypeKnowledgeSnapshotV1;
    readonly attempt: number;
    readonly reference: PracticeReferenceAnalysisV1;
    readonly baseline: PracticeContentBaselineV1;
    readonly matches: readonly PracticeSceneMatchV1[];
    readonly audioMatch?: PracticeAudioMatchV1 | null;
    readonly priorAttempts: readonly PracticeAttemptV1[];
  }): Promise<PracticeReconstructionOutputV1>;
  evaluate(input: {
    readonly reference: PracticeReferenceAnalysisV1;
    readonly renderRef: string;
    readonly minimumSimilarity: number;
  }): Promise<PracticeSimilarityReportV1>;
  recordEpisode?(episode: PracticeEpisodeV1): Promise<void>;
}

export interface PracticeLearningAllocationResultV1 {
  readonly sessionId: string;
  readonly allocatedEditTypeId: string;
  readonly profileRevision: number;
  readonly evidenceCount: number;
}

export interface ProCreationSessionRequestV1 {
  readonly sessionId: string;
  readonly mode: "PRO_CREATION";
  readonly editTypeId: string;
  readonly start: readonly PracticeMediaInputV1[];
}

export interface ProCreationPreparationResultV1 {
  readonly schema: "editflow.pro-creation-preparation.v1";
  readonly sessionId: string;
  readonly status: "READY" | "BLOCKED";
  readonly editTypeId: string;
  readonly knowledge: EditTypeKnowledgeSnapshotV1 | null;
  readonly start: readonly PracticeMediaInputV1[];
  readonly reasons: readonly string[];
}

export interface PracticeVerificationPolicyV1 {
  readonly minimumSimilarity: number;
  readonly exactSceneConfidence: number;
  readonly minimumAudioConfidence: number;
}

export type GptOrchestrationModeV1 = "PRACTICE" | "PRO_CREATION";
export type PracticeRunRoleV1 = "LEARNING" | "HELD_OUT_CERTIFICATION";
export type GptAssignmentStatusV1 =
  | "PENDING"
  | "CLAIMED"
  | "RUNNING"
  | "CANCEL_REQUESTED"
  | "CANCELLED"
  | "COMPLETED"
  | "FAILED";

export type GptLearningStageV1 =
  | "OBSERVATION"
  | "INTERPRETATION"
  | "HYPOTHESIS"
  | "PLAN"
  | "CAPABILITY_GAP"
  | "RESEARCH"
  | "CAPABILITY_IMPLEMENTATION"
  | "CAPABILITY_PROOF"
  | "SKILL_COMMIT"
  | "AE_ACTION"
  | "RENDER"
  | "COMPARISON"
  | "DIAGNOSIS"
  | "CORRECTION"
  | "RESULT"
  | "LESSON";

export type GptLearningOutcomeV1 =
  | "NEUTRAL"
  | "SUCCESS"
  | "FAILURE"
  | "IMPROVED"
  | "REGRESSED";

export interface GptLearningEventV1 {
  readonly schema: "editflow.gpt-learning-event.v1";
  readonly eventId: string;
  readonly sessionId: string;
  readonly editTypeId: string;
  readonly mode: GptOrchestrationModeV1;
  readonly attempt?: number;
  readonly stage: GptLearningStageV1;
  readonly outcome: GptLearningOutcomeV1;
  readonly summary: string;
  readonly detail?: string;
  readonly developmentPattern?: string;
  readonly reusableLesson?: string;
  readonly avoidRepeat?: string;
  readonly capabilityGap?: GptCapabilityGapV1;
  readonly researchSources?: readonly GptResearchSourceV1[];
  readonly learnedSkill?: GptLearnedSkillV1;
  /** Retained skills actually exercised by this event; used by inference-only held-out certification. */
  readonly appliedSkillIds?: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly createdAt: string;
}

export interface GptOrchestrationAssignmentV1 {
  readonly schema: "editflow.gpt-orchestration-assignment.v1";
  readonly assignmentId: string;
  readonly sessionId: string;
  readonly mode: GptOrchestrationModeV1;
  readonly practiceRole: PracticeRunRoleV1 | null;
  readonly editTypeId: string;
  readonly status: GptAssignmentStatusV1;
  readonly finish: PracticeMediaInputV1 | null;
  readonly start: readonly PracticeMediaInputV1[];
  readonly practicePolicy: PracticeVerificationPolicyV1 | null;
  readonly artifactDir: string;
  readonly chatMessage: string;
  readonly createdAt: string;
  readonly claimedAt: string | null;
  readonly claimedBy: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly cancelRequestedAt: string | null;
  readonly finalRenderRef: string | null;
  readonly finalSummary: string | null;
  readonly error: string | null;
}

export interface GptAssignmentCompletionV1 {
  readonly success: boolean;
  readonly finalRenderRef?: string;
  readonly finalSummary: string;
}
