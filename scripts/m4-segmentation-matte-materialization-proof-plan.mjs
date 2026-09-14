import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { acceptSubjectSegmentationResultV1 } from "../.tmp/runtime/packages/tracking-state/src/segmentation.js";
import { buildSegmentationMatteMaterializationPlanV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-segmentation-matte-materialization.js";

const artifactDir = process.env.EDITFLOW_PROOF_ARTIFACT_DIR;
if (!artifactDir) throw new Error("EDITFLOW_PROOF_ARTIFACT_DIR is required");
await mkdir(artifactDir, { recursive: true });

const bmp = (width, height, pixel) => {
  const stride = Math.ceil(width * 3 / 4) * 4;
  const buffer = Buffer.alloc(54 + stride * height);
  buffer.write("BM", 0, 2, "ascii");
  buffer.writeUInt32LE(buffer.length, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(stride * height, 34);
  for (let y = 0; y < height; y += 1) {    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = pixel(x, y);
      const offset = 54 + (height - 1 - y) * stride + x * 3;
      buffer[offset] = blue;
      buffer[offset + 1] = green;
      buffer[offset + 2] = red;
    }
  }
  return buffer;
};

const sourceWidth = 240;
const sourceHeight = 135;
const maskWidth = 144;
const maskHeight = 90;
const runId = (process.env.EDITFLOW_PROOF_RUN_ID || String(Date.now())).replace(/[^A-Za-z0-9_-]/g, "_");
const backgroundPath = path.join(artifactDir, `background-${runId}.bmp`);
const subjectPath = path.join(artifactDir, `subject-${runId}.bmp`);
const mattePath = path.join(artifactDir, `segmentation-matte-${runId}.bmp`);

await writeFile(backgroundPath, bmp(sourceWidth, sourceHeight, (x, y) =>
  ((Math.floor(x / 20) + Math.floor(y / 20)) % 2 === 0 ? [12, 28, 58] : [20, 48, 92])));
await writeFile(subjectPath, bmp(sourceWidth, sourceHeight, (x, y) =>
  (((x + y) % 36) < 18 ? [248, 76, 38] : [255, 186, 52])));
await writeFile(mattePath, bmp(maskWidth, maskHeight, (x, y) => {
  const dx = (x - maskWidth / 2) / (maskWidth * 0.38);
  const dy = (y - maskHeight / 2) / (maskHeight * 0.36);
  return (dx * dx + dy * dy <= 1) ? [255, 255, 255] : [0, 0, 0];
}));
const matteBytes = await import("node:fs/promises").then(({ readFile }) => readFile(mattePath));
const matteSha256 = createHash("sha256").update(matteBytes).digest("hex");

const request = {
  requestId: "M4_MATERIALIZATION_PROOF_REQUEST",
  sourceId: "M4_MATERIALIZATION_SOURCE",
  timestampMs: 500,
  semanticId: "M4_MATERIALIZATION_SUBJECT",
  preferredEncoding: "BINARY",
};
const result = {
  ...request,
  providerId: "deterministic-proof-fixture",
  providerVersion: "1",
  mask: {
    encoding: "BINARY",
    width: maskWidth,
    height: maskHeight,
    boundsNormalized: [24 / sourceWidth, 15 / sourceHeight, maskWidth / sourceWidth, maskHeight / sourceHeight],
    artifact: { artifactId: "M4_MATERIALIZATION_MASK_ARTIFACT", contentType: "image/bmp", sha256: matteSha256 },
  },  confidence: 0.99,
  edgeQuality: 0.98,
  temporalConsistency: 1,
  occlusion: 0,
  evidenceIds: ["M4_PROOF_PROVIDER_EVIDENCE"],
};
const segmentation = acceptSubjectSegmentationResultV1(request, result);
if (!segmentation) throw new Error("Deterministic segmentation fixture was not accepted");

const targetState = {
  stableId: "M4_MATERIALIZATION_TARGET_LAYER",
  threeDLayer: false,
  transform: {
    anchorPoint: [sourceWidth / 2, sourceHeight / 2],
    position: [132, 72],
    scale: [105, 95],
    rotation: 12,
  },
  timing: { startTime: 0.1, inPoint: 0.1, outPoint: 0.9, stretch: 100 },
  evidenceIds: ["M4_PROOF_TARGET_STATE_EVIDENCE"],
};
const plan = buildSegmentationMatteMaterializationPlanV1({
  segmentation,
  artifact: {
    artifactId: segmentation.mask.artifact.artifactId,
    absolutePath: mattePath,
    contentType: segmentation.mask.artifact.contentType,    sha256: matteSha256,
    evidenceIds: ["M4_PROOF_ARTIFACT_HASH_EVIDENCE"],
  },
  sourceFrame: {
    width: sourceWidth,
    height: sourceHeight,
    pixelAspect: 1,
    evidenceIds: ["M4_PROOF_SOURCE_GEOMETRY_EVIDENCE"],
  },
  comp: { stableId: "M4_MATERIALIZATION_COMP" },
  targetLayer: { stableId: targetState.stableId },
  targetState,
  importItemStableId: "M4_MATERIALIZATION_MATTE_MEDIA",
  matteLayerStableId: "M4_MATERIALIZATION_MATTE_LAYER",
  channel: "LUMA",
});
if (!plan) throw new Error("Segmentation materialization planner failed closed for the valid proof fixture");
const commands = plan.operations.map((operation) => operation.command);
const expectedCommands = ["media.import", "layer.add_media", "layer.set_transform", "layer.set_timing", "layer.set_track_matte"];
if (JSON.stringify(commands) !== JSON.stringify(expectedCommands)) {
  throw new Error(`Unexpected materialization operations: ${commands.join(",")}`);
}

const output = {
  schemaVersion: 1,
  proofId: "M4_SEGMENTATION_MATTE_MATERIALIZATION_REAL_AE",
  segmentation,
  targetState,
  plan,
  fixtures: {
    width: sourceWidth,
    height: sourceHeight,
    frameRate: 12,
    duration: 1,
    backgroundPath,
    subjectPath,
    mattePath,
    matteSha256,
  },
  visualExpectations: {
    frameTime: 0.5,
    subjectSample: { x: 132, y: 72 },
    backgroundSamples: [{ x: 0, y: 0 }, { x: 190, y: 90 }],
  },
};
await writeFile(path.join(artifactDir, "plan.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, planPath: path.join(artifactDir, "plan.json"), matteSha256, commands }));
