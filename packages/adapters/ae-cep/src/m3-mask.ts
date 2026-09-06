import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";
import {
  AE_MASK_ADAPTER_BUILD_V12,
  AE_MASK_COMMANDS_V12,
  AE_MASK_PROTOCOL_VERSION_V12,
  AE_MASK_ROUTE_ID_V12,
  capabilityForMaskCommandV12,
  isAeMaskCommandV12,
  type AeMaskCommandV12,
  type AeMaskRequestV12,
  type AeMaskResponseV12,
} from "./protocol-v1_2.js";

export interface CepEvalScriptMaskBridgeV12 {
  evalScript(script: string, callback: (result: string) => void): void;
}

const escapeForEvalScript = (value: string): string => JSON.stringify(value)
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

const ensureMaskResponseV12 = (value: unknown, request: AeMaskRequestV12): AeMaskResponseV12 => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("AE mask adapter returned a non-object response.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate["protocolVersion"] !== AE_MASK_PROTOCOL_VERSION_V12) {
    throw new TypeError("AE mask adapter protocol version mismatch.");
  }
  if (candidate["requestId"] !== request.requestId || candidate["operationId"] !== request.operationId) {
    throw new TypeError("AE mask adapter response correlation mismatch.");
  }
  if (candidate["command"] !== request.command || !isAeMaskCommandV12(String(candidate["command"]))) {
    throw new TypeError("AE mask adapter returned an invalid command correlation.");
  }
  const outcome = candidate["outcome"];
  if (outcome !== "APPLIED" && outcome !== "NO_OP" && outcome !== "REJECTED" && outcome !== "FAILED") {
    throw new TypeError("AE mask adapter returned an invalid operation outcome.");
  }
  return candidate as unknown as AeMaskResponseV12;
};

export class CepEvalScriptMaskTransportV12 {
  readonly bridge: CepEvalScriptMaskBridgeV12;

  constructor(bridge: CepEvalScriptMaskBridgeV12) {
    this.bridge = bridge;
  }

  async dispatch(request: AeMaskRequestV12): Promise<AeMaskResponseV12> {
    const requestJson = JSON.stringify(request);
    const script = `EditFlow2_dispatch(${escapeForEvalScript(requestJson)})`;
    return await new Promise<AeMaskResponseV12>((resolve, reject) => {
      this.bridge.evalScript(script, (rawResult) => {
        try {
          resolve(ensureMaskResponseV12(JSON.parse(rawResult) as unknown, request));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

const riskForMaskCommand = (command: AeMaskCommandV12): CapabilityRecord["riskClass"] => {
  if (command === "mask.readback") return "R0_READ_ONLY";
  if (command === "mask.set_path" || command === "mask.set_properties" || command === "mask.reorder") return "R1_REVERSIBLE";
  if (command === "mask.remove") return "R3_DESTRUCTIVE";
  return "R2_STRUCTURAL";
};

export const M3_MASK_CAPABILITIES_V12: readonly CapabilityRecord[] = AE_MASK_COMMANDS_V12.map(
  (command): CapabilityRecord => ({
    id: asCapabilityId(capabilityForMaskCommandV12(command)),
    domain: "mask",
    description: `M3 typed AE mask/Bezier command '${command}'.`,
    status: "PARTIAL",
    proofMaturity: "DECLARED",
    routes: [{
      routeId: asRouteId(AE_MASK_ROUTE_ID_V12),
      kind: "HOST_ADAPTER",
      available: true,
      adapterVersion: AE_MASK_ADAPTER_BUILD_V12,
    }],
    readbackStrategy: "HOST_STRUCTURAL_READBACK",
    visualProofProfile: command === "mask.set_path" || command === "mask.set_properties" ? "MASK_GEOMETRY_CHECKPOINT" : null,
    rollbackStrategy: command === "mask.readback" ? "NONE_REQUIRED" : "AE_UNDO_GROUP",
    riskClass: riskForMaskCommand(command),
    fallbackPolicy: "FORBID",
  }),
);

export const buildMaskRequestV12 = (input: {
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly command: AeMaskCommandV12;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile?: string | null;
}): AeMaskRequestV12 => ({
  protocolVersion: AE_MASK_PROTOCOL_VERSION_V12,
  requestId: input.requestId,
  transactionId: input.transactionId,
  operationId: input.operationId,
  capabilityId: capabilityForMaskCommandV12(input.command),
  command: input.command,
  expectedHostProjectRevision: input.expectedHostProjectRevision,
  payload: input.payload,
  readbackProfile: input.readbackProfile ?? "M3_MASK_STRUCTURAL",
});
