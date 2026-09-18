import type {
  ExecutionPlan,
  EnvironmentFingerprint,
} from "../../../packages/core-contracts/src/index.js";
import { CapabilityRegistry } from "../../../packages/capability-registry/src/index.js";
import { AsyncTransactionExecutor } from "../../../packages/executor/src/async.js";
import type { ExecutionResult } from "../../../packages/executor/src/index.js";
import {
  AeCepCurrentTransactionalHostV1,
  type CurrentAeCepTransactionalTransportV1,
} from "../../../packages/adapters/ae-cep/src/current-transactional-host.js";
import {
  AE_CEP_PUBLIC_CAPABILITIES_V11,
} from "../../../packages/adapters/ae-cep/src/v1_1.js";
import {
  applyM2AcceptedProofEvidence,
} from "../../../packages/adapters/ae-cep/src/m2-proof-maturity.js";
import {
  M3_TEMPORAL_INTERPOLATION_CAPABILITIES_V17,
} from "../../../packages/adapters/ae-cep/src/m3-temporal-interpolation.js";
import {
  M3_TEMPORAL_EASE_CAPABILITIES_V18,
} from "../../../packages/adapters/ae-cep/src/m3-temporal-ease.js";
import {
  M5_TIME_REMAP_CAPABILITIES_V27,
} from "../../../packages/adapters/ae-cep/src/m5-time-remap.js";
import {
  M4_STABILIZATION_READBACK_CAPABILITIES_V23,
  capabilityForStabilizationDriverV1,
  type StabilizationVisualDriverV1,
} from "../../../packages/adapters/ae-cep/src/m4-stabilization.js";

export const CURRENT_AE_TRANSACTION_RUNTIME_PHASE =
  "M5_CURRENT_AE_TRANSACTION_RUNTIME_V1" as const;
export const CURRENT_AE_TRANSACTION_MAX_OPERATIONS_V1 = 64 as const;

export interface CurrentAeStabilizationRuntimeV1 {
  readonly protocolV23Available: boolean;
  readonly visualDriver: StabilizationVisualDriverV1 | null;
}

export const createCurrentAeTransactionRegistryV1 = (
  environmentFingerprint: EnvironmentFingerprint,
  generatedAt?: string,
  stabilization: CurrentAeStabilizationRuntimeV1 | null = null,
): CapabilityRegistry => {
  const registry = generatedAt === undefined
    ? new CapabilityRegistry(environmentFingerprint)
    : new CapabilityRegistry(environmentFingerprint, generatedAt);
  registry.registerStatic([
    ...applyM2AcceptedProofEvidence(AE_CEP_PUBLIC_CAPABILITIES_V11),
    ...M3_TEMPORAL_INTERPOLATION_CAPABILITIES_V17,
    ...M3_TEMPORAL_EASE_CAPABILITIES_V18,
    ...M5_TIME_REMAP_CAPABILITIES_V27,
    ...(stabilization?.protocolV23Available
      ? [
          ...M4_STABILIZATION_READBACK_CAPABILITIES_V23,
          capabilityForStabilizationDriverV1(stabilization.visualDriver),
        ]
      : []),
  ]);
  return registry;
};

const requireExecutionPlan = (value: unknown): ExecutionPlan => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Current AE transaction runtime requires an ExecutionPlan object.");
  }
  const candidate = value as Partial<ExecutionPlan>;
  if (!Array.isArray(candidate.operations)) {
    throw new TypeError("Current AE transaction runtime requires an operations array.");
  }
  return value as ExecutionPlan;
};

export class CurrentAeTransactionRuntimeV1 {
  readonly transport: CurrentAeCepTransactionalTransportV1;
  readonly projectId: string;
  readonly maxOperations: number;
  readonly stabilization: CurrentAeStabilizationRuntimeV1 | null;

  #executor: AsyncTransactionExecutor | null = null;
  #environmentFingerprint: EnvironmentFingerprint | null = null;
  #requestCounter = 0;

  constructor(
    transport: CurrentAeCepTransactionalTransportV1,
    projectId: string,
    maxOperations = CURRENT_AE_TRANSACTION_MAX_OPERATIONS_V1,
    stabilization: CurrentAeStabilizationRuntimeV1 | null = null,
  ) {
    if (!Number.isInteger(maxOperations) || maxOperations < 1) {
      throw new TypeError("Current AE transaction maxOperations must be a positive integer.");
    }
    this.transport = transport;
    this.projectId = projectId;
    this.maxOperations = maxOperations;
    this.stabilization = stabilization;
  }

  async execute(planInput: unknown): Promise<ExecutionResult> {
    const plan = requireExecutionPlan(planInput);
    if (plan.operations.length > this.maxOperations) {
      throw new Error(
        `CURRENT_AE_TRANSACTION_OPERATION_LIMIT: plan contains ${plan.operations.length} operations; maximum is ${this.maxOperations}.`,
      );
    }

    const transactionId =
      `current-ae:${String(plan.planId)}:${plan.planRevision}`;
    const host = new AeCepCurrentTransactionalHostV1(
      this.transport,
      this.projectId,
      transactionId,
      () => `current-ae-runtime-${++this.#requestCounter}`,
      undefined,
      this.stabilization?.visualDriver ?? null,
    );
    const observed = await host.readState();

    if (
      this.#executor === null
      || this.#environmentFingerprint !== observed.environmentFingerprint
    ) {
      this.#environmentFingerprint = observed.environmentFingerprint;
      this.#executor = new AsyncTransactionExecutor(
        createCurrentAeTransactionRegistryV1(
          observed.environmentFingerprint,
          undefined,
          this.stabilization,
        ),
      );
    }

    return await this.#executor.execute(plan, host);
  }

  status(): Readonly<Record<string, unknown>> {
    return {
      phase: CURRENT_AE_TRANSACTION_RUNTIME_PHASE,
      projectId: this.projectId,
      maxOperations: this.maxOperations,
      environmentFingerprint: this.#environmentFingerprint,
      stabilization: {
        protocolV23Available: this.stabilization?.protocolV23Available ?? false,
        guardedVisualAvailable: Boolean(this.stabilization?.visualDriver),
      },
      recoveryLedgerEntries: this.#executor?.ledger.export().length ?? 0,
    };
  }
}
