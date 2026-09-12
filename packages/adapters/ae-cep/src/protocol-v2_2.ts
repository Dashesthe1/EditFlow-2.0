import type { OperationOutcome } from "../../../core-contracts/src/index.js";

export const AE_FACE_TRACKING_PROTOCOL_VERSION_V22 = "2.2.0" as const;
export const AE_FACE_TRACKING_ADAPTER_BUILD_V22 = "0.5.0-dev.1" as const;
export const AE_FACE_TRACKING_ROUTE_ID_V22 = "ae-cep.face-tracking.v2_2" as const;

export const AE_FACE_TRACKING_COMMANDS_V22 = ["face.readback"] as const;
export type AeFaceTrackingCommandV22 = (typeof AE_FACE_TRACKING_COMMANDS_V22)[number];

export interface AeStableObjectRefV22 {
  readonly stableId?: string | null;
  readonly hostId?: number | null;
}

export interface AeFaceReadbackPayloadV22 {
  readonly comp: AeStableObjectRefV22;
  readonly layer: AeStableObjectRefV22;
  readonly mask: { readonly stableId: string };
}

export type AeFaceNumericValueV22 = number | readonly number[];

export interface AeFacePropertySampleV22 {
  readonly time: number;
  readonly value: AeFaceNumericValueV22;
}

export interface AeFacePropertyReadbackV22 {
  readonly propertyIndex: number;
  readonly name: string;
  readonly matchName: string;
  readonly valueDimensions: number;
  readonly keyedSampleCount: number;
  readonly samples: readonly AeFacePropertySampleV22[];
}

export interface AeFaceTrackPointsReadbackV22 {
  readonly effectIndex: number;
  readonly name: "Face Track Points";
  readonly matchName: "Pseudo/ADBE Animal Head66";
  readonly keyedPropertyCount: number;
  readonly maxKeyCount: number;
  readonly properties: readonly AeFacePropertyReadbackV22[];
}

export interface AeFaceReadbackV22 {
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
  readonly mask: {
    readonly stableId: string;
    readonly name: string;
    readonly pathKeyCount: number;
    readonly lastPathKeyTime: number | null;
  };
  readonly faceTrackPoints: AeFaceTrackPointsReadbackV22 | null;
}

export interface AeFaceTrackingRequestV22 {
  readonly protocolVersion: typeof AE_FACE_TRACKING_PROTOCOL_VERSION_V22;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeFaceTrackingCommandV22;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile: string | null;
}

export interface AeFaceTrackingResponseV22 {
  readonly protocolVersion: typeof AE_FACE_TRACKING_PROTOCOL_VERSION_V22;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeFaceTrackingCommandV22;
  readonly outcome: OperationOutcome;
  readonly error: { readonly category: string; readonly code: string; readonly message: string; readonly details?: unknown } | null;
  readonly affectedObjects: readonly { readonly kind: "COMP" | "LAYER" | "MASK"; readonly stableId: string | null; readonly hostId: number | null }[];
  readonly readback: AeFaceReadbackV22 | null;
  readonly hostProjectRevision: number | null;
  readonly diagnostics: {
    readonly adapterProtocolVersion: typeof AE_FACE_TRACKING_PROTOCOL_VERSION_V22;
    readonly adapterBuild: typeof AE_FACE_TRACKING_ADAPTER_BUILD_V22;
    readonly command: AeFaceTrackingCommandV22;
    readonly durationMs?: number;
    readonly notes: readonly string[];
  };
}

export interface AeFaceTrackingTransportV22 {
  dispatch(request: AeFaceTrackingRequestV22): Promise<AeFaceTrackingResponseV22>;
}

export const capabilityForFaceTrackingCommandV22 = (command: AeFaceTrackingCommandV22): string => {
  if (command === "face.readback") return "ae.face.readback";
  throw new TypeError(`Unsupported AE face-tracking command '${String(command)}'.`);
};

const commandSetV22 = new Set<string>(AE_FACE_TRACKING_COMMANDS_V22);
export const isAeFaceTrackingCommandV22 = (command: string): command is AeFaceTrackingCommandV22 => commandSetV22.has(command);
