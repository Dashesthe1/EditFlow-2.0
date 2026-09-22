import type {
  ExecutionPlan,
  ExecutionPlanOperation,
  ObservedProjectState,
  RiskClass,
} from "../../../packages/core-contracts/src/index.js";
import {
  asCapabilityId,
  asOperationId,
  asPlanId,
  asRollbackBoundaryId,
  asRouteId,
} from "../../../packages/core-contracts/src/index.js";
import {
  AeCepCurrentTransactionalHostV1,
  type CurrentAeCepTransactionalTransportV1,
} from "../../../packages/adapters/ae-cep/src/current-transactional-host.js";
import {
  AeFilesystemPolicyV11,
} from "../../../packages/adapters/ae-cep/src/v1_1.js";
import {
  AE_ADAPTER_ROUTE_ID_V11,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";
import {
  AE_LAYER_CONTROLS_ROUTE_ID_V16,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_6.js";
import type {
  PracticeAeBaselineBatchRunnerV1,
  PracticeAeBaselineCommandV1,
  PracticeAeBaselinePlanV1,
} from "../../../packages/practice-homework/src/ae-baseline.js";
import { CurrentAeTransactionRuntimeV1 } from "./current-ae-transaction-runtime.js";
const routeForCommand = (
  command: PracticeAeBaselineCommandV1,
): string => command === "layer.switches.set"
  ? AE_LAYER_CONTROLS_ROUTE_ID_V16
  : AE_ADAPTER_ROUTE_ID_V11;

const riskForCommand = (
  command: PracticeAeBaselineCommandV1,
): RiskClass => command === "layer.set_timing"
  || command === "layer.switches.set"
  ? "R1_REVERSIBLE"
  : "R2_STRUCTURAL";

const uniqueCapabilities = (
  plan: PracticeAeBaselinePlanV1,
) => [...new Set(plan.operations.map((operation) => operation.capabilityId))]
  .map(asCapabilityId);

export const compilePracticeAeBaselineExecutionPlanV1 = (
  plan: PracticeAeBaselinePlanV1,
  observed: ObservedProjectState,
): ExecutionPlan => {
  if (plan.operations.length === 0) {
    throw new TypeError("Practice AE baseline plan must contain at least one operation.");
  }
  const rollbackBoundaryId = asRollbackBoundaryId(
    `${plan.baselineId}:rollback`,
  );
  const operations: ExecutionPlanOperation[] = plan.operations.map(
    (operation, index) => ({
      operationId: asOperationId(operation.operationId),
      capabilityId: asCapabilityId(operation.capabilityId),
      routeId: asRouteId(routeForCommand(operation.command)),
      dependsOn: index === 0
        ? []
        : [asOperationId(plan.operations[index - 1]?.operationId ?? "")],
      idempotency: "CHECK_THEN_APPLY",
      riskClass: riskForCommand(operation.command),
      input: {
        command: operation.command,
        payload: operation.payload,
        readbackProfile: "PRACTICE_BASELINE_STRUCTURAL",
      },
      rollbackBoundaryId,
    }),
  );
  const finalOperation = operations.at(-1);
  if (finalOperation === undefined) {
    throw new TypeError("Practice AE baseline execution plan lost its final operation.");
  }

  return {
    planId: asPlanId(`practice-ae:${plan.baselineId}`),
    planRevision: 1,
    projectRevision: observed.projectRevision,
    projectFingerprint: observed.projectFingerprint,
    environmentFingerprint: observed.environmentFingerprint,
    creativeObjective:
      "Construct the exact source-matched Practice baseline in After Effects.",
    recipeRefs: [
      plan.schema,
      `practice-reference:${plan.referenceId}`,
      ...plan.evidenceRefs,
    ],
    requiredCapabilities: uniqueCapabilities(plan),
    bindings: [],
    operations,
    checkpoints: [{
      checkpointId: `${plan.baselineId}:structural`,
      afterOperationIds: [finalOperation.operationId],
      kind: "STRUCTURAL",
      profile: "PRACTICE_BASELINE_STRUCTURAL",
    }],
    invariants: {
      structural: [{
        baselineId: plan.baselineId,
        compStableId: plan.compStableId,
        expectedDurationMs: plan.durationMs,
        expectedFrameRate: plan.frameRate,
        audioMatchId: plan.audioMatchId,
      }],
      visual: [],
    },
    rollbackBoundaries: [{
      id: rollbackBoundaryId,
      strategy: "RESTORE_SNAPSHOT",
      notes: "Practice baseline construction is one atomic AE transaction.",
    }],
  };
};
export class PracticeCurrentAeBaselineRunnerV1
implements PracticeAeBaselineBatchRunnerV1 {
  readonly runtime: CurrentAeTransactionRuntimeV1;
  #observationCounter = 0;

  constructor(runtime: CurrentAeTransactionRuntimeV1) {
    this.runtime = runtime;
  }

  async executePlan(plan: PracticeAeBaselinePlanV1): Promise<{
    readonly evidenceRefs: readonly string[];
  }> {
    if (plan.operations.length > this.runtime.maxOperations) {
      throw new Error(
        `PRACTICE_BASELINE_TRANSACTION_LIMIT: plan contains ${plan.operations.length} `
        + `operations; current atomic limit is ${this.runtime.maxOperations}.`,
      );
    }

    const observationId = ++this.#observationCounter;
    const observer = new AeCepCurrentTransactionalHostV1(
      this.runtime.transport,
      this.runtime.projectId,
      `practice-baseline-observe:${plan.baselineId}:${observationId}`,
      () => `practice-baseline-observe-request:${observationId}`,
    );
    const observed = await observer.readState();
    const executionPlan = compilePracticeAeBaselineExecutionPlanV1(
      plan,
      observed,
    );
    const result = await this.runtime.execute(executionPlan);
    if (result.state !== "COMMITTED") {
      throw new Error(
        `PRACTICE_BASELINE_TRANSACTION_${result.state}: `
        + `applied ${result.appliedOperations} operations and recovered=${result.recovered}.`,
      );
    }

    return {
      evidenceRefs: [
        `practice-ae-transaction:${String(executionPlan.planId)}:COMMITTED`,
        `practice-ae-transaction-applied:${result.appliedOperations}`,
        `practice-ae-transaction-recovered:${String(result.recovered)}`,
      ],
    };
  }
}


export const createPracticeCurrentAeBaselineRunnerV1 = (input: {
  readonly transport: CurrentAeCepTransactionalTransportV1;
  readonly projectId: string;
  readonly mediaRoots: readonly string[];
}): PracticeCurrentAeBaselineRunnerV1 => {
  if (input.mediaRoots.length === 0) {
    throw new TypeError(
      "Practice current-AE baseline runner requires at least one allowed media root.",
    );
  }
  return new PracticeCurrentAeBaselineRunnerV1(
    new CurrentAeTransactionRuntimeV1(
      input.transport,
      input.projectId,
      undefined,
      null,
      undefined,
      new AeFilesystemPolicyV11(input.mediaRoots),
    ),
  );
};
