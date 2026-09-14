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
  proofMaturity: "STRUCTURAL",
  routes: [{
    routeId: asRouteId("m4.tracking.segmentation.subject-object.v1"),
    kind: "SUBSYSTEM_ADAPTER",
    available: true,
    adapterVersion: "0.5.0-dev.2",
    limitations: [
      "Concrete local SAM 3.1 image and temporal provider adapters are bundled and structurally tested, but retained checkpoint-backed live inference is not yet accepted.",
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
    "This provider-neutral acceptance capability does not itself execute or choose a provider; optional sam3.1.local image and temporal adapters exist as structurally proven provider implementations.",
    "Accepted raster artifacts are not automatically converted into After Effects Bezier masks; static and temporal raster-to-matte materialization are separate visually proven capabilities.",
    "Runtime provider registration remains withheld until checkpoint-backed live SAM 3.1 evidence plus transfer robustness are accepted."
  ],
  fallbackPolicy: "FORBID",
};

export const capabilityForAcceptedM4SubjectSegmentationRuntimeV1 = (evidenceId: string): CapabilityRecord | null => {
  const acceptedEvidenceId = evidenceId.trim();
  if (acceptedEvidenceId.length === 0) return null;

  return {
    ...M4_SUBJECT_SEGMENTATION_CAPABILITY_V1,
    status: "FULL",
    proofMaturity: "TRANSFER",
    routes: M4_SUBJECT_SEGMENTATION_CAPABILITY_V1.routes.map((route) => ({
      ...route,
      adapterVersion: "0.5.0-dev.3",
      limitations: [
        `Runtime registration is pinned to retained checkpoint-backed SAM 3.1 sequence evidence '${acceptedEvidenceId}'.`,
        "An exact semanticId is required; class-only subject guessing remains forbidden.",
      ],
    })),
    limitations: [
      "This provider-neutral acceptance surface does not choose or silently swap providers.",
      `Production runtime registration was admitted only after retained live SAM 3.1 transfer evidence '${acceptedEvidenceId}' passed the desktop-host runtime gate.`,
      "Accepted raster artifacts are not automatically converted into After Effects Bezier masks; static and temporal raster-to-matte materialization remain separate capabilities.",
    ],
  };
};
