import {
  prepareRotoBrushSemanticActionV1,
  type RotoBrushExportKindV1,
} from "./m5-roto-brush.js";
import {
  assertRotoBrushEffectIdentityV26,
  buildRotoBrushReadbackRequestV26,
  deriveRotoBrushEffectFingerprintV26,
  deriveRotoBrushSessionRevisionV26,
} from "./m5-roto-brush-readback.js";
import type {
  AeAdapterRequestV11,
  AeAdapterResponseV11,
  AeAdapterCommandV11,
} from "./protocol-v1_1.js";
import type {
  AeRotoBrushRequestV26,
  AeRotoBrushResponseV26,
} from "./protocol-v2_6.js";
import type { AeLayerSnapshot, AeProjectSnapshot } from "../../../ae-object-model/src/index.js";

export type RotoBrushExportEscalationV1 =
  | "TARGET_UNAVAILABLE"
  | "AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE"
  | "ROTO_EFFECT_IDENTITY_NOT_ESTABLISHED"
  | "EXPORT_KIND_UNPROVEN"
  | "OUTPUT_ID_COLLISION"
  | "HOST_EXPORT_FAILED"
  | "OUTPUT_STRUCTURE_MISMATCH"
  | "OUTPUT_ROTO_MISMATCH";

export interface RotoBrushExportTransportV1 {
  dispatchRoto(request: AeRotoBrushRequestV26): Promise<AeRotoBrushResponseV26>;
  dispatchHost(request: AeAdapterRequestV11): Promise<AeAdapterResponseV11>;
}

export interface RotoBrushExportRunV1 {
  readonly route: "LOCAL" | "ESCALATE";
  readonly operation: "EXPORT_MATTE";
  readonly exportKind: RotoBrushExportKindV1;
  readonly exportStableId: string;
  readonly escalationReason: RotoBrushExportEscalationV1 | null;
  readonly baselineSessionRevision: string | null;
  readonly baselineEffectFingerprint: string | null;
  readonly outputEffectFingerprint: string | null;
  readonly outputLayerHostId: number | null;
  readonly structuralOutputVerified: boolean;
  readonly nativeRotoOutputVerified: boolean;
  readonly hostMutationDurationMs: number | null;
  readonly sourceReadback: AeRotoBrushResponseV26["readback"];
  readonly outputReadback: AeRotoBrushResponseV26["readback"];
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const exactRotoTarget = (
  response: AeRotoBrushResponseV26,
  input: { compHostId: number; layerHostId: number; expectedCompName: string; expectedLayerName: string },
): boolean => {
  const rb = response.readback;
  return response.outcome === "NO_OP"
    && !!rb
    && rb.comp.hostId === input.compHostId
    && rb.layer.hostId === input.layerHostId
    && rb.comp.name === input.expectedCompName
    && rb.layer.name === input.expectedLayerName;
};

const validRotoState = (response: AeRotoBrushResponseV26): boolean =>
  response.outcome === "NO_OP"
  && !!response.readback
  && !response.readback.propertyTreeTruncated
  && response.readback.effectMatchCount === 1
  && !!response.readback.effect;

const rotoReadback = (
  transport: RotoBrushExportTransportV1,
  input: { compHostId: number; layerHostId: number },
  suffix: string,
): Promise<AeRotoBrushResponseV26> => transport.dispatchRoto(buildRotoBrushReadbackRequestV26({
  requestId: `M5_ROTO_EXPORT_${suffix}`,
  transactionId: `M5_ROTO_EXPORT_${suffix}`,
  operationId: `M5_ROTO_EXPORT_${suffix}`,
  payload: { comp: { hostId: input.compHostId }, layer: { hostId: input.layerHostId } },
  readbackProfile: "M5_ROTO_BRUSH_EXPORT_VERIFY",
}));

const capabilityForV11 = (command: AeAdapterCommandV11): string => {
  if (command === "project.inspect") return "ae.project.inspect";
  if (command === "layer.duplicate") return "ae.layer.duplicate";
  if (command === "readback.object") return "ae.object.readback";
  throw new TypeError(`M5 export does not authorize v1.1 command '${command}'.`);
};

const v11Request = (
  command: "project.inspect" | "layer.duplicate" | "readback.object",
  payload: Readonly<Record<string, unknown>>,
  suffix: string,
  expectedHostProjectRevision: number | null = null,
): AeAdapterRequestV11 => ({
  protocolVersion: "1.1.0",
  requestId: `M5_ROTO_EXPORT_${suffix}`,
  transactionId: `M5_ROTO_EXPORT_${suffix}`,
  operationId: `M5_ROTO_EXPORT_${suffix}`,
  capabilityId: capabilityForV11(command),
  command,
  expectedProjectRevision: null,
  expectedProjectFingerprint: null,
  expectedHostProjectRevision,
  payload,
  readbackProfile: "M5_ROTO_BRUSH_EXPORT_VERIFY",
});

const projectFrom = (response: AeAdapterResponseV11): AeProjectSnapshot | null =>
  response.outcome === "NO_OP" && response.projectSnapshot ? response.projectSnapshot : null;

const compLayers = (project: AeProjectSnapshot, compHostId: number): readonly AeLayerSnapshot[] | null =>
  project.items.find((item) => item.hostId === compHostId && item.kind === "COMPOSITION")?.composition?.layers ?? null;

const sameDuplicatedStructure = (source: AeLayerSnapshot, output: AeLayerSnapshot, stableId: string): boolean =>
  output.stableId === stableId
  && output.hostId !== null
  && output.hostId !== source.hostId
  && output.kind === source.kind
  && output.sourceHostId === source.sourceHostId
  && output.sourceStableId === source.sourceStableId
  && output.startTime === source.startTime
  && output.inPoint === source.inPoint
  && output.outPoint === source.outPoint
  && output.stretch === source.stretch
  && output.parentStableId === source.parentStableId
  && JSON.stringify(output.transform) === JSON.stringify(source.transform)
  && output.enabled === source.enabled
  && output.locked === source.locked
  && output.shy === source.shy
  && output.solo === source.solo
  && output.threeDLayer === source.threeDLayer
  && output.adjustmentLayer === source.adjustmentLayer;

export class GuardedRotoBrushExportControllerV1 {
  readonly transport: RotoBrushExportTransportV1;

