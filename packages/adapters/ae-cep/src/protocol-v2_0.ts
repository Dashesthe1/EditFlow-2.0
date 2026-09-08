import type { OperationOutcome } from "../../../core-contracts/src/index.js";

export const AE_MARKER_MOTION_PROTOCOL_VERSION_V20 = "2.0.0" as const;
export const AE_MARKER_MOTION_ADAPTER_BUILD_V20 = "0.4.0-dev.10" as const;
export const AE_MARKER_MOTION_ROUTE_ID_V20 = "ae-cep.marker-motion.v2_0" as const;

export const AE_MARKER_MOTION_COMMANDS_V20 = [
  "marker.set",
  "marker.remove",
  "marker.readback",
  "comp.motion.set",
  "comp.motion.readback",
  "layer.motion.set",
  "layer.motion.readback",
] as const;

export type AeMarkerMotionCommandV20 = (typeof AE_MARKER_MOTION_COMMANDS_V20)[number];

export interface AeStableObjectRefV20 {
  readonly stableId: string;
  readonly hostId?: number | null;
}

export type AeMarkerTargetV20 =
  | { readonly kind: "COMP"; readonly comp: AeStableObjectRefV20 }
  | { readonly kind: "LAYER"; readonly comp: AeStableObjectRefV20; readonly layer: AeStableObjectRefV20 };

export interface AeMarkerStateV20 {
  readonly comment: string;
  readonly chapter?: string;
  readonly url?: string;
  readonly frameTarget?: string;
  readonly cuePointName?: string;
  readonly duration?: number;
  readonly eventCuePoint?: boolean;
  readonly label?: number;
  readonly protectedRegion?: boolean;
  readonly parameters?: Readonly<Record<string, string>>;
}

export interface AeMarkerSetPayloadV20 {
  readonly target: AeMarkerTargetV20;
  readonly time: number;
  readonly marker: AeMarkerStateV20;
}

export interface AeMarkerRemovePayloadV20 {
  readonly target: AeMarkerTargetV20;
  readonly keyIndex: number;
}

export interface AeMarkerReadbackPayloadV20 {
  readonly target: AeMarkerTargetV20;
}

export interface AeCompMotionStateV20 {
  readonly motionBlur: boolean;
  readonly frameBlending: boolean;
  readonly shutterAngle: number;
  readonly shutterPhase: number;
  readonly samplesPerFrame: number;
  readonly adaptiveSampleLimit: number;
}

export interface AeCompMotionPayloadV20 {
  readonly comp: AeStableObjectRefV20;
  readonly state: AeCompMotionStateV20;
}

export interface AeCompMotionReadbackPayloadV20 {
  readonly comp: AeStableObjectRefV20;
}

export type AeFrameBlendingModeV20 = "NO_FRAME_BLEND" | "FRAME_MIX" | "PIXEL_MOTION";

export interface AeLayerMotionStateV20 {
  readonly motionBlur: boolean;
  readonly frameBlendingType: AeFrameBlendingModeV20;
}

export interface AeLayerMotionPayloadV20 {
  readonly comp: AeStableObjectRefV20;
  readonly layer: AeStableObjectRefV20;
  readonly state: AeLayerMotionStateV20;
}

export interface AeLayerMotionReadbackPayloadV20 {
  readonly comp: AeStableObjectRefV20;
  readonly layer: AeStableObjectRefV20;
}

export interface AeMarkerMotionRequestV20 {
  readonly protocolVersion: typeof AE_MARKER_MOTION_PROTOCOL_VERSION_V20;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeMarkerMotionCommandV20;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile: string | null;
}

export interface AeMarkerMotionErrorV20 {
  readonly category: string;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface AeMarkerMotionResponseV20 {
  readonly protocolVersion: typeof AE_MARKER_MOTION_PROTOCOL_VERSION_V20;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeMarkerMotionCommandV20;
  readonly outcome: OperationOutcome;
  readonly error: AeMarkerMotionErrorV20 | null;
  readonly affectedObjects: readonly { readonly kind: "COMP" | "LAYER"; readonly stableId: string | null; readonly hostId: number | null }[];
  readonly readback: Readonly<Record<string, unknown>> | null;
  readonly hostProjectRevision: number | null;
  readonly diagnostics: {
    readonly adapterProtocolVersion: typeof AE_MARKER_MOTION_PROTOCOL_VERSION_V20;
    readonly adapterBuild: typeof AE_MARKER_MOTION_ADAPTER_BUILD_V20;
    readonly command: AeMarkerMotionCommandV20;
    readonly durationMs?: number;
    readonly notes: readonly string[];
  };
}

export interface AeMarkerMotionTransportV20 {
  dispatch(request: AeMarkerMotionRequestV20): Promise<AeMarkerMotionResponseV20>;
}

const commandSetV20 = new Set<string>(AE_MARKER_MOTION_COMMANDS_V20);
export const isAeMarkerMotionCommandV20 = (command: string): command is AeMarkerMotionCommandV20 => commandSetV20.has(command);

export const capabilityForMarkerMotionCommandV20 = (command: AeMarkerMotionCommandV20): string => {
  switch (command) {
    case "marker.set": return "ae.marker.set";
    case "marker.remove": return "ae.marker.remove";
    case "marker.readback": return "ae.marker.readback";
    case "comp.motion.set": return "ae.comp.motion.set";
    case "comp.motion.readback": return "ae.comp.motion.readback";
    case "layer.motion.set": return "ae.layer.motion.set";
    case "layer.motion.readback": return "ae.layer.motion.readback";
  }
};
