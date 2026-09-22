import type {
  ExecutionPlan,
  EnvironmentFingerprint,
  ObservedProjectState,
} from "../../../packages/core-contracts/src/index.js";
import { CapabilityRegistry } from "../../../packages/capability-registry/src/index.js";
import {
  AsyncTransactionExecutor,
  type AsyncTransactionalHost,
} from "../../../packages/executor/src/async.js";
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
  M3_COMPOSITE_CAPABILITIES_V13,
} from "../../../packages/adapters/ae-cep/src/m3-composite.js";
import {
  M3_LAYER_CONTROLS_CAPABILITIES_V16,
} from "../../../packages/adapters/ae-cep/src/m3-layer-controls.js";
import {
  M3_TEMPORAL_INTERPOLATION_CAPABILITIES_V17,
} from "../../../packages/adapters/ae-cep/src/m3-temporal-interpolation.js";
import {
  M3_TEMPORAL_EASE_CAPABILITIES_V18,
} from "../../../packages/adapters/ae-cep/src/m3-temporal-ease.js";
import {
  M3_MARKER_MOTION_CAPABILITIES_V20,
} from "../../../packages/adapters/ae-cep/src/m3-marker-motion.js";
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
export const CURRENT_AE_CORRECTION_MAX_OPERATIONS_V1 = 96 as const;

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
    ...M3_COMPOSITE_CAPABILITIES_V13,
    ...M3_LAYER_CONTROLS_CAPABILITIES_V16,
    ...M3_TEMPORAL_INTERPOLATION_CAPABILITIES_V17,
    ...M3_TEMPORAL_EASE_CAPABILITIES_V18,
    ...M3_MARKER_MOTION_CAPABILITIES_V20,
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

const assertCorrectionExecutionEnvelope = (
  plan: ExecutionPlan,
  normalOperationLimit: number,
  correctionOperationLimit: number,
): void => {
  if (plan.operations.length <= normalOperationLimit) return;
  if (plan.operations.length > correctionOperationLimit) {
    throw new Error(
      `CURRENT_AE_CORRECTION_OPERATION_LIMIT: plan contains ${plan.operations.length} operations; maximum correction envelope is ${correctionOperationLimit}.`,
    );
  }

  const operationBoundaryIds = plan.operations.map((operation) =>
    operation.rollbackBoundaryId === undefined || operation.rollbackBoundaryId === null
      ? null
      : String(operation.rollbackBoundaryId));
  const uniqueBoundaryIds = new Set(operationBoundaryIds.filter((value): value is string => value !== null));
  if (operationBoundaryIds.some((value) => value === null) || uniqueBoundaryIds.size !== 1) {
    throw new Error(
      "CURRENT_AE_CORRECTION_ROLLBACK_BOUNDARY_REQUIRED: oversized correction plans must use exactly one rollback boundary for every operation.",
    );
  }

  const [boundaryId] = [...uniqueBoundaryIds];
  const boundary = plan.rollbackBoundaries.find((candidate) => String(candidate.id) === boundaryId);
  if (boundary === undefined || boundary.strategy !== "RESTORE_SNAPSHOT") {
    throw new Error(
      "CURRENT_AE_CORRECTION_RESTORE_SNAPSHOT_REQUIRED: oversized correction plans require one RESTORE_SNAPSHOT rollback boundary.",
    );
  }
  if (plan.operations.some((operation) => operation.riskClass === "R4_EXTERNAL_UI")) {
    throw new Error(
      "CURRENT_AE_CORRECTION_EXTERNAL_UI_FORBIDDEN: oversized correction plans cannot contain external-UI operations.",
    );
  }
};

const observedForPlanValidation = (
  plan: ExecutionPlan,
  observed: ObservedProjectState,
): ObservedProjectState => {
  if (plan.projectRevision === observed.projectRevision) return observed;
  if (
    plan.projectFingerprint !== observed.projectFingerprint
    || plan.environmentFingerprint !== observed.environmentFingerprint
  ) return observed;
  return {
    ...observed,
    projectRevision: plan.projectRevision,
  };
};

