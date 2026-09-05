export const EDITFLOW_VERSION = "0.1.0-dev.4" as const;
export const EDITFLOW_PHASE = "M2_CEP_RUNTIME_BRIDGE_CANDIDATE" as const;

export interface McpServerStatus {
  readonly version: typeof EDITFLOW_VERSION;
  readonly phase: typeof EDITFLOW_PHASE;
  readonly adobeWritesEnabled: false;
  readonly runtimeMode: "SIMULATED_PLUS_AE_ADAPTER_AND_CEP_BRIDGE";
  readonly capabilityRegistry: "READY";
  readonly transactionEngine: "SYNC_AND_ASYNC_READY";
  readonly executionPlanValidation: "READY";
  readonly restartRecovery: "COMMITTED_BOUNDARY_RESUME";
  readonly aeAdapterProtocol: "1.1.0";
  readonly hostOperationAtomicity: "FAILED_MUTATION_SELF_ROLLBACK";
  readonly precomposeReplacementIdentity: "REQUIRED";
  readonly cepRuntimeBridge: "PACKAGE_READY_PENDING_REAL_SMOKE";
  readonly cepBrokerBinding: "127.0.0.1_AUTHENTICATED";
  readonly realAeAcceptance: "PENDING";
}

export const getMcpServerStatus = (): McpServerStatus => ({
  version: EDITFLOW_VERSION,
  phase: EDITFLOW_PHASE,
  adobeWritesEnabled: false,
  runtimeMode: "SIMULATED_PLUS_AE_ADAPTER_AND_CEP_BRIDGE",
  capabilityRegistry: "READY",
  transactionEngine: "SYNC_AND_ASYNC_READY",
  executionPlanValidation: "READY",
  restartRecovery: "COMMITTED_BOUNDARY_RESUME",
  aeAdapterProtocol: "1.1.0",
  hostOperationAtomicity: "FAILED_MUTATION_SELF_ROLLBACK",
  precomposeReplacementIdentity: "REQUIRED",
  cepRuntimeBridge: "PACKAGE_READY_PENDING_REAL_SMOKE",
  cepBrokerBinding: "127.0.0.1_AUTHENTICATED",
  realAeAcceptance: "PENDING",
});
