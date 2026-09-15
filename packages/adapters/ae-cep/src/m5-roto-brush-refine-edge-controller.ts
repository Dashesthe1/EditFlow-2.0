import {
  prepareRotoBrushSemanticActionV1,
  type RotoBrushStrokeV1,
} from "./m5-roto-brush.js";
import {
  assertRotoBrushEffectIdentityV26,
  buildRotoBrushReadbackRequestV26,
  deriveRotoBrushEffectFingerprintV26,
  deriveRotoBrushSessionRevisionV26,
} from "./m5-roto-brush-readback.js";
import type {
  AeRotoBrushPropertyNodeV26,
  AeRotoBrushRequestV26,
  AeRotoBrushResponseV26,
} from "./protocol-v2_6.js";

export type RotoBrushRefineEdgeEscalationV1 =
  | "TARGET_UNAVAILABLE"
  | "AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE"
  | "ROTO_EFFECT_IDENTITY_NOT_ESTABLISHED"
  | "VISUAL_DRIVER_UNAVAILABLE"
  | "VISUAL_ACTION_REFUSED"
  | "POST_TARGET_DRIFT"
  | "NATIVE_ROTO_CHANGE_NOT_OBSERVED"
  | "NATIVE_REFINE_EDGE_STROKE_NOT_OBSERVED";

export interface RotoBrushRefineEdgeReadbackTransportV26 {
  dispatch(request: AeRotoBrushRequestV26): Promise<AeRotoBrushResponseV26>;
}

export interface RotoBrushRefineEdgeVisualRequestV1 {
  readonly operation: "REFINE_EDGE";
  readonly compHostId: number;
  readonly layerHostId: number;
  readonly expectedCompName: string;
  readonly expectedLayerName: string;
  readonly expectedSessionRevision: string;
  readonly expectedEffectFingerprint: string;
  readonly expectedEffectMatchCount: 1;
  readonly atTime: number;
  readonly stroke: RotoBrushStrokeV1;
  readonly expectedTool: "REFINE_EDGE";
  readonly evidenceIds: readonly string[];
}

export interface RotoBrushRefineEdgeVisualResultV1 {
  readonly status: "COMPLETED" | "REFUSED";
  readonly visualEvidenceId?: string | null;
  readonly detail?: string | null;
  readonly aeActionToActionLatenciesMs?: readonly number[];
}

export interface RotoBrushRefineEdgeVisualDriverV1 {
  readonly driverId: string;
  readonly verifiedVision: boolean;
  readonly verifiedCursorControl: boolean;
  readonly supportsRefineEdge: boolean;
  refine(input: RotoBrushRefineEdgeVisualRequestV1): Promise<RotoBrushRefineEdgeVisualResultV1>;
}

export interface RotoBrushRefineEdgeRunV1 {
  readonly route: "LOCAL" | "ESCALATE";
  readonly operation: "REFINE_EDGE";
  readonly escalationReason: RotoBrushRefineEdgeEscalationV1 | null;
  readonly baselineSessionRevision: string | null;
  readonly finalSessionRevision: string | null;
  readonly baselineEffectFingerprint: string | null;
  readonly finalEffectFingerprint: string | null;
  readonly baselineRefineEdgeStrokeCount: number;
  readonly finalRefineEdgeStrokeCount: number;
  readonly visualEvidenceId: string | null;
  readonly aeActionToActionLatenciesMs: readonly number[];
  readonly readback: AeRotoBrushResponseV26["readback"];
}

const exactTarget = (
  response: AeRotoBrushResponseV26,
  input: { compHostId: number; layerHostId: number; expectedCompName: string; expectedLayerName: string },
): boolean => {
  const readback = response.readback;
  return response.outcome === "NO_OP"
    && !!readback
    && readback.comp.hostId === input.compHostId
    && readback.layer.hostId === input.layerHostId
    && readback.comp.name === input.expectedCompName
    && readback.layer.name === input.expectedLayerName;
};

const exactSingleEffectState = (response: AeRotoBrushResponseV26): boolean => {
  const readback = response.readback;
  return response.outcome === "NO_OP"
    && !!readback
    && !readback.propertyTreeTruncated
    && readback.effectMatchCount === 1
    && !!readback.effect;
};

