import { createHash } from "node:crypto";

import {
  AE_ROTO_BRUSH_PROTOCOL_VERSION_V26,
  capabilityForRotoBrushCommandV26,
  isAeRotoBrushCommandV26,
  type AeRotoBrushCommandV26,
  type AeRotoBrushReadbackPayloadV26,
  type AeRotoBrushRequestV26,
  type AeRotoBrushResponseV26,
} from "./protocol-v2_6.js";

export interface CepEvalScriptRotoBrushBridgeV26 {
  evalScript(script: string, callback: (result: string) => void): void;
}

const escapeForEvalScript = (value: string): string => JSON.stringify(value)
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

const ensureResponseV26 = (value: unknown, request: AeRotoBrushRequestV26): AeRotoBrushResponseV26 => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("AE Roto Brush adapter returned a non-object response.");
  const candidate = value as Record<string, unknown>;
  if (candidate["protocolVersion"] !== AE_ROTO_BRUSH_PROTOCOL_VERSION_V26) throw new TypeError("AE Roto Brush adapter protocol version mismatch.");
  if (candidate["requestId"] !== request.requestId || candidate["operationId"] !== request.operationId) throw new TypeError("AE Roto Brush adapter response correlation mismatch.");
  if (candidate["capabilityId"] !== request.capabilityId) throw new TypeError("AE Roto Brush adapter capability correlation mismatch.");
  if (candidate["command"] !== request.command || !isAeRotoBrushCommandV26(String(candidate["command"]))) throw new TypeError("AE Roto Brush adapter returned an invalid command correlation.");
  const outcome = candidate["outcome"];
  if (outcome !== "NO_OP" && outcome !== "REJECTED" && outcome !== "FAILED" && outcome !== "APPLIED") throw new TypeError("AE Roto Brush adapter returned an invalid operation outcome.");
  return candidate as unknown as AeRotoBrushResponseV26;
};

export class CepEvalScriptRotoBrushTransportV26 {
  readonly bridge: CepEvalScriptRotoBrushBridgeV26;
  constructor(bridge: CepEvalScriptRotoBrushBridgeV26) { this.bridge = bridge; }
  async dispatch(request: AeRotoBrushRequestV26): Promise<AeRotoBrushResponseV26> {
    const script = `EditFlow2_dispatch(${escapeForEvalScript(JSON.stringify(request))})`;
    return await new Promise<AeRotoBrushResponseV26>((resolve, reject) => {
      this.bridge.evalScript(script, (rawResult) => {
        try { resolve(ensureResponseV26(JSON.parse(rawResult) as unknown, request)); }
        catch (error) { reject(error); }
      });
    });
  }
}

export const buildRotoBrushReadbackRequestV26 = (input: {
  readonly requestId: string;
  readonly transactionId: string;
  readonly operationId: string;
  readonly payload: AeRotoBrushReadbackPayloadV26;
  readonly readbackProfile?: string | null;
}): AeRotoBrushRequestV26 => ({
  protocolVersion: AE_ROTO_BRUSH_PROTOCOL_VERSION_V26,
  requestId: input.requestId,
  transactionId: input.transactionId,
  operationId: input.operationId,
  capabilityId: capabilityForRotoBrushCommandV26("roto_brush.readback"),
  command: "roto_brush.readback",
  expectedHostProjectRevision: null,
  payload: input.payload as unknown as Readonly<Record<string, unknown>>,
  readbackProfile: input.readbackProfile ?? "M5_ROTO_BRUSH_SESSION_STRUCTURAL",
});

export const deriveRotoBrushSessionRevisionV26 = (response: AeRotoBrushResponseV26): string => {
  if (response.outcome !== "NO_OP" || response.readback === null || response.hostProjectRevision === null) {
    throw new TypeError("A successful Roto Brush readback with host revision is required to derive session revision.");
  }
  const bytes = JSON.stringify({ hostProjectRevision: response.hostProjectRevision, readback: response.readback });
  return `ROTO_V26_${createHash("sha256").update(bytes).digest("hex")}`;
};

export const assertRotoBrushEffectIdentityV26 = (response: AeRotoBrushResponseV26): void => {
  if (response.outcome !== "NO_OP" || !response.readback) throw new TypeError("Roto Brush readback did not succeed.");
  if (response.readback.effectMatchCount !== 1 || !response.readback.effect || response.readback.effect.matchName !== "ADBE Samurai") {
    throw new TypeError("Exact Roto Brush & Refine Edge effect identity was not established.");
  }
};

export type { AeRotoBrushCommandV26, AeRotoBrushRequestV26, AeRotoBrushResponseV26 };