import type { OperationOutcome } from "../../../core-contracts/src/index.js";

export const AE_TRACKER_REPAIR_PROTOCOL_VERSION_V24 = "2.4.0" as const;
export const AE_TRACKER_REPAIR_ADAPTER_BUILD_V24 = "0.5.0-dev.1" as const;
export const AE_TRACKER_REPAIR_ROUTE_ID_V24 = "ae-cep.tracker-repair.v2_4" as const;

export const AE_TRACKER_REPAIR_COMMANDS_V24 = [
  "tracker.repair.readback",
  "tracker.repair.set_feature_center",
] as const;
export type AeTrackerRepairCommandV24 = (typeof AE_TRACKER_REPAIR_COMMANDS_V24)[number];

export interface AeStableObjectRefV24 {
  readonly stableId?: string | null;
  readonly hostId?: number | null;
}

export interface AeTrackerRepairTargetV24 {
  readonly comp: AeStableObjectRefV24;
  readonly layer: AeStableObjectRefV24;
  readonly trackerIndex: number;
  readonly pointIndex: number;
  readonly time: number;
}

export interface AeTrackerFeatureCenterKeyV24 {
  readonly time: number;
  readonly value: readonly [number, number];
}
export interface AeTrackerRepairReadbackV24 {
  readonly comp: { readonly stableId: string | null; readonly hostId: number | null; readonly name: string };
  readonly layer: { readonly stableId: string | null; readonly hostId: number | null; readonly name: string; readonly index: number };
  readonly trackerIndex: number;
  readonly trackerName: string;
  readonly pointIndex: number;
  readonly pointName: string;
  readonly time: number;
  readonly featureCenter: {
    readonly keyCount: number;
    readonly exactKeyAtTime: boolean;
    readonly valueAtTime: readonly [number, number];
    readonly keys: readonly AeTrackerFeatureCenterKeyV24[];
  };
}

export interface AeTrackerRepairRequestV24 {
  readonly protocolVersion: typeof AE_TRACKER_REPAIR_PROTOCOL_VERSION_V24;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeTrackerRepairCommandV24;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile: string | null;
}
export interface AeTrackerRepairResponseV24 {
  readonly protocolVersion: typeof AE_TRACKER_REPAIR_PROTOCOL_VERSION_V24;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeTrackerRepairCommandV24;
  readonly outcome: OperationOutcome;
  readonly error: { readonly category: string; readonly code: string; readonly message: string; readonly details?: unknown } | null;
  readonly affectedObjects: readonly { readonly kind: "LAYER"; readonly stableId: string | null; readonly hostId: number | null }[];
  readonly readback: AeTrackerRepairReadbackV24 | null;
  readonly hostProjectRevision: number | null;
  readonly diagnostics: {
    readonly adapterProtocolVersion: typeof AE_TRACKER_REPAIR_PROTOCOL_VERSION_V24;
    readonly adapterBuild: typeof AE_TRACKER_REPAIR_ADAPTER_BUILD_V24;
    readonly command: AeTrackerRepairCommandV24;
    readonly durationMs?: number;
    readonly notes: readonly string[];
  };
}

export interface AeTrackerRepairTransportV24 {
  dispatch(request: AeTrackerRepairRequestV24): Promise<AeTrackerRepairResponseV24>;
}

export const capabilityForTrackerRepairCommandV24 = (command: AeTrackerRepairCommandV24): string => {
  if (command === "tracker.repair.readback") return "ae.tracker.repair.readback";
  if (command === "tracker.repair.set_feature_center") return "ae.tracker.repair.feature_center.set";
  throw new TypeError(`Unsupported AE tracker-repair command '${String(command)}'.`);
};
const commandSetV24 = new Set<string>(AE_TRACKER_REPAIR_COMMANDS_V24);

export const isAeTrackerRepairCommandV24 = (command: string): command is AeTrackerRepairCommandV24 =>
  commandSetV24.has(command);

export const isAeTrackerRepairMutationCommandV24 = (command: AeTrackerRepairCommandV24): boolean =>
  command === "tracker.repair.set_feature_center";