  constructor(transport: RotoBrushExportTransportV1) {
    this.transport = transport;
  }

  async run(input: {
    readonly compHostId: number;
    readonly layerHostId: number;
    readonly expectedCompName: string;
    readonly expectedLayerName: string;
    readonly export: { readonly kind: RotoBrushExportKindV1; readonly stableId: string };
    readonly evidenceIds: readonly string[];
  }): Promise<RotoBrushExportRunV1> {
    const before = await rotoReadback(this.transport, input, "ROTO_BEFORE");
    if (!exactRotoTarget(before, input)) return this.#escalate(input, "TARGET_UNAVAILABLE", before);
    if (!validRotoState(before)) return this.#escalate(input, "AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE", before);
    try { assertRotoBrushEffectIdentityV26(before); }
    catch (_) { return this.#escalate(input, "ROTO_EFFECT_IDENTITY_NOT_ESTABLISHED", before); }

    let baselineSessionRevision: string;
    let baselineEffectFingerprint: string;
    try {
      baselineSessionRevision = deriveRotoBrushSessionRevisionV26(before);
      baselineEffectFingerprint = deriveRotoBrushEffectFingerprintV26(before);
    } catch (_) {
      return this.#escalate(input, "AMBIGUOUS_OR_TRUNCATED_EFFECT_STATE", before);
    }

    const semantic = prepareRotoBrushSemanticActionV1({
      operation: "EXPORT_MATTE",
      target: {
        compHostId: input.compHostId,
        layerHostId: input.layerHostId,
        expectedCompName: input.expectedCompName,
        expectedLayerName: input.expectedLayerName,
      },
      expectedSessionRevision: baselineSessionRevision,
      export: input.export,
      evidenceIds: input.evidenceIds,
    });
    if (semantic.export?.kind !== "TRACK_MATTE") {
      return this.#escalate(input, "EXPORT_KIND_UNPROVEN", before, baselineSessionRevision, baselineEffectFingerprint);
    }

    const inspectBefore = await this.transport.dispatchHost(v11Request("project.inspect", {}, "PROJECT_BEFORE"));
    const projectBefore = projectFrom(inspectBefore);
    const layersBefore = projectBefore ? compLayers(projectBefore, input.compHostId) : null;
    const sourceLayer = layersBefore?.find((layer) => layer.hostId === input.layerHostId) ?? null;
    if (!projectBefore || !layersBefore || !sourceLayer || sourceLayer.name !== input.expectedLayerName) {
      return this.#escalate(input, "TARGET_UNAVAILABLE", before, baselineSessionRevision, baselineEffectFingerprint);
    }
    if (layersBefore.some((layer) => layer.stableId === semantic.export?.stableId)) {
      return this.#escalate(input, "OUTPUT_ID_COLLISION", before, baselineSessionRevision, baselineEffectFingerprint);
    }

    const duplicate = await this.transport.dispatchHost(v11Request("layer.duplicate", {
      comp: { hostId: input.compHostId },
      layer: { hostId: input.layerHostId },
      stableId: semantic.export.stableId,
    }, "DUPLICATE", projectBefore.hostRevision));
    const duplicateReadback = record(duplicate.readback);
    const duplicateLayer = record(duplicateReadback?.["layer"]);
    const outputLayerHostId = typeof duplicateLayer?.["hostId"] === "number" ? duplicateLayer["hostId"] : null;
    if (duplicate.outcome !== "APPLIED" || outputLayerHostId === null || duplicateLayer?.["stableId"] !== semantic.export.stableId) {
      return this.#escalate(
        input, "HOST_EXPORT_FAILED", before, baselineSessionRevision, baselineEffectFingerprint,
        outputLayerHostId, null, false, false, duplicate.diagnostics.durationMs ?? null,
      );
    }

    const inspectAfter = await this.transport.dispatchHost(v11Request("project.inspect", {}, "PROJECT_AFTER"));
    const projectAfter = projectFrom(inspectAfter);
    const layersAfter = projectAfter ? compLayers(projectAfter, input.compHostId) : null;
    const outputLayer = layersAfter?.find((layer) => layer.hostId === outputLayerHostId) ?? null;
    const structuralOutputVerified = !!outputLayer
      && layersAfter?.filter((layer) => layer.stableId === semantic.export?.stableId).length === 1
      && sameDuplicatedStructure(sourceLayer, outputLayer, semantic.export.stableId);
    if (!structuralOutputVerified) {
      return this.#escalate(
        input, "OUTPUT_STRUCTURE_MISMATCH", before, baselineSessionRevision, baselineEffectFingerprint,
        outputLayerHostId, null, false, false, duplicate.diagnostics.durationMs ?? null,
      );
    }

