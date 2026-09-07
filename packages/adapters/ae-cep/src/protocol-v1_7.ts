import type { OperationOutcome } from "../../../core-contracts/src/index.js";

export const AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17 = "1.7.0" as const;
export const AE_TEMPORAL_INTERPOLATION_ADAPTER_BUILD_V17 = "0.4.0-dev.7" as const;
export const AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17 = "ae-cep.temporal-interpolation.v1_7" as const;

export const AE_TEMPORAL_INTERPOLATION_COMMANDS_V17 = [
  "property.temporal_interpolation.set",
  "property.temporal_interpolation.readback",
] as const;

export const AE_KEYFRAME_INTERPOLATION_TYPES_V17 = ["LINEAR", "BEZIER", "HOLD"] as const;

export type AeTemporalInterpolationCommandV17 = (typeof AE_TEMPORAL_INTERPOLATION_COMMANDS_V17)[number];
export type AeKeyframeInterpolationTypeV17 = (typeof AE_KEYFRAME_INTERPOLATION_TYPES_V17)[number];
export type AePropertyPathSegmentV17 = string | number;

export interface AeStableObjectRefV17 {
  readonly stableId: string;
  readonly hostId?: number | null;
}

export interface AeTemporalInterpolationTargetV17 {
  readonly comp: AeStableObjectRefV17;
  readonly layer: AeStableObjectRefV17;
  readonly propertyPath: readonly AePropertyPathSegmentV17[];
  readonly keyIndex: number;
}

export interface AeTemporalInterpolationStateV17 {
  readonly inType: AeKeyframeInterpolationTypeV17;
  readonly outType: AeKeyframeInterpolationTypeV17;
  readonly temporalContinuous: boolean;
  readonly temporalAutoBezier: boolean;
}

export interface AeTemporalInterpolationSetPayloadV17 extends AeTemporalInterpolationTargetV17 {
  readonly interpolation: AeTemporalInterpolationStateV17;
}

export type AeTemporalInterpolationReadbackPayloadV17 = AeTemporalInterpolationTargetV17;

export type AeTemporalInterpolationPayloadV17 =
  | AeTemporalInterpolationSetPayloadV17
  | AeTemporalInterpolationReadbackPayloadV17;

export interface AeTemporalInterpolationRequestV17 {
  readonly protocolVersion: typeof AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeTemporalInterpolationCommandV17;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile: string | null;
}

export interface AeTemporalInterpolationErrorV17 {
  readonly category: string;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface AeTemporalInterpolationAffectedObjectV17 {
  readonly kind: "LAYER";
  readonly stableId: string | null;
  readonly hostId: number | null;
}

export interface AeTemporalInterpolationResponseV17 {
  readonly protocolVersion: typeof AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeTemporalInterpolationCommandV17;
  readonly outcome: OperationOutcome;
  readonly error: AeTemporalInterpolationErrorV17 | null;
  readonly affectedObjects: readonly AeTemporalInterpolationAffectedObjectV17[];
  readonly readback: Readonly<Record<string, unknown>> | null;
  readonly hostProjectRevision: number | null;
  readonly diagnostics: {
    readonly adapterProtocolVersion: typeof AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17;
    readonly adapterBuild: typeof AE_TEMPORAL_INTERPOLATION_ADAPTER_BUILD_V17;
    readonly command: AeTemporalInterpolationCommandV17;
    readonly durationMs?: number;
    readonly notes: readonly string[];
  };
}

export interface AeTemporalInterpolationTransportV17 {
  dispatch(request: AeTemporalInterpolationRequestV17): Promise<AeTemporalInterpolationResponseV17>;
}

const commandSetV17 = new Set<string>(AE_TEMPORAL_INTERPOLATION_COMMANDS_V17);

export const isAeTemporalInterpolationCommandV17 = (command: string): command is AeTemporalInterpolationCommandV17 =>
  commandSetV17.has(command);

export const capabilityForTemporalInterpolationCommandV17 = (command: AeTemporalInterpolationCommandV17): string => {
  switch (command) {
    case "property.temporal_interpolation.set": return "ae.property.temporal_interpolation.set";
    case "property.temporal_interpolation.readback": return "ae.property.temporal_interpolation.readback";
  }
};
