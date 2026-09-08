import type { OperationOutcome } from "../../../core-contracts/src/index.js";

export const AE_MOTION_RENDER_PROTOCOL_VERSION_V110 = "1.10.0" as const;
export const AE_MOTION_RENDER_ADAPTER_BUILD_V110 = "0.4.0-dev.10" as const;
export const AE_MOTION_RENDER_ROUTE_ID_V110 = "ae-cep.motion-render.v1_10" as const;

export const AE_MOTION_RENDER_COMMANDS_V110 = [
  "comp.motion_render.set",
  "layer.motion_render.set",
  "motion_render.readback",
] as const;

export type AeMotionRenderCommandV110 = (typeof AE_MOTION_RENDER_COMMANDS_V110)[number];
export type AeFrameBlendingTypeV110 = "NO_FRAME_BLEND" | "FRAME_MIX" | "PIXEL_MOTION";

export interface AeStableObjectRefV110 {
  readonly stableId: string;
  readonly hostId?: number | null;
}

export interface AeCompMotionRenderSettingsV110 {
  readonly motionBlur?: boolean;
  readonly frameBlending?: boolean;
  readonly shutterAngle?: number;
  readonly shutterPhase?: number;
  readonly samplesPerFrame?: number;
  readonly adaptiveSampleLimit?: number;
}

export interface AeLayerMotionRenderSettingsV110 {
  readonly motionBlur?: boolean;
  readonly frameBlendingType?: AeFrameBlendingTypeV110;
}

export interface AeCompMotionRenderSetPayloadV110 {
  readonly comp: AeStableObjectRefV110;
  readonly settings: AeCompMotionRenderSettingsV110;
}

export interface AeLayerMotionRenderSetPayloadV110 {
  readonly comp: AeStableObjectRefV110;
  readonly layer: AeStableObjectRefV110;
  readonly settings: AeLayerMotionRenderSettingsV110;
}

export interface AeMotionRenderReadbackPayloadV110 {
  readonly comp: AeStableObjectRefV110;
  readonly layer?: AeStableObjectRefV110;
}

export interface AeMotionRenderRequestV110 {
  readonly protocolVersion: typeof AE_MOTION_RENDER_PROTOCOL_VERSION_V110;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeMotionRenderCommandV110;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile: string | null;
}

export interface AeMotionRenderErrorV110 {
  readonly category: string;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface AeMotionRenderAffectedObjectV110 {
  readonly kind: "COMP" | "LAYER";
  readonly stableId: string | null;
  readonly hostId: number | null;
}

export interface AeMotionRenderResponseV110 {
  readonly protocolVersion: typeof AE_MOTION_RENDER_PROTOCOL_VERSION_V110;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeMotionRenderCommandV110;
  readonly outcome: OperationOutcome;
  readonly error: AeMotionRenderErrorV110 | null;
  readonly affectedObjects: readonly AeMotionRenderAffectedObjectV110[];
  readonly readback: Readonly<Record<string, unknown>> | null;
  readonly hostProjectRevision: number | null;
  readonly diagnostics: {
    readonly adapterProtocolVersion: typeof AE_MOTION_RENDER_PROTOCOL_VERSION_V110;
    readonly adapterBuild: typeof AE_MOTION_RENDER_ADAPTER_BUILD_V110;
    readonly command: AeMotionRenderCommandV110;
    readonly durationMs?: number;
    readonly notes: readonly string[];
  };
}

export interface AeMotionRenderTransportV110 {
  dispatch(request: AeMotionRenderRequestV110): Promise<AeMotionRenderResponseV110>;
}

const commandSetV110 = new Set<string>(AE_MOTION_RENDER_COMMANDS_V110);
export const isAeMotionRenderCommandV110 = (command: string): command is AeMotionRenderCommandV110 => commandSetV110.has(command);

export const capabilityForMotionRenderCommandV110 = (command: AeMotionRenderCommandV110): string => {
  switch (command) {
    case "comp.motion_render.set": return "ae.comp.motion_render.set";
    case "layer.motion_render.set": return "ae.layer.motion_render.set";
    case "motion_render.readback": return "ae.motion_render.readback";
  }
};
