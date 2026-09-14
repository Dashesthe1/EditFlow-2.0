import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  SAM31_LOCAL_SEQUENCE_PROVIDER_ID,
  SAM31_LOCAL_SEQUENCE_SIDECAR_SCHEMA,
  Sam31LocalSegmentationSequenceProviderV1,
} from "../.tmp/runtime/packages/adapters/sam3-local/src/index.js";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const providerErrorCode = (code) => (error) => error?.name === "Sam31SegmentationSequenceProviderError" && error?.code === code;

const makeFixture = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "editflow-sam31-sequence-"));
  const artifactDirectory = path.join(root, "artifacts");
  const sequenceDirectory = path.join(artifactDirectory, "sequence");
  await mkdir(sequenceDirectory, { recursive: true });
  const sourcePath = path.join(root, "source.mp4");
  await writeFile(sourcePath, Buffer.from("source-video-bytes"));
  const artifactBytes = [Buffer.from("mask-frame-0"), Buffer.from("mask-frame-1"), Buffer.from("mask-frame-2")];
  const artifactPaths = [];
  for (let index = 0; index < artifactBytes.length; index += 1) {
    const artifactPath = path.join(sequenceDirectory, `mask-${String(index).padStart(6, "0")}.png`);
    await writeFile(artifactPath, artifactBytes[index]);
    artifactPaths.push(artifactPath);
  }
  const request = {
    requestId: "SEG_SEQUENCE_SAM31_001",
    sourceId: "MEDIA_VIDEO_001",
    semanticId: "PERSON_PETER_01",
    entityClass: "person",
    startTimestampMs: 1000,
    startFrameIndex: 30,
    frameRate: 30,
    frameCount: 3,
    promptFrameIndex: 1,
    preferredEncoding: "ALPHA",
    prompt: {
      boundingBox: [0.2, 0.1, 0.4, 0.7],
      positivePoints: [{ x: 0.4, y: 0.4 }],
      negativePoints: [{ x: 0.05, y: 0.05 }],
    },
  };
  const sourceEvidence = ["SOURCE:VIDEO:MEDIA_VIDEO_001"];
  const frames = artifactBytes.map((bytes, index) => ({
    frameIndex: index,
    timestampMs: request.startTimestampMs + index * 1000 / request.frameRate,
    mask: {
      encoding: "ALPHA",
      width: 1920,
      height: 1080,
      boundsNormalized: [0, 0, 1, 1],
      artifact: {
        artifactId: `sam31-sequence:${request.requestId}:${index}`,
        contentType: "image/png",
        sha256: sha256(bytes),
      },
    },
    confidence: 0.9 - index * 0.02,
    edgeQuality: 0.85 - index * 0.02,
    temporalConsistency: index === 0 ? 1 : 0.93,
    occlusion: 0.1 + index * 0.02,
    evidenceIds: [...sourceEvidence, `SAM31_SEQUENCE_FRAME:${request.startFrameIndex + index}`],
  }));
  const result = {
    requestId: request.requestId,
    sourceId: request.sourceId,
    semanticId: request.semanticId,
    entityClass: request.entityClass,
    providerId: SAM31_LOCAL_SEQUENCE_PROVIDER_ID,
    providerVersion: "sam3.1:code-0.1.0",
    startTimestampMs: request.startTimestampMs,
    startFrameIndex: request.startFrameIndex,
    frameRate: request.frameRate,
    frameCount: request.frameCount,
    frames,
    evidenceIds: [...sourceEvidence, "SAM31_MODEL:facebook/sam3.1"],
  };
  const sourceResolver = {
    async resolve() {
      return {
        sourceId: request.sourceId,
        absolutePath: sourcePath,
        contentType: "video/mp4",
        evidenceIds: [...sourceEvidence, ...sourceEvidence],
      };
    },
  };
  const config = {
    executablePath: process.execPath,
    scriptPath: path.join(root, "sam31_segmentation_sequence_provider.py"),
    workingDirectory: root,
    artifactDirectory,
    sourceResolver,
    timeoutMs: 5000,
    confidenceThreshold: 0.57,
  };
  return { root, artifactDirectory, sourcePath, artifactBytes, artifactPaths, request, result, sourceEvidence, config };
};

const completed = (fixture, resultOverrides = {}, artifactOverrides = {}) => JSON.stringify({
  status: "COMPLETED",
  artifactFrames: fixture.artifactPaths.map((artifactPath, frameIndex) => ({ frameIndex, artifactPath, ...artifactOverrides[frameIndex] })),
  result: { ...fixture.result, ...resultOverrides },
});
const processResult = (stdout, overrides = {}) => ({ exitCode: 0, signal: null, stdout, stderr: "", timedOut: false, ...overrides });

