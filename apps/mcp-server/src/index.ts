export const EDITFLOW_VERSION = "0.1.0-dev.1" as const;
export const EDITFLOW_PHASE = "M1_CORE_RUNTIME" as const;

export interface McpServerStatus {
  readonly version: typeof EDITFLOW_VERSION;
  readonly phase: typeof EDITFLOW_PHASE;
  readonly adobeWritesEnabled: false;
  readonly runtimeMode: "SIMULATED_ONLY";
  readonly capabilityRegistry: "READY";
  readonly transactionEngine: "READY";
  readonly executionPlanValidation: "READY";
  readonly restartRecovery: "COMMITTED_BOUNDARY_RESUME";
}

export const getMcpServerStatus = (): McpServerStatus => ({
  version: EDITFLOW_VERSION,
  phase: EDITFLOW_PHASE,
  adobeWritesEnabled: false,
  runtimeMode: "SIMULATED_ONLY",
  capabilityRegistry: "READY",
  transactionEngine: "READY",
  executionPlanValidation: "READY",
  restartRecovery: "COMMITTED_BOUNDARY_RESUME",
});
