export const EDITFLOW_VERSION = "0.1.0-dev.3" as const;
export const EDITFLOW_PHASE = "M2_TRANSACTION_IDENTITY_HARDENING" as const;

export interface McpServerStatus {
  readonly version: typeof EDITFLOW_VERSION;
  readonly phase: typeof EDITFLOW_PHASE;
  readonly adobeWritesEnabled: false;
  readonly runtimeMode: "SIMULATED_PLUS_AE_ADAPTER_HARDENED";
  readonly capabilityRegistry: "READY";
  readonly transactionEngine: "SYNC_AND_ASYNC_READY";
  readonly executionPlanValidation: "READY";
  readonly restartRecovery: "COMMITTED_BOUNDARY_RESUME";
  readonly aeAdapterProtocol: "1.1.0";
  readonly hostOperationAtomicity: "FAILED_MUTATION_SELF_ROLLBACK";
  readonly precomposeReplacementIdentity: "REQUIRED";
  readonly realAeAcceptance: "PENDING";
}

export const getMcpServerStatus = (): McpServerStatus => ({
  version: EDITFLOW_VERSION,
  phase: EDITFLOW_PHASE,
  adobeWritesEnabled: false,
  runtimeMode: "SIMULATED_PLUS_AE_ADAPTER_HARDENED",
  capabilityRegistry: "READY",
  transactionEngine: "SYNC_AND_ASYNC_READY",
  executionPlanValidation: "READY",
  restartRecovery: "COMMITTED_BOUNDARY_RESUME",
  aeAdapterProtocol: "1.1.0",
  hostOperationAtomicity: "FAILED_MUTATION_SELF_ROLLBACK",
  precomposeReplacementIdentity: "REQUIRED",
  realAeAcceptance: "PENDING",
});
