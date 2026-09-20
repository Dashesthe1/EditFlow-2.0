import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyConstructionActuationPlanV1,
  compareSemanticVisualFidelityV1,
  compileConstructionGraphV1,
  compileConstructionThroughNativeAeV1,
  decomposeUnknownEffectV1,
  deriveConstructionActuationPlanV1,
  evaluateProfessionalFidelityGateV1,
  planBoundedActuatorSearchV1,
  selectRetainedBestActuatorAttemptV1,
  selectSynthesisEscalationCandidateV1,
  synthesizeUnknownEffectV1,
} from "../../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const CONTROL = "http://127.0.0.1:32146";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = process.argv.slice(2);
const cliValue = (name, fallback) => {
  const index = cli.indexOf(name);
  return index >= 0 && cli[index + 1] ? cli[index + 1] : fallback;
};
const STEM = cliValue("--stem", "m6-generic-native-auto-correction");
const REF = path.resolve(ROOT, cliValue(
  "--reference",
  "proofs/diagnostics/m6-v7r-ref05-evidence-refresh.json",
));
const SEED = path.resolve(ROOT, cliValue(
  "--seed",
  "proofs/diagnostics/m6-generic-native-materializer-case01-evidence.json",
));
const SEED_STRATEGY = cliValue("--seed-strategy", "").trim();
const OUT = path.join(ROOT, "proofs", "diagnostics", STEM + ".json");
const WINDOWS = (name) => path.join(ROOT, "scripts", "windows", name);
const MAX_CORRECTION_OPERATIONS = 96;
const PHYSICAL_PARAMETER_BY_CONTROL = Object.freeze({
  TEMPORAL_COPY_COUNT: "temporalCopyCountScale",
  TEMPORAL_PERSISTENCE: "temporalPersistenceScale",
  DUPLICATE_OPACITY: "duplicateOpacityScale",
  DUPLICATE_SPREAD: "duplicateSpreadScale",
  MOTION_IMPULSE: "motionImpulseScale",
  MOTION_IMPULSE_SHARPNESS: "motionImpulseSharpnessScale",
  MOTION_IMPULSE_PHASE: "motionImpulsePhaseScale",
  RECOVERY_DURATION: "recoveryDurationScale",
  BLUR_STRENGTH: "blurStrengthScale",
  EXPOSURE_STRENGTH: "exposureStrengthScale",
  DISTORTION_STRENGTH: "distortionStrengthScale",
  CHROMATIC_SEPARATION: "chromaticSeparationScale",
  SCALE_PULSE: "scalePulseScale",
});
const physicalParameterForNodeControl = (node, control) => {
  if (node?.parameters?.synthesisStrategy === "NATIVE_ECHO_HYBRID"
      || node?.parameters?.synthesisStrategy === "LAYERED_ECHO_AUGMENTED") {
    if (control === "TEMPORAL_COPY_COUNT" || control === "TEMPORAL_FRAGMENT_DENSITY") return "numberOfEchoes";
    if (control === "TEMPORAL_PERSISTENCE") return "echoSpacingFrames";
    if (control === "TEMPORAL_BAND_MIX") return "decay";
    if (control === "DUPLICATE_OPACITY") return "startingIntensity";
    if (control === "DUPLICATE_SPREAD") return undefined;
  }
  if (node?.parameters?.synthesisStrategy === "TURBULENT_DISPLACE_HYBRID"
      || node?.parameters?.synthesisStrategy === "COMPOUND_EVOLVING_WARP_HYBRID") {
    if (control === "DISTORTION_SIZE") return "distortionSizeScale";
    if (control === "DISTORTION_COMPLEXITY") return "distortionComplexityScale";
    if (control === "DISTORTION_EVOLUTION") return "distortionEvolutionScale";
    if (node.parameters.synthesisStrategy === "COMPOUND_EVOLVING_WARP_HYBRID") {
      if (control === "MOTION_IMPULSE") return "eventEvolutionSweepScale";
      if (control === "MOTION_IMPULSE_SHARPNESS" || control === "MOTION_IMPULSE_PHASE") return undefined;
    }
  }
  return PHYSICAL_PARAMETER_BY_CONTROL[control];
};
const SEARCH_DIMENSIONS = Object.freeze([
  { control: "TEMPORAL_COPY_COUNT", minimum: 0.5, maximum: 2, minimumStep: 0.125 },
  { control: "TEMPORAL_FRAGMENT_DENSITY", minimum: 1, maximum: 12, minimumStep: 1 },
  { control: "TEMPORAL_BAND_MIX", minimum: 0.05, maximum: 0.98, minimumStep: 0.05 },
  { control: "TEMPORAL_PERSISTENCE", minimum: 0.5, maximum: 4, minimumStep: 0.25 },
  { control: "DUPLICATE_OPACITY", minimum: 0.35, maximum: 1.5, minimumStep: 0.1 },
  { control: "DUPLICATE_SPREAD", minimum: 0.25, maximum: 2, minimumStep: 0.125 },
  { control: "MOTION_IMPULSE", minimum: 0.25, maximum: 4, minimumStep: 0.25 },
  { control: "MOTION_IMPULSE_SHARPNESS", minimum: 0.5, maximum: 2, minimumStep: 0.125 },
  { control: "MOTION_IMPULSE_PHASE", minimum: 0.5, maximum: 1.5, minimumStep: 0.125 },
  { control: "RECOVERY_DURATION", minimum: 0.25, maximum: 2, minimumStep: 0.125 },
  { control: "BLUR_STRENGTH", minimum: 0.25, maximum: 4, minimumStep: 0.25 },
  { control: "EXPOSURE_STRENGTH", minimum: 0.25, maximum: 4, minimumStep: 0.25 },
  { control: "DISTORTION_STRENGTH", minimum: 0.25, maximum: 4, minimumStep: 0.25 },
  { control: "DISTORTION_SIZE", minimum: 0.25, maximum: 4, minimumStep: 0.25 },
  { control: "DISTORTION_COMPLEXITY", minimum: 0.5, maximum: 2, minimumStep: 0.125 },
  { control: "DISTORTION_EVOLUTION", minimum: 0.25, maximum: 4, minimumStep: 0.25 },
  { control: "CHROMATIC_SEPARATION", minimum: 0.25, maximum: 4, minimumStep: 0.25 },
  { control: "SCALE_PULSE", minimum: 0.25, maximum: 4, minimumStep: 0.25 },
]);
const CAPABILITIES = [
  "ae.layer.duplicate", "ae.layer.time.offset", "ae.layer.opacity.set",
  "ae.layer.transform.set", "ae.keyframe.temporal_ease.set",
  "ae.keyframe.spatial.set", "ae.effect.directional-blur",
  "ae.effect.displacement-map", "ae.effect.turbulent-displace",
  "ae.effect.echo", "ae.precompose.layers",
  "ae.effect.exposure", "ae.effect.channel-shift",
  "ae.layer.blend_mode.set",
  "ae.subject.isolate", "ae.layer.matte.set", "ae.layer.order.set",
];

