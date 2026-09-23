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
export interface PracticeReferenceVideoV1 {
  readonly fps: number;
  readonly frameCount: number;
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;
}

export interface PracticeReferenceAnalysisV1 {
  readonly referenceId: string;
  readonly sourcePath?: string;
  readonly shots: readonly PracticeReferenceShotV1[];
  readonly styleFingerprint: string;
  readonly video?: PracticeReferenceVideoV1;
  readonly evidenceRefs: readonly string[];
}

export interface PracticeSourceIndexV1 {
  readonly indexId: string;
  readonly sourceIds: readonly string[];
  readonly videoSourceIds: readonly string[];
  readonly audioSourceIds: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface PracticeSceneMatchV1 {
  readonly shotId: string;
  readonly sourceId: string;
  readonly sourcePath?: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly direction: "FORWARD" | "REVERSE";
  readonly playbackRate: number;
  readonly appearanceSimilarity: number;
  readonly temporalSimilarity: number;
  readonly motionSimilarity: number;
  readonly confidence: number;
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

export interface PracticeAudioMatchV1 {
  readonly matchId: string;
  readonly sourceId: string;
  readonly sourcePath?: string;
  readonly segments: readonly PracticeAudioSegmentMatchV1[];
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

export interface PracticeMasteryProofV1 {
  readonly schema: "editflow.practice-mastery-proof.v1";
  readonly sessionId: string;
  readonly editTypeId: string;
  readonly referenceId: string;
  readonly sourceIndexId: string;
  readonly referenceFingerprint: string;
  readonly sourceFingerprint: string;
  readonly finalRenderRef: string;
  readonly minimumSimilarity: number;
  readonly exactSceneConfidence: number;
  readonly effectFamilyIds: readonly string[];
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

export interface GptResearchSourceV1 {
  readonly sourceId: string;
  readonly kind: GptResearchSourceKindV1;
  readonly title: string;
  readonly uri?: string;
  readonly notes?: string;
  readonly tutorialTechnique?: GptTutorialTechniqueV1;
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

export interface GptLearnedSkillV1 {
  readonly skillId: string;
  readonly title: string;
  readonly requestedBehavior: string;
  readonly maturity: GptSkillMaturityV1;
  readonly constructionPattern: string;
  readonly capabilityIds: readonly string[];
  readonly adaptationNotes?: string;
  readonly researchSources: readonly GptResearchSourceV1[];
  readonly evidenceRefs: readonly string[];
  readonly learnedAt: string;
}

export type PracticeMasteryScopeV1 =
  | "REFERENCE_VERIFIED"
  | "TRANSFER_VERIFIED";

export interface PracticeMasteryRecordV1 {
  readonly sessionId: string;
  readonly scope: PracticeMasteryScopeV1;
  readonly proofRef: string;
  readonly referenceId: string;
  readonly sourceIndexId: string;
  readonly referenceFingerprint: string;
  readonly sourceFingerprint: string;
  readonly finalRenderRef: string;
  readonly overallSimilarity: number;
  readonly definingEffectCoverage: number;
  readonly effectFamilyIds: readonly string[];
  readonly verifiedAt: string;
}

export interface PracticeHeldOutBenchmarkCaseV1 {
  readonly caseId: string;
  readonly sessionId: string;
  readonly referenceFingerprint: string;
  readonly sourceFingerprint: string;
  readonly effectFamilyIds: readonly string[];
  readonly objectAwareVerified: boolean;
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
}

export interface PracticeHeldOutBenchmarkReportV1 {
  readonly schema: "editflow.practice-held-out-benchmark.v1";
  readonly editTypeId: string;
  readonly policy: PracticeHeldOutBenchmarkPolicyV1;
  readonly caseCount: number;
  readonly passedCaseCount: number;
  readonly distinctMaterialPairCount: number;
  readonly distinctEffectFamilyCount: number;
  readonly objectAwareCaseCount: number;
  readonly objectAwareVerified: boolean;
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
