export const EDITFLOW_VERSION = "0.5.0-dev" as const;
export const EDITFLOW_PHASE = "M4_TRACKING_ISOLATION_IN_PROGRESS" as const;
export const EDITFLOW_DEFAULT_EXECUTION_RUNNER = "REFLEX_CONTINUOUS_FAST_LOOP_V1" as const;

export interface McpServerStatus {
  readonly version: typeof EDITFLOW_VERSION;
  readonly phase: typeof EDITFLOW_PHASE;
  readonly adobeWritesEnabled: true;
  readonly runtimeMode: "SIMULATED_PLUS_AE_ADAPTER_AND_CEP_BRIDGE";
  readonly capabilityRegistry: "READY";
  readonly runtimeCapabilityComposition: "M2_BASE_PLUS_ACCEPTED_M3";
  readonly acceptedM3HostProtocols: "1.2.0_THROUGH_2.0.0_REGISTERED";
  readonly transactionEngine: "SYNC_AND_ASYNC_READY";
  readonly executionPlanValidation: "READY";
  readonly restartRecovery: "COMMITTED_BOUNDARY_RESUME";
  readonly aeAdapterProtocol: "1.1.0";
  readonly hostOperationAtomicity: "FAILED_MUTATION_SELF_ROLLBACK";
  readonly precomposeReplacementIdentity: "REQUIRED";
  readonly cepRuntimeBridge: "REAL_AE_PROVEN";
  readonly cepBrokerBinding: "127.0.0.1_AUTHENTICATED";
  readonly defaultExecutionRunner: typeof EDITFLOW_DEFAULT_EXECUTION_RUNNER;
  readonly ordinaryIntentBudgetMs: 2000;
  readonly routineMicroActionBudgetMs: 1000;
  readonly slowReasoningPolicy: "ESCALATION_ONLY_FOR_AMBIGUOUS_NOVEL_OR_UNSAFE";
  readonly realAeAcceptance: "P1_P5_ACCEPTED";
  readonly humanParityCore: "MASK_COMPOSITE_PARENTING_NULL_LAYER_CONTROLS_TEMPORAL_SPATIAL_GRAPH_EDITOR_MARKER_MOTION_EXIT_GATE_ACCEPTED";
  readonly m3ExitGate: "OBJECT_MASK_GEOMETRY_MATTE_CURVES_TRANSFER_ACCEPTED";
  readonly m3MaskHostProtocol: "1.2.0_BROKER_GATED";
  readonly m3LatestHostProtocol: "2.0.0_TRANSFER_ACCEPTED";
  readonly trackingIsolation: "POINT_TRACKING_NEXT";
}

export const getMcpServerStatus = (): McpServerStatus => ({
  version: EDITFLOW_VERSION,
  phase: EDITFLOW_PHASE,
  adobeWritesEnabled: true,
  runtimeMode: "SIMULATED_PLUS_AE_ADAPTER_AND_CEP_BRIDGE",
  capabilityRegistry: "READY",
  runtimeCapabilityComposition: "M2_BASE_PLUS_ACCEPTED_M3",
  acceptedM3HostProtocols: "1.2.0_THROUGH_2.0.0_REGISTERED",
  transactionEngine: "SYNC_AND_ASYNC_READY",
  executionPlanValidation: "READY",
  restartRecovery: "COMMITTED_BOUNDARY_RESUME",
  aeAdapterProtocol: "1.1.0",
  hostOperationAtomicity: "FAILED_MUTATION_SELF_ROLLBACK",
  precomposeReplacementIdentity: "REQUIRED",
  cepRuntimeBridge: "REAL_AE_PROVEN",
  cepBrokerBinding: "127.0.0.1_AUTHENTICATED",
  defaultExecutionRunner: EDITFLOW_DEFAULT_EXECUTION_RUNNER,
  ordinaryIntentBudgetMs: 2000,
  routineMicroActionBudgetMs: 1000,
  slowReasoningPolicy: "ESCALATION_ONLY_FOR_AMBIGUOUS_NOVEL_OR_UNSAFE",
  realAeAcceptance: "P1_P5_ACCEPTED",
  humanParityCore: "MASK_COMPOSITE_PARENTING_NULL_LAYER_CONTROLS_TEMPORAL_SPATIAL_GRAPH_EDITOR_MARKER_MOTION_EXIT_GATE_ACCEPTED",
  m3ExitGate: "OBJECT_MASK_GEOMETRY_MATTE_CURVES_TRANSFER_ACCEPTED",
  m3MaskHostProtocol: "1.2.0_BROKER_GATED",
  m3LatestHostProtocol: "2.0.0_TRANSFER_ACCEPTED",
  trackingIsolation: "POINT_TRACKING_NEXT",
});
