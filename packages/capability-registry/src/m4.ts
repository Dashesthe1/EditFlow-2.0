import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../core-contracts/src/index.js";
import type { CapabilityRegistry } from "./index.js";

export const M4_POINT_TRACKING_CAPABILITY_ID = asCapabilityId("ae.tracking.point");
export const M4_POINT_TRACKING_ROUTE_ID = asRouteId("m4.point_tracking.local_luma_v1");

/**
 * The deterministic tracker core and bounded BMP-to-luminance evidence decoder
 * have structural proof, but a real After Effects capture route has not yet
 * passed visual/recovery/transfer proof. Keep this capability unavailable to
 * production planning until those gates are complete.
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
    adapterVersion: "m4-p1-core.2",
    limitations: [
      "Deterministic luminance-frame tracking core is implemented and structurally tested.",
      "Bounded, dependency-free 24/32-bit BI_RGB BMP evidence decoding is implemented and structurally tested.",
      "A real AE render.capture-to-BMP proof has not yet passed on the self-hosted After Effects runner.",
      "No real-footage visual drift proof, recovery proof, or transfer proof has passed yet.",
    ],
  }],
  inputSchemaRef: "PointTrackRequestV1 + GrayFrameV1[] (including bounded BMP frame evidence)",
  outputSchemaRef: "PointTrackResultV1",
  readbackStrategy: "Apply PointTrackResultV1 to persistent EditorSubjectStateV1 with confidence and provenance.",
  visualProofProfile: "M4_POINT_TRACK_DRIFT_V1",
  rollbackStrategy: "READ_ONLY_ANALYSIS_NO_PROJECT_MUTATION",
  riskClass: "R0_READ_ONLY",
  limitations: [
    "Foundation-only until real AE capture ingestion, visual proof, recovery proof, and cross-footage transfer proof pass.",
  ],
  fallbackPolicy: "FORBID",
};

export const registerM4TrackingFoundation = (registry: CapabilityRegistry): void => {
  registry.registerStatic([M4_POINT_TRACKING_FOUNDATION_CAPABILITY]);
};
