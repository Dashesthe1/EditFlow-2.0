import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  asCapabilityId,
  asProjectRevision,
  asRouteId,
  type CapabilityRecord,
  type ExecutionPlanOperation,
  type ObservedProjectState,
} from "../../../core-contracts/src/index.js";
import { computeEnvironmentFingerprint, computeProjectFingerprint } from "../../../fingerprints/src/index.js";
import {
  toAeEnvironmentFingerprintInput,
  toAeStructuralFingerprintInput,
  type AeEnvironmentProbe,
  type AeProjectSnapshot,
} from "../../../ae-object-model/src/index.js";
import type { AsyncTransactionalHost } from "../../../executor/src/async.js";
import type { HostApplyResult } from "../../../executor/src/index.js";
import {
  AE_ADAPTER_BUILD_V11,
  AE_ADAPTER_COMMANDS_V11,
  AE_ADAPTER_PROTOCOL_VERSION_V11,
  AE_ADAPTER_PUBLIC_COMMANDS_V11,
  AE_ADAPTER_ROUTE_ID_V11,
  type AeAdapterCommandV11,
  type AeAdapterPublicCommandV11,
  type AeAdapterRequestV11,
  type AeAdapterResponseV11,
  type AeAdapterTransportV11,
  type CepEvalScriptBridgeV11,
  isAeCommandV11,
  isAeMutationCommandV11,
  isAePublicCommandV11,
} from "./protocol-v1_1.js";

const ensureResponseV11 = (value: unknown, request: AeAdapterRequestV11): AeAdapterResponseV11 => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("AE v1.1 adapter returned a non-object response.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate["protocolVersion"] !== AE_ADAPTER_PROTOCOL_VERSION_V11) {
    throw new TypeError("AE v1.1 adapter protocol version mismatch.");
  }
  if (candidate["requestId"] !== request.requestId || candidate["operationId"] !== request.operationId) {
    throw new TypeError("AE v1.1 adapter response correlation mismatch.");
  }
  if (candidate["command"] !== request.command || !isAeCommandV11(String(candidate["command"]))) {
    throw new TypeError("AE v1.1 adapter returned an invalid command correlation.");
  }
  const outcome = candidate["outcome"];
  if (outcome !== "APPLIED" && outcome !== "NO_OP" && outcome !== "REJECTED" && outcome !== "FAILED") {
    throw new TypeError("AE v1.1 adapter returned an invalid operation outcome.");
  }
  return candidate as unknown as AeAdapterResponseV11;
};

const escapeForEvalScript = (value: string): string => JSON.stringify(value)
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

export class CepEvalScriptTransportV11 implements AeAdapterTransportV11 {
  readonly bridge: CepEvalScriptBridgeV11;

  constructor(bridge: CepEvalScriptBridgeV11) {
    this.bridge = bridge;
  }

