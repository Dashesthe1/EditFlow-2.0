import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";
import {
  AE_FACE_TRACKING_ADAPTER_BUILD_V22,
  AE_FACE_TRACKING_COMMANDS_V22,
  AE_FACE_TRACKING_PROTOCOL_VERSION_V22,
  AE_FACE_TRACKING_ROUTE_ID_V22,
  capabilityForFaceTrackingCommandV22,
  isAeFaceTrackingCommandV22,
  type AeFaceReadbackV22,
  type AeFaceTrackingCommandV22,
  type AeFaceTrackingRequestV22,
  type AeFaceTrackingResponseV22,
  type AeFaceTrackingTransportV22,
} from "./protocol-v2_2.js";

export interface CepEvalScriptFaceTrackingBridgeV22 {
  evalScript(script: string, callback: (result: string) => void): void;
}

const escapeForEvalScript = (value: string): string => JSON.stringify(value)
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");
const ensureResponseV22 = (
  value: unknown,
  request: AeFaceTrackingRequestV22,
): AeFaceTrackingResponseV22 => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("AE face-tracking adapter returned a non-object response.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate["protocolVersion"] !== AE_FACE_TRACKING_PROTOCOL_VERSION_V22) {
    throw new TypeError("AE face-tracking adapter protocol version mismatch.");
  }
  if (candidate["requestId"] !== request.requestId || candidate["operationId"] !== request.operationId) {
    throw new TypeError("AE face-tracking adapter response correlation mismatch.");
  }
  if (candidate["command"] !== request.command || !isAeFaceTrackingCommandV22(String(candidate["command"]))) {
    throw new TypeError("AE face-tracking adapter returned an invalid command correlation.");
  }
  const outcome = candidate["outcome"];
  if (outcome !== "NO_OP" && outcome !== "REJECTED" && outcome !== "FAILED" && outcome !== "APPLIED") {
    throw new TypeError("AE face-tracking adapter returned an invalid operation outcome.");
  }
  return candidate as unknown as AeFaceTrackingResponseV22;
};

export class CepEvalScriptFaceTrackingTransportV22 implements AeFaceTrackingTransportV22 {
  readonly bridge: CepEvalScriptFaceTrackingBridgeV22;
  constructor(bridge: CepEvalScriptFaceTrackingBridgeV22) { this.bridge = bridge; }
  async dispatch(request: AeFaceTrackingRequestV22): Promise<AeFaceTrackingResponseV22> {
    const script = `EditFlow2_dispatch(${escapeForEvalScript(JSON.stringify(request))})`;
    return await new Promise<AeFaceTrackingResponseV22>((resolve, reject) => {
      this.bridge.evalScript(script, (rawResult) => {
        try { resolve(ensureResponseV22(JSON.parse(rawResult) as unknown, request)); }
        catch (error) { reject(error); }
      });
    });
  }
}

export const buildFaceTrackingRequestV22 = (input: {
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly command: AeFaceTrackingCommandV22;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile?: string | null;
}): AeFaceTrackingRequestV22 => ({
  protocolVersion: AE_FACE_TRACKING_PROTOCOL_VERSION_V22,
  requestId: input.requestId,
  transactionId: input.transactionId,
  operationId: input.operationId,
  capabilityId: capabilityForFaceTrackingCommandV22(input.command),
  command: input.command,
  expectedHostProjectRevision: null,
  payload: input.payload,
  readbackProfile: input.readbackProfile ?? "M4_FACE_TRACKING_STRUCTURAL",
});

export const M4_FACE_READBACK_CAPABILITIES_V22: readonly CapabilityRecord[] =
  AE_FACE_TRACKING_COMMANDS_V22.map((command): CapabilityRecord => ({
    id: asCapabilityId(capabilityForFaceTrackingCommandV22(command)),
    domain: "tracking",
    description: "M4 read-only Detailed Face Tracking mask and Face Track Points keyframe readback.",
    status: "PARTIAL",
    proofMaturity: "STRUCTURAL",
    routes: [{
      routeId: asRouteId(AE_FACE_TRACKING_ROUTE_ID_V22),
      kind: "HOST_ADAPTER",
      available: true,
      adapterVersion: AE_FACE_TRACKING_ADAPTER_BUILD_V22,
    }],
    readbackStrategy: "FACE_TRACK_POINTS_KEYFRAME_READBACK",
    visualProofProfile: null,
    rollbackStrategy: "NONE_REQUIRED",
    riskClass: "R0_READ_ONLY",
    fallbackPolicy: "FORBID",
  }));

export type FaceTrackingDirectionV1 = "FORWARD" | "BACKWARD";
export type FaceTrackingEscalationV1 =
  | "VISUAL_DRIVER_UNAVAILABLE"
  | "FACE_TARGET_UNAVAILABLE"
  | "VISUAL_ACTION_REFUSED"
  | "ANALYSIS_DIRECTION_UNPROVEN"
  | "ANALYSIS_NOT_OBSERVED";

