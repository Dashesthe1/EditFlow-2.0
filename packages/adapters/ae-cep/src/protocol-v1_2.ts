import type { OperationOutcome } from "../../../core-contracts/src/index.js";

export const AE_MASK_PROTOCOL_VERSION_V12 = "1.2.0" as const;
export const AE_MASK_ADAPTER_BUILD_V12 = "0.4.0-dev.1" as const;
export const AE_MASK_ROUTE_ID_V12 = "ae-cep.mask.v1_2" as const;

export const AE_MASK_COMMANDS_V12 = [
  "mask.create",
  "mask.remove",
  "mask.duplicate",
  "mask.reorder",
  "mask.set_path",
  "mask.set_properties",
  "mask.readback",
] as const;

export type AeMaskCommandV12 = (typeof AE_MASK_COMMANDS_V12)[number];
export type AePoint2V12 = readonly [number, number];

export interface AeMaskVariableFeatherV12 {
  readonly segLocs: readonly number[];
  readonly relSegLocs: readonly number[];
  readonly radii: readonly number[];
  readonly interps: readonly number[];
  readonly tensions: readonly number[];
  readonly types: readonly number[];
  readonly relCornerAngles: readonly number[];
}

export interface AeMaskShapeV12 {
  readonly closed: boolean;
  readonly vertices: readonly AePoint2V12[];
  readonly inTangents: readonly AePoint2V12[];
  readonly outTangents: readonly AePoint2V12[];
  readonly variableFeather?: AeMaskVariableFeatherV12 | null;
}

export interface AeMaskPathKeyframeV12 {
  readonly time: number;
  readonly shape: AeMaskShapeV12;
}

export interface AeStableObjectRefV12 {
  readonly stableId: string;
  readonly hostId?: number | null;
}

export interface AeMaskRefV12 {
  readonly stableId: string;
}

export type AeMaskModeV12 = "NONE" | "ADD" | "SUBTRACT" | "INTERSECT" | "LIGHTEN" | "DARKEN" | "DIFFERENCE";

export interface AeMaskPropertiesV12 {
  readonly feather?: AePoint2V12;
  readonly expansion?: number;
  readonly opacity?: number;
  readonly mode?: AeMaskModeV12;
  readonly inverted?: boolean;
}

export interface AeMaskCreatePayloadV12 {
  readonly comp: AeStableObjectRefV12;
  readonly layer: AeStableObjectRefV12;
  readonly stableId: string;
  readonly name?: string;
  readonly shape?: AeMaskShapeV12;
  readonly properties?: AeMaskPropertiesV12;
}

export interface AeMaskRemovePayloadV12 {
  readonly comp: AeStableObjectRefV12;
  readonly layer: AeStableObjectRefV12;
  readonly mask: AeMaskRefV12;
}

export interface AeMaskDuplicatePayloadV12 extends AeMaskRemovePayloadV12 {
  readonly stableId: string;
  readonly name?: string;
}

export interface AeMaskReorderPayloadV12 extends AeMaskRemovePayloadV12 {
  readonly index: number;
}

export interface AeMaskSetPathPayloadV12 extends AeMaskRemovePayloadV12 {
  readonly shape?: AeMaskShapeV12;
  readonly keyframes?: readonly AeMaskPathKeyframeV12[];
}

export interface AeMaskSetPropertiesPayloadV12 extends AeMaskRemovePayloadV12 {
  readonly properties: AeMaskPropertiesV12;
}

export type AeMaskReadbackPayloadV12 = AeMaskRemovePayloadV12;

export type AeMaskPayloadV12 =
  | AeMaskCreatePayloadV12
  | AeMaskRemovePayloadV12
  | AeMaskDuplicatePayloadV12
  | AeMaskReorderPayloadV12
  | AeMaskSetPathPayloadV12
  | AeMaskSetPropertiesPayloadV12
  | AeMaskReadbackPayloadV12;

export interface AeMaskRequestV12 {
  readonly protocolVersion: typeof AE_MASK_PROTOCOL_VERSION_V12;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeMaskCommandV12;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile: string | null;
}

export interface AeMaskErrorV12 {
  readonly category: string;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface AeMaskAffectedObjectV12 {
  readonly kind: "MASK" | "LAYER" | "COMP";
  readonly stableId: string | null;
  readonly hostId: number | null;
}

export interface AeMaskResponseV12 {
  readonly protocolVersion: typeof AE_MASK_PROTOCOL_VERSION_V12;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeMaskCommandV12;
  readonly outcome: OperationOutcome;
  readonly error: AeMaskErrorV12 | null;
  readonly affectedObjects: readonly AeMaskAffectedObjectV12[];
  readonly readback: Readonly<Record<string, unknown>> | null;
  readonly hostProjectRevision: number | null;
  readonly diagnostics: {
    readonly adapterProtocolVersion: typeof AE_MASK_PROTOCOL_VERSION_V12;
    readonly adapterBuild: typeof AE_MASK_ADAPTER_BUILD_V12;
    readonly command: AeMaskCommandV12;
    readonly durationMs?: number;
    readonly notes: readonly string[];
  };
}

export interface AeMaskTransportV12 {
  dispatch(request: AeMaskRequestV12): Promise<AeMaskResponseV12>;
}

const commandSetV12 = new Set<string>(AE_MASK_COMMANDS_V12);

export const isAeMaskCommandV12 = (command: string): command is AeMaskCommandV12 => commandSetV12.has(command);

export const capabilityForMaskCommandV12 = (command: AeMaskCommandV12): string => {
  switch (command) {
    case "mask.create": return "ae.mask.create";
    case "mask.remove": return "ae.mask.remove";
    case "mask.duplicate": return "ae.mask.duplicate";
    case "mask.reorder": return "ae.mask.order.set";
    case "mask.set_path": return "ae.mask.path.set";
    case "mask.set_properties": return "ae.mask.properties.set";
    case "mask.readback": return "ae.mask.readback";
  }
};