  async dispatch(request: AeAdapterRequestV11): Promise<AeAdapterResponseV11> {
    const requestJson = JSON.stringify(request);
    const script = `EditFlow2_dispatch(${escapeForEvalScript(requestJson)})`;
    return await new Promise<AeAdapterResponseV11>((resolve, reject) => {
      this.bridge.evalScript(script, (rawResult) => {
        try {
          resolve(ensureResponseV11(JSON.parse(rawResult) as unknown, request));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

export const capabilityForCommandV11 = (command: AeAdapterCommandV11): string => {
  switch (command) {
    case "host.probe": return "ae.host.probe";
    case "project.inspect": return "ae.project.inspect";
    case "project.save": return "ae.project.save";
    case "comp.create": return "ae.comp.create";
    case "comp.update_settings": return "ae.comp.settings.set";
    case "comp.remove": return "ae.comp.remove";
    case "media.import": return "ae.media.import";
    case "layer.add_media": return "ae.layer.create";
    case "layer.duplicate": return "ae.layer.duplicate";
    case "layer.remove": return "ae.layer.remove";
    case "layer.reorder": return "ae.layer.order.set";
    case "layer.set_transform": return "ae.layer.transform.set";
    case "layer.set_timing": return "ae.layer.timing.set";
    case "effect.add": return "ae.effect.add";
    case "effect.remove": return "ae.effect.remove";
    case "effect.set_property": return "ae.effect.property.set";
    case "property.set_keyframes": return "ae.keyframe.set";
    case "property.set_expression": return "ae.expression.set";
    case "layers.precompose": return "ae.precompose.layers";
    case "render.capture": return "ae.render.capture";
    case "readback.object": return "ae.object.readback";
    case "transaction.undo_last": return "ae.transaction.undo_last";
  }
};

const commandForCapabilityV11 = new Map<string, AeAdapterPublicCommandV11>(
  AE_ADAPTER_PUBLIC_COMMANDS_V11.map((command) => [capabilityForCommandV11(command), command]),
);

const riskForCommandV11 = (command: AeAdapterPublicCommandV11): CapabilityRecord["riskClass"] => {
  if (command === "host.probe" || command === "project.inspect" || command === "readback.object") return "R0_READ_ONLY";
  if (
    command === "layer.set_transform"
    || command === "layer.set_timing"
    || command === "effect.set_property"
    || command === "property.set_keyframes"
    || command === "property.set_expression"
  ) return "R1_REVERSIBLE";
  if (command === "comp.remove" || command === "layer.remove" || command === "effect.remove") return "R3_DESTRUCTIVE";
  return "R2_STRUCTURAL";
};

export const AE_CEP_PUBLIC_CAPABILITIES_V11: readonly CapabilityRecord[] = AE_ADAPTER_PUBLIC_COMMANDS_V11.map(
  (command): CapabilityRecord => ({
    id: asCapabilityId(capabilityForCommandV11(command)),
    domain: command.split(".")[0] ?? "ae",
    description: `Clean-room AE CEP v1.1 command '${command}'.`,
    status: "FULL",
    proofMaturity: "DECLARED",
    routes: [{
      routeId: asRouteId(AE_ADAPTER_ROUTE_ID_V11),
      kind: "HOST_ADAPTER",
      available: true,
      adapterVersion: AE_ADAPTER_BUILD_V11,
    }],
    readbackStrategy: command === "host.probe" ? "ENVIRONMENT_PROBE" : "HOST_STRUCTURAL_READBACK",
    visualProofProfile: command === "render.capture" ? "RENDER_CAPTURE" : null,
    rollbackStrategy: command === "host.probe" || command === "project.inspect" || command === "readback.object"
      ? "NONE_REQUIRED"
      : "AE_UNDO_GROUP",
    riskClass: riskForCommandV11(command),
    fallbackPolicy: "FORBID",
  }),
);

const normalizePolicyPath = (value: string): { normalized: string; separator: string; caseInsensitive: boolean } => {
  const windows = /^[A-Za-z]:[\\/]/.test(value) || value.includes("\\");
  const api = windows ? path.win32 : path.posix;
  return {
    normalized: api.resolve(value).replace(/[\\/]+$/, ""),
    separator: api.sep,
    caseInsensitive: windows,
  };
};

export class AeFilesystemPolicyV11 {
  readonly roots: readonly string[];
  constructor(roots: readonly string[]) { this.roots = [...roots]; }

  assertAllowed(candidate: string): void {
    const target = normalizePolicyPath(candidate);
    const allowed = this.roots.some((root) => {
      const normalizedRoot = normalizePolicyPath(root);
      const left = target.caseInsensitive ? target.normalized.toLowerCase() : target.normalized;
      const right = normalizedRoot.caseInsensitive ? normalizedRoot.normalized.toLowerCase() : normalizedRoot.normalized;
      return left === right || left.startsWith(`${right}${normalizedRoot.separator}`);
    });
    if (!allowed) throw new Error(`FILESYSTEM_PATH_NOT_ALLOWED: '${candidate}' is outside configured EditFlow roots.`);
  }

  assertCommandPayload(command: AeAdapterCommandV11, payload: Readonly<Record<string, unknown>>): void {
    if (command === "project.save" && typeof payload["path"] === "string") this.assertAllowed(payload["path"]);
    if (command === "media.import") {
      if (typeof payload["path"] !== "string") throw new Error("media.import requires a path.");
      this.assertAllowed(payload["path"]);
    }
    if (command === "render.capture") {
      if (typeof payload["outputPath"] !== "string") throw new Error("render.capture requires outputPath.");
      this.assertAllowed(payload["outputPath"]);
    }
  }
}

export interface AeCepAdapterStateV11 {
  readonly observed: ObservedProjectState;
  readonly hostRevision: number;
  readonly project: AeProjectSnapshot;
  readonly environment: AeEnvironmentProbe;
}

export class AeCepAdapterClientV11 {
  readonly transport: AeAdapterTransportV11;
  readonly requestIdFactory: () => string;
  readonly filesystemPolicy: AeFilesystemPolicyV11;

  constructor(
    transport: AeAdapterTransportV11,
    requestIdFactory: () => string = () => randomUUID(),
    filesystemPolicy = new AeFilesystemPolicyV11([]),
  ) {
    this.transport = transport;
    this.requestIdFactory = requestIdFactory;
    this.filesystemPolicy = filesystemPolicy;
  }

  #request(
    command: AeAdapterCommandV11,
    capabilityId: string,
    payload: Readonly<Record<string, unknown>>,
    options: {
      transactionId?: string;
      operationId?: string;
      expectedProjectRevision?: string | null;
      expectedProjectFingerprint?: string | null;
      expectedHostProjectRevision?: number | null;
      readbackProfile?: string | null;
    } = {},
  ): AeAdapterRequestV11 {
    const requestId = this.requestIdFactory();
    return {
      protocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
      requestId,
      transactionId: options.transactionId ?? `read:${requestId}`,
      operationId: options.operationId ?? `read:${requestId}`,
      capabilityId,
      command,
      expectedProjectRevision: options.expectedProjectRevision ?? null,
      expectedProjectFingerprint: options.expectedProjectFingerprint ?? null,
      expectedHostProjectRevision: options.expectedHostProjectRevision ?? null,
      payload,
      readbackProfile: options.readbackProfile ?? null,
    };
  }

  async probe(): Promise<AeEnvironmentProbe> {
    const request = this.#request("host.probe", "ae.host.probe", {});
    const response = await this.transport.dispatch(request);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED" || response.environmentProbe === null) {
      throw new Error(response.error?.message ?? "AE v1.1 environment probe failed.");
    }
    return response.environmentProbe;
  }

  async inspectProject(): Promise<AeProjectSnapshot> {
    const request = this.#request("project.inspect", "ae.project.inspect", {});
    const response = await this.transport.dispatch(request);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED" || response.projectSnapshot === null) {
      throw new Error(response.error?.message ?? "AE v1.1 project inspection failed.");
    }
    return response.projectSnapshot;
  }

  async observe(projectId = "after-effects-project"): Promise<AeCepAdapterStateV11> {
    const [environment, project] = await Promise.all([this.probe(), this.inspectProject()]);
    return {
      observed: {
        projectId,
        projectRevision: asProjectRevision(`ae-revision:${project.hostRevision}`),
        projectFingerprint: computeProjectFingerprint(toAeStructuralFingerprintInput(project)),
        environmentFingerprint: computeEnvironmentFingerprint(toAeEnvironmentFingerprintInput(environment)),
      },
      hostRevision: project.hostRevision,
      project,
      environment,
    };
  }

  async dispatchChecked(
    command: AeAdapterCommandV11,
    args: {
      transactionId: string;
      operationId: string;
      capabilityId?: string;
      payload: Readonly<Record<string, unknown>>;
      expectedState: ObservedProjectState;
      readbackProfile?: string | null;
    },
  ): Promise<AeAdapterResponseV11> {
    if (!isAeCommandV11(command)) throw new TypeError(`Unsupported AE v1.1 command '${String(command)}'.`);
    this.filesystemPolicy.assertCommandPayload(command, args.payload);
    const current = await this.observe(args.expectedState.projectId);
    if (current.observed.projectRevision !== args.expectedState.projectRevision) {
      throw new Error("STALE_PROJECT_REVISION: AE host revision changed before dispatch.");
    }
    if (current.observed.projectFingerprint !== args.expectedState.projectFingerprint) {
      throw new Error("STALE_PROJECT_FINGERPRINT: AE project structure changed before dispatch.");
    }
    if (current.observed.environmentFingerprint !== args.expectedState.environmentFingerprint) {
      throw new Error("STALE_ENVIRONMENT_FINGERPRINT: AE environment changed before dispatch.");
    }
    const request = this.#request(command, args.capabilityId ?? capabilityForCommandV11(command), args.payload, {
      transactionId: args.transactionId,
      operationId: args.operationId,
      expectedProjectRevision: String(args.expectedState.projectRevision),
      expectedProjectFingerprint: String(args.expectedState.projectFingerprint),
      expectedHostProjectRevision: isAeMutationCommandV11(command) ? current.hostRevision : null,
      readbackProfile: args.readbackProfile ?? null,
    });
    return await this.transport.dispatch(request);
  }

  async executePublic(
    command: AeAdapterPublicCommandV11,
    args: Parameters<AeCepAdapterClientV11["dispatchChecked"]>[1],
  ): Promise<AeAdapterResponseV11> {
    if (!isAePublicCommandV11(command)) throw new TypeError(`Command '${command}' is not public.`);
    return await this.dispatchChecked(command, args);
  }

  async undoLast(args: { transactionId: string; operationId: string; expectedState: ObservedProjectState }): Promise<AeAdapterResponseV11> {
    return await this.dispatchChecked("transaction.undo_last", {
      transactionId: args.transactionId,
      operationId: args.operationId,
      payload: {},
      expectedState: args.expectedState,
      capabilityId: "ae.transaction.undo_last",
    });
  }
}

const parsePlanOperation = (operation: ExecutionPlanOperation): { command: AeAdapterPublicCommandV11; payload: Readonly<Record<string, unknown>>; readbackProfile: string | null } => {
  const explicitCommand = operation.input["command"];
  const expectedCommand = commandForCapabilityV11.get(String(operation.capabilityId));
  if (expectedCommand === undefined) throw new Error(`No AE v1.1 public command maps capability '${operation.capabilityId}'.`);
  if (typeof explicitCommand !== "string" || explicitCommand !== expectedCommand) {
    throw new Error(`Execution operation '${operation.operationId}' command/capability mismatch.`);
  }
  const payload = operation.input["payload"];
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Execution operation '${operation.operationId}' requires an object payload.`);
  }
  const profile = operation.input["readbackProfile"];
  return {
    command: expectedCommand,
    payload: payload as Readonly<Record<string, unknown>>,
    readbackProfile: typeof profile === "string" ? profile : null,
  };
};

export class AeCepAsyncTransactionalHostV11 implements AsyncTransactionalHost {
  readonly client: AeCepAdapterClientV11;
  readonly projectId: string;
  readonly transactionId: string;

  constructor(client: AeCepAdapterClientV11, projectId: string, transactionId = "editflow-runtime") {
    this.client = client;
    this.projectId = projectId;
    this.transactionId = transactionId;
  }

  async readState(): Promise<ObservedProjectState> {
    return (await this.client.observe(this.projectId)).observed;
  }

  async captureRecoverySnapshot(): Promise<unknown> {
    return structuredClone(await this.readState());
  }

  async apply(operation: ExecutionPlanOperation): Promise<HostApplyResult> {
    const parsed = parsePlanOperation(operation);
    const expectedState = await this.readState();
    const response = await this.client.executePublic(parsed.command, {
      transactionId: this.transactionId,
      operationId: String(operation.operationId),
      capabilityId: String(operation.capabilityId),
      payload: parsed.payload,
      expectedState,
      readbackProfile: parsed.readbackProfile,
    });
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
      throw new Error(`${response.error?.code ?? response.outcome}: ${response.error?.message ?? "AE operation failed."}`);
    }
    return response.readback === null
      ? { outcome: response.outcome }
      : { outcome: response.outcome, readback: response.readback };
  }

  async restoreRecoverySnapshot(snapshot: unknown, appliedOperationCount: number): Promise<void> {
    if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw new TypeError("Invalid AE recovery snapshot.");
    }
    for (let index = 0; index < appliedOperationCount; index += 1) {
      const expectedState = await this.readState();
      const response = await this.client.undoLast({
        transactionId: this.transactionId,
        operationId: `rollback:${index + 1}`,
        expectedState,
      });
      if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
        throw new Error(`${response.error?.code ?? response.outcome}: AE undo failed.`);
      }
    }
    const restored = await this.readState();
    const expected = snapshot as ObservedProjectState;
    if (
      restored.projectId !== expected.projectId
      || restored.projectFingerprint !== expected.projectFingerprint
      || restored.environmentFingerprint !== expected.environmentFingerprint
    ) {
      throw new Error("AE undo rollback did not restore the pre-group structural fingerprint.");
    }
  }
}

export { AE_ADAPTER_COMMANDS_V11 };
