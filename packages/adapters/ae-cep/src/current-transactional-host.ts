import { randomUUID } from "node:crypto";
import type {
  ExecutionPlanOperation,
  ObservedProjectState,
} from "../../../core-contracts/src/index.js";
import type { AsyncTransactionalHost } from "../../../executor/src/async.js";
import type { HostApplyResult } from "../../../executor/src/index.js";
import {
  AeCepAdapterClientV11,
  AeFilesystemPolicyV11,
  capabilityForCommandV11,
} from "./v1_1.js";
import {
  AE_ADAPTER_ROUTE_ID_V11,
  isAePublicCommandV11,
  type AeAdapterTransportV11,
} from "./protocol-v1_1.js";
import {
  AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17,
  capabilityForTemporalInterpolationCommandV17,
  isAeTemporalInterpolationCommandV17,
  type AeTemporalInterpolationTransportV17,
} from "./protocol-v1_7.js";
import {
  AE_TEMPORAL_EASE_ROUTE_ID_V18,
  capabilityForTemporalEaseCommandV18,
  isAeTemporalEaseCommandV18,
  type AeTemporalEaseTransportV18,
} from "./protocol-v1_8.js";
import {
  AE_TIME_REMAP_ROUTE_ID_V27,
  capabilityForTimeRemapCommandV27,
  isAeTimeRemapCommandV27,
  type AeTimeRemapTransportV27,
} from "./protocol-v2_7.js";
import { buildTemporalInterpolationRequestV17 } from "./m3-temporal-interpolation.js";
import { buildTemporalEaseRequestV18 } from "./m3-temporal-ease.js";
import { buildTimeRemapRequestV27 } from "./m5-time-remap.js";
import {
  isNativeAeLiveCurveIntentV1,
  materializeCameraPushV1,
  materializeTimeRemapPulseV1,
  type NativeAeCameraPushBaselineV1,
  type NativeAeMaterializedCurveV1,
  type NativeAeTimeRemapBaselineV1,
} from "./native-curve-materialization.js";

export type CurrentAeCepTransactionalTransportV1 =
  AeAdapterTransportV11
  & AeTemporalInterpolationTransportV17
  & AeTemporalEaseTransportV18
  & AeTimeRemapTransportV27;

interface ParsedOperation {
  readonly command: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile: string | null;
}
interface CommonResponse {
  readonly outcome: "APPLIED" | "NO_OP" | "REJECTED" | "FAILED";
  readonly error: { readonly code?: string; readonly message?: string } | null;
  readonly readback: Readonly<Record<string, unknown>> | null;
  readonly hostProjectRevision: number | null;
}

