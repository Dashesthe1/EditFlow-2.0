import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";
import { applyM3MarkerMotionAcceptedProofEvidence } from "./m3-marker-motion-proof-maturity.js";
import {
  AE_MARKER_MOTION_ADAPTER_BUILD_V20,
  AE_MARKER_MOTION_COMMANDS_V20,
  AE_MARKER_MOTION_PROTOCOL_VERSION_V20,
  AE_MARKER_MOTION_ROUTE_ID_V20,
  capabilityForMarkerMotionCommandV20,
  isAeMarkerMotionCommandV20,
  type AeMarkerMotionCommandV20,
  type AeMarkerMotionRequestV20,
  type AeMarkerMotionResponseV20,
} from "./protocol-v2_0.js";

export interface CepEvalScriptMarkerMotionBridgeV20 {
  evalScript(script: string, callback: (result: string) => void): void;
}

const escapeForEvalScript = (value: string): string => JSON.stringify(value)
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

const ensureMarkerMotionResponseV20 = (
  value: unknown,
  request: AeMarkerMotionRequestV20,
): AeMarkerMotionResponseV20 => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("AE marker-motion adapter returned a non-object response.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate["protocolVersion"] !== AE_MARKER_MOTION_PROTOCOL_VERSION_V20) {
    throw new TypeError("AE marker-motion adapter protocol version mismatch.");
  }
  if (candidate["requestId"] !== request.requestId || candidate["operationId"] !== request.operationId) {
    throw new TypeError("AE marker-motion adapter response correlation mismatch.");
  }
  if (candidate["command"] !== request.command || !isAeMarkerMotionCommandV20(String(candidate["command"]))) {
    throw new TypeError("AE marker-motion adapter returned an invalid command correlation.");
  }
  const outcome = candidate["outcome"];
  if (outcome !== "APPLIED" && outcome !== "NO_OP" && outcome !== "REJECTED" && outcome !== "FAILED") {
    throw new TypeError("AE marker-motion adapter returned an invalid operation outcome.");
  }
  return candidate as unknown as AeMarkerMotionResponseV20;
};

export class CepEvalScriptMarkerMotionTransportV20 {
  readonly bridge: CepEvalScriptMarkerMotionBridgeV20;

  constructor(bridge: CepEvalScriptMarkerMotionBridgeV20) {
    this.bridge = bridge;
  }

  async dispatch(request: AeMarkerMotionRequestV20): Promise<AeMarkerMotionResponseV20> {
    const script = `EditFlow2_dispatch(${escapeForEvalScript(JSON.stringify(request))})`;
    return await new Promise<AeMarkerMotionResponseV20>((resolve, reject) => {
      this.bridge.evalScript(script, (rawResult) => {
        try {
          resolve(ensureMarkerMotionResponseV20(JSON.parse(rawResult) as unknown, request));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

const isReadOnly = (command: AeMarkerMotionCommandV20): boolean => command.endsWith(".readback");

const M3_MARKER_MOTION_DECLARED_CAPABILITIES_V20: readonly CapabilityRecord[] =
  AE_MARKER_MOTION_COMMANDS_V20.map((command): CapabilityRecord => ({
    id: asCapabilityId(capabilityForMarkerMotionCommandV20(command)),
    domain: command.startsWith("marker.") ? "timeline" : "animation",
    description: `M3 typed AE marker/motion command '${command}'. Protocol 2.0 covers exact composition/layer markers, composition motion-blur/frame-blending/shutter sampling controls, and layer motion-blur/frame-blending mode.`,
    status: "PARTIAL",
    proofMaturity: "DECLARED",
    routes: [{
      routeId: asRouteId(AE_MARKER_MOTION_ROUTE_ID_V20),
      kind: "HOST_ADAPTER",
      available: true,
      adapterVersion: AE_MARKER_MOTION_ADAPTER_BUILD_V20,
    }],
    readbackStrategy: "HOST_STRUCTURAL_READBACK",
    visualProofProfile: isReadOnly(command) ? null : "MARKER_MOTION_STRUCTURAL_CHECKPOINT",
    rollbackStrategy: isReadOnly(command) ? "NONE_REQUIRED" : "TRANSACTION_BOUNDARY_REQUIRED",
    riskClass: isReadOnly(command) ? "R0_READ_ONLY" : "R1_REVERSIBLE",
    fallbackPolicy: "FORBID",
  }));

export const M3_MARKER_MOTION_CAPABILITIES_V20: readonly CapabilityRecord[] =
  applyM3MarkerMotionAcceptedProofEvidence(M3_MARKER_MOTION_DECLARED_CAPABILITIES_V20);

export const buildMarkerMotionRequestV20 = (input: {
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly command: AeMarkerMotionCommandV20;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile?: string | null;
}): AeMarkerMotionRequestV20 => ({
  protocolVersion: AE_MARKER_MOTION_PROTOCOL_VERSION_V20,
  requestId: input.requestId,
  transactionId: input.transactionId,
  operationId: input.operationId,
  capabilityId: capabilityForMarkerMotionCommandV20(input.command),
  command: input.command,
  expectedHostProjectRevision: input.expectedHostProjectRevision,
  payload: input.payload,
  readbackProfile: input.readbackProfile ?? "M3_MARKER_MOTION_STRUCTURAL",
});
