import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  planBoundedActuatorSearchV1,
  selectRetainedBestActuatorAttemptV1,
} from "../../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const argv = process.argv.slice(2);
const required = (name) => {
  const index = argv.indexOf(name);
  if (index < 0 || index + 1 >= argv.length) throw new Error("Missing " + name);
  return argv[index + 1];
};
const optionalInt = (name, fallback, low, high) => {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(argv[index + 1]);
  if (!Number.isInteger(value) || value < low || value > high) {
    throw new Error("Invalid " + name);
  }
  return value;
};
const seedPlanPath = path.resolve(required("--seed-plan"));
const seedCandidateId = required("--seed-candidate-id");
const referenceEvidencePath = path.resolve(required("--reference-evidence"));
const outputPath = path.resolve(required("--output"));
const workDir = path.resolve(required("--work-dir"));
const maxCorrectionRounds = optionalInt("--max-correction-rounds", 2, 1, 4);
const maxCandidates = optionalInt("--max-candidates", 4, 1, 8);
const localWindowMs = 700;
const renderEndSeconds = 0.683;

const load = async (file) => JSON.parse(await readFile(file, "utf8"));
const save = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + "\n", "utf8");
};
const relative = (file) => path.relative(process.cwd(), file).replaceAll("\\", "/");
const safe = (value) => String(value).replace(/[^A-Za-z0-9_-]/g, "_");
const sha256File = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(command + " failed (" + result.status + "): " + (result.stderr || result.stdout));
  }
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
};
const metricValuesFrom = (comparison) => Object.fromEntries(
  comparison.metrics
    .filter((metric) => typeof metric.renderValue === "number" && Number.isFinite(metric.renderValue))
    .map((metric) => [metric.metric, metric.renderValue]),
);
const vectorFromPhysical = (state) => ({
  TEMPORAL_COPY_COUNT: state.copyCount,
  TEMPORAL_FRAGMENT_DENSITY: state.fragmentBandCount,
  DUPLICATE_OPACITY: state.duplicateOpacityPct,
  DUPLICATE_SPREAD: state.duplicateSpreadPx,
  MOTION_IMPULSE: state.motionImpulsePx,
  RECOVERY_DURATION: state.postCutFrames,
});
const physicalFromVector = (base, values) => ({
  ...base,
  copyCount: values.TEMPORAL_COPY_COUNT ?? base.copyCount,
  fragmentBandCount: values.TEMPORAL_FRAGMENT_DENSITY ?? base.fragmentBandCount,
  duplicateOpacityPct: values.DUPLICATE_OPACITY ?? base.duplicateOpacityPct,
  duplicateSpreadPx: values.DUPLICATE_SPREAD ?? base.duplicateSpreadPx,
  motionImpulsePx: values.MOTION_IMPULSE ?? base.motionImpulsePx,
  postCutFrames: values.RECOVERY_DURATION ?? base.postCutFrames,
});

const SEARCH_DIMENSIONS = [
  { control: "DUPLICATE_SPREAD", minimum: 20, maximum: 220, minimumStep: 8 },
  { control: "TEMPORAL_FRAGMENT_DENSITY", minimum: 1, maximum: 9, minimumStep: 1, integer: true },
  { control: "TEMPORAL_COPY_COUNT", minimum: 2, maximum: 6, minimumStep: 1, integer: true },
  { control: "DUPLICATE_OPACITY", minimum: 20, maximum: 100, minimumStep: 4 },
];
const adaptInstructionsToPhysicalShutter = (instructions) => {
  const directSpreadKeys = new Set(
    instructions
      .filter((item) => item.defining && item.control === "DUPLICATE_SPREAD")
      .map((item) => item.invariantId + "|" + item.metric),
  );
  return instructions.flatMap((item) => {
    if (item.control !== "SPATIAL_SEPARATION"
      || item.metric !== "fragmentationStateSeparationPeak") return [item];
    const key = item.invariantId + "|" + item.metric;
    if (directSpreadKeys.has(key)) return [];
    return [{
      ...item,
      control: "DUPLICATE_SPREAD",
      rationale: item.rationale
        + " Physical shutter fallback: duplicate spread realizes within-frame state separation.",
    }];
  });
};

