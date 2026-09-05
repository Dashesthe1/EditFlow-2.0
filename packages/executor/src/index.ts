import { randomUUID } from "node:crypto";
import {
  asProjectRevision,
  asTransactionId,
  type ExecutionPlan,
  type ExecutionPlanOperation,
  type GroupState,
  type ObservedProjectState,
  type OperationId,
  type OperationOutcome,
  type PlanHash,
  type TransactionId,
  type TransactionState,
} from "../../core-contracts/src/index.js";
import { type CapabilityRegistry } from "../../capability-registry/src/index.js";
import {
  canonicalStringify,
  computePlanHash,
  computeProjectFingerprint,
} from "../../fingerprints/src/index.js";
import {
  validateAndFreezeExecutionPlan,
  type FrozenExecutionPlan,
} from "../../planner/src/index.js";

export interface HostApplyResult {
  readonly outcome: OperationOutcome;
  readonly readback?: Readonly<Record<string, unknown>>;
}

export interface TransactionalHost {
  readState(): ObservedProjectState;
  captureRecoverySnapshot(): unknown;
  restoreRecoverySnapshot(snapshot: unknown): void;
  apply(operation: ExecutionPlanOperation): HostApplyResult;
}

export interface OperationLedgerEntry {
  operationId: OperationId;
  outcome: OperationOutcome;
  attempt: number;
}

export interface TransactionGroupRecord {
  groupId: string;
  rollbackBoundaryId: string | null;
  rollbackStrategy: string;
  state: GroupState;
  beforeState: ObservedProjectState;
  beforeRecoverySnapshot: unknown;
  afterState?: ObservedProjectState;
  operations: OperationLedgerEntry[];
  error?: string;
}

export interface TransactionRecord {
  transactionId: TransactionId;
  planHash: PlanHash;
  planId: string;
  planRevision: number;
  state: TransactionState;
  initialState: ObservedProjectState;
  groups: TransactionGroupRecord[];
  createdAt: string;
  updatedAt: string;
  finalState?: ObservedProjectState;
  error?: string;
}

export class InMemoryTransactionLedger {
  #records = new Map<PlanHash, TransactionRecord>();

  constructor(seed: readonly TransactionRecord[] = []) {
    for (const record of seed) {
      this.#records.set(record.planHash, structuredClone(record));
    }
  }

  getByPlanHash(planHash: PlanHash): TransactionRecord | null {
    const record = this.#records.get(planHash);
    return record === undefined ? null : structuredClone(record);
  }

  save(record: TransactionRecord): void {
    this.#records.set(record.planHash, structuredClone(record));
  }

  export(): readonly TransactionRecord[] {
    return [...this.#records.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((record) => structuredClone(record));
  }
}

interface PlannedGroup {
  readonly groupId: string;
  readonly rollbackBoundaryId: string | null;
  readonly rollbackStrategy: string;
  readonly operations: readonly ExecutionPlanOperation[];
}

export interface ExecuteOptions {
  readonly stopAfterCommittedGroups?: number;
}

export interface ExecutionResult {
  readonly transactionId: TransactionId;
  readonly planHash: PlanHash;
  readonly state: TransactionState;
  readonly recovered: boolean;
  readonly committedGroups: number;
  readonly appliedOperations: number;
  readonly finalState: ObservedProjectState;
  readonly error?: string;
}

export class TransactionRecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransactionRecoveryError";
  }
}

const stripPlanHash = (plan: ExecutionPlan): ExecutionPlan => {
  const copy = structuredClone(plan) as ExecutionPlan;
  if ("planHash" in copy) {
    delete (copy as { planHash?: PlanHash | null }).planHash;
  }
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
  const boundariesById = new Map(
    frozen.plan.rollbackBoundaries.map((boundary) => [String(boundary.id), boundary]),
  );
  const groups: Array<{
    groupId: string;
    rollbackBoundaryId: string | null;
    rollbackStrategy: string;
    operations: ExecutionPlanOperation[];
  }> = [];

  for (const operationId of frozen.topologicalOrder) {
    const operation = operationsById.get(operationId);
    if (operation === undefined) {
      throw new Error(`Frozen plan lost operation '${operationId}'.`);
    }
    const boundaryId = operation.rollbackBoundaryId === undefined || operation.rollbackBoundaryId === null
      ? null
      : String(operation.rollbackBoundaryId);
    const groupId = boundaryId ?? `operation:${operation.operationId}`;
    const previous = groups.at(-1);
    if (previous !== undefined && previous.groupId === groupId) {
      previous.operations.push(operation);
      continue;
    }
    const rollbackStrategy = boundaryId === null
      ? "RESTORE_SNAPSHOT"
      : boundariesById.get(boundaryId)?.strategy ?? "RESTORE_SNAPSHOT";
    groups.push({ groupId, rollbackBoundaryId: boundaryId, rollbackStrategy, operations: [operation] });
  }

  return groups;
};

