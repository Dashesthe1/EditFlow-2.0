import type { CapabilityId } from "../../core-contracts/src/index.js";

export const EDITING_IR_PRIMITIVE_KINDS = [
  "SUBJECT_ISOLATION",
  "TRACKING",
  "LAYER_DUPLICATION",
  "TEMPORAL_DUPLICATION",
  "OPACITY_SHAPING",
  "DIRECTIONAL_OFFSET",
  "TRANSFORM_ANIMATION",
  "CAMERA_PUSH",
  "TIME_REMAP",
  "REVERSE_TIME",
  "FREEZE_FRAME",
  "MASK_ANIMATION",
  "MATTE_RELATION",
  "PRECOMPOSE",
  "BLUR",
  "MOTION_BLUR",
  "COLOR_TREATMENT",
  "EFFECT_STACK",
  "BEAT_SYNC",
  "AUDIO_SYNC",
  "TEXT_STYLE",
] as const;
export type EditingIrPrimitiveKindV1 = (typeof EDITING_IR_PRIMITIVE_KINDS)[number];

export type EditingIrTimingAnchorV1 =
  | "SHOT_START"
  | "SHOT_END"
  | "BEAT"
  | "EVENT"
  | "ABSOLUTE";

export interface EditingIrTimingV1 {
  readonly anchor: EditingIrTimingAnchorV1;
  readonly offsetMs?: number;
  readonly durationMs?: number;
  readonly eventRef?: string;
}

export interface EditingIrParameterV1 {
  readonly name: string;
  readonly intent: string;
  readonly derivedFrom: readonly string[];
  readonly value?: string | number | boolean | readonly number[];
  readonly normalizedRange?: Readonly<{ min: number; max: number }>;
}

export interface EditingIrNodeV1 {
  readonly nodeId: string;
  readonly kind: EditingIrPrimitiveKindV1;
  readonly intent: string;
  readonly dependsOn: readonly string[];
  readonly capabilityIds: readonly CapabilityId[];
  readonly parameters: readonly EditingIrParameterV1[];
  readonly timing?: EditingIrTimingV1;
  readonly optional?: boolean;
}

export interface EditingIrRecipeV1 {
  readonly schema: "editflow.editing-ir.recipe.v1";
  readonly recipeId: string;
  readonly skillId: string;
  readonly creativeIntent: string;
  readonly prerequisites: readonly string[];
  readonly nodes: readonly EditingIrNodeV1[];
  readonly outputs: readonly string[];
  readonly validationCriteria: readonly string[];
}

export interface EditingIrValidationV1 {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly orderedNodeIds: readonly string[];
}

const nonEmpty = (value: string): boolean => value.trim().length > 0;

const validateTiming = (node: EditingIrNodeV1, errors: string[]): void => {
  if (!node.timing) return;
  if (node.timing.offsetMs !== undefined && !Number.isFinite(node.timing.offsetMs)) {
    errors.push(`Node '${node.nodeId}' has a non-finite timing offset.`);
  }
  if (node.timing.durationMs !== undefined
    && (!Number.isFinite(node.timing.durationMs) || node.timing.durationMs <= 0)) {
    errors.push(`Node '${node.nodeId}' has an invalid timing duration.`);
  }
  if (node.timing.anchor === "EVENT" && !nonEmpty(node.timing.eventRef ?? "")) {
    errors.push(`Node '${node.nodeId}' EVENT timing requires eventRef.`);
  }
};