const chooseActiveDimensions = (instructions, exhaustedControls) => {
  const defining = instructions.filter((item) => item.defining);
  const scored = SEARCH_DIMENSIONS
    .filter((dimension) => !exhaustedControls.has(dimension.control))
    .map((dimension) => {
      const matching = defining.filter((item) => item.control === dimension.control);
      const safetyCoupled = matching.some((item) =>
        item.deficitMetric && item.metric && item.deficitMetric !== item.metric);
      const maxError = matching.reduce((best, item) =>
        Math.max(best, Number(item.normalizedError) || 0), 0);
      return { dimension, matching, safetyCoupled, maxError };
    })
    .filter((item) => item.matching.length > 0)
    .sort((a, b) =>
      Number(b.safetyCoupled) - Number(a.safetyCoupled)
      || b.maxError - a.maxError
      || a.dimension.control.localeCompare(b.dimension.control));
  return scored.length === 0 ? [] : [scored[0].dimension];
};

const seedPlan = await load(seedPlanPath);
if (seedPlan.schema !== "editflow.m6.ae-shutter-search-plan.v1") {
  throw new Error("Unexpected seed plan schema.");
}
const seedCandidate = seedPlan.combinedCandidates?.find((item) => item.candidateId === seedCandidateId);
if (!seedCandidate) throw new Error("Seed candidate not found: " + seedCandidateId);
if (!Array.isArray(seedCandidate.cases) || seedCandidate.cases.length !== 1) {
  throw new Error("Automatic proof currently requires exactly one pre-isolated transition case.");
}
const referenceEvidence = await load(referenceEvidencePath);
if (referenceEvidence.schema !== "editflow.dense-effect-evidence.v1") {
  throw new Error("Reference must be dense-effect-evidence.v1.");
}
await mkdir(workDir, { recursive: true });
const attempts = [];
const rounds = [];
const exhaustedControls = new Set();
let status = "ITERATION_LIMIT";
let pendingCandidates = [{
  candidateId: "auto:seed:" + seedCandidateId,
  control: "SEED",
  relationToComparatorRequest: "INITIAL_UNDER_DRIVEN_STATE",
  changedTags: [seedCandidate.cases[0].tag],
  cases: structuredClone(seedCandidate.cases),
}];

const evidenceForAttempt = (attempt) => ({
  attemptId: attempt.attemptId,
  values: attempt.values,
  metricValues: attempt.metricValues,
  weightedFidelity: attempt.weightedFidelity,
  definingCoverage: attempt.definingCoverage,
  certified: attempt.certified,
  residualInvariantIds: attempt.residualInvariantIds,
});

