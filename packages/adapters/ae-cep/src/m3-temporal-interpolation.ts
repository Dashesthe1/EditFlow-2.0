import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";
import {
  AE_TEMPORAL_INTERPOLATION_ADAPTER_BUILD_V17,
  AE_TEMPORAL_INTERPOLATION_COMMANDS_V17,
  AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17,
  AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17,
  capabilityForTemporalInterpolationCommandV17,
  isAeTemporalInterpolationCommandV17,
  type AeTemporalInterpolationCommandV17,
  type AeTemporalInterpolationRequestV17,
  type AeTemporalInterpolationResponseV17,
} from "./protocol-v1_7.js";
import { applyM3TemporalInterpolationAcceptedProofEvidence } from "./m3-temporal-interpolation-proof-maturity.js";

export interface CepEvalScriptTemporalInterpolationBridgeV17 {
  evalScript(script: string, callback: (result: string) => void): void;
}

const escapeForEvalScript = (value: string): string => JSON.stringify(value)
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

const ensureTemporalInterpolationResponseV17 = (
  value: unknown,
  request: AeTemporalInterpolationRequestV17,
): AeTemporalInterpolationResponseV17 => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("AE temporal-interpolation adapter returned a non-object response.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate["protocolVersion"] !== AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17) {
    throw new TypeError("AE temporal-interpolation adapter protocol version mismatch.");
  }
  if (candidate["requestId"] !== request.requestId || candidate["operationId"] !== request.operationId) {
    throw new TypeError("AE temporal-interpolation adapter response correlation mismatch.");
  }
  if (candidate["command"] !== request.command || !isAeTemporalInterpolationCommandV17(String(candidate["command"]))) {
    throw new TypeError("AE temporal-interpolation adapter returned an invalid command correlation.");
  }
  const outcome = candidate["outcome"];
  if (outcome !== "APPLIED" && outcome !== "NO_OP" && outcome !== "REJECTED" && outcome !== "FAILED") {
    throw new TypeError("AE temporal-interpolation adapter returned an invalid operation outcome.");
  }
  return candidate as unknown as AeTemporalInterpolationResponseV17;
};

export class CepEvalScriptTemporalInterpolationTransportV17 {
  readonly bridge: CepEvalScriptTemporalInterpolationBridgeV17;

  constructor(bridge: CepEvalScriptTemporalInterpolationBridgeV17) {
    this.bridge = bridge;
  }

  async dispatch(request: AeTemporalInterpolationRequestV17): Promise<AeTemporalInterpolationResponseV17> {
    const requestJson = JSON.stringify(request);
    const script = `EditFlow2_dispatch(${escapeForEvalScript(requestJson)})`;
    return await new Promise<AeTemporalInterpolationResponseV17>((resolve, reject) => {
      this.bridge.evalScript(script, (rawResult) => {
        try {
          resolve(ensureTemporalInterpolationResponseV17(JSON.parse(rawResult) as unknown, request));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

const riskForTemporalInterpolationCommand = (
  command: AeTemporalInterpolationCommandV17,
): CapabilityRecord["riskClass"] => command === "property.temporal_interpolation.readback"
  ? "R0_READ_ONLY"
  : "R1_REVERSIBLE";

const M3_TEMPORAL_INTERPOLATION_DECLARED_CAPABILITIES_V17: readonly CapabilityRecord[] =
  AE_TEMPORAL_INTERPOLATION_COMMANDS_V17.map((command): CapabilityRecord => ({
    id: asCapabilityId(capabilityForTemporalInterpolationCommandV17(command)),
    domain: "animation",
    description: `M3 typed AE temporal-interpolation command '${command}'. Protocol 1.7 covers exact per-key in/out interpolation type plus temporal continuous/auto-Bezier state. Numeric Graph Editor speed/influence and spatial tangent/roving controls remain separate later tranches.`,
    status: "PARTIAL",
    proofMaturity: "DECLARED",
    routes: [{
      routeId: asRouteId(AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17),
      kind: "HOST_ADAPTER",
      available: true,
      adapterVersion: AE_TEMPORAL_INTERPOLATION_ADAPTER_BUILD_V17,
    }],
    readbackStrategy: "HOST_STRUCTURAL_READBACK",
    visualProofProfile: command === "property.temporal_interpolation.readback"
      ? null
      : "TEMPORAL_INTERPOLATION_STRUCTURAL_CHECKPOINT",
    rollbackStrategy: command === "property.temporal_interpolation.readback"
      ? "NONE_REQUIRED"
      : "TRANSACTION_BOUNDARY_REQUIRED",
    riskClass: riskForTemporalInterpolationCommand(command),
    fallbackPolicy: "FORBID",
  }));

export const M3_TEMPORAL_INTERPOLATION_CAPABILITIES_V17: readonly CapabilityRecord[] =
  applyM3TemporalInterpolationAcceptedProofEvidence(M3_TEMPORAL_INTERPOLATION_DECLARED_CAPABILITIES_V17);

export const buildTemporalInterpolationRequestV17 = (input: {
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly command: AeTemporalInterpolationCommandV17;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile?: string | null;
}): AeTemporalInterpolationRequestV17 => ({
  protocolVersion: AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17,
  requestId: input.requestId,
  transactionId: input.transactionId,
  operationId: input.operationId,
  capabilityId: capabilityForTemporalInterpolationCommandV17(input.command),
  command: input.command,
  expectedHostProjectRevision: input.expectedHostProjectRevision,
  payload: input.payload,
  readbackProfile: input.readbackProfile ?? "M3_TEMPORAL_INTERPOLATION_STRUCTURAL",
});