const project = {
  schema: "editflow.virtual-ae.project.v1",
  activeCompId: "m6-proof-corr01-comp",
  compositions: [{
    compId: "m6-proof-corr01-comp", name: "__EF2_M6_GENERIC_NATIVE_CORR01_PROOF__",
    width: 640, height: 360, durationMs: 1000, frameRate: 30,
    layers: [{
      layerId: "m6-proof-corr01-hero", name: "M6 Generic Hero", kind: "PRECOMP",
      sourceRef: "m6-proof-corr01-source-comp", inMs: 0, outMs: 1000,
      properties: [], effects: [], masks: [],
    }],
  }],
};
const context = {
  compId: "m6-proof-corr01-comp",
  eventTimesMs: { transition: 500 },
  roleBindings: [{ role: "hero", layerIds: ["m6-proof-corr01-hero"] }],
  parameterValues: {},
};

const load = async (file) => JSON.parse(await readFile(file, "utf8"));
let mutationLeaseToken = null;
const request = async (pathname, init = {}) => {
  const headers = { ...(init.headers ?? {}) };
  if (mutationLeaseToken !== null) headers["x-editflow-mutation-lease"] = mutationLeaseToken;
  const response = await fetch(CONTROL + pathname, { ...init, headers });
  const body = await response.json();
  if (!response.ok || body.ok === false) {
    throw new Error(pathname + " failed: " + JSON.stringify(body));
  }
  return body;
};
const proofScript = (name) => request("/proof-script", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ scriptPath: WINDOWS(name) }),
});
const acquireMutationLease = async (iteration) => {
  if (mutationLeaseToken !== null) throw new Error("Mutation lease is already held by this proof process.");
  const lease = await request("/mutation-lease/acquire", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      owner: "m6-generic-native-auto-correction-pass-" + iteration,
      ttlMs: 120_000,
    }),
  });
  mutationLeaseToken = lease.lease.token;
  return lease.lease;
};
const releaseMutationLease = async () => {
  const token = mutationLeaseToken;
  if (token === null) return;
  try {
    await request("/mutation-lease/release", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
  } finally {
    mutationLeaseToken = null;
  }
};
const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: ROOT, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(command + " failed: " + (result.stderr || result.stdout));
  return result.stdout.trim();
};
const measure = async (video, stem) => {
  const probe = path.join(ROOT, "proofs", "diagnostics", stem + "-probe.json");
  const evidence = path.join(ROOT, "proofs", "diagnostics", stem + "-evidence.json");
  run("py", ["-3.12", "scripts/proofs/m6-dense-video-probe.py",
    "--video", video, "--start", "0", "--end", "1", "--output", probe,
    "--source-id", stem, "--source-kind", "RENDER", "--analysis-size", "360"]);
  run(process.execPath, ["scripts/proofs/m6-dense-video-evidence.mjs",
    "--probe-json", probe, "--output-evidence", evidence]);
  return { value: await load(evidence), probe, evidence };
};

const compileNative = (graph, observedState, iteration) => {
  const compilation = compileConstructionGraphV1(graph, CAPABILITIES);
  if (compilation.recipe === null || !compilation.definingCoverageComplete) {
    throw new Error("Corrected construction did not retain defining coverage.");
  }
  const proofOnlyEffectSchemaRefs = graph.nodes.flatMap((node) => {
    const value = node.parameters.effectSchemaRef;
    return typeof value === "string" && value.length > 0 ? [value] : [];
  });
  const compilerContext = proofOnlyEffectSchemaRefs.length > 0
    ? { ...context, proofOnlyEffectSchemaRefs: [...new Set(proofOnlyEffectSchemaRefs)] }
    : context;
  const native = compileConstructionThroughNativeAeV1(
    compilation, project, compilerContext, {
      planId: `m6-generic-native-auto-correction-${iteration}`,
      observedState,
      curveBindingMode: "LIVE_ADAPTIVE",
      creativeObjective: "Apply comparator-derived physical correction to UNKNOWN professional reference behavior.",
      recipeRefs: [graph.graphId],
    },
  );
  if (!native.compiled || native.plan === null) {
    throw new Error("Corrected native construction failed: " + native.issues.join(", "));
  }
  if (JSON.stringify(native.plan).includes("M6.")) {
    throw new Error("Opaque M6 semantic state leaked into corrected native plan.");
  }
  return { compilation, native };
};

