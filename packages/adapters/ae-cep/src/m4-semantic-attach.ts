import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";

export const M4_SEMANTIC_ATTACH_CAPABILITY_V1: CapabilityRecord = {
  id: asCapabilityId("ae.tracker.semantic_attach.resolve"),
  domain: "tracking",
  description: "Resolve an evidence-backed semantic scene entity or named landmark into a deterministic normalized attach point for downstream tracking, stabilization, reframing, and effects placement.",
  status: "PARTIAL",
  proofMaturity: "DECLARED",
  routes: [{
    routeId: asRouteId("ae.m4.tracker.semantic-attach-resolve.v1"),
    kind: "SUBSYSTEM_ADAPTER",
    available: true,
    adapterVersion: "0.5.0-dev.1",
    limitations: [
      "Resolver only: upstream scene intelligence must supply entity identity, class, geometry, confidence, provenance, and any named landmarks.",
      "Bounding-box anchors are derived geometry; semantic landmarks are never inferred when absent.",
    ],
  }],
  inputSchemaRef: "SemanticSceneEntityGeometryV1[] + SemanticAttachQueryV1",
  outputSchemaRef: "SemanticAttachResolutionV1 | null",
  readbackStrategy: "NORMALIZED_SCENE_ENTITY_GEOMETRY_WITH_PROVENANCE",
  visualProofProfile: null,
  rollbackStrategy: "NONE_REQUIRED",
  riskClass: "R0_READ_ONLY",
  limitations: [
    "This tranche does not run a detector, segmenter, face model, pose model, or tracker by itself.",
    "Class-only queries fail closed when multiple entities match; planners should bind semanticId whenever possible.",
    "Runtime capability registration is intentionally withheld until upstream scene-intelligence integration and retained proof are accepted.",
  ],
  fallbackPolicy: "FORBID",
};
