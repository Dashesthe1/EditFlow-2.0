import { randomUUID } from "node:crypto";
import {
  asTransactionId,
  type ExecutionPlan,
  type ExecutionPlanOperation,
  type ObservedProjectState,
  type OperationOutcome,
  type PlanHash,
  type TransactionId,
  type TransactionState,
} from "../../core-contracts/src/index.js";
import type { CapabilityRegistry } from "../../capability-registry/src/index.js";
import { computePlanHash } from "../../fingerprints/src/index.js";
import { validateAndFreezeExecutionPlan, type FrozenExecutionPlan } from "../../planner/src/index.js";
import {
  InMemoryTransactionLedger,
  type ExecutionResult,
  type ExecuteOptions,
  type HostApplyResult,
  type TransactionGroupRecord,
  type TransactionRecord,
  TransactionRecoveryError,
} from "./index.js";

export interface AsyncTransactionalHost {
  readState(): Promise<ObservedProjectState>;
  captureRecoverySnapshot(): Promise<unknown>;
  restoreRecoverySnapshot(snapshot: unknown, appliedOperationCount: number): Promise<void>;
  apply(operation: ExecutionPlanOperation): Promise<HostApplyResult>;
}

interface PlannedGroup {
  readonly groupId: string;
  readonly rollbackBoundaryId: string | null;
  readonly rollbackStrategy: string;
  readonly operations: readonly ExecutionPlanOperation[];
}

const stripPlanHash = (plan: ExecutionPlan): ExecutionPlan => {
  const copy = structuredClone(plan) as ExecutionPlan;
  if ("planHash" in copy) delete (copy as { planHash?: PlanHash | null }).planHash;
  return copy;
};

const hashPlan = (plan: ExecutionPlan): PlanHash => computePlanHash(stripPlanHash(plan));

const sameObservedState = (left: ObservedProjectState, right: ObservedProjectState): boolean =>
  left.projectRevision === right.projectRevision
  && left.projectFingerprint === right.projectFingerprint
  && left.environmentFingerprint === right.environmentFingerprint
  && left.projectId === right.projectId;

const buildGroups = (frozen: FrozenExecutionPlan): readonly PlannedGroup[] => {
  const operationsById = new Map(frozen.plan.operations.map((operation) => [operation.operationId, operation]));
  const boundariesById = new Map(frozen.plan.rollbackBoundaries.map((boundary) => [String(boundary.id), boundary]));
  const groups: Array<{
    groupId: string;
    rollbackBoundaryId: string | null;
    rollbackStrategy: string;
    operations: ExecutionPlanOperation[];
  }> = [];

  for (const operationId of frozen.topologicalOrder) {
    const operation = operationsById.get(operationId);
    if (operation === undefined) throw new Error(`Frozen plan lost operation '${operationId}'.`);
    const boundaryId = operation.rollbackBoundaryId === undefined || operation.rollbackBoundaryId === null
      ? null
      : String(operation.rollbackBoundaryId);
    const groupId = boundaryId ?? `operation:${operation.operationId}`;
    const previous = groups.at(-1);
    if (previous !== undefined && previous.groupId === groupId) {
      previous.operations.push(operation);
      continue;
    }
    groups.push({
      groupId,
      rollbackBoundaryId: boundaryId,
      rollbackStrategy: boundaryId === null
        ? "RESTORE_SNAPSHOT"
        : boundariesById.get(boundaryId)?.strategy ?? "RESTORE_SNAPSHOT",
      operations: [operation],
    });
  }
  return groups;
};

const lastCommittedState = (record: TransactionRecord): ObservedProjectState => {
  for (let index = record.groups.length - 1; index >= 0; index -= 1) {
    const group = record.groups[index];
    if (group?.state === "COMMITTED" && group.afterState !== undefined) return group.afterState;
  }
  return record.initialState;
};

const committedGroupCount = (record: TransactionRecord): number =>
  record.groups.filter((group) => group.state === "COMMITTED").length;

const appliedOperationCount = (record: TransactionRecord): number =>
  record.groups.reduce(
    (sum, group) => sum + group.operations.filter((entry) => entry.outcome === "APPLIED").length,
    0,
  );

export class AsyncTransactionExecutor {
  readonly registry: CapabilityRegistry;
  readonly ledger: InMemoryTransactionLedger;
  readonly idFactory: () => TransactionId;
  readonly clock: () => string;

  constructor(
    registry: CapabilityRegistry,
    ledger = new InMemoryTransactionLedger(),
    idFactory: () => TransactionId = () => asTransactionId(randomUUID()),
    clock: () => string = () => new Date().toISOString(),
  ) {
    this.registry = registry;
    this.ledger = ledger;
    this.idFactory = idFactory;
    this.clock = clock;
  }

