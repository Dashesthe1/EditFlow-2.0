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
  AeRotoBrushRequestV26,
  AeRotoBrushResponseV26,
} from "./protocol-v2_6.js";

export type RotoBrushSeedOperationV1 = "SEED_FOREGROUND" | "SEED_BACKGROUND";
export type RotoBrushSeedEscalationV1 =
  | "TARGET_UNAVAILABLE"
  | "AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE"
  | "VISUAL_DRIVER_UNAVAILABLE"
  | "SEED_ROLE_UNPROVEN"
  | "VISUAL_ACTION_REFUSED"
  | "POST_TARGET_DRIFT"
  | "ROTO_EFFECT_IDENTITY_NOT_ESTABLISHED"
  | "NATIVE_ROTO_CHANGE_NOT_OBSERVED";

export interface RotoBrushReadbackTransportV26 {
  dispatch(request: AeRotoBrushRequestV26): Promise<AeRotoBrushResponseV26>;
}

export interface RotoBrushSeedVisualRequestV1 {
  readonly operation: RotoBrushSeedOperationV1;
  readonly compHostId: number;
  readonly layerHostId: number;
  readonly expectedCompName: string;
  readonly expectedLayerName: string;
  readonly expectedSessionRevision: string;
  readonly expectedEffectMatchCount: 0 | 1;
  readonly atTime: number;
  readonly stroke: RotoBrushStrokeV1;
  readonly expectedTool: "ROTO_BRUSH";
  readonly evidenceIds: readonly string[];
}

export interface RotoBrushSeedVisualResultV1 {
  readonly status: "COMPLETED" | "REFUSED";
  readonly visualEvidenceId?: string | null;
  readonly detail?: string | null;
  readonly aeActionToActionLatenciesMs?: readonly number[];
}

export interface RotoBrushSeedVisualDriverV1 {
  readonly driverId: string;
  readonly verifiedVision: boolean;
  readonly verifiedCursorControl: boolean;
  readonly supportedRoles: readonly ("FOREGROUND" | "BACKGROUND")[];
  seed(input: RotoBrushSeedVisualRequestV1): Promise<RotoBrushSeedVisualResultV1>;
}

export interface RotoBrushSeedRunV1 {
  readonly route: "LOCAL" | "ESCALATE";
  readonly operation: RotoBrushSeedOperationV1;
  readonly escalationReason: RotoBrushSeedEscalationV1 | null;
  readonly baselineSessionRevision: string | null;
  readonly finalSessionRevision: string | null;
  readonly baselineEffectFingerprint: string | null;
  readonly finalEffectFingerprint: string | null;
  readonly baselineEffectMatchCount: number;
  readonly finalEffectMatchCount: number;
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

const exactEffectState = (response: AeRotoBrushResponseV26): boolean => {
  const readback = response.readback;
  return response.outcome === "NO_OP"
    && !!readback
    && !readback.propertyTreeTruncated
    && (readback.effectMatchCount === 0 || readback.effectMatchCount === 1);
};

const readback = async (
  transport: RotoBrushReadbackTransportV26,
  input: { compHostId: number; layerHostId: number },
  suffix: string,
): Promise<AeRotoBrushResponseV26> => transport.dispatch(buildRotoBrushReadbackRequestV26({
  requestId: `M5_ROTO_SEED_${suffix}`,
  transactionId: `M5_ROTO_SEED_${suffix}`,
  operationId: `M5_ROTO_SEED_${suffix}`,
  payload: { comp: { hostId: input.compHostId }, layer: { hostId: input.layerHostId } },
  readbackProfile: "M5_ROTO_BRUSH_SEED_VERIFY",
}));

const cleanLatencies = (values: readonly number[] | undefined): readonly number[] => {
  if (!values) return [];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return [];
  return Object.freeze([...values]);
};

export class GuardedRotoBrushSeedControllerV1 {
  readonly transport: RotoBrushReadbackTransportV26;
  readonly visualDriver: RotoBrushSeedVisualDriverV1 | null;

  constructor(transport: RotoBrushReadbackTransportV26, visualDriver: RotoBrushSeedVisualDriverV1 | null = null) {
    this.transport = transport;
    this.visualDriver = visualDriver;
  }

