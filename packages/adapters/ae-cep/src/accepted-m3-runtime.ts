import { randomUUID } from "node:crypto";

import type {
  CapabilityRecord,
  ExecutionPlanOperation,
  ObservedProjectState,
} from "../../../core-contracts/src/index.js";
import type { AsyncTransactionalHost } from "../../../executor/src/async.js";
import type { HostApplyResult } from "../../../executor/src/index.js";
import { applyM2AcceptedProofEvidence } from "./m2-proof-maturity.js";
import {
  AE_CEP_PUBLIC_CAPABILITIES_V11,
  AeCepAdapterClientV11,
  AeCepAsyncTransactionalHostV11,
} from "./v1_1.js";
import {
  AE_ADAPTER_BUILD_V11,
  AE_ADAPTER_ROUTE_ID_V11,
} from "./protocol-v1_1.js";
import {
  AE_MASK_COMMANDS_V12,
  AE_MASK_ROUTE_ID_V12,
  capabilityForMaskCommandV12,
  type AeMaskCommandV12,
  type AeMaskRequestV12,
  type AeMaskResponseV12,
} from "./protocol-v1_2.js";
import {
  AE_COMPOSITE_COMMANDS_V13,
  AE_COMPOSITE_ROUTE_ID_V13,
  capabilityForCompositeCommandV13,
  type AeCompositeCommandV13,
  type AeCompositeRequestV13,
  type AeCompositeResponseV13,
} from "./protocol-v1_3.js";
import {
  AE_PARENTING_COMMANDS_V14,
  AE_PARENTING_ROUTE_ID_V14,
  capabilityForParentingCommandV14,
  type AeParentingCommandV14,
  type AeParentingRequestV14,
  type AeParentingResponseV14,
} from "./protocol-v1_4.js";
import {
  AE_NULL_RIG_COMMANDS_V15,
  AE_NULL_RIG_ROUTE_ID_V15,
  capabilityForNullRigCommandV15,
  type AeNullRigCommandV15,
  type AeNullRigRequestV15,
  type AeNullRigResponseV15,
} from "./protocol-v1_5.js";
import {
  AE_LAYER_CONTROLS_COMMANDS_V16,
  AE_LAYER_CONTROLS_ROUTE_ID_V16,
  capabilityForLayerControlsCommandV16,
  type AeLayerControlsCommandV16,
  type AeLayerControlsRequestV16,
  type AeLayerControlsResponseV16,
} from "./protocol-v1_6.js";
import {
  AE_TEMPORAL_INTERPOLATION_COMMANDS_V17,
  AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17,
  capabilityForTemporalInterpolationCommandV17,
  type AeTemporalInterpolationCommandV17,
  type AeTemporalInterpolationRequestV17,
  type AeTemporalInterpolationResponseV17,
} from "./protocol-v1_7.js";
import {
  M3_MASK_CAPABILITIES_V12,
  buildMaskRequestV12,
} from "./m3-mask.js";
import {
  M3_COMPOSITE_CAPABILITIES_V13,
  buildCompositeRequestV13,
} from "./m3-composite.js";
import {
  M3_PARENTING_CAPABILITIES_V14,
  buildParentingRequestV14,
} from "./m3-parenting.js";
import {
  M3_NULL_RIG_CAPABILITIES_V15,
  buildNullRigRequestV15,
} from "./m3-null-rig.js";
import {
  M3_LAYER_CONTROLS_CAPABILITIES_V16,
  buildLayerControlsRequestV16,
} from "./m3-layer-controls.js";
import {
  M3_TEMPORAL_INTERPOLATION_CAPABILITIES_V17,
  buildTemporalInterpolationRequestV17,
} from "./m3-temporal-interpolation.js";

export const AE_ACCEPTED_BASELINE_CAPABILITIES_V11: readonly CapabilityRecord[] =
  applyM2AcceptedProofEvidence(AE_CEP_PUBLIC_CAPABILITIES_V11);

export const AE_ACCEPTED_M3_CAPABILITIES: readonly CapabilityRecord[] = [
  ...M3_MASK_CAPABILITIES_V12,
  ...M3_COMPOSITE_CAPABILITIES_V13,
  ...M3_PARENTING_CAPABILITIES_V14,
  ...M3_NULL_RIG_CAPABILITIES_V15,
  ...M3_LAYER_CONTROLS_CAPABILITIES_V16,
  ...M3_TEMPORAL_INTERPOLATION_CAPABILITIES_V17,
] as const;

export const AE_ACCEPTED_M3_LATEST_PROTOCOL = "1.7.0" as const;
export const AE_ACCEPTED_M3_RUNTIME_BUILD = "0.4.0-dev.7" as const;

