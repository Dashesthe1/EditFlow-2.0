import type { OperationOutcome } from "../../../core-contracts/src/index.js";

export const AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19 = "1.9.0" as const;
export const AE_SPATIAL_GRAPH_ADAPTER_BUILD_V19 = "0.4.0-dev.9" as const;
export const AE_SPATIAL_GRAPH_ROUTE_ID_V19 = "ae-cep.spatial-graph.v1_9" as const;

export const AE_SPATIAL_GRAPH_COMMANDS_V19 = [
  "property.spatial_graph.set",
  "property.spatial_graph.readback",
] as const;

export type AeSpatialGraphCommandV19 = (typeof AE_SPATIAL_GRAPH_COMMANDS_V19)[number];
export type AePropertyPathSegmentV19 = string | number;

export interface AeStableObjectRefV19 {
  readonly stableId: string;
  readonly hostId?: number | null;
}

export interface AeSpatialGraphTargetV19 {
  readonly comp: AeStableObjectRefV19;
  readonly layer: AeStableObjectRefV19;
  readonly propertyPath: readonly AePropertyPathSegmentV19[];
  readonly keyIndex: number;
}

export interface AeSpatialGraphStateV19 {
  readonly inTangent: readonly number[];
  readonly outTangent: readonly number[];
  readonly continuous: boolean;
  readonly autoBezier: boolean;
  readonly roving: boolean;
}

export interface AeSpatialGraphSetPayloadV19 extends AeSpatialGraphTargetV19 {
  readonly state: AeSpatialGraphStateV19;
}

export type AeSpatialGraphReadbackPayloadV19 = AeSpatialGraphTargetV19;

export interface AeSpatialGraphRequestV19 {
  readonly protocolVersion: typeof AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeSpatialGraphCommandV19;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile: string | null;
}

export interface AeSpatialGraphErrorV19 {
  readonly category: string;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface AeSpatialGraphResponseV19 {
  readonly protocolVersion: typeof AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeSpatialGraphCommandV19;
  readonly outcome: OperationOutcome;
  readonly error: AeSpatialGraphErrorV19 | null;
  readonly affectedObjects: readonly { readonly kind: "LAYER"; readonly stableId: string | null; readonly hostId: number | null }[];
  readonly readback: Readonly<Record<string, unknown>> | null;
  readonly hostProjectRevision: number | null;
  readonly diagnostics: {
    readonly adapterProtocolVersion: typeof AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19;
    readonly adapterBuild: typeof AE_SPATIAL_GRAPH_ADAPTER_BUILD_V19;
    readonly command: AeSpatialGraphCommandV19;
    readonly durationMs?: number;
    readonly notes: readonly string[];
  };
}

export interface AeSpatialGraphTransportV19 {
  dispatch(request: AeSpatialGraphRequestV19): Promise<AeSpatialGraphResponseV19>;
}

const commandSetV19 = new Set<string>(AE_SPATIAL_GRAPH_COMMANDS_V19);
export const isAeSpatialGraphCommandV19 = (command: string): command is AeSpatialGraphCommandV19 => commandSetV19.has(command);

export const capabilityForSpatialGraphCommandV19 = (command: AeSpatialGraphCommandV19): string => {
  switch (command) {
    case "property.spatial_graph.set": return "ae.property.spatial_graph.set";
    case "property.spatial_graph.readback": return "ae.property.spatial_graph.readback";
  }
};
