import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";
import {
  buildPointTrackingRequestV21,
  type CepEvalScriptPointTrackingTransportV21,
} from "./m4-point-tracking.js";
import type { AeTrackerReadbackV21 } from "./protocol-v2_1.js";

export type TrackerAnalysisDirectionV1 = "FORWARD" | "BACKWARD";
export type TrackerAnalysisEscalationV1 =
  | "VISUAL_DRIVER_UNAVAILABLE"
  | "TRACKER_TARGET_UNAVAILABLE"
  | "VISUAL_ACTION_REFUSED"
  | "ANALYSIS_DIRECTION_UNPROVEN"
  | "ANALYSIS_NOT_OBSERVED";

export interface TrackerVisualAnalysisDriverV1 {
  readonly driverId: string;
  readonly verifiedVision: boolean;
  readonly verifiedCursorControl: boolean;
  readonly supportedDirections: readonly TrackerAnalysisDirectionV1[];
  analyze(input: TrackerVisualAnalysisRequestV1): Promise<TrackerVisualAnalysisResultV1>;
}
export interface TrackerVisualAnalysisRequestV1 {
  readonly direction: TrackerAnalysisDirectionV1;
  readonly trackerIndex: number;
  readonly pointIndex: number;
  readonly requiredPointIndices?: readonly number[];
  readonly compHostId: number;
  readonly layerHostId: number;
  readonly expectedCompName: string;
  readonly expectedLayerName: string;
  readonly expectedTrackerName: string;
  readonly expectedControl: "TRACKER_ANALYZE_FORWARD" | "TRACKER_ANALYZE_BACKWARD";
}

export interface TrackerVisualAnalysisResultV1 {
  readonly status: "COMPLETED" | "REFUSED";
  readonly visualEvidenceId?: string | null;
  readonly detail?: string | null;
}

export interface TrackerPointSampleCountV1 {
  readonly pointIndex: number;
  readonly sampleCount: number;
}

export interface TrackerAnalysisRunV1 {
  readonly route: "LOCAL" | "ESCALATE";
  readonly direction: TrackerAnalysisDirectionV1;
  readonly escalationReason: TrackerAnalysisEscalationV1 | null;
  readonly baselineSampleCount: number;
  readonly finalSampleCount: number;
  readonly baselinePointSampleCounts: readonly TrackerPointSampleCountV1[];
  readonly finalPointSampleCounts: readonly TrackerPointSampleCountV1[];
  readonly visualEvidenceId: string | null;
  readonly readback: AeTrackerReadbackV21 | null;
}

export const M4_TRACKER_ANALYSIS_CAPABILITY_V1: CapabilityRecord = {
  id: asCapabilityId("ae.tracker.analysis.guarded_visual"),
  domain: "tracking",
  description: "Guarded visual initiation of AE point-tracker analysis with typed pre/post readback verification.",
  status: "ADAPTER_REQUIRED",
  proofMaturity: "STRUCTURAL",
  routes: [{
    routeId: asRouteId("ae.m4.tracker.analysis.guarded_visual.v1"),
    kind: "GUARDED_UI",
    available: false,
    adapterVersion: "0.5.0-dev.1",
    limitations: ["Requires a verified vision+cursor driver for AE's custom-drawn Tracker panel."],
  }],
  readbackStrategy: "PRE_POST_PROTOCOL_2_1_TRACKER_READBACK",
  visualProofProfile: "M4_TRACKER_ANALYSIS_VISUAL_ACTION",
  rollbackStrategy: "FIXTURE_OR_PROJECT_TRANSACTION_OWNED_CLEANUP",
  riskClass: "R4_EXTERNAL_UI",
  limitations: [
    "AE 25.6.6 exposes no tested menu, UIA, Win32 child-control, or keyboard route for Analyze; guarded visual control remains required.",
    "Analyze Forward has real-AE vision+cursor proof; the production route remains unavailable until a verified driver is attached.",
    "Analyze Backward remains unproven and unavailable.",
    "Analysis is not accepted unless every required native tracker point sample set increases after the visual action.",
  ],
  fallbackPolicy: "EXPLICIT_ONLY",
};

