import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../core-contracts/src/index.js";
import type { CapabilityRegistry } from "./index.js";

export const M4_POINT_TRACKING_CAPABILITY_ID = asCapabilityId("ae.tracking.point");
export const M4_POINT_TRACKING_ROUTE_ID = asRouteId("m4.point_tracking.local_luma_v1");

/**
 * The deterministic tracker core has structural proof, but the end-to-end AE
 * frame-ingest adapter is not wired yet. Keep this capability unavailable to
 * production planning until the real host route and visual proof are complete.
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
    adapterVersion: "m4-p1-core.1",
    limitations: [
      "Deterministic luminance-frame tracking core is implemented and structurally tested.",
      "AE render.capture output is not yet decoded into bounded luminance frame evidence by the production runner.",
      "No real-footage visual drift proof or transfer proof has passed yet.",
    ],
  }],
  inputSchemaRef: "PointTrackRequestV1 + GrayFrameV1[]",
  outputSchemaRef: "PointTrackResultV1",
  readbackStrategy: "Apply PointTrackResultV1 to persistent EditorSubjectStateV1 with confidence and provenance.",
  visualProofProfile: "M4_POINT_TRACK_DRIFT_V1",
  rollbackStrategy: "READ_ONLY_ANALYSIS_NO_PROJECT_MUTATION",
  riskClass: "R0_READ_ONLY",
  limitations: [
    "Foundation-only until AE capture-to-frame ingestion, real-host visual proof, recovery proof, and transfer proof pass.",
  ],
  fallbackPolicy: "FORBID",
};

export const registerM4TrackingFoundation = (registry: CapabilityRegistry): void => {
  registry.registerStatic([M4_POINT_TRACKING_FOUNDATION_CAPABILITY]);
};
