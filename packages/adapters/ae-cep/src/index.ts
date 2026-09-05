import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  asCapabilityId,
  asProjectRevision,
  asRouteId,
  type CapabilityRecord,
  type ObservedProjectState,
} from "../../../core-contracts/src/index.js";
import { computeEnvironmentFingerprint, computeProjectFingerprint } from "../../../fingerprints/src/index.js";
import {
  toAeEnvironmentFingerprintInput,
  toAeStructuralFingerprintInput,
  type AeEnvironmentProbe,
  type AeProjectSnapshot,
} from "../../../ae-object-model/src/index.js";
import {
  AE_ADAPTER_BUILD,
  AE_ADAPTER_COMMANDS,
  AE_ADAPTER_PROTOCOL_VERSION,
  AE_ADAPTER_ROUTE_ID,
  type AeAdapterCommand,
  type AeAdapterRequest,
  type AeAdapterResponse,
  type AeAdapterTransport,
  type CepEvalScriptBridge,
  isAeMutationCommand,
} from "./protocol.js";

const commandSet = new Set<string>(AE_ADAPTER_COMMANDS);

const ensureResponse = (value: unknown, request: AeAdapterRequest): AeAdapterResponse => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("AE adapter returned a non-object response.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate["protocolVersion"] !== AE_ADAPTER_PROTOCOL_VERSION) {
    throw new TypeError("AE adapter protocol version mismatch.");
  }
  if (candidate["requestId"] !== request.requestId || candidate["operationId"] !== request.operationId) {
    throw new TypeError("AE adapter response correlation mismatch.");
  }
  if (candidate["command"] !== request.command || !commandSet.has(String(candidate["command"]))) {
    throw new TypeError("AE adapter returned an invalid command correlation.");
  }
  const outcome = candidate["outcome"];
  if (outcome !== "APPLIED" && outcome !== "NO_OP" && outcome !== "REJECTED" && outcome !== "FAILED") {
    throw new TypeError("AE adapter returned an invalid operation outcome.");
  }
  return candidate as unknown as AeAdapterResponse;
};

const escapeForEvalScript = (value: string): string => JSON.stringify(value)
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

export class CepEvalScriptTransport implements AeAdapterTransport {
  readonly bridge: CepEvalScriptBridge;

  constructor(bridge: CepEvalScriptBridge) {
    this.bridge = bridge;
  }

  async dispatch(request: AeAdapterRequest): Promise<AeAdapterResponse> {
    const requestJson = JSON.stringify(request);
    const script = `EditFlow2_dispatch(${escapeForEvalScript(requestJson)})`;
    return await new Promise<AeAdapterResponse>((resolve, reject) => {
      this.bridge.evalScript(script, (rawResult) => {
        try {
          const parsed = JSON.parse(rawResult) as unknown;
          resolve(ensureResponse(parsed, request));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

const capabilityForCommand = (command: AeAdapterCommand): string => {
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
  }
};

const riskForCommand = (command: AeAdapterCommand): CapabilityRecord["riskClass"] => {
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

export const AE_CEP_CAPABILITIES: readonly CapabilityRecord[] = AE_ADAPTER_COMMANDS.map((command): CapabilityRecord => ({
  id: asCapabilityId(capabilityForCommand(command)),
  domain: command.split(".")[0] ?? "ae",
  description: `Clean-room AE CEP adapter command '${command}'.`,
  status: "FULL",
  proofMaturity: "DECLARED",
  routes: [{
    routeId: asRouteId(AE_ADAPTER_ROUTE_ID),
    kind: "HOST_ADAPTER",
    available: true,
    adapterVersion: AE_ADAPTER_BUILD,
  }],
  readbackStrategy: command === "host.probe" ? "ENVIRONMENT_PROBE" : "HOST_STRUCTURAL_READBACK",
  visualProofProfile: command === "render.capture" ? "RENDER_CAPTURE" : null,
  rollbackStrategy: command === "host.probe" || command === "project.inspect" || command === "readback.object"
    ? "NONE_REQUIRED"
    : "TRANSACTION_BOUNDARY_REQUIRED",
  riskClass: riskForCommand(command),
  fallbackPolicy: "FORBID",
}));

const normalizePolicyPath = (value: string): { normalized: string; separator: string; caseInsensitive: boolean } => {
  const windows = /^[A-Za-z]:[\\/]/.test(value) || value.indexOf("\\") >= 0;
  const api = windows ? path.win32 : path.posix;
  const normalized = api.resolve(value).replace(/[\\/]+$/, "");
  return { normalized, separator: api.sep, caseInsensitive: windows };
};

export class AeFilesystemPolicy {
  readonly roots: readonly string[];

  constructor(roots: readonly string[]) {
    this.roots = [...roots];
  }

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

  assertCommandPayload(command: AeAdapterCommand, payload: Readonly<Record<string, unknown>>): void {
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

export interface AeCepAdapterState {
  readonly observed: ObservedProjectState;
  readonly hostRevision: number;
  readonly project: AeProjectSnapshot;
  readonly environment: AeEnvironmentProbe;
}

export class AeCepAdapterClient {
  readonly transport: AeAdapterTransport;
  readonly requestIdFactory: () => string;
  readonly filesystemPolicy: AeFilesystemPolicy;

  constructor(
    transport: AeAdapterTransport,
    requestIdFactory: () => string = () => randomUUID(),
    filesystemPolicy = new AeFilesystemPolicy([]),
  ) {
    this.transport = transport;
    this.requestIdFactory = requestIdFactory;
    this.filesystemPolicy = filesystemPolicy;
  }

  #request(
    command: AeAdapterCommand,
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
  ): AeAdapterRequest {
    const requestId = this.requestIdFactory();
    return {
      protocolVersion: AE_ADAPTER_PROTOCOL_VERSION,
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
      throw new Error(response.error?.message ?? "AE environment probe failed.");
    }
    return response.environmentProbe;
  }

  async inspectProject(): Promise<AeProjectSnapshot> {
    const request = this.#request("project.inspect", "ae.project.inspect", {});
    const response = await this.transport.dispatch(request);
    if (response.outcome === "FAILED" || response.outcome === "REJECTED" || response.projectSnapshot === null) {
      throw new Error(response.error?.message ?? "AE project inspection failed.");
    }
    return response.projectSnapshot;
  }

  async observe(projectId = "after-effects-project"): Promise<AeCepAdapterState> {
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

  async execute(
    command: AeAdapterCommand,
    args: {
      transactionId: string;
      operationId: string;
      capabilityId?: string;
      payload: Readonly<Record<string, unknown>>;
      expectedState: ObservedProjectState;
      readbackProfile?: string | null;
    },
  ): Promise<AeAdapterResponse> {
    if (!commandSet.has(command)) throw new TypeError(`Unsupported AE adapter command '${String(command)}'.`);
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

    const capabilityId = args.capabilityId ?? capabilityForCommand(command);
    const request = this.#request(command, capabilityId, args.payload, {
      transactionId: args.transactionId,
      operationId: args.operationId,
      expectedProjectRevision: String(args.expectedState.projectRevision),
      expectedProjectFingerprint: String(args.expectedState.projectFingerprint),
      expectedHostProjectRevision: isAeMutationCommand(command) ? current.hostRevision : null,
      readbackProfile: args.readbackProfile ?? null,
    });
    return await this.transport.dispatch(request);
  }
}
