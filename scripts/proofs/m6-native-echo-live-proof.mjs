import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

import {
  compareSemanticVisualFidelityV1,
  compileConstructionGraphV1,
  compileConstructionThroughNativeAeV1,
  decomposeUnknownEffectV1,
  synthesizeUnknownEffectV1,
} from "../../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const CONTROL = "http://127.0.0.1:32146";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REFERENCE_PATH = path.join(ROOT, "proofs", "diagnostics", "m6-v6r-ref05-evidence-current.json");
const OUTPUT_PATH = path.join(ROOT, "proofs", "diagnostics", "m6-native-echo-live-proof.json");
const WINDOWS = (name) => path.join(ROOT, "scripts", "windows", name);
const EXPECTED_REFERENCE_SHA256 = "c6b8fa7373d43ae332a71852468afcbd4ff812571fe9a76aec266463ae78f2ae";
const REFERENCE_START_SECONDS = 9.5076947765;
const REFERENCE_END_SECONDS = 10.209492985;
const readArg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? "" : "";
};
const REFERENCE_VIDEO = readArg("--reference-video") || process.env.M6_REFERENCE_VIDEO || "";
const CAPABILITIES = [
  "ae.layer.duplicate", "ae.layer.time.offset", "ae.layer.opacity.set",
  "ae.layer.transform.set", "ae.keyframe.temporal_ease.set", "ae.keyframe.spatial.set",
  "ae.effect.directional-blur", "ae.effect.displacement-map", "ae.effect.exposure",
  "ae.effect.channel-shift",
  "ae.layer.blend_mode.set", "ae.subject.isolate", "ae.layer.matte.set",
  "ae.layer.order.set", "ae.precompose.layers", "ae.effect.echo",
];
const request = async (pathname, init) => {
  const response = await fetch(CONTROL + pathname, init);
  const body = await response.json();
  if (!response.ok || body.ok === false) throw new Error(pathname + " failed: " + JSON.stringify(body));
  return body;
};
const runProofScript = (name) => request("/proof-script", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ scriptPath: WINDOWS(name) }),
});
const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: ROOT, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(command + " failed: " + (result.stderr || result.stdout));
  return result.stdout.trim();
};
const load = async (file) => JSON.parse(await readFile(file, "utf8"));
const measureRenderedAb = async (candidateProbe, controlProbe) => {
  const frameCount = Math.min(candidateProbe.frames.length, controlProbe.frames.length);
  let changedFrames = 0;
  let summedMeanFrameDelta = 0;
  let maxMeanFrameDelta = 0;
  let maxChangedPixelRatio = 0;
  for (let index = 0; index < frameCount; index += 1) {
    const candidateFrame = PNG.sync.read(await readFile(candidateProbe.frames[index].pngPath));
    const controlFrame = PNG.sync.read(await readFile(controlProbe.frames[index].pngPath));
    if (candidateFrame.width !== controlFrame.width || candidateFrame.height !== controlFrame.height) {
      throw new Error("Native Echo A/B render dimensions do not match.");
    }
    let normalizedAbsoluteDelta = 0;
    let changedPixels = 0;
    const pixelCount = candidateFrame.width * candidateFrame.height;
    for (let offset = 0; offset < candidateFrame.data.length; offset += 4) {
      let channelDelta = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        channelDelta += Math.abs(candidateFrame.data[offset + channel] - controlFrame.data[offset + channel]);
      }
      normalizedAbsoluteDelta += channelDelta / (3 * 255);
      if (channelDelta > 12) changedPixels += 1;
    }
    const meanFrameDelta = normalizedAbsoluteDelta / pixelCount;
    const changedPixelRatio = changedPixels / pixelCount;
    if (meanFrameDelta > 1e-6) changedFrames += 1;
    summedMeanFrameDelta += meanFrameDelta;
    maxMeanFrameDelta = Math.max(maxMeanFrameDelta, meanFrameDelta);
    maxChangedPixelRatio = Math.max(maxChangedPixelRatio, changedPixelRatio);
  }
  return {
    frameCount,
    changedFrames,
    meanFrameDelta: frameCount === 0 ? 0 : summedMeanFrameDelta / frameCount,
    maxMeanFrameDelta,
    maxChangedPixelRatio,
  };
};
const project = {
  schema: "editflow.virtual-ae.project.v1",
  activeCompId: "m6-proof-comp",
  compositions: [{
    compId: "m6-proof-comp", name: "__EF2_M6_GENERIC_NATIVE_PROOF__",
    width: 640, height: 360, durationMs: 1000, frameRate: 30,
    layers: [{
      layerId: "m6-proof-hero", name: "M6 Generic Hero", kind: "PRECOMP",
      sourceRef: "m6-proof-source-comp", inMs: 0, outMs: 1000,
      properties: [], effects: [], masks: [],
    }],
  }],
};
const context = {
  compId: "m6-proof-comp",
  eventTimesMs: { transition: 500 },
  roleBindings: [{ role: "hero", layerIds: ["m6-proof-hero"] }],
  parameterValues: {},
  proofOnlyEffectSchemaRefs: ["ae.effect-schema.m6.echo.v1"],
};
const parseReadbackProperties = (readback) => Object.fromEntries(
  readback.split(/\r?\n/)
    .filter((line) => line.startsWith("EFFECT_PROP\t"))
    .map((line) => {
      const parts = line.split("\t");
      return [parts[3], Number(parts[4])];
    })
    .filter(([, value]) => Number.isFinite(value)),
);
const parseReadbackPositions = (readback) => readback.split(/\r?\n/)
  .filter((line) => line.startsWith("POS_AT\t"))
  .map((line) => {
    const parts = line.split("\t");
    return { time: Number(parts[1]), x: Number(parts[2]), y: Number(parts[3]) };
  })
  .filter((sample) => Number.isFinite(sample.time)
    && Number.isFinite(sample.x) && Number.isFinite(sample.y));
