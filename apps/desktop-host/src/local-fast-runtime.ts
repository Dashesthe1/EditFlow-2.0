import { performance } from "node:perf_hooks";

import type { AeCepAdapterClientV11 } from "../../../packages/adapters/ae-cep/src/v1_1.js";
import type { ReflexGoal } from "../../../packages/reflex-planner/src/index.js";
import type { RoutineIntent } from "../../../packages/routine-decision-engine/src/index.js";
import { createDesktopAeSessionV11, type DesktopAeSessionV11 } from "./v1_1.js";

export const LOCAL_FAST_RUNTIME_VERSION = "1.0.0" as const;
export const DEFAULT_LOCAL_FAST_BATCH_ACTIONS = 64;
export const DEFAULT_LOCAL_FAST_TOTAL_BUDGET_MS = 30_000;
export const DEFAULT_LOCAL_FAST_ACTION_BUDGET_MS = 1_000;

export interface LocalFastRuntimeOptionsV1 {
  readonly projectId?: string;
  readonly maxBatchActions?: number;
  readonly totalBudgetMs?: number;
  readonly actionBudgetMs?: number;
  readonly leaseTtlMs?: number;
  readonly clock?: () => number;
}

export interface LocalFastRuntimeStatusV1 {
  readonly version: typeof LOCAL_FAST_RUNTIME_VERSION;
  readonly architecture: "MCP_TO_LOCAL_RUNTIME_TO_AE";
  readonly execution: "PERSISTENT_WARM_CEP_BATCHED_ROUTINE";
  readonly maxBatchActions: number;
  readonly totalBudgetMs: number;
  readonly actionBudgetMs: number;
  readonly hostRevision: number;
}
export interface LocalFastBatchResultV1 {
  readonly runtime: typeof LOCAL_FAST_RUNTIME_VERSION;
  readonly transactionId: string;
  readonly requestedActions: number;
  readonly completedActions: number;
  readonly route: "LOCAL" | "ESCALATE";
  readonly planningMs: number;
  readonly actionMs: number;
  readonly actionTimingsMs: readonly number[];
  readonly dispatchTimingsMs: readonly number[];
  readonly meanActionMs: number;
  readonly maxActionMs: number;
  readonly totalMs: number;
  readonly withinBudget: boolean;
  readonly escalationReason: string | null;
  readonly hostRevision: number;
}

const positiveInteger = (value: number, name: string): number => {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer.`);
  return value;
};

export class LocalFastRuntimeV1 {
  readonly session: DesktopAeSessionV11;
  readonly projectId: string;
  readonly maxBatchActions: number;
  readonly totalBudgetMs: number;
  readonly actionBudgetMs: number;
  readonly clock: () => number;

  private constructor(session: DesktopAeSessionV11, options: Required<Omit<LocalFastRuntimeOptionsV1, "clock">> & { clock: () => number }) {
    this.session = session;
    this.projectId = options.projectId;
    this.maxBatchActions = options.maxBatchActions;
    this.totalBudgetMs = options.totalBudgetMs;
    this.actionBudgetMs = options.actionBudgetMs;
    this.clock = options.clock;
  }

  static async create(client: AeCepAdapterClientV11, options: LocalFastRuntimeOptionsV1 = {}): Promise<LocalFastRuntimeV1> {
    const resolved = {
      projectId: options.projectId ?? "after-effects-project",
      maxBatchActions: positiveInteger(options.maxBatchActions ?? DEFAULT_LOCAL_FAST_BATCH_ACTIONS, "maxBatchActions"),
      totalBudgetMs: positiveInteger(options.totalBudgetMs ?? DEFAULT_LOCAL_FAST_TOTAL_BUDGET_MS, "totalBudgetMs"),
      actionBudgetMs: positiveInteger(options.actionBudgetMs ?? DEFAULT_LOCAL_FAST_ACTION_BUDGET_MS, "actionBudgetMs"),
      leaseTtlMs: positiveInteger(options.leaseTtlMs ?? 120_000, "leaseTtlMs"),
      clock: options.clock ?? (() => performance.now()),
    };
    const session = await createDesktopAeSessionV11(client, resolved.projectId, {
      runner: {
        maxActions: resolved.maxBatchActions,
        budgetMs: resolved.totalBudgetMs,
        actionBudgetMs: resolved.actionBudgetMs,
        leaseTtlMs: resolved.leaseTtlMs,
        clock: resolved.clock,
      },
    });
    return new LocalFastRuntimeV1(session, resolved);
  }

  status(): LocalFastRuntimeStatusV1 {
    return {
      version: LOCAL_FAST_RUNTIME_VERSION,
      architecture: "MCP_TO_LOCAL_RUNTIME_TO_AE",
      execution: "PERSISTENT_WARM_CEP_BATCHED_ROUTINE",
      maxBatchActions: this.maxBatchActions,
      totalBudgetMs: this.totalBudgetMs,
      actionBudgetMs: this.actionBudgetMs,
      hostRevision: this.session.runner.hostRevision,
    };
  }

  async runGoal(goal: ReflexGoal, transactionId: string) {
    return await this.session.runner.run(goal, transactionId);
  }

  async runRoutineBatch(intents: readonly RoutineIntent[], transactionId: string): Promise<LocalFastBatchResultV1> {
    if (!Array.isArray(intents) || intents.length === 0) throw new TypeError("LOCAL_FAST_BATCH_REQUIRES_ACTIONS");
    if (intents.length > this.maxBatchActions) {
      throw new RangeError(`LOCAL_FAST_BATCH_TOO_LARGE: ${intents.length} > ${this.maxBatchActions}`);
    }
    if (typeof transactionId !== "string" || transactionId.trim().length === 0) {
      throw new TypeError("LOCAL_FAST_BATCH_TRANSACTION_REQUIRED");
    }
    const started = this.clock();
    const result = await this.session.runner.run({ kind: "SHORT_HORIZON", intents }, transactionId);
    const totalMs = this.clock() - started;
    const actionTimings = result.actions.map((action) => action.timings.totalMs);
    const dispatchTimings = result.actions.map((action) => action.timings.dispatchMs);
    const maxActionMs = actionTimings.length > 0 ? Math.max(...actionTimings) : 0;
    const meanActionMs = actionTimings.length > 0 ? actionTimings.reduce((sum, value) => sum + value, 0) / actionTimings.length : 0;
    return {
      runtime: LOCAL_FAST_RUNTIME_VERSION,
      transactionId,
      requestedActions: intents.length,
      completedActions: result.completedActions,
      route: result.route,
      planningMs: result.planningMs,
      actionMs: result.actionMs,
      actionTimingsMs: actionTimings,
      dispatchTimingsMs: dispatchTimings,
      meanActionMs,
      maxActionMs,
      totalMs,
      withinBudget: result.withinBudget && totalMs <= this.totalBudgetMs,
      escalationReason: result.escalationReason,
      hostRevision: result.hostRevision,
    };
  }

  async refresh() {
    return await this.session.runner.refresh();
  }
}
