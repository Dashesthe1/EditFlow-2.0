import type { OperationOutcome } from "../../../core-contracts/src/index.js";
import type {
  AeAffectedObjectRef,
  AeEnvironmentProbe,
  AeProjectSnapshot,
} from "../../../ae-object-model/src/index.js";

export const AE_ADAPTER_PROTOCOL_VERSION = "1.0.0" as const;
export const AE_ADAPTER_BUILD = "0.1.0-dev.2" as const;
export const AE_ADAPTER_ROUTE_ID = "ae-cep.v1" as const;

export const AE_ADAPTER_COMMANDS = [
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
export type AeAdapterCommand = (typeof AE_ADAPTER_COMMANDS)[number];

export const AE_MUTATION_COMMANDS = [
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
] as const satisfies readonly AeAdapterCommand[];

const mutationSet = new Set<AeAdapterCommand>(AE_MUTATION_COMMANDS);
export const isAeMutationCommand = (command: AeAdapterCommand): boolean => mutationSet.has(command);

export interface AeAdapterRequest {
  readonly protocolVersion: typeof AE_ADAPTER_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeAdapterCommand;
  readonly expectedProjectRevision: string | null;
  readonly expectedProjectFingerprint: string | null;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile: string | null;
}

export interface AeAdapterError {
  readonly category: string;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface AeAdapterDiagnostics {
  readonly adapterProtocolVersion: typeof AE_ADAPTER_PROTOCOL_VERSION;
  readonly adapterBuild: typeof AE_ADAPTER_BUILD;
  readonly command: AeAdapterCommand;
  readonly durationMs?: number;
  readonly hostRevisionBefore?: number | null;
  readonly hostRevisionAfter?: number | null;
  readonly notes?: readonly string[];
}

export interface AeAdapterResponse {
  readonly protocolVersion: typeof AE_ADAPTER_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly command: AeAdapterCommand;
  readonly outcome: OperationOutcome;
  readonly error: AeAdapterError | null;
  readonly affectedObjects: readonly AeAffectedObjectRef[];
  readonly readback: Readonly<Record<string, unknown>> | null;
  readonly projectSnapshot: AeProjectSnapshot | null;
  readonly environmentProbe: AeEnvironmentProbe | null;
  readonly hostProjectRevision: number | null;
  readonly diagnostics: AeAdapterDiagnostics;
  readonly proofArtifactRefs: readonly string[];
}

export interface AeAdapterTransport {
  dispatch(request: AeAdapterRequest): Promise<AeAdapterResponse>;
}

export interface CepEvalScriptBridge {
  evalScript(script: string, callback: (result: string) => void): void;
}
