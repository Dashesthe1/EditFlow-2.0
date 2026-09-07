import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";
import {
  AE_NULL_RIG_ADAPTER_BUILD_V15,
  AE_NULL_RIG_COMMANDS_V15,
  AE_NULL_RIG_PROTOCOL_VERSION_V15,
  AE_NULL_RIG_ROUTE_ID_V15,
  capabilityForNullRigCommandV15,
  isAeNullRigCommandV15,
  type AeNullRigCommandV15,
  type AeNullRigRequestV15,
  type AeNullRigResponseV15,
} from "./protocol-v1_5.js";

export interface CepEvalScriptNullRigBridgeV15 {
  evalScript(script: string, callback: (result: string) => void): void;
}

const escapeForEvalScript = (value: string): string => JSON.stringify(value)
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

const ensureNullRigResponseV15 = (value: unknown, request: AeNullRigRequestV15): AeNullRigResponseV15 => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("AE null-rig adapter returned a non-object response.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate["protocolVersion"] !== AE_NULL_RIG_PROTOCOL_VERSION_V15) {
    throw new TypeError("AE null-rig adapter protocol version mismatch.");
  }
  if (candidate["requestId"] !== request.requestId || candidate["operationId"] !== request.operationId) {
    throw new TypeError("AE null-rig adapter response correlation mismatch.");
  }
  if (candidate["command"] !== request.command || !isAeNullRigCommandV15(String(candidate["command"]))) {
    throw new TypeError("AE null-rig adapter returned an invalid command correlation.");
  }
  const outcome = candidate["outcome"];
  if (outcome !== "APPLIED" && outcome !== "NO_OP" && outcome !== "REJECTED" && outcome !== "FAILED") {
    throw new TypeError("AE null-rig adapter returned an invalid operation outcome.");
  }
  return candidate as unknown as AeNullRigResponseV15;
};

export class CepEvalScriptNullRigTransportV15 {
  readonly bridge: CepEvalScriptNullRigBridgeV15;

  constructor(bridge: CepEvalScriptNullRigBridgeV15) {
    this.bridge = bridge;
  }

  async dispatch(request: AeNullRigRequestV15): Promise<AeNullRigResponseV15> {
    const requestJson = JSON.stringify(request);
    const script = `EditFlow2_dispatch(${escapeForEvalScript(requestJson)})`;
    return await new Promise<AeNullRigResponseV15>((resolve, reject) => {
      this.bridge.evalScript(script, (rawResult) => {
        try {
          resolve(ensureNullRigResponseV15(JSON.parse(rawResult) as unknown, request));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

const riskForNullRigCommand = (command: AeNullRigCommandV15): CapabilityRecord["riskClass"] => {
  if (command === "layer.null_readback" || command === "rig.relationship_readback") return "R0_READ_ONLY";
  if (command === "layer.null_create") return "R2_STRUCTURAL";
  return "R1_REVERSIBLE";
};

export const M3_NULL_RIG_CAPABILITIES_V15: readonly CapabilityRecord[] = AE_NULL_RIG_COMMANDS_V15.map(
  (command): CapabilityRecord => ({
    id: asCapabilityId(capabilityForNullRigCommandV15(command)),
    domain: "layer",
    description: `M3 typed AE null-rig command '${command}'. Protocol 1.5 exposes true After Effects null controllers and atomic multi-child preserve-transform rig relationships without weakening protocol 1.4 single-layer parenting semantics.`,
    status: "PARTIAL",
    proofMaturity: "DECLARED",
    routes: [{
      routeId: asRouteId(AE_NULL_RIG_ROUTE_ID_V15),
      kind: "HOST_ADAPTER",
      available: true,
      adapterVersion: AE_NULL_RIG_ADAPTER_BUILD_V15,
    }],
    readbackStrategy: "HOST_STRUCTURAL_READBACK",
    visualProofProfile: command === "rig.bind_children_to_null_preserve_transform"
      || command === "rig.unbind_children_from_null_preserve_transform"
      ? "NULL_RIG_NO_JUMP_CHECKPOINT"
      : null,
    rollbackStrategy: command === "layer.null_readback" || command === "rig.relationship_readback"
      ? "NONE_REQUIRED"
      : "AE_UNDO_GROUP",
    riskClass: riskForNullRigCommand(command),
    fallbackPolicy: "FORBID",
  }),
);

export const buildNullRigRequestV15 = (input: {
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly command: AeNullRigCommandV15;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile?: string | null;
}): AeNullRigRequestV15 => ({
  protocolVersion: AE_NULL_RIG_PROTOCOL_VERSION_V15,
  requestId: input.requestId,
  transactionId: input.transactionId,
  operationId: input.operationId,
  capabilityId: capabilityForNullRigCommandV15(input.command),
  command: input.command,
  expectedHostProjectRevision: input.expectedHostProjectRevision,
  payload: input.payload,
  readbackProfile: input.readbackProfile ?? "M3_NULL_RIG_STRUCTURAL",
});