const executePass = async (graph, iteration) => {
  await acquireMutationLease(iteration);
  try {
    await proofScript("m6-generic-native-corr01-cleanup.jsx").catch(() => {});
  await proofScript("m6-generic-native-corr01-setup.jsx");
  // Reinstall the accepted 2.7 host chain immediately before native execution.
  // Older proof/reopen helpers can legitimately reload the legacy current host,
  // which would otherwise leave Time Remap lowering pointed at an unavailable
  // dispatcher even though the warm CEP panel still advertises protocol 2.7.
  await proofScript("m6-reload-current-host.jsx");
  const live = await request("/state");
  let budgetGraph = graph;
  let compiled = compileNative(budgetGraph, live.state.observed, iteration);
  const budgetBackoff = [];
  while (compiled.native.plan.operations.length > MAX_CORRECTION_OPERATIONS) {
    const temporal = budgetGraph.nodes.find((node) => node.kind === "TEMPORAL_DUPLICATES");
    if (temporal === undefined) {
      throw new Error("Corrected native plan exceeds the host operation budget without a reducible temporal construction.");
    }
    const baseCount = Number(
      temporal.parameters.fragmentationTemporalStateCountPeak
      ?? temporal.parameters.temporalStateCountPeak
      ?? 2,
    );
    const scale = Number(temporal.parameters.temporalCopyCountScale ?? 1);
    const effectiveCount = Math.max(2, Math.min(8, Math.round(baseCount * scale)));
    if (!Number.isFinite(baseCount) || baseCount <= 0 || effectiveCount <= 2) {
      throw new Error("Corrected native plan cannot be reduced within the host operation budget.");
    }
    const nextCount = effectiveCount - 1;
    const nextScale = nextCount / baseCount;
    budgetGraph = {
      ...budgetGraph,
      nodes: budgetGraph.nodes.map((node) => node.nodeId === temporal.nodeId
        ? { ...node, parameters: { ...node.parameters, temporalCopyCountScale: nextScale } }
        : node),
    };
    budgetBackoff.push({ fromOperations: compiled.native.plan.operations.length, effectiveCount, nextCount, nextScale });
    compiled = compileNative(budgetGraph, live.state.observed, iteration);
  }
  const { compilation, native } = compiled;
  const transaction = await request("/run-correction-transaction", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan: native.plan }),
  });
  if (transaction.result.state !== "COMMITTED") {
    throw new Error("Corrected real-AE transaction did not commit.");
  }
  await proofScript("m6-generic-native-corr01-readback.jsx");
  const passStem = `${STEM}-pass${String(iteration).padStart(2, "0")}`;
  const readback = path.join(ROOT, "proofs", "diagnostics", passStem + "-readback.txt");
  await copyFile(path.join(ROOT, ".tmp", "m6-generic-native-corr01-readback.txt"), readback);
  await proofScript("m6-generic-native-corr01-render.jsx");
  const video = path.join(ROOT, "proofs", "diagnostics", passStem + ".mp4");
  await copyFile(path.join(os.tmpdir(), "M6_generic_native_corr01_candidate.mp4"), video);
  const measured = await measure(video, passStem);
  return { graph: budgetGraph, budgetBackoff, compilation, native, transaction, readback, video, measured };
  } finally {
    await proofScript("m6-generic-native-corr01-cleanup.jsx").catch(() => {});
    await releaseMutationLease().catch(() => {});
  }
};

