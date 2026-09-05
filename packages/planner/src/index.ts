import {
  type CapabilityId,
  type ExecutionPlan,
  type ExecutionPlanOperation,
  type ObservedProjectState,
  type OperationId,
  type PlanHash,
  type RollbackBoundaryId,
} from "../../core-contracts/src/index.js";
import { type CapabilityRegistry } from "../../capability-registry/src/index.js";
import { computePlanHash } from "../../fingerprints/src/index.js";

export interface PlanValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly operationId?: OperationId;
  readonly capabilityId?: CapabilityId;
}

export class PlanValidationError extends Error {
  readonly issues: readonly PlanValidationIssue[];

  constructor(issues: readonly PlanValidationIssue[]) {
    super(issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n"));
    this.name = "PlanValidationError";
    this.issues = issues;
  }
}

export interface FrozenExecutionPlan {
  readonly plan: ExecutionPlan & { readonly planHash: PlanHash };
  readonly planHash: PlanHash;
  readonly topologicalOrder: readonly OperationId[];
}

const topologicalSort = (operations: readonly ExecutionPlanOperation[]): readonly OperationId[] => {
  const byId = new Map<OperationId, ExecutionPlanOperation>();
  const indegree = new Map<OperationId, number>();
  const dependents = new Map<OperationId, OperationId[]>();

  for (const operation of operations) {
    byId.set(operation.operationId, operation);
    indegree.set(operation.operationId, 0);
    dependents.set(operation.operationId, []);
  }

  for (const operation of operations) {
    for (const dependency of operation.dependsOn) {
      if (!byId.has(dependency)) {
        continue;
      }
      indegree.set(operation.operationId, (indegree.get(operation.operationId) ?? 0) + 1);
      dependents.get(dependency)?.push(operation.operationId);
    }
  }

  const queue = [...operations]
    .filter((operation) => (indegree.get(operation.operationId) ?? 0) === 0)
    .map((operation) => operation.operationId);
  const ordered: OperationId[] = [];

  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) {
      break;
    }
    ordered.push(next);
    for (const dependent of dependents.get(next) ?? []) {
      const remaining = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) {
        queue.push(dependent);
      }
    }
  }

  return ordered;
};

const freezeRecursively = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      freezeRecursively(child);
    }
    Object.freeze(value);
  }
  return value;
};

const validateBoundaryContiguity = (
  operationsById: ReadonlyMap<OperationId, ExecutionPlanOperation>,
  order: readonly OperationId[],
): readonly PlanValidationIssue[] => {
  const positions = new Map<RollbackBoundaryId, number[]>();
  order.forEach((operationId, index) => {
    const operation = operationsById.get(operationId);
    const boundaryId = operation?.rollbackBoundaryId;
    if (boundaryId !== undefined && boundaryId !== null) {
      const current = positions.get(boundaryId) ?? [];
      current.push(index);
      positions.set(boundaryId, current);
    }
  });

  const issues: PlanValidationIssue[] = [];
  for (const [boundaryId, indices] of positions) {
    const min = Math.min(...indices);
    const max = Math.max(...indices);
    if (max - min + 1 !== indices.length) {
      issues.push({
        code: "NON_CONTIGUOUS_ROLLBACK_BOUNDARY",
        message: `Rollback boundary '${boundaryId}' is not contiguous in dependency order.`,
      });
    }
  }
  return issues;
};

