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

export type RotoBrushRepairRoleV1 = "FOREGROUND" | "BACKGROUND";
export type RotoBrushRepairEscalationV1 =
  | "TARGET_UNAVAILABLE"
  | "AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE"
  | "ROTO_EFFECT_IDENTITY_NOT_ESTABLISHED"
  | "VISUAL_DRIVER_UNAVAILABLE"
  | "REPAIR_ROLE_UNPROVEN"
  | "VISUAL_ACTION_REFUSED"
  | "POST_TARGET_DRIFT"
  | "NATIVE_ROTO_CHANGE_NOT_OBSERVED"
  | "NATIVE_REPAIR_STROKE_NOT_OBSERVED";

export interface RotoBrushRepairReadbackTransportV26 {
  dispatch(request: AeRotoBrushRequestV26): Promise<AeRotoBrushResponseV26>;
}

export interface RotoBrushRepairVisualRequestV1 {
  readonly operation: "REPAIR_STROKE";
  readonly compHostId: number;
  readonly layerHostId: number;
  readonly expectedCompName: string;
  readonly expectedLayerName: string;
  readonly expectedSessionRevision: string;
  readonly expectedEffectFingerprint: string;
  readonly expectedEffectMatchCount: 1;
  readonly atTime: number;
  readonly stroke: RotoBrushStrokeV1 & { readonly role: RotoBrushRepairRoleV1 };
  readonly expectedTool: "ROTO_BRUSH";
  readonly evidenceIds: readonly string[];
}

export interface RotoBrushRepairVisualResultV1 {
  readonly status: "COMPLETED" | "REFUSED";
  readonly visualEvidenceId?: string | null;
  readonly detail?: string | null;
  readonly visibleRepairChangeObserved?: boolean;
  readonly aeActionToActionLatenciesMs?: readonly number[];
}

export interface RotoBrushRepairVisualDriverV1 {
  readonly driverId: string;
  readonly verifiedVision: boolean;
  readonly verifiedCursorControl: boolean;
  readonly supportedRoles: readonly RotoBrushRepairRoleV1[];
  repair(input: RotoBrushRepairVisualRequestV1): Promise<RotoBrushRepairVisualResultV1>;
}

export interface RotoBrushRepairRunV1 {
  readonly route: "LOCAL" | "ESCALATE";
  readonly operation: "REPAIR_STROKE";
  readonly escalationReason: RotoBrushRepairEscalationV1 | null;
  readonly repairRole: RotoBrushRepairRoleV1 | null;
  readonly baselineSessionRevision: string | null;
  readonly finalSessionRevision: string | null;
  readonly baselineEffectFingerprint: string | null;
  readonly finalEffectFingerprint: string | null;
  readonly baselineRepairRoleStrokeCount: number;
  readonly finalRepairRoleStrokeCount: number;
  readonly visualEvidenceId: string | null;
  readonly visibleRepairChangeObserved: boolean;
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

const unambiguousEffectState = (response: AeRotoBrushResponseV26): boolean => {
  const readback = response.readback;
  return response.outcome === "NO_OP"
    && !!readback
    && !readback.propertyTreeTruncated
    && readback.effectMatchCount <= 1;
};

const nativeRoleStrokeCount = (response: AeRotoBrushResponseV26, role: RotoBrushRepairRoleV1): number => {
  const effect = response.readback?.effect;
  if (!effect) return 0;
  const prefix = role === "FOREGROUND" ? "Foreground" : "Background";
  const countNodes = (nodes: readonly AeRotoBrushPropertyNodeV26[]): number => nodes.reduce((count, node) => {
    const own = node.matchName === "ADBE Paint Atom" && node.name.trim().startsWith(prefix) ? 1 : 0;
    return count + own + countNodes(node.children);
  }, 0);
  return countNodes(effect.properties);
};

const readback = async (
  transport: RotoBrushRepairReadbackTransportV26,
  input: { compHostId: number; layerHostId: number },
  suffix: string,
): Promise<AeRotoBrushResponseV26> => transport.dispatch(buildRotoBrushReadbackRequestV26({
  requestId: `M5_ROTO_REPAIR_${suffix}`,
  transactionId: `M5_ROTO_REPAIR_${suffix}`,
  operationId: `M5_ROTO_REPAIR_${suffix}`,
  payload: { comp: { hostId: input.compHostId }, layer: { hostId: input.layerHostId } },
  readbackProfile: "M5_ROTO_BRUSH_REPAIR_VERIFY",
}));

const cleanLatencies = (values: readonly number[] | undefined): readonly number[] => {
  if (!values) return [];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return [];
  return Object.freeze([...values]);
};

export class GuardedRotoBrushRepairControllerV1 {
  readonly transport: RotoBrushRepairReadbackTransportV26;
  readonly visualDriver: RotoBrushRepairVisualDriverV1 | null;

