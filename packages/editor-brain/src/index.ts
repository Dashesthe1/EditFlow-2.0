import { performance } from "node:perf_hooks";
import type { ReflexDirection, ReflexGoal } from "../../reflex-planner/src/index.js";
import type { AeRoutineRef } from "../../routine-decision-engine/src/index.js";
import { ContinuousFastLoop, type ContinuousFastLoopResult } from "../../continuous-fast-loop/src/index.js";

export type EditorTechniqueId = "HOLD" | "REFRAME" | "IMPACT_PULSE" | "FADE_PULSE";
export type EditorEvidenceKind = "REFERENCE" | "TUTORIAL" | "EXPERIENCE";
export type EditorBeatStrength = "NONE" | "WEAK" | "MEDIUM" | "STRONG";

export interface EditorTechniqueEvidenceV0 {
  readonly evidenceId: string;
  readonly kind: EditorEvidenceKind;
  readonly technique: EditorTechniqueId;
  readonly confidence: number;
  readonly frequency: number;
  readonly meanIntensity?: number;
}

export interface EditorStyleProfileV0 {
  readonly profileId: string;
  readonly name: string;
  readonly techniqueBias: Readonly<Record<EditorTechniqueId, number>>;
  readonly preferredImpactIntensity: number;
  readonly minimumReadability: number;
  readonly evidenceIds: readonly string[];
}
export interface EditorStateV0 {
  readonly comp: AeRoutineRef;
  readonly layer: AeRoutineRef;
  readonly style: EditorStyleProfileV0;
  readonly desiredEnergy: number;
  readonly readability: number;
  readonly dialogueImportance: number;
  readonly transitionPressure: number;
  readonly motionMagnitude: number;
  readonly motionDirection: ReflexDirection;
  readonly beatStrength: EditorBeatStrength;
  readonly beatEtaMs: number | null;
  readonly shotAgeMs: number;
  readonly subjectX?: number;
  readonly subjectY?: number;
  readonly reframeTarget?: Readonly<Record<string, unknown>>;
}

export type EditorProgramV0 =
  | Readonly<{ kind: "HOLD" }>
  | Readonly<{ kind: "REFRAME"; target: Readonly<Record<string, unknown>> }>
  | Readonly<{ kind: "IMPACT_PULSE"; direction: ReflexDirection; intensity: number }>
  | Readonly<{ kind: "FADE_PULSE"; opacity: number }>;

export interface EditorTechniqueScoreV0 {
  readonly technique: EditorTechniqueId;
  readonly score: number;
}
export interface EditorDecisionV0 {
  readonly route: "LOCAL" | "ESCALATE";
  readonly technique: EditorTechniqueId | null;
  readonly program: EditorProgramV0 | null;
  readonly scores: readonly EditorTechniqueScoreV0[];
  readonly confidence: number;
  readonly decisionMs: number;
  readonly rationaleCodes: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly escalationReason: string | null;
}

export interface EditorBrainPolicyV0 {
  decide(state: EditorStateV0): EditorDecisionV0;
}

export interface EditorBrainOptionsV0 {
  readonly minConfidence?: number;
  readonly decisionBudgetMs?: number;
  readonly clock?: () => number;
}

export const DEFAULT_EDITOR_BRAIN_MIN_CONFIDENCE = 0.58;
export const DEFAULT_EDITOR_BRAIN_DECISION_BUDGET_MS = 50;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const finite01 = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1;
const beatWeight = (strength: EditorBeatStrength): number =>
  strength === "STRONG" ? 1 : strength === "MEDIUM" ? 0.6 : strength === "WEAK" ? 0.25 : 0;
const impactWindow = (etaMs: number | null): number => {
  if (etaMs === null || !Number.isFinite(etaMs) || etaMs < -120 || etaMs > 400) return 0;
  const distance = Math.abs(etaMs);
  return clamp01(1 - (distance / 400));
};

const normalizeBiases = (biases: Partial<Record<EditorTechniqueId, number>>): Readonly<Record<EditorTechniqueId, number>> => ({
  HOLD: clamp01(biases.HOLD ?? 0.5),
  REFRAME: clamp01(biases.REFRAME ?? 0.5),
  IMPACT_PULSE: clamp01(biases.IMPACT_PULSE ?? 0.5),
  FADE_PULSE: clamp01(biases.FADE_PULSE ?? 0.5),
});

