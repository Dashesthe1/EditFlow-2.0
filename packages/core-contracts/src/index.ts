export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type ProjectRevision = Brand<string, "ProjectRevision">;
export type ProjectFingerprint = Brand<string, "ProjectFingerprint">;
export type EnvironmentFingerprint = Brand<string, "EnvironmentFingerprint">;
export type CapabilityId = Brand<string, "CapabilityId">;
export type OperationId = Brand<string, "OperationId">;
export type TransactionId = Brand<string, "TransactionId">;
export type SceneEntityId = Brand<string, "SceneEntityId">;
export type RecipeId = Brand<string, "RecipeId">;

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