const withPrefetchedInitialState = (
  host: AsyncTransactionalHost,
  observed: ObservedProjectState,
): AsyncTransactionalHost => {
  let pending: ObservedProjectState | null = structuredClone(observed);
  return {
    readState: async () => {
      if (pending !== null) {
        const state = pending;
        pending = null;
        return structuredClone(state);
      }
      return await host.readState();
    },
    captureRecoverySnapshot: async () => await host.captureRecoverySnapshot(),
    restoreRecoverySnapshot: async (snapshot, count) =>
      await host.restoreRecoverySnapshot(snapshot, count),
    apply: async (operation) => await host.apply(operation),
  };
};

export class CurrentAeTransactionRuntimeV1 {
  readonly transport: CurrentAeCepTransactionalTransportV1;
  readonly projectId: string;
  readonly maxOperations: number;
  readonly correctionMaxOperations: number;
  readonly stabilization: CurrentAeStabilizationRuntimeV1 | null;

  #executor: AsyncTransactionExecutor | null = null;
  #environmentFingerprint: EnvironmentFingerprint | null = null;
  #requestCounter = 0;

  constructor(
    transport: CurrentAeCepTransactionalTransportV1,
    projectId: string,
    maxOperations = CURRENT_AE_TRANSACTION_MAX_OPERATIONS_V1,
    stabilization: CurrentAeStabilizationRuntimeV1 | null = null,
    correctionMaxOperations = CURRENT_AE_CORRECTION_MAX_OPERATIONS_V1,
  ) {
    if (!Number.isInteger(maxOperations) || maxOperations < 1) {
      throw new TypeError("Current AE transaction maxOperations must be a positive integer.");
    }
    if (
      !Number.isInteger(correctionMaxOperations)
      || correctionMaxOperations < maxOperations
    ) {
      throw new TypeError(
        "Current AE correction maxOperations must be an integer greater than or equal to the normal transaction limit.",
      );
    }
    this.transport = transport;
    this.projectId = projectId;
    this.maxOperations = maxOperations;
    this.correctionMaxOperations = correctionMaxOperations;
    this.stabilization = stabilization;
  }

  async execute(planInput: unknown): Promise<ExecutionResult> {
    const plan = requireExecutionPlan(planInput);
    if (plan.operations.length > this.maxOperations) {
      throw new Error(
        `CURRENT_AE_TRANSACTION_OPERATION_LIMIT: plan contains ${plan.operations.length} operations; maximum is ${this.maxOperations}.`,
      );
    }
    return await this.#executePlan(plan);
  }

  async executeCorrection(planInput: unknown): Promise<ExecutionResult> {
    const plan = requireExecutionPlan(planInput);
    assertCorrectionExecutionEnvelope(
      plan,
      this.maxOperations,
      this.correctionMaxOperations,
    );
    return await this.#executePlan(plan);
  }

  async #executePlan(plan: ExecutionPlan): Promise<ExecutionResult> {
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

    const validationObserved = observedForPlanValidation(plan, observed);
    const executionHost = validationObserved.projectRevision === observed.projectRevision
      ? host
      : withPrefetchedInitialState(host, validationObserved);

    return await this.#executor.execute(plan, executionHost);
  }

  status(): Readonly<Record<string, unknown>> {
    return {
      phase: CURRENT_AE_TRANSACTION_RUNTIME_PHASE,
      projectId: this.projectId,
      maxOperations: this.maxOperations,
      correctionMaxOperations: this.correctionMaxOperations,
      environmentFingerprint: this.#environmentFingerprint,
      stabilization: {
        protocolV23Available: this.stabilization?.protocolV23Available ?? false,
        guardedVisualAvailable: Boolean(this.stabilization?.visualDriver),
      },
      recoveryLedgerEntries: this.#executor?.ledger.export().length ?? 0,
    };
  }
}
