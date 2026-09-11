import { performance } from "node:perf_hooks";
import type { AeCepAdapterClientV11, AeCepAdapterStateV11 } from "../../adapters/ae-cep/src/v1_1.js";
import { ReflexPlanner, type ReflexGoal, type ReflexLocalPlan } from "../../reflex-planner/src/index.js";
import { RoutineDecisionEngine, type RoutineExecutionResult } from "../../routine-decision-engine/src/index.js";

export interface ContinuousFastLoopOptions {
  readonly budgetMs?: number;
  readonly maxActions?: number;
  readonly leaseTtlMs?: number;
  readonly clock?: () => number;
}

export interface ContinuousFastLoopResult {
  readonly route: "LOCAL" | "ESCALATE";
  readonly goalKind: string;
  readonly plan: ReflexLocalPlan | null;
  readonly actions: readonly RoutineExecutionResult[];
  readonly completedActions: number;
  readonly planningMs: number;
  readonly actionMs: number;
  readonly totalMs: number;
  readonly withinBudget: boolean;
  readonly escalationReason: string | null;
  readonly escalationDetail: string | null;
  readonly hostRevision: number;
}

export const DEFAULT_CONTINUOUS_FAST_LOOP_BUDGET_MS = 2_000;
export const DEFAULT_CONTINUOUS_FAST_LOOP_MAX_ACTIONS = 16;
export const DEFAULT_CONTINUOUS_FAST_LOOP_LEASE_TTL_MS = 120_000;

export class ContinuousFastLoop {
  readonly client: AeCepAdapterClientV11;
  readonly budgetMs: number;
  readonly leaseTtlMs: number;
  readonly clock: () => number;
  readonly planner: ReflexPlanner;
  #state: AeCepAdapterStateV11;
  #engine: RoutineDecisionEngine;
  #goalCounter = 0;
  #queue: Promise<void> = Promise.resolve();
  #refreshBeforeNextGoal = false;

  constructor(client: AeCepAdapterClientV11, initialState: AeCepAdapterStateV11, options: ContinuousFastLoopOptions = {}) {
    this.client = client;
    this.budgetMs = options.budgetMs ?? DEFAULT_CONTINUOUS_FAST_LOOP_BUDGET_MS;
    this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_CONTINUOUS_FAST_LOOP_LEASE_TTL_MS;
    this.clock = options.clock ?? (() => performance.now());
    this.planner = new ReflexPlanner({ maxActions: options.maxActions ?? DEFAULT_CONTINUOUS_FAST_LOOP_MAX_ACTIONS });
    this.#state = initialState;
    this.#engine = new RoutineDecisionEngine(client, initialState, { budgetMs: this.budgetMs, leaseTtlMs: this.leaseTtlMs, clock: this.clock });
  }

  get state(): AeCepAdapterStateV11 { return this.#state; }
  get hostRevision(): number { return this.#engine.hostRevision; }

  async refresh(): Promise<AeCepAdapterStateV11> {
    this.#state = await this.client.observe(this.#state.observed.projectId);
    this.#engine.refresh(this.#state);
    this.#refreshBeforeNextGoal = false;
    return this.#state;
  }

  async run(goal: ReflexGoal, transactionId = "continuous-fast-loop"): Promise<ContinuousFastLoopResult> {
    let resolveResult!: (value: ContinuousFastLoopResult) => void;
    let rejectResult!: (reason?: unknown) => void;
    const resultPromise = new Promise<ContinuousFastLoopResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const previous = this.#queue;
    this.#queue = (async () => {
      await previous;
      try { resolveResult(await this.#runOne(goal, transactionId)); }
      catch (error) { rejectResult(error); }
    })().then(() => undefined, () => undefined);
    return await resultPromise;
  }

  async #runOne(goal: ReflexGoal, transactionId: string): Promise<ContinuousFastLoopResult> {
    const started = this.clock();
    if (this.#refreshBeforeNextGoal) await this.refresh();
    const plan = this.planner.compile(goal, this.#state);
    const plannedAt = this.clock();
    if (plan.route === "ESCALATE") {
      return {
        route: "ESCALATE", goalKind: goal.kind, plan: null, actions: [], completedActions: 0,
        planningMs: plannedAt - started, actionMs: 0, totalMs: plannedAt - started,
        withinBudget: plannedAt - started <= this.budgetMs,
        escalationReason: plan.reason, escalationDetail: plan.detail, hostRevision: this.#engine.hostRevision,
      };
    }
    const actions: RoutineExecutionResult[] = [];
    const goalId = `${transactionId}_GOAL_${++this.#goalCounter}`;
    let escalationReason: string | null = null;
    let escalationDetail: string | null = null;
    for (const intent of plan.intents) {
      const action = await this.#engine.execute(intent, goalId);
      actions.push(action);
      if (action.route !== "LOCAL") {
        escalationReason = action.reason;
        escalationDetail = action.detail;
        this.#engine.invalidate();
        this.#refreshBeforeNextGoal = true;
        break;
      }
    }
    if (actions.some((action) => action.route === "LOCAL")) this.#refreshBeforeNextGoal = true;
    const completed = this.clock();
    const actionMs = actions.reduce((sum, action) => sum + action.timings.totalMs, 0);
    const completedActions = actions.filter((action) => action.route === "LOCAL").length;
    const route = escalationReason === null && completedActions === plan.intents.length ? "LOCAL" : "ESCALATE";
    return {
      route, goalKind: goal.kind, plan, actions, completedActions,
      planningMs: plannedAt - started,
      actionMs,
      totalMs: completed - started,
      withinBudget: completed - started <= this.budgetMs && actions.every((action) => action.withinBudget),
      escalationReason,
      escalationDetail,
      hostRevision: this.#engine.hostRevision,
    };
  }
}
