export const EDITFLOW_VERSION = "0.5.0-dev" as const;
export const EDITFLOW_PHASE = "M4_TRACKING_ISOLATION_IN_PROGRESS" as const;
export const EDITFLOW_DEFAULT_EXECUTION_RUNNER = "DURABLE_PRODUCTION_QUEUE_V1" as const;

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
  readonly editorBrain: "CHATGPT_DIRECT";
  readonly editorBrainDecisionBudgetMs: 0;
  readonly editorBrainKnowledgeMode: "GPT_RETAINED_PRESET_EXAMPLES";
  readonly editorBrainFailureMode: "REQUIRE_CHATGPT_DECISION";
  readonly ordinaryIntentBudgetMs: 2000;
  readonly routineMicroActionBudgetMs: 1000;
  readonly localRuntime: "PERSISTENT_BATCH_RUNTIME_V1";
  readonly primaryProductionSystem: "DURABLE_PRODUCTION_QUEUE_V1";
  readonly directMutationRoutes: "REMOVED";
  readonly mcpCommandGranularity: "COARSE_GRAINED_BATCHES";
  readonly routineBatchMaxActions: 64;
  readonly slowReasoningPolicy: "CHATGPT_FOR_ALL_EDITORIAL_DECISIONS";
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
  editorBrain: "CHATGPT_DIRECT",
  editorBrainDecisionBudgetMs: 0,
  editorBrainKnowledgeMode: "GPT_RETAINED_PRESET_EXAMPLES",
  editorBrainFailureMode: "REQUIRE_CHATGPT_DECISION",
  ordinaryIntentBudgetMs: 2000,
  routineMicroActionBudgetMs: 1000,
  localRuntime: "PERSISTENT_BATCH_RUNTIME_V1",
  primaryProductionSystem: "DURABLE_PRODUCTION_QUEUE_V1",
  directMutationRoutes: "REMOVED",
  mcpCommandGranularity: "COARSE_GRAINED_BATCHES",
  routineBatchMaxActions: 64,
  slowReasoningPolicy: "CHATGPT_FOR_ALL_EDITORIAL_DECISIONS",
  realAeAcceptance: "P1_P5_ACCEPTED",
  humanParityCore: "MASK_COMPOSITE_PARENTING_NULL_LAYER_CONTROLS_TEMPORAL_SPATIAL_GRAPH_EDITOR_MARKER_MOTION_EXIT_GATE_ACCEPTED",
  m3ExitGate: "OBJECT_MASK_GEOMETRY_MATTE_CURVES_TRANSFER_ACCEPTED",
  m3MaskHostProtocol: "1.2.0_BROKER_GATED",
  m3LatestHostProtocol: "2.0.0_TRANSFER_ACCEPTED",
  trackingIsolation: "POINT_TRACKING_NEXT",
});

export {
  PRACTICE_UI_CONTRACT_V1,
} from "../../../packages/practice-homework/src/index.js";
export type {
  EditFlowOperatingModeV1,
  PracticeHomeworkAdaptersV1,
  PracticeSessionRequestV1,
  PracticeSessionResultV1,
} from "../../../packages/practice-homework/src/index.js";