export interface AeAcceptedM3Transport {
  dispatch(request: AeMaskRequestV12): Promise<AeMaskResponseV12>;
  dispatch(request: AeCompositeRequestV13): Promise<AeCompositeResponseV13>;
  dispatch(request: AeParentingRequestV14): Promise<AeParentingResponseV14>;
  dispatch(request: AeNullRigRequestV15): Promise<AeNullRigResponseV15>;
  dispatch(request: AeLayerControlsRequestV16): Promise<AeLayerControlsResponseV16>;
  dispatch(request: AeTemporalInterpolationRequestV17): Promise<AeTemporalInterpolationResponseV17>;
}

type AcceptedM3Response =
  | AeMaskResponseV12
  | AeCompositeResponseV13
  | AeParentingResponseV14
  | AeNullRigResponseV15
  | AeLayerControlsResponseV16
  | AeTemporalInterpolationResponseV17;

interface ParsedOperation<C extends string> {
  readonly command: C;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly readbackProfile: string | null;
}

const maskCommandByCapability = new Map<string, AeMaskCommandV12>(
  AE_MASK_COMMANDS_V12.map((command) => [capabilityForMaskCommandV12(command), command]),
);
const compositeCommandByCapability = new Map<string, AeCompositeCommandV13>(
  AE_COMPOSITE_COMMANDS_V13.map((command) => [capabilityForCompositeCommandV13(command), command]),
);
const parentingCommandByCapability = new Map<string, AeParentingCommandV14>(
  AE_PARENTING_COMMANDS_V14.map((command) => [capabilityForParentingCommandV14(command), command]),
);
const nullRigCommandByCapability = new Map<string, AeNullRigCommandV15>(
  AE_NULL_RIG_COMMANDS_V15.map((command) => [capabilityForNullRigCommandV15(command), command]),
);
const layerControlsCommandByCapability = new Map<string, AeLayerControlsCommandV16>(
  AE_LAYER_CONTROLS_COMMANDS_V16.map((command) => [capabilityForLayerControlsCommandV16(command), command]),
);
const temporalInterpolationCommandByCapability = new Map<string, AeTemporalInterpolationCommandV17>(
  AE_TEMPORAL_INTERPOLATION_COMMANDS_V17.map((command) => [capabilityForTemporalInterpolationCommandV17(command), command]),
);

const READ_ONLY_M3_COMMANDS = new Set<string>([
  "mask.readback",
  "layer.composite_readback",
  "layer.parenting_readback",
  "rig.null.readback",
  "layer.controls.readback",
  "property.temporal_interpolation.readback",
]);