export const compileEditorStyleProfileV0 = (
  profileId: string,
  name: string,
  evidence: readonly EditorTechniqueEvidenceV0[],
): EditorStyleProfileV0 => {
  const accum: Record<EditorTechniqueId, { weighted: number; weight: number; intensity: number; intensityWeight: number }> = {
    HOLD: { weighted: 0, weight: 0, intensity: 0, intensityWeight: 0 },
    REFRAME: { weighted: 0, weight: 0, intensity: 0, intensityWeight: 0 },
    IMPACT_PULSE: { weighted: 0, weight: 0, intensity: 0, intensityWeight: 0 },
    FADE_PULSE: { weighted: 0, weight: 0, intensity: 0, intensityWeight: 0 },
  };
  for (const item of evidence) {
    if (!finite01(item.confidence) || !finite01(item.frequency)) continue;
    const weight = item.confidence;
    const bucket = accum[item.technique];
    bucket.weighted += item.frequency * weight;
    bucket.weight += weight;
    if (item.meanIntensity !== undefined && finite01(item.meanIntensity)) {
      bucket.intensity += item.meanIntensity * weight;
      bucket.intensityWeight += weight;
    }
  }
  const biases = normalizeBiases(Object.fromEntries(
    (Object.keys(accum) as EditorTechniqueId[]).map((technique) => {
      const bucket = accum[technique];
      return [technique, bucket.weight > 0 ? bucket.weighted / bucket.weight : 0.5];
    }),
  ));
  const impact = accum.IMPACT_PULSE;
  const preferredImpactIntensity = impact.intensityWeight > 0
    ? clamp01(impact.intensity / impact.intensityWeight)
    : 0.65;
  return {
    profileId,
    name,
    techniqueBias: biases,
    preferredImpactIntensity,
    minimumReadability: 0.55,
    evidenceIds: [...new Set(evidence.map((item) => item.evidenceId))],
  };
};
export class EditorBrainV0 implements EditorBrainPolicyV0 {
  readonly minConfidence: number;
  readonly decisionBudgetMs: number;
  readonly clock: () => number;

  constructor(options: EditorBrainOptionsV0 = {}) {
    this.minConfidence = options.minConfidence ?? DEFAULT_EDITOR_BRAIN_MIN_CONFIDENCE;
    this.decisionBudgetMs = options.decisionBudgetMs ?? DEFAULT_EDITOR_BRAIN_DECISION_BUDGET_MS;
    this.clock = options.clock ?? (() => performance.now());
  }

  decide(state: EditorStateV0): EditorDecisionV0 {
    const started = this.clock();
    const scalars = [state.desiredEnergy, state.readability, state.dialogueImportance,
      state.transitionPressure, state.motionMagnitude];
    if (scalars.some((value) => !finite01(value)) || !Number.isFinite(state.shotAgeMs) || state.shotAgeMs < 0) {
      return this.#escalate(started, state, "INVALID_EDITOR_STATE");
    }
    const beat = beatWeight(state.beatStrength);
    const beatNow = impactWindow(state.beatEtaMs);
    const readabilityDeficit = clamp01(state.style.minimumReadability - state.readability);
    const xOffset = state.subjectX === undefined ? 0 : Math.abs(clamp01(state.subjectX) - 0.5) * 2;
    const yOffset = state.subjectY === undefined ? 0 : Math.abs(clamp01(state.subjectY) - 0.5) * 2;
    const offCenter = Math.max(xOffset, yOffset);
    const bias = state.style.techniqueBias;
    const hold = (bias.HOLD * 0.30) + (state.dialogueImportance * 0.35)
      + ((1 - state.desiredEnergy) * 0.12) + ((1 - state.transitionPressure) * 0.10)
      + (readabilityDeficit * 0.55) + (state.shotAgeMs < 250 ? 0.12 : 0);
    const impact = (bias.IMPACT_PULSE * 0.35) + (state.desiredEnergy * 0.25)
      + (state.motionMagnitude * 0.18) + (beat * beatNow * 0.18)
      + (state.transitionPressure * 0.12) - (state.dialogueImportance * 0.22)
      - (readabilityDeficit * 0.20);
    const reframe = state.reframeTarget
      ? (bias.REFRAME * 0.30) + (offCenter * 0.42) + ((1 - state.motionMagnitude) * 0.08)
        + (state.readability * 0.10) - (state.transitionPressure * 0.08)
      : -1;
    const fade = (bias.FADE_PULSE * 0.25) + (state.transitionPressure * 0.28)
      + (beat * beatNow * 0.10) + ((1 - state.motionMagnitude) * 0.10)
      + (state.desiredEnergy * 0.08) - (state.dialogueImportance * 0.20);
    const scores = ([
      { technique: "HOLD", score: hold },
      { technique: "REFRAME", score: reframe },
      { technique: "IMPACT_PULSE", score: impact },
      { technique: "FADE_PULSE", score: fade },
    ] as EditorTechniqueScoreV0[]).sort((a, b) => b.score - a.score);
    const best = scores[0];
    const second = scores[1];
    if (!best || !second) return this.#escalate(started, state, "NO_EDITOR_CANDIDATE");
    const margin = Math.max(0, best.score - second.score);
    const confidence = clamp01(0.45 + (clamp01(best.score) * 0.20) + (margin * 0.75));
    const rationaleCodes: string[] = [];
    if (state.dialogueImportance >= 0.65) rationaleCodes.push("DIALOGUE_READABILITY_PRIORITY");
    if (readabilityDeficit > 0) rationaleCodes.push("READABILITY_BELOW_STYLE_FLOOR");
    if (beatNow > 0.5 && beat >= 0.6) rationaleCodes.push("MUSICAL_ACCENT_IMMINENT");
    if (state.motionMagnitude >= 0.55) rationaleCodes.push("HIGH_SUBJECT_OR_CAMERA_MOTION");
    if (state.transitionPressure >= 0.6) rationaleCodes.push("TRANSITION_PRESSURE_HIGH");
    if (offCenter >= 0.35) rationaleCodes.push("SUBJECT_COMPOSITION_OFF_CENTER");
    rationaleCodes.push(`STYLE_${best.technique}`);
    const elapsed = this.clock() - started;
    if (elapsed > this.decisionBudgetMs) return this.#escalate(started, state, "DECISION_BUDGET_EXCEEDED");
    if (confidence < this.minConfidence) return this.#escalate(started, state, "LOW_EDITOR_CONFIDENCE", scores, confidence);
    const program = this.#program(best.technique, state);
    return {
      route: "LOCAL",
      technique: best.technique,
      program,
      scores,
      confidence,
      decisionMs: elapsed,
      rationaleCodes,
      evidenceIds: state.style.evidenceIds,
      escalationReason: null,
    };
  }
  #program(technique: EditorTechniqueId, state: EditorStateV0): EditorProgramV0 {
    if (technique === "HOLD") return { kind: "HOLD" };
    if (technique === "REFRAME") return { kind: "REFRAME", target: state.reframeTarget ?? {} };
    if (technique === "FADE_PULSE") {
      const opacity = Math.round(65 - (45 * state.desiredEnergy));
      return { kind: "FADE_PULSE", opacity: Math.min(70, Math.max(15, opacity)) };
    }
    const intensity = clamp01((state.style.preferredImpactIntensity * 0.55) + (state.desiredEnergy * 0.45));
    return { kind: "IMPACT_PULSE", direction: state.motionDirection, intensity: Math.max(0.1, intensity) };
  }

  #escalate(
    started: number,
    state: EditorStateV0,
    reason: string,
    scores: readonly EditorTechniqueScoreV0[] = [],
    confidence = 0,
  ): EditorDecisionV0 {
    return {
      route: "ESCALATE",
      technique: null,
      program: null,
      scores,
      confidence,
      decisionMs: this.clock() - started,
      rationaleCodes: [reason],
      evidenceIds: state.style?.evidenceIds ?? [],
      escalationReason: reason,
    };
  }
}
export const compileEditorProgramToReflexV0 = (
  program: EditorProgramV0,
  comp: AeRoutineRef,
  layer: AeRoutineRef,
): ReflexGoal | null => {
  if (program.kind === "HOLD") return null;
  if (program.kind === "REFRAME") return { kind: "REFRAME", comp, layer, target: program.target };
  if (program.kind === "FADE_PULSE") return { kind: "FADE_PULSE", comp, layer, opacity: program.opacity };
  return {
    kind: "IMPACT_PULSE",
    comp,
    layer,
    direction: program.direction,
    intensity: program.intensity,
  };
};

