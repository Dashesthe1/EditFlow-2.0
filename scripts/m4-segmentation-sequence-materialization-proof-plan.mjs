import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { acceptSubjectSegmentationSequenceResultV1 } from "../.tmp/runtime/packages/tracking-state/src/segmentation-sequence.js";
import { buildSegmentationSequenceMatteMaterializationPlanV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-segmentation-sequence-materialization.js";

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
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {      const [red, green, blue] = pixel(x, y);
      const offset = 54 + (height - 1 - y) * stride + x * 3;
      buffer[offset] = blue;
      buffer[offset + 1] = green;
      buffer[offset + 2] = red;
    }
  }
  return buffer;
};

const width = 240;
const height = 135;
const frameRate = 12;
const frameCount = 3;
const centers = [60, 120, 180];
const centerY = 67;
const backgroundPath = path.join(artifactDir, "dynamic-background.bmp");
const subjectPath = path.join(artifactDir, "dynamic-subject.bmp");
await writeFile(backgroundPath, bmp(width, height, () => [15, 35, 80]));
await writeFile(subjectPath, bmp(width, height, () => [245, 72, 36]));

const materials = [];
const sequenceFrames = [];
for (let index = 0; index < frameCount; index += 1) {
  const framePath = path.join(artifactDir, `dynamic-mask-${String(index + 1).padStart(4, "0")}.bmp`);
  const centerX = centers[index];  await writeFile(framePath, bmp(width, height, (x, y) => {
    const dx = x - centerX;
    const dy = y - centerY;
    const on = dx * dx + dy * dy <= 18 * 18;
    return on ? [255, 255, 255] : [0, 0, 0];
  }));
  const bytes = await readFile(framePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const artifactId = `M4_SEQUENCE_MASK_ARTIFACT_${index}`;
  materials.push({
    frameIndex: index, artifactId, absolutePath: framePath,
    contentType: "image/bmp", sha256, evidenceIds: [`M4_SEQUENCE_ARTIFACT_${index}`],
  });
  sequenceFrames.push({
    frameIndex: index,
    timestampMs: index * 1000 / frameRate,
    mask: {
      encoding: "BINARY", width, height, boundsNormalized: [0, 0, 1, 1],
      artifact: { artifactId, contentType: "image/bmp", sha256 },
    },
    confidence: 0.99, edgeQuality: 0.99, temporalConsistency: index === 0 ? 1 : 0.98,
    occlusion: 0, evidenceIds: [`M4_SEQUENCE_FRAME_${index}`],
  });
}

const request = {  requestId: "M4_SEQUENCE_MATERIALIZATION_REQUEST",
  sourceId: "M4_SEQUENCE_MATERIALIZATION_SOURCE",
  semanticId: "M4_SEQUENCE_MATERIALIZATION_SUBJECT",
  startTimestampMs: 0,
  startFrameIndex: 0,
  frameRate,
  frameCount,
  promptFrameIndex: 0,
  prompt: { boundingBox: [0, 0, 1, 1] },
  preferredEncoding: "BINARY",
};
const result = {
  requestId: request.requestId,
  sourceId: request.sourceId,
  semanticId: request.semanticId,
  providerId: "deterministic-temporal-proof-fixture",
  providerVersion: "1",
  startTimestampMs: 0,
  startFrameIndex: 0,
  frameRate,
  frameCount,
  frames: sequenceFrames,
  evidenceIds: ["M4_SEQUENCE_PROVIDER_SESSION"],
};
const segmentation = acceptSubjectSegmentationSequenceResultV1(request, result);
if (!segmentation) throw new Error("Deterministic temporal segmentation fixture was not accepted");

const targetState = {  stableId: "M4_SEQUENCE_TARGET_LAYER",
  threeDLayer: false,
  transform: {
    anchorPoint: [width / 2, height / 2],
    position: [width / 2, height / 2],
    scale: [100, 100],
    rotation: 0,
  },
  timing: { startTime: 0, inPoint: 0, outPoint: 1, stretch: 100 },
  evidenceIds: ["M4_SEQUENCE_TARGET_STATE"],
};
const plan = buildSegmentationSequenceMatteMaterializationPlanV1({
  segmentation,
  artifactSequence: { frames: materials, evidenceIds: ["M4_SEQUENCE_ARTIFACT_SET_VERIFIED"] },
  sourceFrame: { width, height, pixelAspect: 1, evidenceIds: ["M4_SEQUENCE_SOURCE_GEOMETRY"] },
  comp: { stableId: "M4_SEQUENCE_COMP" },
  targetLayer: { stableId: targetState.stableId },
  targetState,
  importItemStableId: "M4_SEQUENCE_MASK_MEDIA",
  matteLayerStableId: "M4_SEQUENCE_MATTE_LAYER",
  channel: "LUMA",
});
if (!plan) throw new Error("Temporal materialization planner failed for deterministic sequence fixture");

const commands = plan.operations.map((operation) => operation.command);
const expectedCommands = [  "media.sequence.import",
  "layer.add_media",
  "layer.set_transform",
  "layer.set_timing",
  "layer.set_track_matte",
];
if (JSON.stringify(commands) !== JSON.stringify(expectedCommands)) {
  throw new Error(`Unexpected temporal materialization operations: ${commands.join(",")}`);
}

const output = {
  schemaVersion: 1,
  proofId: "M4_SEGMENTATION_SEQUENCE_MATTE_MATERIALIZATION_REAL_AE",
  segmentation,
  targetState,
  plan,
  fixtures: { width, height, frameRate, frameCount, duration: 1, backgroundPath, subjectPath },
  visualExpectations: {
    frameTimes: [0.5 / frameRate, 1.5 / frameRate, 2.5 / frameRate],
    subjectSamples: centers.map((x) => ({ x, y: centerY })),
    backgroundSample: { x: 10, y: 10 },
  },
};
const planPath = path.join(artifactDir, "plan.json");
await writeFile(planPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, planPath, commands, firstFramePath: materials[0].absolutePath }));