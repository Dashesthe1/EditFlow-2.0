import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildConstructionGraphV1,
  compareSemanticVisualFidelityV1,
  compileConstructionGraphV1,
  compileConstructionThroughNativeAeV1,
  createCanonicalProfessionalBenchmarkV1,
  decomposeUnknownEffectV1,
  deriveEffectAnatomyV1,
  evaluateProfessionalFidelityGateV1,
  evaluateReferenceFamilyCandidateV1,
  synthesizeUnknownEffectV1,
} from "../../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const CONTROL = "http://127.0.0.1:32146";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = process.argv.slice(2);
const cliValue = (name, fallback) => {
  const index = cli.indexOf(name);
  return index >= 0 && cli[index + 1] ? cli[index + 1] : fallback;
};
const STEM = cliValue("--stem", "m6-generic-native-materializer-case01");
const REQUESTED_FAMILY = cliValue("--family", "UNKNOWN").trim().toUpperCase();
const REQUESTED_STRATEGY = cliValue("--strategy", "").trim();
const EVIDENCE_PATH = path.resolve(ROOT, cliValue(
  "--evidence",
  "proofs/diagnostics/m6-v7r-ref05-evidence-refresh.json",
));
const OUTPUT_PATH = path.join(ROOT, "proofs", "diagnostics", STEM + ".json");
const CANDIDATE_VIDEO = path.join(ROOT, "proofs", "diagnostics", STEM + ".mp4");
const CONTROL_VIDEO = path.join(ROOT, "proofs", "diagnostics", STEM + "-control.mp4");
const CANDIDATE_EVIDENCE = path.join(ROOT, "proofs", "diagnostics", STEM + "-evidence.json");
const CONTROL_EVIDENCE = path.join(ROOT, "proofs", "diagnostics", STEM + "-control-evidence.json");
let controlRepoRoot = ROOT;
const WINDOWS = (name) => path.join(controlRepoRoot, "scripts", "windows", name);
const CAPABILITIES = [
  "ae.layer.duplicate", "ae.layer.time.offset", "ae.layer.opacity.set",
  "ae.layer.transform.set", "ae.keyframe.temporal_ease.set",
  "ae.keyframe.spatial.set", "ae.effect.directional-blur",
  "ae.effect.displacement-map", "ae.effect.turbulent-displace",
  "ae.effect.echo", "ae.effect.exposure",
  "ae.effect.channel-shift",
  "ae.layer.blend_mode.set", "ae.subject.isolate",
  "ae.layer.matte.set", "ae.layer.order.set",
  "ae.precompose.layers",
];

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
const acquireMutationLease = async () => {
  const lease = await request("/mutation-lease/acquire", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      owner: "m6-generic-native-materializer:" + STEM,
      ttlMs: 180_000,
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
const runProofScript = (name) => request("/proof-script", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ scriptPath: WINDOWS(name) }),
});
const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(command + " failed: " + (result.stderr || result.stdout));
  }
  return result.stdout.trim();
};
const load = async (file) => JSON.parse(await readFile(file, "utf8"));
const relative = (file) => path.relative(ROOT, file).replaceAll("\\", "/");
const sha256File = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
const HOST_SCRIPT_NAMES = Object.freeze([
  "m6-generic-native-case01-setup.jsx",
  "m6-generic-native-case01-render-control.jsx",
  "m6-generic-native-case01-readback.jsx",
  "m6-generic-native-case01-render.jsx",
  "m6-generic-native-case01-cleanup.jsx",
]);
const verifyControlHostScriptParity = async () => {
  const crossWorktree = path.resolve(controlRepoRoot) !== path.resolve(ROOT);
  const scripts = [];
  for (const name of HOST_SCRIPT_NAMES) {
    const localPath = path.join(ROOT, "scripts", "windows", name);
    const activePath = WINDOWS(name);
    const [localSha256, activeSha256] = await Promise.all([
      sha256File(localPath),
      sha256File(activePath),
    ]);
    if (localSha256 !== activeSha256) {
      throw new Error(
        `Active control worktree host script differs from the proof checkout: ${name}.`,
      );
    }
    scripts.push({ name, sha256: localSha256 });
  }
  return { crossWorktree, scripts };
};
const segmentedPlan = (plan, segmentOperations, suffix, observed = null) => {
  const operationIds = new Set(segmentOperations.map((operation) => String(operation.operationId)));
  const operations = segmentOperations.map((operation) => ({
    ...operation,
    dependsOn: (operation.dependsOn ?? []).filter((dependency) =>
      operationIds.has(String(dependency))),
  }));
  const finalOperationId = operations.at(-1)?.operationId;
  const checkpoints = finalOperationId === undefined
    ? []
    : [{
        checkpointId: `${String(plan.planId)}:${suffix}:checkpoint`,
        afterOperationIds: [finalOperationId],
        kind: "STRUCTURAL",
        profile: "M5_RECIPE_NATIVE_AE_LOWERING_V1",
      }];
  const structural = (plan.invariants?.structural ?? []).map((invariant) =>
    invariant?.kind === "NATIVE_AE_RECIPE_LOWERED"
      ? { ...invariant, operationCount: operations.length }
      : invariant);
  return {
    ...plan,
    planId: `${String(plan.planId)}:${suffix}`,
    planRevision: 1,
    projectRevision: observed?.projectRevision ?? plan.projectRevision,
    projectFingerprint: observed?.projectFingerprint ?? plan.projectFingerprint,
    environmentFingerprint: observed?.environmentFingerprint ?? plan.environmentFingerprint,
    operations,
    checkpoints,
    invariants: { ...plan.invariants, structural },
    planHash: null,
  };
};
const measure = async (videoPath, sourceId, outputEvidence) => {
  const probePath = outputEvidence.replace(/-evidence\.json$/, "-probe.json");
  run("py", ["-3.12", "scripts/proofs/m6-dense-video-probe.py",
    "--video", videoPath, "--start", "0", "--end", "1",
    "--output", probePath, "--source-id", sourceId,
    "--source-kind", "RENDER", "--analysis-size", "360"]);
  run(process.execPath, ["scripts/proofs/m6-dense-video-evidence.mjs",
    "--probe-json", probePath, "--output-evidence", outputEvidence]);
  return { probePath, evidencePath: outputEvidence, value: await load(outputEvidence) };
};
const project = {
  schema: "editflow.virtual-ae.project.v1",
  activeCompId: "m6-proof-case01-comp",
  compositions: [{
    compId: "m6-proof-case01-comp",
    name: "__EF2_M6_GENERIC_NATIVE_CASE01_PROOF__",
    width: 640, height: 360, durationMs: 1000, frameRate: 30,
    layers: [{
      layerId: "m6-proof-case01-hero", name: "M6 Generic Hero", kind: "PRECOMP",
      sourceRef: "m6-proof-case01-source-comp",
      inMs: 0, outMs: 1000, properties: [], effects: [], masks: [],
    }],
  }],
};
const context = {
  compId: "m6-proof-case01-comp",
  eventTimesMs: { transition: 500 },
  roleBindings: [{ role: "hero", layerIds: ["m6-proof-case01-hero"] }],
  parameterValues: {},
};