const lastCommittedState = (record: TransactionRecord): ObservedProjectState => {
  for (let index = record.groups.length - 1; index >= 0; index -= 1) {
    const group = record.groups[index];
    if (group?.state === "COMMITTED" && group.afterState !== undefined) {
      return group.afterState;
    }
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

export class TransactionExecutor {
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

  execute(plan: ExecutionPlan, host: TransactionalHost, options: ExecuteOptions = {}): ExecutionResult {
    const candidateHash = hashPlan(plan);
    const observed = host.readState();
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
      if (frozen.planHash !== record.planHash) {
        throw new TransactionRecoveryError("Plan hash changed while recovering an existing transaction.");
      }
      const expectedResumeState = record.state === "COMMITTED" && record.finalState !== undefined
        ? record.finalState
        : lastCommittedState(record);
      if (!sameObservedState(observed, expectedResumeState)) {
        throw new TransactionRecoveryError(
          "Current project state does not match the last committed transaction boundary; refusing stale recovery.",
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
      if (plannedGroup === undefined) {
        break;
      }
      const beforeState = host.readState();
      const beforeRecoverySnapshot = host.captureRecoverySnapshot();
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

      try {
        for (const operation of plannedGroup.operations) {
          const result = host.apply(operation);
          groupRecord.operations.push({
            operationId: operation.operationId,
            outcome: result.outcome,
            attempt: 1,
          });
          record.updatedAt = this.clock();
          this.ledger.save(record);
        }
        groupRecord.afterState = structuredClone(host.readState());
        groupRecord.state = "COMMITTED";
        record.updatedAt = this.clock();
        this.ledger.save(record);
        newlyCommitted += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        try {
          host.restoreRecoverySnapshot(beforeRecoverySnapshot);
          const restored = host.readState();
          if (!sameObservedState(restored, beforeState)) {
            throw new Error("Recovery snapshot did not restore the exact pre-group observed state.");
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
            finalState: structuredClone(host.readState()),
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
          finalState: structuredClone(host.readState()),
        };
      }
    }

    record.state = "COMMITTED";
    record.finalState = structuredClone(host.readState());
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

interface SimulatedRecoverySnapshot {
  readonly revisionNumber: number;
  readonly data: Readonly<Record<string, unknown>>;
}

export class SimulatedProjectHost implements TransactionalHost {
  readonly projectId: string;
  readonly environmentFingerprint: ObservedProjectState["environmentFingerprint"];
  #revisionNumber = 0;
  #data: Record<string, unknown>;

  constructor(
    projectId: string,
    environmentFingerprint: ObservedProjectState["environmentFingerprint"],
    initialData: Readonly<Record<string, unknown>> = {},
  ) {
    this.projectId = projectId;
    this.environmentFingerprint = environmentFingerprint;
    this.#data = structuredClone(initialData);
  }

  readState(): ObservedProjectState {
    return {
      projectId: this.projectId,
      projectRevision: asProjectRevision(`sim-rev-${this.#revisionNumber}`),
      projectFingerprint: computeProjectFingerprint({ projectId: this.projectId, data: this.#data }),
      environmentFingerprint: this.environmentFingerprint,
    };
  }

  inspectData(): Readonly<Record<string, unknown>> {
    return structuredClone(this.#data);
  }

  captureRecoverySnapshot(): SimulatedRecoverySnapshot {
    return {
      revisionNumber: this.#revisionNumber,
      data: structuredClone(this.#data),
    };
  }

  restoreRecoverySnapshot(snapshot: unknown): void {
    if (
      snapshot === null
      || typeof snapshot !== "object"
      || typeof (snapshot as { revisionNumber?: unknown }).revisionNumber !== "number"
      || (snapshot as { data?: unknown }).data === null
      || typeof (snapshot as { data?: unknown }).data !== "object"
      || Array.isArray((snapshot as { data?: unknown }).data)
    ) {
      throw new TypeError("Invalid simulated recovery snapshot.");
    }
    const typed = snapshot as { revisionNumber: number; data: Record<string, unknown> };
    this.#revisionNumber = typed.revisionNumber;
    this.#data = structuredClone(typed.data);
  }

  apply(operation: ExecutionPlanOperation): HostApplyResult {
    const action = operation.input["action"];
    if (action === "fail") {
      const message = operation.input["message"];
      throw new Error(typeof message === "string" ? message : "Simulated host failure.");
    }

    const key = operation.input["key"];
    if (typeof key !== "string" || key.length === 0) {
      throw new TypeError(`Simulated operation '${operation.operationId}' requires a non-empty string key.`);
    }

    if (action === "set") {
      const value = operation.input["value"];
      const hasExisting = Object.hasOwn(this.#data, key);
      if (hasExisting && canonicalStringify(this.#data[key]) === canonicalStringify(value)) {
        return { outcome: "NO_OP", readback: { key, value: structuredClone(value) } };
      }
      this.#data[key] = structuredClone(value);
      this.#revisionNumber += 1;
      return { outcome: "APPLIED", readback: { key, value: structuredClone(value) } };
    }

    if (action === "increment") {
      const by = operation.input["by"] ?? 1;
      if (typeof by !== "number" || !Number.isFinite(by)) {
        throw new TypeError("Simulated increment requires a finite numeric 'by' value.");
      }
      const current = this.#data[key] ?? 0;
      if (typeof current !== "number" || !Number.isFinite(current)) {
        throw new TypeError(`Simulated key '${key}' is not numeric.`);
      }
      const value = current + by;
      this.#data[key] = value;
      this.#revisionNumber += 1;
      return { outcome: "APPLIED", readback: { key, value } };
    }

    if (action === "delete") {
      if (!Object.hasOwn(this.#data, key)) {
        return { outcome: "NO_OP", readback: { key, deleted: false } };
      }
      delete this.#data[key];
      this.#revisionNumber += 1;
      return { outcome: "APPLIED", readback: { key, deleted: true } };
    }

    throw new TypeError(`Unsupported simulated action '${String(action)}'.`);
  }
}
