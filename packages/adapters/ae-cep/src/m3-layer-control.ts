import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";
import {
  AE_LAYER_CONTROL_ADAPTER_BUILD_V16,
  AE_LAYER_CONTROL_COMMANDS_V16,
  AE_LAYER_CONTROL_PROTOCOL_VERSION_V16,
  AE_LAYER_CONTROL_ROUTE_ID_V16,
  capabilityForLayerControlCommandV16,
  isAeLayerControlCommandV16,
  type AeLayerControlCommandV16,
  type AeLayerControlRequestV16,
  type AeLayerControlResponseV16,
} from "./protocol-v1_6.js";

export interface CepEvalScriptLayerControlBridgeV16 {
  evalScript(script: string, callback: (result: string) => void): void;
}

const escapeForEvalScript = (value: string): string => JSON.stringify(value)
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

const ensureLayerControlResponseV16 = (value: unknown, request: AeLayerControlRequestV16): AeLayerControlResponseV16 => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("AE layer-control adapter returned a non-object response.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate["protocolVersion"] !== AE_LAYER_CONTROL_PROTOCOL_VERSION_V16) {
    throw new TypeError("AE layer-control adapter protocol version mismatch.");
  }
  if (candidate["requestId"] !== request.requestId || candidate["operationId"] !== request.operationId) {
    throw new TypeError("AE layer-control adapter response correlation mismatch.");
  }
  if (candidate["command"] !== request.command || !isAeLayerControlCommandV16(String(candidate["command"]))) {
    throw new TypeError("AE layer-control adapter returned an invalid command correlation.");
  }
  const outcome = candidate["outcome"];
  if (outcome !== "APPLIED" && outcome !== "NO_OP" && outcome !== "REJECTED" && outcome !== "FAILED") {
    throw new TypeError("AE layer-control adapter returned an invalid operation outcome.");
  }
  return candidate as unknown as AeLayerControlResponseV16;
};

export class CepEvalScriptLayerControlTransportV16 {
  readonly bridge: CepEvalScriptLayerControlBridgeV16;

  constructor(bridge: CepEvalScriptLayerControlBridgeV16) {
    this.bridge = bridge;
  }

  async dispatch(request: AeLayerControlRequestV16): Promise<AeLayerControlResponseV16> {
    const requestJson = JSON.stringify(request);
    const script = `EditFlow2_dispatch(${escapeForEvalScript(requestJson)})`;
    return await new Promise<AeLayerControlResponseV16>((resolve, reject) => {
      this.bridge.evalScript(script, (rawResult) => {
        try {
          resolve(ensureLayerControlResponseV16(JSON.parse(rawResult) as unknown, request));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

const riskForLayerControlCommand = (command: AeLayerControlCommandV16): CapabilityRecord["riskClass"] => {
  if (command === "layer.controls.readback") return "R0_READ_ONLY";
  if (command === "layer.switches.set") return "R1_REVERSIBLE";
  return "R2_STRUCTURAL";
};

export const M3_LAYER_CONTROL_CAPABILITIES_V16: readonly CapabilityRecord[] = AE_LAYER_CONTROL_COMMANDS_V16.map(
  (command): CapabilityRecord => ({
    id: asCapabilityId(capabilityForLayerControlCommandV16(command)),
    domain: "layer",
    description: `M3 typed AE layer switch/order command '${command}'. Motion-blur and frame-blending controls remain intentionally deferred to the dedicated M3 motion/frame tranche.`,
    status: "PARTIAL",
    proofMaturity: "DECLARED",
    routes: [{
      routeId: asRouteId(AE_LAYER_CONTROL_ROUTE_ID_V16),
      kind: "HOST_ADAPTER",
      available: true,
      adapterVersion: AE_LAYER_CONTROL_ADAPTER_BUILD_V16,
    }],
    readbackStrategy: "HOST_STRUCTURAL_READBACK",
    visualProofProfile: command === "layer.controls.readback" ? null : "LAYER_CONTROL_STRUCTURAL_CHECKPOINT",
    rollbackStrategy: command === "layer.controls.readback" ? "NONE_REQUIRED" : "TRANSACTION_BOUNDARY_REQUIRED",
    riskClass: riskForLayerControlCommand(command),
    fallbackPolicy: "FORBID",
  }),
);

export const buildLayerControlRequestV16 = (input: {
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly command: AeLayerControlCommandV16;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile?: string | null;
}): AeLayerControlRequestV16 => ({
  protocolVersion: AE_LAYER_CONTROL_PROTOCOL_VERSION_V16,
  requestId: input.requestId,
  transactionId: input.transactionId,
  operationId: input.operationId,
  capabilityId: capabilityForLayerControlCommandV16(input.command),
  command: input.command,
  expectedHostProjectRevision: input.expectedHostProjectRevision,
  payload: input.payload,
  readbackProfile: input.readbackProfile ?? "M3_LAYER_CONTROL_STRUCTURAL",
});
