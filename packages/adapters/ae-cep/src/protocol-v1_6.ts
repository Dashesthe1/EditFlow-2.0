import type { OperationOutcome } from "../../../core-contracts/src/index.js";

export const AE_LAYER_CONTROL_PROTOCOL_VERSION_V16 = "1.6.0" as const;
export const AE_LAYER_CONTROL_ADAPTER_BUILD_V16 = "0.4.0-dev.6" as const;
export const AE_LAYER_CONTROL_ROUTE_ID_V16 = "ae-cep.layer-control.v1_6" as const;

export const AE_LAYER_CONTROL_COMMANDS_V16 = [
  "layer.switches.set",
  "layer.order.set",
  "layer.controls.readback",
] as const;

export type AeLayerControlCommandV16 = (typeof AE_LAYER_CONTROL_COMMANDS_V16)[number];

export interface AeStableObjectRefV16 {
  readonly stableId: string;
  readonly hostId?: number | null;
}

export interface AeLayerSwitchPatchV16 {
  readonly enabled?: boolean;
  readonly solo?: boolean;
  readonly shy?: boolean;
  readonly locked?: boolean;
  readonly guideLayer?: boolean;
  readonly adjustmentLayer?: boolean;
  readonly threeDLayer?: boolean;
  readonly collapseTransformation?: boolean;
  readonly audioEnabled?: boolean;
}

export type AeLayerOrderPlacementV16 =
  | { readonly position: "BEGINNING" }
  | { readonly position: "END" }
  | { readonly position: "BEFORE"; readonly referenceLayer: AeStableObjectRefV16 }
  | { readonly position: "AFTER"; readonly referenceLayer: AeStableObjectRefV16 };

export interface AeLayerSwitchSetPayloadV16 {
  readonly comp: AeStableObjectRefV16;
  readonly layer: AeStableObjectRefV16;
  readonly switches: AeLayerSwitchPatchV16;
}

export interface AeLayerOrderSetPayloadV16 {
  readonly comp: AeStableObjectRefV16;
  readonly layer: AeStableObjectRefV16;
  readonly placement: AeLayerOrderPlacementV16;
}

export interface AeLayerControlReadbackPayloadV16 {
  readonly comp: AeStableObjectRefV16;
  readonly layer: AeStableObjectRefV16;
}

export type AeLayerControlPayloadV16 = AeLayerSwitchSetPayloadV16 | AeLayerOrderSetPayloadV16 | AeLayerControlReadbackPayloadV16;

export interface AeLayerControlRequestV16 {
  readonly protocolVersion: typeof AE_LAYER_CONTROL_PROTOCOL_VERSION_V16;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeLayerControlCommandV16;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile: string | null;
}

export interface AeLayerControlErrorV16 {
  readonly category: string;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface AeLayerControlAffectedObjectV16 {
  readonly kind: "LAYER" | "COMP";
  readonly stableId: string | null;
  readonly hostId: number | null;
}

export interface AeLayerControlResponseV16 {
  readonly protocolVersion: typeof AE_LAYER_CONTROL_PROTOCOL_VERSION_V16;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeLayerControlCommandV16;
  readonly outcome: OperationOutcome;
  readonly error: AeLayerControlErrorV16 | null;
  readonly affectedObjects: readonly AeLayerControlAffectedObjectV16[];
  readonly readback: Readonly<Record<string, unknown>> | null;
  readonly hostProjectRevision: number | null;
  readonly diagnostics: {
    readonly adapterProtocolVersion: typeof AE_LAYER_CONTROL_PROTOCOL_VERSION_V16;
    readonly adapterBuild: typeof AE_LAYER_CONTROL_ADAPTER_BUILD_V16;
    readonly command: AeLayerControlCommandV16;
    readonly durationMs?: number;
    readonly notes: readonly string[];
  };
}

export interface AeLayerControlTransportV16 {
  dispatch(request: AeLayerControlRequestV16): Promise<AeLayerControlResponseV16>;
}

const commandSetV16 = new Set<string>(AE_LAYER_CONTROL_COMMANDS_V16);

export const isAeLayerControlCommandV16 = (command: string): command is AeLayerControlCommandV16 => commandSetV16.has(command);

export const capabilityForLayerControlCommandV16 = (command: AeLayerControlCommandV16): string => {
  switch (command) {
    case "layer.switches.set": return "ae.layer.switches.set";
    case "layer.order.set": return "ae.layer.order.set";
    case "layer.controls.readback": return "ae.layer.controls.readback";
  }
};