let artifact = null;
let fixtureTouched = false;
let hostScriptParity = null;
try {
  const evidence = await load(EVIDENCE_PATH);
  let anatomy;
  let selected;
  let sourceAdmission = null;
  if (REQUESTED_FAMILY === "UNKNOWN") {
    anatomy = decomposeUnknownEffectV1(evidence);
    const synthesis = synthesizeUnknownEffectV1({
      evidence,
      availableCapabilities: CAPABILITIES,
    });
    if (synthesis.status !== "READY_FOR_PROOF" || synthesis.selected === null) {
      throw new Error("Unknown synthesis did not produce a selectable construction.");
    }
    selected = REQUESTED_STRATEGY.length === 0
      ? synthesis.selected
      : synthesis.candidates.find((candidate) => candidate.strategy === REQUESTED_STRATEGY);
    if (selected === undefined || selected === null) {
      throw new Error(`Requested synthesis strategy '${REQUESTED_STRATEGY}' is unavailable.`);
    }
  } else {
    const supportedFamilies = new Set(
      createCanonicalProfessionalBenchmarkV1()
        .map((item) => item.family)
        .filter((family) => family !== "UNKNOWN"),
    );
    if (!supportedFamilies.has(REQUESTED_FAMILY)) {
      throw new Error(`Unsupported known benchmark family '${REQUESTED_FAMILY}'.`);
    }
    if (REQUESTED_STRATEGY.length > 0) {
      throw new Error("--strategy is only valid for UNKNOWN synthesis materialization.");
    }
    sourceAdmission = evaluateReferenceFamilyCandidateV1(evidence, REQUESTED_FAMILY);
    if (!sourceAdmission.passed) {
      throw new Error(
        `Reference evidence failed ${REQUESTED_FAMILY} family admission: ${sourceAdmission.failures.join(" | ")}`,
      );
    }
    anatomy = deriveEffectAnatomyV1(evidence, REQUESTED_FAMILY);
    const graph = buildConstructionGraphV1(anatomy);
    selected = {
      candidateId: `known-family:${REQUESTED_FAMILY}:${evidence.contentKey}`,
      strategy: `KNOWN_FAMILY_${REQUESTED_FAMILY}`,
      graph,
      capabilityGaps: [],
    };
  }
  if (REQUESTED_FAMILY === "UNKNOWN" && selected.capabilityGaps.length > 0) {
    throw new Error(
      `Requested synthesis strategy '${selected.strategy}' has capability gaps: ${selected.capabilityGaps.join(", ")}.`,
    );
  }
  const compilation = compileConstructionGraphV1(
    selected.graph,
    CAPABILITIES,
  );
  if (compilation.capabilityGaps.length > 0) {
    throw new Error(
      `Requested materialization has capability gaps: ${compilation.capabilityGaps.join(", ")}.`,
    );
  }
  // Reject invalid visual evidence before touching the live AE control plane.
  // Host parity and mutation leasing are relevant only after a construction is
  // semantically admissible and compile-complete.
  const health = await request("/healthz");
  if (typeof health.repoRoot === "string" && health.repoRoot.length > 0) {
    controlRepoRoot = path.resolve(health.repoRoot);
  }
  hostScriptParity = await verifyControlHostScriptParity();
  await acquireMutationLease();
  fixtureTouched = true;
  await runProofScript("m6-generic-native-case01-setup.jsx");
  await runProofScript("m6-generic-native-case01-render-control.jsx");
  await copyFile(path.join(os.tmpdir(), "M6_generic_native_case01_control.mp4"), CONTROL_VIDEO);
  const live = await request("/state");
  const temporalNodes = selected.graph.nodes.filter((node) =>
    node.kind === "TEMPORAL_DUPLICATES"
    && node.parameters.synthesisStrategy !== "LAYERED_ECHO_AUGMENTED");
  if (temporalNodes.length > 1) {
    throw new Error(`Expected at most one coordinated temporal node, received ${temporalNodes.length}.`);
  }
  const temporalParameters = temporalNodes[0]?.parameters ?? {};
  const expectedTemporalStateCount = temporalNodes.length === 0
    ? 1
    : Math.max(2, Math.min(8, Math.round(
      temporalParameters.fragmentationTemporalStateCountPeak
        ?? temporalParameters.temporalStateCountPeak
        ?? 2,
    )));
  const chromaNode = selected.graph.nodes.find((node) =>
    node.kind === "CHROMATIC_TREATMENT");
  const expectedChromaDuplicateCount = typeof chromaNode?.parameters.chromaticSeparationPeak === "number"
    && Number.isFinite(chromaNode.parameters.chromaticSeparationPeak)
    && chromaNode.parameters.chromaticSeparationPeak > 0
    ? 2
    : 0;
  const expectedDuplicateCount = expectedTemporalStateCount - 1 + expectedChromaDuplicateCount;
  const proofOnlyEffectSchemaRefs = [...new Set(selected.graph.nodes
    .map((node) => node.parameters.effectSchemaRef)
    .filter((value) => typeof value === "string" && value.length > 0))];
  const proofContext = proofOnlyEffectSchemaRefs.length === 0
    ? context
    : { ...context, proofOnlyEffectSchemaRefs };
  const compileNative = (observedState) => compileConstructionThroughNativeAeV1(
    compilation,
    project,
    proofContext,
    {
      planId: STEM,
      observedState,
      curveBindingMode: "LIVE_ADAPTIVE",
      creativeObjective: `Materialize ${selected.graph.family} reference behavior through Editing IR, Virtual AE, and native AE.`,
      recipeRefs: [selected.graph.graphId],
    },
  );
  let native = compileNative(live.state.observed);
  if (!native.compiled || native.plan === null) {
    throw new Error("Native construction failed: " + native.issues.join(", "));
  }
  const executePlan = (plan) => request("/run-transaction", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan }),
  });
  const executeNative = async () => {
    if (native.plan.operations.length <= 64) return await executePlan(native.plan);

    // Compound M6 synthesis can legitimately exceed the host's conservative
    // single-transaction proof budget. Preserve operation order and commit in
    // bounded chunks, refreshing the authoritative host revision after every
    // committed phase instead of hard-coding a particular effect boundary.
    const maxSegmentOperations = 48;
    const phases = [];
    for (let start = 0, phaseIndex = 0;
      start < native.plan.operations.length;
      start += maxSegmentOperations, phaseIndex += 1) {
      const operations = native.plan.operations.slice(start, start + maxSegmentOperations);
      const observed = phaseIndex === 0 ? null : (await request("/state")).state.observed;
      const phasePlan = segmentedPlan(
        native.plan,
        operations,
        `phase-${phaseIndex + 1}`,
        observed,
      );
      const phase = await executePlan(phasePlan);
      if (phase.result.state !== "COMMITTED") {
        throw new Error(`Native proof phase ${phaseIndex + 1} did not commit.`);
      }
      phases.push(phase.result);
    }
    const final = phases.at(-1);
    if (final === undefined) throw new Error("Native proof produced no transaction phases.");
    return {
      ok: true,
      result: {
        ...final,
        phaseCount: phases.length,
        phases,
      },
    };
  };
  let transaction;
  try {
    transaction = await executeNative();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const revisionRace = message.includes("HOST_REVISION_MISMATCH")
      || message.includes("RECOVERY_REQUIRED");
    if (!revisionRace) throw error;
    // Reset only the disposable proof fixture, then rebuild against the freshest
    // observed AE revision. Never weaken the production revision guard.
    await runProofScript("m6-generic-native-case01-setup.jsx");
    const refreshed = await request("/state");
    native = compileNative(refreshed.state.observed);
    if (!native.compiled || native.plan === null) {
      throw new Error("Native retry construction failed: " + native.issues.join(", "));
    }
    transaction = await executeNative();
  }
  await runProofScript("m6-generic-native-case01-readback.jsx");
  const readback = await readFile(
    path.join(controlRepoRoot, ".tmp", "m6-generic-native-case01-readback.txt"),
    "utf8",
  );
  const commands = native.plan.operations.map((operation) => operation.input.command);
  const duplicateCount = commands.filter((command) => command === "layer.duplicate").length;
  const compLine = readback.split(/\r?\n/).find((line) => line.startsWith("COMP\t"));
  const actualLayerCount = Number(compLine?.split("\t")[2]);
  const layerLines = readback.split(/\r?\n/).filter((line) => line.startsWith("LAYER\t"));
  const lines = readback.split(/\r?\n/);
  const startTimes = layerLines
    .map((line) => Number(line.split("\t")[4]))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const frameSeconds = 1 / project.compositions[0].frameRate;
  const referenceFrameIntervalMs = Number(temporalParameters.referenceFrameIntervalMs);
  const referenceFrameSeconds = Number.isFinite(referenceFrameIntervalMs) && referenceFrameIntervalMs > 0
    ? referenceFrameIntervalMs / 1000
    : frameSeconds;
  const globalLayerOffsetsAbsent = startTimes.length === 1 + expectedDuplicateCount
    && startTimes.every((value) => Math.abs(value) < 0.0001);
  const timeRemapLines = lines.filter((line) => line.startsWith("TIME_REMAP\t"));
  const timeRemapEnabledCount = timeRemapLines
    .filter((line) => line.split("\t")[1] === "1").length;
  const timeRemapExpressions = timeRemapLines
    .map((line) => line.split("\t").slice(2).join("\t"))
    .filter((value) => value.length > 0);
  const temporalOffsetsSeconds = [...new Set(timeRemapExpressions
    .map((expression) => expression.match(/Math\.max\(0,value-([0-9.eE+-]+)\)/))
    .map((match) => match === null ? Number.NaN : Number(match[1]))
    .filter((value) => Number.isFinite(value))
    .map((value) => Number(value.toFixed(12))))]
    .sort((a, b) => a - b);
  const expectedTemporalOffsetsSeconds = Array.from(
    { length: expectedTemporalStateCount - 1 },
    (_, state) => (state + 1) * referenceFrameSeconds,
  );
  const temporalOffsetsMatch = temporalOffsetsSeconds.length === expectedTemporalOffsetsSeconds.length
    && temporalOffsetsSeconds.every((value, index) =>
      Math.abs(value - expectedTemporalOffsetsSeconds[index]) < 0.0001);
  const eventLocalOpacityExpressions = lines
    .filter((line) => line.startsWith("OPACITY_EXPR\t"))
    .map((line) => line.slice("OPACITY_EXPR\t".length))
    .filter((value) => value.includes("var event=0.5;") && value.includes("thisComp.frameDuration"));
  const eventLocalOpacityExpressionVariants = [...new Set(eventLocalOpacityExpressions)];
  const eventLocalVisibilityMatch = eventLocalOpacityExpressionVariants.length === expectedTemporalStateCount - 1;
  const recursiveStableId = /::state-\d+.*::state-\d+/.test(readback);
  artifact = {
    schema: "editflow.m6.generic-native-materializer-proof.v1",
    generatedAt: new Date().toISOString(),
    sourceEvidence: relative(EVIDENCE_PATH),
    evidenceRefs: evidence.evidenceRefs,
    requestedFamily: REQUESTED_FAMILY,
    family: selected.graph.family,
    strategy: selected.strategy,
    sourceAdmission: sourceAdmission === null ? null : {
      passed: sourceAdmission.passed,
      requestedFamily: sourceAdmission.requestedFamily,
      classifiedFamily: sourceAdmission.classifiedFamily,
      definingCoverage: sourceAdmission.definingCoverage,
      weightedContractScore: sourceAdmission.weightedContractScore,
      evidenceContentKey: sourceAdmission.evidenceContentKey,
      analyzerFingerprint: sourceAdmission.analyzerFingerprint,
    },
    hostScriptParity,
    graphId: selected.graph.graphId,
    definingCoverage: compilation.definingCoverageComplete,
    capabilityGaps: compilation.capabilityGaps,
    nativePlan: {
      operationCount: native.plan.operations.length,
      commands,
      requiredCapabilities: native.plan.requiredCapabilities,
      containsOpaqueM6Placeholder: JSON.stringify(native.plan).includes("M6.TemporalState"),
      expectedTemporalStateCount,
      expectedDuplicateCount,
      expectedChromaDuplicateCount,
    },
    transaction: { state: transaction.result.state, result: transaction.result },
    readbackVerification: {
      actualLayerCount,
      duplicateCount,
      startTimes,
      globalLayerOffsetsAbsent,
      timeRemapEnabledCount,
      timeRemapExpressions,
      temporalOffsetsSeconds,
      expectedTemporalOffsetsSeconds,
      temporalOffsetsMatch,
      eventLocalOpacityExpressions,
      eventLocalVisibilityMatch,
      recursiveStableId,
    },
    readback,
  };
  if (transaction.result.state !== "COMMITTED") throw new Error("Native transaction did not commit.");
  if (artifact.nativePlan.containsOpaqueM6Placeholder) throw new Error("Opaque M6 placeholder leaked to native plan.");
  if (duplicateCount !== expectedDuplicateCount) {
    throw new Error(`Materializer duplicated ${duplicateCount} times; expected ${expectedDuplicateCount} from temporal plus chromatic construction.`);
  }
  const expectedLayerCount = 1 + expectedDuplicateCount;
  if (actualLayerCount !== expectedLayerCount) {
    throw new Error(`AE readback contains ${actualLayerCount} layers; expected ${expectedLayerCount}.`);
  }
  if (!globalLayerOffsetsAbsent) throw new Error("Temporal materializer regressed to whole-layer startTime offsets.");
  if (timeRemapEnabledCount !== expectedTemporalStateCount - 1) {
    throw new Error(`Expected Time Remap only on ${expectedTemporalStateCount - 1} synthesized temporal duplicates; observed ${timeRemapEnabledCount}.`);
  }
  if (!temporalOffsetsMatch) throw new Error("Event-local Time Remap offsets do not match the synthesized frame cadence.");
  if (!eventLocalVisibilityMatch) throw new Error("Temporal duplicates are missing bounded event-local opacity realization.");
  if (recursiveStableId) throw new Error("Recursive temporal-state duplication reappeared in AE readback.");

  await runProofScript("m6-generic-native-case01-render.jsx");
  await copyFile(path.join(os.tmpdir(), "M6_generic_native_case01_candidate.mp4"), CANDIDATE_VIDEO);
  const candidate = await measure(
    CANDIDATE_VIDEO,
    STEM,
    CANDIDATE_EVIDENCE,
  );
  const control = await measure(
    CONTROL_VIDEO,
    STEM + "-control",
    CONTROL_EVIDENCE,
  );
  if (candidate.value.analyzerFingerprint !== evidence.analyzerFingerprint
    || control.value.analyzerFingerprint !== evidence.analyzerFingerprint) {
    throw new Error("Generic native render evidence is not analyzer-compatible with the professional reference.");
  }
  const baselineAwareComparison = REQUESTED_FAMILY !== "UNKNOWN";
  const candidateComparison = compareSemanticVisualFidelityV1({
    reference: evidence,
    render: candidate.value,
    ...(baselineAwareComparison ? { baseline: control.value } : {}),
    dna: anatomy.dna,
    alignment: "SEMANTIC",
  });
  const controlComparison = compareSemanticVisualFidelityV1({
    reference: evidence,
    render: control.value,
    ...(baselineAwareComparison ? { baseline: control.value } : {}),
    dna: anatomy.dna,
    alignment: "SEMANTIC",
  });
  const candidateGate = evaluateProfessionalFidelityGateV1({
    comparison: candidateComparison,
    compilation,
    synthesisPossible: true,
  });
  const controlGate = evaluateProfessionalFidelityGateV1({
    comparison: controlComparison,
    compilation,
    synthesisPossible: true,
  });
  const visibleConsequence = candidate.value.contentKey !== control.value.contentKey;
  const semanticImprovement = candidateComparison.definingCoverage > controlComparison.definingCoverage
    || candidateComparison.weightedFidelity > controlComparison.weightedFidelity;
  artifact.status = candidateGate.certified && !controlGate.certified
    ? "PROFESSIONAL_FIDELITY_PASS"
    : "RENDERED_FIDELITY_GAP";
  artifact.renderedFidelity = {
    visibleConsequence,
    semanticImprovement,
    candidate: {
      video: relative(CANDIDATE_VIDEO),
      videoSha256: await sha256File(CANDIDATE_VIDEO),
      probe: relative(candidate.probePath),
      evidence: relative(candidate.evidencePath),
      contentKey: candidate.value.contentKey,
      summary: candidate.value.summary,
      comparison: candidateComparison,
      gate: candidateGate,
    },
    control: {
      video: relative(CONTROL_VIDEO),
      videoSha256: await sha256File(CONTROL_VIDEO),
      probe: relative(control.probePath),
      evidence: relative(control.evidencePath),
      contentKey: control.value.contentKey,
      summary: control.value.summary,
      comparison: controlComparison,
      gate: controlGate,
    },
  };
  if (!visibleConsequence) throw new Error("Materialized graph produced no retained pixel consequence versus the control render.");
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(artifact, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({
    ok: artifact.status === "PROFESSIONAL_FIDELITY_PASS",
    output: OUTPUT_PATH,
    status: artifact.status,
    family: artifact.family,
    strategy: artifact.strategy,
    operationCount: artifact.nativePlan.operationCount,
    transactionState: artifact.transaction.state,
    candidateDefiningCoverage: candidateComparison.definingCoverage,
    candidateWeightedFidelity: candidateComparison.weightedFidelity,
    candidateCertified: candidateGate.certified,
    candidateResidualInvariantIds: candidateGate.underDrivenInvariantIds,
    controlCertified: controlGate.certified,
    semanticImprovement,
  }));
  if (artifact.status !== "PROFESSIONAL_FIDELITY_PASS") process.exitCode = 2;
} finally {
  try {
    if (fixtureTouched) {
      await runProofScript("m6-generic-native-case01-cleanup.jsx").catch(() => {});
    }
  } finally {
    await releaseMutationLease().catch(() => {});
  }
}
