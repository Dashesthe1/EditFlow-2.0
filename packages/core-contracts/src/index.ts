export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type ProjectRevision = Brand<string, "ProjectRevision">;
export type ProjectFingerprint = Brand<string, "ProjectFingerprint">;
export type EnvironmentFingerprint = Brand<string, "EnvironmentFingerprint">;
export type CapabilityId = Brand<string, "CapabilityId">;
export type OperationId = Brand<string, "OperationId">;
export type TransactionId = Brand<string, "TransactionId">;
export type SceneEntityId = Brand<string, "SceneEntityId">;
export type RecipeId = Brand<string, "RecipeId">;
export type PlanId = Brand<string, "PlanId">;
export type PlanHash = Brand<string, "PlanHash">;
export type RouteId = Brand<string, "RouteId">;
export type RollbackBoundaryId = Brand<string, "RollbackBoundaryId">;

export const asProjectRevision = (value: string): ProjectRevision => value as ProjectRevision;
export const asProjectFingerprint = (value: string): ProjectFingerprint => value as ProjectFingerprint;
export const asEnvironmentFingerprint = (value: string): EnvironmentFingerprint => value as EnvironmentFingerprint;
export const asCapabilityId = (value: string): CapabilityId => value as CapabilityId;
export const asOperationId = (value: string): OperationId => value as OperationId;
export const asTransactionId = (value: string): TransactionId => value as TransactionId;
export const asPlanId = (value: string): PlanId => value as PlanId;
export const asPlanHash = (value: string): PlanHash => value as PlanHash;
export const asRouteId = (value: string): RouteId => value as RouteId;
export const asRollbackBoundaryId = (value: string): RollbackBoundaryId => value as RollbackBoundaryId;

export const CAPABILITY_STATUSES = [
  "FULL",
  "PARTIAL",
  "ADAPTER_REQUIRED",
  "UI_FALLBACK",
  "UNAVAILABLE",
] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

export const PROOF_MATURITY = [
  "DECLARED",
  "STRUCTURAL",
  "VISUAL",
  "ROLLBACK",
  "TRANSFER",
  "ROBUST",
] as const;
export type ProofMaturity = (typeof PROOF_MATURITY)[number];

export const RISK_CLASSES = [
  "R0_READ_ONLY",
  "R1_REVERSIBLE",
  "R2_STRUCTURAL",
  "R3_DESTRUCTIVE",
  "R4_EXTERNAL_UI",
] as const;
export type RiskClass = (typeof RISK_CLASSES)[number];

export const OPERATION_OUTCOMES = [
  "APPLIED",
  "NO_OP",
  "REJECTED",
  "FAILED",
] as const;
export type OperationOutcome = (typeof OPERATION_OUTCOMES)[number];

export const IDEMPOTENCY_CLASSES = [
  "IDEMPOTENT",
  "CHECK_THEN_APPLY",
  "NON_IDEMPOTENT",
] as const;
export type IdempotencyClass = (typeof IDEMPOTENCY_CLASSES)[number];

export const ROUTE_KINDS = [
  "NATIVE_TYPED",
  "HOST_ADAPTER",
  "SUBSYSTEM_ADAPTER",
  "PLUGIN_ADAPTER",
  "GUARDED_UI",
] as const;
export type RouteKind = (typeof ROUTE_KINDS)[number];

export const FALLBACK_POLICIES = [
  "FORBID",
  "EXPLICIT_ONLY",
  "ALLOW_VERIFIED_EQUIVALENT",
] as const;
export type FallbackPolicy = (typeof FALLBACK_POLICIES)[number];

export const TRANSACTION_STATES = [
  "OBSERVED",
  "PREFLIGHTED",
  "FROZEN",
  "EXECUTING",
  "VERIFYING",
  "COMMITTED",
  "ROLLED_BACK",
  "COMPENSATED",
  "RECOVERY_REQUIRED",
  "REJECTED",
  "FAILED",
] as const;
export type TransactionState = (typeof TRANSACTION_STATES)[number];

export const GROUP_STATES = [
  "PENDING",
  "EXECUTING",
  "COMMITTED",
  "ROLLED_BACK",
  "RECOVERY_REQUIRED",
] as const;
export type GroupState = (typeof GROUP_STATES)[number];

