export const EDITFLOW_VERSION = "0.1.0-dev.2" as const;
export const EDITFLOW_PHASE = "M2_AE_HOST_ADAPTER_CANDIDATE" as const;

export interface McpServerStatus {
  readonly version: typeof EDITFLOW_VERSION;
  readonly phase: typeof EDITFLOW_PHASE;
  readonly adobeWritesEnabled: false;
  readonly runtimeMode: "SIMULATED_PLUS_AE_ADAPTER_CANDIDATE";
  readonly capabilityRegistry: "READY";
  readonly transactionEngine: "READY";
  readonly executionPlanValidation: "READY";
  readonly restartRecovery: "COMMITTED_BOUNDARY_RESUME";
  readonly aeAdapterProtocol: "1.0.0";
  readonly realAeAcceptance: "PENDING";
}

export const getMcpServerStatus = (): McpServerStatus => ({
  version: EDITFLOW_VERSION,
  phase: EDITFLOW_PHASE,
  adobeWritesEnabled: false,
  runtimeMode: "SIMULATED_PLUS_AE_ADAPTER_CANDIDATE",
  capabilityRegistry: "READY",
  transactionEngine: "READY",
  executionPlanValidation: "READY",
  restartRecovery: "COMMITTED_BOUNDARY_RESUME",
  aeAdapterProtocol: "1.0.0",
  realAeAcceptance: "PENDING",
});
