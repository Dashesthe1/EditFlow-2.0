import assert from "node:assert/strict";
import test from "node:test";

import {
  planBoundedActuatorSearchV1,
  selectRetainedBestActuatorAttemptV1,
} from "../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const instruction = (control, direction = "INCREASE") => ({
  instructionId: `instruction:${control.toLowerCase()}`,
  invariantId: "shutter.overlap",
  nodeId: "node:temporal-duplicates",
  metric: control === "DUPLICATE_SPREAD" ? "stateSeparationPeak" : "overlapDensityPeak",
  deficitMetric: "overlapDensityPeak",
  deficitReferenceValue: 0.4,
  deficitRenderValue: 0.2,
  control,
  direction,
  referenceValue: 0.4,
  renderValue: 0.2,
  multiplier: 2,
  normalizedError: 0.3,
  defining: true,
  rationale: "Rendered defining behavior is under-driven.",
});

const attempt = (
  attemptId,
  values,
  definingCoverage,
  weightedFidelity,
  certified = false,
  metricValues = undefined,
  residualInvariantIds = undefined,
) => ({
  attemptId,
  values,
  metricValues,
  definingCoverage,
  weightedFidelity,
  certified,
  residualInvariantIds: residualInvariantIds ?? (certified ? [] : ["shutter.overlap"]),
});

test("M6.7 actuator retention is lexicographic and never replaces better defining coverage with decoration", () => {
  const retained = selectRetainedBestActuatorAttemptV1([
    attempt("pass-1", { DUPLICATE_OPACITY: 70 }, 0.6, 0.98),
    attempt("pass-2", { DUPLICATE_OPACITY: 80 }, 0.8, 0.90),
    attempt("pass-3", { DUPLICATE_OPACITY: 100 }, 0.6, 0.995),
  ]);
  assert.equal(retained.attemptId, "pass-2");
});

test("M6.7 bounded actuator search turns confounded regressions into isolated causal probes", () => {
  const retained = attempt("pass-3", {
    DUPLICATE_OPACITY: 80,
    DUPLICATE_SPREAD: 112,
    MOTION_IMPULSE: 190,
  }, 0.8, 0.95);
  const plan = planBoundedActuatorSearchV1({
    attempts: [
      retained,
      attempt("pass-4", {
        DUPLICATE_OPACITY: 100,
        DUPLICATE_SPREAD: 156,
        MOTION_IMPULSE: 190,
      }, 0.6, 0.86),
      attempt("pass-5", {
        DUPLICATE_OPACITY: 100,
        DUPLICATE_SPREAD: 180,
        MOTION_IMPULSE: 205,
      }, 0.6, 0.85),
    ],
    instructions: [
      instruction("DUPLICATE_OPACITY"),
      instruction("DUPLICATE_SPREAD"),
    ],
    dimensions: [
      { control: "DUPLICATE_OPACITY", minimum: 20, maximum: 100, minimumStep: 4 },
      { control: "DUPLICATE_SPREAD", minimum: 20, maximum: 220, minimumStep: 8 },
    ],
    maxCandidates: 4,
  });

  assert.equal(plan.retainedBestAttemptId, "pass-3");
  assert.deepEqual(plan.regressingAttemptIds, ["pass-4", "pass-5"]);
  assert.ok(plan.trustScale < 1);
  assert.equal(plan.candidates.length, 4);
  assert.ok(plan.candidates.every((candidate) => candidate.changedControls.length === 1));

  const opacityValues = plan.candidates
    .filter((candidate) => candidate.changedControls[0] === "DUPLICATE_OPACITY")
    .map((candidate) => candidate.values.DUPLICATE_OPACITY);
  assert.ok(opacityValues.some((value) => value > 80));
  assert.ok(opacityValues.some((value) => value < 80));

  const spreadValues = plan.candidates
    .filter((candidate) => candidate.changedControls[0] === "DUPLICATE_SPREAD")
    .map((candidate) => candidate.values.DUPLICATE_SPREAD);
  assert.ok(spreadValues.some((value) => value > 112));
  assert.ok(spreadValues.some((value) => value < 112));
});