export const ERROR_CATEGORIES = [
  "VALIDATION_ERROR",
  "CAPABILITY_UNAVAILABLE",
  "SEMANTIC_BINDING_UNRESOLVED",
  "STALE_PROJECT_STATE",
  "HOST_CONFLICT",
  "ADAPTER_FAILURE",
  "VISUAL_PROOF_FAILURE",
  "ROLLBACK_FAILURE",
  "EXTERNAL_UI_UNEXPECTED_STATE",
  "ENVIRONMENT_DEPENDENCY_MISSING",
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export interface EditFlowErrorShape {
  readonly category: ErrorCategory;
  readonly code: string;
  readonly message: string;
  readonly capabilityId?: CapabilityId;
  readonly operationId?: OperationId;
  readonly expected?: unknown;
  readonly actual?: unknown;
  readonly recovery?: string;
  readonly ledgerRef?: string;
}

export interface CapabilityRoute {
  readonly routeId: RouteId;
  readonly kind: RouteKind;
  readonly available: boolean;
  readonly adapterVersion?: string | null;
  readonly limitations?: readonly string[];
}

export interface CapabilityRecord {
  readonly id: CapabilityId;
  readonly domain: string;
  readonly description: string;
  readonly status: CapabilityStatus;
  readonly proofMaturity: ProofMaturity;
  readonly routes: readonly CapabilityRoute[];
  readonly requiredEnvironment?: Readonly<Record<string, unknown>>;
  readonly inputSchemaRef?: string | null;
  readonly outputSchemaRef?: string | null;
  readonly readbackStrategy: string;
  readonly visualProofProfile?: string | null;
  readonly rollbackStrategy: string;
  readonly riskClass: RiskClass;
  readonly lastVerifiedEnvironmentFingerprint?: EnvironmentFingerprint | null;
  readonly limitations?: readonly string[];
  readonly fallbackPolicy: FallbackPolicy;
}

export interface ObservedProjectState {
  readonly projectId: string;
  readonly projectRevision: ProjectRevision;
  readonly projectFingerprint: ProjectFingerprint;
  readonly environmentFingerprint: EnvironmentFingerprint;
}

export interface ExecutionPlanBinding {
  readonly role: string;
  readonly entityId: string;
  readonly confidence: number;
  readonly evidenceRefs?: readonly string[];
}

export interface ExecutionPlanOperation {
  readonly operationId: OperationId;
  readonly capabilityId: CapabilityId;
  readonly routeId: RouteId;
  readonly dependsOn: readonly OperationId[];
  readonly idempotency: IdempotencyClass;
  readonly riskClass: RiskClass;
  readonly input: Readonly<Record<string, unknown>>;
  readonly expectedReadback?: Readonly<Record<string, unknown>>;
  readonly rollbackBoundaryId?: RollbackBoundaryId | null;
}

export interface ExecutionPlanCheckpoint {
  readonly checkpointId: string;
  readonly afterOperationIds: readonly OperationId[];
  readonly kind: "STRUCTURAL" | "VISUAL" | "STRUCTURAL_AND_VISUAL";
  readonly profile?: string | null;
}

export interface ExecutionPlanRollbackBoundary {
  readonly id: RollbackBoundaryId;
  readonly strategy: "RESTORE_SNAPSHOT" | "REMOVE_TRANSACTION_OWNED" | "COMPENSATE" | "RECOVERY_CHECKPOINT";
  readonly notes?: string;
}

export interface ExecutionPlan {
  readonly planId: PlanId;
  readonly planRevision: number;
  readonly projectRevision: ProjectRevision;
  readonly projectFingerprint: ProjectFingerprint;
  readonly environmentFingerprint: EnvironmentFingerprint;
  readonly creativeObjective?: string;
  readonly recipeRefs?: readonly string[];
  readonly requiredCapabilities: readonly CapabilityId[];
  readonly bindings: readonly ExecutionPlanBinding[];
  readonly operations: readonly ExecutionPlanOperation[];
  readonly checkpoints: readonly ExecutionPlanCheckpoint[];
  readonly invariants: {
    readonly structural: readonly Readonly<Record<string, unknown>>[];
    readonly visual: readonly Readonly<Record<string, unknown>>[];
  };
  readonly rollbackBoundaries: readonly ExecutionPlanRollbackBoundary[];
  readonly planHash?: PlanHash | null;
}
