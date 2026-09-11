import type { AeCepAdapterStateV11 } from "../../adapters/ae-cep/src/v1_1.js";
import type { AeCompositionSnapshot, AeLayerSnapshot, AeTransformSnapshot } from "../../ae-object-model/src/index.js";
import type { AeRoutineRef, RoutineIntent } from "../../routine-decision-engine/src/index.js";

export type ReflexDirection = "LEFT" | "RIGHT" | "UP" | "DOWN" | "NONE";

export type ReflexGoal =
  | Readonly<{ kind: "SHORT_HORIZON"; intents: readonly RoutineIntent[] }>
  | Readonly<{ kind: "REFRAME"; comp: AeRoutineRef; layer: AeRoutineRef; target: Readonly<Record<string, unknown>> }>
  | Readonly<{ kind: "IMPACT_PULSE"; comp: AeRoutineRef; layer: AeRoutineRef; intensity?: number; direction?: ReflexDirection }>
  | Readonly<{ kind: "FADE_PULSE"; comp: AeRoutineRef; layer: AeRoutineRef; opacity?: number }>;

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
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

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

const baselineTransform = (snapshot: AeTransformSnapshot): Record<string, unknown> => {
  const values: Record<string, unknown> = {};
  if (snapshot.position) values.position = [...snapshot.position];
  if (snapshot.scale) values.scale = [...snapshot.scale];
  if (finite(snapshot.rotation)) values.rotation = snapshot.rotation;
  if (finite(snapshot.opacity)) values.opacity = snapshot.opacity;
  return values;
};

const shiftedPosition = (position: readonly number[] | undefined, dx: number, dy: number): number[] | null => {
  if (!position || position.length < 2 || !position.every(finite)) return null;
  const result = [...position];
  result[0] = Number(result[0]) + dx;
  result[1] = Number(result[1]) + dy;
  return result;
};

const scaledVector = (scale: readonly number[] | undefined, multiplier: number): number[] | null => {
  if (!scale || scale.length < 2 || !scale.every(finite)) return null;
  return scale.map((value, index) => index < 2 ? Number((value * multiplier).toFixed(4)) : value);
};

const directionVector = (direction: ReflexDirection, magnitude: number): readonly [number, number, number] => {
  switch (direction) {
    case "LEFT": return [-magnitude, 0, -1];
    case "RIGHT": return [magnitude, 0, 1];
    case "UP": return [0, -magnitude, -1];
    case "DOWN": return [0, magnitude, 1];
    case "NONE": return [0, 0, 1];
  }
};

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
    if (goal.kind === "FADE_PULSE") {
      const target = requireLayer(state, goal.comp, goal.layer);
      if ("route" in target) return target;
      const baseline = baselineTransform(target.layer.transform);
      const opacity = clamp(goal.opacity ?? 35, 0, 100);
      return {
        route: "LOCAL",
        goalKind: goal.kind,
        intents: [transformIntent(goal.comp, goal.layer, { opacity }), transformIntent(goal.comp, goal.layer, baseline)],
      };
    }
    if (goal.kind !== "IMPACT_PULSE") return escalate("NOT_REFLEX", `Unsupported reflex goal '${String((goal as { kind?: unknown }).kind)}'.`);
    const target = requireLayer(state, goal.comp, goal.layer);
    if ("route" in target) return target;
    const intensity = clamp(goal.intensity ?? 0.65, 0.1, 1);
    const direction = goal.direction ?? "NONE";
    const [dx, dy, sign] = directionVector(direction, 28 + (62 * intensity));
    const base = baselineTransform(target.layer.transform);
    const accent: Record<string, unknown> = {};
    const counter: Record<string, unknown> = {};
    const accentPosition = shiftedPosition(target.layer.transform.position, dx, dy);
    const counterPosition = shiftedPosition(target.layer.transform.position, -dx * 0.28, -dy * 0.28);
    const accentScale = scaledVector(target.layer.transform.scale, 1 + 0.08 + (0.14 * intensity));
    const counterScale = scaledVector(target.layer.transform.scale, 1 - (0.025 * intensity));
    if (accentPosition) accent.position = accentPosition;
    if (counterPosition) counter.position = counterPosition;
    if (accentScale) accent.scale = accentScale;
    if (counterScale) counter.scale = counterScale;
    if (finite(target.layer.transform.rotation)) {
      accent.rotation = target.layer.transform.rotation + (sign * (3 + (7 * intensity)));
      counter.rotation = target.layer.transform.rotation - (sign * (1 + (2 * intensity)));
    }
    if (Object.keys(accent).length === 0 || Object.keys(base).length === 0) {
      return escalate("INVALID_REFLEX_INPUT", "Target layer does not expose a usable 2D transform snapshot.");
    }
    return {
      route: "LOCAL",
      goalKind: goal.kind,
      intents: [
        transformIntent(goal.comp, goal.layer, accent),
        transformIntent(goal.comp, goal.layer, counter),
        transformIntent(goal.comp, goal.layer, base),
      ],
    };
  }
}
