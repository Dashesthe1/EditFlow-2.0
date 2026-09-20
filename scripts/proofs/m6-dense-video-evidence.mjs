import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

import {
  analyzeDenseEffectEvidenceV1,
} from "../../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";

const argv = process.argv.slice(2);
const value = (name) => {
  const index = argv.indexOf(name);
  if (index < 0 || index + 1 >= argv.length) {
    throw new Error(`Missing required argument ${name}`);
  }
  return argv[index + 1];
};

const probePath = path.resolve(value("--probe-json"));
const outputPath = path.resolve(value("--output-evidence"));
const probeBytes = await readFile(probePath);
const probeSha256 = createHash("sha256").update(probeBytes).digest("hex");
const probe = JSON.parse(probeBytes.toString("utf8"));
if (probe.schema !== "editflow.dense-video-probe.v1") {
  throw new Error(`Unsupported probe schema: ${probe.schema}`);
}
if (!Array.isArray(probe.frames) || probe.frames.length < 3) {
  throw new Error("Probe must contain at least three dense frames.");
}
if (typeof probe.analysis?.analyzerFingerprint !== "string"
  || typeof probe.analysis?.algorithmId !== "string") {
  throw new Error("Probe lacks analyzer provenance; re-run the dense video probe with the current implementation.");
}

const scriptPath = fileURLToPath(import.meta.url);
const denseEvidenceSourcePath = path.resolve(
  path.dirname(scriptPath),
  "../../packages/visual-effects-intelligence/src/dense-evidence.ts",
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const measurementDescriptor = {
  probeAlgorithmId: probe.analysis.algorithmId,
  probeAnalyzerFingerprint: probe.analysis.analyzerFingerprint,
  analysisLongestEdge: probe.analysis.longestEdge,
  denseEvidenceSourceSha256: sha256(await readFile(denseEvidenceSourcePath)),
  converterSourceSha256: sha256(await readFile(scriptPath)),
};
const analyzerFingerprint = sha256(Buffer.from(JSON.stringify(measurementDescriptor), "utf8"));

const frames = [];
for (const frame of probe.frames) {
  const png = PNG.sync.read(await readFile(frame.pngPath));
  frames.push({
    timeMs: frame.timeMs,
    width: png.width,
    height: png.height,
    rgba: Uint8Array.from(png.data),
    semantic: frame.semantic,
  });
}

const evidence = analyzeDenseEffectEvidenceV1({
  sourceId: probe.sourceId,
  sourceKind: probe.sourceKind,
  frames,
  settings: {
    expectedFps: probe.video.fps,
    requireEveryFrame: true,
    recoveryEnergyRatio: 0.25,
  },
  analyzerFingerprint,
  evidenceRefs: [
    `video:sha256:${probe.sourceVideoSha256}`,
    `probe-json:sha256:${probeSha256}`,
    `probe-algorithm:${probe.analysis.algorithmId}`,
    `probe-analyzer:sha256:${probe.analysis.analyzerFingerprint}`,
    `measurement-system:sha256:${analyzerFingerprint}`,
    "algorithm:opencv-farneback-dual-affine-motion-comp-edge-autocorrelation",
  ],
});

await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  ok: true,
  output: outputPath,
  sourceId: evidence.sourceId,
  frameCount: evidence.summary.frameCount,
  analyzerFingerprint: evidence.analyzerFingerprint,
  measurementDescriptor,
  summary: evidence.summary,
}));
