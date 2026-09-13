import type { OperationOutcome } from "../../../core-contracts/src/index.js";

export const AE_STABILIZATION_PROTOCOL_VERSION_V23 = "2.3.0" as const;
export const AE_STABILIZATION_ADAPTER_BUILD_V23 = "0.5.0-dev.1" as const;
export const AE_STABILIZATION_ROUTE_ID_V23 = "ae-cep.stabilization.v2_3" as const;

export const AE_STABILIZATION_COMMANDS_V23 = ["stabilization.readback"] as const;
export type AeStabilizationCommandV23 = (typeof AE_STABILIZATION_COMMANDS_V23)[number];

export interface AeStableObjectRefV23 {
  readonly stableId?: string | null;
  readonly hostId?: number | null;
}

export type AeStabilizationNumericValueV23 = number | readonly number[];
export interface AeStabilizationKeySampleV23 {
  readonly time: number;
  readonly value: AeStabilizationNumericValueV23;
}
export interface AeStabilizationPropertyReadbackV23 {
  readonly name: string;
  readonly matchName: string;
  readonly keyCount: number;
  readonly samples: readonly AeStabilizationKeySampleV23[];
}
export interface AeStabilizationTrackerReadbackV23 {
  readonly trackerIndex: number;
  readonly name: string;
  readonly matchName: string;
  readonly pointIndex: number;
  readonly pointName: string;
  readonly featureCenterKeyCount: number;
  readonly confidenceKeyCount: number;
  readonly attachPointKeyCount: number;
}
export interface AeStabilizationReadbackV23 {
  readonly comp: {
    readonly stableId: string | null;
    readonly hostId: number | null;
    readonly name: string;
    readonly width: number;
    readonly height: number;
  };
  readonly layer: {
    readonly stableId: string | null;
    readonly hostId: number | null;
    readonly name: string;
    readonly index: number;
  };
  readonly trackers: readonly AeStabilizationTrackerReadbackV23[];
  readonly transform: {
    readonly anchorPoint: AeStabilizationPropertyReadbackV23;
    readonly position: AeStabilizationPropertyReadbackV23;
    readonly scale: AeStabilizationPropertyReadbackV23;
    readonly rotation: AeStabilizationPropertyReadbackV23;
  };
}

export interface AeStabilizationRequestV23 {
  readonly protocolVersion: typeof AE_STABILIZATION_PROTOCOL_VERSION_V23;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeStabilizationCommandV23;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile: string | null;
}
export interface AeStabilizationResponseV23 {
  readonly protocolVersion: typeof AE_STABILIZATION_PROTOCOL_VERSION_V23;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeStabilizationCommandV23;
  readonly outcome: OperationOutcome;
  readonly error: { readonly category: string; readonly code: string; readonly message: string; readonly details?: unknown } | null;
  readonly affectedObjects: readonly { readonly kind: "COMP" | "LAYER"; readonly stableId: string | null; readonly hostId: number | null }[];
  readonly readback: AeStabilizationReadbackV23 | null;
  readonly hostProjectRevision: number | null;
  readonly diagnostics: {
    readonly adapterProtocolVersion: typeof AE_STABILIZATION_PROTOCOL_VERSION_V23;
    readonly adapterBuild: typeof AE_STABILIZATION_ADAPTER_BUILD_V23;
    readonly command: AeStabilizationCommandV23;
    readonly durationMs?: number;
    readonly notes: readonly string[];
  };
}
export interface AeStabilizationTransportV23 {
  dispatch(request: AeStabilizationRequestV23): Promise<AeStabilizationResponseV23>;
}

export const capabilityForStabilizationCommandV23 = (command: AeStabilizationCommandV23): string => {
  if (command === "stabilization.readback") return "ae.stabilization.readback";
  throw new TypeError(`Unsupported AE stabilization command '${String(command)}'.`);
};

const commandSetV23 = new Set<string>(AE_STABILIZATION_COMMANDS_V23);
export const isAeStabilizationCommandV23 = (command: string): command is AeStabilizationCommandV23 => commandSetV23.has(command);