const searchControlFilter = new Set(
  cliValue("--search-controls", "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0),
);
const SEARCH_CONTROLS = [...new Set(SEARCH_DIMENSIONS
  .filter((dimension) => searchControlFilter.size === 0 || searchControlFilter.has(dimension.control))
  .map((dimension) => dimension.control))];
if (searchControlFilter.size > 0 && SEARCH_CONTROLS.length !== searchControlFilter.size) {
  const known = new Set(SEARCH_DIMENSIONS.map((dimension) => dimension.control));
  const unknown = [...searchControlFilter].filter((control) => !known.has(control));
  throw new Error(`Unknown --search-controls value(s): ${unknown.join(", ")}`);
}
const EVOLVING_WARP_MOTION_CONTROLS = new Set([
  "MOTION_IMPULSE",
  "MOTION_IMPULSE_SHARPNESS",
  "MOTION_IMPULSE_PHASE",
]);
const controlTargetNode = (valueGraph, control, preferredNodeId) => {
  if (EVOLVING_WARP_MOTION_CONTROLS.has(control)) {
    const evolvingWarp = valueGraph.nodes.find((candidate) =>
      candidate.parameters.synthesisStrategy === "COMPOUND_EVOLVING_WARP_HYBRID");
    if (evolvingWarp !== undefined) return evolvingWarp;
  }
  if (typeof preferredNodeId === "string") {
    const preferred = valueGraph.nodes.find((candidate) => candidate.nodeId === preferredNodeId);
    if (preferred !== undefined) return preferred;
  }
  return valueGraph.nodes.find((candidate) => {
    const parameter = physicalParameterForNodeControl(candidate, control);
    const value = parameter === undefined ? undefined : candidate.parameters[parameter];
    return typeof value === "number" && Number.isFinite(value);
  });
};
const controlVectorFromGraph = (valueGraph, controls = SEARCH_CONTROLS) => Object.fromEntries(
  controls.map((control) => {
    const node = controlTargetNode(valueGraph, control);
    const parameter = node === undefined ? undefined : physicalParameterForNodeControl(node, control);
    const raw = parameter === undefined ? undefined : node?.parameters[parameter];
    return [control, typeof raw === "number" && Number.isFinite(raw) ? raw : 1];
  }),
);
const metricValuesFromComparison = (valueComparison) => Object.fromEntries(
  valueComparison.metrics.flatMap((metric) =>
    typeof metric.renderValue === "number" && Number.isFinite(metric.renderValue)
      ? [[metric.metric, metric.renderValue]]
      : []),
);
const residualInvariantIds = (valueGate) => [...new Set([
  ...valueGate.missingDefiningInvariantIds,
  ...valueGate.underDrivenInvariantIds,
])];
const strategyKeyFromSet = (strategies) => {
  // Prefer the most structurally advanced explicit strategy. A v3 graph also
  // contains its retained v2 Echo/Turbulent interventions, so checking those
  // first would incorrectly collapse the evolving graph back to compound v2.
  if (strategies.has("COMPOUND_EVOLVING_WARP_HYBRID")) {
    return "COMPOUND_EVOLVING_WARP_HYBRID";
  }
  if (strategies.has("COMPOUND_NATIVE_HYBRID")
      || (strategies.has("LAYERED_ECHO_AUGMENTED")
        && strategies.has("TURBULENT_DISPLACE_HYBRID"))) {
    return "COMPOUND_NATIVE_HYBRID";
  }
  return [...strategies][0] ?? "LAYERED_PRIMITIVES";
};
const graphStrategyKey = (valueGraph) => strategyKeyFromSet(new Set(
  valueGraph.nodes.flatMap((node) =>
    typeof node.parameters.synthesisStrategy === "string"
      ? [node.parameters.synthesisStrategy]
      : []),
));
const recordedStrategyKey = (graphParameters) => strategyKeyFromSet(new Set(
  graphParameters.flatMap((entry) =>
    typeof entry?.parameters?.synthesisStrategy === "string"
      ? [entry.parameters.synthesisStrategy]
      : []),
));
const attemptEvidenceFromState = (state, controls = SEARCH_CONTROLS) => ({
  attemptId: state.attemptId,
  values: controlVectorFromGraph(state.graph, controls),
  weightedFidelity: state.comparison.weightedFidelity,
  definingCoverage: state.comparison.definingCoverage,
  certified: state.gate.certified,
  residualInvariantIds: residualInvariantIds(state.gate),
  metricValues: metricValuesFromComparison(state.comparison),
});
const searchDimensionsForPlan = (actuationPlan, valueGraph) => {
  // Search in physical-actuator space. Several semantic Echo controls can map
  // to one AE parameter (for example copy count and fragment density both map
  // to Number of Echoes). Keep only the strongest defining instruction for each
  // physical parameter so one physical change remains a one-factor experiment.
  const selectedByPhysicalParameter = new Map();
  for (const instruction of actuationPlan.instructions
    .filter((candidate) => candidate.defining)
    .sort((left, right) => right.normalizedError - left.normalizedError)) {
    const node = controlTargetNode(valueGraph, instruction.control, instruction.nodeId);
    if (node === undefined) continue;
    const parameter = physicalParameterForNodeControl(node, instruction.control);
    if (parameter === undefined || selectedByPhysicalParameter.has(parameter)) continue;
    selectedByPhysicalParameter.set(parameter, instruction);
  }
  const selectedControls = new Set(
    [...selectedByPhysicalParameter.values()].map((instruction) => instruction.control),
  );
  return SEARCH_DIMENSIONS
    .filter((dimension) => SEARCH_CONTROLS.includes(dimension.control))
    .flatMap((dimension) => {
    if (!selectedControls.has(dimension.control)) return [];
    const instruction = [...selectedByPhysicalParameter.values()]
      .find((candidate) => candidate.control === dimension.control);
    const node = instruction === undefined
      ? undefined
      : controlTargetNode(valueGraph, instruction.control, instruction.nodeId);
    const parameter = node === undefined || instruction === undefined
      ? undefined
      : physicalParameterForNodeControl(node, instruction.control);
    if (parameter === "numberOfEchoes") {
      return [{ ...dimension, minimum: 1, maximum: 12, minimumStep: 1, integer: true }];
    }
    if (parameter === "echoSpacingFrames") {
      return [{ ...dimension, minimum: 0.25, maximum: 8, minimumStep: 0.25 }];
    }
    if (parameter === "startingIntensity") {
      return [{ ...dimension, minimum: 0.1, maximum: 1, minimumStep: 0.1 }];
    }
    if (parameter === "decay") {
      return [{ ...dimension, minimum: 0.05, maximum: 0.98, minimumStep: 0.05 }];
    }
    return [dimension];
  });
};
const applySearchCandidateToGraph = (baseGraph, actuationPlan, candidate) => {
  let nextGraph = baseGraph;
  for (const control of candidate.changedControls) {
    const value = candidate.values[control];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const instruction = actuationPlan.instructions
      .filter((item) => item.defining && item.control === control)
      .sort((left, right) => right.normalizedError - left.normalizedError)[0];
    if (instruction === undefined) continue;
    const targetNode = controlTargetNode(nextGraph, control, instruction.nodeId);
    const parameter = targetNode === undefined
      ? undefined
      : physicalParameterForNodeControl(targetNode, control);
    if (parameter === undefined) continue;
    const physicalValue = parameter === "numberOfEchoes" ? Math.max(1, Math.round(value)) : value;
    nextGraph = {
      ...nextGraph,
      nodes: nextGraph.nodes.map((node) => node.nodeId === targetNode.nodeId
        ? { ...node, parameters: { ...node.parameters, [parameter]: physicalValue } }
        : node),
    };
  }
  return nextGraph;
};
const transferRetainedPhysicalScales = (sourceGraph, targetGraph) => ({
  ...targetGraph,
  nodes: targetGraph.nodes.map((node) => {
    const sourceNode = sourceGraph.nodes.find((candidate) => candidate.nodeId === node.nodeId);
    if (sourceNode === undefined) return node;
    const parameters = { ...node.parameters };
    for (const parameter of [
      ...Object.values(PHYSICAL_PARAMETER_BY_CONTROL),
      "distortionSizeScale",
      "distortionComplexityScale",
      "distortionEvolutionScale",
      "eventEvolutionSweepScale",
    ]) {
      const value = sourceNode.parameters[parameter];
      if (typeof value === "number" && Number.isFinite(value)) parameters[parameter] = value;
    }
    return { ...node, parameters };
  }),
});
const graphFromRecordedParameters = (baseGraph, graphParameters) => {
  const recorded = new Map(graphParameters.map((entry) => [entry.nodeId, entry.parameters]));
  return {
    ...baseGraph,
    nodes: baseGraph.nodes.map((node) => {
      const parameters = recorded.get(node.nodeId);
      // Resume old rendered attempts against the current graph contract. Recorded
      // physical tuning wins, while newly introduced semantic/provenance defaults
      // remain present instead of being erased by an older checkpoint snapshot.
      return parameters === undefined
        ? node
        : { ...node, parameters: { ...node.parameters, ...parameters } };
    }),
  };
};

await request("/healthz");
const reference = await load(REF);
const seedRender = await load(SEED);
if (reference.analyzerFingerprint !== seedRender.analyzerFingerprint) {
  throw new Error("Retained seed render is not analyzer-compatible with the reference.");
}
const anatomy = decomposeUnknownEffectV1(reference);
const synthesis = synthesizeUnknownEffectV1({ evidence: reference, availableCapabilities: CAPABILITIES });
if (synthesis.status !== "READY_FOR_PROOF" || synthesis.selected === null) {
  throw new Error("UNKNOWN synthesis is not ready for correction proof.");
}
const seedCandidate = SEED_STRATEGY.length === 0
  ? synthesis.selected
  : synthesis.candidates.find((candidate) => candidate.strategy === SEED_STRATEGY);
if (seedCandidate === undefined || seedCandidate === null) {
  throw new Error(`Requested seed strategy '${SEED_STRATEGY}' is unavailable.`);
}
if (seedCandidate.capabilityGaps.length > 0) {
  throw new Error(`Requested seed strategy '${seedCandidate.strategy}' has capability gaps: ${seedCandidate.capabilityGaps.join(", ")}.`);
}
let graph = seedCandidate.graph;
let render = seedRender;
let comparison = compareSemanticVisualFidelityV1({
  reference, render, dna: anatomy.dna, alignment: "SEMANTIC",
});
let compilation = compileConstructionGraphV1(graph, CAPABILITIES);
let gate = evaluateProfessionalFidelityGateV1({
  comparison, compilation, synthesisPossible: true,
});
const renderedStates = [{
  attemptId: "seed",
  graph,
  compilation,
  render,
  comparison,
  gate,
}];
const passes = [{
  iteration: 0,
  source: "retained-real-ae-seed",
  strategy: graphStrategyKey(graph),
  weightedFidelity: comparison.weightedFidelity,
  definingCoverage: comparison.definingCoverage,
  gate,
  summary: render.summary,
  graphParameters: graph.nodes.map((node) => ({ nodeId: node.nodeId, parameters: node.parameters })),
}];
const checkpointPasses = async (checkpointStatus) => {
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({
    schema: "editflow.m6.generic-native-auto-correction-proof.v1",
    generatedAt: new Date().toISOString(),
    sourceEvidence: path.relative(ROOT, REF).replaceAll("\\", "/"),
    seedEvidence: path.relative(ROOT, SEED).replaceAll("\\", "/"),
    seedStrategy: seedCandidate.strategy,
    status: checkpointStatus,
    passes,
  }, null, 2) + "\n", "utf8");
};
let resumedFromProof = null;
const resumeProofArg = cliValue("--resume-proof", "");
if (resumeProofArg.length > 0) {
  const resumePath = path.resolve(ROOT, resumeProofArg);
  const previous = await load(resumePath);
  if (previous.schema !== "editflow.m6.generic-native-auto-correction-proof.v1") {
    throw new Error("Resume proof schema is incompatible.");
  }
  if (path.resolve(ROOT, previous.sourceEvidence) !== REF || path.resolve(ROOT, previous.seedEvidence) !== SEED) {
    throw new Error("Resume proof does not match the requested reference/seed evidence.");
  }
  if (typeof previous.seedStrategy === "string" && previous.seedStrategy !== seedCandidate.strategy) {
    throw new Error("Resume proof does not match the requested seed synthesis strategy.");
  }
  let loadedAttempts = 0;
  for (const previousPass of previous.passes) {
    if (previousPass.iteration === 0
      || typeof previousPass.evidence !== "string"
      || !Array.isArray(previousPass.graphParameters)) continue;
    const resumedRender = await load(path.resolve(ROOT, previousPass.evidence));
    if (resumedRender.analyzerFingerprint !== reference.analyzerFingerprint) {
      throw new Error("Resume proof contains analyzer-incompatible render evidence.");
    }
    const recordedStrategy = typeof previousPass.strategy === "string"
      ? previousPass.strategy
      : recordedStrategyKey(previousPass.graphParameters);
    const baseGraph = synthesis.candidates.find((candidate) =>
      candidate.strategy === recordedStrategy)?.graph
      ?? (recordedStrategy === seedCandidate.strategy ? seedCandidate.graph : undefined);
    if (baseGraph === undefined) {
      throw new Error(`Resume proof references unavailable synthesis strategy '${recordedStrategy}'.`);
    }
    const resumedGraph = graphFromRecordedParameters(baseGraph, previousPass.graphParameters);
    const resumedCompilation = compileConstructionGraphV1(resumedGraph, CAPABILITIES);
    const resumedComparison = compareSemanticVisualFidelityV1({
      reference, render: resumedRender, dna: anatomy.dna, alignment: "SEMANTIC",
    });
    const resumedGate = evaluateProfessionalFidelityGateV1({
      comparison: resumedComparison, compilation: resumedCompilation, synthesisPossible: true,
    });
    renderedStates.push({
      attemptId: `resume-${previousPass.iteration}-${previousPass.source}`,
      graph: resumedGraph,
      compilation: resumedCompilation,
      render: resumedRender,
      comparison: resumedComparison,
      gate: resumedGate,
    });
    loadedAttempts += 1;
  }
  if (loadedAttempts === 0) throw new Error("Resume proof contains no reusable rendered attempts.");
  const resumeRetainedStrategy = cliValue("--resume-retained-strategy", "").trim();
  const resumePool = resumeRetainedStrategy.length === 0
    ? renderedStates
    : renderedStates.filter((state) => graphStrategyKey(state.graph) === resumeRetainedStrategy);
  if (resumePool.length === 0) {
    throw new Error(`Resume proof contains no reusable '${resumeRetainedStrategy}' rendered attempts.`);
  }
  const retained = selectRetainedBestActuatorAttemptV1(
    resumePool.map((state) => attemptEvidenceFromState(state)),
  );
  const retainedState = resumePool.find((item) => item.attemptId === retained.attemptId);
  if (retainedState === undefined) throw new Error("Resume proof could not recover its retained-best state.");
  ({ graph, compilation, render, comparison, gate } = retainedState);
  passes.splice(0, passes.length, ...previous.passes);
  resumedFromProof = path.relative(ROOT, resumePath).replaceAll("\\", "/");
}
const maxPassesRaw = Number(cliValue("--max-passes", "2"));
const MAX_CORRECTION_PASSES = Number.isFinite(maxPassesRaw)
  ? Math.max(1, Math.min(5, Math.round(maxPassesRaw)))
  : 2;
