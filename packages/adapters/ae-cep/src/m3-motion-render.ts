import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";
import { applyM3MotionRenderAcceptedP3P4Evidence } from "./m3-motion-render-proof-maturity.js";
import {
  AE_MOTION_RENDER_ADAPTER_BUILD_V110,
  AE_MOTION_RENDER_COMMANDS_V110,
  AE_MOTION_RENDER_PROTOCOL_VERSION_V110,
  AE_MOTION_RENDER_ROUTE_ID_V110,
  capabilityForMotionRenderCommandV110,
  isAeMotionRenderCommandV110,
  type AeMotionRenderCommandV110,
  type AeMotionRenderRequestV110,
  type AeMotionRenderResponseV110,
} from "./protocol-v1_10.js";

export interface CepEvalScriptMotionRenderBridgeV110 {
  evalScript(script: string, callback: (result: string) => void): void;
}

const escapeForEvalScript = (value: string): string => JSON.stringify(value)
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

const ensureMotionRenderResponseV110 = (
  value: unknown,
  request: AeMotionRenderRequestV110,
): AeMotionRenderResponseV110 => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("AE motion-render adapter returned a non-object response.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate["protocolVersion"] !== AE_MOTION_RENDER_PROTOCOL_VERSION_V110) {
    throw new TypeError("AE motion-render adapter protocol version mismatch.");
  }
  if (candidate["requestId"] !== request.requestId || candidate["operationId"] !== request.operationId) {
    throw new TypeError("AE motion-render adapter response correlation mismatch.");
  }
  if (candidate["command"] !== request.command || !isAeMotionRenderCommandV110(String(candidate["command"]))) {
    throw new TypeError("AE motion-render adapter returned an invalid command correlation.");
  }
  const outcome = candidate["outcome"];
  if (outcome !== "APPLIED" && outcome !== "NO_OP" && outcome !== "REJECTED" && outcome !== "FAILED") {
    throw new TypeError("AE motion-render adapter returned an invalid operation outcome.");
  }
  return candidate as unknown as AeMotionRenderResponseV110;
};

export class CepEvalScriptMotionRenderTransportV110 {
  readonly bridge: CepEvalScriptMotionRenderBridgeV110;

  constructor(bridge: CepEvalScriptMotionRenderBridgeV110) {
    this.bridge = bridge;
  }

  async dispatch(request: AeMotionRenderRequestV110): Promise<AeMotionRenderResponseV110> {
    const requestJson = JSON.stringify(request);
    const script = `EditFlow2_dispatch(${escapeForEvalScript(requestJson)})`;
    return await new Promise<AeMotionRenderResponseV110>((resolve, reject) => {
      this.bridge.evalScript(script, (rawResult) => {
        try {
          resolve(ensureMotionRenderResponseV110(JSON.parse(rawResult) as unknown, request));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

const riskForMotionRenderCommand = (command: AeMotionRenderCommandV110): CapabilityRecord["riskClass"] =>
  command === "motion_render.readback" ? "R0_READ_ONLY" : "R1_REVERSIBLE";

const M3_MOTION_RENDER_DECLARED_CAPABILITIES_V110: readonly CapabilityRecord[] =
  AE_MOTION_RENDER_COMMANDS_V110.map((command): CapabilityRecord => ({
    id: asCapabilityId(capabilityForMotionRenderCommandV110(command)),
    domain: command.startsWith("comp.") ? "comp" : command.startsWith("layer.") ? "layer" : "render",
    description: `M3 typed AE motion/frame rendering command '${command}'. Protocol 1.10 controls layer motion blur/frame blending and the composition switches/shutter/sample settings required to render them.`,
    status: "PARTIAL",
    proofMaturity: "DECLARED",
    routes: [{
      routeId: asRouteId(AE_MOTION_RENDER_ROUTE_ID_V110),
      kind: "HOST_ADAPTER",
      available: true,
      adapterVersion: AE_MOTION_RENDER_ADAPTER_BUILD_V110,
    }],
    readbackStrategy: "HOST_STRUCTURAL_READBACK",
    visualProofProfile: command === "motion_render.readback" ? null : "MOTION_RENDER_VISUAL_CHECKPOINT",
    rollbackStrategy: command === "motion_render.readback" ? "NONE_REQUIRED" : "TRANSACTION_BOUNDARY_REQUIRED",
    riskClass: riskForMotionRenderCommand(command),
    fallbackPolicy: "FORBID",
  }));

export const M3_MOTION_RENDER_CAPABILITIES_V110: readonly CapabilityRecord[] =
  applyM3MotionRenderAcceptedP3P4Evidence(M3_MOTION_RENDER_DECLARED_CAPABILITIES_V110);

export const buildMotionRenderRequestV110 = (input: {
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly command: AeMotionRenderCommandV110;
  readonly expectedHostProjectRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile?: string | null;
}): AeMotionRenderRequestV110 => ({
  protocolVersion: AE_MOTION_RENDER_PROTOCOL_VERSION_V110,
  requestId: input.requestId,
  transactionId: input.transactionId,
  operationId: input.operationId,
  capabilityId: capabilityForMotionRenderCommandV110(input.command),
  command: input.command,
  expectedHostProjectRevision: input.expectedHostProjectRevision,
  payload: input.payload,
  readbackProfile: input.readbackProfile ?? "M3_MOTION_RENDER_STRUCTURAL",
});
