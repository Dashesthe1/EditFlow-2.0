export const AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16 = "1.6.0" as const;
export const AE_LAYER_CONTROLS_ADAPTER_BUILD_V16 = "0.4.0-dev.6" as const;
export const AE_LAYER_CONTROLS_ROUTE_ID_V16 = "ae-cep-layer-controls-v1.6" as const;

export const AE_LAYER_CONTROLS_COMMANDS_V16 = [
  "layer.switches.set",
  "layer.switches_readback",
] as const;

export type AeLayerControlsCommandV16 = typeof AE_LAYER_CONTROLS_COMMANDS_V16[number];
export type AeLayerQualityV16 = "BEST" | "DRAFT" | "WIREFRAME";

export interface AeLayerControlsObjectRefV16 {
  readonly stableId?: string;
  readonly hostId?: number | null;
}

export interface AeLayerSwitchPatchV16 {
  readonly enabled?: boolean;
  readonly solo?: boolean;
  readonly shy?: boolean;
  readonly locked?: boolean;
  readonly quality?: AeLayerQualityV16;
  readonly adjustmentLayer?: boolean;
  readonly guideLayer?: boolean;
  readonly threeDLayer?: boolean;
  readonly effectsActive?: boolean;
  readonly collapseTransformation?: boolean;
  readonly preserveTransparency?: boolean;
}

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
  readonly details: unknown;
}

export interface AeLayerControlsAffectedObjectV16 {
  readonly kind: string;
  readonly stableId: string | null;
  readonly hostId: number | null;
}

export interface AeLayerControlsDiagnosticsV16 {
  readonly adapterProtocolVersion: typeof AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16;
  readonly adapterBuild: typeof AE_LAYER_CONTROLS_ADAPTER_BUILD_V16;
  readonly command: AeLayerControlsCommandV16;
  readonly durationMs: number;
  readonly notes: readonly string[];
}

export interface AeLayerControlsResponseV16 {
  readonly protocolVersion: typeof AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeLayerControlsCommandV16;
  readonly outcome: "APPLIED" | "NO_OP" | "REJECTED" | "FAILED";
  readonly error: AeLayerControlsErrorV16 | null;
  readonly affectedObjects: readonly AeLayerControlsAffectedObjectV16[];
  readonly readback: unknown;
  readonly hostProjectRevision: number | null;
  readonly diagnostics: AeLayerControlsDiagnosticsV16;
}

const CAPABILITY_BY_COMMAND_V16: Readonly<Record<AeLayerControlsCommandV16, string>> = Object.freeze({
  "layer.switches.set": "ae.layer.switches.set",
  "layer.switches_readback": "ae.layer.switches.readback",
});

export const isAeLayerControlsCommandV16 = (value: string): value is AeLayerControlsCommandV16 =>
  (AE_LAYER_CONTROLS_COMMANDS_V16 as readonly string[]).includes(value);

export const capabilityForLayerControlsCommandV16 = (command: AeLayerControlsCommandV16): string =>
  CAPABILITY_BY_COMMAND_V16[command];