export const validateAndFreezeExecutionPlan = (
  plan: ExecutionPlan,
  observed: ObservedProjectState,
  registry: CapabilityRegistry,
): FrozenExecutionPlan => {
  const issues: PlanValidationIssue[] = [];

  if (plan.planRevision < 1 || !Number.isInteger(plan.planRevision)) {
    issues.push({ code: "INVALID_PLAN_REVISION", message: "Plan revision must be a positive integer." });
  }
  if (plan.projectRevision !== observed.projectRevision) {
    issues.push({
      code: "STALE_PROJECT_REVISION",
      message: `Expected project revision '${plan.projectRevision}' but observed '${observed.projectRevision}'.`,
    });
  }
  if (plan.projectFingerprint !== observed.projectFingerprint) {
    issues.push({
      code: "STALE_PROJECT_FINGERPRINT",
      message: "Observed project fingerprint does not match the frozen plan input state.",
    });
  }
  if (plan.environmentFingerprint !== observed.environmentFingerprint) {
    issues.push({
      code: "STALE_ENVIRONMENT_FINGERPRINT",
      message: "Observed environment fingerprint does not match the plan environment.",
    });
  }
  if (registry.environmentFingerprint !== observed.environmentFingerprint) {
    issues.push({
      code: "REGISTRY_ENVIRONMENT_MISMATCH",
      message: "Capability registry was generated for a different environment fingerprint.",
    });
  }

  const required = new Set<CapabilityId>();
  for (const capabilityId of plan.requiredCapabilities) {
    if (required.has(capabilityId)) {
      issues.push({
        code: "DUPLICATE_REQUIRED_CAPABILITY",
        message: `Capability '${capabilityId}' appears more than once in required_capabilities.`,
        capabilityId,
      });
    }
    required.add(capabilityId);
    try {
      registry.resolve(capabilityId);
    } catch (error) {
      issues.push({
        code: "CAPABILITY_UNAVAILABLE",
        message: error instanceof Error ? error.message : String(error),
        capabilityId,
      });
    }
  }

  const operationsById = new Map<OperationId, ExecutionPlanOperation>();
  for (const operation of plan.operations) {
    if (operationsById.has(operation.operationId)) {
      issues.push({
        code: "DUPLICATE_OPERATION_ID",
        message: `Operation '${operation.operationId}' is declared more than once.`,
        operationId: operation.operationId,
      });
      continue;
    }
    operationsById.set(operation.operationId, operation);
    if (!required.has(operation.capabilityId)) {
      issues.push({
        code: "UNDECLARED_OPERATION_CAPABILITY",
        message: `Operation '${operation.operationId}' uses capability '${operation.capabilityId}' without declaring it as required.`,
        operationId: operation.operationId,
        capabilityId: operation.capabilityId,
      });
    }
    try {
      registry.assertRouteAvailable(operation.capabilityId, operation.routeId);
    } catch (error) {
      issues.push({
        code: "ROUTE_UNAVAILABLE",
        message: error instanceof Error ? error.message : String(error),
        operationId: operation.operationId,
        capabilityId: operation.capabilityId,
      });
    }
  }

  for (const operation of plan.operations) {
    for (const dependency of operation.dependsOn) {
      if (!operationsById.has(dependency)) {
        issues.push({
          code: "UNKNOWN_OPERATION_DEPENDENCY",
          message: `Operation '${operation.operationId}' depends on missing operation '${dependency}'.`,
          operationId: operation.operationId,
        });
      }
      if (dependency === operation.operationId) {
        issues.push({
          code: "SELF_DEPENDENCY",
          message: `Operation '${operation.operationId}' cannot depend on itself.`,
          operationId: operation.operationId,
        });
      }
    }
  }

  const boundaryIds = new Set(plan.rollbackBoundaries.map((boundary) => boundary.id));
  for (const operation of plan.operations) {
    const boundaryId = operation.rollbackBoundaryId;
    if (boundaryId !== undefined && boundaryId !== null && !boundaryIds.has(boundaryId)) {
      issues.push({
        code: "UNKNOWN_ROLLBACK_BOUNDARY",
        message: `Operation '${operation.operationId}' references missing rollback boundary '${boundaryId}'.`,
        operationId: operation.operationId,
      });
    }
  }

  for (const checkpoint of plan.checkpoints) {
    for (const operationId of checkpoint.afterOperationIds) {
      if (!operationsById.has(operationId)) {
        issues.push({
          code: "UNKNOWN_CHECKPOINT_OPERATION",
          message: `Checkpoint '${checkpoint.checkpointId}' references missing operation '${operationId}'.`,
        });
      }
    }
  }

  const topologicalOrder = topologicalSort(plan.operations);
  if (topologicalOrder.length !== operationsById.size) {
    issues.push({ code: "CYCLIC_OPERATION_GRAPH", message: "Execution plan contains a cyclic operation dependency." });
  } else {
    issues.push(...validateBoundaryContiguity(operationsById, topologicalOrder));
  }

  if (issues.length > 0) {
    throw new PlanValidationError(issues);
  }

  const planWithoutHash = structuredClone(plan) as ExecutionPlan;
  if ("planHash" in planWithoutHash) {
    delete (planWithoutHash as { planHash?: PlanHash | null }).planHash;
  }
  const planHash = computePlanHash(planWithoutHash);
  const frozen = structuredClone({ ...planWithoutHash, planHash }) as ExecutionPlan & { readonly planHash: PlanHash };
  freezeRecursively(frozen);

  return { plan: frozen, planHash, topologicalOrder: Object.freeze([...topologicalOrder]) };
};
