import type {
  CapabilityId,
  CapabilityStatus,
  ProofMaturity,
  RouteId,
  RouteKind,
} from "../../core-contracts/src/index.js";

export const TUTORIAL_LEARNING_PHASE = "M5_TUTORIAL_LEARNING_FOUNDATION" as const;
export const TUTORIAL_SKILL_STATES = [
  "OBSERVED",
  "RECONSTRUCTED",
  "TRANSFER_VERIFIED",
  "ROBUST",
] as const;
export type TutorialSkillState = (typeof TUTORIAL_SKILL_STATES)[number];

export type TutorialMinimumSupportStatusV0 = "FULL" | "PARTIAL";

export interface TutorialCapabilityRequirementV0 {
  readonly capabilityId: CapabilityId;
  readonly reason: string;
  readonly minimumProofMaturity: ProofMaturity;
  readonly minimumSupportStatus?: TutorialMinimumSupportStatusV0;
  readonly optional?: boolean;
  readonly preferredRouteKinds?: readonly RouteKind[];
}
export interface TutorialStepObservationV0 {
  readonly stepId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly intent: string;
  readonly action: string;
  readonly observableResult: string;
  readonly capabilityRequirements: readonly TutorialCapabilityRequirementV0[];
  readonly evidenceRefs?: readonly string[];
}

export interface TutorialSkillObservationV0 {
  readonly skillId: string;
  readonly name: string;
  readonly objective: string;
  readonly whenToUse: string;
  readonly adaptationVariables: readonly string[];
  readonly validationCriteria: readonly string[];
  readonly steps: readonly TutorialStepObservationV0[];
}

export interface TutorialAnalysisPacketV0 {
  readonly tutorialId: string;
  readonly title: string;
  readonly sourceRef: string;
  readonly durationMs: number;
  readonly evidenceRefs: readonly string[];
  readonly skills: readonly TutorialSkillObservationV0[];
}

export interface TutorialSkillV0 extends TutorialSkillObservationV0 {
  readonly learningState: TutorialSkillState;
  readonly requiredCapabilities: readonly TutorialCapabilityRequirementV0[];
}

export interface TutorialLessonV0 {
  readonly schemaVersion: 1;
  readonly tutorialId: string;
  readonly title: string;
  readonly sourceRef: string;
  readonly durationMs: number;
  readonly evidenceRefs: readonly string[];
  readonly skills: readonly TutorialSkillV0[];
}

export const TUTORIAL_CAPABILITY_STATES = [
  "READY",
  "PARTIAL",
  "PROOF_REQUIRED",
  "ADAPTER_REQUIRED",
  "UNAVAILABLE",
  "UNREGISTERED",
] as const;
export type TutorialCapabilityState = (typeof TUTORIAL_CAPABILITY_STATES)[number];
export interface TutorialCapabilityUseV0 {
  readonly skillId: string;
  readonly stepId: string;
  readonly reason: string;
  readonly optional: boolean;
}

export interface TutorialCapabilityFindingV0 {
  readonly capabilityId: CapabilityId;
  readonly state: TutorialCapabilityState;
  readonly requiredProofMaturity: ProofMaturity;
  readonly requiredSupportStatus: TutorialMinimumSupportStatusV0;
  readonly actualProofMaturity: ProofMaturity | null;
  readonly registryStatus: CapabilityStatus | null;
  readonly bestRouteId: RouteId | null;
  readonly availableRouteKinds: readonly RouteKind[];
  readonly uses: readonly TutorialCapabilityUseV0[];
  readonly limitations: readonly string[];
}

export type TutorialDevelopmentTaskKind =
  | "REGISTER_CAPABILITY"
  | "ADD_RUNTIME_ROUTE"
  | "RAISE_PROOF_MATURITY"
  | "IMPROVE_PARTIAL_SUPPORT"
  | "UNBLOCK_CAPABILITY";

export interface TutorialDevelopmentTaskV0 {
  readonly kind: TutorialDevelopmentTaskKind;
  readonly capabilityId: CapabilityId;
  readonly blocking: boolean;
  readonly requiredByCount: number;
  readonly rationale: string;
}

export interface TutorialCapabilityDiscoveryReportV0 {
  readonly tutorialId: string;
  readonly generatedAt: string;
  readonly summary: {
    readonly total: number;
    readonly ready: number;
    readonly blocked: number;
    readonly optionalGaps: number;
  };
  readonly findings: readonly TutorialCapabilityFindingV0[];
  readonly developmentQueue: readonly TutorialDevelopmentTaskV0[];
}

export type TutorialProofKind = "RECONSTRUCTION" | "TRANSFER" | "ROBUSTNESS";

export interface TutorialSkillProofV0 {
  readonly skillId: string;
  readonly kind: TutorialProofKind;
  readonly passed: boolean;
  readonly evidenceRefs: readonly string[];
}
export interface TutorialUploadV0 {
  readonly uploadId: string;
  readonly mediaRef: string;
  readonly transcriptRef?: string;
  readonly projectFileRef?: string;
  readonly sourceMediaRefs?: readonly string[];
  readonly referenceRenderRef?: string;
}

export interface TutorialAnalyzerV0 {
  analyze(upload: TutorialUploadV0): Promise<TutorialAnalysisPacketV0>;
}

export interface TutorialLearningResultV0 {
  readonly lesson: TutorialLessonV0;
  readonly capabilityReport: TutorialCapabilityDiscoveryReportV0;
}