const parseOperation = (operation: ExecutionPlanOperation): ParsedOperation => {
  const command = operation.input["command"];
  const payload = operation.input["payload"];
  if (typeof command !== "string" || command.length === 0) {
    throw new Error(`Execution operation '${operation.operationId}' requires a command.`);
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Execution operation '${operation.operationId}' requires an object payload.`);
  }
  const profile = operation.input["readbackProfile"];
  return {
    command,
    payload: payload as Readonly<Record<string, unknown>>,
    readbackProfile: typeof profile === "string" ? profile : null,
  };
};

const assertBinding = (
  operation: ExecutionPlanOperation,
  expectedCapability: string,
  expectedRoute: string,
): void => {
  if (String(operation.capabilityId) !== expectedCapability) {
    throw new Error(`Execution operation '${operation.operationId}' command/capability mismatch.`);
  }
  if (String(operation.routeId) !== expectedRoute) {
    throw new Error(`Execution operation '${operation.operationId}' route/capability mismatch.`);
  }
};

const responseResult = (response: CommonResponse): HostApplyResult => {
  if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
    throw new Error(
      `${response.error?.code ?? response.outcome}: ${response.error?.message ?? "AE operation failed."}`,
    );
  }
  return response.readback === null
    ? { outcome: response.outcome }
    : { outcome: response.outcome, readback: response.readback };
};

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;

interface TemporalEaseHandleIntentV1 {
  readonly speed: number;
  readonly influence: number;
}

interface TemporalEaseIntentV1 {
  readonly inEase: TemporalEaseHandleIntentV1;
  readonly outEase: TemporalEaseHandleIntentV1;
}

const parseEaseHandleIntent = (
  value: unknown,
  label: string,
): TemporalEaseHandleIntentV1 => {
  const record = asRecord(value);
  const speed = record?.["speed"];
  const influence = record?.["influence"];
  if (
    typeof speed !== "number"
    || !Number.isFinite(speed)
    || typeof influence !== "number"
    || !Number.isFinite(influence)
    || influence <= 0
    || influence > 100
  ) {
    throw new TypeError(
      `Live temporal-ease ${label} intent requires finite speed and influence in (0, 100].`,
    );
  }
  return { speed, influence };
};

const parseTemporalEaseIntent = (
  payload: Readonly<Record<string, unknown>>,
): TemporalEaseIntentV1 | null => {
  const value = payload["easeIntent"];
  if (value === undefined) return null;
  if (payload["ease"] !== undefined) {
    throw new TypeError(
      "Temporal-ease payload cannot provide both exact ease and easeIntent.",
    );
  }
  const record = asRecord(value);
  if (record === null) {
    throw new TypeError("Temporal-ease easeIntent must be an object.");
  }
  return {
    inEase: parseEaseHandleIntent(record["inEase"], "incoming"),
    outEase: parseEaseHandleIntent(record["outEase"], "outgoing"),
  };
};

const temporalEaseCardinality = (response: CommonResponse): number => {
  responseResult(response);
  const readback = asRecord(response.readback);
  const temporalEase = asRecord(readback?.["temporalEase"]);
  const property = asRecord(temporalEase?.["property"]);
  const cardinality = property?.["easeCardinality"];
  if (
    typeof cardinality !== "number"
    || !Number.isInteger(cardinality)
    || cardinality < 1
    || cardinality > 3
  ) {
    throw new Error(
      "TEMPORAL_EASE_CARDINALITY_UNAVAILABLE: live AE readback did not expose cardinality 1-3.",
    );
  }
  return cardinality;
};

interface ExactTemporalEaseStateV1 {
  readonly inEase: readonly TemporalEaseHandleIntentV1[];
  readonly outEase: readonly TemporalEaseHandleIntentV1[];
}

const expandEaseIntent = (
  intent: TemporalEaseIntentV1,
  cardinality: number,
): ExactTemporalEaseStateV1 => ({
  inEase: Array.from(
    { length: cardinality },
    () => structuredClone(intent.inEase),
  ),
  outEase: Array.from(
    { length: cardinality },
    () => structuredClone(intent.outEase),
  ),
});

const temporalEaseTargetCacheKey = (
  payload: Readonly<Record<string, unknown>>,
): string => {
  const comp = asRecord(payload["comp"]);
  const layer = asRecord(payload["layer"]);
  const propertyPath = payload["propertyPath"];
  if (comp === null || layer === null || !Array.isArray(propertyPath)) {
    throw new TypeError("Temporal-ease target requires comp, layer and propertyPath.");
  }

  const objectKey = (
    value: Readonly<Record<string, unknown>>,
    label: string,
  ): string => {
    const stableId = value["stableId"];
    if (typeof stableId === "string" && stableId.length > 0) {
      return `${label}:stable:${stableId}`;
    }
    const hostId = value["hostId"];
    if (typeof hostId === "number" && Number.isInteger(hostId) && hostId > 0) {
      return `${label}:host:${hostId}`;
    }
    throw new TypeError(`Temporal-ease ${label} target requires stableId or hostId.`);
  };

  for (const segment of propertyPath) {
    if (typeof segment !== "string" && typeof segment !== "number") {
      throw new TypeError("Temporal-ease propertyPath contains an invalid segment.");
    }
  }

  return [
    objectKey(comp, "comp"),
    objectKey(layer, "layer"),
    `path:${JSON.stringify(propertyPath)}`,
  ].join("|");
};

const temporalEaseCardinalityInvalidatingCommands = new Set<string>([
  "comp.create",
  "comp.remove",
  "media.import",
  "layer.add_media",
  "layer.duplicate",
  "layer.remove",
  "effect.add",
  "effect.remove",
  "layers.precompose",
  "layer.time_remap.enable",
]);

const liveCurveBaselineInvalidatingCommands = new Set<string>([
  "comp.create",
  "comp.update_settings",
  "comp.remove",
  "media.import",
  "layer.add_media",
  "layer.duplicate",
  "layer.remove",
  "layer.set_transform",
  "layers.precompose",
  "layer.time_remap.enable",
]);

const isObservedProjectState = (value: unknown): value is ObservedProjectState => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate["projectId"] === "string"
    && typeof candidate["projectRevision"] === "string"
    && typeof candidate["projectFingerprint"] === "string"
    && typeof candidate["environmentFingerprint"] === "string";
};
export class AeCepCurrentTransactionalHostV1 implements AsyncTransactionalHost {
  readonly transport: CurrentAeCepTransactionalTransportV1;
  readonly client: AeCepAdapterClientV11;
  readonly projectId: string;
  readonly transactionId: string;
  readonly requestIdFactory: () => string;

  #hostRevision: number | null = null;
  #lastObserved: ObservedProjectState | null = null;
  #rollbackCounter = 0;
  #temporalEaseCardinalityByTarget = new Map<string, number>();
  #materializedCurveByTarget = new Map<string, NativeAeMaterializedCurveV1>();
  #cameraBaselineByLayer = new Map<string, NativeAeCameraPushBaselineV1>();

  constructor(
    transport: CurrentAeCepTransactionalTransportV1,
    projectId: string,
    transactionId = "editflow-current-runtime",
    requestIdFactory: () => string = () => randomUUID(),
    filesystemPolicy = new AeFilesystemPolicyV11([]),
  ) {
    this.transport = transport;
    this.projectId = projectId;
    this.transactionId = transactionId;
    this.requestIdFactory = requestIdFactory;
    this.client = new AeCepAdapterClientV11(transport, requestIdFactory, filesystemPolicy);
  }

  async readState(): Promise<ObservedProjectState> {
    const observed = await this.client.observe(this.projectId);
    this.#hostRevision = observed.hostRevision;
    this.#lastObserved = structuredClone(observed.observed);
    this.#temporalEaseCardinalityByTarget.clear();
    this.#materializedCurveByTarget.clear();
    this.#cameraBaselineByLayer.clear();
    return structuredClone(observed.observed);
  }

  async captureRecoverySnapshot(): Promise<unknown> {
    if (this.#lastObserved === null) await this.readState();
    return structuredClone(this.#lastObserved);
  }

  async #knownHostRevision(): Promise<number> {
    if (this.#hostRevision === null) await this.readState();
    if (this.#hostRevision === null) throw new Error("AE host revision is unavailable.");
    return this.#hostRevision;
  }

  #accept(response: CommonResponse, command: string | null = null): HostApplyResult {
    if (typeof response.hostProjectRevision === "number") {
      this.#hostRevision = response.hostProjectRevision;
    }
    if (response.outcome === "APPLIED") {
      this.#lastObserved = null;
      if (
        command !== null
        && temporalEaseCardinalityInvalidatingCommands.has(command)
      ) {
        this.#temporalEaseCardinalityByTarget.clear();
      }
      if (
        command !== null
        && liveCurveBaselineInvalidatingCommands.has(command)
      ) {
        this.#materializedCurveByTarget.clear();
        this.#cameraBaselineByLayer.clear();
      }
    }
    return responseResult(response);
  }

  async #materializeLiveCurvePayload(
    operation: ExecutionPlanOperation,
    parsed: ParsedOperation,
    revision: number,
  ): Promise<Readonly<Record<string, unknown>>> {
    const value = parsed.payload["liveCurveIntent"];
    if (value === undefined) return parsed.payload;
    if (parsed.payload["keyframes"] !== undefined) {
      throw new TypeError(
        "Live curve payload cannot provide both keyframes and liveCurveIntent.",
      );
    }
    if (!isNativeAeLiveCurveIntentV1(value)) {
      throw new TypeError("liveCurveIntent is not a supported native AE V1 intent.");
    }

    const targetPayload = structuredClone(parsed.payload) as Record<string, unknown>;
    delete targetPayload["liveCurveIntent"];
    const cacheKey = temporalEaseTargetCacheKey(targetPayload);
    let materialized: NativeAeMaterializedCurveV1;

    if (value.kind === "TIME_REMAP_PULSE") {
      const comp = asRecord(targetPayload["comp"]);
      const layer = asRecord(targetPayload["layer"]);
      if (comp === null || layer === null) {
        throw new TypeError("Time Remap live materialization requires comp and layer.");
      }
      const response = await this.transport.dispatch(
        buildTimeRemapRequestV27({
          requestId: this.requestIdFactory(),
          transactionId: this.transactionId,
          operationId: `${String(operation.operationId)}:time-remap-baseline`,
          command: "layer.time_remap.readback",
          expectedHostProjectRevision: null,
          payload: { comp, layer },
          readbackProfile: parsed.readbackProfile,
        }),
      );
      this.#accept(response as unknown as CommonResponse);
      if (response.readback === null) {
        throw new Error(
          "TIME_REMAP_READBACK_REQUIRED: live materialization received no readback.",
        );
      }
      const baseline: NativeAeTimeRemapBaselineV1 = {
        timeRemapEnabled: response.readback.timeRemapEnabled,
        propertyAvailable: response.readback.propertyAvailable,
        keys: response.readback.keys,
      };
      materialized = materializeTimeRemapPulseV1(value, baseline);
    } else {
      const comp = asRecord(targetPayload["comp"]);
      const layer = asRecord(targetPayload["layer"]);
      if (comp === null || layer === null) {
        throw new TypeError("Camera push live materialization requires comp and layer.");
      }
      const baselineKey = JSON.stringify([comp, layer]);
      let baseline = this.#cameraBaselineByLayer.get(baselineKey);
      if (baseline === undefined) {
        const layerResponse = await this.client.executePublicAtKnownHostRevision(
          "readback.object",
          {
            transactionId: this.transactionId,
            operationId: `${String(operation.operationId)}:layer-baseline`,
            capabilityId: capabilityForCommandV11("readback.object"),
            payload: { kind: "LAYER", comp, target: layer },
            expectedHostProjectRevision: revision,
            readbackProfile: parsed.readbackProfile,
          },
        );
        this.#accept(layerResponse);
        const compResponse = await this.client.executePublicAtKnownHostRevision(
          "readback.object",
          {
            transactionId: this.transactionId,
            operationId: `${String(operation.operationId)}:comp-baseline`,
            capabilityId: capabilityForCommandV11("readback.object"),
            payload: { kind: "COMPOSITION", target: comp },
            expectedHostProjectRevision: revision,
            readbackProfile: parsed.readbackProfile,
          },
        );
        this.#accept(compResponse);

        const layerReadback = asRecord(layerResponse.readback);
        const layerState = asRecord(layerReadback?.["layer"]);
        const transform = asRecord(layerState?.["transform"]);
        const compReadback = asRecord(compResponse.readback);
        const compState = asRecord(compReadback?.["composition"]);
        const anchorPoint = transform?.["anchorPoint"];
        const position = transform?.["position"];
        const scale = transform?.["scale"];
        const width = compState?.["width"];
        const height = compState?.["height"];
        if (
          !Array.isArray(anchorPoint)
          || !Array.isArray(position)
          || !Array.isArray(scale)
          || typeof width !== "number"
          || typeof height !== "number"
        ) {
          throw new Error(
            "CAMERA_PUSH_BASELINE_REQUIRED: live layer/comp readback is incomplete.",
          );
        }
        baseline = {
          anchorPoint: anchorPoint as readonly number[],
          position: position as readonly number[],
          scale: scale as readonly number[],
          compWidth: width,
          compHeight: height,
        };
        this.#cameraBaselineByLayer.set(baselineKey, baseline);
      }
      materialized = materializeCameraPushV1(value, baseline);
    }

    this.#materializedCurveByTarget.set(cacheKey, materialized);
    return {
      ...targetPayload,
      keyframes: materialized.keyframes.map((keyframe) => ({
        time: keyframe.time,
        value: structuredClone(keyframe.value),
      })),
    };
  }

  async #materializeTemporalEasePayload(
    operation: ExecutionPlanOperation,
    parsed: ParsedOperation,
  ): Promise<Readonly<Record<string, unknown>>> {
    const targetPayload = structuredClone(parsed.payload) as Record<string, unknown>;
    const liveEase = asRecord(targetPayload["liveCurveEaseIntent"]);
    let intent = parseTemporalEaseIntent(parsed.payload);

    if (liveEase !== null) {
      if (intent !== null || targetPayload["ease"] !== undefined) {
        throw new TypeError(
          "Live curve ease cannot be combined with exact ease or easeIntent.",
        );
      }
      const keyIndex = targetPayload["keyIndex"];
      if (
        typeof keyIndex !== "number"
        || !Number.isInteger(keyIndex)
        || liveEase["keyIndex"] !== keyIndex
      ) {
        throw new TypeError(
          "liveCurveEaseIntent keyIndex must match the temporal-ease target key.",
        );
      }
      delete targetPayload["liveCurveEaseIntent"];
      const curveKey = temporalEaseTargetCacheKey(targetPayload);
      const curve = this.#materializedCurveByTarget.get(curveKey);
      if (curve === undefined) {
        throw new Error(
          "LIVE_CURVE_EASE_NOT_MATERIALIZED: keyframe intent must execute before ease.",
        );
      }
      const resolved = curve.easeIntentByKey.find(
        (candidate) => candidate.keyIndex === keyIndex,
      );
      if (resolved === undefined) {
        throw new Error(
          `LIVE_CURVE_EASE_KEY_MISSING: no materialized ease exists for key ${keyIndex}.`,
        );
      }
      intent = {
        inEase: resolved.inEase,
        outEase: resolved.outEase,
      };
    } else {
      if (intent === null) return parsed.payload;
      delete targetPayload["easeIntent"];
    }

    if (intent === null) {
      throw new Error("TEMPORAL_EASE_INTENT_REQUIRED: no temporal-ease intent was materialized.");
    }

    const cacheKey = temporalEaseTargetCacheKey(targetPayload);
    let cardinality = this.#temporalEaseCardinalityByTarget.get(cacheKey);
    if (cardinality === undefined) {
      const probe = await this.transport.dispatch(
        buildTemporalEaseRequestV18({
          requestId: this.requestIdFactory(),
          transactionId: this.transactionId,
          operationId: `${String(operation.operationId)}:ease-cardinality`,
          command: "property.temporal_ease.readback",
          expectedHostProjectRevision: null,
          payload: targetPayload,
          readbackProfile: parsed.readbackProfile,
        }),
      );
      this.#accept(probe);
      cardinality = temporalEaseCardinality(probe);
      this.#temporalEaseCardinalityByTarget.set(cacheKey, cardinality);
    }
    return {
      ...targetPayload,
      ease: expandEaseIntent(intent, cardinality),
    };
  }

  async apply(operation: ExecutionPlanOperation): Promise<HostApplyResult> {
    const parsed = parseOperation(operation);
    const revision = await this.#knownHostRevision();

    if (isAePublicCommandV11(parsed.command)) {
      assertBinding(
        operation,
        capabilityForCommandV11(parsed.command),
        AE_ADAPTER_ROUTE_ID_V11,
      );
      const payload = parsed.command === "property.set_keyframes"
        ? await this.#materializeLiveCurvePayload(operation, parsed, revision)
        : parsed.payload;
      const response = await this.client.executePublicAtKnownHostRevision(
        parsed.command,
        {
          transactionId: this.transactionId,
          operationId: String(operation.operationId),
          capabilityId: String(operation.capabilityId),
          payload,
          expectedHostProjectRevision: revision,
          readbackProfile: parsed.readbackProfile,
        },
      );
      return this.#accept(response, parsed.command);
    }

    if (isAeTemporalInterpolationCommandV17(parsed.command)) {
      assertBinding(
        operation,
        capabilityForTemporalInterpolationCommandV17(parsed.command),
        AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17,
      );
      const response = await this.transport.dispatch(
        buildTemporalInterpolationRequestV17({
          requestId: this.requestIdFactory(),
          transactionId: this.transactionId,
          operationId: String(operation.operationId),
          command: parsed.command,
          expectedHostProjectRevision:
            parsed.command === "property.temporal_interpolation.set" ? revision : null,
          payload: parsed.payload,
          readbackProfile: parsed.readbackProfile,
        }),
      );
      return this.#accept(response, parsed.command);
    }

    if (isAeTemporalEaseCommandV18(parsed.command)) {
      assertBinding(
        operation,
        capabilityForTemporalEaseCommandV18(parsed.command),
        AE_TEMPORAL_EASE_ROUTE_ID_V18,
      );
      const payload = parsed.command === "property.temporal_ease.set"
        ? await this.#materializeTemporalEasePayload(operation, parsed)
        : parsed.payload;
      const response = await this.transport.dispatch(
        buildTemporalEaseRequestV18({
          requestId: this.requestIdFactory(),
          transactionId: this.transactionId,
          operationId: String(operation.operationId),
          command: parsed.command,
          expectedHostProjectRevision:
            parsed.command === "property.temporal_ease.set" ? revision : null,
          payload,
          readbackProfile: parsed.readbackProfile,
        }),
      );
      return this.#accept(response, parsed.command);
    }
    if (isAeTimeRemapCommandV27(parsed.command)) {
      assertBinding(
        operation,
        capabilityForTimeRemapCommandV27(parsed.command),
        AE_TIME_REMAP_ROUTE_ID_V27,
      );
      const response = await this.transport.dispatch(
        buildTimeRemapRequestV27({
          requestId: this.requestIdFactory(),
          transactionId: this.transactionId,
          operationId: String(operation.operationId),
          command: parsed.command,
          expectedHostProjectRevision:
            parsed.command === "layer.time_remap.enable" ? revision : null,
          payload: parsed.payload as {
            readonly comp: { readonly stableId?: string | null; readonly hostId?: number | null };
            readonly layer: { readonly stableId?: string | null; readonly hostId?: number | null };
          },
          readbackProfile: parsed.readbackProfile,
        }),
      );
      return this.#accept(response as unknown as CommonResponse, parsed.command);
    }

    throw new Error(
      `Execution operation '${operation.operationId}' uses unsupported current AE command '${parsed.command}'.`,
    );
  }
  async restoreRecoverySnapshot(snapshot: unknown, appliedOperationCount: number): Promise<void> {
    if (!isObservedProjectState(snapshot)) {
      throw new TypeError("Invalid current AE recovery snapshot.");
    }
    if (!Number.isInteger(appliedOperationCount) || appliedOperationCount < 0) {
      throw new TypeError("appliedOperationCount must be a non-negative integer.");
    }

    for (let index = 0; index < appliedOperationCount; index += 1) {
      const revision = await this.#knownHostRevision();
      const response = await this.client.undoLastAtKnownHostRevision({
        transactionId: this.transactionId,
        operationId: `rollback:${++this.#rollbackCounter}`,
        expectedHostProjectRevision: revision,
      });
      this.#accept(response);
    }

    const restored = await this.readState();
    if (
      restored.projectId !== snapshot.projectId
      || restored.projectFingerprint !== snapshot.projectFingerprint
      || restored.environmentFingerprint !== snapshot.environmentFingerprint
    ) {
      throw new Error("Current AE undo rollback did not restore the pre-group structure/environment.");
    }
  }
}