const renderAndMeasure = async (roundIndex, candidates) => {
  const prefix = "M6_auto_r" + roundIndex;
  const planPath = path.join(workDir, "round-" + roundIndex + "-search-plan.json");
  const jsxPath = path.resolve("scripts/windows/" + prefix + ".jsx");
  const plan = {
    schema: "editflow.m6.ae-shutter-search-plan.v1",
    generatedAt: new Date().toISOString(),
    round: roundIndex,
    combinedCandidates: candidates,
    guardrails: [
      "Every candidate is generated from retained rendered evidence.",
      "Rendered pixels and defining-invariant coverage are authoritative.",
      "Only one active physical actuator dimension is explored per correction round.",
    ],
  };
  await save(planPath, plan);
  run(process.execPath, [
    "scripts/proofs/m6-materialize-shutter-search-probes.mjs",
    "--search-plan", planPath,
    "--output-jsx", jsxPath,
    "--local-window-ms", String(localWindowMs),
    "--output-prefix", prefix,
  ]);
  run(process.execPath, [
    "scripts/proofs/m6-run-warm-proof.mjs",
    "--script", jsxPath,
  ]);

  const measured = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const item = candidate.cases[0];
    const ordinal = String(index + 1).padStart(2, "0");
    const tag = safe(item.tag);
    const sourceVideo = path.join(os.tmpdir(), prefix + "_" + ordinal + "_" + tag + ".mp4");
    const retainedVideo = path.join(workDir, "round-" + roundIndex + "-" + ordinal + "-" + tag + ".mp4");
    const probePath = path.join(workDir, "round-" + roundIndex + "-" + ordinal + "-" + tag + "-probe.json");
    const evidencePath = path.join(workDir, "round-" + roundIndex + "-" + ordinal + "-" + tag + "-evidence.json");
    const fidelityPath = path.join(workDir, "round-" + roundIndex + "-" + ordinal + "-" + tag + "-fidelity.json");
    await copyFile(sourceVideo, retainedVideo);

    run("python", [
      "scripts/proofs/m6-dense-video-probe.py",
      "--video", retainedVideo,
      "--start", "0",
      "--end", String(renderEndSeconds),
      "--output", probePath,
      "--source-id", prefix + "-" + ordinal,
      "--source-kind", "RENDER",
      "--analysis-size", "360",
    ]);
    run(process.execPath, [
      "scripts/proofs/m6-dense-video-evidence.mjs",
      "--probe-json", probePath,
      "--output-evidence", evidencePath,
    ]);
    const probeFrameDir = path.join(
      path.dirname(probePath),
      path.basename(probePath, path.extname(probePath)) + "-frames",
    );
    await rm(probeFrameDir, { recursive: true, force: true });
    run(process.execPath, [
      "scripts/proofs/m6-local-shutter-fidelity.mjs",
      "--reference-evidence", referenceEvidencePath,
      "--render-evidence", evidencePath,
      "--output", fidelityPath,
      "--tag", candidate.candidateId,
    ]);
    const proof = await load(fidelityPath);
    if (proof.reference.analyzerFingerprint !== proof.render.analyzerFingerprint) {
      throw new Error("Analyzer provenance drift in " + candidate.candidateId);
    }
    const attempt = {
      attemptId: candidate.candidateId,
      round: roundIndex,
      values: vectorFromPhysical(item.physicalState),
      metricValues: metricValuesFrom(proof.comparison),
      weightedFidelity: proof.comparison.weightedFidelity,
      definingCoverage: proof.comparison.definingCoverage,
      certified: proof.gate.certified,
      residualInvariantIds: proof.gate.underDrivenInvariantIds,
      physicalState: item.physicalState,
      actuationPlan: proof.actuationPlan,
      analyzerFingerprint: proof.render.analyzerFingerprint,
      referenceEvidenceKey: proof.comparison.referenceEvidenceKey,
      renderEvidenceKey: proof.comparison.renderEvidenceKey,
      renderFamily: proof.render.classifiedFamily,
      shutterContract: proof.render.shutterContract,
      renderVideo: relative(retainedVideo),
      renderVideoSha256: await sha256File(retainedVideo),
      evidencePath: relative(evidencePath),
      fidelityPath: relative(fidelityPath),
    };
    attempts.push(attempt);
    measured.push(attempt);
  }
  await rm(jsxPath, { force: true });
  return { roundIndex, planPath: relative(planPath), candidates: measured };
};
let retained = null;
for (let roundIndex = 0; roundIndex <= maxCorrectionRounds; roundIndex += 1) {
  const round = await renderAndMeasure(roundIndex, pendingCandidates);
  const retainedEvidence = selectRetainedBestActuatorAttemptV1(attempts.map(evidenceForAttempt));
  retained = attempts.find((attempt) => attempt.attemptId === retainedEvidence.attemptId);
  if (!retained) throw new Error("Retained attempt lookup failed.");

  const roundRecord = {
    ...round,
    retainedBestAttemptId: retained.attemptId,
    retainedDefiningCoverage: retained.definingCoverage,
    retainedWeightedFidelity: retained.weightedFidelity,
    retainedResidualInvariantIds: retained.residualInvariantIds,
    retainedCertified: retained.certified,
    nextSearch: null,
  };
  rounds.push(roundRecord);

  if (retained.certified) {
    status = "PASSED";
    break;
  }
  if (roundIndex >= maxCorrectionRounds) break;

  const physicalInstructions = adaptInstructionsToPhysicalShutter(
    retained.actuationPlan.instructions,
  );
  let activeDimensions = chooseActiveDimensions(
    physicalInstructions,
    exhaustedControls,
  );
  if (activeDimensions.length === 0) {
    status = "SYNTHESIS_REQUIRED";
    break;
  }
  let search = planBoundedActuatorSearchV1({
    attempts: attempts.map(evidenceForAttempt),
    instructions: physicalInstructions,
    dimensions: activeDimensions,
    maxCandidates,
  });
  for (const control of search.exhaustedControls) exhaustedControls.add(control);

  if (search.candidates.length === 0 && search.synthesisRequiredInvariantIds.length > 0) {
    activeDimensions = chooseActiveDimensions(
      physicalInstructions,
      exhaustedControls,
    );
    if (activeDimensions.length > 0) {
      search = planBoundedActuatorSearchV1({
        attempts: attempts.map(evidenceForAttempt),
        instructions: physicalInstructions,
        dimensions: activeDimensions,
        maxCandidates,
      });
      for (const control of search.exhaustedControls) exhaustedControls.add(control);
    }
  }

  roundRecord.nextSearch = {
    activeDimensions,
    trustScale: search.trustScale,
    exhaustedControls: search.exhaustedControls,
    metricResponses: search.metricResponses,
    synthesisRequiredInvariantIds: search.synthesisRequiredInvariantIds,
    candidateIds: search.candidates.map((item) => item.candidateId),
  };
  if (search.candidates.length === 0) {
    status = search.synthesisRequiredInvariantIds.length > 0 ? "SYNTHESIS_REQUIRED" : "STALLED";
    break;
  }
  const template = seedCandidate.cases[0];
  pendingCandidates = search.candidates.map((candidate, index) => ({
    candidateId: "auto:r" + (roundIndex + 1) + ":" + candidate.candidateId + ":" + (index + 1),
    control: candidate.changedControls.join("+"),
    relationToComparatorRequest: "BOUNDED_RENDERED_SEARCH",
    changedTags: [template.tag],
    rationale: candidate.rationale,
    cases: [{
      tag: template.tag,
      cutSeconds: template.cutSeconds,
      outgoingLayer: template.outgoingLayer,
      incomingLayer: template.incomingLayer,
      physicalState: physicalFromVector(retained.physicalState, candidate.values),
    }],
  }));
}

