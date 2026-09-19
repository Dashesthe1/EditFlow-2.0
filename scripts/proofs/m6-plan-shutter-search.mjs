import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  planBoundedActuatorSearchV1,
} from "../../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const argv = process.argv.slice(2);
const required = (name) => {
  const index = argv.indexOf(name);
  if (index < 0 || index + 1 >= argv.length) throw new Error(`Missing ${name}`);
  return path.resolve(argv[index + 1]);
};
const load = async (file) => JSON.parse(await readFile(file, "utf8"));
const proofPath = required("--correction-proof");
const statePath = required("--actuator-state");
const outputPath = required("--output");
const proof = await load(proofPath);
const state = await load(statePath);

if (proof.schema !== "editflow.m6.real-rendered-correction-proof.v1") {
  throw new Error("Unexpected correction proof schema.");
}
if (state.schema !== "editflow.m6.ae-shutter-actuator-state.v1") {
  throw new Error("Unexpected actuator state schema.");
}
const retainedLabel = proof.retainedBestPassLabel ?? proof.passes.at(-1)?.label;
const retained = proof.passes.find((item) => item.label === retainedLabel);
if (!retained) throw new Error("Retained rendered pass is unavailable.");
if (state.passLabel !== retainedLabel) {
  throw new Error(`Actuator state ${state.passLabel} does not match retained pass ${retainedLabel}.`);
}
const stateByReference = new Map(state.cases.map((item) => [item.referenceIndex, item]));

const dimensions = [
  { control: "DUPLICATE_OPACITY", minimum: 20, maximum: 100, minimumStep: 4 },
  { control: "DUPLICATE_SPREAD", minimum: 20, maximum: 220, minimumStep: 8 },
];
const physicalToVector = (physical) => ({
  DUPLICATE_OPACITY: physical.duplicateOpacityPct,
  DUPLICATE_SPREAD: physical.duplicateSpreadPx,
  MOTION_IMPULSE: physical.motionImpulsePx,
  RECOVERY_DURATION: physical.postCutFrames,
  TEMPORAL_COPY_COUNT: physical.copyCount,
});
const vectorToPhysical = (base, vector) => ({
  ...base,
  duplicateOpacityPct: vector.DUPLICATE_OPACITY ?? base.duplicateOpacityPct,
  duplicateSpreadPx: vector.DUPLICATE_SPREAD ?? base.duplicateSpreadPx,
  motionImpulsePx: vector.MOTION_IMPULSE ?? base.motionImpulsePx,
  postCutFrames: vector.RECOVERY_DURATION ?? base.postCutFrames,
  copyCount: vector.TEMPORAL_COPY_COUNT ?? base.copyCount,
});
const requestedDirectionFor = (instructions, control) => {
  const found = instructions.find((item) => item.defining && item.control === control);
  return found?.direction ?? "SET";
};
const directionOf = (value, base) => value > base ? "INCREASE" : value < base ? "DECREASE" : "SET";

const cases = retained.cases.map((result) => {
  const physical = stateByReference.get(result.referenceIndex);
  if (!physical) throw new Error(`Missing physical actuator state for reference index ${result.referenceIndex}.`);
  const baseVector = physicalToVector(physical.current);
  const search = planBoundedActuatorSearchV1({
    attempts: [{
      attemptId: retainedLabel,
      values: baseVector,
      weightedFidelity: result.comparison.weightedFidelity,
      definingCoverage: result.comparison.definingCoverage,
      certified: result.gate?.certified ?? false,
      residualInvariantIds: result.gate?.underDrivenInvariantIds ?? [],
    }],
    instructions: result.actuationPlan?.instructions ?? [],
    dimensions,
    maxCandidates: 4,
  });
  const candidates = search.candidates.map((candidate) => {
    const control = candidate.changedControls[0];
    const baseValue = baseVector[control];
    const nextValue = candidate.values[control];
    const requested = requestedDirectionFor(result.actuationPlan?.instructions ?? [], control);
    const actualDirection = directionOf(nextValue, baseValue);
    return {
      ...candidate,
      control,
      actualDirection,
      relationToComparatorRequest: actualDirection === requested ? "REQUESTED" : "COUNTER_PROBE",
      physicalState: vectorToPhysical(physical.current, candidate.values),
    };
  });
  return {
    referenceIndex: result.referenceIndex,
    tag: physical.tag,
    cutSeconds: physical.cutSeconds,
    outgoingLayer: physical.outgoingLayer,
    incomingLayer: physical.incomingLayer,
    retainedComparison: {
      weightedFidelity: result.comparison.weightedFidelity,
      definingCoverage: result.comparison.definingCoverage,
      residualInvariantIds: result.gate?.underDrivenInvariantIds ?? [],
    },
    basePhysicalState: physical.current,
    search: {
      ...search,
      candidates,
    },
  };
});

const combined = [];
for (const control of ["DUPLICATE_OPACITY", "DUPLICATE_SPREAD"]) {
  for (const relation of ["REQUESTED", "COUNTER_PROBE"]) {
    const selected = cases.map((item) => {
      const candidate = item.search.candidates.find((entry) =>
        entry.control === control && entry.relationToComparatorRequest === relation);
      return candidate ? {
        referenceIndex: item.referenceIndex,
        tag: item.tag,
        cutSeconds: item.cutSeconds,
        outgoingLayer: item.outgoingLayer,
        incomingLayer: item.incomingLayer,
        physicalState: candidate.physicalState,
      } : null;
    });
    if (selected.every(Boolean)) {
      combined.push({
        candidateId: `shutter-search:${control.toLowerCase()}:${relation.toLowerCase()}`,
        control,
        relationToComparatorRequest: relation,
        cases: selected,
      });
    }
  }
}

const output = {
  schema: "editflow.m6.ae-shutter-search-plan.v1",
  generatedAt: new Date().toISOString(),
  sourceCorrectionProof: path.relative(process.cwd(), proofPath).replaceAll("\\", "/"),
  sourceActuatorState: path.relative(process.cwd(), statePath).replaceAll("\\", "/"),
  retainedBestPassLabel: retainedLabel,
  cases,
  combinedCandidates: combined,
  guardrails: [
    "Every probe starts from the retained-best rendered physical state.",
    "Only one actuator class changes per combined candidate.",
    "Requested and counter probes are both rendered until local monotonicity is proven.",
    "No probe becomes the new state unless rendered defining coverage/fidelity improves.",
  ],
};
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  ok: true,
  output: outputPath,
  retainedBestPassLabel: retainedLabel,
  combinedCandidates: combined.map((item) => ({
    candidateId: item.candidateId,
    states: item.cases.map((entry) => ({
      referenceIndex: entry.referenceIndex,
      physicalState: entry.physicalState,
    })),
  })),
}));
