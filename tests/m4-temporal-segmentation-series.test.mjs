import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptSubjectSegmentationSeriesResultV1,
  validateSubjectSegmentationSeriesRequestV1,
} from "../.tmp/runtime/packages/tracking-state/src/segmentation.js";

const frameRequest = (index, timestampMs) => ({
  requestId: `SEG_SERIES_REQ_${String(index).padStart(3, "0")}`,
  sourceId: "MEDIA_SPIDERMAN_DYNAMIC_01",
  timestampMs,
  semanticId: "PERSON_PETER_01",
  entityClass: "PERSON",
  preferredEncoding: "ALPHA",
  prompt: index === 0
    ? { boundingBox: [0.2, 0.1, 0.4, 0.75] }
    : { previousArtifactId: `SEG_SERIES_ART_${String(index - 1).padStart(3, "0")}` },
});

const request = {
  seriesId: "SEG_SERIES_001",
  sourceId: "MEDIA_SPIDERMAN_DYNAMIC_01",
  semanticId: "PERSON_PETER_01",
  entityClass: "PERSON",
  frameRate: 24,
  preferredEncoding: "ALPHA",
  frames: [
    frameRequest(0, 1000),
    frameRequest(1, 1041.666667),
    frameRequest(2, 1083.333333),
  ],
};

const frameResult = (frame, index, mutation = {}) => ({
  requestId: frame.requestId,
  sourceId: frame.sourceId,
  timestampMs: frame.timestampMs,
  semanticId: frame.semanticId,
  entityClass: frame.entityClass,
  providerId: "sam3.1.temporal.local",
  providerVersion: "3.1",
  mask: {
    encoding: "ALPHA",
    width: 1920,
    height: 1080,
    boundsNormalized: [0, 0, 1, 1],
    artifact: {
      artifactId: `SEG_SERIES_ART_${String(index).padStart(3, "0")}`,
      contentType: "image/png",
      sha256: String(index + 1).repeat(64),
    },
  },
  confidence: 0.94,
  edgeQuality: 0.91,
  temporalConsistency: index === 0 ? 1 : 0.93,
  occlusion: 0.05,
  evidenceIds: [`SEGMENT:SERIES_001:FRAME_${index}`, "MODEL:SAM3.1:TEMPORAL"],
  ...mutation,
});

const validResult = () => ({
  seriesId: request.seriesId,
  sourceId: request.sourceId,
  semanticId: request.semanticId,
  entityClass: request.entityClass,
  providerId: "sam3.1.temporal.local",
  providerVersion: "3.1",
  frameRate: request.frameRate,
  frames: request.frames.map((frame, index) => frameResult(frame, index)),
  evidenceIds: ["SEGMENT:SERIES_001", "SEGMENT:SERIES_001", "MODEL:SAM3.1:TEMPORAL"],
});

test("temporal segmentation request accepts one exact ordered source/subject series", () => {
  assert.equal(validateSubjectSegmentationSeriesRequestV1(request), true);
});

test("temporal request rejects duplicate request IDs, non-increasing time, and identity drift", () => {
  const duplicateId = {
    ...request,
    frames: [request.frames[0], { ...request.frames[1], requestId: request.frames[0].requestId }],
  };
  const reversedTime = {
    ...request,
    frames: [request.frames[0], { ...request.frames[1], timestampMs: request.frames[0].timestampMs }],
  };
  const wrongSource = {
    ...request,
    frames: [request.frames[0], { ...request.frames[1], sourceId: "OTHER_MEDIA" }],
  };
  const wrongSubject = {
    ...request,
    frames: [request.frames[0], { ...request.frames[1], semanticId: "PERSON_GWEN_01" }],
  };
  const wrongClass = {
    ...request,
    frames: [request.frames[0], { ...request.frames[1], entityClass: "FACE" }],
  };
  for (const invalid of [duplicateId, reversedTime, wrongSource, wrongSubject, wrongClass]) {
    assert.equal(validateSubjectSegmentationSeriesRequestV1(invalid), false);
  }
});

test("temporal request constrains frame rate and explicit encoding without coercion", () => {
  assert.equal(validateSubjectSegmentationSeriesRequestV1({ ...request, frameRate: 0 }), false);
  assert.equal(validateSubjectSegmentationSeriesRequestV1({ ...request, frameRate: 100 }), false);
  assert.equal(validateSubjectSegmentationSeriesRequestV1({ ...request, preferredEncoding: "MAGIC" }), false);
  assert.equal(validateSubjectSegmentationSeriesRequestV1({
    ...request,
    frames: [{ ...request.frames[0], preferredEncoding: "BINARY" }],
  }), false);
});

test("accepted temporal result preserves exact frame correlation and de-duplicates series evidence", () => {
  const accepted = acceptSubjectSegmentationSeriesResultV1(request, validResult());
  assert.ok(accepted);
  assert.equal(accepted.frames.length, 3);
  assert.deepEqual(accepted.frames.map((frame) => frame.timestampMs), request.frames.map((frame) => frame.timestampMs));
  assert.deepEqual(accepted.evidenceIds, ["SEGMENT:SERIES_001", "MODEL:SAM3.1:TEMPORAL"]);
});

test("series result refuses reordered/missing frames and series identity mismatch", () => {
  const reordered = validResult();
  reordered.frames = [reordered.frames[1], reordered.frames[0], reordered.frames[2]];
  assert.equal(acceptSubjectSegmentationSeriesResultV1(request, reordered), null);

  const missing = validResult();
  missing.frames = missing.frames.slice(0, 2);
  assert.equal(acceptSubjectSegmentationSeriesResultV1(request, missing), null);

  for (const mutation of [
    { seriesId: "OTHER_SERIES" },
    { sourceId: "OTHER_MEDIA" },
    { semanticId: "PERSON_GWEN_01" },
    { frameRate: 23.976 },
  ]) {
    assert.equal(acceptSubjectSegmentationSeriesResultV1(request, { ...validResult(), ...mutation }), null);
  }
});

test("series result requires one provider identity across every frame", () => {
  const result = validResult();
  result.frames[1] = frameResult(request.frames[1], 1, { providerId: "other-provider" });
  assert.equal(acceptSubjectSegmentationSeriesResultV1(request, result), null);

  const versionMismatch = validResult();
  versionMismatch.frames[1] = frameResult(request.frames[1], 1, { providerVersion: "3.1.1" });
  assert.equal(acceptSubjectSegmentationSeriesResultV1(request, versionMismatch), null);
});

test("series result requires homogeneous raster geometry, encoding, and content type", () => {
  const mutations = [
    { width: 1280 },
    { height: 720 },
    { encoding: "BINARY" },
    { boundsNormalized: [0.1, 0, 0.9, 1] },
    { artifact: { ...frameResult(request.frames[1], 1).mask.artifact, contentType: "image/tiff" } },
  ];
  for (const maskMutation of mutations) {
    const result = validResult();
    result.frames[1] = frameResult(request.frames[1], 1, {
      mask: { ...frameResult(request.frames[1], 1).mask, ...maskMutation },
    });
    assert.equal(acceptSubjectSegmentationSeriesResultV1(request, result), null);
  }
});

test("series result requires lowercase SHA-256 integrity evidence on every frame", () => {
  const missingDigest = validResult();
  const mask = frameResult(request.frames[1], 1).mask;
  missingDigest.frames[1] = frameResult(request.frames[1], 1, {
    mask: { ...mask, artifact: { artifactId: mask.artifact.artifactId, contentType: mask.artifact.contentType } },
  });
  assert.equal(acceptSubjectSegmentationSeriesResultV1(request, missingDigest), null);
});