    const outputRoto = await rotoReadback(this.transport, {
      compHostId: input.compHostId,
      layerHostId: outputLayerHostId,
    }, "ROTO_OUTPUT");
    if (!exactRotoTarget(outputRoto, {
      compHostId: input.compHostId,
      layerHostId: outputLayerHostId,
      expectedCompName: input.expectedCompName,
      expectedLayerName: outputLayer.name,
    }) || !validRotoState(outputRoto)) {
      return this.#escalate(
        input, "OUTPUT_ROTO_MISMATCH", before, baselineSessionRevision, baselineEffectFingerprint,
        outputLayerHostId, null, true, false, duplicate.diagnostics.durationMs ?? null, outputRoto.readback,
      );
    }
    try { assertRotoBrushEffectIdentityV26(outputRoto); }
    catch (_) {
      return this.#escalate(
        input, "OUTPUT_ROTO_MISMATCH", before, baselineSessionRevision, baselineEffectFingerprint,
        outputLayerHostId, null, true, false, duplicate.diagnostics.durationMs ?? null, outputRoto.readback,
      );
    }
    const outputEffectFingerprint = deriveRotoBrushEffectFingerprintV26(outputRoto);
    const nativeRotoOutputVerified = outputEffectFingerprint === baselineEffectFingerprint;
    if (!nativeRotoOutputVerified) {
      return this.#escalate(
        input, "OUTPUT_ROTO_MISMATCH", before, baselineSessionRevision, baselineEffectFingerprint,
        outputLayerHostId, outputEffectFingerprint, true, false, duplicate.diagnostics.durationMs ?? null, outputRoto.readback,
      );
    }

    return {
      route: "LOCAL",
      operation: "EXPORT_MATTE",
      exportKind: semantic.export.kind,
      exportStableId: semantic.export.stableId,
      escalationReason: null,
      baselineSessionRevision,
      baselineEffectFingerprint,
      outputEffectFingerprint,
      outputLayerHostId,
      structuralOutputVerified: true,
      nativeRotoOutputVerified: true,
      hostMutationDurationMs: duplicate.diagnostics.durationMs ?? null,
      sourceReadback: before.readback,
      outputReadback: outputRoto.readback,
    };
  }

  #escalate(
    input: { export: { kind: RotoBrushExportKindV1; stableId: string } },
    reason: RotoBrushExportEscalationV1,
    source: AeRotoBrushResponseV26,
    baselineSessionRevision: string | null = null,
    baselineEffectFingerprint: string | null = null,
    outputLayerHostId: number | null = null,
    outputEffectFingerprint: string | null = null,
    structuralOutputVerified = false,
    nativeRotoOutputVerified = false,
    hostMutationDurationMs: number | null = null,
    outputReadback: AeRotoBrushResponseV26["readback"] = null,
  ): RotoBrushExportRunV1 {
    return {
      route: "ESCALATE",
      operation: "EXPORT_MATTE",
      exportKind: input.export.kind,
      exportStableId: input.export.stableId,
      escalationReason: reason,
      baselineSessionRevision,
      baselineEffectFingerprint,
      outputEffectFingerprint,
      outputLayerHostId,
      structuralOutputVerified,
      nativeRotoOutputVerified,
      hostMutationDurationMs,
      sourceReadback: source.readback,
      outputReadback,
    };
  }
}