const BLIND_CORRECTION_PASSES = resumedFromProof === null ? MAX_CORRECTION_PASSES : 0;
let status = gate.certified ? "PASSED" : "ITERATION_LIMIT";
for (let iteration = 1; iteration <= BLIND_CORRECTION_PASSES && !gate.certified; iteration += 1) {
  const acceptedState = { graph, compilation, render, comparison, gate };
  const actuationPlan = deriveConstructionActuationPlanV1({ graph, comparison });
  const application = applyConstructionActuationPlanV1(graph, actuationPlan);
  if (application.appliedInstructionIds.length === 0) {
    status = "STALLED";
    passes.push({
      iteration, source: "no-applicable-physical-correction",
      actuationPlan, application, weightedFidelity: comparison.weightedFidelity,
      definingCoverage: comparison.definingCoverage, gate,
    });
    break;
  }
  const proposedGraph = application.graph;
  const pass = await executePass(proposedGraph, iteration);
  const trialGraph = pass.graph;
  const trialCompilation = pass.compilation;
  const trialRender = pass.measured.value;
  if (trialRender.analyzerFingerprint !== reference.analyzerFingerprint) {
    throw new Error("Corrected render analyzer is incompatible with the reference.");
  }
  const nextComparison = compareSemanticVisualFidelityV1({
    reference, render: trialRender, dna: anatomy.dna, alignment: "SEMANTIC",
  });
  const nextGate = evaluateProfessionalFidelityGateV1({
    comparison: nextComparison, compilation: trialCompilation, synthesisPossible: true,
  });
  const minImprovementRaw = Number(cliValue("--min-improvement", "0.0001"));
  const minImprovement = Number.isFinite(minImprovementRaw)
    ? Math.max(0, Math.min(0.05, minImprovementRaw))
    : 0.0001;
  const improved = nextComparison.weightedFidelity > comparison.weightedFidelity + minImprovement
    || nextComparison.definingCoverage > comparison.definingCoverage;
  renderedStates.push({
    attemptId: `blind-${iteration}`,
    graph: trialGraph,
    compilation: trialCompilation,
    render: trialRender,
    comparison: nextComparison,
    gate: nextGate,
  });
  passes.push({
    iteration,
    source: "real-ae-local-rerender",
    operationCount: pass.native.plan.operations.length,
    transactionState: pass.transaction.result.state,
    budgetBackoff: pass.budgetBackoff,
    readback: path.relative(ROOT, pass.readback).replaceAll("\\", "/"),
    video: path.relative(ROOT, pass.video).replaceAll("\\", "/"),
    evidence: path.relative(ROOT, pass.measured.evidence).replaceAll("\\", "/"),
    actuationPlan,
    appliedInstructionIds: application.appliedInstructionIds,
    unsupportedInstructionIds: application.unsupportedInstructionIds,
    weightedFidelity: nextComparison.weightedFidelity,
    definingCoverage: nextComparison.definingCoverage,
    improved,
    accepted: nextGate.certified || improved,
    gate: nextGate,
    summary: trialRender.summary,
    graphParameters: trialGraph.nodes.map((node) => ({ nodeId: node.nodeId, parameters: node.parameters })),
  });
  await checkpointPasses("IN_PROGRESS");
  if (nextGate.certified) {
    graph = trialGraph;
    compilation = trialCompilation;
    render = trialRender;
    comparison = nextComparison;
    gate = nextGate;
    status = "PASSED";
    break;
  }
  if (!improved) {
    ({ graph, compilation, render, comparison, gate } = acceptedState);
    status = "STALLED";
    break;
  }
  graph = trialGraph;
  compilation = trialCompilation;
  render = trialRender;
  comparison = nextComparison;
  gate = nextGate;
}