export interface FaceVisualTrackingRequestV1 {
  readonly direction: FaceTrackingDirectionV1;
  readonly compHostId: number;
  readonly layerHostId: number;
  readonly maskStableId: string;
  readonly expectedCompName: string;
  readonly expectedLayerName: string;
  readonly expectedMaskName: string;
  readonly expectedControl: "FACE_ANALYZE_FORWARD" | "FACE_ANALYZE_BACKWARD";
}
export interface FaceVisualTrackingResultV1 {
  readonly status: "COMPLETED" | "REFUSED";
  readonly visualEvidenceId?: string | null;
  readonly detail?: string | null;
}
export interface FaceVisualTrackingDriverV1 {
  readonly driverId: string;
  readonly verifiedVision: boolean;
  readonly verifiedCursorControl: boolean;
  readonly supportedDirections: readonly FaceTrackingDirectionV1[];
  analyze(input: FaceVisualTrackingRequestV1): Promise<FaceVisualTrackingResultV1>;
}

export interface FaceTrackingRunV1 {
  readonly route: "LOCAL" | "ESCALATE";
  readonly direction: FaceTrackingDirectionV1;
  readonly escalationReason: FaceTrackingEscalationV1 | null;
  readonly baselineMaskPathKeyCount: number;
  readonly finalMaskPathKeyCount: number;
  readonly baselineFaceKeyedPropertyCount: number;
  readonly finalFaceKeyedPropertyCount: number;
  readonly baselineFaceMaxKeyCount: number;
  readonly finalFaceMaxKeyCount: number;
  readonly finalLandmarkKeyedPropertyCount: number;
  readonly visualEvidenceId: string | null;
}

export const M4_FACE_TRACKING_CAPABILITY_V1: CapabilityRecord = {
  id: asCapabilityId("ae.face.tracking.detailed.guarded_visual"),
  domain: "tracking",
  description: "Guarded native AE Face Tracking (Detailed Features) with protocol 2.2 Face Track Points truth.",
  status: "ADAPTER_REQUIRED",
  proofMaturity: "STRUCTURAL",
  routes: [{
    routeId: asRouteId("ae.m4.face.tracking.detailed.guarded_visual.v1"),
    kind: "GUARDED_UI",
    available: false,
    adapterVersion: "0.5.0-dev.1",
    limitations: ["Requires verified EditGPT vision+cursor control of AE's custom Tracker panel."],
  }],
  readbackStrategy: "PRE_POST_PROTOCOL_2_2_FACE_TRACK_POINTS_READBACK",
  visualProofProfile: "M4_FACE_TRACKING_DETAILED_VISUAL_ACTION",
  rollbackStrategy: "FIXTURE_OR_PROJECT_TRANSACTION_OWNED_CLEANUP",
  riskClass: "R4_EXTERNAL_UI",
  limitations: [
    "Detailed Features is accepted only when the bound mask gains Mask Path keys and Face Track Points gains keyed facial landmarks.",
    "Analyze Forward has retained real-AE evidence; Analyze Backward remains unavailable until equivalent retained proof exists.",
  ],
  fallbackPolicy: "EXPLICIT_ONLY",
};

export const capabilityForFaceTrackingDriverV1 = (
  driver: FaceVisualTrackingDriverV1 | null,
): CapabilityRecord => {
  const available = !!driver
    && driver.verifiedVision
    && driver.verifiedCursorControl
    && driver.supportedDirections.includes("FORWARD");
  if (!available) return M4_FACE_TRACKING_CAPABILITY_V1;
  return {
    ...M4_FACE_TRACKING_CAPABILITY_V1,
    status: "PARTIAL",
    proofMaturity: "VISUAL",
    routes: M4_FACE_TRACKING_CAPABILITY_V1.routes.map((route) => ({ ...route, available: true })),
  };
};

const facialLandmarkPattern = /(?:eye|eyebrow|pupil|nose|mouth|lip|cheek|chin|forehead|jaw)/i;
type FaceSummaryV1 = {
  readonly maskPathKeyCount: number;
  readonly faceKeyedPropertyCount: number;
  readonly faceMaxKeyCount: number;
  readonly landmarkKeyedPropertyCount: number;
};
const faceSummary = (readback: AeFaceReadbackV22 | null): FaceSummaryV1 | null => {
  if (!readback?.mask?.stableId) return null;
  const face = readback.faceTrackPoints;
  const landmarkKeyedPropertyCount = face?.properties.filter((property) =>
    property.keyedSampleCount >= 2 && facialLandmarkPattern.test(property.name),
  ).length ?? 0;
  return {
    maskPathKeyCount: readback.mask.pathKeyCount,
    faceKeyedPropertyCount: face?.keyedPropertyCount ?? 0,
    faceMaxKeyCount: face?.maxKeyCount ?? 0,
    landmarkKeyedPropertyCount,
  };
};