  constructor(
    transport: RotoBrushRepairReadbackTransportV26,
    visualDriver: RotoBrushRepairVisualDriverV1 | null = null,
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
  }): Promise<RotoBrushRepairRunV1> {
    const before = await readback(this.transport, input, "BEFORE");
    if (!exactTarget(before, input)) return this.#escalate("TARGET_UNAVAILABLE", before);
    if (!unambiguousEffectState(before)) return this.#escalate("AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE", before);
    if (before.readback?.effectMatchCount !== 1 || !before.readback.effect) return this.#escalate("ROTO_EFFECT_IDENTITY_NOT_ESTABLISHED", before);
    try { assertRotoBrushEffectIdentityV26(before); }
    catch (_) { return this.#escalate("ROTO_EFFECT_IDENTITY_NOT_ESTABLISHED", before); }

    const repairRole = input.stroke.role === "FOREGROUND" || input.stroke.role === "BACKGROUND" ? input.stroke.role : null;
    if (!repairRole) return this.#escalate("REPAIR_ROLE_UNPROVEN", before);

    let baselineSessionRevision: string;
    let baselineEffectFingerprint: string;
    try {
      baselineSessionRevision = deriveRotoBrushSessionRevisionV26(before);
      baselineEffectFingerprint = deriveRotoBrushEffectFingerprintV26(before);
    } catch (_) {
      return this.#escalate("AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE", before);
    }
    const baselineRepairRoleStrokeCount = nativeRoleStrokeCount(before, repairRole);
    const semantic = prepareRotoBrushSemanticActionV1({
      operation: "REPAIR_STROKE",
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
    if (!driver || !driver.verifiedVision || !driver.verifiedCursorControl) {
      return this.#escalate(
        "VISUAL_DRIVER_UNAVAILABLE", before, repairRole, baselineSessionRevision,
        baselineEffectFingerprint, baselineRepairRoleStrokeCount,
      );
    }
    if (!driver.supportedRoles.includes(repairRole)) {
      return this.#escalate(
        "REPAIR_ROLE_UNPROVEN", before, repairRole, baselineSessionRevision,
        baselineEffectFingerprint, baselineRepairRoleStrokeCount,
      );
    }

    const visual = await driver.repair({
      operation: "REPAIR_STROKE",
      compHostId: input.compHostId,
      layerHostId: input.layerHostId,
      expectedCompName: input.expectedCompName,
      expectedLayerName: input.expectedLayerName,
      expectedSessionRevision: baselineSessionRevision,
      expectedEffectFingerprint: baselineEffectFingerprint,
      expectedEffectMatchCount: 1,
      atTime: semantic.atTime as number,
      stroke: semantic.stroke as RotoBrushStrokeV1 & { readonly role: RotoBrushRepairRoleV1 },
      expectedTool: "ROTO_BRUSH",
      evidenceIds: semantic.evidenceIds,
    });
    const latencies = cleanLatencies(visual.aeActionToActionLatenciesMs);
    if (visual.status !== "COMPLETED" || visual.visibleRepairChangeObserved !== true) {
      return this.#escalate(
        "VISUAL_ACTION_REFUSED", before, repairRole, baselineSessionRevision,
        baselineEffectFingerprint, baselineRepairRoleStrokeCount,
        visual.visualEvidenceId ?? null, visual.visibleRepairChangeObserved === true, latencies,
      );
    }

    const after = await readback(this.transport, input, "AFTER");
    if (!exactTarget(after, input)) {
      return this.#escalate(
        "POST_TARGET_DRIFT", after, repairRole, baselineSessionRevision,
        baselineEffectFingerprint, baselineRepairRoleStrokeCount,
        visual.visualEvidenceId ?? null, true, latencies,
      );
    }
    if (!unambiguousEffectState(after)) {
      return this.#escalate(
        "AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE", after, repairRole, baselineSessionRevision,
        baselineEffectFingerprint, baselineRepairRoleStrokeCount,
        visual.visualEvidenceId ?? null, true, latencies,
      );
    }
    if (after.readback?.effectMatchCount !== 1 || !after.readback.effect) {
      return this.#escalate(
        "ROTO_EFFECT_IDENTITY_NOT_ESTABLISHED", after, repairRole, baselineSessionRevision,
        baselineEffectFingerprint, baselineRepairRoleStrokeCount,
        visual.visualEvidenceId ?? null, true, latencies,
      );
    }
    try { assertRotoBrushEffectIdentityV26(after); }
    catch (_) {
      return this.#escalate(
        "ROTO_EFFECT_IDENTITY_NOT_ESTABLISHED", after, repairRole, baselineSessionRevision,
        baselineEffectFingerprint, baselineRepairRoleStrokeCount,
        visual.visualEvidenceId ?? null, true, latencies,
      );
    }
    const finalSessionRevision = deriveRotoBrushSessionRevisionV26(after);
    const finalEffectFingerprint = deriveRotoBrushEffectFingerprintV26(after);
    const finalRepairRoleStrokeCount = nativeRoleStrokeCount(after, repairRole);
    if (finalEffectFingerprint === baselineEffectFingerprint) {
      return this.#escalate(
        "NATIVE_ROTO_CHANGE_NOT_OBSERVED", after, repairRole, baselineSessionRevision,
        baselineEffectFingerprint, baselineRepairRoleStrokeCount,
        visual.visualEvidenceId ?? null, true, latencies,
        finalSessionRevision, finalEffectFingerprint, finalRepairRoleStrokeCount,
      );
    }
    if (finalRepairRoleStrokeCount <= baselineRepairRoleStrokeCount) {
      return this.#escalate(
        "NATIVE_REPAIR_STROKE_NOT_OBSERVED", after, repairRole, baselineSessionRevision,
        baselineEffectFingerprint, baselineRepairRoleStrokeCount,
        visual.visualEvidenceId ?? null, true, latencies,
        finalSessionRevision, finalEffectFingerprint, finalRepairRoleStrokeCount,
      );
    }
    return {
      route: "LOCAL",
      operation: "REPAIR_STROKE",
      escalationReason: null,
      repairRole,
      baselineSessionRevision,
      finalSessionRevision,
      baselineEffectFingerprint,
      finalEffectFingerprint,
      baselineRepairRoleStrokeCount,
      finalRepairRoleStrokeCount,
      visualEvidenceId: visual.visualEvidenceId ?? null,
      visibleRepairChangeObserved: true,
      aeActionToActionLatenciesMs: latencies,
      readback: after.readback,
    };
  }

  #escalate(
    reason: RotoBrushRepairEscalationV1,
    response: AeRotoBrushResponseV26,
    repairRole: RotoBrushRepairRoleV1 | null = null,
    baselineSessionRevision: string | null = null,
    baselineEffectFingerprint: string | null = null,
    baselineRepairRoleStrokeCount = 0,
    visualEvidenceId: string | null = null,
    visibleRepairChangeObserved = false,
    aeActionToActionLatenciesMs: readonly number[] = [],
    finalSessionRevision: string | null = null,
    finalEffectFingerprint: string | null = null,
    finalRepairRoleStrokeCount = repairRole ? nativeRoleStrokeCount(response, repairRole) : 0,
  ): RotoBrushRepairRunV1 {
    return {
      route: "ESCALATE",
      operation: "REPAIR_STROKE",
      escalationReason: reason,
      repairRole,
      baselineSessionRevision,
      finalSessionRevision,
      baselineEffectFingerprint,
      finalEffectFingerprint,
      baselineRepairRoleStrokeCount,
      finalRepairRoleStrokeCount,
      visualEvidenceId,
      visibleRepairChangeObserved,
      aeActionToActionLatenciesMs,
      readback: response.readback,
    };
  }
}