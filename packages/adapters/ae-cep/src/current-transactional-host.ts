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

  #accept(response: CommonResponse): HostApplyResult {
    if (typeof response.hostProjectRevision === "number") {
      this.#hostRevision = response.hostProjectRevision;
    }
    if (response.outcome === "APPLIED") this.#lastObserved = null;
    return responseResult(response);
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
      const response = await this.client.executePublicAtKnownHostRevision(
        parsed.command,
        {
          transactionId: this.transactionId,
          operationId: String(operation.operationId),
          capabilityId: String(operation.capabilityId),
          payload: parsed.payload,
          expectedHostProjectRevision: revision,
          readbackProfile: parsed.readbackProfile,
        },
      );
      return this.#accept(response);
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
      return this.#accept(response);
    }

    if (isAeTemporalEaseCommandV18(parsed.command)) {
      assertBinding(
        operation,
        capabilityForTemporalEaseCommandV18(parsed.command),
        AE_TEMPORAL_EASE_ROUTE_ID_V18,
      );
      const response = await this.transport.dispatch(
        buildTemporalEaseRequestV18({
          requestId: this.requestIdFactory(),
          transactionId: this.transactionId,
          operationId: String(operation.operationId),
          command: parsed.command,
          expectedHostProjectRevision:
            parsed.command === "property.temporal_ease.set" ? revision : null,
          payload: parsed.payload,
          readbackProfile: parsed.readbackProfile,
        }),
      );
      return this.#accept(response);
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
      return this.#accept(response as unknown as CommonResponse);
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
