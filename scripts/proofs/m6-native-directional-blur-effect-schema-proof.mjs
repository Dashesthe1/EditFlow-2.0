import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

import {
  compileConstructionGraphV1,
  compileConstructionThroughNativeAeV1,
  synthesizeUnknownEffectV1,
} from "../../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const CONTROL = "http://127.0.0.1:32146";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EVIDENCE = path.join(ROOT, "proofs", "diagnostics", "m6-unknown-case02-reference-evidence.json");
const OUTPUT = path.join(ROOT, "proofs", "diagnostics", "m6-native-directional-blur-effect-schema-proof.json");
const ARTIFACT_DIR = path.join(ROOT, "proofs", "artifacts", "m6-native-directional-blur");
const WINDOWS = (name) => path.join(ROOT, "scripts", "windows", name);
const PROOF_SCHEMA = "ae.effect-schema.m6.directional-blur.v1";
const CAPABILITIES = [
  "ae.layer.duplicate", "ae.layer.time.offset", "ae.layer.opacity.set",
  "ae.layer.transform.set", "ae.keyframe.temporal_ease.set", "ae.keyframe.spatial.set",
  "ae.effect.directional-blur", "ae.effect.displacement-map", "ae.effect.exposure",
  "ae.effect.channel-shift", "ae.subject.isolate", "ae.layer.matte.set",
  "ae.layer.order.set", "ae.effect.echo",
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
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(command + " failed (" + result.status + "): " + (result.stderr || result.stdout));
  return result.stdout.trim();
};
const sha256File = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
const approx = (a, b, epsilon = 1e-6) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= epsilon;
const measureRenderedAb = async (baselineProbe, effectedProbe) => {
  const frameCount = Math.min(baselineProbe.frames.length, effectedProbe.frames.length);
  let changedFrames = 0;
  let summedMeanFrameDelta = 0;
  let summedChangedMeanFrameDelta = 0;
  let maxMeanFrameDelta = 0;
  let maxChangedPixelRatio = 0;
  const changedFrameTimesMs = [];
  for (let index = 0; index < frameCount; index += 1) {
    const baseline = PNG.sync.read(await readFile(baselineProbe.frames[index].pngPath));
    const effected = PNG.sync.read(await readFile(effectedProbe.frames[index].pngPath));
    if (baseline.width !== effected.width || baseline.height !== effected.height) {
      throw new Error("Echo A/B render dimensions do not match.");
    }
    let normalizedAbsoluteDelta = 0;
    let changedPixels = 0;
    const pixelCount = baseline.width * baseline.height;
    for (let offset = 0; offset < baseline.data.length; offset += 4) {
      let channelDelta = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        channelDelta += Math.abs(baseline.data[offset + channel] - effected.data[offset + channel]);
      }
      normalizedAbsoluteDelta += channelDelta / (3 * 255);
      if (channelDelta > 12) changedPixels += 1;
    }
    const meanFrameDelta = normalizedAbsoluteDelta / pixelCount;
    const changedPixelRatio = changedPixels / pixelCount;
    if (meanFrameDelta > 1e-6) {
      changedFrames += 1;
      summedChangedMeanFrameDelta += meanFrameDelta;
      changedFrameTimesMs.push(Number(baselineProbe.frames[index].timeMs));
    }
    summedMeanFrameDelta += meanFrameDelta;
    maxMeanFrameDelta = Math.max(maxMeanFrameDelta, meanFrameDelta);
    maxChangedPixelRatio = Math.max(maxChangedPixelRatio, changedPixelRatio);
  }
  return {
    frameCount,
    changedFrames,
    meanFrameDelta: frameCount === 0 ? 0 : summedMeanFrameDelta / frameCount,
    meanChangedFrameDelta: changedFrames === 0 ? 0 : summedChangedMeanFrameDelta / changedFrames,
    maxMeanFrameDelta,
    maxChangedPixelRatio,
    changedFrameTimesMs,
  };
};
const project = {
  schema: "editflow.virtual-ae.project.v1", activeCompId: "m6-proof-comp",
  compositions: [{ compId: "m6-proof-comp", name: "__EF2_M6_GENERIC_NATIVE_PROOF__",
    width: 640, height: 360, durationMs: 1000, frameRate: 30,
    layers: [{ layerId: "m6-proof-hero", name: "M6 Generic Hero", kind: "PRECOMP",
      sourceRef: "m6-proof-source-comp", inMs: 0, outMs: 1000, properties: [], effects: [], masks: [] }],
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
  const evidence = JSON.parse(await readFile(EVIDENCE, "utf8"));
  const synthesis = synthesizeUnknownEffectV1({ evidence, availableCapabilities: CAPABILITIES });
  if (!synthesis.selected) throw new Error("Case-02 unknown synthesis produced no selected construction.");
  const opticalNode = synthesis.selected.graph.nodes.find((node) =>
    node.kind === "OPTICAL_TREATMENT" && node.dimension === "OPTICAL");
  if (!opticalNode) throw new Error("Case-02 synthesis did not produce the expected optical node.");
  if (opticalNode.parameters.effectSchemaRef !== PROOF_SCHEMA) {
    throw new Error("Case-02 production synthesis did not retain the certified Directional Blur schema reference.");
  }
  const expected = {
    blurDirectionDegrees: Number(opticalNode.parameters.blurDirectionDegrees),
    blurLengthPixels: Number(opticalNode.parameters.blurLengthPixels),
  };
  if (!Number.isFinite(expected.blurDirectionDegrees) || !Number.isFinite(expected.blurLengthPixels)) {
    throw new Error("Case-02 production synthesis did not materialize finite Directional Blur parameters.");
  }
  const graph = synthesis.selected.graph;
  const compilation = compileConstructionGraphV1(graph, CAPABILITIES);
  const native = compileConstructionThroughNativeAeV1(compilation, project, context, {
    planId: "m6-native-directional-blur-effect-schema-proof",
    observedState: live.state.observed,
    curveBindingMode: "LIVE_ADAPTIVE",
    creativeObjective: "Prove the certified production Directional Blur synthesis path against live After Effects.",
    recipeRefs: [graph.graphId],
  });
  if (!native.compiled || native.plan === null) throw new Error("Native Directional Blur compile failed: " + native.issues.join(", "));
  const commands = native.plan.operations.map((operation) => operation.input.command);
  if (!commands.includes("effect.add") || !commands.includes("effect.set_property")) throw new Error("Native Directional Blur plan lacks concrete effect operations.");
  const transaction = await request("/run-transaction", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan: native.plan }),
  });
  if (transaction.result.state !== "COMMITTED") throw new Error("Native Directional Blur transaction did not commit.");
  await runProofScript("m6-generic-native-proof-readback.jsx");
  const readbackPath = path.join(ROOT, ".tmp", "m6-generic-native-readback.txt");
  const readback = await readFile(readbackPath, "utf8");
  const lines = readback.split(/\r?\n/);
  const effectLine = lines.find((line) => line.startsWith("EFFECT\t") && line.split("\t")[3] === "ADBE Motion Blur");
  if (!effectLine) throw new Error("Live AE readback did not contain ADBE Motion Blur.");
  const effectIndex = effectLine.split("\t")[1];
  const propertyValues = Object.fromEntries(lines
    .filter((line) => line.startsWith("EFFECT_PROP\t" + effectIndex + "\t"))
    .map((line) => line.split("\t"))
    .map((parts) => [parts[3], Number(parts.slice(4).join("\t"))]));
  const observed = {
    blurDirectionDegrees: propertyValues["ADBE Motion Blur-0001"],
    blurLengthPixels: propertyValues["ADBE Motion Blur-0002"],
  };
  if (!approx(observed.blurDirectionDegrees, expected.blurDirectionDegrees)
    || !approx(observed.blurLengthPixels, expected.blurLengthPixels)) {
    throw new Error("Live Directional Blur property readback disagrees with compiled semantic values: " + JSON.stringify({ expected, observed }));
  }

  await runProofScript("m6-native-directional-blur-proof-render.jsx");
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const baselineVideo = path.join(ARTIFACT_DIR, "baseline.mp4");
  const effectedVideo = path.join(ARTIFACT_DIR, "effected.mp4");
  await copyFile(path.join(os.tmpdir(), "M6_native_directional_blur_baseline.mp4"), baselineVideo);
  await copyFile(path.join(os.tmpdir(), "M6_native_directional_blur_effected.mp4"), effectedVideo);
  if ((await stat(baselineVideo)).size <= 0 || (await stat(effectedVideo)).size <= 0) throw new Error("Directional Blur proof renders are empty.");
  const baselineProbe = path.join(ROOT, ".tmp", "m6-native-directional-blur-baseline-probe.json");
  const effectedProbe = path.join(ROOT, ".tmp", "m6-native-directional-blur-effected-probe.json");
  const baselineEvidence = path.join(ROOT, "proofs", "diagnostics", "m6-native-directional-blur-baseline-evidence.json");
  const effectedEvidence = path.join(ROOT, "proofs", "diagnostics", "m6-native-directional-blur-effected-evidence.json");
  for (const [video, probe, output, sourceId] of [
    [baselineVideo, baselineProbe, baselineEvidence, "m6-native-directional-blur-baseline"],
    [effectedVideo, effectedProbe, effectedEvidence, "m6-native-directional-blur-effected"],
  ]) {
    run("py", ["-3.12", "scripts/proofs/m6-dense-video-probe.py", "--video", video, "--start", "0", "--end", "1",
      "--output", probe, "--source-id", sourceId, "--source-kind", "RENDER", "--analysis-size", "360"]);
    run(process.execPath, ["scripts/proofs/m6-dense-video-evidence.mjs", "--probe-json", probe, "--output-evidence", output]);
  }
  const baseline = JSON.parse(await readFile(baselineEvidence, "utf8"));
  const effected = JSON.parse(await readFile(effectedEvidence, "utf8"));
  const baselineProbeData = JSON.parse(await readFile(baselineProbe, "utf8"));
  const effectedProbeData = JSON.parse(await readFile(effectedProbe, "utf8"));
  if (baseline.analyzerFingerprint !== effected.analyzerFingerprint) {
    throw new Error("Directional Blur A/B evidence was measured by different analyzer implementations.");
  }
  const renderedAb = await measureRenderedAb(baselineProbeData, effectedProbeData);
  const minimumChangedFrames = Math.max(3, Math.floor(renderedAb.frameCount * 0.08));
  const maximumChangedFrames = Math.max(minimumChangedFrames, Math.ceil(renderedAb.frameCount * 0.85));
  const eventTimeMs = context.eventTimesMs.transition;
  const touchesEvent = renderedAb.changedFrameTimesMs.some((timeMs) =>
    Number.isFinite(timeMs) && Math.abs(timeMs - eventTimeMs) <= 100);
  if (renderedAb.changedFrames < minimumChangedFrames
    || renderedAb.changedFrames > maximumChangedFrames
    || renderedAb.meanChangedFrameDelta < 0.0005
    || renderedAb.maxMeanFrameDelta < 0.002
    || renderedAb.maxChangedPixelRatio < 0.01
    || !touchesEvent) {
    throw new Error("Native Directional Blur did not produce a material event-local rendered-pixel consequence: "
      + JSON.stringify({ renderedAb, minimumChangedFrames, maximumChangedFrames, eventTimeMs, touchesEvent }));
  }
  artifact = {
    schema: "editflow.m6.native-directional-blur-effect-schema-proof.v1",
    generatedAt: new Date().toISOString(),
    result: "PASS",
    proposedSchemaRef: PROOF_SCHEMA,
    candidateId: synthesis.selected.candidateId,
    graphId: graph.graphId,
    analyzerFingerprint: effected.analyzerFingerprint,
    expected, observed,
    transaction: transaction.result,
    nativePlan: { operationCount: native.plan.operations.length, commands, requiredCapabilities: native.plan.requiredCapabilities },
    renders: {
      baseline: { sha256: await sha256File(baselineVideo), evidence: path.relative(ROOT, baselineEvidence).replaceAll("\\", "/"), summary: baseline.summary },
      effected: { sha256: await sha256File(effectedVideo), evidence: path.relative(ROOT, effectedEvidence).replaceAll("\\", "/"), summary: effected.summary },
    },
    renderedAb,
    evidenceBoundary: [
      "This proof certifies the native ADBE Motion Blur (Directional Blur) schema mapping and causal rendered consequence on a controlled moving precomp.",
      "The A/B holds the synthesized optical construction constant and toggles only the Directional Blur effect before rendering.",
      "It does not certify professional-reference fidelity for the second unknown-effect benchmark case.",
      "Production professional-fidelity acceptance remains governed by reference anatomy, comparator diagnostics, transfer, and benchmark gates.",
    ],
    readback,
  };
  await writeFile(OUTPUT, JSON.stringify(artifact, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({
    ok: true,
    output: OUTPUT,
    expected,
    observed,
    renderedAb,
    baseline: baseline.summary,
    effected: effected.summary,
  }));
} finally {
  await runProofScript("m6-generic-native-proof-cleanup.jsx").catch(() => {});
}