export interface EditorBrainRunResultV0 {
  readonly route: "LOCAL" | "ESCALATE";
  readonly decision: EditorDecisionV0;
  readonly reflexResult: ContinuousFastLoopResult | null;
  readonly visibleMutationExpected: boolean;
  readonly decisionMs: number;
  readonly executionMs: number;
  readonly totalMs: number;
}

export interface EditorReflexRunnerV0 {
  run(goal: ReflexGoal, transactionId?: string): Promise<ContinuousFastLoopResult>;
}
export class EditorBrainRuntimeV0 {
  readonly brain: EditorBrainPolicyV0;
  readonly runner: EditorReflexRunnerV0;
  readonly clock: () => number;

  constructor(brain: EditorBrainPolicyV0, runner: EditorReflexRunnerV0, clock: () => number = () => performance.now()) {
    this.brain = brain;
    this.runner = runner;
    this.clock = clock;
  }

  async run(state: EditorStateV0, transactionId = "editor-brain-v0"): Promise<EditorBrainRunResultV0> {
    const started = this.clock();
    const decision = this.brain.decide(state);
    if (decision.route === "ESCALATE" || !decision.program) {
      return {
        route: "ESCALATE",
        decision,
        reflexResult: null,
        visibleMutationExpected: false,
        decisionMs: decision.decisionMs,
        executionMs: 0,
        totalMs: this.clock() - started,
      };
    }
    const goal = compileEditorProgramToReflexV0(decision.program, state.comp, state.layer);
    if (!goal) {
      return {
        route: "LOCAL",
        decision,
        reflexResult: null,
        visibleMutationExpected: false,
        decisionMs: decision.decisionMs,
        executionMs: 0,
        totalMs: this.clock() - started,
      };
    }
    const reflexStarted = this.clock();
    const reflexResult = await this.runner.run(goal, transactionId);
    const completed = this.clock();
    return {
      route: reflexResult.route,
      decision,
      reflexResult,
      visibleMutationExpected: reflexResult.route === "LOCAL" && reflexResult.completedActions > 0,
      decisionMs: decision.decisionMs,
      executionMs: completed - reflexStarted,
      totalMs: completed - started,
    };
  }
}
