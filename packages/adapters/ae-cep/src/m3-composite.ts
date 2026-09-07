import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";
import { applyM3CompositeAcceptedP1P2Evidence } from "./m3-composite-proof-maturity.js";
import {
  AE_COMPOSITE_ADAPTER_BUILD_V13,
  AE_COMPOSITE_COMMANDS_V13,
  AE_COMPOSITE_PROTOCOL_VERSION_V13,
  AE_COMPOSITE_ROUTE_ID_V13,
  capabilityForCompositeCommandV13,
  isAeCompositeCommandV13,
  type AeCompositeCommandV13,
  type AeCompositeRequestV13,
  type AeCompositeResponseV13,
} from "./protocol-v1_3.js";

export interface CepEvalScriptCompositeBridgeV13 {
  evalScript(script: string, callback: (result: string) => void): void;
}

const escapeForEvalScript = (value: string): string => JSON.stringify(value)
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

const ensureCompositeResponseV13 = (value: unknown, request: AeCompositeRequestV13): AeCompositeResponseV13 => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("AE composite adapter returned a non-object response.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate["protocolVersion"] !== AE_COMPOSITE_PROTOCOL_VERSION_V13) {
    throw new TypeError("AE composite adapter protocol version mismatch.");
  }
  if (candidate["requestId"] !== request.requestId || candidate["operationId"] !== request.operationId) {
    throw new TypeError("AE composite adapter response correlation mismatch.");
  }
  if (candidate["command"] !== request.command || !isAeCompositeCommandV13(String(candidate["command"]))) {
    throw new TypeError("AE composite adapter returned an invalid command correlation.");
  }
  const outcome = candidate["outcome"];
  if (outcome !== "APPLIED" && outcome !== "NO_OP" && outcome !== "REJECTED" && outcome !== "FAILED") {
    throw new TypeError("AE composite adapter returned an invalid operation outcome.");
  }
  return candidate as unknown as AeCompositeResponseV13;
};

export class CepEvalScriptCompositeTransportV13 {
  readonly bridge: CepEvalScriptCompositeBridgeV13;

  constructor(bridge: CepEvalScriptCompositeBridgeV13) {
    this.bridge = bridge;
  }

  async dispatch(request: AeCompositeRequestV13): Promise<AeCompositeResponseV13> {
    const requestJson = JSON.stringify(request);
    const script = `EditFlow2_dispatch(${escapeForEvalScript(requestJson)})`;
    return await new Promise<AeCompositeResponseV13>((resolve, reject) => {
      this.bridge.evalScript(script, (rawResult) => {
        try {
          resolve(ensureCompositeResponseV13(JSON.parse(rawResult) as unknown, request));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

const riskForCompositeCommand = (command: AeCompositeCommandV13): CapabilityRecord["riskClass"] =>
  command === "layer.composite_readback" ? "R0_READ_ONLY" : "R1_REVERSIBLE";

const M3_COMPOSITE_DECLARED_CAPABILITIES_V13: readonly CapabilityRecord[] = AE_COMPOSITE_COMMANDS_V13.map(
  (command): CapabilityRecord => ({
    id: asCapabilityId(capabilityForCompositeCommandV13(command)),
    domain: "layer",
    description: `M3 typed AE track-matte/blend command '${command}'. Protocol 1.3 uses arbitrary matte-layer references and evidence-scoped proof maturity.`,
    status: "PARTIAL",
    proofMaturity: "DECLARED",
    routes: [{
      routeId: asRouteId(AE_COMPOSITE_ROUTE_ID_V13),
      kind: "HOST_ADAPTER",
      available: true,
      adapterVersion: AE_COMPOSITE_ADAPTER_BUILD_V13,
    }],
    readbackStrategy: "HOST_STRUCTURAL_READBACK",
    visualProofProfile: command === "layer.set_track_matte" || command === "layer.set_blend_mode"
      ? "COMPOSITE_CHECKPOINT"
      : null,
    rollbackStrategy: command === "layer.composite_readback" ? "NONE_REQUIRED" : "AE_UNDO_GROUP",
    riskClass: riskForCompositeCommand(command),
    fallbackPolicy: "FORBID",
  }),
);

export const M3_COMPOSITE_CAPABILITIES_V13: readonly CapabilityRecord[] =
  applyM3CompositeAcceptedP1P2Evidence(M3_COMPOSITE_DECLARED_CAPABILITIES_V13);

export const buildCompositeRequestV13 = (input: {
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly command: AeCompositeCommandV13;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile?: string | null;
}): AeCompositeRequestV13 => ({
  protocolVersion: AE_COMPOSITE_PROTOCOL_VERSION_V13,
  requestId: input.requestId,
  transactionId: input.transactionId,
  operationId: input.operationId,
  capabilityId: capabilityForCompositeCommandV13(input.command),
  command: input.command,
  expectedHostProjectRevision: input.expectedHostProjectRevision,
  payload: input.payload,
  readbackProfile: input.readbackProfile ?? "M3_COMPOSITE_STRUCTURAL",
});