const parseOperation = <C extends string>(
  operation: ExecutionPlanOperation,
  expectedCommand: C | undefined,
): ParsedOperation<C> => {
  if (expectedCommand === undefined) {
    throw new Error(`No accepted M3 command maps capability '${operation.capabilityId}'.`);
  }
  const explicitCommand = operation.input["command"];
  if (typeof explicitCommand !== "string" || explicitCommand !== expectedCommand) {
    throw new Error(`Execution operation '${operation.operationId}' command/capability mismatch.`);
  }
  const payload = operation.input["payload"];
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Execution operation '${operation.operationId}' requires an object payload.`);
  }
  const profile = operation.input["readbackProfile"];
  if (profile !== undefined && profile !== null && typeof profile !== "string") {
    throw new Error(`Execution operation '${operation.operationId}' readbackProfile must be a string or null.`);
  }
  return {
    command: expectedCommand,
    payload: payload as Readonly<Record<string, unknown>>,
    readbackProfile: typeof profile === "string" ? profile : null,
  };
};

const toHostApplyResult = (response: AcceptedM3Response): HostApplyResult => {
  if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
    throw new Error(`${response.error?.code ?? response.outcome}: ${response.error?.message ?? "AE M3 operation failed."}`);
  }
  return response.readback === null
    ? { outcome: response.outcome }
    : { outcome: response.outcome, readback: response.readback };
};

const expectedRevisionFor = (command: string, hostRevision: number): number | null =>
  READ_ONLY_M3_COMMANDS.has(command) ? null : hostRevision;

export class AeCepAcceptedM3AsyncTransactionalHost implements AsyncTransactionalHost {
  readonly clientV11: AeCepAdapterClientV11;
  readonly transport: AeAcceptedM3Transport;
  readonly projectId: string;
  readonly transactionId: string;
  readonly requestIdFactory: () => string;
  readonly baselineHost: AeCepAsyncTransactionalHostV11;

  constructor(
    clientV11: AeCepAdapterClientV11,
    transport: AeAcceptedM3Transport,
    projectId = "after-effects-project",
    transactionId = "editflow-runtime",
    requestIdFactory: () => string = () => randomUUID(),
  ) {
    this.clientV11 = clientV11;
    this.transport = transport;
    this.projectId = projectId;
    this.transactionId = transactionId;
    this.requestIdFactory = requestIdFactory;
    this.baselineHost = new AeCepAsyncTransactionalHostV11(clientV11, projectId, transactionId);
  }

  async readState(): Promise<ObservedProjectState> {
    return await this.baselineHost.readState();
  }

  async captureRecoverySnapshot(): Promise<unknown> {
    return await this.baselineHost.captureRecoverySnapshot();
  }

  async restoreRecoverySnapshot(snapshot: unknown, appliedOperationCount: number): Promise<void> {
    await this.baselineHost.restoreRecoverySnapshot(snapshot, appliedOperationCount);
  }

  async apply(operation: ExecutionPlanOperation): Promise<HostApplyResult> {
    const routeId = String(operation.routeId);
    if (routeId === AE_ADAPTER_ROUTE_ID_V11) {
      return await this.baselineHost.apply(operation);
    }

    const current = await this.clientV11.observe(this.projectId);
    const hostRevision = current.hostRevision;
    const capabilityId = String(operation.capabilityId);
    const operationId = String(operation.operationId);

    if (routeId === AE_MASK_ROUTE_ID_V12) {
      const parsed = parseOperation(operation, maskCommandByCapability.get(capabilityId));
      const request = buildMaskRequestV12({
        requestId: this.requestIdFactory(),
        transactionId: this.transactionId,
        operationId,
        command: parsed.command,
        expectedHostProjectRevision: expectedRevisionFor(parsed.command, hostRevision),
        payload: parsed.payload,
        readbackProfile: parsed.readbackProfile,
      });
      return toHostApplyResult(await this.transport.dispatch(request));
    }

    if (routeId === AE_COMPOSITE_ROUTE_ID_V13) {
      const parsed = parseOperation(operation, compositeCommandByCapability.get(capabilityId));
      const request = buildCompositeRequestV13({
        requestId: this.requestIdFactory(),
        transactionId: this.transactionId,
        operationId,
        command: parsed.command,
        expectedHostProjectRevision: expectedRevisionFor(parsed.command, hostRevision),
        payload: parsed.payload,
        readbackProfile: parsed.readbackProfile,
      });
      return toHostApplyResult(await this.transport.dispatch(request));
    }

    if (routeId === AE_PARENTING_ROUTE_ID_V14) {
      const parsed = parseOperation(operation, parentingCommandByCapability.get(capabilityId));
      const request = buildParentingRequestV14({
        requestId: this.requestIdFactory(),
        transactionId: this.transactionId,
        operationId,
        command: parsed.command,
        expectedHostProjectRevision: expectedRevisionFor(parsed.command, hostRevision),
        payload: parsed.payload,
        readbackProfile: parsed.readbackProfile,
      });
      return toHostApplyResult(await this.transport.dispatch(request));
    }

    if (routeId === AE_NULL_RIG_ROUTE_ID_V15) {
      const parsed = parseOperation(operation, nullRigCommandByCapability.get(capabilityId));
      const request = buildNullRigRequestV15({
        requestId: this.requestIdFactory(),
        transactionId: this.transactionId,
        operationId,
        command: parsed.command,
        expectedHostProjectRevision: expectedRevisionFor(parsed.command, hostRevision),
        payload: parsed.payload,
        readbackProfile: parsed.readbackProfile,
      });
      return toHostApplyResult(await this.transport.dispatch(request));
    }

    if (routeId === AE_LAYER_CONTROLS_ROUTE_ID_V16) {
      const parsed = parseOperation(operation, layerControlsCommandByCapability.get(capabilityId));
      const request = buildLayerControlsRequestV16({
        requestId: this.requestIdFactory(),
        transactionId: this.transactionId,
        operationId,
        command: parsed.command,
        expectedHostProjectRevision: expectedRevisionFor(parsed.command, hostRevision),
        payload: parsed.payload,
        readbackProfile: parsed.readbackProfile,
      });
      return toHostApplyResult(await this.transport.dispatch(request));
    }

    if (routeId === AE_TEMPORAL_INTERPOLATION_ROUTE_ID_V17) {
      const parsed = parseOperation(operation, temporalInterpolationCommandByCapability.get(capabilityId));
      const request = buildTemporalInterpolationRequestV17({
        requestId: this.requestIdFactory(),
        transactionId: this.transactionId,
        operationId,
        command: parsed.command,
        expectedHostProjectRevision: expectedRevisionFor(parsed.command, hostRevision),
        payload: parsed.payload,
        readbackProfile: parsed.readbackProfile,
      });
      return toHostApplyResult(await this.transport.dispatch(request));
    }

    throw new Error(`No accepted AE runtime dispatcher is registered for route '${routeId}'.`);
  }
}

export const AE_ACCEPTED_BASELINE_ADAPTER_DECLARATION = Object.freeze({
  adapterId: "ae-cep-v1.1-accepted",
  adapterVersion: AE_ADAPTER_BUILD_V11,
  priority: 100,
  capabilities: AE_ACCEPTED_BASELINE_CAPABILITIES_V11,
});

export const AE_ACCEPTED_M3_ADAPTER_DECLARATION = Object.freeze({
  adapterId: "ae-cep-m3-accepted-through-v1.7",
  adapterVersion: AE_ACCEPTED_M3_RUNTIME_BUILD,
  priority: 200,
  capabilities: AE_ACCEPTED_M3_CAPABILITIES,
});
