import type { OperationOutcome } from "../../../core-contracts/src/index.js";

export const AE_TIME_REMAP_PROTOCOL_VERSION_V27 = "2.7.0" as const;
export const AE_TIME_REMAP_ADAPTER_BUILD_V27 = "0.7.0-dev.1" as const;
export const AE_TIME_REMAP_ROUTE_ID_V27 = "ae-cep.time-remap.v2_7" as const;

export const AE_TIME_REMAP_COMMANDS_V27 = [
  "layer.time_remap.enable",
  "layer.time_remap.readback",
] as const;

export type AeTimeRemapCommandV27 = (typeof AE_TIME_REMAP_COMMANDS_V27)[number];

export interface AeStableObjectRefV27 {
  readonly stableId?: string | null;
  readonly hostId?: number | null;
}

export interface AeTimeRemapLayerPayloadV27 {
  readonly comp: AeStableObjectRefV27;
  readonly layer: AeStableObjectRefV27;
}

export interface AeTimeRemapKeyV27 {
  readonly index: number;
  readonly time: number;
  readonly value: number;
}

export interface AeTimeRemapReadbackV27 {
  readonly layer: {
    readonly stableId: string | null;
    readonly hostId: number | null;
    readonly name: string;
    readonly index: number;
  };
  readonly canSetTimeRemapEnabled: boolean;
  readonly timeRemapEnabled: boolean;
  readonly propertyAvailable: boolean;
  readonly propertyMatchName: "ADBE Time Remapping" | null;
  readonly numKeys: number;
  readonly keys: readonly AeTimeRemapKeyV27[];
}

export interface AeTimeRemapRequestV27 {
  readonly protocolVersion: typeof AE_TIME_REMAP_PROTOCOL_VERSION_V27;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeTimeRemapCommandV27;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile: string | null;
}

export interface AeTimeRemapResponseV27 {
  readonly protocolVersion: typeof AE_TIME_REMAP_PROTOCOL_VERSION_V27;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeTimeRemapCommandV27;
  readonly outcome: OperationOutcome;
  readonly error: {
    readonly category: string;
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  } | null;
  readonly affectedObjects: readonly {
    readonly kind: "LAYER";
    readonly stableId: string | null;
    readonly hostId: number | null;
  }[];
  readonly readback: AeTimeRemapReadbackV27 | null;
  readonly hostProjectRevision: number | null;
  readonly diagnostics: {
    readonly adapterProtocolVersion: typeof AE_TIME_REMAP_PROTOCOL_VERSION_V27;
    readonly adapterBuild: typeof AE_TIME_REMAP_ADAPTER_BUILD_V27;
    readonly command: AeTimeRemapCommandV27;
    readonly durationMs?: number;
    readonly notes: readonly string[];
  };
}

export interface AeTimeRemapTransportV27 {
  dispatch(request: AeTimeRemapRequestV27): Promise<AeTimeRemapResponseV27>;
}

const commandSetV27 = new Set<string>(AE_TIME_REMAP_COMMANDS_V27);

export const isAeTimeRemapCommandV27 = (
  command: string,
): command is AeTimeRemapCommandV27 => commandSetV27.has(command);

export const capabilityForTimeRemapCommandV27 = (
  command: AeTimeRemapCommandV27,
): string => {
  if (command === "layer.time_remap.enable") return "ae.layer.time_remap.enable";
  if (command === "layer.time_remap.readback") return "ae.layer.time_remap.readback";
  throw new TypeError(`Unsupported AE time-remap command '${String(command)}'.`);
};

export const isAeTimeRemapMutationCommandV27 = (
  command: AeTimeRemapCommandV27,
): boolean => command === "layer.time_remap.enable";