const validateParameters = (node: EditingIrNodeV1, errors: string[]): void => {
  const names = new Set<string>();
  for (const parameter of node.parameters) {
    if (!nonEmpty(parameter.name)) errors.push(`Node '${node.nodeId}' has an empty parameter name.`);
    if (!nonEmpty(parameter.intent)) errors.push(`Node '${node.nodeId}' parameter '${parameter.name}' has no intent.`);
    if (names.has(parameter.name)) errors.push(`Node '${node.nodeId}' duplicates parameter '${parameter.name}'.`);
    names.add(parameter.name);
    if (parameter.normalizedRange
      && (!Number.isFinite(parameter.normalizedRange.min)
        || !Number.isFinite(parameter.normalizedRange.max)
        || parameter.normalizedRange.min > parameter.normalizedRange.max)) {
      errors.push(`Node '${node.nodeId}' parameter '${parameter.name}' has an invalid normalizedRange.`);
    }
  }
};

const topologicalOrder = (
  nodes: ReadonlyMap<string, EditingIrNodeV1>,
  errors: string[],
): readonly string[] => {
  const temporary = new Set<string>();
  const permanent = new Set<string>();
  const ordered: string[] = [];
  const visit = (nodeId: string): void => {
    if (permanent.has(nodeId)) return;
    if (temporary.has(nodeId)) {
      errors.push(`Editing IR dependency cycle includes '${nodeId}'.`);
      return;
    }
    temporary.add(nodeId);
    const node = nodes.get(nodeId);
    if (node) {
      for (const dependency of node.dependsOn) {
        if (nodes.has(dependency)) visit(dependency);
      }
    }
    temporary.delete(nodeId);
    permanent.add(nodeId);
    ordered.push(nodeId);
  };
  for (const nodeId of nodes.keys()) visit(nodeId);
  return ordered;
};

export const validateEditingIrRecipeV1 = (recipe: EditingIrRecipeV1): EditingIrValidationV1 => {
  const errors: string[] = [];
  if (!nonEmpty(recipe.recipeId)) errors.push("recipeId must not be empty.");
  if (!nonEmpty(recipe.skillId)) errors.push("skillId must not be empty.");
  if (!nonEmpty(recipe.creativeIntent)) errors.push("creativeIntent must not be empty.");
  if (recipe.nodes.length === 0) errors.push("Editing IR recipe must contain at least one node.");
  if (recipe.outputs.length === 0) errors.push("Editing IR recipe must declare at least one output.");

  const nodes = new Map<string, EditingIrNodeV1>();
  for (const node of recipe.nodes) {
    if (!nonEmpty(node.nodeId)) errors.push("Editing IR nodeId must not be empty.");
    else if (nodes.has(node.nodeId)) errors.push(`Duplicate Editing IR nodeId '${node.nodeId}'.`);
    else nodes.set(node.nodeId, node);
    if (!nonEmpty(node.intent)) errors.push(`Node '${node.nodeId}' must declare intent.`);
    for (const capabilityId of node.capabilityIds) {
      if (!nonEmpty(String(capabilityId))) errors.push(`Node '${node.nodeId}' has an empty capabilityId.`);
    }
    validateTiming(node, errors);
    validateParameters(node, errors);
  }

  for (const node of recipe.nodes) {
    for (const dependency of node.dependsOn) {
      if (dependency === node.nodeId) errors.push(`Node '${node.nodeId}' cannot depend on itself.`);
      else if (!nodes.has(dependency)) errors.push(`Node '${node.nodeId}' references missing dependency '${dependency}'.`);
    }
  }
  for (const output of recipe.outputs) {
    if (!nodes.has(output)) errors.push(`Recipe output '${output}' does not reference a node.`);
  }

  const orderedNodeIds = topologicalOrder(nodes, errors);
  return { valid: errors.length === 0, errors: [...new Set(errors)], orderedNodeIds };
};

export class EditingIrValidationError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(`Editing IR validation failed: ${errors.join(" | ")}`);
    this.name = "EditingIrValidationError";
    this.errors = errors;
  }
}

export const assertValidEditingIrRecipeV1 = (recipe: EditingIrRecipeV1): EditingIrRecipeV1 => {
  const validation = validateEditingIrRecipeV1(recipe);
  if (!validation.valid) throw new EditingIrValidationError(validation.errors);
  return recipe;
};
