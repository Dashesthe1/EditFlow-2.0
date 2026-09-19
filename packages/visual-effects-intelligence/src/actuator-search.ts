import type {
  ConstructionControlInstructionV1,
  ConstructionControlKindV1,
} from "./contracts.js";

export type ActuatorControlVectorV1 =
  Readonly<Partial<Record<ConstructionControlKindV1, number>>>;

export interface ActuatorAttemptEvidenceV1 {
  readonly attemptId: string;
  readonly values: ActuatorControlVectorV1;
  readonly weightedFidelity: number;
  readonly definingCoverage: number;
  readonly certified: boolean;
  readonly residualInvariantIds: readonly string[];
  /** Comparator render values keyed by semantic metric for causal actuator learning. */
  readonly metricValues?: Readonly<Record<string, number>>;
}

export interface ActuatorMetricResponseV1 {
  readonly control: ConstructionControlKindV1;
  readonly metric: string;
  readonly probeCount: number;
  readonly metricSpan: number;
  readonly requiredDelta: number;
  readonly responseRatio: number;
  /** Number of +/- actuator directions rendered relative to the retained-best value. */
  readonly testedDirectionCount: number;
  /** Rendered probes that moved the target metric toward reference without sacrificing retained defining behavior. */
  readonly safeImprovingProbeCount: number;
  /** Target-improving probes that introduced a new defining residual or reduced defining coverage. */
  readonly collateralRegressionProbeCount: number;
  /** Raw causal response, irrespective of collateral damage. */
  readonly responsive: boolean;
  /** True only when rendered evidence demonstrates target progress without anti-simplification regression. */
  readonly safeResponsive: boolean;
}

export interface ActuatorSearchDimensionV1 {
  readonly control: ConstructionControlKindV1;
  readonly minimum: number;
  readonly maximum: number;
  readonly minimumStep: number;
  readonly integer?: boolean;
}

export interface ActuatorSearchCandidateV1 {
  readonly candidateId: string;
  readonly values: ActuatorControlVectorV1;
  readonly changedControls: readonly ConstructionControlKindV1[];
  readonly rationale: string;
}

export interface BoundedActuatorSearchPlanV1 {
  readonly schema: "editflow.bounded-actuator-search-plan.v1";
  readonly retainedBestAttemptId: string;
  readonly regressingAttemptIds: readonly string[];
  readonly trustScale: number;
  readonly candidates: readonly ActuatorSearchCandidateV1[];
  readonly exhaustedControls: readonly ConstructionControlKindV1[];
  /** Clean one-factor evidence showing whether implicated controls actually move their viewer-visible deficit metrics. */
  readonly metricResponses: readonly ActuatorMetricResponseV1[];
  /** Defining invariants whose mapped actuators are all unavailable, exhausted, or proven non-responsive. */
  readonly synthesisRequiredInvariantIds: readonly string[];
}

const EPSILON = 1e-9;

const finite01 = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be finite and in [0, 1].`);
  }
  return value;
};

const compareAttempt = (
  a: ActuatorAttemptEvidenceV1,
  b: ActuatorAttemptEvidenceV1,
): number => {
  if (a.certified !== b.certified) return a.certified ? 1 : -1;
  if (Math.abs(a.definingCoverage - b.definingCoverage) > EPSILON) {
    return a.definingCoverage > b.definingCoverage ? 1 : -1;
  }
  if (Math.abs(a.weightedFidelity - b.weightedFidelity) > EPSILON) {
    return a.weightedFidelity > b.weightedFidelity ? 1 : -1;
  }
  return 0;
};

export const selectRetainedBestActuatorAttemptV1 = (
  attempts: readonly ActuatorAttemptEvidenceV1[],
): ActuatorAttemptEvidenceV1 => {
  if (attempts.length === 0) {
    throw new TypeError("Actuator search requires at least one rendered attempt.");
  }
  for (const attempt of attempts) {
    finite01(attempt.weightedFidelity, "weightedFidelity");
    finite01(attempt.definingCoverage, "definingCoverage");
  }
  return attempts.reduce((best, attempt) => compareAttempt(attempt, best) > 0 ? attempt : best);
};

const vectorKey = (values: ActuatorControlVectorV1): string =>
  Object.entries(values)
    .filter((entry): entry is [ConstructionControlKindV1, number] =>
      typeof entry[1] === "number" && Number.isFinite(entry[1]))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value.toFixed(6)}`)
    .join("|");

