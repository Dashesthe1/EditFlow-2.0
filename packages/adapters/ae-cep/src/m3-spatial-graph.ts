import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";
import { applyM3SpatialGraphAcceptedProofEvidence } from "./m3-spatial-graph-proof-maturity.js";
import {
  AE_SPATIAL_GRAPH_ADAPTER_BUILD_V19,
  AE_SPATIAL_GRAPH_COMMANDS_V19,
  AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19,
  AE_SPATIAL_GRAPH_ROUTE_ID_V19,
  capabilityForSpatialGraphCommandV19,
  isAeSpatialGraphCommandV19,
  type AeSpatialGraphCommandV19,
  type AeSpatialGraphRequestV19,
  type AeSpatialGraphResponseV19,
} from "./protocol-v1_9.js";

export interface CepEvalScriptSpatialGraphBridgeV19 {
  evalScript(script: string, callback: (result: string) => void): void;
}

const escapeForEvalScript = (value: string): string => JSON.stringify(value)
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

const ensureSpatialGraphResponseV19 = (
  value: unknown,
  request: AeSpatialGraphRequestV19,
): AeSpatialGraphResponseV19 => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("AE spatial-graph adapter returned a non-object response.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate["protocolVersion"] !== AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19) {
    throw new TypeError("AE spatial-graph adapter protocol version mismatch.");
  }
  if (candidate["requestId"] !== request.requestId || candidate["operationId"] !== request.operationId) {
    throw new TypeError("AE spatial-graph adapter response correlation mismatch.");
  }
  if (candidate["command"] !== request.command || !isAeSpatialGraphCommandV19(String(candidate["command"]))) {
    throw new TypeError("AE spatial-graph adapter returned an invalid command correlation.");
  }
  const outcome = candidate["outcome"];
  if (outcome !== "APPLIED" && outcome !== "NO_OP" && outcome !== "REJECTED" && outcome !== "FAILED") {
    throw new TypeError("AE spatial-graph adapter returned an invalid operation outcome.");
  }
  return candidate as unknown as AeSpatialGraphResponseV19;
};

export class CepEvalScriptSpatialGraphTransportV19 {
  readonly bridge: CepEvalScriptSpatialGraphBridgeV19;

  constructor(bridge: CepEvalScriptSpatialGraphBridgeV19) {
    this.bridge = bridge;
  }

  async dispatch(request: AeSpatialGraphRequestV19): Promise<AeSpatialGraphResponseV19> {
    const script = `EditFlow2_dispatch(${escapeForEvalScript(JSON.stringify(request))})`;
    return await new Promise<AeSpatialGraphResponseV19>((resolve, reject) => {
      this.bridge.evalScript(script, (rawResult) => {
        try {
          resolve(ensureSpatialGraphResponseV19(JSON.parse(rawResult) as unknown, request));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

const riskForSpatialGraphCommand = (command: AeSpatialGraphCommandV19): CapabilityRecord["riskClass"] =>
  command === "property.spatial_graph.readback" ? "R0_READ_ONLY" : "R1_REVERSIBLE";

const M3_SPATIAL_GRAPH_DECLARED_CAPABILITIES_V19: readonly CapabilityRecord[] =
  AE_SPATIAL_GRAPH_COMMANDS_V19.map((command): CapabilityRecord => ({
    id: asCapabilityId(capabilityForSpatialGraphCommandV19(command)),
    domain: "animation",
    description: `M3 typed AE spatial Graph Editor command '${command}'. Protocol 1.9 covers exact per-key spatial tangents, spatial continuity, spatial auto-Bezier, roving state, and structural readback for TwoD_SPATIAL/ThreeD_SPATIAL properties.`,
    status: "PARTIAL",
    proofMaturity: "DECLARED",
    routes: [{
      routeId: asRouteId(AE_SPATIAL_GRAPH_ROUTE_ID_V19),
      kind: "HOST_ADAPTER",
      available: true,
      adapterVersion: AE_SPATIAL_GRAPH_ADAPTER_BUILD_V19,
    }],
    readbackStrategy: "HOST_STRUCTURAL_READBACK",
    visualProofProfile: command === "property.spatial_graph.readback" ? null : "SPATIAL_GRAPH_STRUCTURAL_CHECKPOINT",
    rollbackStrategy: command === "property.spatial_graph.readback" ? "NONE_REQUIRED" : "TRANSACTION_BOUNDARY_REQUIRED",
    riskClass: riskForSpatialGraphCommand(command),
    fallbackPolicy: "FORBID",
  }));

export const M3_SPATIAL_GRAPH_CAPABILITIES_V19: readonly CapabilityRecord[] =
  applyM3SpatialGraphAcceptedProofEvidence(M3_SPATIAL_GRAPH_DECLARED_CAPABILITIES_V19);

export const buildSpatialGraphRequestV19 = (input: {
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly command: AeSpatialGraphCommandV19;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile?: string | null;
}): AeSpatialGraphRequestV19 => ({
  protocolVersion: AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19,
  requestId: input.requestId,
  transactionId: input.transactionId,
  operationId: input.operationId,
  capabilityId: capabilityForSpatialGraphCommandV19(input.command),
  command: input.command,
  expectedHostProjectRevision: input.expectedHostProjectRevision,
  payload: input.payload,
  readbackProfile: input.readbackProfile ?? "M3_SPATIAL_GRAPH_STRUCTURAL",
});