if (!retained) throw new Error("Automatic correction produced no rendered attempts.");
const finalProof = {
  schema: "editflow.m6.real-ae-automatic-correction-proof.v1",
  generatedAt: new Date().toISOString(),
  status,
  bounded: {
    maxCorrectionRounds,
    maxCandidatesPerRound: maxCandidates,
    actualRounds: rounds.length,
    renderedAttempts: attempts.length,
  },
  reference: {
    evidencePath: relative(referenceEvidencePath),
    sourceId: referenceEvidence.sourceId,
    contentKey: referenceEvidence.contentKey,
    analyzerFingerprint: referenceEvidence.analyzerFingerprint,
  },
  seed: {
    sourcePlan: relative(seedPlanPath),
    sourceCandidateId: seedCandidateId,
    physicalState: seedCandidate.cases[0].physicalState,
  },
  rounds,
  finalGate: {
    certified: retained.certified,
    retainedBestAttemptId: retained.attemptId,
    definingCoverage: retained.definingCoverage,
    weightedFidelity: retained.weightedFidelity,
    residualInvariantIds: retained.residualInvariantIds,
    physicalState: retained.physicalState,
  },
  attempts: attempts.map((attempt) => ({
    attemptId: attempt.attemptId,
    round: attempt.round,
    physicalState: attempt.physicalState,
    definingCoverage: attempt.definingCoverage,
    weightedFidelity: attempt.weightedFidelity,
    certified: attempt.certified,
    residualInvariantIds: attempt.residualInvariantIds,
    analyzerFingerprint: attempt.analyzerFingerprint,
    referenceEvidenceKey: attempt.referenceEvidenceKey,
    renderEvidenceKey: attempt.renderEvidenceKey,
    renderFamily: attempt.renderFamily,
    shutterContract: attempt.shutterContract,
    renderVideo: attempt.renderVideo,
    renderVideoSha256: attempt.renderVideoSha256,
    evidencePath: attempt.evidencePath,
    fidelityPath: attempt.fidelityPath,
  })),
  governance: {
    hardcodedCertifiedCandidate: false,
    selectionPolicy: "CERTIFIED_THEN_DEFINING_COVERAGE_THEN_WEIGHTED_FIDELITY",
    activeDimensionPolicy: "SAFETY_COUPLED_THEN_LARGEST_DEFINING_ERROR",
    failClosed: status !== "PASSED",
    note: "The controller receives only an under-driven seed state and professional reference evidence; all correction candidates are generated from rendered comparator evidence.",
    physicalAdapterPolicy: "USE_DIRECT_CORE_CONTROL_WHEN_AVAILABLE_ELSE_SEMANTIC_TO_PHYSICAL_FALLBACK",
    retainedRawEvidence: "LOCAL_RENDER_VIDEO_PLUS_SHA256; FRAME_CACHE_REGENERABLE_FROM_VIDEO",
  },
  evidenceBoundary: [
    "This closes automatic real-AE local render -> measure -> diagnose -> bounded actuator search -> rerender for one pre-isolated professional shutter case only.",
    "It does not establish transfer, unknown-effect synthesis, benchmark-wide professional fidelity, or robustness.",
  ],
};
await save(outputPath, finalProof);
console.log(JSON.stringify({
  ok: status === "PASSED",
  output: outputPath,
  status,
  rounds: rounds.length,
  renderedAttempts: attempts.length,
  retainedBestAttemptId: retained.attemptId,
  definingCoverage: retained.definingCoverage,
  weightedFidelity: retained.weightedFidelity,
  residualInvariantIds: retained.residualInvariantIds,
}));
if (status !== "PASSED") process.exitCode = 2;
