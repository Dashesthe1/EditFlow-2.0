import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileConstructionGraphV1,
  compileConstructionThroughNativeAeV1,
  synthesizeUnknownEffectV1,
} from "../../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const CONTROL = "http://127.0.0.1:32146";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EVIDENCE_PATH = path.join(ROOT, "proofs", "diagnostics", "m6-v6r-ref05-evidence-current.json");
const OUTPUT_PATH = path.join(ROOT, "proofs", "diagnostics", "m6-generic-native-materializer-case01.json");
const WINDOWS = (name) => path.join(ROOT, "scripts", "windows", name);
const CAPABILITIES = [
  "ae.layer.duplicate", "ae.layer.time.offset", "ae.layer.opacity.set",
  "ae.layer.transform.set", "ae.keyframe.temporal_ease.set",
  "ae.keyframe.spatial.set", "ae.effect.directional-blur",
  "ae.effect.displacement-map", "ae.effect.exposure",
  "ae.effect.channel-shift", "ae.subject.isolate",
  "ae.layer.matte.set", "ae.layer.order.set",
];

const request = async (pathname, init) => {
  const response = await fetch(CONTROL + pathname, init);
  const body = await response.json();
  if (!response.ok || body.ok === false) {
    throw new Error(pathname + " failed: " + JSON.stringify(body));
  }
  return body;
};
const runProofScript = (name) => request("/proof-script", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ scriptPath: WINDOWS(name) }),
});
const project = {
  schema: "editflow.virtual-ae.project.v1",
  activeCompId: "m6-proof-comp",
  compositions: [{
    compId: "m6-proof-comp",
    name: "__EF2_M6_GENERIC_NATIVE_PROOF__",
    width: 640, height: 360, durationMs: 1000, frameRate: 30,
    layers: [{
      layerId: "m6-proof-hero", name: "M6 Generic Hero", kind: "PRECOMP",
      sourceRef: "m6-proof-source-comp",
      inMs: 0, outMs: 1000, properties: [], effects: [], masks: [],
    }],
  }],
};
const context = {
  compId: "m6-proof-comp",
  eventTimesMs: { transition: 500 },
  roleBindings: [{ role: "hero", layerIds: ["m6-proof-hero"] }],
  parameterValues: {},
};