  async run(input: {
    readonly operation: RotoBrushSeedOperationV1;
    readonly compHostId: number;
    readonly layerHostId: number;
    readonly expectedCompName: string;
    readonly expectedLayerName: string;
    readonly atTime: number;
    readonly stroke: RotoBrushStrokeV1;
    readonly evidenceIds: readonly string[];
  }): Promise<RotoBrushSeedRunV1> {
    const before = await readback(this.transport, input, "BEFORE");
    if (!exactTarget(before, input)) return this.#escalate(input.operation, "TARGET_UNAVAILABLE", before);
    if (!exactEffectState(before)) return this.#escalate(input.operation, "AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE", before);

    let baselineSessionRevision: string;
    let baselineEffectFingerprint: string;
    try {
      baselineSessionRevision = deriveRotoBrushSessionRevisionV26(before);
      baselineEffectFingerprint = deriveRotoBrushEffectFingerprintV26(before);
    } catch (_) {
      return this.#escalate(input.operation, "AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE", before);
    }

    const semantic = prepareRotoBrushSemanticActionV1({
      operation: input.operation,
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
    const expectedRole = input.operation === "SEED_FOREGROUND" ? "FOREGROUND" : "BACKGROUND";
    const driver = this.visualDriver;
    if (!driver || !driver.verifiedVision || !driver.verifiedCursorControl) {
      return this.#escalate(input.operation, "VISUAL_DRIVER_UNAVAILABLE", before, baselineSessionRevision, baselineEffectFingerprint);
    }
    if (!driver.supportedRoles.includes(expectedRole)) {
      return this.#escalate(input.operation, "SEED_ROLE_UNPROVEN", before, baselineSessionRevision, baselineEffectFingerprint);
    }

    const visual = await driver.seed({
      operation: input.operation,
      compHostId: input.compHostId,
      layerHostId: input.layerHostId,
      expectedCompName: input.expectedCompName,
      expectedLayerName: input.expectedLayerName,
      expectedSessionRevision: baselineSessionRevision,
      expectedEffectMatchCount: before.readback?.effectMatchCount as 0 | 1,
      atTime: semantic.atTime as number,
      stroke: semantic.stroke as RotoBrushStrokeV1,
      expectedTool: "ROTO_BRUSH",
      evidenceIds: semantic.evidenceIds,
    });
    const latencies = cleanLatencies(visual.aeActionToActionLatenciesMs);
    if (visual.status !== "COMPLETED") {
      return this.#escalate(input.operation, "VISUAL_ACTION_REFUSED", before, baselineSessionRevision, baselineEffectFingerprint, visual.visualEvidenceId ?? null, latencies);
    }

    const after = await readback(this.transport, input, "AFTER");
    if (!exactTarget(after, input)) {
      return this.#escalate(input.operation, "POST_TARGET_DRIFT", after, baselineSessionRevision, baselineEffectFingerprint, visual.visualEvidenceId ?? null, latencies);
    }
    if (!exactEffectState(after)) {
      return this.#escalate(input.operation, "AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE", after, baselineSessionRevision, baselineEffectFingerprint, visual.visualEvidenceId ?? null, latencies);
    }
    try {
      assertRotoBrushEffectIdentityV26(after);
    } catch (_) {
      return this.#escalate(input.operation, "ROTO_EFFECT_IDENTITY_NOT_ESTABLISHED", after, baselineSessionRevision, baselineEffectFingerprint, visual.visualEvidenceId ?? null, latencies);
    }
    const finalSessionRevision = deriveRotoBrushSessionRevisionV26(after);
    const finalEffectFingerprint = deriveRotoBrushEffectFingerprintV26(after);
    if (finalEffectFingerprint === baselineEffectFingerprint) {
      return this.#escalate(input.operation, "NATIVE_ROTO_CHANGE_NOT_OBSERVED", after, baselineSessionRevision, baselineEffectFingerprint, visual.visualEvidenceId ?? null, latencies, finalSessionRevision, finalEffectFingerprint);
    }
    return {
      route: "LOCAL",
      operation: input.operation,
      escalationReason: null,
      baselineSessionRevision,
      finalSessionRevision,
      baselineEffectFingerprint,
      finalEffectFingerprint,
      baselineEffectMatchCount: before.readback?.effectMatchCount ?? -1,
      finalEffectMatchCount: after.readback?.effectMatchCount ?? -1,
      visualEvidenceId: visual.visualEvidenceId ?? null,
      aeActionToActionLatenciesMs: latencies,
      readback: after.readback,
    };
  }

  #escalate(
    operation: RotoBrushSeedOperationV1,
    reason: RotoBrushSeedEscalationV1,
    response: AeRotoBrushResponseV26,
    baselineSessionRevision: string | null = null,
    baselineEffectFingerprint: string | null = null,
    visualEvidenceId: string | null = null,
    aeActionToActionLatenciesMs: readonly number[] = [],
    finalSessionRevision: string | null = null,
    finalEffectFingerprint: string | null = null,
  ): RotoBrushSeedRunV1 {
    return {
      route: "ESCALATE",
      operation,
      escalationReason: reason,
      baselineSessionRevision,
      finalSessionRevision,
      baselineEffectFingerprint,
      finalEffectFingerprint,
      baselineEffectMatchCount: response.readback?.effectMatchCount ?? -1,
      finalEffectMatchCount: response.readback?.effectMatchCount ?? -1,
      visualEvidenceId,
      aeActionToActionLatenciesMs,
      readback: response.readback,
    };
  }
}