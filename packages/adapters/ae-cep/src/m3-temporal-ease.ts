import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";
import {
  AE_TEMPORAL_EASE_ADAPTER_BUILD_V18,
  AE_TEMPORAL_EASE_COMMANDS_V18,
  AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18,
  AE_TEMPORAL_EASE_ROUTE_ID_V18,
  capabilityForTemporalEaseCommandV18,
  isAeTemporalEaseCommandV18,
  type AeTemporalEaseCommandV18,
  type AeTemporalEaseRequestV18,
  type AeTemporalEaseResponseV18,
} from "./protocol-v1_8.js";
import { applyM3TemporalEaseAcceptedP1P2Evidence } from "./m3-temporal-ease-proof-maturity.js";

export interface CepEvalScriptTemporalEaseBridgeV18 {
  evalScript(script: string, callback: (result: string) => void): void;
}

const escapeForEvalScript = (value: string): string => JSON.stringify(value)
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

const ensureTemporalEaseResponseV18 = (
  value: unknown,
  request: AeTemporalEaseRequestV18,
): AeTemporalEaseResponseV18 => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("AE temporal-ease adapter returned a non-object response.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate["protocolVersion"] !== AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18) {
    throw new TypeError("AE temporal-ease adapter protocol version mismatch.");
  }
  if (candidate["requestId"] !== request.requestId || candidate["operationId"] !== request.operationId) {
    throw new TypeError("AE temporal-ease adapter response correlation mismatch.");
  }
  if (candidate["command"] !== request.command || !isAeTemporalEaseCommandV18(String(candidate["command"]))) {
    throw new TypeError("AE temporal-ease adapter returned an invalid command correlation.");
  }
  const outcome = candidate["outcome"];
  if (outcome !== "APPLIED" && outcome !== "NO_OP" && outcome !== "REJECTED" && outcome !== "FAILED") {
    throw new TypeError("AE temporal-ease adapter returned an invalid operation outcome.");
  }
  return candidate as unknown as AeTemporalEaseResponseV18;
};

export class CepEvalScriptTemporalEaseTransportV18 {
  readonly bridge: CepEvalScriptTemporalEaseBridgeV18;

  constructor(bridge: CepEvalScriptTemporalEaseBridgeV18) {
    this.bridge = bridge;
  }

  async dispatch(request: AeTemporalEaseRequestV18): Promise<AeTemporalEaseResponseV18> {
    const requestJson = JSON.stringify(request);
    const script = `EditFlow2_dispatch(${escapeForEvalScript(requestJson)})`;
    return await new Promise<AeTemporalEaseResponseV18>((resolve, reject) => {
      this.bridge.evalScript(script, (rawResult) => {
        try {
          resolve(ensureTemporalEaseResponseV18(JSON.parse(rawResult) as unknown, request));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

const riskForTemporalEaseCommand = (command: AeTemporalEaseCommandV18): CapabilityRecord["riskClass"] =>
  command === "property.temporal_ease.readback" ? "R0_READ_ONLY" : "R1_REVERSIBLE";

const M3_TEMPORAL_EASE_DECLARED_CAPABILITIES_V18: readonly CapabilityRecord[] =
  AE_TEMPORAL_EASE_COMMANDS_V18.map((command): CapabilityRecord => ({
    id: asCapabilityId(capabilityForTemporalEaseCommandV18(command)),
    domain: "animation",
    description: `M3 typed AE Graph Editor temporal-ease command '${command}'. Protocol 1.8 covers exact per-key KeyframeEase speed/influence handles and readback. Keyframe values remain owned by the accepted keyframe CRUD surface; spatial tangents, roving, and later rendering controls remain separate tranches.`,
    status: "PARTIAL",
    proofMaturity: "DECLARED",
    routes: [{
      routeId: asRouteId(AE_TEMPORAL_EASE_ROUTE_ID_V18),
      kind: "HOST_ADAPTER",
      available: true,
      adapterVersion: AE_TEMPORAL_EASE_ADAPTER_BUILD_V18,
    }],
    readbackStrategy: "HOST_STRUCTURAL_READBACK",
    visualProofProfile: command === "property.temporal_ease.readback"
      ? null
      : "TEMPORAL_EASE_STRUCTURAL_CHECKPOINT",
    rollbackStrategy: command === "property.temporal_ease.readback"
      ? "NONE_REQUIRED"
      : "TRANSACTION_BOUNDARY_REQUIRED",
    riskClass: riskForTemporalEaseCommand(command),
    fallbackPolicy: "FORBID",
  }));

export const M3_TEMPORAL_EASE_CAPABILITIES_V18: readonly CapabilityRecord[] =
  applyM3TemporalEaseAcceptedP1P2Evidence(M3_TEMPORAL_EASE_DECLARED_CAPABILITIES_V18);

export const buildTemporalEaseRequestV18 = (input: {
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly command: AeTemporalEaseCommandV18;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile?: string | null;
}): AeTemporalEaseRequestV18 => ({
  protocolVersion: AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18,
  requestId: input.requestId,
  transactionId: input.transactionId,
  operationId: input.operationId,
  capabilityId: capabilityForTemporalEaseCommandV18(input.command),
  command: input.command,
  expectedHostProjectRevision: input.expectedHostProjectRevision,
  payload: input.payload,
  readbackProfile: input.readbackProfile ?? "M3_TEMPORAL_EASE_STRUCTURAL",
});