export const capabilityForTrackerAnalysisDriverV1 = (
  driver: TrackerVisualAnalysisDriverV1 | null,
): CapabilityRecord => {
  const available = !!driver
    && driver.verifiedVision
    && driver.verifiedCursorControl
    && driver.supportedDirections.includes("FORWARD");
  if (!available) return M4_TRACKER_ANALYSIS_CAPABILITY_V1;
  const backwardAvailable = driver.supportedDirections.includes("BACKWARD");
  return {
    ...M4_TRACKER_ANALYSIS_CAPABILITY_V1,
    status: "PARTIAL",
    proofMaturity: "VISUAL",
    routes: M4_TRACKER_ANALYSIS_CAPABILITY_V1.routes.map((route) => ({ ...route, available: true })),
    limitations: backwardAvailable ? [
      "Analyze Forward and Analyze Backward are accepted through verified EditGPT Eyes/Hands visual routes with protocol 2.1 post-action truth.",
      "The current partial route runs a bounded configurable directional segment and verifies a clean Stop-state return before readback; full-range policy remains a later tranche.",
      "All required native tracker point sample sets must grow; partial point growth is rejected.",
    ] : [
      "Analyze Forward is accepted through the verified EditGPT Eyes/Hands visual route with protocol 2.1 post-action truth.",
      "The current partial route runs a bounded configurable Forward segment and verifies a clean Stop-state return before readback; full-range tracking is a later tranche.",
      "Analyze Backward remains unavailable until an equivalent real-AE acceptance proof is retained.",
      "All required native tracker point sample sets must grow; partial point growth is rejected.",
    ],
  };
};

const readback = async (
  transport: CepEvalScriptPointTrackingTransportV21,
  compHostId: number,
  layerHostId: number,
  suffix: string,
): Promise<AeTrackerReadbackV21 | null> => {
  const request = buildPointTrackingRequestV21({
    requestId: `M4_TRACK_ANALYSIS_${suffix}`,
    transactionId: `M4_TRACK_ANALYSIS_${suffix}`,
    operationId: `M4_TRACK_ANALYSIS_${suffix}`,
    command: "tracker.readback",
    payload: { comp: { hostId: compHostId }, layer: { hostId: layerHostId } },
    readbackProfile: "M4_TRACKER_ANALYSIS_VERIFY",
  });
  const response = await transport.dispatch(request);
  return response.readback ?? null;
};

const sampleCount = (readbackValue: AeTrackerReadbackV21 | null, trackerIndex: number, pointIndex: number): number => {
  if (!readbackValue) return -1;
  const tracker = readbackValue.trackers.find((item) => item.trackerIndex === trackerIndex);
  const point = tracker?.points.find((item) => item.pointIndex === pointIndex);
  return point?.samples.length ?? -1;
};

const pointSampleCounts = (readbackValue: AeTrackerReadbackV21 | null, trackerIndex: number, pointIndices: readonly number[]): readonly TrackerPointSampleCountV1[] =>
  pointIndices.map((pointIndex) => ({ pointIndex, sampleCount: sampleCount(readbackValue, trackerIndex, pointIndex) }));

export class GuardedTrackerAnalysisControllerV1 {
  readonly transport: CepEvalScriptPointTrackingTransportV21;
  readonly visualDriver: TrackerVisualAnalysisDriverV1 | null;

