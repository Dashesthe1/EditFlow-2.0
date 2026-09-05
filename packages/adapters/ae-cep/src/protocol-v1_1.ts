import type { OperationOutcome } from "../../../core-contracts/src/index.js";
import type { AeAffectedObjectRef, AeEnvironmentProbe, AeProjectSnapshot } from "../../../ae-object-model/src/index.js";

export const AE_ADAPTER_PROTOCOL_VERSION_V11 = "1.1.0" as const;
export const AE_ADAPTER_BUILD_V11 = "0.1.0-dev.3" as const;
export const AE_ADAPTER_ROUTE_ID_V11 = "ae-cep.v1_1" as const;

export const AE_ADAPTER_PUBLIC_COMMANDS_V11 = [
  "host.probe",
  "project.inspect",
  "project.save",
  "comp.create",
  "comp.update_settings",
  "comp.remove",
  "media.import",
  "layer.add_media",
  "layer.duplicate",
  "layer.remove",
  "layer.reorder",
  "layer.set_transform",
  "layer.set_timing",
  "effect.add",
  "effect.remove",
  "effect.set_property",
  "property.set_keyframes",
  "property.set_expression",
  "layers.precompose",
  "render.capture",
  "readback.object",
] as const;

export const AE_ADAPTER_INTERNAL_COMMANDS_V11 = ["transaction.undo_last"] as const;

export const AE_ADAPTER_COMMANDS_V11 = [
  ...AE_ADAPTER_PUBLIC_COMMANDS_V11,
  ...AE_ADAPTER_INTERNAL_COMMANDS_V11,
] as const;

export type AeAdapterPublicCommandV11 = (typeof AE_ADAPTER_PUBLIC_COMMANDS_V11)[number];
export type AeAdapterCommandV11 = (typeof AE_ADAPTER_COMMANDS_V11)[number];

const publicCommandSetV11 = new Set<string>(AE_ADAPTER_PUBLIC_COMMANDS_V11);
const commandSetV11 = new Set<string>(AE_ADAPTER_COMMANDS_V11);

export const isAePublicCommandV11 = (command: string): command is AeAdapterPublicCommandV11 => publicCommandSetV11.has(command);
export const isAeCommandV11 = (command: string): command is AeAdapterCommandV11 => commandSetV11.has(command);
export const isAeMutationCommandV11 = (command: AeAdapterCommandV11): boolean =>
  command !== "host.probe" && command !== "project.inspect" && command !== "readback.object";

export interface AeAdapterRequestV11 {
  readonly protocolVersion: typeof AE_ADAPTER_PROTOCOL_VERSION_V11;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeAdapterCommandV11;
  readonly expectedProjectRevision: string | null;
  readonly expectedProjectFingerprint: string | null;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile: string | null;
}

export interface AeAdapterErrorV11 {
  readonly category: string;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface AeAdapterResponseV11 {
  readonly protocolVersion: typeof AE_ADAPTER_PROTOCOL_VERSION_V11;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeAdapterCommandV11;
  readonly outcome: OperationOutcome;
  readonly error: AeAdapterErrorV11 | null;
  readonly affectedObjects: readonly AeAffectedObjectRef[];
  readonly readback: Readonly<Record<string, unknown>> | null;
  readonly projectSnapshot: AeProjectSnapshot | null;
  readonly environmentProbe: AeEnvironmentProbe | null;
  readonly hostProjectRevision: number | null;
  readonly diagnostics: {
    readonly adapterProtocolVersion: typeof AE_ADAPTER_PROTOCOL_VERSION_V11;
    readonly adapterBuild: typeof AE_ADAPTER_BUILD_V11;
    readonly command: AeAdapterCommandV11;
    readonly durationMs?: number;
    readonly hostRevisionBefore?: number | null;
    readonly hostRevisionAfter?: number | null;
    readonly notes?: readonly string[];
  };
  readonly proofArtifactRefs: readonly string[];
}

export interface AeAdapterTransportV11 {
  dispatch(request: AeAdapterRequestV11): Promise<AeAdapterResponseV11>;
}

export interface CepEvalScriptBridgeV11 {
  evalScript(script: string, callback: (result: string) => void): void;
}