let artifact = null;
try {
  await request("/healthz");
  await runProofScript("m6-generic-native-proof-setup.jsx");
  const live = await request("/state");
  const evidence = JSON.parse(await readFile(EVIDENCE_PATH, "utf8"));
  const synthesis = synthesizeUnknownEffectV1({
    evidence,
    availableCapabilities: CAPABILITIES,
  });
  if (synthesis.status !== "READY_FOR_PROOF" || synthesis.selected === null) {
    throw new Error("Unknown synthesis did not produce a selectable construction.");
  }
  if (synthesis.selected.graph.family !== "UNKNOWN") {
    throw new Error("Generic proof requires UNKNOWN family provenance.");
  }
  const compilation = compileConstructionGraphV1(
    synthesis.selected.graph,
    CAPABILITIES,
  );
  const temporalNodes = synthesis.selected.graph.nodes.filter((node) =>
    node.kind === "TEMPORAL_DUPLICATES");
  if (temporalNodes.length !== 1) {
    throw new Error(`Expected one coordinated temporal node, received ${temporalNodes.length}.`);
  }
  const temporalParameters = temporalNodes[0].parameters;
  const expectedTemporalStateCount = Math.max(2, Math.min(8, Math.round(
    temporalParameters.fragmentationTemporalStateCountPeak
      ?? temporalParameters.temporalStateCountPeak
      ?? 2,
  )));
  const native = compileConstructionThroughNativeAeV1(
    compilation,
    project,
    context,
    {
      planId: "m6-generic-native-materializer-case01",
      observedState: live.state.observed,
      curveBindingMode: "LIVE_ADAPTIVE",
      creativeObjective: "Materialize UNKNOWN reference behavior through Editing IR, Virtual AE, and native AE.",
      recipeRefs: [synthesis.selected.graph.graphId],
    },
  );
  if (!native.compiled || native.plan === null) {
    throw new Error("Native construction failed: " + native.issues.join(", "));
  }
  const transaction = await request("/run-transaction", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan: native.plan }),
  });
  await runProofScript("m6-generic-native-proof-readback.jsx");
  const readback = await readFile(path.join(ROOT, ".tmp", "m6-generic-native-readback.txt"), "utf8");
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
  const globalLayerOffsetsAbsent = startTimes.length === expectedTemporalStateCount
    && startTimes.every((value) => Math.abs(value) < 0.0001);
  const timeRemapLines = lines.filter((line) => line.startsWith("TIME_REMAP\t"));
  const timeRemapEnabledCount = timeRemapLines
    .filter((line) => line.split("\t")[1] === "1").length;
  const timeRemapExpressions = timeRemapLines
    .map((line) => line.split("\t").slice(2).join("\t"))
    .filter((value) => value.length > 0);
  const temporalOffsetsSeconds = timeRemapExpressions
    .map((expression) => expression.match(/Math\.max\(0,value-([0-9.eE+-]+)\)/))
    .map((match) => match === null ? Number.NaN : Number(match[1]))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const expectedTemporalOffsetsSeconds = Array.from(
    { length: expectedTemporalStateCount - 1 },
    (_, state) => (state + 1) * frameSeconds,
  );
  const temporalOffsetsMatch = temporalOffsetsSeconds.length === expectedTemporalOffsetsSeconds.length
    && temporalOffsetsSeconds.every((value, index) =>
      Math.abs(value - expectedTemporalOffsetsSeconds[index]) < 0.0001);
  const eventLocalOpacityExpressions = lines
    .filter((line) => line.startsWith("OPACITY_EXPR\t"))
    .map((line) => line.slice("OPACITY_EXPR\t".length))
    .filter((value) => value.includes("var event=0.5;") && value.includes("thisComp.frameRate"));
  const eventLocalVisibilityMatch = eventLocalOpacityExpressions.length === expectedTemporalStateCount - 1;
  const recursiveStableId = /::state-\d+.*::state-\d+/.test(readback);
  artifact = {
    schema: "editflow.m6.generic-native-materializer-proof.v1",
    generatedAt: new Date().toISOString(),
    sourceEvidence: path.relative(process.cwd(), EVIDENCE_PATH).replaceAll("\\", "/"),
    evidenceRefs: evidence.evidenceRefs,
    family: synthesis.selected.graph.family,
    strategy: synthesis.selected.strategy,
    graphId: synthesis.selected.graph.graphId,
    definingCoverage: compilation.definingCoverageComplete,
    capabilityGaps: compilation.capabilityGaps,
    nativePlan: {
      operationCount: native.plan.operations.length,
      commands,
      requiredCapabilities: native.plan.requiredCapabilities,
      containsOpaqueM6Placeholder: JSON.stringify(native.plan).includes("M6.TemporalState"),
      expectedTemporalStateCount,
      expectedDuplicateCount: expectedTemporalStateCount - 1,
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
  if (duplicateCount !== expectedTemporalStateCount - 1) {
    throw new Error(`Temporal materializer duplicated ${duplicateCount} times; expected ${expectedTemporalStateCount - 1}.`);
  }
  if (actualLayerCount !== expectedTemporalStateCount) {
    throw new Error(`AE readback contains ${actualLayerCount} layers; expected ${expectedTemporalStateCount}.`);
  }
  if (!globalLayerOffsetsAbsent) throw new Error("Temporal materializer regressed to whole-layer startTime offsets.");
  if (timeRemapEnabledCount !== expectedTemporalStateCount - 1) {
    throw new Error(`Expected Time Remap only on ${expectedTemporalStateCount - 1} synthesized temporal duplicates; observed ${timeRemapEnabledCount}.`);
  }
  if (!temporalOffsetsMatch) throw new Error("Event-local Time Remap offsets do not match the synthesized frame cadence.");
  if (!eventLocalVisibilityMatch) throw new Error("Temporal duplicates are missing bounded event-local opacity realization.");
  if (recursiveStableId) throw new Error("Recursive temporal-state duplication reappeared in AE readback.");
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(artifact, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({
    ok: true,
    output: OUTPUT_PATH,
    family: artifact.family,
    strategy: artifact.strategy,
    operationCount: artifact.nativePlan.operationCount,
    transactionState: artifact.transaction.state,
  }));
} finally {
  await runProofScript("m6-generic-native-proof-cleanup.jsx").catch(() => {});
}
