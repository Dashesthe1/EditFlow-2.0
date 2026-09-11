import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../core-contracts/src/index.js";
import type { CapabilityRegistry } from "./index.js";

export const M4_POINT_TRACKING_CAPABILITY_ID = asCapabilityId("ae.tracking.point");
export const M4_POINT_TRACKING_ROUTE_ID = asRouteId("m4.point_tracking.local_luma_v1");

/**
 * The deterministic tracker core, bounded frame decoders, and typed TIFF capture
 * profile have structural/code proof. Real AE-produced TIFF pixels have also been
 * decoded and tracked in a bounded direct experiment. Keep production resolution
 * unavailable until the authenticated warm-CEP acceptance artifact and the later
 * visual/recovery/transfer gates are retained.
 */
export const M4_POINT_TRACKING_FOUNDATION_CAPABILITY: CapabilityRecord = {
  id: M4_POINT_TRACKING_CAPABILITY_ID,
  domain: "tracking",
  description: "Track a semantic point target across After Effects frames with confidence and drift classification.",
  status: "ADAPTER_REQUIRED",
  proofMaturity: "STRUCTURAL",
  routes: [{
    routeId: M4_POINT_TRACKING_ROUTE_ID,
    kind: "SUBSYSTEM_ADAPTER",
    available: false,
    adapterVersion: "m4-p1-core.3",
    limitations: [
      "Deterministic luminance-frame tracking core is implemented and structurally tested.",
      "Bounded dependency-free BMP and baseline TIFF evidence decoding is implemented and structurally tested.",
      "An allow-listed TRACKING_TIFF_SEQUENCE_V1 profile is implemented above typed authenticated render.capture and passes repository CI.",
      "A bounded direct AE experiment produced TIFF pixels that decoded and tracked successfully, but the final authenticated warm-CEP M4_POINT_TRACK_REAL_AE_V1 artifact is not yet retained.",
      "Formal representative-footage visual acceptance, lost/drifting-track recovery, and cross-footage transfer proof remain open.",
    ],
  }],
  inputSchemaRef: "PointTrackRequestV1 + GrayFrameV1[] (including bounded BMP/TIFF frame evidence)",
  outputSchemaRef: "PointTrackResultV1",
  readbackStrategy: "Apply PointTrackResultV1 to persistent EditorSubjectStateV1 with confidence and provenance.",
  visualProofProfile: "M4_POINT_TRACK_DRIFT_V1",
  rollbackStrategy: "READ_ONLY_ANALYSIS_NO_PROJECT_MUTATION",
  riskClass: "R0_READ_ONLY",
  limitations: [
    "Foundation-only until authenticated real-AE capture ingestion plus required visual, recovery, and cross-footage transfer proof pass.",
  ],
  fallbackPolicy: "FORBID",
};

export const registerM4TrackingFoundation = (registry: CapabilityRegistry): void => {
  registry.registerStatic([M4_POINT_TRACKING_FOUNDATION_CAPABILITY]);
};