  constructor(transport: CepEvalScriptPointTrackingTransportV21, visualDriver: TrackerVisualAnalysisDriverV1 | null = null) {
    this.transport = transport;
    this.visualDriver = visualDriver;
  }
  async run(input: {
    readonly compHostId: number;
    readonly layerHostId: number;
    readonly direction: TrackerAnalysisDirectionV1;
    readonly trackerIndex?: number;
    readonly pointIndex?: number;
    readonly requiredPointIndices?: readonly number[];
  }): Promise<TrackerAnalysisRunV1> {
    const trackerIndex = input.trackerIndex ?? 1;
    const pointIndex = input.pointIndex ?? 1;
    const requestedPointIndices = input.requiredPointIndices ?? [pointIndex];
    const pointIndices = [...new Set(requestedPointIndices)];
    const invalidPointIndices = pointIndices.length === 0
      || pointIndices.some((value) => !Number.isInteger(value) || value <= 0)
      || !pointIndices.includes(pointIndex);
    const before = await readback(this.transport, input.compHostId, input.layerHostId, "BEFORE");
    const baselinePointSampleCounts = invalidPointIndices ? [] : pointSampleCounts(before, trackerIndex, pointIndices);
    const baselinePrimary = baselinePointSampleCounts.find((item) => item.pointIndex === pointIndex);
    const baselineSampleCount = baselinePrimary?.sampleCount ?? -1;
    if (invalidPointIndices || baselinePointSampleCounts.some((item) => item.sampleCount < 0)) {
      return this.#escalate(input.direction, "TRACKER_TARGET_UNAVAILABLE", baselineSampleCount, baselineSampleCount, before, baselinePointSampleCounts, baselinePointSampleCounts);
    }
    const driver = this.visualDriver;
    if (!driver || !driver.verifiedVision || !driver.verifiedCursorControl) {
      return this.#escalate(input.direction, "VISUAL_DRIVER_UNAVAILABLE", baselineSampleCount, baselineSampleCount, before, baselinePointSampleCounts, baselinePointSampleCounts);
    }
    if (!driver.supportedDirections.includes(input.direction)) {
      return this.#escalate(input.direction, "ANALYSIS_DIRECTION_UNPROVEN", baselineSampleCount, baselineSampleCount, before, baselinePointSampleCounts, baselinePointSampleCounts);
    }
    const action = await driver.analyze({
      direction: input.direction, trackerIndex, pointIndex, requiredPointIndices: pointIndices,
      compHostId: input.compHostId, layerHostId: input.layerHostId,
      expectedCompName: before?.comp.name ?? "", expectedLayerName: before?.layer.name ?? "",
      expectedTrackerName: before?.trackers.find((item) => item.trackerIndex === trackerIndex)?.name ?? "",
      expectedControl: input.direction === "FORWARD" ? "TRACKER_ANALYZE_FORWARD" : "TRACKER_ANALYZE_BACKWARD",
    });
    if (action.status !== "COMPLETED") {
      return this.#escalate(input.direction, "VISUAL_ACTION_REFUSED", baselineSampleCount, baselineSampleCount, before, baselinePointSampleCounts, baselinePointSampleCounts, action.visualEvidenceId ?? null);
    }
    const after = await readback(this.transport, input.compHostId, input.layerHostId, "AFTER");
    const finalPointSampleCounts = pointSampleCounts(after, trackerIndex, pointIndices);
    const finalPrimary = finalPointSampleCounts.find((item) => item.pointIndex === pointIndex);
    const finalSampleCount = finalPrimary?.sampleCount ?? -1;
    const allPointsGrew = finalPointSampleCounts.length === baselinePointSampleCounts.length
      && finalPointSampleCounts.every((item, index) => item.sampleCount > (baselinePointSampleCounts[index]?.sampleCount ?? Number.POSITIVE_INFINITY));
    if (!allPointsGrew) {
      return this.#escalate(input.direction, "ANALYSIS_NOT_OBSERVED", baselineSampleCount, finalSampleCount, after, baselinePointSampleCounts, finalPointSampleCounts, action.visualEvidenceId ?? null);
    }
    return { route: "LOCAL", direction: input.direction, escalationReason: null, baselineSampleCount, finalSampleCount, baselinePointSampleCounts, finalPointSampleCounts, visualEvidenceId: action.visualEvidenceId ?? null, readback: after };
  }
  #escalate(
    direction: TrackerAnalysisDirectionV1,
    reason: TrackerAnalysisEscalationV1,
    baselineSampleCount: number,
    finalSampleCount: number,
    readbackValue: AeTrackerReadbackV21 | null,
    baselinePointSampleCounts: readonly TrackerPointSampleCountV1[],
    finalPointSampleCounts: readonly TrackerPointSampleCountV1[],
    visualEvidenceId: string | null = null,
  ): TrackerAnalysisRunV1 {
    return { route: "ESCALATE", direction, escalationReason: reason, baselineSampleCount, finalSampleCount, baselinePointSampleCounts, finalPointSampleCounts, visualEvidenceId, readback: readbackValue };
  }
}
