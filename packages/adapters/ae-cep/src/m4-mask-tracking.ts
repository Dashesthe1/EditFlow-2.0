import {
  asCapabilityId,
  asRouteId,
  type CapabilityRecord,
} from "../../../core-contracts/src/index.js";
import {
  buildMaskRequestV12,
  type CepEvalScriptMaskTransportV12,
} from "./m3-mask.js";

export type MaskTrackingDirectionV1 = "FORWARD" | "BACKWARD";
export type MaskTrackingEscalationV1 =
  | "VISUAL_DRIVER_UNAVAILABLE"
  | "MASK_TARGET_UNAVAILABLE"
  | "VISUAL_ACTION_REFUSED"
  | "ANALYSIS_DIRECTION_UNPROVEN"
  | "ANALYSIS_NOT_OBSERVED";

export interface MaskVisualTrackingDriverV1 {
  readonly driverId: string;
  readonly verifiedVision: boolean;
  readonly verifiedCursorControl: boolean;
  readonly supportedDirections: readonly MaskTrackingDirectionV1[];
  analyze(input: MaskVisualTrackingRequestV1): Promise<MaskVisualTrackingResultV1>;
}
export interface MaskVisualTrackingRequestV1 {
  readonly direction: MaskTrackingDirectionV1;
  readonly compHostId: number;
  readonly layerHostId: number;
  readonly maskStableId: string;
  readonly expectedCompName: string;
  readonly expectedLayerName: string;
  readonly expectedMaskName: string;
  readonly expectedControl: "MASK_ANALYZE_FORWARD" | "MASK_ANALYZE_BACKWARD";
}

export interface MaskVisualTrackingResultV1 {
  readonly status: "COMPLETED" | "REFUSED";
  readonly visualEvidenceId?: string | null;
  readonly detail?: string | null;
}

export interface MaskTrackingRunV1 {
  readonly route: "LOCAL" | "ESCALATE";
  readonly direction: MaskTrackingDirectionV1;
  readonly escalationReason: MaskTrackingEscalationV1 | null;
  readonly baselinePathKeyCount: number;
  readonly finalPathKeyCount: number;
  readonly baselineLastKeyTime: number | null;
  readonly finalLastKeyTime: number | null;
  readonly visualEvidenceId: string | null;
}
export const M4_MASK_TRACKING_CAPABILITY_V1: CapabilityRecord = {
  id: asCapabilityId("ae.mask.tracking.guarded_visual"),
  domain: "tracking",
  description: "Guarded native AE mask tracking with protocol 1.2 Mask Path keyframe truth.",
  status: "ADAPTER_REQUIRED",
  proofMaturity: "STRUCTURAL",
  routes: [{
    routeId: asRouteId("ae.m4.mask.tracking.guarded_visual.v1"),
    kind: "GUARDED_UI",
    available: false,
    adapterVersion: "0.5.0-dev.1",
    limitations: ["Requires verified EditGPT vision+cursor control of AE's custom Tracker panel."],
  }],
  readbackStrategy: "PRE_POST_PROTOCOL_1_2_MASK_PATH_READBACK",
  visualProofProfile: "M4_MASK_TRACKING_VISUAL_ACTION",
  rollbackStrategy: "FIXTURE_OR_PROJECT_TRANSACTION_OWNED_CLEANUP",
  riskClass: "R4_EXTERNAL_UI",
  limitations: [
    "Native mask tracking is accepted only after selected-mask visual binding and Mask Path keyframe growth.",
    "Analyze Forward has retained real-AE mask-mode vision+cursor evidence; production registration still requires an explicit verified driver.",
    "Analyze Backward remains unavailable until an equivalent retained acceptance proof exists.",
  ],
  fallbackPolicy: "EXPLICIT_ONLY",
};
export const capabilityForMaskTrackingDriverV1 = (
  driver: MaskVisualTrackingDriverV1 | null,
): CapabilityRecord => {
  const available = !!driver
    && driver.verifiedVision
    && driver.verifiedCursorControl
    && driver.supportedDirections.includes("FORWARD");
  if (!available) return M4_MASK_TRACKING_CAPABILITY_V1;
  const backwardAvailable = driver.supportedDirections.includes("BACKWARD");
  return {
    ...M4_MASK_TRACKING_CAPABILITY_V1,
    status: "PARTIAL",
    proofMaturity: "VISUAL",
    routes: M4_MASK_TRACKING_CAPABILITY_V1.routes.map((route) => ({ ...route, available: true })),
    limitations: backwardAvailable ? [
      "Analyze Forward and Analyze Backward are available only through verified mask-mode visual routes plus Mask Path post-readback truth.",
      "A bounded native analysis segment is accepted only when Mask Path keyframes grow.",
    ] : [
      "Analyze Forward is available only through the verified mask-mode visual route plus Mask Path post-readback truth.",
      "Analyze Backward remains unavailable until equivalent retained mask-mode proof exists.",
      "A bounded native analysis segment is accepted only when Mask Path keyframes grow.",
    ],
  };
};
interface MaskPathTruthV1 {
  readonly stableId: string;
  readonly name: string;
  readonly keyCount: number;
  readonly lastKeyTime: number | null;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const maskTruth = (value: unknown, expectedStableId: string): MaskPathTruthV1 | null => {
  const root = record(value);
  const mask = record(root?.["mask"]);
  const stableId = typeof mask?.["stableId"] === "string" ? String(mask["stableId"]) : "";
  const name = typeof mask?.["name"] === "string" ? String(mask["name"]) : "";
  const frames = Array.isArray(mask?.["pathKeyframes"]) ? mask["pathKeyframes"] : null;
  if (!mask || stableId !== expectedStableId || !name || !frames) return null;
  let lastKeyTime: number | null = null;
  for (const frame of frames) {
    const item = record(frame);
    if (!item || typeof item["time"] !== "number" || !Number.isFinite(item["time"])) return null;
    lastKeyTime = lastKeyTime === null ? item["time"] : Math.max(lastKeyTime, item["time"]);
  }
  return { stableId, name, keyCount: frames.length, lastKeyTime };
};
const readMaskTruth = async (
  transport: CepEvalScriptMaskTransportV12,
  input: { compHostId: number; layerHostId: number; maskStableId: string },
  suffix: string,
): Promise<MaskPathTruthV1 | null> => {
  const request = buildMaskRequestV12({
    requestId: `M4_MASK_TRACK_${suffix}`,
    transactionId: `M4_MASK_TRACK_${suffix}`,
    operationId: `M4_MASK_TRACK_${suffix}`,
    command: "mask.readback",
    expectedHostProjectRevision: null,
    payload: {
      comp: { hostId: input.compHostId },
      layer: { hostId: input.layerHostId },
      mask: { stableId: input.maskStableId },
    },
    readbackProfile: "M4_MASK_TRACKING_VERIFY",
  });
  const response = await transport.dispatch(request);
  return maskTruth(response.readback, input.maskStableId);
};

export class GuardedMaskTrackingControllerV1 {
  readonly transport: CepEvalScriptMaskTransportV12;
  readonly visualDriver: MaskVisualTrackingDriverV1 | null;

