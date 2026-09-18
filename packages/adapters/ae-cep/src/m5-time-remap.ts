import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";
import {
  AE_TIME_REMAP_ADAPTER_BUILD_V27,
  AE_TIME_REMAP_COMMANDS_V27,
  AE_TIME_REMAP_PROTOCOL_VERSION_V27,
  AE_TIME_REMAP_ROUTE_ID_V27,
  capabilityForTimeRemapCommandV27,
  isAeTimeRemapCommandV27,
  type AeTimeRemapCommandV27,
  type AeTimeRemapLayerPayloadV27,
  type AeTimeRemapRequestV27,
  type AeTimeRemapResponseV27,
} from "./protocol-v2_7.js";

export interface CepEvalScriptTimeRemapBridgeV27 {
  evalScript(script: string, callback: (result: string) => void): void;
}

const escapeForEvalScript = (value: string): string => JSON.stringify(value)
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

const ensureResponseV27 = (
  value: unknown,
  request: AeTimeRemapRequestV27,
): AeTimeRemapResponseV27 => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("AE time-remap adapter returned a non-object response.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate["protocolVersion"] !== AE_TIME_REMAP_PROTOCOL_VERSION_V27) {
    throw new TypeError("AE time-remap adapter protocol version mismatch.");
  }
  if (candidate["requestId"] !== request.requestId
    || candidate["operationId"] !== request.operationId) {
    throw new TypeError("AE time-remap adapter response correlation mismatch.");
  }
  if (candidate["capabilityId"] !== request.capabilityId) {
    throw new TypeError("AE time-remap adapter capability correlation mismatch.");
  }
  if (candidate["command"] !== request.command
    || !isAeTimeRemapCommandV27(String(candidate["command"]))) {
    throw new TypeError("AE time-remap adapter returned an invalid command correlation.");
  }
  const outcome = candidate["outcome"];
  if (outcome !== "NO_OP" && outcome !== "REJECTED"
    && outcome !== "FAILED" && outcome !== "APPLIED") {
    throw new TypeError("AE time-remap adapter returned an invalid operation outcome.");
  }
  return candidate as unknown as AeTimeRemapResponseV27;
};

export class CepEvalScriptTimeRemapTransportV27 {
  readonly bridge: CepEvalScriptTimeRemapBridgeV27;

  constructor(bridge: CepEvalScriptTimeRemapBridgeV27) {
    this.bridge = bridge;
  }

  async dispatch(request: AeTimeRemapRequestV27): Promise<AeTimeRemapResponseV27> {
    const script = `EditFlow2_dispatch(${escapeForEvalScript(JSON.stringify(request))})`;
    return await new Promise<AeTimeRemapResponseV27>((resolve, reject) => {
      this.bridge.evalScript(script, (rawResult) => {
        try {
          resolve(ensureResponseV27(JSON.parse(rawResult) as unknown, request));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

export const M5_TIME_REMAP_CAPABILITIES_V27: readonly CapabilityRecord[] =
  AE_TIME_REMAP_COMMANDS_V27.map((command): CapabilityRecord => ({
    id: asCapabilityId(capabilityForTimeRemapCommandV27(command)),
    domain: "animation",
    description: command === "layer.time_remap.enable"
      ? "Enable native After Effects Time Remapping on a declared AV layer."
      : "Read native After Effects Time Remap availability and generated key structure.",
    status: "PARTIAL",
    proofMaturity: "DECLARED",
    routes: [{
      routeId: asRouteId(AE_TIME_REMAP_ROUTE_ID_V27),
      kind: "HOST_ADAPTER",
      available: true,
      adapterVersion: AE_TIME_REMAP_ADAPTER_BUILD_V27,
      limitations: command === "layer.time_remap.enable"
        ? [
            "V1 is enable-only; disabling an existing Time Remap surface is deliberately excluded because it can destroy authored remap curves.",
            "Runtime promotion is withheld until retained real-AE evidence is accepted.",
          ]
        : [
            "Readback reports native Time Remap property/key structure only; it does not infer creative timing intent.",
          ],
    }],
    readbackStrategy: "NATIVE_TIME_REMAP_EXACT_KEY_READBACK",
    visualProofProfile: null,
    rollbackStrategy: command === "layer.time_remap.enable"
      ? "AE_TRANSACTION_UNDO_PLUS_EXACT_BASELINE_READBACK"
      : "NONE_REQUIRED",
    riskClass: command === "layer.time_remap.enable" ? "R2_STRUCTURAL" : "R0_READ_ONLY",
    fallbackPolicy: "FORBID",
  }));

export const buildTimeRemapRequestV27 = (input: {
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly command: AeTimeRemapCommandV27;
  readonly expectedHostProjectRevision?: number | null;
  readonly payload: AeTimeRemapLayerPayloadV27;
  readonly readbackProfile?: string | null;
}): AeTimeRemapRequestV27 => ({
  protocolVersion: AE_TIME_REMAP_PROTOCOL_VERSION_V27,
  requestId: input.requestId,
  transactionId: input.transactionId,
  operationId: input.operationId,
  capabilityId: capabilityForTimeRemapCommandV27(input.command),
  command: input.command,
  expectedHostProjectRevision:
    input.command === "layer.time_remap.enable"
      ? (input.expectedHostProjectRevision ?? null)
      : null,
  payload: input.payload as unknown as Readonly<Record<string, unknown>>,
  readbackProfile: input.readbackProfile ?? "M5_TIME_REMAP_STRUCTURAL",
});

export type {
  AeTimeRemapCommandV27,
  AeTimeRemapRequestV27,
  AeTimeRemapResponseV27,
};
