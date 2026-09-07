import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";
import { applyM3ParentingAcceptedP1P2Evidence } from "./m3-parenting-proof-maturity.js";
import {
  AE_PARENTING_ADAPTER_BUILD_V14,
  AE_PARENTING_COMMANDS_V14,
  AE_PARENTING_PROTOCOL_VERSION_V14,
  AE_PARENTING_ROUTE_ID_V14,
  capabilityForParentingCommandV14,
  isAeParentingCommandV14,
  type AeParentingCommandV14,
  type AeParentingRequestV14,
  type AeParentingResponseV14,
} from "./protocol-v1_4.js";

export interface CepEvalScriptParentingBridgeV14 {
  evalScript(script: string, callback: (result: string) => void): void;
}

const escapeForEvalScript = (value: string): string => JSON.stringify(value)
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

const ensureParentingResponseV14 = (value: unknown, request: AeParentingRequestV14): AeParentingResponseV14 => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("AE parenting adapter returned a non-object response.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate["protocolVersion"] !== AE_PARENTING_PROTOCOL_VERSION_V14) {
    throw new TypeError("AE parenting adapter protocol version mismatch.");
  }
  if (candidate["requestId"] !== request.requestId || candidate["operationId"] !== request.operationId) {
    throw new TypeError("AE parenting adapter response correlation mismatch.");
  }
  if (candidate["command"] !== request.command || !isAeParentingCommandV14(String(candidate["command"]))) {
    throw new TypeError("AE parenting adapter returned an invalid command correlation.");
  }
  const outcome = candidate["outcome"];
  if (outcome !== "APPLIED" && outcome !== "NO_OP" && outcome !== "REJECTED" && outcome !== "FAILED") {
    throw new TypeError("AE parenting adapter returned an invalid operation outcome.");
  }
  return candidate as unknown as AeParentingResponseV14;
};

export class CepEvalScriptParentingTransportV14 {
  readonly bridge: CepEvalScriptParentingBridgeV14;

  constructor(bridge: CepEvalScriptParentingBridgeV14) {
    this.bridge = bridge;
  }

  async dispatch(request: AeParentingRequestV14): Promise<AeParentingResponseV14> {
    const requestJson = JSON.stringify(request);
    const script = `EditFlow2_dispatch(${escapeForEvalScript(requestJson)})`;
    return await new Promise<AeParentingResponseV14>((resolve, reject) => {
      this.bridge.evalScript(script, (rawResult) => {
        try {
          resolve(ensureParentingResponseV14(JSON.parse(rawResult) as unknown, request));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

const riskForParentingCommand = (command: AeParentingCommandV14): CapabilityRecord["riskClass"] =>
  command === "layer.parenting_readback" ? "R0_READ_ONLY" : "R1_REVERSIBLE";

const DECLARED_M3_PARENTING_CAPABILITIES_V14: readonly CapabilityRecord[] = AE_PARENTING_COMMANDS_V14.map(
  (command): CapabilityRecord => ({
    id: asCapabilityId(capabilityForParentingCommandV14(command)),
    domain: "layer",
    description: `M3 typed AE parenting command '${command}'. Protocol 1.4 explicitly models no-jump parenting by direct Layer.parent assignment and forbids setParentWithJump semantics.`,
    status: "PARTIAL",
    proofMaturity: "DECLARED",
    routes: [{
      routeId: asRouteId(AE_PARENTING_ROUTE_ID_V14),
      kind: "HOST_ADAPTER",
      available: true,
      adapterVersion: AE_PARENTING_ADAPTER_BUILD_V14,
    }],
    readbackStrategy: "HOST_STRUCTURAL_READBACK",
    visualProofProfile: command === "layer.parenting_readback" ? null : "PARENTING_NO_JUMP_CHECKPOINT",
    rollbackStrategy: command === "layer.parenting_readback" ? "NONE_REQUIRED" : "AE_UNDO_GROUP",
    riskClass: riskForParentingCommand(command),
    fallbackPolicy: "FORBID",
  }),
);

export const M3_PARENTING_CAPABILITIES_V14: readonly CapabilityRecord[] =
  applyM3ParentingAcceptedP1P2Evidence(DECLARED_M3_PARENTING_CAPABILITIES_V14);

export const buildParentingRequestV14 = (input: {
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly command: AeParentingCommandV14;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile?: string | null;
}): AeParentingRequestV14 => ({
  protocolVersion: AE_PARENTING_PROTOCOL_VERSION_V14,
  requestId: input.requestId,
  transactionId: input.transactionId,
  operationId: input.operationId,
  capabilityId: capabilityForParentingCommandV14(input.command),
  command: input.command,
  expectedHostProjectRevision: input.expectedHostProjectRevision,
  payload: input.payload,
  readbackProfile: input.readbackProfile ?? "M3_PARENTING_STRUCTURAL",
});