const clampDimension = (
  value: number,
  dimension: ActuatorSearchDimensionV1,
): number => {
  const bounded = Math.min(dimension.maximum, Math.max(dimension.minimum, value));
  return dimension.integer ? Math.round(bounded) : bounded;
};

const controlValue = (
  values: ActuatorControlVectorV1,
  control: ConstructionControlKindV1,
): number | null => {
  const value = values[control];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const changedControlCount = (
  a: ActuatorControlVectorV1,
  b: ActuatorControlVectorV1,
): number => {
  const controls = new Set<ConstructionControlKindV1>([
    ...(Object.keys(a) as ConstructionControlKindV1[]),
    ...(Object.keys(b) as ConstructionControlKindV1[]),
  ]);
  let changed = 0;
  for (const control of controls) {
    const av = controlValue(a, control);
    const bv = controlValue(b, control);
    if (av === null || bv === null || Math.abs(av - bv) > EPSILON) changed += 1;
  }
  return changed;
};

const objective = (attempt: ActuatorAttemptEvidenceV1): number =>
  (attempt.certified ? 100 : 0) + (attempt.definingCoverage * 4) + attempt.weightedFidelity;

const cleanSensitivity = (
  retained: ActuatorAttemptEvidenceV1,
  attempts: readonly ActuatorAttemptEvidenceV1[],
  control: ConstructionControlKindV1,
): number | null => {
  const base = controlValue(retained.values, control);
  if (base === null) return null;
  const slopes: number[] = [];
  for (const attempt of attempts) {
    if (attempt.attemptId === retained.attemptId) continue;
    if (changedControlCount(retained.values, attempt.values) !== 1) continue;
    const value = controlValue(attempt.values, control);
    if (value === null || Math.abs(value - base) <= EPSILON) continue;
    slopes.push((objective(attempt) - objective(retained)) / (value - base));
  }
  if (slopes.length === 0) return null;
  slopes.sort((a, b) => a - b);
  return slopes[Math.floor(slopes.length / 2)] ?? null;
};

const metricValue = (
  attempt: ActuatorAttemptEvidenceV1,
  metric: string,
): number | null => {
  const value = attempt.metricValues?.[metric];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const deficitMetric = (instruction: ConstructionControlInstructionV1): string =>
  instruction.deficitMetric ?? instruction.metric;

const metricResponseEvidence = (
  retained: ActuatorAttemptEvidenceV1,
  attempts: readonly ActuatorAttemptEvidenceV1[],
  instruction: ConstructionControlInstructionV1,
): ActuatorMetricResponseV1 | null => {
  const metric = deficitMetric(instruction);
  const retainedMetric = metricValue(retained, metric);
  const reference = instruction.deficitReferenceValue ?? instruction.referenceValue;
  if (retainedMetric === null || typeof reference !== "number" || !Number.isFinite(reference)) return null;
  // Keep causal evidence even when a later render becomes the retained best.
  // Any pair whose physical vectors differ in exactly this one control is a
  // valid one-factor counterfactual; it need not be centered on the current best.
  const participants = new Map<string, number>();
  for (let leftIndex = 0; leftIndex < attempts.length; leftIndex += 1) {
    const left = attempts[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < attempts.length; rightIndex += 1) {
      const right = attempts[rightIndex]!;
      if (changedControlCount(left.values, right.values) !== 1) continue;
      const leftControl = controlValue(left.values, instruction.control);
      const rightControl = controlValue(right.values, instruction.control);
      if (leftControl === null || rightControl === null
        || Math.abs(leftControl - rightControl) <= EPSILON) continue;
      const leftMetric = metricValue(left, metric);
      const rightMetric = metricValue(right, metric);
      if (leftMetric === null || rightMetric === null) continue;
      participants.set(left.attemptId, leftMetric);
      participants.set(right.attemptId, rightMetric);
    }
  }
  // A clean pair supplies two independently rendered actuator states.
  if (participants.size < 2) return null;
  const samples = [...participants.values()];
  const probeCount = participants.size;
  const metricSpan = Math.max(...samples) - Math.min(...samples);
  const requiredDelta = Math.abs(reference - retainedMetric);
  const responseRatio = requiredDelta <= EPSILON ? 1 : metricSpan / requiredDelta;
  const retainedControl = controlValue(retained.values, instruction.control);
  const retainedResiduals = new Set(retained.residualInvariantIds);
  const testedDirections = new Set<-1 | 1>();
  let safeImprovingProbeCount = 0;
  let collateralRegressionProbeCount = 0;
  const retainedError = Math.abs(reference - retainedMetric);
  for (const attempt of attempts) {
    if (!participants.has(attempt.attemptId) || attempt.attemptId === retained.attemptId) continue;
    // Pairwise one-factor evidence may prove that an actuator is responsive even
    // after the retained best moves to a different baseline. It must NOT prove
    // that a direction is safe/exhausted relative to that new baseline unless
    // this render differs from the retained vector in exactly that actuator.
    // Otherwise collateral changes (for example density + spread) are causally
    // confounded and can incorrectly exhaust a useful correction path.
    if (changedControlCount(retained.values, attempt.values) !== 1) continue;
    const candidateMetric = metricValue(attempt, metric);
    const candidateControl = controlValue(attempt.values, instruction.control);
    if (candidateMetric === null || candidateControl === null || retainedControl === null) continue;
    if (candidateControl > retainedControl + EPSILON) testedDirections.add(1);
    if (candidateControl < retainedControl - EPSILON) testedDirections.add(-1);
    if (Math.abs(reference - candidateMetric) + EPSILON >= retainedError) continue;
    const addedResidual = attempt.residualInvariantIds.some((invariantId) =>
      invariantId !== instruction.invariantId && !retainedResiduals.has(invariantId));
    const coverageRegression = attempt.definingCoverage + EPSILON < retained.definingCoverage;
    if (addedResidual || coverageRegression) collateralRegressionProbeCount += 1;
    else safeImprovingProbeCount += 1;
  }
  const responsive = responseRatio >= 0.05;
  return {
    control: instruction.control,
    metric,
    probeCount,
    metricSpan,
    requiredDelta,
    responseRatio,
    testedDirectionCount: testedDirections.size,
    safeImprovingProbeCount,
    collateralRegressionProbeCount,
    responsive,
    safeResponsive: responsive && safeImprovingProbeCount > 0,
  };
};

const requestedDirections = (
  instructions: readonly ConstructionControlInstructionV1[],
  control: ConstructionControlKindV1,
): readonly (-1 | 1)[] => {
  const relevant = instructions.filter((item) => item.defining && item.control === control);
  const directions = new Set<-1 | 1>();
  for (const item of relevant) {
    if (item.direction === "INCREASE") directions.add(1);
    if (item.direction === "DECREASE") directions.add(-1);
  }
  return [...directions];
};

const candidateStep = (
  dimension: ActuatorSearchDimensionV1,
  trustScale: number,
): number => Math.max(
  dimension.minimumStep,
  (dimension.maximum - dimension.minimum) * 0.08 * trustScale,
);


const cohortKeyWithoutControl = (
  values: ActuatorControlVectorV1,
  control: ConstructionControlKindV1,
): string => Object.entries(values)
  .filter((entry): entry is [ConstructionControlKindV1, number] =>
    entry[0] !== control
    && typeof entry[1] === "number"
    && Number.isFinite(entry[1]))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, value]) => `${key}:${value.toFixed(6)}`)
  .join("|");

