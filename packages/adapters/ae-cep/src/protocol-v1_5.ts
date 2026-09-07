import type { OperationOutcome } from "../../../core-contracts/src/index.js";

export const AE_NULL_RIG_PROTOCOL_VERSION_V15 = "1.5.0" as const;
export const AE_NULL_RIG_ADAPTER_BUILD_V15 = "0.4.0-dev.5" as const;
export const AE_NULL_RIG_ROUTE_ID_V15 = "ae-cep.null-rig.v1_5" as const;

export const AE_NULL_RIG_COMMANDS_V15 = [
  "rig.null.create",
  "rig.null.remove",
  "rig.null.readback",
] as const;

export type AeNullRigCommandV15 = (typeof AE_NULL_RIG_COMMANDS_V15)[number];

export interface AeStableObjectRefV15 {
  readonly stableId: string;
  readonly hostId?: number | null;
}

export interface AeNullRigCreatePayloadV15 {
  readonly comp: AeStableObjectRefV15;
  readonly rig: {
    readonly stableId: string;
    readonly name?: string;
  };
  readonly duration?: number | null;
  readonly threeDLayer?: boolean;
}

export interface AeNullRigTargetPayloadV15 {
  readonly comp: AeStableObjectRefV15;
  readonly rig: AeStableObjectRefV15;
}

export type AeNullRigPayloadV15 = AeNullRigCreatePayloadV15 | AeNullRigTargetPayloadV15;

export interface AeNullRigRequestV15 {
  readonly protocolVersion: typeof AE_NULL_RIG_PROTOCOL_VERSION_V15;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeNullRigCommandV15;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile: string | null;
}

export interface AeNullRigErrorV15 {
  readonly category: string;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface AeNullRigAffectedObjectV15 {
  readonly kind: "LAYER" | "COMP";
  readonly stableId: string | null;
  readonly hostId: number | null;
}

export interface AeNullRigResponseV15 {
  readonly protocolVersion: typeof AE_NULL_RIG_PROTOCOL_VERSION_V15;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeNullRigCommandV15;
  readonly outcome: OperationOutcome;
  readonly error: AeNullRigErrorV15 | null;
  readonly affectedObjects: readonly AeNullRigAffectedObjectV15[];
  readonly readback: Readonly<Record<string, unknown>> | null;
  readonly hostProjectRevision: number | null;
  readonly diagnostics: {
    readonly adapterProtocolVersion: typeof AE_NULL_RIG_PROTOCOL_VERSION_V15;
    readonly adapterBuild: typeof AE_NULL_RIG_ADAPTER_BUILD_V15;
    readonly command: AeNullRigCommandV15;
    readonly durationMs?: number;
    readonly notes: readonly string[];
  };
}

export interface AeNullRigTransportV15 {
  dispatch(request: AeNullRigRequestV15): Promise<AeNullRigResponseV15>;
}

const commandSetV15 = new Set<string>(AE_NULL_RIG_COMMANDS_V15);

export const isAeNullRigCommandV15 = (command: string): command is AeNullRigCommandV15 => commandSetV15.has(command);

export const capabilityForNullRigCommandV15 = (command: AeNullRigCommandV15): string => {
  switch (command) {
    case "rig.null.create": return "ae.rig.null.create";
    case "rig.null.remove": return "ae.rig.null.remove";
    case "rig.null.readback": return "ae.rig.null.readback";
  }
};