test("M6.7 rendered one-factor evidence converts an uncertain actuator into a directional local search", () => {
  const plan = planBoundedActuatorSearchV1({
    attempts: [
      attempt("opacity-70", { DUPLICATE_OPACITY: 70, DUPLICATE_SPREAD: 112 }, 0.6, 0.89),
      attempt("opacity-80", { DUPLICATE_OPACITY: 80, DUPLICATE_SPREAD: 112 }, 0.8, 0.94),
    ],
    instructions: [instruction("DUPLICATE_OPACITY")],
    dimensions: [
      { control: "DUPLICATE_OPACITY", minimum: 20, maximum: 100, minimumStep: 4 },
    ],
    maxCandidates: 2,
  });
  assert.equal(plan.retainedBestAttemptId, "opacity-80");
  assert.equal(plan.candidates.length, 1);
  assert.ok(plan.candidates[0].values.DUPLICATE_OPACITY > 80);
  assert.match(plan.candidates[0].rationale, /measured positive local sensitivity/);
});

test("M6.7 stops rendering actuator/metric pairs that clean probes prove non-responsive", () => {
  const baseValues = {
    DUPLICATE_OPACITY: 80,
    TEMPORAL_FRAGMENT_DENSITY: 3,
    TEMPORAL_COPY_COUNT: 2,
  };
  const opacityProbeBase = { ...baseValues, TEMPORAL_COPY_COUNT: 3 };
  const metric = (overlap) => ({
    overlapDensityPeak: overlap,
    stateSeparationPeak: 0.08,
  });
  const plan = planBoundedActuatorSearchV1({
    attempts: [
      attempt("best", baseValues, 0.8, 0.95, false, metric(0.05)),
      attempt("opacity-up", { ...opacityProbeBase, DUPLICATE_OPACITY: 84 }, 0.8, 0.94, false, metric(0.052)),
      attempt("opacity-down", { ...opacityProbeBase, DUPLICATE_OPACITY: 76 }, 0.8, 0.93, false, metric(0.049)),
      attempt("density-up", { ...baseValues, TEMPORAL_FRAGMENT_DENSITY: 5 }, 0.8, 0.94, false, metric(0.12)),
      attempt("density-down", { ...baseValues, TEMPORAL_FRAGMENT_DENSITY: 2 }, 0.8, 0.90, false, metric(0.02)),
    ],
    instructions: [
      instruction("DUPLICATE_OPACITY"),
      instruction("TEMPORAL_FRAGMENT_DENSITY"),
    ],
    dimensions: [
      { control: "DUPLICATE_OPACITY", minimum: 20, maximum: 100, minimumStep: 4 },
      { control: "TEMPORAL_FRAGMENT_DENSITY", minimum: 1, maximum: 9, minimumStep: 1, integer: true },
    ],
    maxCandidates: 4,
  });

  const opacityResponse = plan.metricResponses.find((item) =>
    item.control === "DUPLICATE_OPACITY" && item.metric === "overlapDensityPeak");
  assert.ok(opacityResponse);
  assert.equal(opacityResponse.probeCount, 2);
  assert.equal(opacityResponse.responsive, false);
  assert.ok(opacityResponse.responseRatio < 0.05);
  assert.ok(plan.exhaustedControls.includes("DUPLICATE_OPACITY"));
  assert.ok(plan.candidates.every((candidate) =>
    !candidate.changedControls.includes("DUPLICATE_OPACITY")));

  const densityResponse = plan.metricResponses.find((item) =>
    item.control === "TEMPORAL_FRAGMENT_DENSITY" && item.metric === "overlapDensityPeak");
  assert.ok(densityResponse);
  assert.equal(densityResponse.responsive, true);
  assert.equal(densityResponse.safeResponsive, true);
  assert.ok(densityResponse.safeImprovingProbeCount >= 1);
  assert.ok(!plan.exhaustedControls.includes("TEMPORAL_FRAGMENT_DENSITY"));
  assert.ok(plan.candidates.some((candidate) =>
    candidate.changedControls.includes("TEMPORAL_FRAGMENT_DENSITY")));
});

