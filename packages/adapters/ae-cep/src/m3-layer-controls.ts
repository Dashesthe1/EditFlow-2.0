import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";
import { applyM3LayerControlsAcceptedEvidence } from "./m3-layer-controls-proof-maturity.js";
import {
  AE_LAYER_CONTROLS_ADAPTER_BUILD_V16,
  AE_LAYER_CONTROLS_COMMANDS_V16,
  AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16,
  AE_LAYER_CONTROLS_ROUTE_ID_V16,
  capabilityForLayerControlsCommandV16,
  isAeLayerControlsCommandV16,
  type AeLayerControlsCommandV16,
  type AeLayerControlsRequestV16,
  type AeLayerControlsResponseV16,
} from "./protocol-v1_6.js";

export interface CepEvalScriptLayerControlsBridgeV16 {
  evalScript(script: string, callback: (result: string) => void): void;
}

const escapeForEvalScript = (value: string): string => JSON.stringify(value)
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

const ensureLayerControlsResponseV16 = (
  value: unknown,
  request: AeLayerControlsRequestV16,
): AeLayerControlsResponseV16 => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("AE layer-controls adapter returned a non-object response.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate["protocolVersion"] !== AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16) {
    throw new TypeError("AE layer-controls adapter protocol version mismatch.");
  }
  if (candidate["requestId"] !== request.requestId || candidate["operationId"] !== request.operationId) {
    throw new TypeError("AE layer-controls adapter response correlation mismatch.");
  }
  if (candidate["command"] !== request.command || !isAeLayerControlsCommandV16(String(candidate["command"]))) {
    throw new TypeError("AE layer-controls adapter returned an invalid command correlation.");
  }
  const outcome = candidate["outcome"];
  if (outcome !== "APPLIED" && outcome !== "NO_OP" && outcome !== "REJECTED" && outcome !== "FAILED") {
    throw new TypeError("AE layer-controls adapter returned an invalid operation outcome.");
  }
  return candidate as unknown as AeLayerControlsResponseV16;
};

export class CepEvalScriptLayerControlsTransportV16 {
  readonly bridge: CepEvalScriptLayerControlsBridgeV16;

  constructor(bridge: CepEvalScriptLayerControlsBridgeV16) {
    this.bridge = bridge;
  }

  async dispatch(request: AeLayerControlsRequestV16): Promise<AeLayerControlsResponseV16> {
    const requestJson = JSON.stringify(request);
    const script = `EditFlow2_dispatch(${escapeForEvalScript(requestJson)})`;
    return await new Promise<AeLayerControlsResponseV16>((resolve, reject) => {
      this.bridge.evalScript(script, (rawResult) => {
        try {
          resolve(ensureLayerControlsResponseV16(JSON.parse(rawResult) as unknown, request));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

const riskForLayerControlsCommand = (command: AeLayerControlsCommandV16): CapabilityRecord["riskClass"] =>
  command === "layer.switches_readback" ? "R0_READ_ONLY" : "R2_STRUCTURAL";

const M3_LAYER_CONTROLS_DECLARED_CAPABILITIES_V16: readonly CapabilityRecord[] = AE_LAYER_CONTROLS_COMMANDS_V16.map(
  (command): CapabilityRecord => ({
    id: asCapabilityId(capabilityForLayerControlsCommandV16(command)),
    domain: "layer",
    description: `M3 typed AE layer-control command '${command}'. Ordering remains delegated to the accepted protocol 1.1 layer.reorder route; blend modes and track mattes remain delegated to protocol 1.3; motion blur and frame blending remain reserved for their later roadmap tranche.`,
    status: "PARTIAL",
    proofMaturity: "DECLARED",
    routes: [{
      routeId: asRouteId(AE_LAYER_CONTROLS_ROUTE_ID_V16),
      kind: "HOST_ADAPTER",
      available: true,
      adapterVersion: AE_LAYER_CONTROLS_ADAPTER_BUILD_V16,
    }],
    readbackStrategy: "HOST_STRUCTURAL_READBACK",
    visualProofProfile: command === "layer.switches_readback" ? null : "LAYER_SWITCHES_STRUCTURAL_CHECKPOINT",
    rollbackStrategy: command === "layer.switches_readback" ? "NONE_REQUIRED" : "TRANSACTION_BOUNDARY_REQUIRED",
    riskClass: riskForLayerControlsCommand(command),
    fallbackPolicy: "FORBID",
  }),
);

export const M3_LAYER_CONTROLS_CAPABILITIES_V16: readonly CapabilityRecord[] =
  applyM3LayerControlsAcceptedEvidence(M3_LAYER_CONTROLS_DECLARED_CAPABILITIES_V16);

export const buildLayerControlsRequestV16 = (input: {
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly command: AeLayerControlsCommandV16;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile?: string | null;
}): AeLayerControlsRequestV16 => ({
  protocolVersion: AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16,
  requestId: input.requestId,
  transactionId: input.transactionId,
  operationId: input.operationId,
  capabilityId: capabilityForLayerControlsCommandV16(input.command),
  command: input.command,
  expectedHostProjectRevision: input.expectedHostProjectRevision,
  payload: input.payload,
  readbackProfile: input.readbackProfile ?? "M3_LAYER_SWITCHES_STRUCTURAL",
});