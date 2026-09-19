import type { RecipeCompilerContextV1 } from "../../recipe-compiler/src/index.js";
import type { DenseEffectEvidenceV1 } from "./contracts.js";

export interface M6MotionPeakCompilerContextInputV1 {
  readonly reference: DenseEffectEvidenceV1;
  readonly compId: string;
  readonly targetRangeMs: Readonly<{ startMs: number; endMs: number }>;
  readonly roleBindings: RecipeCompilerContextV1["roleBindings"];
  readonly parameterValues?: RecipeCompilerContextV1["parameterValues"];
  readonly eventRef?: string;
}

const finite = (value: number, name: string): number => {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite.`);
  return value;
};

export const buildM6MotionPeakCompilerContextV1 = (
  input: M6MotionPeakCompilerContextInputV1,
): RecipeCompilerContextV1 => {
  const compId = input.compId.trim();
  if (compId.length === 0) throw new TypeError("compId must not be empty.");
  const startMs = finite(input.targetRangeMs.startMs, "targetRangeMs.startMs");
  const endMs = finite(input.targetRangeMs.endMs, "targetRangeMs.endMs");
  if (endMs <= startMs) throw new TypeError("targetRangeMs.endMs must be greater than startMs.");
  const phase = finite(input.reference.summary.motionPeakPhase, "reference.summary.motionPeakPhase");
  if (phase < 0 || phase > 1) {
    throw new TypeError("reference.summary.motionPeakPhase must be normalized to [0, 1].");
  }
  const eventRef = (input.eventRef ?? "m6.effectPeak").trim();
  if (eventRef.length === 0) throw new TypeError("eventRef must not be empty.");
  const eventTimeMs = startMs + ((endMs - startMs) * phase);
  return {
    compId,
    eventTimesMs: { [eventRef]: eventTimeMs },
    roleBindings: input.roleBindings,
    parameterValues: input.parameterValues ?? {},
  };
};
