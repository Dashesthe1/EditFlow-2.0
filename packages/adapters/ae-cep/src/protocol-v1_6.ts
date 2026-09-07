import type { OperationOutcome } from "../../../core-contracts/src/index.js";

export const AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16 = "1.6.0" as const;
export const AE_LAYER_CONTROLS_ADAPTER_BUILD_V16 = "0.4.0-dev.6" as const;
export const AE_LAYER_CONTROLS_ROUTE_ID_V16 = "ae-cep.layer-controls.v1_6" as const;

export const AE_LAYER_CONTROLS_COMMANDS_V16 = [
  "layer.switches.set",
  "layer.order.set",
  "layer.controls.readback",
] as const;

export const AE_LAYER_SWITCH_KEYS_V16 = [
  "enabled",
  "audioEnabled",
  "solo",
  "locked",
  "shy",
  "collapseTransformation",
  "quality",
  "effectsActive",
  "adjustmentLayer",
  "threeDLayer",
  "preserveTransparency",
  "samplingQuality",
] as const;

export type AeLayerControlsCommandV16 = (typeof AE_LAYER_CONTROLS_COMMANDS_V16)[number];
export type AeLayerSwitchKeyV16 = (typeof AE_LAYER_SWITCH_KEYS_V16)[number];
export type AeLayerQualityV16 = "BEST" | "DRAFT" | "WIREFRAME";
export type AeLayerSamplingQualityV16 = "BILINEAR" | "BICUBIC";

export interface AeStableObjectRefV16 {
  readonly stableId: string;
  readonly hostId?: number | null;
}

export interface AeLayerSwitchesV16 {
  readonly enabled?: boolean;
  readonly audioEnabled?: boolean;
  readonly solo?: boolean;
  readonly locked?: boolean;
  readonly shy?: boolean;
  readonly collapseTransformation?: boolean;
  readonly quality?: AeLayerQualityV16;
  readonly effectsActive?: boolean;
  readonly adjustmentLayer?: boolean;
  readonly threeDLayer?: boolean;
  readonly preserveTransparency?: boolean;
  readonly samplingQuality?: AeLayerSamplingQualityV16;
}

export type AeLayerPlacementV16 =
  | { readonly kind: "BEGINNING" }
  | { readonly kind: "END" }
  | { readonly kind: "BEFORE"; readonly relativeTo: AeStableObjectRefV16 }
  | { readonly kind: "AFTER"; readonly relativeTo: AeStableObjectRefV16 };

export interface AeLayerSwitchSetPayloadV16 {
  readonly comp: AeStableObjectRefV16;
  readonly layer: AeStableObjectRefV16;
  readonly switches: AeLayerSwitchesV16;
}

export interface AeLayerOrderSetPayloadV16 {
  readonly comp: AeStableObjectRefV16;
  readonly layer: AeStableObjectRefV16;
  readonly placement: AeLayerPlacementV16;
}

export interface AeLayerControlsReadbackPayloadV16 {
  readonly comp: AeStableObjectRefV16;
  readonly layer: AeStableObjectRefV16;
}

export type AeLayerControlsPayloadV16 =
  | AeLayerSwitchSetPayloadV16
  | AeLayerOrderSetPayloadV16
  | AeLayerControlsReadbackPayloadV16;

export interface AeLayerControlsRequestV16 {
  readonly protocolVersion: typeof AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeLayerControlsCommandV16;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile: string | null;
}

export interface AeLayerControlsErrorV16 {
  readonly category: string;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface AeLayerControlsAffectedObjectV16 {
  readonly kind: "LAYER" | "COMP";
  readonly stableId: string | null;
  readonly hostId: number | null;
}

export interface AeLayerControlsResponseV16 {
  readonly protocolVersion: typeof AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeLayerControlsCommandV16;
  readonly outcome: OperationOutcome;
  readonly error: AeLayerControlsErrorV16 | null;
  readonly affectedObjects: readonly AeLayerControlsAffectedObjectV16[];
  readonly readback: Readonly<Record<string, unknown>> | null;
  readonly hostProjectRevision: number | null;
  readonly diagnostics: {
    readonly adapterProtocolVersion: typeof AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16;
    readonly adapterBuild: typeof AE_LAYER_CONTROLS_ADAPTER_BUILD_V16;
    readonly command: AeLayerControlsCommandV16;
    readonly durationMs?: number;
    readonly notes: readonly string[];
  };
}

export interface AeLayerControlsTransportV16 {
  dispatch(request: AeLayerControlsRequestV16): Promise<AeLayerControlsResponseV16>;
}

const commandSetV16 = new Set<string>(AE_LAYER_CONTROLS_COMMANDS_V16);

export const isAeLayerControlsCommandV16 = (command: string): command is AeLayerControlsCommandV16 =>
  commandSetV16.has(command);

export const capabilityForLayerControlsCommandV16 = (command: AeLayerControlsCommandV16): string => {
  switch (command) {
    case "layer.switches.set": return "ae.layer.switches.set";
    case "layer.order.set": return "ae.layer.order.set";
    case "layer.controls.readback": return "ae.layer.controls.readback";
  }
};
