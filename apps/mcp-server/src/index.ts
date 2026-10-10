export const EDITFLOW_VERSION = "0.5.0-dev" as const;
export const EDITFLOW_PHASE = "SOURCE_MATCH_THEN_RAW_ASSEMBLY_V1" as const;
export const EDITFLOW_DEFAULT_EXECUTION_RUNNER = null;
export const getMcpServerStatus = () => ({
  version: EDITFLOW_VERSION, phase: EDITFLOW_PHASE, adobeWritesEnabled: "VERIFIED_RAW_ASSEMBLY_ONLY",
  runtimeMode: "SOURCE_MATCH_THEN_RAW_ASSEMBLY_V1", defaultExecutionRunner: null, editorBrain: null,
  primaryProductionSystem: null, availableWorkflows: ["SOURCE_MATCH_THEN_RAW_ASSEMBLY_V1"], workflowConfigured: true,
  runtimeCapabilityComposition: "M2_BASE_PLUS_ACCEPTED_M3",
  acceptedM3HostProtocols: "1.2.0_THROUGH_2.0.0_REGISTERED",
  humanParityCore: "MASK_COMPOSITE_PARENTING_NULL_LAYER_CONTROLS_TEMPORAL_SPATIAL_GRAPH_EDITOR_MARKER_MOTION_EXIT_GATE_ACCEPTED",
  m3ExitGate: "OBJECT_MASK_GEOMETRY_MATTE_CURVES_TRANSFER_ACCEPTED",
  cepRuntimeBridge: "REAL_AE_PROVEN", cepBrokerBinding: "127.0.0.1_AUTHENTICATED",
  realAeAcceptance: "P1_P5_ACCEPTED", restartRecovery: "COMMITTED_BOUNDARY_RESUME",
  aeAdapterProtocol: "1.1.0", m3MaskHostProtocol: "1.2.0_BROKER_GATED",
  m3LatestHostProtocol: "2.0.0_TRANSFER_ACCEPTED", trackingIsolation: "POINT_TRACKING_NEXT",
});
export type McpServerStatus = ReturnType<typeof getMcpServerStatus>;
export { PRACTICE_UI_CONTRACT_V1 } from "../../../packages/practice-homework/src/index.js";
export type { EditFlowOperatingModeV1 } from "../../../packages/practice-homework/src/index.js";
