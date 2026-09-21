export type EditFlowOperatingModeV1 = "PRACTICE" | "PRO_CREATION";
export type PracticeMediaRoleV1 = "FINISH_REFERENCE" | "START_SOURCE";
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
export interface PracticeReferenceAnalysisV1 {
  readonly referenceId: string;
  readonly shots: readonly PracticeReferenceShotV1[];
  readonly styleFingerprint: string;
  readonly evidenceRefs: readonly string[];
}

export interface PracticeSourceIndexV1 {
  readonly indexId: string;
  readonly sourceIds: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface PracticeSceneMatchV1 {
  readonly shotId: string;
  readonly sourceId: string;
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

export interface PracticeContentBaselineV1 {
  readonly baselineId: string;
  readonly timelineRef: string;
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

export interface PracticeDecisionTraceV1 {
  readonly decisionId: string;
  readonly shotId?: string;
  readonly cueIds: readonly string[];
  readonly constructionIds: readonly string[];
  readonly rationaleCodes: readonly string[];
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
  readonly evidenceRefs: readonly string[];
}

export interface PracticeEpisodeV1 {
  readonly sessionId: string;
  readonly styleFingerprint: string;
  readonly baselineId: string;
  readonly matches: readonly PracticeSceneMatchV1[];
  readonly attempts: readonly PracticeAttemptV1[];
  readonly mastered: boolean;
  readonly bestAttempt: PracticeAttemptV1 | null;
}

export interface PracticeSessionRequestV1 {
  readonly sessionId: string;
  readonly mode: EditFlowOperatingModeV1;
  readonly finish: PracticeMediaInputV1;
  readonly start: readonly PracticeMediaInputV1[];
  readonly minimumSimilarity?: number;
  readonly stretchSimilarity?: number;
  readonly maxAttempts?: number;
  readonly exactSceneConfidence?: number;
}
export interface PracticeSessionResultV1 {
  readonly schema: "editflow.practice-session-result.v1";
  readonly sessionId: string;
  readonly status: PracticeSessionStatusV1;
  readonly reference: PracticeReferenceAnalysisV1 | null;
  readonly sourceIndex: PracticeSourceIndexV1 | null;
  readonly matches: readonly PracticeSceneMatchV1[];
  readonly baseline: PracticeContentBaselineV1 | null;
  readonly attempts: readonly PracticeAttemptV1[];
  readonly bestAttempt: PracticeAttemptV1 | null;
  readonly targetSimilarity: number;
  readonly stretchSimilarity: number;
  readonly evidenceRefs: readonly string[];
  readonly reasons: readonly string[];
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
  buildContentBaseline(input: {
    readonly reference: PracticeReferenceAnalysisV1;
    readonly matches: readonly PracticeSceneMatchV1[];
  }): Promise<PracticeContentBaselineV1>;
  reconstruct(input: {
    readonly sessionId: string;
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