  constructor(transport: CepEvalScriptMaskTransportV12, visualDriver: MaskVisualTrackingDriverV1 | null = null) {
    this.transport = transport;
    this.visualDriver = visualDriver;
  }
  async run(input: {
    readonly compHostId: number;
    readonly layerHostId: number;
    readonly maskStableId: string;
    readonly expectedCompName: string;
    readonly expectedLayerName: string;
    readonly direction: MaskTrackingDirectionV1;
  }): Promise<MaskTrackingRunV1> {
    const before = await readMaskTruth(this.transport, input, "BEFORE");
    if (!before) return this.#escalate(input.direction, "MASK_TARGET_UNAVAILABLE", -1, -1, null, null);
    const driver = this.visualDriver;
    if (!driver || !driver.verifiedVision || !driver.verifiedCursorControl) {
      return this.#escalate(input.direction, "VISUAL_DRIVER_UNAVAILABLE", before.keyCount, before.keyCount, before.lastKeyTime, before.lastKeyTime);
    }
    if (!driver.supportedDirections.includes(input.direction)) {
      return this.#escalate(input.direction, "ANALYSIS_DIRECTION_UNPROVEN", before.keyCount, before.keyCount, before.lastKeyTime, before.lastKeyTime);
    }
    const action = await driver.analyze({
      direction: input.direction,
      compHostId: input.compHostId,
      layerHostId: input.layerHostId,
      maskStableId: input.maskStableId,
      expectedCompName: input.expectedCompName,
      expectedLayerName: input.expectedLayerName,
      expectedMaskName: before.name,
      expectedControl: input.direction === "FORWARD" ? "MASK_ANALYZE_FORWARD" : "MASK_ANALYZE_BACKWARD",
    });
    if (action.status !== "COMPLETED") {
      return this.#escalate(
        input.direction, "VISUAL_ACTION_REFUSED",
        before.keyCount, before.keyCount, before.lastKeyTime, before.lastKeyTime,
        action.visualEvidenceId ?? null,
      );
    }
    const after = await readMaskTruth(this.transport, input, "AFTER");
    const finalCount = after?.keyCount ?? -1;
    const finalTime = after?.lastKeyTime ?? null;
    const grew = !!after && finalCount > before.keyCount
      && (before.lastKeyTime === null || (finalTime !== null && finalTime >= before.lastKeyTime));
    if (!grew) {
      return this.#escalate(
        input.direction, "ANALYSIS_NOT_OBSERVED",
        before.keyCount, finalCount, before.lastKeyTime, finalTime,
        action.visualEvidenceId ?? null,
      );
    }
    return {
      route: "LOCAL", direction: input.direction, escalationReason: null,
      baselinePathKeyCount: before.keyCount, finalPathKeyCount: finalCount,
      baselineLastKeyTime: before.lastKeyTime, finalLastKeyTime: finalTime,
      visualEvidenceId: action.visualEvidenceId ?? null,
    };
  }
  #escalate(
    direction: MaskTrackingDirectionV1,
    reason: MaskTrackingEscalationV1,
    baselinePathKeyCount: number,
    finalPathKeyCount: number,
    baselineLastKeyTime: number | null,
    finalLastKeyTime: number | null,
    visualEvidenceId: string | null = null,
  ): MaskTrackingRunV1 {
    return {
      route: "ESCALATE", direction, escalationReason: reason,
      baselinePathKeyCount, finalPathKeyCount,
      baselineLastKeyTime, finalLastKeyTime, visualEvidenceId,
    };
  }
}
