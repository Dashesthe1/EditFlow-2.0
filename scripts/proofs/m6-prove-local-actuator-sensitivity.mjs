import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  planBoundedActuatorSearchV1,
  selectRetainedBestActuatorAttemptV1,
} from "../../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const argv = process.argv.slice(2);
const required = (name) => {
  const index = argv.indexOf(name);
  if (index < 0 || index + 1 >= argv.length) throw new Error(`Missing ${name}`);
  return argv[index + 1];
};
const planPath = path.resolve(required("--search-plan"));
const fidelityPrefix = path.resolve(required("--fidelity-prefix"));
const tag = required("--tag");
const outputPath = path.resolve(required("--output"));
const load = async (file) => JSON.parse(await readFile(file, "utf8"));

const sourcePlan = await load(planPath);
if (sourcePlan.schema !== "editflow.m6.ae-shutter-search-plan.v1") {
  throw new Error("Unexpected search-plan schema.");
}
const template = sourcePlan.cases?.find((item) => item.tag === tag)
  ?? sourcePlan.retainedCases?.find((item) => item.tag === tag);
if (template === undefined) throw new Error(`Search plan has no case ${tag}.`);

const vectorFromPhysical = (state) => ({
  TEMPORAL_COPY_COUNT: state.copyCount,
  TEMPORAL_FRAGMENT_DENSITY: state.fragmentBandCount,
  TEMPORAL_BAND_MIX: state.timeDisplacementFrames ?? 0,
  DUPLICATE_OPACITY: state.duplicateOpacityPct,
  DUPLICATE_SPREAD: state.duplicateSpreadPx,
  MOTION_IMPULSE: state.motionImpulsePx,
  RECOVERY_DURATION: state.postCutFrames,
});
const metricValuesFrom = (comparison) => Object.fromEntries(comparison.metrics
  .filter((metric) => typeof metric.renderValue === "number" && Number.isFinite(metric.renderValue))
  .map((metric) => [metric.metric, metric.renderValue]));

const attempts = [];
for (let index = 0; index < sourcePlan.combinedCandidates.length; index += 1) {
  const candidate = sourcePlan.combinedCandidates[index];
  if (Array.isArray(candidate.changedTags) && !candidate.changedTags.includes(tag)) continue;
  const physicalCase = candidate.cases?.find((item) => item.tag === tag);
  if (physicalCase === undefined) continue;
  const ordinal = String(index + 1).padStart(2, "0");
  const fidelityPath = `${fidelityPrefix}${ordinal}-${tag}-fidelity.json`;
  const proof = await load(fidelityPath);
  if (proof.schema !== "editflow.m6.local-shutter-fidelity-proof.v1") {
    throw new Error(`Unexpected local fidelity schema in ${fidelityPath}.`);
  }
  attempts.push({
    attemptId: candidate.candidateId,
    ordinal: index + 1,
    fidelityPath,
    physicalState: physicalCase.physicalState,
    proof,
    evidence: {
      attemptId: candidate.candidateId,
      values: vectorFromPhysical(physicalCase.physicalState),
      metricValues: metricValuesFrom(proof.comparison),
      weightedFidelity: proof.comparison.weightedFidelity,
      definingCoverage: proof.comparison.definingCoverage,
      certified: proof.gate.certified,
      residualInvariantIds: proof.gate.underDrivenInvariantIds,
    },
  });
}
if (attempts.length < 2) throw new Error("Need at least two rendered attempts.");

const retainedEvidence = selectRetainedBestActuatorAttemptV1(attempts.map((item) => item.evidence));
const retained = attempts.find((item) => item.evidence.attemptId === retainedEvidence.attemptId);
if (retained === undefined) throw new Error("Retained attempt lookup failed.");

const dimensions = [
  { control: "TEMPORAL_FRAGMENT_DENSITY", minimum: 1, maximum: 9, minimumStep: 1, integer: true },
  { control: "TEMPORAL_BAND_MIX", minimum: 0, maximum: 3, minimumStep: 0.5 },
  { control: "DUPLICATE_SPREAD", minimum: 20, maximum: 220, minimumStep: 8 },
  { control: "TEMPORAL_COPY_COUNT", minimum: 2, maximum: 6, minimumStep: 1, integer: true },
  { control: "DUPLICATE_OPACITY", minimum: 20, maximum: 100, minimumStep: 4 },
];
const search = planBoundedActuatorSearchV1({
  attempts: attempts.map((item) => item.evidence),
  instructions: retained.proof.actuationPlan.instructions,
  dimensions,
  maxCandidates: 8,
});

const output = {
  schema: "editflow.m6.local-actuator-sensitivity-proof.v1",
  generatedAt: new Date().toISOString(),
  result: "MEASURED",
  tag,
  sourceSearchPlan: path.relative(process.cwd(), planPath).replaceAll("\\", "/"),
  fidelityPrefix: path.relative(process.cwd(), fidelityPrefix).replaceAll("\\", "/"),
  retainedAttemptId: retained.evidence.attemptId,
  retained: {
    ordinal: retained.ordinal,
    physicalState: retained.physicalState,
    weightedFidelity: retained.evidence.weightedFidelity,
    definingCoverage: retained.evidence.definingCoverage,
    residualInvariantIds: retained.evidence.residualInvariantIds,
    metricValues: retained.evidence.metricValues,
  },
  attempts: attempts.map((item) => ({
    attemptId: item.evidence.attemptId,
    ordinal: item.ordinal,
    physicalState: item.physicalState,
    weightedFidelity: item.evidence.weightedFidelity,
    definingCoverage: item.evidence.definingCoverage,
    residualInvariantIds: item.evidence.residualInvariantIds,
    metricValues: item.evidence.metricValues,
  })),
  metricResponses: search.metricResponses,
  exhaustedControls: search.exhaustedControls,
  nextCandidates: search.candidates,
  conclusion: search.metricResponses.some((item) => !item.responsive)
    ? "ONE_OR_MORE_ACTUATOR_METRIC_PAIRS_PROVEN_NON_RESPONSIVE"
    : "NO_NON_RESPONSIVE_PAIR_PROVEN",
  evidenceBoundary: [
    "Only clean rendered one-control counterfactual pairs are allowed to establish metric response.",
    "A non-responsive pair requires the observed metric span to remain below five percent of the retained reference deficit.",
    "This proof does not weaken the fidelity threshold; it stops futile rerenders and preserves the unresolved visual deficit.",
  ],
};
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  ok: true,
  output: outputPath,
  tag,
  retainedAttemptId: output.retainedAttemptId,
  metricResponses: output.metricResponses,
  exhaustedControls: output.exhaustedControls,
  nextCandidates: output.nextCandidates.map((item) => ({
    candidateId: item.candidateId,
    changedControls: item.changedControls,
    values: item.values,
  })),
}));