const nonlinearIntervalRefinements = (
  attempts: readonly ActuatorAttemptEvidenceV1[],
  dimension: ActuatorSearchDimensionV1,
  seen: Set<string>,
  limit: number,
): ActuatorSearchCandidateV1[] => {
  const cohorts = new Map<string, ActuatorAttemptEvidenceV1[]>();
  for (const attempt of attempts) {
    if (controlValue(attempt.values, dimension.control) === null) continue;
    const key = cohortKeyWithoutControl(attempt.values, dimension.control);
    const bucket = cohorts.get(key) ?? [];
    bucket.push(attempt);
    cohorts.set(key, bucket);
  }

  const output: ActuatorSearchCandidateV1[] = [];
  for (const cohort of cohorts.values()) {
    if (output.length >= limit) break;
    const distinct = [...new Map(cohort.map((attempt) => [
      controlValue(attempt.values, dimension.control)!.toFixed(9),
      attempt,
    ])).values()].sort((left, right) =>
      controlValue(left.values, dimension.control)!
      - controlValue(right.values, dimension.control)!);
    if (distinct.length < 3) continue;

    for (let index = 0; index < distinct.length - 1; index += 1) {
      if (output.length >= limit) break;
      const left = distinct[index]!;
      const right = distinct[index + 1]!;
      const leftValue = controlValue(left.values, dimension.control)!;
      const rightValue = controlValue(right.values, dimension.control)!;
      const gap = rightValue - leftValue;
      // Do not spend a render when bisection cannot move at least one declared
      // actuator step away from both already-rendered endpoints.
      if (gap + EPSILON < dimension.minimumStep * 2) continue;
      const midpoint = clampDimension(leftValue + (gap / 2), dimension);
      if (
        Math.abs(midpoint - leftValue) + EPSILON < dimension.minimumStep
        || Math.abs(rightValue - midpoint) + EPSILON < dimension.minimumStep
      ) continue;
      const values = { ...left.values, [dimension.control]: midpoint };
      const key = vectorKey(values);
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({
        candidateId: `refine:${dimension.control.toLowerCase()}:${midpoint.toFixed(3)}:${output.length + 1}`,
        values,
        changedControls: [dimension.control],
        rationale: `Bisect a rendered ${dimension.control} interval after coarse probes moved the target metric but caused collateral defining regressions; test the unresolved non-linear region before declaring the actuator exhausted.`,
      });
    }
  }
  return output;
};

