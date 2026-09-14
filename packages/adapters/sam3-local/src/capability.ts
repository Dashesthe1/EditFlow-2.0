import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";

export const M4_SAM31_LOCAL_SEGMENTATION_CAPABILITY_V1: CapabilityRecord = {
  id: asCapabilityId("tracking.segmentation.subject_object.sam3_1.local"),
  domain: "tracking",
  description: "Local SAM 3.1 subject/object segmentation behind the provider-neutral M4 contract.",
  status: "ADAPTER_REQUIRED",
  proofMaturity: "DECLARED",
  routes: [{
    routeId: asRouteId("m4.tracking.segmentation.sam3-1.local.v1"),
    kind: "SUBSYSTEM_ADAPTER",
    available: false,
    adapterVersion: "0.5.0-dev.1",
    limitations: ["Registration waits for authorized SAM 3.1 checkpoint access and retained end-to-end proof."],
  }],
  inputSchemaRef: "SubjectSegmentationRequestV1 + SegmentationSourceMaterialV1",
  outputSchemaRef: "AcceptedSubjectSegmentationV1",
  readbackStrategy: "RASTER_SHA256_PLUS_EXACT_SUBJECT_SOURCE_CORRELATION",
  visualProofProfile: "M4_SAM31_SUBJECT_MASK_RETAINED_ARTIFACT",
  rollbackStrategy: "NONE_REQUIRED",
  riskClass: "R0_READ_ONLY",
  limitations: [
    "This tranche supports text/entity-class and normalized box prompts; point-prompt execution remains fail-closed.",
    "The occlusion value is a presence-score risk proxy tagged in evidence, not host-native occlusion truth.",
  ],
  fallbackPolicy: "FORBID",
};
