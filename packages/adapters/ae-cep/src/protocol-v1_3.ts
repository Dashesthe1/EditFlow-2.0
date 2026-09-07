import type { OperationOutcome } from "../../../core-contracts/src/index.js";

export const AE_COMPOSITE_PROTOCOL_VERSION_V13 = "1.3.0" as const;
export const AE_COMPOSITE_ADAPTER_BUILD_V13 = "0.4.0-dev.3" as const;
export const AE_COMPOSITE_ROUTE_ID_V13 = "ae-cep.composite.v1_3" as const;

export const AE_COMPOSITE_COMMANDS_V13 = [
  "layer.set_track_matte",
  "layer.clear_track_matte",
  "layer.set_blend_mode",
  "layer.composite_readback",
] as const;

export const AE_TRACK_MATTE_TYPES_V13 = [
  "ALPHA",
  "ALPHA_INVERTED",
  "LUMA",
  "LUMA_INVERTED",
] as const;

export const AE_BLEND_MODES_V13 = [
  "ADD",
  "ALPHA_ADD",
  "CLASSIC_COLOR_BURN",
  "CLASSIC_COLOR_DODGE",
  "CLASSIC_DIFFERENCE",
  "COLOR",
  "COLOR_BURN",
  "COLOR_DODGE",
  "DANCING_DISSOLVE",
  "DARKEN",
  "DARKER_COLOR",
  "DIFFERENCE",
  "DISSOLVE",
  "DIVIDE",
  "EXCLUSION",
  "HARD_LIGHT",
  "HARD_MIX",
  "HUE",
  "LIGHTEN",
  "LIGHTER_COLOR",
  "LINEAR_BURN",
  "LINEAR_DODGE",
  "LINEAR_LIGHT",
  "LUMINESCENT_PREMUL",
  "LUMINOSITY",
  "MULTIPLY",
  "NORMAL",
  "OVERLAY",
  "PIN_LIGHT",
  "SATURATION",
  "SCREEN",
  "SILHOUETTE_ALPHA",
  "SILHOUETTE_LUMA",
  "SOFT_LIGHT",
  "STENCIL_ALPHA",
  "STENCIL_LUMA",
  "SUBTRACT",
  "VIVID_LIGHT",
] as const;

export type AeCompositeCommandV13 = (typeof AE_COMPOSITE_COMMANDS_V13)[number];
export type AeTrackMatteTypeV13 = (typeof AE_TRACK_MATTE_TYPES_V13)[number];
export type AeBlendModeV13 = (typeof AE_BLEND_MODES_V13)[number];

export interface AeStableObjectRefV13 {
  readonly stableId: string;
  readonly hostId?: number | null;
}

export interface AeCompositeTargetPayloadV13 {
  readonly comp: AeStableObjectRefV13;
  readonly layer: AeStableObjectRefV13;
}

export interface AeSetTrackMattePayloadV13 extends AeCompositeTargetPayloadV13 {
  readonly matteLayer: AeStableObjectRefV13;
  readonly trackMatteType: AeTrackMatteTypeV13;
}

export type AeClearTrackMattePayloadV13 = AeCompositeTargetPayloadV13;

export interface AeSetBlendModePayloadV13 extends AeCompositeTargetPayloadV13 {
  readonly blendMode: AeBlendModeV13;
}

export type AeCompositeReadbackPayloadV13 = AeCompositeTargetPayloadV13;

export type AeCompositePayloadV13 =
  | AeSetTrackMattePayloadV13
  | AeClearTrackMattePayloadV13
  | AeSetBlendModePayloadV13
  | AeCompositeReadbackPayloadV13;

export interface AeCompositeRequestV13 {
  readonly protocolVersion: typeof AE_COMPOSITE_PROTOCOL_VERSION_V13;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeCompositeCommandV13;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile: string | null;
}

export interface AeCompositeErrorV13 {
  readonly category: string;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface AeCompositeAffectedObjectV13 {
  readonly kind: "LAYER" | "COMP";
  readonly stableId: string | null;
  readonly hostId: number | null;
}

export interface AeCompositeResponseV13 {
  readonly protocolVersion: typeof AE_COMPOSITE_PROTOCOL_VERSION_V13;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeCompositeCommandV13;
  readonly outcome: OperationOutcome;
  readonly error: AeCompositeErrorV13 | null;
  readonly affectedObjects: readonly AeCompositeAffectedObjectV13[];
  readonly readback: Readonly<Record<string, unknown>> | null;
  readonly hostProjectRevision: number | null;
  readonly diagnostics: {
    readonly adapterProtocolVersion: typeof AE_COMPOSITE_PROTOCOL_VERSION_V13;
    readonly adapterBuild: typeof AE_COMPOSITE_ADAPTER_BUILD_V13;
    readonly command: AeCompositeCommandV13;
    readonly durationMs?: number;
    readonly notes: readonly string[];
  };
}

export interface AeCompositeTransportV13 {
  dispatch(request: AeCompositeRequestV13): Promise<AeCompositeResponseV13>;
}

const commandSetV13 = new Set<string>(AE_COMPOSITE_COMMANDS_V13);
const trackMatteTypeSetV13 = new Set<string>(AE_TRACK_MATTE_TYPES_V13);
const blendModeSetV13 = new Set<string>(AE_BLEND_MODES_V13);

export const isAeCompositeCommandV13 = (command: string): command is AeCompositeCommandV13 => commandSetV13.has(command);
export const isAeTrackMatteTypeV13 = (value: string): value is AeTrackMatteTypeV13 => trackMatteTypeSetV13.has(value);
export const isAeBlendModeV13 = (value: string): value is AeBlendModeV13 => blendModeSetV13.has(value);

export const capabilityForCompositeCommandV13 = (command: AeCompositeCommandV13): string => {
  switch (command) {
    case "layer.set_track_matte": return "ae.layer.track_matte.set";
    case "layer.clear_track_matte": return "ae.layer.track_matte.clear";
    case "layer.set_blend_mode": return "ae.layer.blend_mode.set";
    case "layer.composite_readback": return "ae.layer.composite.readback";
  }
};