test("M6.7 rejects a target-responsive actuator when every improving probe sacrifices retained defining behavior", () => {
  const values = { DUPLICATE_OPACITY: 80 };
  const metric = (overlap) => ({ overlapDensityPeak: overlap, stateSeparationPeak: 0.02 });
  const plan = planBoundedActuatorSearchV1({
    attempts: [
      attempt("best", values, 0.833, 0.94, false, metric(0.10), ["shutter.overlap"]),
      attempt("unsafe-up", { DUPLICATE_OPACITY: 84 }, 0.667, 0.90, false, metric(0.22),
        ["shutter.overlap", "shutter.coordination"]),
      attempt("unsafe-down", { DUPLICATE_OPACITY: 76 }, 0.667, 0.89, false, metric(0.18),
        ["shutter.overlap", "shutter.coordination"]),
    ],
    instructions: [instruction("DUPLICATE_OPACITY")],
    dimensions: [
      { control: "DUPLICATE_OPACITY", minimum: 20, maximum: 100, minimumStep: 4 },
    ],
    maxCandidates: 2,
  });

  const response = plan.metricResponses.find((item) =>
    item.control === "DUPLICATE_OPACITY" && item.metric === "overlapDensityPeak");
  assert.ok(response);
  assert.equal(response.responsive, true, "the actuator really does move the requested viewer-visible metric");
  assert.equal(response.testedDirectionCount, 2);
  assert.equal(response.safeImprovingProbeCount, 0);
  assert.equal(response.collateralRegressionProbeCount, 2);
  assert.equal(response.safeResponsive, false,
    "raw responsiveness cannot pass M6 anti-simplification when it breaks another defining invariant");
  assert.ok(plan.exhaustedControls.includes("DUPLICATE_OPACITY"));
  assert.deepEqual(plan.candidates, []);
  assert.deepEqual(plan.synthesisRequiredInvariantIds, ["shutter.overlap"]);
});

test("M6.7 does not exhaust an actuator from one-factor probes collected around an obsolete baseline", () => {
  const metric = (overlap) => ({ overlapDensityPeak: overlap, stateSeparationPeak: 0.02 });
  const retainedValues = {
    TEMPORAL_FRAGMENT_DENSITY: 3,
    DUPLICATE_SPREAD: 36,
  };
  const plan = planBoundedActuatorSearchV1({
    attempts: [
      attempt("retained", retainedValues, 0.833, 0.99, false, metric(0.042), ["shutter.overlap"]),
      attempt("old-spread-up", {
        TEMPORAL_FRAGMENT_DENSITY: 5,
        DUPLICATE_SPREAD: 52,
      }, 0.833, 0.96, false, metric(0.052), ["shutter.displacement"]),
      attempt("old-spread-down", {
        TEMPORAL_FRAGMENT_DENSITY: 5,
        DUPLICATE_SPREAD: 20,
      }, 0.667, 0.86, false, metric(0.018), ["shutter.overlap", "shutter.coordination"]),
    ],
    instructions: [instruction("DUPLICATE_SPREAD")],
    dimensions: [
      { control: "DUPLICATE_SPREAD", minimum: 20, maximum: 220, minimumStep: 8 },
    ],
    maxCandidates: 2,
  });

  const response = plan.metricResponses.find((item) =>
    item.control === "DUPLICATE_SPREAD" && item.metric === "overlapDensityPeak");
  assert.ok(response);
  assert.equal(response.responsive, true,
    "the old same-baseline pair remains valid evidence that spread moves overlap");
  assert.equal(response.testedDirectionCount, 0,
    "neither old probe is a clean counterfactual around the new retained baseline");
  assert.equal(response.collateralRegressionProbeCount, 0);
  assert.ok(!plan.exhaustedControls.includes("DUPLICATE_SPREAD"));
  assert.ok(plan.candidates.some((candidate) =>
    candidate.changedControls.length === 1
    && candidate.changedControls[0] === "DUPLICATE_SPREAD"));
});


