import type { OperationOutcome } from "../../../core-contracts/src/index.js";

export const AE_ROTO_BRUSH_PROTOCOL_VERSION_V26 = "2.6.0" as const;
export const AE_ROTO_BRUSH_ADAPTER_BUILD_V26 = "0.6.0-dev.2" as const;
export const AE_ROTO_BRUSH_ROUTE_ID_V26 = "ae-cep.roto-brush.v2_6" as const;
export const AE_ROTO_BRUSH_EFFECT_MATCH_NAME_V26 = "ADBE Samurai" as const;

export const AE_ROTO_BRUSH_COMMANDS_V26 = ["roto_brush.readback"] as const;
export type AeRotoBrushCommandV26 = (typeof AE_ROTO_BRUSH_COMMANDS_V26)[number];

export interface AeStableObjectRefV26 {
  readonly stableId?: string | null;
  readonly hostId?: number | null;
}

export interface AeRotoBrushReadbackPayloadV26 {
  readonly comp: AeStableObjectRefV26;
  readonly layer: AeStableObjectRefV26;
  readonly effectIndex?: number | null;
}

export interface AeRotoBrushPropertyNodeV26 {
  readonly index: number;
  readonly name: string;
  readonly matchName: string;
  readonly propertyType: number | null;
  readonly propertyValueType: number | null;
  readonly numProperties: number;
  readonly numKeys: number;
  readonly canSetExpression: boolean;
  readonly expressionEnabled: boolean | null;
  readonly value: unknown;
  readonly children: readonly AeRotoBrushPropertyNodeV26[];
}

export interface AeRotoBrushEffectReadbackV26 {
  readonly effectIndex: number;
  readonly name: string;
  readonly matchName: typeof AE_ROTO_BRUSH_EFFECT_MATCH_NAME_V26;
  readonly enabled: boolean;
  readonly numProperties: number;
  readonly properties: readonly AeRotoBrushPropertyNodeV26[];
}

export interface AeRotoBrushReadbackV26 {
  readonly comp: {
    readonly stableId: string | null;
    readonly hostId: number | null;
    readonly name: string;
    readonly width: number;
    readonly height: number;
    readonly duration: number;
    readonly frameRate: number;
    readonly frameDuration: number;
    readonly time: number;
  };
  readonly layer: {
    readonly stableId: string | null;
    readonly hostId: number | null;
    readonly name: string;
    readonly index: number;
    readonly time: number;
  };
  readonly rotoBrushMatchName: typeof AE_ROTO_BRUSH_EFFECT_MATCH_NAME_V26;
  readonly effectMatchCount: number;
  readonly effect: AeRotoBrushEffectReadbackV26 | null;
  readonly propertyNodeCount: number;
  readonly propertyTreeTruncated: boolean;
}

export interface AeRotoBrushRequestV26 {
  readonly protocolVersion: typeof AE_ROTO_BRUSH_PROTOCOL_VERSION_V26;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: "ae.roto_brush.session.inspect";
  readonly command: AeRotoBrushCommandV26;
  readonly expectedHostProjectRevision: null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile: string | null;
}

export interface AeRotoBrushResponseV26 {
  readonly protocolVersion: typeof AE_ROTO_BRUSH_PROTOCOL_VERSION_V26;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: "ae.roto_brush.session.inspect";
  readonly command: AeRotoBrushCommandV26;
  readonly outcome: OperationOutcome;
  readonly error: { readonly category: string; readonly code: string; readonly message: string; readonly details?: unknown } | null;
  readonly affectedObjects: readonly [];
  readonly readback: AeRotoBrushReadbackV26 | null;
  readonly hostProjectRevision: number | null;
  readonly diagnostics: {
    readonly adapterProtocolVersion: typeof AE_ROTO_BRUSH_PROTOCOL_VERSION_V26;
    readonly adapterBuild: typeof AE_ROTO_BRUSH_ADAPTER_BUILD_V26;
    readonly command: AeRotoBrushCommandV26;
    readonly durationMs?: number;
    readonly notes: readonly string[];
  };
}

export interface AeRotoBrushTransportV26 {
  dispatch(request: AeRotoBrushRequestV26): Promise<AeRotoBrushResponseV26>;
}

const commandSetV26 = new Set<string>(AE_ROTO_BRUSH_COMMANDS_V26);
export const isAeRotoBrushCommandV26 = (command: string): command is AeRotoBrushCommandV26 => commandSetV26.has(command);
export const capabilityForRotoBrushCommandV26 = (command: AeRotoBrushCommandV26): "ae.roto_brush.session.inspect" => {
  if (command === "roto_brush.readback") return "ae.roto_brush.session.inspect";
  throw new TypeError(`Unsupported AE Roto Brush command '${String(command)}'.`);
};