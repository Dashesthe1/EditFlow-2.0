import type { OperationOutcome } from "../../../core-contracts/src/index.js";

export const AE_MEDIA_SEQUENCE_PROTOCOL_VERSION_V25 = "2.5.0" as const;
export const AE_MEDIA_SEQUENCE_ADAPTER_BUILD_V25 = "0.5.0-dev.2" as const;
export const AE_MEDIA_SEQUENCE_ROUTE_ID_V25 = "ae-cep.media-sequence.v2_5" as const;

export const AE_MEDIA_SEQUENCE_COMMANDS_V25 = [
  "media.sequence.import",
  "media.sequence.readback",
] as const;
export type AeMediaSequenceCommandV25 = (typeof AE_MEDIA_SEQUENCE_COMMANDS_V25)[number];

export interface AeStableObjectRefV25 {
  readonly stableId?: string | null;
  readonly hostId?: number | null;
}

export interface AeMediaSequenceImportPayloadV25 {
  readonly path: string;
  readonly stableId: string;
  readonly frameRate: number;
  readonly expectedFrameCount: number;
}

export interface AeMediaSequenceReadbackPayloadV25 {
  readonly item: AeStableObjectRefV25;
}
export interface AeMediaSequenceReadbackV25 {
  readonly stableId: string | null;
  readonly hostId: number | null;
  readonly name: string;
  readonly path: string | null;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  readonly frameRate: number;
  readonly frameDuration: number;
  readonly nativeFrameRate: number;
  readonly conformFrameRate: number;
  readonly displayFrameRate: number;
  readonly isStill: boolean;
  readonly frameCount: number;
}

export interface AeMediaSequenceRequestV25 {
  readonly protocolVersion: typeof AE_MEDIA_SEQUENCE_PROTOCOL_VERSION_V25;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeMediaSequenceCommandV25;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile: string | null;
}
export interface AeMediaSequenceResponseV25 {
  readonly protocolVersion: typeof AE_MEDIA_SEQUENCE_PROTOCOL_VERSION_V25;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeMediaSequenceCommandV25;
  readonly outcome: OperationOutcome;
  readonly error: { readonly category: string; readonly code: string; readonly message: string; readonly details?: unknown } | null;
  readonly affectedObjects: readonly { readonly kind: "FOOTAGE"; readonly stableId: string | null; readonly hostId: number | null }[];
  readonly readback: AeMediaSequenceReadbackV25 | null;
  readonly hostProjectRevision: number | null;
  readonly diagnostics: {
    readonly adapterProtocolVersion: typeof AE_MEDIA_SEQUENCE_PROTOCOL_VERSION_V25;
    readonly adapterBuild: typeof AE_MEDIA_SEQUENCE_ADAPTER_BUILD_V25;
    readonly command: AeMediaSequenceCommandV25;
    readonly durationMs?: number;
    readonly notes: readonly string[];
  };
}

const commandSetV25 = new Set<string>(AE_MEDIA_SEQUENCE_COMMANDS_V25);
export const isAeMediaSequenceCommandV25 = (command: string): command is AeMediaSequenceCommandV25 =>
  commandSetV25.has(command);
export const capabilityForMediaSequenceCommandV25 = (command: AeMediaSequenceCommandV25): string => {
  if (command === "media.sequence.import") return "ae.media.sequence.import";
  if (command === "media.sequence.readback") return "ae.media.sequence.readback";
  throw new TypeError(`Unsupported AE media-sequence command '${String(command)}'.`);
};

export const isAeMediaSequenceMutationCommandV25 = (command: AeMediaSequenceCommandV25): boolean =>
  command === "media.sequence.import";
export interface AeMediaSequenceTransportV25 {
  dispatch(request: AeMediaSequenceRequestV25): Promise<AeMediaSequenceResponseV25>;
}
