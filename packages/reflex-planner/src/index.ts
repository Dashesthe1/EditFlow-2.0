import type { AeCepAdapterStateV11 } from "../../adapters/ae-cep/src/v1_1.js";
import type { AeCompositionSnapshot, AeLayerSnapshot } from "../../ae-object-model/src/index.js";
import type { AeRoutineRef, RoutineIntent } from "../../routine-decision-engine/src/index.js";

export type ReflexGoal =
  | Readonly<{ kind: "SHORT_HORIZON"; intents: readonly RoutineIntent[] }>
  | Readonly<{ kind: "REFRAME"; comp: AeRoutineRef; layer: AeRoutineRef; target: Readonly<Record<string, unknown>> }>;

export type ReflexEscalationReason =
  | "NOT_REFLEX"
  | "INVALID_REFLEX_INPUT"
  | "TARGET_NOT_FOUND"
  | "TARGET_LOCKED"
  | "TOO_MANY_ACTIONS";

export interface ReflexLocalPlan {
  readonly route: "LOCAL";
  readonly goalKind: ReflexGoal["kind"];
  readonly intents: readonly RoutineIntent[];
}

export interface ReflexEscalatedPlan {
  readonly route: "ESCALATE";
  readonly reason: ReflexEscalationReason;
  readonly detail: string;
}

export type ReflexPlan = ReflexLocalPlan | ReflexEscalatedPlan;

const escalate = (reason: ReflexEscalationReason, detail: string): ReflexEscalatedPlan => ({ route: "ESCALATE", reason, detail });
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const refMatches = (ref: AeRoutineRef, hostId: number | null, stableId: string | null): boolean => {
  if ("hostId" in ref) return hostId === ref.hostId;
  return stableId === ref.stableId;
};

const resolveComposition = (state: AeCepAdapterStateV11, ref: AeRoutineRef): AeCompositionSnapshot | null => {
  for (const item of state.project.items) {
    if (item.kind === "COMPOSITION" && item.composition && refMatches(ref, item.hostId, item.stableId)) return item.composition;
  }
  return null;
};

const resolveLayer = (comp: AeCompositionSnapshot, ref: AeRoutineRef): AeLayerSnapshot | null => {
  for (const layer of comp.layers) if (refMatches(ref, layer.hostId, layer.stableId)) return layer;
  return null;
};

const requireLayer = (
  state: AeCepAdapterStateV11,
  compRef: AeRoutineRef,
  layerRef: AeRoutineRef,
): { comp: AeCompositionSnapshot; layer: AeLayerSnapshot } | ReflexEscalatedPlan => {
  const comp = resolveComposition(state, compRef);
  if (!comp) return escalate("TARGET_NOT_FOUND", "Reflex composition target is no longer present in the warm world model.");
  const layer = resolveLayer(comp, layerRef);
  if (!layer) return escalate("TARGET_NOT_FOUND", "Reflex layer target is no longer present in the warm world model.");
  if (layer.locked) return escalate("TARGET_LOCKED", "Reflex layer is locked and requires slow-path intervention.");
  return { comp, layer };
};

const transformIntent = (
  comp: AeRoutineRef,
  layer: AeRoutineRef,
  values: Readonly<Record<string, unknown>>,
): RoutineIntent => ({ kind: "SET_LAYER_TRANSFORM", comp, layer, values });

export interface ReflexPlannerOptions {
  readonly maxActions?: number;
}

export class ReflexPlanner {
  readonly maxActions: number;

  constructor(options: ReflexPlannerOptions = {}) {
    this.maxActions = options.maxActions ?? 16;
  }

  compile(goal: ReflexGoal, state: AeCepAdapterStateV11): ReflexPlan {
    if (!goal || typeof goal !== "object" || !("kind" in goal)) return escalate("NOT_REFLEX", "Goal is not a recognized reflex directive.");
    if (goal.kind === "SHORT_HORIZON") {
      if (!Array.isArray(goal.intents) || goal.intents.length === 0) return escalate("INVALID_REFLEX_INPUT", "SHORT_HORIZON requires at least one routine intent.");
      if (goal.intents.length > this.maxActions) return escalate("TOO_MANY_ACTIONS", `Short horizon exceeds ${this.maxActions} actions.`);
      return { route: "LOCAL", goalKind: goal.kind, intents: [...goal.intents] };
    }
    if (goal.kind === "REFRAME") {
      const target = requireLayer(state, goal.comp, goal.layer);
      if ("route" in target) return target;
      if (!goal.target || typeof goal.target !== "object" || Array.isArray(goal.target)) return escalate("INVALID_REFLEX_INPUT", "REFRAME requires transform target values.");
      return { route: "LOCAL", goalKind: goal.kind, intents: [transformIntent(goal.comp, goal.layer, goal.target)] };
    }
    return escalate("NOT_REFLEX", `Unsupported explicit goal: ${String((goal as { kind?: unknown }).kind)}`);
  }
}