const nativeRefineEdgeStrokeCount = (response: AeRotoBrushResponseV26): number => {
  const effect = response.readback?.effect;
  if (!effect) return 0;
  const countNodes = (nodes: readonly AeRotoBrushPropertyNodeV26[]): number => nodes.reduce((count, node) => {
    const name = node.name.trim().toLowerCase();
    const own = node.matchName === "ADBE Paint Atom" && name.startsWith("edge refinement") ? 1 : 0;
    return count + own + countNodes(node.children);
  }, 0);
  return countNodes(effect.properties);
};

const readback = async (
  transport: RotoBrushRefineEdgeReadbackTransportV26,
  input: { compHostId: number; layerHostId: number },
  suffix: string,
): Promise<AeRotoBrushResponseV26> => transport.dispatch(buildRotoBrushReadbackRequestV26({
  requestId: `M5_ROTO_REFINE_${suffix}`,
  transactionId: `M5_ROTO_REFINE_${suffix}`,
  operationId: `M5_ROTO_REFINE_${suffix}`,
  payload: { comp: { hostId: input.compHostId }, layer: { hostId: input.layerHostId } },
  readbackProfile: "M5_ROTO_BRUSH_REFINE_EDGE_VERIFY",
}));

const cleanLatencies = (values: readonly number[] | undefined): readonly number[] => {
  if (!values) return [];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return [];
  return Object.freeze([...values]);
};

export class GuardedRotoBrushRefineEdgeControllerV1 {
  readonly transport: RotoBrushRefineEdgeReadbackTransportV26;
  readonly visualDriver: RotoBrushRefineEdgeVisualDriverV1 | null;

  constructor(
    transport: RotoBrushRefineEdgeReadbackTransportV26,
    visualDriver: RotoBrushRefineEdgeVisualDriverV1 | null = null,
  ) {
    this.transport = transport;
    this.visualDriver = visualDriver;
  }

  async run(input: {
    readonly compHostId: number;
    readonly layerHostId: number;
    readonly expectedCompName: string;
    readonly expectedLayerName: string;
    readonly atTime: number;
    readonly stroke: RotoBrushStrokeV1;
    readonly evidenceIds: readonly string[];
  }): Promise<RotoBrushRefineEdgeRunV1> {
    const before = await readback(this.transport, input, "BEFORE");
    if (!exactTarget(before, input)) return this.#escalate("TARGET_UNAVAILABLE", before);
    if (!exactSingleEffectState(before)) return this.#escalate("AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE", before);
    try { assertRotoBrushEffectIdentityV26(before); }
    catch (_) { return this.#escalate("ROTO_EFFECT_IDENTITY_NOT_ESTABLISHED", before); }

    let baselineSessionRevision: string;
    let baselineEffectFingerprint: string;
    try {
      baselineSessionRevision = deriveRotoBrushSessionRevisionV26(before);
      baselineEffectFingerprint = deriveRotoBrushEffectFingerprintV26(before);
    } catch (_) {
      return this.#escalate("AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE", before);
    }
    const baselineRefineEdgeStrokeCount = nativeRefineEdgeStrokeCount(before);
    const semantic = prepareRotoBrushSemanticActionV1({
      operation: "REFINE_EDGE",
      target: {
        compHostId: input.compHostId,
        layerHostId: input.layerHostId,
        expectedCompName: input.expectedCompName,
        expectedLayerName: input.expectedLayerName,
      },
      expectedSessionRevision: baselineSessionRevision,
      atTime: input.atTime,
      stroke: input.stroke,
      evidenceIds: input.evidenceIds,
    });

    const driver = this.visualDriver;
    if (!driver || !driver.verifiedVision || !driver.verifiedCursorControl || !driver.supportsRefineEdge) {
      return this.#escalate(
        "VISUAL_DRIVER_UNAVAILABLE", before, baselineSessionRevision, baselineEffectFingerprint,
        baselineRefineEdgeStrokeCount,
      );
    }
    const visual = await driver.refine({
      operation: "REFINE_EDGE",
      compHostId: input.compHostId,
      layerHostId: input.layerHostId,
      expectedCompName: input.expectedCompName,
      expectedLayerName: input.expectedLayerName,
      expectedSessionRevision: baselineSessionRevision,
      expectedEffectFingerprint: baselineEffectFingerprint,
      expectedEffectMatchCount: 1,
      atTime: semantic.atTime as number,
      stroke: semantic.stroke as RotoBrushStrokeV1,
      expectedTool: "REFINE_EDGE",
      evidenceIds: semantic.evidenceIds,
    });
    const latencies = cleanLatencies(visual.aeActionToActionLatenciesMs);
    if (visual.status !== "COMPLETED") {
      return this.#escalate(
        "VISUAL_ACTION_REFUSED", before, baselineSessionRevision, baselineEffectFingerprint,
        baselineRefineEdgeStrokeCount, visual.visualEvidenceId ?? null, latencies,
      );
    }