export const planBoundedActuatorSearchV1 = (input: Readonly<{
  attempts: readonly ActuatorAttemptEvidenceV1[];
  instructions: readonly ConstructionControlInstructionV1[];
  dimensions: readonly ActuatorSearchDimensionV1[];
  maxCandidates?: number;
}>): BoundedActuatorSearchPlanV1 => {
  const retained = selectRetainedBestActuatorAttemptV1(input.attempts);
  const regressions = input.attempts.filter((attempt) =>
    attempt.attemptId !== retained.attemptId && compareAttempt(attempt, retained) < 0);
  // Every rejected render shrinks the local trust region, but never below 25%.
  // This makes the loop increasingly conservative instead of repeating larger
  // blind multipliers after a regression.
  const trustScale = Math.max(0.25, 1 / (1 + (regressions.length * 0.5)));
  // A certified retained render is the bounded correction loop's stop rule.
  // Continuing to probe after all defining invariants pass wastes AE renders
  // and risks replacing a proven professional-fidelity state with decoration.
  if (retained.certified) {
    return {
      schema: "editflow.bounded-actuator-search-plan.v1",
      retainedBestAttemptId: retained.attemptId,
      regressingAttemptIds: regressions.map((attempt) => attempt.attemptId),
      trustScale,
      candidates: [],
      exhaustedControls: [],
      metricResponses: [],
      synthesisRequiredInvariantIds: [],
    };
  }
  const seen = new Set(input.attempts.map((attempt) => vectorKey(attempt.values)));
  const candidates: ActuatorSearchCandidateV1[] = [];
  const exhausted = new Set<ConstructionControlKindV1>();
  const metricResponses: ActuatorMetricResponseV1[] = [];
  const maxCandidates = Math.max(1, Math.min(8, input.maxCandidates ?? 4));

  for (const dimension of input.dimensions) {
    if (candidates.length >= maxCandidates) break;
    if (dimension.maximum <= dimension.minimum || dimension.minimumStep <= 0) {
      throw new RangeError(`Invalid actuator search bounds for ${dimension.control}.`);
    }
    const base = controlValue(retained.values, dimension.control);
    if (base === null) {
      exhausted.add(dimension.control);
      continue;
    }
    const relevantInstructions = input.instructions.filter((item) =>
      item.defining && item.control === dimension.control);
    const targetMetrics = new Set(relevantInstructions.map((item) => deficitMetric(item)));
    const controlResponses: ActuatorMetricResponseV1[] = [];
    const assessedMetrics = new Set<string>();
    for (const instruction of relevantInstructions) {
      const targetMetric = deficitMetric(instruction);
      if (assessedMetrics.has(targetMetric)) continue;
      assessedMetrics.add(targetMetric);
      const response = metricResponseEvidence(retained, input.attempts, instruction);
      if (response !== null) {
        controlResponses.push(response);
        metricResponses.push(response);
      }
    }
    const allTargetMetricsAssessed = targetMetrics.size > 0
      && [...targetMetrics].every((metric) =>
        controlResponses.some((response) => response.metric === metric));
    const allTargetMetricsExhausted = allTargetMetricsAssessed
      && controlResponses.every((response) =>
        !response.responsive
        || (response.testedDirectionCount >= 2
          && response.safeImprovingProbeCount === 0
          && response.collateralRegressionProbeCount > 0));
    const nonlinearCollateral = controlResponses.some((response) =>
      response.responsive
      && response.safeImprovingProbeCount === 0
      && response.collateralRegressionProbeCount > 0);
    const refinements = nonlinearCollateral
      ? nonlinearIntervalRefinements(
          input.attempts,
          dimension,
          seen,
          maxCandidates - candidates.length,
        )
      : [];
    if (refinements.length > 0) {
      candidates.push(...refinements);
      // A three-or-more-point one-factor cohort can expose a narrow fidelity
      // basin even after the retained best moves to one end of the interval.
      // Refine the rendered intervals before extrapolating or declaring the
      // actuator exhausted; black-box visual response is not assumed monotonic.
      continue;
    }
    if (allTargetMetricsExhausted) {
      exhausted.add(dimension.control);
      continue;
    }

    const sensitivity = cleanSensitivity(retained, input.attempts, dimension.control);
    const requested = requestedDirections(input.instructions, dimension.control);
    // M6.7 is a local correction loop, not a generic parameter sweep. If the
    // comparator does not implicate this control and rendered history has not
    // established a causal response for it, leave the already-proven behavior
    // untouched.
    if (sensitivity === null && requested.length === 0) continue;
    let directions: readonly (-1 | 1)[];
    if (sensitivity !== null && Math.abs(sensitivity) > EPSILON) {
      directions = [sensitivity > 0 ? 1 : -1];
    } else if (requested.length > 0) {
      // The comparator says which semantic direction is needed, but until a
      // clean rendered probe proves the physical actuator is monotonic, keep a
      // smaller counter-probe available. Non-monotonic controls such as overlap
      // density often need this.
      directions = requested.length === 1
        ? [requested[0]!, (requested[0]! * -1) as -1 | 1]
        : requested;
    } else {
      directions = [1, -1];
    }

    let emittedForControl = false;
    const step = candidateStep(dimension, trustScale);
    for (const direction of directions) {
      if (candidates.length >= maxCandidates) break;
      const next = clampDimension(base + (direction * step), dimension);
      if (Math.abs(next - base) <= EPSILON) continue;
      const values = { ...retained.values, [dimension.control]: next };
      const key = vectorKey(values);
      if (seen.has(key)) continue;
      seen.add(key);
      emittedForControl = true;
      candidates.push({
        candidateId: `probe:${dimension.control.toLowerCase()}:${direction > 0 ? "up" : "down"}:${candidates.length + 1}`,
        values,
        changedControls: [dimension.control],
        rationale: sensitivity === null
          ? `Isolate ${dimension.control} in a bounded rendered probe; physical response is not yet proven monotonic.`
          : `Follow measured positive local sensitivity for ${dimension.control} while holding all other actuators at the retained-best state.`,
      });
    }
    if (!emittedForControl) exhausted.add(dimension.control);
  }

  // Only after one-factor candidates are available do we propose a coupled
  // candidate, and it uses half-steps to reduce interaction risk.
  if (candidates.length < maxCandidates && candidates.length >= 2) {
    const first = candidates[0]!;
    const second = candidates.find((candidate) =>
      candidate.changedControls[0] !== first.changedControls[0]);
    if (second !== undefined) {
      const values: Partial<Record<ConstructionControlKindV1, number>> = { ...retained.values };
      const changed: ConstructionControlKindV1[] = [];
      for (const source of [first, second]) {
        const control = source.changedControls[0]!;
        const dimension = input.dimensions.find((item) => item.control === control);
        const base = controlValue(retained.values, control);
        const target = controlValue(source.values, control);
        if (dimension === undefined || base === null || target === null) continue;
        values[control] = clampDimension(base + ((target - base) * 0.5), dimension);
        changed.push(control);
      }
      const key = vectorKey(values);
      if (changed.length === 2 && !seen.has(key)) {
        candidates.push({
          candidateId: `probe:coupled:${candidates.length + 1}`,
          values,
          changedControls: changed,
          rationale: "Test a conservative coupled interaction only after isolated actuator probes are available.",
        });
      }
    }
  }

  const synthesisRequiredInvariantIds = [...new Set(
    input.instructions
      .filter((instruction) => instruction.defining)
      .map((instruction) => instruction.invariantId),
  )].filter((invariantId) => {
    const controls = [...new Set(input.instructions
      .filter((instruction) => instruction.defining && instruction.invariantId === invariantId)
      .map((instruction) => instruction.control))];
    if (controls.length === 0) return false;
    return controls.every((control) =>
      (exhausted.has(control)
        || !input.dimensions.some((dimension) => dimension.control === control))
      && !candidates.some((candidate) => candidate.changedControls.includes(control)));
  });

  return {
    schema: "editflow.bounded-actuator-search-plan.v1",
    retainedBestAttemptId: retained.attemptId,
    regressingAttemptIds: regressions.map((attempt) => attempt.attemptId),
    trustScale,
    candidates: candidates.slice(0, maxCandidates),
    exhaustedControls: [...exhausted],
    metricResponses,
    synthesisRequiredInvariantIds,
  };
};
