import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";
import type { SubjectObservationV1 } from "../../../tracking-state/src/index.js";
import {
  AE_POINT_TRACKING_ADAPTER_BUILD_V21,
  AE_POINT_TRACKING_COMMANDS_V21,
  AE_POINT_TRACKING_PROTOCOL_VERSION_V21,
  AE_POINT_TRACKING_ROUTE_ID_V21,
  capabilityForPointTrackingCommandV21,
  isAePointTrackingCommandV21,
  type AePointTrackingCommandV21,
  type AePointTrackingRequestV21,
  type AePointTrackingResponseV21,
  type AeTrackerPointReadbackV21,
  type AeTrackerReadbackV21,
} from "./protocol-v2_1.js";

export interface CepEvalScriptPointTrackingBridgeV21 {
  evalScript(script: string, callback: (result: string) => void): void;
}

const escapeForEvalScript = (value: string): string => JSON.stringify(value)
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");
const ensureResponseV21 = (
  value: unknown,
  request: AePointTrackingRequestV21,
): AePointTrackingResponseV21 => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("AE point-tracking adapter returned a non-object response.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate["protocolVersion"] !== AE_POINT_TRACKING_PROTOCOL_VERSION_V21) {
    throw new TypeError("AE point-tracking adapter protocol version mismatch.");
  }
  if (candidate["requestId"] !== request.requestId || candidate["operationId"] !== request.operationId) {
    throw new TypeError("AE point-tracking adapter response correlation mismatch.");
  }
  if (candidate["command"] !== request.command || !isAePointTrackingCommandV21(String(candidate["command"]))) {
    throw new TypeError("AE point-tracking adapter returned an invalid command correlation.");
  }
  const outcome = candidate["outcome"];
  if (outcome !== "NO_OP" && outcome !== "REJECTED" && outcome !== "FAILED" && outcome !== "APPLIED") {
    throw new TypeError("AE point-tracking adapter returned an invalid operation outcome.");
  }
  return candidate as unknown as AePointTrackingResponseV21;
};

export class CepEvalScriptPointTrackingTransportV21 {
  readonly bridge: CepEvalScriptPointTrackingBridgeV21;
  constructor(bridge: CepEvalScriptPointTrackingBridgeV21) { this.bridge = bridge; }
  async dispatch(request: AePointTrackingRequestV21): Promise<AePointTrackingResponseV21> {
    const script = `EditFlow2_dispatch(${escapeForEvalScript(JSON.stringify(request))})`;
    return await new Promise<AePointTrackingResponseV21>((resolve, reject) => {
      this.bridge.evalScript(script, (rawResult) => {
        try { resolve(ensureResponseV21(JSON.parse(rawResult) as unknown, request)); }
        catch (error) { reject(error); }
      });
    });
  }
}

export const M4_POINT_TRACKING_CAPABILITIES_V21: readonly CapabilityRecord[] =
  AE_POINT_TRACKING_COMMANDS_V21.map((command): CapabilityRecord => ({
    id: asCapabilityId(capabilityForPointTrackingCommandV21(command)),
    domain: "tracking",
    description: "M4 read-only point-tracker structural/keyframe readback from After Effects Motion Trackers.",
    status: "PARTIAL",
    proofMaturity: "DECLARED",
    routes: [{
      routeId: asRouteId(AE_POINT_TRACKING_ROUTE_ID_V21),
      kind: "HOST_ADAPTER",
      available: true,
      adapterVersion: AE_POINT_TRACKING_ADAPTER_BUILD_V21,
    }],
    readbackStrategy: "HOST_TRACKER_KEYFRAME_READBACK",
    visualProofProfile: null,
    rollbackStrategy: "NONE_REQUIRED",
    riskClass: "R0_READ_ONLY",
    fallbackPolicy: "FORBID",
  }));
export const buildPointTrackingRequestV21 = (input: {
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly command: AePointTrackingCommandV21;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile?: string | null;
}): AePointTrackingRequestV21 => ({
  protocolVersion: AE_POINT_TRACKING_PROTOCOL_VERSION_V21,
  requestId: input.requestId,
  transactionId: input.transactionId,
  operationId: input.operationId,
  capabilityId: capabilityForPointTrackingCommandV21(input.command),
  command: input.command,
  expectedHostProjectRevision: null,
  payload: input.payload,
  readbackProfile: input.readbackProfile ?? "M4_POINT_TRACKING_STRUCTURAL",
});

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const finitePair = (value: readonly number[] | null): value is readonly [number, number] =>
  !!value && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);

const findPoint = (
  readback: AeTrackerReadbackV21,
  trackerIndex: number,
  pointIndex: number,
): AeTrackerPointReadbackV21 | null =>
  readback.trackers.find((tracker) => tracker.trackerIndex === trackerIndex)
    ?.points.find((point) => point.pointIndex === pointIndex) ?? null;
export const trackerReadbackToSubjectObservationsV1 = (
  readback: AeTrackerReadbackV21,
  semanticId: string,
  trackerIndex = 1,
  pointIndex = 1,
): readonly SubjectObservationV1[] => {
  if (!semanticId) return [];
  const point = findPoint(readback, trackerIndex, pointIndex);
  if (!point || point.keyedSampleCount < 2) return [];
  const width = readback.comp.width;
  const height = readback.comp.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];

  const observations: SubjectObservationV1[] = [];
  for (const sample of point.samples) {
    if (!finitePair(sample.compNormalized) || !finitePair(sample.featureSize)) continue;
    const confidence = clamp01(sample.confidence);
    const featureScale = clamp01(Math.sqrt(
      Math.abs(sample.featureSize[0] * sample.featureSize[1]) / (width * height),
    ));
    observations.push({
      semanticId,
      timestampMs: sample.time * 1000,
      x: clamp01(sample.compNormalized[0]),
      y: clamp01(sample.compNormalized[1]),
      scale: featureScale,
      confidence,
      residualError: 0,
      occlusion: clamp01(1 - confidence),
      isolationAvailable: false,
      evidenceIds: [`AE_TRACKER:${readback.layer.stableId ?? readback.layer.hostId}:${trackerIndex}:${pointIndex}:${sample.time}`],
    });
  }
  return observations;
};
