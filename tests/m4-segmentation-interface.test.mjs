import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptSubjectSegmentationResultV1,
  validateSubjectSegmentationRequestV1,
} from "../.tmp/runtime/packages/tracking-state/src/segmentation.js";
import {
  M4_SUBJECT_SEGMENTATION_CAPABILITY_V1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-segmentation.js";

const request = {
  requestId: "SEG_REQ_001",
  sourceId: "MEDIA_SPIDERMAN_01",
  timestampMs: 1250,
  semanticId: "PERSON_PETER_01",
  entityClass: "PERSON",
  preferredEncoding: "ALPHA",
  prompt: {
    boundingBox: [0.2, 0.1, 0.4, 0.7],
    positivePoints: [{ x: 0.4, y: 0.3 }],
    negativePoints: [{ x: 0.9, y: 0.9 }],
    previousArtifactId: "SEG_ART_PREV",
  },
};

const validResult = () => ({
  requestId: request.requestId,
  sourceId: request.sourceId,
  timestampMs: request.timestampMs,
  semanticId: request.semanticId,
  entityClass: request.entityClass,
  providerId: "local-segmenter",
  providerVersion: "1.0.0",
  mask: {
    encoding: "ALPHA",
    width: 1920,
    height: 1080,
    boundsNormalized: [0, 0, 1, 1],
    artifact: {
      artifactId: "SEG_ART_001",
      contentType: "image/png",
      sha256: "a".repeat(64),
    },
  },
  confidence: 0.96,
  edgeQuality: 0.91,
  temporalConsistency: 0.9,
  occlusion: 0.08,
  evidenceIds: ["SEGMENT:FRAME_30", "SEGMENT:FRAME_30", "MODEL:LOCAL:1.0.0"],
});

test("segmentation capability is declared read-only and does not claim a bundled provider", () => {
  assert.equal(M4_SUBJECT_SEGMENTATION_CAPABILITY_V1.status, "PARTIAL");
  assert.equal(M4_SUBJECT_SEGMENTATION_CAPABILITY_V1.proofMaturity, "DECLARED");
  assert.equal(M4_SUBJECT_SEGMENTATION_CAPABILITY_V1.riskClass, "R0_READ_ONLY");
  assert.equal(M4_SUBJECT_SEGMENTATION_CAPABILITY_V1.fallbackPolicy, "FORBID");
  assert.ok(M4_SUBJECT_SEGMENTATION_CAPABILITY_V1.limitations.some((value) => value.includes("does not create, execute, download, or choose")));
});

test("well-formed segmentation request accepts normalized box, prompts, and prior artifact", () => {
  assert.equal(validateSubjectSegmentationRequestV1(request), true);
});

test("accepted result preserves exact identity and de-duplicates evidence", () => {
  const accepted = acceptSubjectSegmentationResultV1(request, validResult());
  assert.ok(accepted);
  assert.equal(accepted.semanticId, request.semanticId);
  assert.equal(accepted.mask.artifact.artifactId, "SEG_ART_001");
  assert.deepEqual(accepted.evidenceIds, ["SEGMENT:FRAME_30", "MODEL:LOCAL:1.0.0"]);
});

test("request correlation and exact subject binding fail closed", () => {
  for (const mutation of [
    { requestId: "OTHER" },
    { sourceId: "OTHER_MEDIA" },
    { timestampMs: 1251 },
    { semanticId: "PERSON_GWEN_01" },
    { entityClass: "FACE" },
  ]) {
    assert.equal(acceptSubjectSegmentationResultV1(request, { ...validResult(), ...mutation }), null);
  }
});

test("preferred mask encoding is enforced without silent substitution", () => {
  const result = validResult();
  result.mask = { ...result.mask, encoding: "BINARY" };
  assert.equal(acceptSubjectSegmentationResultV1(request, result), null);
});

test("mask geometry and artifact integrity fail closed when malformed", () => {
  const invalidMasks = [
    { ...validResult().mask, width: 0 },
    { ...validResult().mask, height: 1080.5 },
    { ...validResult().mask, boundsNormalized: [0.9, 0, 0.2, 1] },
    { ...validResult().mask, artifact: { artifactId: "", contentType: "image/png" } },
    { ...validResult().mask, artifact: { artifactId: "A", contentType: "", sha256: "a".repeat(64) } },
    { ...validResult().mask, artifact: { artifactId: "A", contentType: "image/png", sha256: "BAD" } },
  ];
  for (const mask of invalidMasks) {
    assert.equal(acceptSubjectSegmentationResultV1(request, { ...validResult(), mask }), null);
  }
});

test("quality metrics must all remain finite normalized values", () => {
  for (const mutation of [
    { confidence: 1.1 },
    { edgeQuality: -0.1 },
    { temporalConsistency: Number.NaN },
    { occlusion: 2 },
  ]) {
    assert.equal(acceptSubjectSegmentationResultV1(request, { ...validResult(), ...mutation }), null);
  }
});

test("evidence provenance is mandatory and empty/invalid entries do not count", () => {
  assert.equal(acceptSubjectSegmentationResultV1(request, { ...validResult(), evidenceIds: [] }), null);
  assert.equal(acceptSubjectSegmentationResultV1(request, { ...validResult(), evidenceIds: ["", "   "] }), null);
  assert.equal(acceptSubjectSegmentationResultV1(request, { ...validResult(), evidenceIds: null }), null);
});

test("malformed runtime prompts fail closed rather than throwing", () => {
  const invalidRequests = [
    { ...request, semanticId: "" },
    { ...request, timestampMs: -1 },
    { ...request, preferredEncoding: "MAGIC" },
    { ...request, prompt: { boundingBox: "not-a-box" } },
    { ...request, prompt: { positivePoints: "not-an-array" } },
    { ...request, prompt: { negativePoints: [{ x: 2, y: 0.5 }] } },
    { ...request, prompt: { previousArtifactId: "" } },
  ];
  for (const invalid of invalidRequests) {
    assert.equal(validateSubjectSegmentationRequestV1(invalid), false);
  }
});

test("valid cropped mask artifacts preserve normalized source-space bounds", () => {
  const result = validResult();
  result.mask = {
    ...result.mask,
    width: 720,
    height: 756,
    boundsNormalized: [0.2, 0.1, 0.4, 0.7],
  };
  const accepted = acceptSubjectSegmentationResultV1(request, result);
  assert.ok(accepted);
  assert.deepEqual(accepted.mask.boundsNormalized, [0.2, 0.1, 0.4, 0.7]);
});