    const after = await readback(this.transport, input, "AFTER");
    if (!exactTarget(after, input)) {
      return this.#escalate(
        "POST_TARGET_DRIFT", after, baselineSessionRevision, baselineEffectFingerprint,
        baselineRefineEdgeStrokeCount, visual.visualEvidenceId ?? null, latencies,
      );
    }
    if (!exactSingleEffectState(after)) {
      return this.#escalate(
        "AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE", after, baselineSessionRevision, baselineEffectFingerprint,
        baselineRefineEdgeStrokeCount, visual.visualEvidenceId ?? null, latencies,
      );
    }
    try { assertRotoBrushEffectIdentityV26(after); }
    catch (_) {
      return this.#escalate(
        "ROTO_EFFECT_IDENTITY_NOT_ESTABLISHED", after, baselineSessionRevision, baselineEffectFingerprint,
        baselineRefineEdgeStrokeCount, visual.visualEvidenceId ?? null, latencies,
      );
    }
    const finalSessionRevision = deriveRotoBrushSessionRevisionV26(after);
    const finalEffectFingerprint = deriveRotoBrushEffectFingerprintV26(after);
    const finalRefineEdgeStrokeCount = nativeRefineEdgeStrokeCount(after);
    if (finalEffectFingerprint === baselineEffectFingerprint) {
      return this.#escalate(
        "NATIVE_ROTO_CHANGE_NOT_OBSERVED", after, baselineSessionRevision, baselineEffectFingerprint,
        baselineRefineEdgeStrokeCount, visual.visualEvidenceId ?? null, latencies,
        finalSessionRevision, finalEffectFingerprint, finalRefineEdgeStrokeCount,
      );
    }
    if (finalRefineEdgeStrokeCount <= baselineRefineEdgeStrokeCount) {
      return this.#escalate(
        "NATIVE_REFINE_EDGE_STROKE_NOT_OBSERVED", after, baselineSessionRevision, baselineEffectFingerprint,
        baselineRefineEdgeStrokeCount, visual.visualEvidenceId ?? null, latencies,
        finalSessionRevision, finalEffectFingerprint, finalRefineEdgeStrokeCount,
      );
    }
    return {
      route: "LOCAL",
      operation: "REFINE_EDGE",
      escalationReason: null,
      baselineSessionRevision,
      finalSessionRevision,
      baselineEffectFingerprint,
      finalEffectFingerprint,
      baselineRefineEdgeStrokeCount,
      finalRefineEdgeStrokeCount,
      visualEvidenceId: visual.visualEvidenceId ?? null,
      aeActionToActionLatenciesMs: latencies,
      readback: after.readback,
    };
  }

  #escalate(
    reason: RotoBrushRefineEdgeEscalationV1,
    response: AeRotoBrushResponseV26,
    baselineSessionRevision: string | null = null,
    baselineEffectFingerprint: string | null = null,
    baselineRefineEdgeStrokeCount = 0,
    visualEvidenceId: string | null = null,
    aeActionToActionLatenciesMs: readonly number[] = [],
    finalSessionRevision: string | null = null,
    finalEffectFingerprint: string | null = null,
    finalRefineEdgeStrokeCount = nativeRefineEdgeStrokeCount(response),
  ): RotoBrushRefineEdgeRunV1 {
    return {
      route: "ESCALATE",
      operation: "REFINE_EDGE",
      escalationReason: reason,
      baselineSessionRevision,
      finalSessionRevision,
      baselineEffectFingerprint,
      finalEffectFingerprint,
      baselineRefineEdgeStrokeCount,
      finalRefineEdgeStrokeCount,
      visualEvidenceId,
      aeActionToActionLatenciesMs,
      readback: response.readback,
    };
  }
}