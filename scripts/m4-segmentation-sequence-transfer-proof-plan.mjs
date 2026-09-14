import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { acceptSubjectSegmentationSequenceResultV1 } from "../.tmp/runtime/packages/tracking-state/src/segmentation-sequence.js";
import { buildSegmentationSequenceMatteMaterializationPlanV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-segmentation-sequence-materialization.js";

const artifactDir = process.env.EDITFLOW_PROOF_ARTIFACT_DIR;
if (!artifactDir) throw new Error("EDITFLOW_PROOF_ARTIFACT_DIR is required");
const sourceHostId = Number(process.env.EDITFLOW_M4_TRANSFER_SOURCE_HOST_ID ?? "0");
if (!Number.isInteger(sourceHostId) || sourceHostId <= 0) throw new Error("EDITFLOW_M4_TRANSFER_SOURCE_HOST_ID must be a positive integer");
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
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = pixel(x, y);
      const offset = 54 + (height - 1 - y) * stride + x * 3;
      buffer[offset] = blue;
      buffer[offset + 1] = green;
      buffer[offset + 2] = red;
    }
  }
  return buffer;
};

const compWidth = 1080;
const compHeight = 1080;
const maskWidth = 240;
const maskHeight = 135;
const frameRate = 12;
const frameCount = 3;
const centers = [60, 120, 180];
const centerY = 67;
const backgroundRgb = [15, 35, 80];
const backgroundPath = path.join(artifactDir, "transfer-background.bmp");
await writeFile(backgroundPath, bmp(compWidth, compHeight, () => backgroundRgb));

const materials = [];
const sequenceFrames = [];
for (let index = 0; index < frameCount; index += 1) {
  const framePath = path.join(artifactDir, `transfer-mask-${String(index + 1).padStart(4, "0")}.bmp`);
  const centerX = centers[index];
  await writeFile(framePath, bmp(maskWidth, maskHeight, (x, y) => {
    const dx = x - centerX;
    const dy = y - centerY;
    return dx * dx + dy * dy <= 18 * 18 ? [255, 255, 255] : [0, 0, 0];
  }));
  const bytes = await readFile(framePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const artifactId = `M4_TRANSFER_MASK_ARTIFACT_${index}`;
  materials.push({ frameIndex: index, artifactId, absolutePath: framePath, contentType: "image/bmp", sha256, evidenceIds: [`M4_TRANSFER_ARTIFACT_${index}`] });
  sequenceFrames.push({
    frameIndex: index,
    timestampMs: index * 1000 / frameRate,
    mask: { encoding: "BINARY", width: maskWidth, height: maskHeight, boundsNormalized: [0, 0, 1, 1], artifact: { artifactId, contentType: "image/bmp", sha256 } },
    confidence: 0.99,
    edgeQuality: 0.99,
    temporalConsistency: index === 0 ? 1 : 0.98,
    occlusion: 0,
    evidenceIds: [`M4_TRANSFER_FRAME_${index}`],
  });
}

const request = {
  requestId: "M4_SEQUENCE_TRANSFER_REQUEST",
  sourceId: `AE_FOOTAGE_HOST_${sourceHostId}`,
  semanticId: "M4_SEQUENCE_TRANSFER_SUBJECT",
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
  providerId: "deterministic-transfer-proof-fixture",
  providerVersion: "1",
  startTimestampMs: 0,
  startFrameIndex: 0,
  frameRate,
  frameCount,
  frames: sequenceFrames,
  evidenceIds: ["M4_SEQUENCE_TRANSFER_PROVIDER_SESSION"],
};
const segmentation = acceptSubjectSegmentationSequenceResultV1(request, result);
if (!segmentation) throw new Error("Transfer temporal segmentation fixture was not accepted");

const targetState = {
  stableId: "M4_TRANSFER_TARGET_LAYER",
  threeDLayer: false,
  transform: { anchorPoint: [compWidth / 2, compHeight / 2], position: [compWidth / 2, compHeight / 2], scale: [100, 100], rotation: 0 },
  timing: { startTime: 0, inPoint: 0, outPoint: 1, stretch: 100 },
  evidenceIds: ["M4_TRANSFER_TARGET_STATE"],
};
const plan = buildSegmentationSequenceMatteMaterializationPlanV1({
  segmentation,
  artifactSequence: { frames: materials, evidenceIds: ["M4_TRANSFER_ARTIFACT_SET_VERIFIED"] },
  sourceFrame: { width: compWidth, height: compHeight, pixelAspect: 1, evidenceIds: ["M4_TRANSFER_SOURCE_GEOMETRY"] },
  comp: { stableId: "M4_TRANSFER_SEQUENCE_COMP" },
  targetLayer: { stableId: targetState.stableId },
  targetState,
  importItemStableId: "M4_TRANSFER_MASK_MEDIA",
  matteLayerStableId: "M4_TRANSFER_MATTE_LAYER",
  channel: "LUMA",
});
if (!plan) throw new Error("Temporal materialization planner failed for transfer fixture");
const expectedCommands = ["media.sequence.import", "layer.add_media", "layer.set_transform", "layer.set_timing", "layer.set_track_matte"];
const commands = plan.operations.map((operation) => operation.command);
if (JSON.stringify(commands) !== JSON.stringify(expectedCommands)) throw new Error(`Unexpected transfer operations: ${commands.join(",")}`);

const output = {
  schemaVersion: 1,
  proofId: "M4_SEGMENTATION_SEQUENCE_TRANSFER_REAL_AE",
  segmentation,
  targetState,
  plan,
  fixtures: { sourceHostId, compWidth, compHeight, maskWidth, maskHeight, frameRate, frameCount, duration: 1, backgroundPath, backgroundRgb },
  visualExpectations: {
    frameTimes: [0.5 / frameRate, 1.5 / frameRate, 2.5 / frameRate],
    subjectSamples: centers.map((x) => ({ x: Math.round(x * compWidth / maskWidth), y: Math.round(centerY * compHeight / maskHeight) })),
    backgroundSample: { x: 20, y: 20 },
  },
};
const planPath = path.join(artifactDir, "plan.json");
await writeFile(planPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, planPath, sourceHostId, commands, firstFramePath: materials[0].absolutePath }));