const readFaceTruth = async (
  transport: AeFaceTrackingTransportV22,
  input: { compHostId: number; layerHostId: number; maskStableId: string },
  suffix: string,
): Promise<AeFaceReadbackV22 | null> => {
  const request = buildFaceTrackingRequestV22({
    requestId: `M4_FACE_TRACK_${suffix}`,
    transactionId: `M4_FACE_TRACK_${suffix}`,
    operationId: `M4_FACE_TRACK_${suffix}`,
    command: "face.readback",
    payload: {
      comp: { hostId: input.compHostId },
      layer: { hostId: input.layerHostId },
      mask: { stableId: input.maskStableId },
    },
    readbackProfile: "M4_FACE_TRACKING_VERIFY",
  });
  const response = await transport.dispatch(request);
  const readback = response.readback;
  if (!readback || readback.mask.stableId !== input.maskStableId) return null;
  return readback;
};

export class GuardedFaceTrackingControllerV1 {
  readonly transport: AeFaceTrackingTransportV22;
  readonly visualDriver: FaceVisualTrackingDriverV1 | null;
  constructor(transport: AeFaceTrackingTransportV22, visualDriver: FaceVisualTrackingDriverV1 | null = null) {
    this.transport = transport;
    this.visualDriver = visualDriver;
  }
  async run(input: {
    readonly compHostId: number;
    readonly layerHostId: number;
    readonly maskStableId: string;
    readonly expectedCompName: string;
    readonly expectedLayerName: string;
    readonly direction: FaceTrackingDirectionV1;
  }): Promise<FaceTrackingRunV1> {
    const beforeReadback = await readFaceTruth(this.transport, input, "BEFORE");
    const before = faceSummary(beforeReadback);
    if (!beforeReadback || !before) return this.#escalate(input.direction, "FACE_TARGET_UNAVAILABLE", null, null, null);
    const driver = this.visualDriver;
    if (!driver || !driver.verifiedVision || !driver.verifiedCursorControl) {
      return this.#escalate(input.direction, "VISUAL_DRIVER_UNAVAILABLE", before, before, null);
    }
    if (!driver.supportedDirections.includes(input.direction)) {
      return this.#escalate(input.direction, "ANALYSIS_DIRECTION_UNPROVEN", before, before, null);
    }
    const action = await driver.analyze({
      direction: input.direction,
      compHostId: input.compHostId,
      layerHostId: input.layerHostId,
      maskStableId: input.maskStableId,
      expectedCompName: input.expectedCompName,
      expectedLayerName: input.expectedLayerName,
      expectedMaskName: beforeReadback.mask.name,
      expectedControl: input.direction === "FORWARD" ? "FACE_ANALYZE_FORWARD" : "FACE_ANALYZE_BACKWARD",
    });
    if (action.status !== "COMPLETED") {
      return this.#escalate(input.direction, "VISUAL_ACTION_REFUSED", before, before, action.visualEvidenceId ?? null);
    }
    const afterReadback = await readFaceTruth(this.transport, input, "AFTER");
    const after = faceSummary(afterReadback);
    const observed = !!afterReadback?.faceTrackPoints && !!after
      && afterReadback.faceTrackPoints.name === "Face Track Points"
      && afterReadback.faceTrackPoints.matchName === "Pseudo/ADBE Animal Head66"
      && after.maskPathKeyCount > before.maskPathKeyCount
      && after.faceKeyedPropertyCount >= Math.max(4, before.faceKeyedPropertyCount)
      && after.faceMaxKeyCount > before.faceMaxKeyCount
      && after.landmarkKeyedPropertyCount >= 4;
    if (!observed || !after) {
      return this.#escalate(input.direction, "ANALYSIS_NOT_OBSERVED", before, after ?? before, action.visualEvidenceId ?? null);
    }
    return {
      route: "LOCAL", direction: input.direction, escalationReason: null,
      baselineMaskPathKeyCount: before.maskPathKeyCount,
      finalMaskPathKeyCount: after.maskPathKeyCount,
      baselineFaceKeyedPropertyCount: before.faceKeyedPropertyCount,
      finalFaceKeyedPropertyCount: after.faceKeyedPropertyCount,
      baselineFaceMaxKeyCount: before.faceMaxKeyCount,
      finalFaceMaxKeyCount: after.faceMaxKeyCount,
      finalLandmarkKeyedPropertyCount: after.landmarkKeyedPropertyCount,
      visualEvidenceId: action.visualEvidenceId ?? null,
    };
  }
  #escalate(
    direction: FaceTrackingDirectionV1,
    reason: FaceTrackingEscalationV1,
    before: FaceSummaryV1 | null,
    after: FaceSummaryV1 | null,
    visualEvidenceId: string | null,
  ): FaceTrackingRunV1 {
    return {
      route: "ESCALATE", direction, escalationReason: reason,
      baselineMaskPathKeyCount: before?.maskPathKeyCount ?? -1,
      finalMaskPathKeyCount: after?.maskPathKeyCount ?? -1,
      baselineFaceKeyedPropertyCount: before?.faceKeyedPropertyCount ?? -1,
      finalFaceKeyedPropertyCount: after?.faceKeyedPropertyCount ?? -1,
      baselineFaceMaxKeyCount: before?.faceMaxKeyCount ?? -1,
      finalFaceMaxKeyCount: after?.faceMaxKeyCount ?? -1,
      finalLandmarkKeyedPropertyCount: after?.landmarkKeyedPropertyCount ?? -1,
      visualEvidenceId,
    };
  }
}
