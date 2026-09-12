import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";

export const M4_SUBJECT_SEGMENTATION_CAPABILITY_V1: CapabilityRecord = {
  id: asCapabilityId("tracking.segmentation.subject_object.accept"),
  domain: "tracking",
  description: "Accept and validate provider-neutral subject/object segmentation artifacts bound to an exact semantic identity before downstream AE mask or matte application.",
  status: "PARTIAL",
  proofMaturity: "DECLARED",
  routes: [{
    routeId: asRouteId("m4.tracking.segmentation.subject-object.v1"),
    kind: "SUBSYSTEM_ADAPTER",
    available: true,
    adapterVersion: "0.5.0-dev.1",
    limitations: [
      "Contract and validation boundary only; no segmentation provider/model is bundled by this tranche.",
      "An exact semanticId is required; class-only subject guessing is forbidden.",
    ],
  }],
  inputSchemaRef: "SubjectSegmentationRequestV1 + SubjectSegmentationResultV1",
  outputSchemaRef: "AcceptedSubjectSegmentationV1 | null",
  readbackStrategy: "SEGMENTATION_ARTIFACT_IDENTITY_QUALITY_PROVENANCE",
  visualProofProfile: null,
  rollbackStrategy: "NONE_REQUIRED",
  riskClass: "R0_READ_ONLY",
  limitations: [
    "This capability does not create, execute, download, or choose a segmentation model/provider.",
    "Accepted raster artifacts are not automatically converted into After Effects Bezier masks or mattes.",
    "Runtime capability registration is intentionally withheld until a concrete provider and retained end-to-end evidence are accepted.",
  ],
  fallbackPolicy: "FORBID",
};