const maxSearchProbesRaw = Number(cliValue("--max-search-probes", "4"));
const MAX_SEARCH_PROBES = Number.isFinite(maxSearchProbesRaw)
  ? Math.max(1, Math.min(8, Math.round(maxSearchProbesRaw)))
  : 4;
let nextRenderIteration = Math.max(...passes.map((item) => item.iteration)) + 1;
for (let probeIndex = 1; probeIndex <= MAX_SEARCH_PROBES && !gate.certified; probeIndex += 1) {
  const actuationPlan = deriveConstructionActuationPlanV1({ graph, comparison });
  const activeStrategyKey = graphStrategyKey(graph);
  const dimensions = searchDimensionsForPlan(actuationPlan, graph);
  const activeControls = dimensions.map((dimension) => dimension.control);
  const attempts = renderedStates
    .filter((state) => graphStrategyKey(state.graph) === activeStrategyKey)
    .map((state) => attemptEvidenceFromState(state, activeControls));
  const searchPlan = planBoundedActuatorSearchV1({
    attempts,
    instructions: actuationPlan.instructions,
    dimensions,
    maxCandidates: 6,
  });
  const retainedAttempt = selectRetainedBestActuatorAttemptV1(attempts);
  const retainedState = renderedStates.find((item) => item.attemptId === retainedAttempt.attemptId);
  if (retainedState !== undefined) {
    ({ graph, compilation, render, comparison, gate } = retainedState);
  }
  if (searchPlan.candidates.length === 0) {
    status = searchPlan.synthesisRequiredInvariantIds.length > 0
      ? "SYNTHESIS_REQUIRED"
      : "STALLED";
    passes.push({
      iteration: nextRenderIteration,
      source: "bounded-actuator-search-exhausted",
      actuationPlan,
      searchPlan,
      weightedFidelity: comparison.weightedFidelity,
      definingCoverage: comparison.definingCoverage,
      gate,
    });
    break;
  }
  const candidate = searchPlan.candidates[0];
  const proposedGraph = applySearchCandidateToGraph(graph, actuationPlan, candidate);
  const pass = await executePass(proposedGraph, nextRenderIteration);
  const trialGraph = pass.graph;
  const trialCompilation = pass.compilation;
  const trialRender = pass.measured.value;
  if (trialRender.analyzerFingerprint !== reference.analyzerFingerprint) {
    throw new Error("Bounded-search render analyzer is incompatible with the reference.");
  }
  const nextComparison = compareSemanticVisualFidelityV1({
    reference, render: trialRender, dna: anatomy.dna, alignment: "SEMANTIC",
  });
  const nextGate = evaluateProfessionalFidelityGateV1({
    comparison: nextComparison, compilation: trialCompilation, synthesisPossible: true,
  });
  const attemptId = `search-${probeIndex}`;
  renderedStates.push({
    attemptId,
    graph: trialGraph,
    compilation: trialCompilation,
    render: trialRender,
    comparison: nextComparison,
    gate: nextGate,
  });
  passes.push({
    iteration: nextRenderIteration,
    source: "bounded-actuator-probe",
    candidateId: candidate.candidateId,
    changedControls: candidate.changedControls,
    candidateRationale: candidate.rationale,
    searchPlan: {
      retainedBestAttemptId: searchPlan.retainedBestAttemptId,
      regressingAttemptIds: searchPlan.regressingAttemptIds,
      trustScale: searchPlan.trustScale,
      exhaustedControls: searchPlan.exhaustedControls,
      metricResponses: searchPlan.metricResponses,
      synthesisRequiredInvariantIds: searchPlan.synthesisRequiredInvariantIds,
      structuralEscalationInvariantIds: searchPlan.structuralEscalationInvariantIds,
    },
    operationCount: pass.native.plan.operations.length,
    transactionState: pass.transaction.result.state,
    budgetBackoff: pass.budgetBackoff,
    readback: path.relative(ROOT, pass.readback).replaceAll("\\", "/"),
    video: path.relative(ROOT, pass.video).replaceAll("\\", "/"),
    evidence: path.relative(ROOT, pass.measured.evidence).replaceAll("\\", "/"),
    weightedFidelity: nextComparison.weightedFidelity,
    definingCoverage: nextComparison.definingCoverage,
    gate: nextGate,
    summary: trialRender.summary,
    graphParameters: trialGraph.nodes.map((node) => ({ nodeId: node.nodeId, parameters: node.parameters })),
  });
  await checkpointPasses("IN_PROGRESS");
  const updatedAttempts = renderedStates
    .filter((state) => graphStrategyKey(state.graph) === activeStrategyKey)
    .map((state) => attemptEvidenceFromState(state, activeControls));
  const bestAttempt = selectRetainedBestActuatorAttemptV1(updatedAttempts);
  const bestState = renderedStates.find((item) => item.attemptId === bestAttempt.attemptId);
  if (bestState === undefined) throw new Error("Bounded actuator search lost its retained-best render.");
  ({ graph, compilation, render, comparison, gate } = bestState);
  status = gate.certified ? "PASSED" : "BOUNDED_SEARCH";
  nextRenderIteration += 1;
}
let synthesisEscalation = null;
if (!gate.certified) {
  const escalationActuationPlan = deriveConstructionActuationPlanV1({ graph, comparison });
  const activeStrategyKey = graphStrategyKey(graph);
  const escalationDimensions = searchDimensionsForPlan(escalationActuationPlan, graph);
  const escalationControls = escalationDimensions.map((dimension) => dimension.control);
  const escalationSearchPlan = planBoundedActuatorSearchV1({
    attempts: renderedStates
      .filter((state) => graphStrategyKey(state.graph) === activeStrategyKey)
      .map((state) => attemptEvidenceFromState(state, escalationControls)),
    instructions: escalationActuationPlan.instructions,
    dimensions: escalationDimensions,
    maxCandidates: 6,
  });
  const hardRequiredInvariantIds = escalationSearchPlan.synthesisRequiredInvariantIds;
  const structuralEscalationInvariantIds = escalationSearchPlan.structuralEscalationInvariantIds;
  const requiredInvariantIds = [...new Set([
    ...hardRequiredInvariantIds,
    ...structuralEscalationInvariantIds,
  ])];
  const alternate = selectSynthesisEscalationCandidateV1({
    synthesis,
    currentStrategy: activeStrategyKey,
    requiredInvariantIds,
  });
  synthesisEscalation = {
    requiredInvariantIds,
    hardRequiredInvariantIds,
    structuralEscalationInvariantIds,
    searchPlan: escalationSearchPlan,
    selectedStrategy: alternate?.strategy ?? null,
  };
  if (alternate !== null) {
    const proposedGraph = transferRetainedPhysicalScales(graph, alternate.graph);
    const pass = await executePass(proposedGraph, nextRenderIteration);
    const trialGraph = pass.graph;
    const trialCompilation = pass.compilation;
    const trialRender = pass.measured.value;
    if (trialRender.analyzerFingerprint !== reference.analyzerFingerprint) {
      throw new Error("Synthesis-escalation render analyzer is incompatible with the reference.");
    }
    const nextComparison = compareSemanticVisualFidelityV1({
      reference, render: trialRender, dna: anatomy.dna, alignment: "SEMANTIC",
    });
    const nextGate = evaluateProfessionalFidelityGateV1({
      comparison: nextComparison, compilation: trialCompilation, synthesisPossible: true,
    });
    const attemptId = `synthesis-${alternate.strategy.toLowerCase()}`;
    renderedStates.push({
      attemptId,
      graph: trialGraph,
      compilation: trialCompilation,
      render: trialRender,
      comparison: nextComparison,
      gate: nextGate,
    });
    passes.push({
      iteration: nextRenderIteration,
      source: "synthesis-escalation",
      triggeredInvariantIds: requiredInvariantIds,
      strategy: alternate.strategy,
      candidateId: alternate.candidateId,
      operationCount: pass.native.plan.operations.length,
      transactionState: pass.transaction.result.state,
      budgetBackoff: pass.budgetBackoff,
      readback: path.relative(ROOT, pass.readback).replaceAll("\\", "/"),
      video: path.relative(ROOT, pass.video).replaceAll("\\", "/"),
      evidence: path.relative(ROOT, pass.measured.evidence).replaceAll("\\", "/"),
      weightedFidelity: nextComparison.weightedFidelity,
      definingCoverage: nextComparison.definingCoverage,
      gate: nextGate,
      summary: trialRender.summary,
      graphParameters: trialGraph.nodes.map((node) => ({ nodeId: node.nodeId, parameters: node.parameters })),
    });
    await checkpointPasses("IN_PROGRESS");
    const bestAttempt = selectRetainedBestActuatorAttemptV1(renderedStates.map((state) => attemptEvidenceFromState(state)));
    const bestState = renderedStates.find((item) => item.attemptId === bestAttempt.attemptId);
    if (bestState === undefined) throw new Error("Synthesis escalation lost its retained-best render.");
    ({ graph, compilation, render, comparison, gate } = bestState);
    status = gate.certified
      ? "PASSED"
      : bestAttempt.attemptId === attemptId ? "SYNTHESIS_IMPROVED" : "SYNTHESIS_REJECTED";
    nextRenderIteration += 1;
  } else if (requiredInvariantIds.length > 0) {
    status = "SYNTHESIS_REQUIRED";
  }
}
if (!gate.certified && status === "BOUNDED_SEARCH") status = "ITERATION_LIMIT";
const result = {
  schema: "editflow.m6.generic-native-auto-correction-proof.v1",
  generatedAt: new Date().toISOString(),
  sourceEvidence: path.relative(ROOT, REF).replaceAll("\\", "/"),
  seedEvidence: path.relative(ROOT, SEED).replaceAll("\\", "/"),
  seedStrategy: seedCandidate.strategy,
  resumedFromProof,
  family: seedCandidate.graph.family,
  strategy: seedCandidate.strategy,
  status,
  certified: gate.certified,
  finalWeightedFidelity: comparison.weightedFidelity,
  finalDefiningCoverage: comparison.definingCoverage,
  residualInvariantIds: residualInvariantIds(gate),
  renderedAttemptCount: renderedStates.length,
  synthesisEscalation,
  passes,
};
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(result, null, 2) + "\n", "utf8");
console.log(JSON.stringify({
  ok: gate.certified,
  status,
  output: OUT,
  passCount: passes.length,
  initialWeightedFidelity: passes[0].weightedFidelity,
  finalWeightedFidelity: result.finalWeightedFidelity,
  initialDefiningCoverage: passes[0].definingCoverage,
  finalDefiningCoverage: result.finalDefiningCoverage,
  residualInvariantIds: result.residualInvariantIds,
}));
if (!gate.certified) process.exitCode = status === "STALLED" ? 3 : 2;
await proofScript("m6-generic-native-corr01-cleanup.jsx").catch(() => {});
