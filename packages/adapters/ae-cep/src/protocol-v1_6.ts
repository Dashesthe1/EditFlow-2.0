import type { OperationOutcome } from "../../../core-contracts/src/index.js";

export const AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16 = "1.6.0" as const;
export const AE_LAYER_CONTROLS_ADAPTER_BUILD_V16 = "0.4.0-dev.6" as const;
export const AE_LAYER_CONTROLS_ROUTE_ID_V16 = "ae-cep.layer-controls.v1_6" as const;

export const AE_LAYER_CONTROLS_COMMANDS_V16 = [
  "layer.controls.set",
  "layer.controls.readback",
  "comp.layer_controls.set",
  "comp.layer_controls.readback",
] as const;

export type AeLayerControlsCommandV16 = (typeof AE_LAYER_CONTROLS_COMMANDS_V16)[number];

export const AE_LAYER_QUALITY_V16 = ["BEST", "DRAFT", "WIREFRAME"] as const;
export type AeLayerQualityV16 = (typeof AE_LAYER_QUALITY_V16)[number];

export const AE_LAYER_SAMPLING_QUALITY_V16 = ["BILINEAR", "BICUBIC"] as const;
export type AeLayerSamplingQualityV16 = (typeof AE_LAYER_SAMPLING_QUALITY_V16)[number];

export interface AeStableObjectRefV16 {
  readonly stableId?: string;
  readonly hostId?: number | null;
}

export interface AeLayerControlsPatchV16 {
  readonly enabled?: boolean;
  readonly solo?: boolean;
  readonly shy?: boolean;
  readonly locked?: boolean;
  readonly audioEnabled?: boolean;
  readonly adjustmentLayer?: boolean;
  readonly collapseTransformation?: boolean;
  readonly effectsActive?: boolean;
  readonly guideLayer?: boolean;
  readonly preserveTransparency?: boolean;
  readonly quality?: AeLayerQualityV16;
  readonly samplingQuality?: AeLayerSamplingQualityV16;
  readonly threeDLayer?: boolean;
}

export interface AeCompLayerControlsPatchV16 {
  readonly hideShyLayers?: boolean;
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
const qualitySetV16 = new Set<string>(AE_LAYER_QUALITY_V16);
const samplingQualitySetV16 = new Set<string>(AE_LAYER_SAMPLING_QUALITY_V16);

export const isAeLayerControlsCommandV16 = (command: string): command is AeLayerControlsCommandV16 => commandSetV16.has(command);
export const isAeLayerQualityV16 = (value: string): value is AeLayerQualityV16 => qualitySetV16.has(value);
export const isAeLayerSamplingQualityV16 = (value: string): value is AeLayerSamplingQualityV16 => samplingQualitySetV16.has(value);

export const capabilityForLayerControlsCommandV16 = (command: AeLayerControlsCommandV16): string => {
  switch (command) {
    case "layer.controls.set": return "ae.layer.controls.set";
    case "layer.controls.readback": return "ae.layer.controls.readback";
    case "comp.layer_controls.set": return "ae.comp.layer_controls.set";
    case "comp.layer_controls.readback": return "ae.comp.layer_controls.readback";
  }
};
