import type { OperationOutcome } from "../../../core-contracts/src/index.js";

export const AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18 = "1.8.0" as const;
export const AE_TEMPORAL_EASE_ADAPTER_BUILD_V18 = "0.4.0-dev.8" as const;
export const AE_TEMPORAL_EASE_ROUTE_ID_V18 = "ae-cep.temporal-ease.v1_8" as const;

export const AE_TEMPORAL_EASE_COMMANDS_V18 = [
  "property.temporal_ease.set",
  "property.temporal_ease.readback",
] as const;

export type AeTemporalEaseCommandV18 = (typeof AE_TEMPORAL_EASE_COMMANDS_V18)[number];
export type AePropertyPathSegmentV18 = string | number;

export interface AeStableObjectRefV18 {
  readonly stableId: string;
  readonly hostId?: number | null;
}

export interface AeTemporalEaseTargetV18 {
  readonly comp: AeStableObjectRefV18;
  readonly layer: AeStableObjectRefV18;
  readonly propertyPath: readonly AePropertyPathSegmentV18[];
  readonly keyIndex: number;
}

export interface AeKeyframeEaseV18 {
  readonly speed: number;
  readonly influence: number;
}

export interface AeTemporalEaseStateV18 {
  readonly inEase: readonly AeKeyframeEaseV18[];
  readonly outEase: readonly AeKeyframeEaseV18[];
}

export interface AeTemporalEaseSetPayloadV18 extends AeTemporalEaseTargetV18 {
  readonly ease: AeTemporalEaseStateV18;
}

export type AeTemporalEaseReadbackPayloadV18 = AeTemporalEaseTargetV18;

export type AeTemporalEasePayloadV18 = AeTemporalEaseSetPayloadV18 | AeTemporalEaseReadbackPayloadV18;

export interface AeTemporalEaseRequestV18 {
  readonly protocolVersion: typeof AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeTemporalEaseCommandV18;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile: string | null;
}

export interface AeTemporalEaseErrorV18 {
  readonly category: string;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface AeTemporalEaseAffectedObjectV18 {
  readonly kind: "LAYER";
  readonly stableId: string | null;
  readonly hostId: number | null;
}

export interface AeTemporalEaseResponseV18 {
  readonly protocolVersion: typeof AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeTemporalEaseCommandV18;
  readonly outcome: OperationOutcome;
  readonly error: AeTemporalEaseErrorV18 | null;
  readonly affectedObjects: readonly AeTemporalEaseAffectedObjectV18[];
  readonly readback: Readonly<Record<string, unknown>> | null;
  readonly hostProjectRevision: number | null;
  readonly diagnostics: {
    readonly adapterProtocolVersion: typeof AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18;
    readonly adapterBuild: typeof AE_TEMPORAL_EASE_ADAPTER_BUILD_V18;
    readonly command: AeTemporalEaseCommandV18;
    readonly durationMs?: number;
    readonly notes: readonly string[];
  };
}

export interface AeTemporalEaseTransportV18 {
  dispatch(request: AeTemporalEaseRequestV18): Promise<AeTemporalEaseResponseV18>;
}

const commandSetV18 = new Set<string>(AE_TEMPORAL_EASE_COMMANDS_V18);

export const isAeTemporalEaseCommandV18 = (command: string): command is AeTemporalEaseCommandV18 =>
  commandSetV18.has(command);

export const capabilityForTemporalEaseCommandV18 = (command: AeTemporalEaseCommandV18): string => {
  switch (command) {
    case "property.temporal_ease.set": return "ae.property.temporal_ease.set";
    case "property.temporal_ease.readback": return "ae.property.temporal_ease.readback";
  }
};