const measure = async (videoPath, id, stem, options = {}) => {
  const probe = path.join(ROOT, "proofs", "diagnostics", stem + "-probe.json");
  const evidence = path.join(ROOT, "proofs", "diagnostics", stem + "-evidence.json");
  const start = String(options.start ?? 0);
  const end = String(options.end ?? 1);
  const sourceKind = options.sourceKind ?? "RENDER";
  run("py", ["-3.12",
    "scripts/proofs/m6-dense-video-probe.py", "--video", videoPath,
    "--start", start, "--end", end, "--output", probe,
    "--source-id", id, "--source-kind", sourceKind, "--analysis-size", "360",
  ]);
  run(process.execPath, [
    "scripts/proofs/m6-dense-video-evidence.mjs",
    "--probe-json", probe, "--output-evidence", evidence,
  ]);
  return { probe, evidence, probeValue: await load(probe), value: await load(evidence) };
};

let artifact = null;
try {
  await request("/healthz");
  await runProofScript("m6-native-echo-proof-setup.jsx");
  const live = await request("/state");
  let referenceEvidencePath = REFERENCE_PATH;
  let referenceProbe = null;
  let reference = await load(REFERENCE_PATH);
  if (REFERENCE_VIDEO) {
    const measuredReference = await measure(
      REFERENCE_VIDEO,
      "m6-v6r-ref05-current",
      "m6-native-echo-reference-current",
      {
        start: REFERENCE_START_SECONDS,
        end: REFERENCE_END_SECONDS,
        sourceKind: "REFERENCE",
      },
    );
    const sourceSha256 = String(measuredReference.probeValue.sourceVideoSha256 ?? "").toLowerCase();
    if (sourceSha256 !== EXPECTED_REFERENCE_SHA256) {
      throw new Error("Reference video SHA-256 mismatch: " + sourceSha256);
    }
    referenceEvidencePath = measuredReference.evidence;
    referenceProbe = measuredReference.probeValue;
    reference = measuredReference.value;
  }
  const synthesis = synthesizeUnknownEffectV1({
    evidence: reference,
    availableCapabilities: CAPABILITIES,
  });
  const echoCandidate = synthesis.candidates.find((item) => item.strategy === "NATIVE_ECHO_HYBRID");
  if (!echoCandidate) throw new Error("Native Echo candidate was not generated.");
  if (echoCandidate.capabilityGaps.length > 0) {
    throw new Error("Native Echo candidate retains capability gaps: " + echoCandidate.capabilityGaps.join(", "));
  }
  const compilation = compileConstructionGraphV1(echoCandidate.graph, CAPABILITIES);
  if (compilation.recipe === null) throw new Error("Native Echo construction did not compile to Editing IR.");
  const native = compileConstructionThroughNativeAeV1(
    compilation, project, context, {
      planId: "m6-native-echo-live-proof",
      observedState: live.state.observed,
      curveBindingMode: "LIVE_ADAPTIVE",
      creativeObjective: "Prove a visually consequential native Echo hypothesis while the schema remains proof-only.",
      recipeRefs: [echoCandidate.graph.graphId],
    },
  );
  if (!native.compiled || native.plan === null) {
    throw new Error("Native Echo lowering failed: " + native.issues.join(", "));
  }
  const echoNode = echoCandidate.graph.nodes.find((node) =>
    node.parameters.synthesisStrategy === "NATIVE_ECHO_HYBRID");
  if (!echoNode) throw new Error("Native Echo construction node is missing.");
  const expected = {
    echoTime: -Number(echoNode.parameters.echoSpacingFrames) / project.compositions[0].frameRate,
    numberOfEchoes: Number(echoNode.parameters.numberOfEchoes),
    startingIntensity: Number(echoNode.parameters.startingIntensity),
    decay: Number(echoNode.parameters.decay),
  };
  const transaction = await request("/run-transaction", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan: native.plan }),
  });
  if (transaction.result.state !== "COMMITTED") throw new Error("Native Echo transaction did not commit.");
  await runProofScript("m6-native-echo-causal-readback.jsx");
  const readback = await readFile(path.join(ROOT, ".tmp", "m6-native-echo-causal-readback.txt"), "utf8");
  if (!readback.includes("INNER_POSITION_EXPR\tvar event=")) {
    throw new Error("AE readback does not prove event-local transform motion was moved inside the Echo source precomp.");
  }
  const positionSamples = parseReadbackPositions(readback);
  const positionYValues = positionSamples.map((sample) => sample.y);
  const positionExcursion = positionYValues.length > 0
    ? Math.max(...positionYValues) - Math.min(...positionYValues)
    : 0;
  if (positionSamples.length < 4 || positionExcursion < 2) {
    throw new Error("AE installed the event-local position expression, but live valueAtTime readback proves it is not producing motion.");
  }
  if (!readback.includes("\tADBE Echo\t1")) throw new Error("AE readback does not contain an enabled native Echo effect.");
  const properties = parseReadbackProperties(readback);
  const checks = [
    ["ADBE Echo-0001", expected.echoTime],
    ["ADBE Echo-0002", expected.numberOfEchoes],
    ["ADBE Echo-0003", expected.startingIntensity],
    ["ADBE Echo-0004", expected.decay],
  ];
  for (const [matchName, value] of checks) {
    if (!Number.isFinite(properties[matchName]) || Math.abs(properties[matchName] - value) > 1e-6) {
      throw new Error("Echo property mismatch for " + matchName + ": " + properties[matchName] + " vs " + value);
    }
  }
  await runProofScript("m6-native-echo-render.jsx");
  await runProofScript("m6-native-echo-render-control.jsx");
  const candidateVideo = path.join(ROOT, "proofs", "diagnostics", "m6-native-echo-case01.mp4");
  const controlVideo = path.join(ROOT, "proofs", "diagnostics", "m6-native-echo-control01.mp4");
  await copyFile(path.join(os.tmpdir(), "M6_native_echo_case01.mp4"), candidateVideo);
  await copyFile(path.join(os.tmpdir(), "M6_native_echo_control01.mp4"), controlVideo);
  const candidate = await measure(candidateVideo, "m6-native-echo-case01", "m6-native-echo-case01");
  const control = await measure(controlVideo, "m6-native-echo-control01", "m6-native-echo-control01");
  let candidateComparison = null;
  let controlComparison = null;
  let referenceComparisonStatus = "BLOCKED_ANALYZER_FINGERPRINT";
  if (reference.analyzerFingerprint === candidate.value.analyzerFingerprint
    && reference.analyzerFingerprint === control.value.analyzerFingerprint) {
    const anatomy = decomposeUnknownEffectV1(reference);
    candidateComparison = compareSemanticVisualFidelityV1({
      reference, render: candidate.value, dna: anatomy.dna, alignment: "SEMANTIC",
    });
    controlComparison = compareSemanticVisualFidelityV1({
      reference, render: control.value, dna: anatomy.dna, alignment: "SEMANTIC",
    });
    referenceComparisonStatus = "COMPLETED";
  }
  const candidateSummary = candidate.value.summary;
  const controlSummary = control.value.summary;
  const temporalDiagnostics = {
    globalStateCount: candidateSummary.temporalStateCountPeak > controlSummary.temporalStateCountPeak,
    fragmentationStateCount:
      candidateSummary.fragmentationTemporalStateCountPeak > controlSummary.fragmentationTemporalStateCountPeak,
    fragmentationOverlap:
      candidateSummary.fragmentationOverlapDensityPeak > controlSummary.fragmentationOverlapDensityPeak + 0.002,
    persistence: candidateSummary.temporalPersistence > controlSummary.temporalPersistence + 0.01,
    globalOverlap: candidateSummary.overlapDensityPeak > controlSummary.overlapDensityPeak + 0.002,
  };
  const renderedAb = await measureRenderedAb(candidate.probeValue, control.probeValue);
  const minimumChangedFrames = Math.max(3, Math.floor(renderedAb.frameCount * 0.5));
  const visualConsequenceDetected = candidate.value.contentKey !== control.value.contentKey
    && renderedAb.changedFrames >= minimumChangedFrames
    && renderedAb.meanFrameDelta >= 0.002
    && renderedAb.maxChangedPixelRatio >= 0.01;
  if (!visualConsequenceDetected) {
    throw new Error("Native Echo rendered, but direct A/B pixels did not prove a material causal consequence versus Echo-off control: "
      + JSON.stringify({ renderedAb, minimumChangedFrames }));
  }
  artifact = {
    schema: "editflow.m6.native-echo-live-proof.v1",
    generatedAt: new Date().toISOString(),
    status: "PASS",
    schemaStatus: "PROOF_REQUIRED",
    sourceEvidence: path.relative(ROOT, referenceEvidencePath).replaceAll("\\", "/"),
    sourceVideoSha256: referenceProbe?.sourceVideoSha256 ?? null,
    referenceWindow: {
      startSeconds: REFERENCE_START_SECONDS,
      endSeconds: REFERENCE_END_SECONDS,
      refreshedWithCurrentAnalyzer: Boolean(REFERENCE_VIDEO),
    },
    strategy: echoCandidate.strategy,
    graphId: echoCandidate.graph.graphId,
    nativePlan: {
      operationCount: native.plan.operations.length,
      commands: native.plan.operations.map((operation) => operation.input.command),
      requiredCapabilities: native.plan.requiredCapabilities,
    },
    transaction: { state: transaction.result.state, transactionId: transaction.result.transactionId },
    expectedEchoProperties: expected,
    readbackEchoProperties: properties,
    renderEvidence: {
      candidateVideo: path.relative(ROOT, candidateVideo).replaceAll("\\", "/"),
      controlVideo: path.relative(ROOT, controlVideo).replaceAll("\\", "/"),
      candidateEvidence: path.relative(ROOT, candidate.evidence).replaceAll("\\", "/"),
      controlEvidence: path.relative(ROOT, control.evidence).replaceAll("\\", "/"),
      temporalDiagnostics,
      renderedAb,
      candidateSummary: {
        temporalStateCountPeak: candidateSummary.temporalStateCountPeak,
        temporalPersistence: candidateSummary.temporalPersistence,
        overlapDensityPeak: candidateSummary.overlapDensityPeak,
        fragmentationTemporalStateCountPeak: candidateSummary.fragmentationTemporalStateCountPeak,
        fragmentationOverlapDensityPeak: candidateSummary.fragmentationOverlapDensityPeak,
        fragmentationStateSeparationPeak: candidateSummary.fragmentationStateSeparationPeak,
      },
      controlSummary: {
        temporalStateCountPeak: controlSummary.temporalStateCountPeak,
        temporalPersistence: controlSummary.temporalPersistence,
        overlapDensityPeak: controlSummary.overlapDensityPeak,
        fragmentationTemporalStateCountPeak: controlSummary.fragmentationTemporalStateCountPeak,
        fragmentationOverlapDensityPeak: controlSummary.fragmentationOverlapDensityPeak,
        fragmentationStateSeparationPeak: controlSummary.fragmentationStateSeparationPeak,
      },
      referenceComparisonStatus,
      referenceAnalyzerFingerprint: reference.analyzerFingerprint,
      renderAnalyzerFingerprint: candidate.value.analyzerFingerprint,
      candidateWeightedFidelity: candidateComparison?.weightedFidelity ?? null,
      controlWeightedFidelity: controlComparison?.weightedFidelity ?? null,
      candidateDefiningCoverage: candidateComparison?.definingCoverage ?? null,
      controlDefiningCoverage: controlComparison?.definingCoverage ?? null,
    },
    evidenceBoundary: [
      "This active-analyzer proof confirms native ADBE Echo property mapping in live AE and a direct causal rendered-pixel consequence versus an Echo-off control.",
      "The professional-reference comparator remains a separate stricter gate; pixel change alone does not make Echo a defining component or certify professional fidelity.",
      `Current reference comparison: candidate defining coverage ${candidateComparison?.definingCoverage ?? "unavailable"} at fidelity ${candidateComparison?.weightedFidelity ?? "unavailable"}; Echo-off control coverage ${controlComparison?.definingCoverage ?? "unavailable"} at fidelity ${controlComparison?.weightedFidelity ?? "unavailable"}.`,
      "The Echo schema remains PROOF_REQUIRED. Promotion requires materially different transfer evidence plus anti-simplification calibration under analyzer-matched retained evidence.",
    ],
    readback,
  };
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(artifact, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({
    ok: true,
    output: OUTPUT_PATH,
    transactionState: artifact.transaction.state,
    temporalDiagnostics,
    renderedAb,
    referenceComparisonStatus,
    candidateWeightedFidelity: candidateComparison?.weightedFidelity ?? null,
    controlWeightedFidelity: controlComparison?.weightedFidelity ?? null,
    candidateDefiningCoverage: candidateComparison?.definingCoverage ?? null,
    controlDefiningCoverage: controlComparison?.definingCoverage ?? null,
  }));
} finally {
  await runProofScript("m6-generic-native-proof-cleanup.jsx").catch(() => {});
}
