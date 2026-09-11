import type { OperationOutcome } from "../../../core-contracts/src/index.js";

export const AE_POINT_TRACKING_PROTOCOL_VERSION_V21 = "2.1.0" as const;
export const AE_POINT_TRACKING_ADAPTER_BUILD_V21 = "0.5.0-dev.1" as const;
export const AE_POINT_TRACKING_ROUTE_ID_V21 = "ae-cep.point-tracking.v2_1" as const;

export const AE_POINT_TRACKING_COMMANDS_V21 = ["tracker.readback"] as const;
export type AePointTrackingCommandV21 = (typeof AE_POINT_TRACKING_COMMANDS_V21)[number];

export interface AeStableObjectRefV21 {
  readonly stableId: string;
  readonly hostId?: number | null;
}

export interface AeTrackerReadbackPayloadV21 {
  readonly comp: AeStableObjectRefV21;
  readonly layer: AeStableObjectRefV21;
}

export interface AeTrackerSampleV21 {
  readonly time: number;
  readonly featureCenter: readonly number[];
  readonly featureSize: readonly number[];
  readonly searchOffset: readonly number[];
  readonly searchSize: readonly number[];
  readonly confidence: number;
  readonly attachPoint: readonly number[];
  readonly attachPointOffset: readonly number[];
  readonly compPoint: readonly number[] | null;
  readonly compNormalized: readonly number[] | null;
}
export interface AeTrackerPointReadbackV21 {
  readonly pointIndex: number;
  readonly name: string;
  readonly matchName: string;
  readonly keyedSampleCount: number;
  readonly samples: readonly AeTrackerSampleV21[];
}

export interface AeTrackerReadbackV21 {
  readonly comp: { readonly stableId: string | null; readonly hostId: number | null; readonly name: string; readonly width: number; readonly height: number };
  readonly layer: { readonly stableId: string | null; readonly hostId: number | null; readonly name: string; readonly index: number };
  readonly trackers: readonly {
    readonly trackerIndex: number;
    readonly name: string;
    readonly matchName: string;
    readonly points: readonly AeTrackerPointReadbackV21[];
  }[];
}

export interface AePointTrackingRequestV21 {
  readonly protocolVersion: typeof AE_POINT_TRACKING_PROTOCOL_VERSION_V21;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AePointTrackingCommandV21;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile: string | null;
}
export interface AePointTrackingResponseV21 {
  readonly protocolVersion: typeof AE_POINT_TRACKING_PROTOCOL_VERSION_V21;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AePointTrackingCommandV21;
  readonly outcome: OperationOutcome;
  readonly error: { readonly category: string; readonly code: string; readonly message: string; readonly details?: unknown } | null;
  readonly affectedObjects: readonly { readonly kind: "COMP" | "LAYER"; readonly stableId: string | null; readonly hostId: number | null }[];
  readonly readback: AeTrackerReadbackV21 | null;
  readonly hostProjectRevision: number | null;
  readonly diagnostics: {
    readonly adapterProtocolVersion: typeof AE_POINT_TRACKING_PROTOCOL_VERSION_V21;
    readonly adapterBuild: typeof AE_POINT_TRACKING_ADAPTER_BUILD_V21;
    readonly command: AePointTrackingCommandV21;
    readonly durationMs?: number;
    readonly notes: readonly string[];
  };
}

export interface AePointTrackingTransportV21 {
  dispatch(request: AePointTrackingRequestV21): Promise<AePointTrackingResponseV21>;
}

export const capabilityForPointTrackingCommandV21 = (command: AePointTrackingCommandV21): string => {
  if (command === "tracker.readback") return "ae.tracker.readback";
  throw new TypeError(`Unsupported AE point-tracking command '${String(command)}'.`);
};

const commandSetV21 = new Set<string>(AE_POINT_TRACKING_COMMANDS_V21);
export const isAePointTrackingCommandV21 = (command: string): command is AePointTrackingCommandV21 => commandSetV21.has(command);
