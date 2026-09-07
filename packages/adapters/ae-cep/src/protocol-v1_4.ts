import type { OperationOutcome } from "../../../core-contracts/src/index.js";

export const AE_PARENTING_PROTOCOL_VERSION_V14 = "1.4.0" as const;
export const AE_PARENTING_ADAPTER_BUILD_V14 = "0.4.0-dev.4" as const;
export const AE_PARENTING_ROUTE_ID_V14 = "ae-cep.parenting.v1_4" as const;

export const AE_PARENTING_COMMANDS_V14 = [
  "layer.set_parent_preserve_transform",
  "layer.clear_parent_preserve_transform",
  "layer.parenting_readback",
] as const;

export type AeParentingCommandV14 = (typeof AE_PARENTING_COMMANDS_V14)[number];

export interface AeStableObjectRefV14 {
  readonly stableId: string;
  readonly hostId?: number | null;
}

export interface AeParentingTargetPayloadV14 {
  readonly comp: AeStableObjectRefV14;
  readonly layer: AeStableObjectRefV14;
}

export interface AeSetParentPreserveTransformPayloadV14 extends AeParentingTargetPayloadV14 {
  readonly parentLayer: AeStableObjectRefV14;
}

export type AeClearParentPreserveTransformPayloadV14 = AeParentingTargetPayloadV14;
export type AeParentingReadbackPayloadV14 = AeParentingTargetPayloadV14;

export type AeParentingPayloadV14 =
  | AeSetParentPreserveTransformPayloadV14
  | AeClearParentPreserveTransformPayloadV14
  | AeParentingReadbackPayloadV14;

export interface AeParentingRequestV14 {
  readonly protocolVersion: typeof AE_PARENTING_PROTOCOL_VERSION_V14;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeParentingCommandV14;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile: string | null;
}

export interface AeParentingErrorV14 {
  readonly category: string;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface AeParentingAffectedObjectV14 {
  readonly kind: "LAYER" | "COMP";
  readonly stableId: string | null;
  readonly hostId: number | null;
}

export interface AeParentingResponseV14 {
  readonly protocolVersion: typeof AE_PARENTING_PROTOCOL_VERSION_V14;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeParentingCommandV14;
  readonly outcome: OperationOutcome;
  readonly error: AeParentingErrorV14 | null;
  readonly affectedObjects: readonly AeParentingAffectedObjectV14[];
  readonly readback: Readonly<Record<string, unknown>> | null;
  readonly hostProjectRevision: number | null;
  readonly diagnostics: {
    readonly adapterProtocolVersion: typeof AE_PARENTING_PROTOCOL_VERSION_V14;
    readonly adapterBuild: typeof AE_PARENTING_ADAPTER_BUILD_V14;
    readonly command: AeParentingCommandV14;
    readonly durationMs?: number;
    readonly notes: readonly string[];
  };
}

export interface AeParentingTransportV14 {
  dispatch(request: AeParentingRequestV14): Promise<AeParentingResponseV14>;
}

const commandSetV14 = new Set<string>(AE_PARENTING_COMMANDS_V14);

export const isAeParentingCommandV14 = (command: string): command is AeParentingCommandV14 => commandSetV14.has(command);

export const capabilityForParentingCommandV14 = (command: AeParentingCommandV14): string => {
  switch (command) {
    case "layer.set_parent_preserve_transform": return "ae.layer.parent.set_preserve_transform";
    case "layer.clear_parent_preserve_transform": return "ae.layer.parent.clear_preserve_transform";
    case "layer.parenting_readback": return "ae.layer.parenting.readback";
  }
};