test("M6.7 bisects unresolved non-linear actuator intervals before declaring synthesis", () => {
  const spreadInstruction = {
    ...instruction("DUPLICATE_SPREAD"),
    deficitReferenceValue: 0.055,
    deficitRenderValue: 0.042,
    referenceValue: 0.0217,
    renderValue: 0.0200,
  };
  const metric = (overlap, separation) => ({
    overlapDensityPeak: overlap,
    stateSeparationPeak: separation,
  });
  const plan = planBoundedActuatorSearchV1({
    attempts: [
      attempt("retained-center", {
        TEMPORAL_FRAGMENT_DENSITY: 5,
        DUPLICATE_SPREAD: 36,
      }, 0.833, 0.992, false, metric(0.029, 0.0200),
        ["shutter.overlap", "shutter.coordination"]),
      attempt("cohort-low", {
        TEMPORAL_FRAGMENT_DENSITY: 5,
        DUPLICATE_SPREAD: 20,
      }, 0.667, 0.860, false, metric(0.018, 0.0197),
        ["shutter.overlap", "shutter.coordination"]),
      attempt("cohort-high", {
        TEMPORAL_FRAGMENT_DENSITY: 5,
        DUPLICATE_SPREAD: 52,
      }, 0.833, 0.965, false, metric(0.052, 0.0373),
        ["shutter.displacement"]),
    ],
    instructions: [spreadInstruction],
    dimensions: [
      { control: "DUPLICATE_SPREAD", minimum: 20, maximum: 220, minimumStep: 8 },
    ],
    maxCandidates: 4,
  });

  assert.equal(plan.retainedBestAttemptId, "retained-center");
  assert.ok(!plan.exhaustedControls.includes("DUPLICATE_SPREAD"));
  const refinements = plan.candidates
    .filter((candidate) => candidate.candidateId.startsWith("refine:duplicate_spread"))
    .map((candidate) => ({
      spread: candidate.values.DUPLICATE_SPREAD,
      density: candidate.values.TEMPORAL_FRAGMENT_DENSITY,
    }));
  assert.deepEqual(refinements, [
    { spread: 28, density: 5 },
    { spread: 44, density: 5 },
  ]);
  assert.deepEqual(plan.synthesisRequiredInvariantIds, []);
});

test("M6.7 refines a three-point interval even when the retained best moved to an endpoint", () => {
  const geometryInstruction = {
    ...instruction("DUPLICATE_SPREAD", "DECREASE"),
    invariantId: "shutter.displacement",
    metric: "stateSeparationPeak",
    deficitMetric: "stateSeparationPeak",
    deficitReferenceValue: 0.0217,
    deficitRenderValue: 0.0373,
    referenceValue: 0.0217,
    renderValue: 0.0373,
  };
  const metric = (separation) => ({ stateSeparationPeak: separation });
  const plan = planBoundedActuatorSearchV1({
    attempts: [
      attempt("cohort-low", { DUPLICATE_SPREAD: 20 }, 0.667, 0.860, false,
        metric(0.0197), ["shutter.coordination", "shutter.overlap"]),
      attempt("cohort-mid", { DUPLICATE_SPREAD: 36 }, 0.667, 0.850, false,
        metric(0.0200), ["shutter.coordination", "shutter.overlap"]),
      attempt("retained-high", { DUPLICATE_SPREAD: 52 }, 0.833, 0.965, false,
        metric(0.0373), ["shutter.displacement"]),
    ],
    instructions: [geometryInstruction],
    dimensions: [
      { control: "DUPLICATE_SPREAD", minimum: 20, maximum: 220, minimumStep: 8 },
    ],
    maxCandidates: 4,
  });

  assert.equal(plan.retainedBestAttemptId, "retained-high");
  assert.deepEqual(
    plan.candidates.map((candidate) => candidate.values.DUPLICATE_SPREAD),
    [28, 44],
  );
  assert.ok(plan.candidates.every((candidate) =>
    candidate.candidateId.startsWith("refine:duplicate_spread")));
  assert.deepEqual(plan.synthesisRequiredInvariantIds, []);
});

test("M6.7 escalates a defining invariant to synthesis when every mapped actuator is causally exhausted", () => {
  const values = { DUPLICATE_OPACITY: 80, DUPLICATE_SPREAD: 96 };
  const metric = (overlap) => ({ overlapDensityPeak: overlap, stateSeparationPeak: 0.08 });
  const plan = planBoundedActuatorSearchV1({
    attempts: [
      attempt("best", values, 0.833, 0.96, false, metric(0.12)),
      attempt("opacity-up", { ...values, DUPLICATE_OPACITY: 84 }, 0.833, 0.95, false, metric(0.121)),
      attempt("opacity-down", { ...values, DUPLICATE_OPACITY: 76 }, 0.833, 0.95, false, metric(0.119)),
      attempt("spread-up", { ...values, DUPLICATE_SPREAD: 104 }, 0.833, 0.95, false, metric(0.122)),
      attempt("spread-down", { ...values, DUPLICATE_SPREAD: 88 }, 0.833, 0.95, false, metric(0.118)),
    ],
    instructions: [instruction("DUPLICATE_OPACITY"), instruction("DUPLICATE_SPREAD")],
    dimensions: [
      { control: "DUPLICATE_OPACITY", minimum: 20, maximum: 100, minimumStep: 4 },
      { control: "DUPLICATE_SPREAD", minimum: 20, maximum: 220, minimumStep: 8 },
    ],
    maxCandidates: 4,
  });
  assert.deepEqual(plan.candidates, []);
  assert.ok(plan.exhaustedControls.includes("DUPLICATE_OPACITY"));
  assert.ok(plan.exhaustedControls.includes("DUPLICATE_SPREAD"));
  assert.deepEqual(plan.synthesisRequiredInvariantIds, ["shutter.overlap"]);
});