  async execute(plan: ExecutionPlan, host: AsyncTransactionalHost, options: ExecuteOptions = {}): Promise<ExecutionResult> {
    const candidateHash = hashPlan(plan);
    const observed = await host.readState();
    let record = this.ledger.getByPlanHash(candidateHash);
    let recovered = record !== null;
    let frozen: FrozenExecutionPlan;

    if (record === null || record.state === "ROLLED_BACK" || record.state === "FAILED" || record.state === "REJECTED") {
      frozen = validateAndFreezeExecutionPlan(plan, observed, this.registry);
      const now = this.clock();
      record = {
        transactionId: this.idFactory(),
        planHash: frozen.planHash,
        planId: String(frozen.plan.planId),
        planRevision: frozen.plan.planRevision,
        state: "FROZEN",
        initialState: structuredClone(observed),
        groups: [],
        createdAt: now,
        updatedAt: now,
      };
      recovered = false;
      this.ledger.save(record);
    } else {
      frozen = validateAndFreezeExecutionPlan(plan, record.initialState, this.registry);
      if (frozen.planHash !== record.planHash) throw new TransactionRecoveryError("Plan hash changed during recovery.");
      const expectedResumeState = record.state === "COMMITTED" && record.finalState !== undefined
        ? record.finalState
        : lastCommittedState(record);
      if (!sameObservedState(observed, expectedResumeState)) {
        throw new TransactionRecoveryError(
          "Current project state does not match the last committed async transaction boundary; refusing stale recovery.",
        );
      }
      if (record.state === "COMMITTED") {
        return {
          transactionId: record.transactionId,
          planHash: record.planHash,
          state: record.state,
          recovered: true,
          committedGroups: committedGroupCount(record),
          appliedOperations: appliedOperationCount(record),
          finalState: structuredClone(observed),
        };
      }
    }

    const groups = buildGroups(frozen);
    const alreadyCommitted = committedGroupCount(record);
    record.state = "EXECUTING";
    record.updatedAt = this.clock();
    this.ledger.save(record);

    let newlyCommitted = 0;
    for (let groupIndex = alreadyCommitted; groupIndex < groups.length; groupIndex += 1) {
      const plannedGroup = groups[groupIndex];
      if (plannedGroup === undefined) break;
      const beforeState = await host.readState();
      const beforeRecoverySnapshot = await host.captureRecoverySnapshot();
      const groupRecord: TransactionGroupRecord = {
        groupId: plannedGroup.groupId,
        rollbackBoundaryId: plannedGroup.rollbackBoundaryId,
        rollbackStrategy: plannedGroup.rollbackStrategy,
        state: "EXECUTING",
        beforeState: structuredClone(beforeState),
        beforeRecoverySnapshot: structuredClone(beforeRecoverySnapshot),
        operations: [],
      };
      record.groups.push(groupRecord);
      record.updatedAt = this.clock();
      this.ledger.save(record);

      let appliedInGroup = 0;
      try {
        for (const operation of plannedGroup.operations) {
          const result = await host.apply(operation);
          groupRecord.operations.push({ operationId: operation.operationId, outcome: result.outcome, attempt: 1 });
          if (result.outcome === "APPLIED") appliedInGroup += 1;
          record.updatedAt = this.clock();
          this.ledger.save(record);
        }
        groupRecord.afterState = structuredClone(await host.readState());
        groupRecord.state = "COMMITTED";
        record.updatedAt = this.clock();
        this.ledger.save(record);
        newlyCommitted += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        try {
          await host.restoreRecoverySnapshot(beforeRecoverySnapshot, appliedInGroup);
          const restored = await host.readState();
          if (!sameObservedState(restored, beforeState)) {
            throw new Error("Async recovery did not restore the exact pre-group observed state.");
          }
          groupRecord.state = "ROLLED_BACK";
          groupRecord.error = message;
          record.state = "ROLLED_BACK";
          record.error = message;
          record.updatedAt = this.clock();
          this.ledger.save(record);
          return {
            transactionId: record.transactionId,
            planHash: record.planHash,
            state: record.state,
            recovered,
            committedGroups: committedGroupCount(record),
            appliedOperations: appliedOperationCount(record),
            finalState: structuredClone(restored),
            error: message,
          };
        } catch (rollbackError) {
          const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
          groupRecord.state = "RECOVERY_REQUIRED";
          groupRecord.error = `${message}; rollback failed: ${rollbackMessage}`;
          record.state = "RECOVERY_REQUIRED";
          record.error = groupRecord.error;
          record.updatedAt = this.clock();
          this.ledger.save(record);
          return {
            transactionId: record.transactionId,
            planHash: record.planHash,
            state: record.state,
            recovered,
            committedGroups: committedGroupCount(record),
            appliedOperations: appliedOperationCount(record),
            finalState: structuredClone(await host.readState()),
            error: record.error,
          };
        }
      }

      if (
        options.stopAfterCommittedGroups !== undefined
        && newlyCommitted >= options.stopAfterCommittedGroups
        && groupIndex < groups.length - 1
      ) {
        record.state = "EXECUTING";
        record.updatedAt = this.clock();
        this.ledger.save(record);
        return {
          transactionId: record.transactionId,
          planHash: record.planHash,
          state: record.state,
          recovered,
          committedGroups: committedGroupCount(record),
          appliedOperations: appliedOperationCount(record),
          finalState: structuredClone(await host.readState()),
        };
      }
    }

    record.state = "COMMITTED";
    record.finalState = structuredClone(await host.readState());
    record.updatedAt = this.clock();
    this.ledger.save(record);
    return {
      transactionId: record.transactionId,
      planHash: record.planHash,
      state: record.state,
      recovered,
      committedGroups: committedGroupCount(record),
      appliedOperations: appliedOperationCount(record),
      finalState: structuredClone(record.finalState),
    };
  }
}

export class AsyncSimulatedHost implements AsyncTransactionalHost {
  readonly syncHost: {
    readState(): ObservedProjectState;
    captureRecoverySnapshot(): unknown;
    restoreRecoverySnapshot(snapshot: unknown): void;
    apply(operation: ExecutionPlanOperation): HostApplyResult;
  };

  constructor(syncHost: AsyncSimulatedHost["syncHost"]) {
    this.syncHost = syncHost;
  }

  async readState(): Promise<ObservedProjectState> { return this.syncHost.readState(); }
  async captureRecoverySnapshot(): Promise<unknown> { return this.syncHost.captureRecoverySnapshot(); }
  async restoreRecoverySnapshot(snapshot: unknown, _appliedOperationCount: number): Promise<void> {
    this.syncHost.restoreRecoverySnapshot(snapshot);
  }
  async apply(operation: ExecutionPlanOperation): Promise<HostApplyResult> { return this.syncHost.apply(operation); }
}
