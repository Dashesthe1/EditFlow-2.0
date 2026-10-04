/** Historical recipe shapes only; never executable editorial instructions. */
import type { CapabilityId } from "../../core-contracts/src/index.js";

export const EDITING_IR_PRIMITIVE_KINDS = [
  "SUBJECT_ISOLATION",
  "TRACKING",
  "STABILIZATION",
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
  "DISTORTION",
  "MOTION_SHAPING",
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
  readonly durationParameter?: string;
  readonly peakPhaseParameter?: string;
  readonly eventRef?: string;
}

export interface EditingIrParameterV1 {
  readonly name: string;
  readonly intent: string;
  readonly derivedFrom: readonly string[];
  readonly value?: string | number | boolean | readonly number[];
  readonly normalizedRange?: Readonly<{ min: number; max: number }>;
}

export type EditingIrTargetModeV1 = "EACH" | "GROUP";

export interface EditingIrTargetSpecV1 {
  readonly roles: readonly string[];
  readonly mode: EditingIrTargetModeV1;
}

export interface EditingIrNodeV1 {
  readonly nodeId: string;
  readonly kind: EditingIrPrimitiveKindV1;
  readonly intent: string;
  readonly dependsOn: readonly string[];
  readonly capabilityIds: readonly CapabilityId[];
  readonly parameters: readonly EditingIrParameterV1[];
  readonly target?: EditingIrTargetSpecV1;
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