test("M6.7 can probe temporal band mixing as a direct overlap actuator without altering spatial geometry", () => {
  const plan = planBoundedActuatorSearchV1({
    attempts: [attempt("best", {
      TEMPORAL_BAND_MIX: 0,
      DUPLICATE_SPREAD: 96,
    }, 0.833, 0.962)],
    instructions: [instruction("TEMPORAL_BAND_MIX")],
    dimensions: [
      { control: "TEMPORAL_BAND_MIX", minimum: 0, maximum: 3, minimumStep: 0.5 },
      { control: "DUPLICATE_SPREAD", minimum: 20, maximum: 220, minimumStep: 8 },
    ],
    maxCandidates: 2,
  });
  assert.ok(plan.candidates.length >= 1);
  assert.ok(plan.candidates.every((candidate) =>
    candidate.changedControls.length === 1
    && candidate.changedControls[0] === "TEMPORAL_BAND_MIX"));
  assert.ok(plan.candidates.some((candidate) => (candidate.values.TEMPORAL_BAND_MIX ?? 0) > 0));
  assert.ok(plan.candidates.every((candidate) => candidate.values.DUPLICATE_SPREAD === 96));
});

test("M6.7 stops the bounded render loop immediately when the retained state is certified", () => {
  const plan = planBoundedActuatorSearchV1({
    attempts: [
      attempt("certified", { DUPLICATE_SPREAD: 44 }, 1, 1, true, { overlapDensityPeak: 0.047 }, []),
      attempt("older-fail", { DUPLICATE_SPREAD: 36 }, 0.833, 0.99, false,
        { overlapDensityPeak: 0.042 }, ["shutter.overlap"]),
    ],
    instructions: [instruction("DUPLICATE_SPREAD")],
    dimensions: [
      { control: "DUPLICATE_SPREAD", minimum: 20, maximum: 220, minimumStep: 8 },
    ],
    maxCandidates: 4,
  });

  assert.equal(plan.retainedBestAttemptId, "certified");
  assert.deepEqual(plan.candidates, []);
  assert.deepEqual(plan.synthesisRequiredInvariantIds, []);
  assert.deepEqual(plan.metricResponses, []);
});

test("M6.7 actuator search leaves unimplicated controls untouched", () => {
  const plan = planBoundedActuatorSearchV1({
    attempts: [
      attempt("best", {
        DUPLICATE_SPREAD: 100,
        BLUR_STRENGTH: 25,
      }, 0.6, 0.90),
    ],
    instructions: [instruction("DUPLICATE_SPREAD")],
    dimensions: [
      { control: "DUPLICATE_SPREAD", minimum: 20, maximum: 220, minimumStep: 8 },
      { control: "BLUR_STRENGTH", minimum: 0, maximum: 100, minimumStep: 5 },
    ],
    maxCandidates: 4,
  });
  assert.ok(plan.candidates.length > 0);
  assert.ok(plan.candidates.every((candidate) =>
    !candidate.changedControls.includes("BLUR_STRENGTH")));
});

test("M6.7 actuator search never repeats already-rendered control vectors", () => {
  const plan = planBoundedActuatorSearchV1({
    attempts: [
      attempt("best", { DUPLICATE_OPACITY: 80 }, 0.8, 0.95),
      attempt("seen-up", { DUPLICATE_OPACITY: 84 }, 0.7, 0.90),
      attempt("seen-down", { DUPLICATE_OPACITY: 76 }, 0.7, 0.90),
    ],
    instructions: [instruction("DUPLICATE_OPACITY")],
    dimensions: [
      { control: "DUPLICATE_OPACITY", minimum: 20, maximum: 100, minimumStep: 4 },
    ],
    maxCandidates: 4,
  });
  const seen = new Set(["80.000", "84.000", "76.000"]);
  for (const candidate of plan.candidates) {
    assert.ok(!seen.has(candidate.values.DUPLICATE_OPACITY.toFixed(3)));
  }
});