test("SAM 3.1 temporal adapter sends one exact sidecar request and retains only hash-verified sequence material", async () => {
  const fixture = await makeFixture();
  const calls = [];
  const runner = { async run(input) { calls.push(input); return processResult(completed(fixture)); } };
  try {
    const provider = new Sam31LocalSegmentationSequenceProviderV1(fixture.config, runner);
    const accepted = await provider.segmentSequence(fixture.request);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].executablePath, process.execPath);
    assert.deepEqual(calls[0].args.slice(0, 2), [fixture.config.scriptPath, "--request-json"]);
    assert.equal(calls[0].workingDirectory, fixture.root);
    assert.equal(calls[0].timeoutMs, 5000);
    const payload = JSON.parse(calls[0].args[2]);
    assert.equal(payload.schema, SAM31_LOCAL_SEQUENCE_SIDECAR_SCHEMA);
    assert.equal(payload.request.startFrameIndex, 30);
    assert.equal(payload.request.promptFrameIndex, 1);
    assert.equal(payload.source.absolutePath, fixture.sourcePath);
    assert.deepEqual(payload.source.evidenceIds, fixture.sourceEvidence);
    assert.equal(payload.checkpointPath, null);
    assert.equal(payload.confidenceThreshold, 0.57);
    assert.deepEqual(accepted.frames.map((frame) => frame.mask.artifact.sha256), fixture.artifactBytes.map(sha256));
    assert.deepEqual(provider.resolveSequence(fixture.request.requestId), {
      requestId: fixture.request.requestId,
      sourceId: fixture.request.sourceId,
      semanticId: fixture.request.semanticId,
      frameRate: fixture.request.frameRate,
      frameCount: fixture.request.frameCount,
      frames: fixture.artifactPaths.map((absolutePath, frameIndex) => ({
        frameIndex,
        artifactId: fixture.result.frames[frameIndex].mask.artifact.artifactId,
        absolutePath,
        contentType: "image/png",
        sha256: sha256(fixture.artifactBytes[frameIndex]),
        evidenceIds: fixture.result.frames[frameIndex].evidenceIds,
      })),
      evidenceIds: fixture.result.evidenceIds,
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("SAM 3.1 temporal adapter permits native point prompts but refuses unbound and prior-artifact requests before launch", async () => {
  const fixture = await makeFixture();
  let calls = 0;
  const runner = { async run() { calls += 1; return processResult(completed(fixture)); } };
  try {
    const provider = new Sam31LocalSegmentationSequenceProviderV1(fixture.config, runner);
    const pointRequest = { ...fixture.request, entityClass: undefined, prompt: { positivePoints: [{ x: 0.4, y: 0.4 }] } };
    const pointResult = { ...fixture.result, entityClass: undefined };
    const pointRunner = { async run() { return processResult(completed(fixture, pointResult)); } };
    await new Sam31LocalSegmentationSequenceProviderV1(fixture.config, pointRunner).segmentSequence(pointRequest);
    await assert.rejects(
      provider.segmentSequence({ ...fixture.request, entityClass: undefined, prompt: { negativePoints: [{ x: 0.1, y: 0.1 }] } }),
      providerErrorCode("SUBJECT_PROMPT_REQUIRED"),
    );
    await assert.rejects(
      provider.segmentSequence({ ...fixture.request, prompt: { previousArtifactId: "PREVIOUS_MASK" } }),
      providerErrorCode("TEMPORAL_ARTIFACT_REFINEMENT_UNSUPPORTED"),
    );
    assert.equal(calls, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("SAM 3.1 temporal adapter rejects source provenance loss, start-frame drift, artifact escape, duplicate paths, and byte drift", async () => {
  const fixture = await makeFixture();
  const outside = path.join(fixture.root, "outside.png");
  await writeFile(outside, fixture.artifactBytes[0]);
  try {
    const noEvidence = new Sam31LocalSegmentationSequenceProviderV1({
      ...fixture.config,
      sourceResolver: { async resolve() { return { sourceId: fixture.request.sourceId, absolutePath: fixture.sourcePath, evidenceIds: [] }; } },
    }, { async run() { throw new Error("must not launch"); } });
    await assert.rejects(noEvidence.segmentSequence(fixture.request), providerErrorCode("SOURCE_PROVENANCE_MISSING"));

    const drift = new Sam31LocalSegmentationSequenceProviderV1(fixture.config, {
      async run() { return processResult(completed(fixture, { startFrameIndex: fixture.request.startFrameIndex + 1 })); },
    });
    await assert.rejects(drift.segmentSequence(fixture.request), providerErrorCode("INVALID_SEQUENCE_SEGMENTATION_RESULT"));

    const escape = new Sam31LocalSegmentationSequenceProviderV1(fixture.config, {
      async run() { return processResult(completed(fixture, {}, { 0: { artifactPath: outside } })); },
    });
    await assert.rejects(escape.segmentSequence(fixture.request), providerErrorCode("ARTIFACT_PATH_ESCAPE"));

    const duplicateFrames = fixture.artifactPaths.map((artifactPath, frameIndex) => ({ frameIndex, artifactPath: frameIndex === 1 ? fixture.artifactPaths[0] : artifactPath }));
    const duplicate = new Sam31LocalSegmentationSequenceProviderV1(fixture.config, {
      async run() { return processResult(JSON.stringify({ status: "COMPLETED", artifactFrames: duplicateFrames, result: fixture.result })); },
    });
    await assert.rejects(duplicate.segmentSequence(fixture.request), providerErrorCode("ARTIFACT_PATH_DUPLICATE"));

    const badFrames = fixture.result.frames.map((frame, index) => index === 2
      ? { ...frame, mask: { ...frame.mask, artifact: { ...frame.mask.artifact, sha256: "0".repeat(64) } } }
      : frame);
    const badDigest = new Sam31LocalSegmentationSequenceProviderV1(fixture.config, {
      async run() { return processResult(completed(fixture, { frames: badFrames })); },
    });
    await assert.rejects(badDigest.segmentSequence(fixture.request), providerErrorCode("ARTIFACT_SHA256_MISMATCH"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("SAM 3.1 temporal adapter fails closed on timeout, process failure, malformed output, and provider mismatch", async () => {
  const fixture = await makeFixture();
  try {
    const timeout = new Sam31LocalSegmentationSequenceProviderV1(fixture.config, {
      async run() { return processResult("", { timedOut: true, exitCode: null }); },
    });
    await assert.rejects(timeout.segmentSequence(fixture.request), providerErrorCode("SIDECAR_TIMEOUT"));

    const failed = new Sam31LocalSegmentationSequenceProviderV1(fixture.config, {
      async run() { return processResult("", { exitCode: 2, stderr: "boom" }); },
    });
    await assert.rejects(failed.segmentSequence(fixture.request), providerErrorCode("SIDECAR_PROCESS_FAILED"));

    const malformed = new Sam31LocalSegmentationSequenceProviderV1(fixture.config, {
      async run() { return processResult("not-json"); },
    });
    await assert.rejects(malformed.segmentSequence(fixture.request), providerErrorCode("MALFORMED_SEQUENCE_SIDECAR_JSON"));

    const mismatch = new Sam31LocalSegmentationSequenceProviderV1(fixture.config, {
      async run() { return processResult(completed(fixture, { providerId: "other.provider" })); },
    });
    await assert.rejects(mismatch.segmentSequence(fixture.request), providerErrorCode("PROVIDER_ID_MISMATCH"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("SAM 3.1 temporal runtime is shell-free and pinned to the current multiplex video-session API", async () => {
  const ts = await readFile("packages/adapters/sam3-local/src/sequence.ts", "utf8");
  const py = await readFile("packages/adapters/sam3-local/runtime/sam31_segmentation_sequence_provider.py", "utf8");
  assert.match(ts, /shell: false/);
  assert.match(ts, /ARTIFACT_SHA256_MISMATCH/);
  assert.match(ts, /TEMPORAL_ARTIFACT_REFINEMENT_UNSUPPORTED/);
  assert.match(py, /build_sam3_multiplex_video_predictor/);
  assert.match(py, /"type": "start_session"/);
  assert.match(py, /"type": "propagate_in_video"/);
  assert.match(py, /"type": "close_session"/);
  assert.match(py, /build_kwargs: dict\[str, Any\] = \{"use_fa3": False\}/);
  assert.match(py, /HF_TOKEN/);
  assert.doesNotMatch(py, /"download_from_hf"/);
  assert.match(py, /SAM31_MODEL:facebook\/sam3\.1/);
  assert.match(py, /exact subject binding is ambiguous/);
  assert.match(py, /temporal propagation did not cover requested frames/);
  assert.doesNotMatch(py, /build_sam3_video_predictor\(/);
});
