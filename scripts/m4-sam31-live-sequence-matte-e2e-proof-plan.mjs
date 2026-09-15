import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Sam31LocalSegmentationSequenceProviderV1 } from "../.tmp/runtime/packages/adapters/sam3-local/src/index.js";
import { buildSegmentationSequenceMatteMaterializationPlanV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-segmentation-sequence-materialization.js";

const artifactDir = process.env.EDITFLOW_PROOF_ARTIFACT_DIR;
if (!artifactDir) throw new Error("EDITFLOW_PROOF_ARTIFACT_DIR is required");
await mkdir(artifactDir, { recursive: true });
const liveConfigPath = process.env.EDITFLOW_SAM31_LIVE_CONFIG
  ?? path.resolve(".tmp/m4-sam31-live-workstation-config.json");
const config = JSON.parse((await readFile(liveConfigPath, "utf8")).replace(/^\uFEFF/, ""));
const retained = JSON.parse((await readFile(config.proofOutputPath, "utf8")).replace(/^\uFEFF/, ""));
const fixture = config.fixtures.find((item) => item.fixtureId === "studioc-person-window");
const retainedFixture = retained.fixtures.find((item) => item.fixtureId === "studioc-person-window");
if (!fixture || !retainedFixture) throw new Error("Retained Studio C SAM 3.1 fixture is unavailable");
const sourceBytes = await readFile(fixture.sourcePath);
const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
if (sourceSha256 !== retainedFixture.sourceSha256) throw new Error("Studio C source bytes drifted from retained live SAM evidence");
const sourceMedia = retainedFixture.sourceMedia;
const request = {
  requestId: `M4_SAM31_E2E_${sourceSha256.slice(0, 12)}`,
  sourceId: fixture.sourceId,
  semanticId: fixture.semanticId,
  entityClass: fixture.entityClass,
  startTimestampMs: fixture.startFrameIndex * 1000 / sourceMedia.frameRate,
  startFrameIndex: fixture.startFrameIndex,
  frameRate: sourceMedia.frameRate,
  frameCount: fixture.frameCount,
  promptFrameIndex: fixture.promptFrameIndex,
  prompt: { positivePoints: fixture.positivePoints },
  preferredEncoding: "ALPHA",
};
const sourceMaterial = {
  sourceId: fixture.sourceId,
  absolutePath: fixture.sourcePath,
  contentType: fixture.contentType ?? "video/avi",
  evidenceIds: [`M4_SAM31_E2E_SOURCE:${sourceSha256}`, retained.evidenceId],
};
const provider = new Sam31LocalSegmentationSequenceProviderV1({
  executablePath: config.pythonPath,
  scriptPath: config.sidecarPath,
  workingDirectory: config.workingDirectory,
  artifactDirectory: path.join(artifactDir, "sam31-sequence"),
  checkpointPath: config.checkpointPath,
  timeoutMs: config.timeoutMs,
  confidenceThreshold: config.confidenceThreshold,
  sourceResolver: { resolve: async (candidate) => candidate.sourceId === sourceMaterial.sourceId ? sourceMaterial : null },
});
const segmentation = await provider.segmentSequence(request);
const verified = provider.resolveSequence(request.requestId);
if (!verified || verified.frames.length !== request.frameCount) throw new Error("Live SAM 3.1 sequence did not resolve to verified artifacts");
if (segmentation.frames.filter((frame) => frame.confidence > 0 && frame.occlusion < 1).length !== request.frameCount) {
  throw new Error("Live SAM 3.1 E2E fixture did not retain material masks on every requested frame");
}
const width = segmentation.frames[0]?.mask.width;
const height = segmentation.frames[0]?.mask.height;
if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error("Live SAM 3.1 mask geometry is invalid");
for (const frame of segmentation.frames) {
  if (frame.mask.width !== width || frame.mask.height !== height) throw new Error("Live SAM 3.1 mask geometry drifted across the sequence");
}
const sampleIndices = [0, request.promptFrameIndex, request.frameCount - 1];
const samplePaths = sampleIndices.map((index) => verified.frames[index].absolutePath);
const sampleProbe = String.raw`
import cv2, json, numpy as np, sys
paths=json.loads(sys.argv[1]); indices=json.loads(sys.argv[2])
masks=[]
for p in paths:
    a=cv2.imread(p, cv2.IMREAD_GRAYSCALE)
    if a is None: raise RuntimeError("mask read failed: "+p)
    masks.append(a>127)
union=np.logical_or.reduce(masks)
bg=cv2.distanceTransform((~union).astype(np.uint8), cv2.DIST_L2, 5)
by,bx=np.unravel_index(int(np.argmax(bg)), bg.shape)
frames=[]
for idx,m in zip(indices,masks):
    dist=cv2.distanceTransform(m.astype(np.uint8), cv2.DIST_L2, 5)
    if float(dist.max()) < 1.0: raise RuntimeError("mask has no stable foreground")
    y,x=np.unravel_index(int(np.argmax(dist)), dist.shape)
    frames.append({"frameIndex":idx,"foregroundSample":{"x":int(x),"y":int(y)}})
print(json.dumps({"frames":frames,"backgroundSample":{"x":int(bx),"y":int(by)}}))
`;
const visualSamples = JSON.parse(execFileSync(config.pythonPath, ["-c", sampleProbe, JSON.stringify(samplePaths), JSON.stringify(sampleIndices)], {
  cwd: config.workingDirectory, encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024,
}).trim());
const bmp = (w, h, rgb) => {
  const stride = Math.ceil(w * 3 / 4) * 4;
  const buffer = Buffer.alloc(54 + stride * h);
  buffer.write("BM", 0, 2, "ascii"); buffer.writeUInt32LE(buffer.length, 2); buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14); buffer.writeInt32LE(w, 18); buffer.writeInt32LE(h, 22);
  buffer.writeUInt16LE(1, 26); buffer.writeUInt16LE(24, 28); buffer.writeUInt32LE(stride * h, 34);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const offset = 54 + (h - 1 - y) * stride + x * 3;
    buffer[offset] = rgb[2]; buffer[offset + 1] = rgb[1]; buffer[offset + 2] = rgb[0];
  }
  return buffer;
};
const backgroundPath = path.join(artifactDir, "sam31-e2e-background.bmp");
const subjectPath = path.join(artifactDir, "sam31-e2e-subject.bmp");
await writeFile(backgroundPath, bmp(width, height, [15, 35, 80]));
await writeFile(subjectPath, bmp(width, height, [245, 72, 36]));
const targetState = {
  stableId: "M4_SAM31_E2E_TARGET_LAYER",
  threeDLayer: false,
  transform: { anchorPoint: [width / 2, height / 2], position: [width / 2, height / 2], scale: [100, 100], rotation: 0 },
  timing: { startTime: 0, inPoint: 0, outPoint: 1, stretch: 100 },
  evidenceIds: ["M4_SAM31_E2E_TARGET_STATE"],
};
const plan = buildSegmentationSequenceMatteMaterializationPlanV1({
  segmentation,
  artifactSequence: { frames: verified.frames, evidenceIds: verified.evidenceIds },
  sourceFrame: { width, height, pixelAspect: 1, evidenceIds: ["M4_SAM31_E2E_SOURCE_GEOMETRY"] },
  comp: { stableId: "M4_SAM31_E2E_COMP" },
  targetLayer: { stableId: targetState.stableId },
  targetState,
  importItemStableId: "M4_SAM31_E2E_MASK_MEDIA",
  matteLayerStableId: "M4_SAM31_E2E_MATTE_LAYER",
  channel: "LUMA",
});
if (!plan) throw new Error("Live SAM 3.1 sequence was refused by the temporal matte planner");
const commands = plan.operations.map((operation) => operation.command);
const expectedCommands = ["media.sequence.import", "layer.add_media", "layer.set_transform", "layer.set_timing", "layer.set_track_matte"];
if (JSON.stringify(commands) !== JSON.stringify(expectedCommands)) throw new Error(`Unexpected E2E operation sequence: ${commands.join(",")}`);
const frameTimes = sampleIndices.map((index) => (index + 0.5) / request.frameRate);
const output = {
  schemaVersion: 1,
  proofId: "M4_SAM31_LIVE_SEQUENCE_MATTE_E2E_REAL_AE",
  sam31: {
    request, providerId: segmentation.providerId, providerVersion: segmentation.providerVersion,
    evidenceIds: segmentation.evidenceIds, retainedLiveEvidenceId: retained.evidenceId,
    retainedSourceSha256: retainedFixture.sourceSha256,
  },
  segmentation,
  targetState,
  plan,
  fixtures: { width, height, frameRate: request.frameRate, frameCount: request.frameCount, duration: 1, backgroundPath, subjectPath },
  visualExpectations: {
    frameTimes,
    frames: visualSamples.frames,
    backgroundSample: visualSamples.backgroundSample,
  },
};
const planPath = path.join(artifactDir, "plan.json");
await writeFile(planPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, planPath, commands, firstFramePath: verified.frames[0].absolutePath, frameTimes }));
