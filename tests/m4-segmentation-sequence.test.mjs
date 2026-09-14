import test from "node:test";
import assert from "node:assert/strict";

import {
  acceptSubjectSegmentationSequenceResultV1,
  validateSubjectSegmentationSequenceRequestV1,
} from "../.tmp/runtime/packages/tracking-state/src/segmentation-sequence.js";
import {
  M4_SEGMENTATION_SEQUENCE_MATTE_MATERIALIZATION_CAPABILITY_V1,
  buildSegmentationSequenceMatteMaterializationPlanV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-segmentation-sequence-materialization.js";

const request = {
  requestId: "SEG_SEQ_001",
  sourceId: "MEDIA_SPIDERMAN_01",
  semanticId: "PERSON_PETER_01",
  entityClass: "PERSON",
  startTimestampMs: 1000,
  startFrameIndex: 12,
  frameRate: 12,
  frameCount: 3,
  promptFrameIndex: 0,
  prompt: { boundingBox: [0.2, 0.1, 0.4, 0.7] },
  preferredEncoding: "ALPHA",
};

const frame = (index) => ({
  frameIndex: index,
  timestampMs: request.startTimestampMs + index * 1000 / request.frameRate,
  mask: {
    encoding: "ALPHA",
    width: 1920,
    height: 1080,
    boundsNormalized: [0, 0, 1, 1],
    artifact: {
      artifactId: `SEG_SEQ_ART_${index}`,
      contentType: "image/png",
      sha256: String(index + 1).repeat(64),
    },
  },
  confidence: 0.95 - index * 0.01,
  edgeQuality: 0.9,
  temporalConsistency: index === 0 ? 1 : 0.96,
  occlusion: 0.05,
  evidenceIds: [`SEG:FRAME:${index}`],
});

const result = () => ({
  requestId: request.requestId,
  sourceId: request.sourceId,
  semanticId: request.semanticId,
  entityClass: request.entityClass,
  providerId: "sam3.1.local",
  providerVersion: "sam3.1:proof",
  startTimestampMs: request.startTimestampMs,
  startFrameIndex: request.startFrameIndex,
  frameRate: request.frameRate,
  frameCount: request.frameCount,
  frames: [frame(0), frame(1), frame(2)],
  evidenceIds: ["SAM31:VIDEO:SESSION", "SAM31:VIDEO:SESSION"],
});

const accepted = () => acceptSubjectSegmentationSequenceResultV1(request, result());

const materialFrame = (index) => ({
  frameIndex: index,
  artifactId: `SEG_SEQ_ART_${index}`,
  absolutePath: `C:\\EditFlowArtifacts\\mask-${String(index + 1).padStart(4, "0")}.png`,
  contentType: "image/png",
  sha256: String(index + 1).repeat(64),
  evidenceIds: [`ART:FRAME:${index}`],
});

const baseInput = () => ({
  segmentation: accepted(),
  artifactSequence: {
    frames: [materialFrame(0), materialFrame(1), materialFrame(2)],
    evidenceIds: ["ART:SEQUENCE:VERIFIED"],
  },
  sourceFrame: { width: 1920, height: 1080, pixelAspect: 1, evidenceIds: ["SOURCE:GEOMETRY"] },
  comp: { stableId: "COMP_001" },
  targetLayer: { stableId: "LAYER_TARGET_001" },
  targetState: {
    stableId: "LAYER_TARGET_001",
    threeDLayer: false,
    transform: {
      anchorPoint: [960, 540],
      position: [960, 540],
      scale: [100, 100],
      rotation: 0,
    },
    timing: { startTime: 0, inPoint: 0, outPoint: 4, stretch: 100 },
    evidenceIds: ["AE:TARGET:READBACK"],
  },
  importItemStableId: "SEG_SEQ_ITEM_001",
  matteLayerStableId: "SEG_SEQ_MATTE_001",
  channel: "ALPHA",
});
test("temporal segmentation accepts only exact correlated cadence and uniform raster geometry", () => {
  assert.equal(validateSubjectSegmentationSequenceRequestV1(request), true);
  const value = accepted();
  assert.ok(value);
  assert.equal(value.frames.length, 3);
  assert.deepEqual(value.evidenceIds, ["SAM31:VIDEO:SESSION"]);
  assert.deepEqual(value.frames[1].evidenceIds, ["SEG:FRAME:1"]);
});

test("temporal segmentation refuses index, timestamp, geometry, digest, and artifact-identity drift", () => {
  const mutations = [
    (value) => { value.frames[1].frameIndex = 2; },
    (value) => { value.frames[1].timestampMs += 0.01; },
    (value) => { value.startFrameIndex += 1; },
    (value) => { value.frames[1].mask.width = 1919; },
    (value) => { value.frames[1].mask.boundsNormalized = [0, 0, 0.9, 1]; },
    (value) => { value.frames[1].mask.artifact.sha256 = "bad"; },
    (value) => { value.frames[1].mask.artifact.artifactId = value.frames[0].mask.artifact.artifactId; },
    (value) => { value.frames[1].evidenceIds = []; },
  ];
  for (const mutate of mutations) {
    const value = result();
    mutate(value);
    assert.equal(acceptSubjectSegmentationSequenceResultV1(request, value), null);
  }
});

test("temporal request refuses invalid range and prompt-frame declarations", () => {
  for (const mutation of [
    { frameRate: 0 },
    { frameCount: 0 },
    { frameCount: 2.5 },
    { promptFrameIndex: 3 },
    { promptFrameIndex: -1 },
    { startTimestampMs: -1 },
    { startFrameIndex: 11 },
  ]) assert.equal(validateSubjectSegmentationSequenceRequestV1({ ...request, ...mutation }), false);
});
test("dynamic matte planner binds verified sequence to protocol 2.5 and exact target timing", () => {
  const plan = buildSegmentationSequenceMatteMaterializationPlanV1(baseInput());
  assert.ok(plan);
  assert.equal(plan.frameRate, 12);
  assert.equal(plan.frameCount, 3);
  assert.equal(plan.sequenceDurationSeconds, 0.25);
  assert.equal(plan.firstFramePath, "C:\\EditFlowArtifacts\\mask-0001.png");
  assert.deepEqual(plan.matteTiming, { startTime: 1, inPoint: 1, outPoint: 1.25, stretch: 100 });
  assert.deepEqual(plan.matteTransform, {
    anchorPoint: [960, 540],
    position: [960, 540],
    scale: [100, 100],
    rotation: 0,
    opacity: 100,
  });
  assert.deepEqual(plan.operations.map((item) => [item.protocolVersion, item.capabilityId, item.command]), [
    ["2.5.0", "ae.media.sequence.import", "media.sequence.import"],
    ["1.1.0", "ae.layer.create", "layer.add_media"],
    ["1.1.0", "ae.layer.transform.set", "layer.set_transform"],
    ["1.1.0", "ae.layer.timing.set", "layer.set_timing"],
    ["1.3.0", "ae.layer.track_matte.set", "layer.set_track_matte"],
  ]);
  assert.deepEqual(plan.operations[0].payload, {
    path: "C:\\EditFlowArtifacts\\mask-0001.png",
    stableId: "SEG_SEQ_ITEM_001",
    frameRate: 12,
    expectedFrameCount: 3,
  });
});
test("dynamic matte planner refuses broken numbered sequence, hash drift, reverse time, and uncovered source range", () => {
  const cases = [
    (input) => { input.artifactSequence.frames[1].absolutePath = "C:\\EditFlowArtifacts\\mask-0003.png"; },
    (input) => { input.artifactSequence.frames[2].sha256 = "9".repeat(64); },
    (input) => { input.artifactSequence.frames[2].artifactId = "OTHER"; },
    (input) => { input.targetState.timing.stretch = -100; },
    (input) => { input.targetState.timing.outPoint = 1.1; },
    (input) => { input.artifactSequence.evidenceIds = []; },
  ];
  for (const mutate of cases) {
    const input = baseInput();
    assert.ok(input.segmentation);
    mutate(input);
    assert.equal(buildSegmentationSequenceMatteMaterializationPlanV1(input), null);
  }
});

test("dynamic sequence capability is transfer-proven while production still waits for live provider output", () => {
  const capability = M4_SEGMENTATION_SEQUENCE_MATTE_MATERIALIZATION_CAPABILITY_V1;
  assert.equal(String(capability.id), "tracking.segmentation.sequence_matte_materialize.plan");
  assert.equal(capability.status, "FULL");
  assert.equal(capability.proofMaturity, "TRANSFER");
  assert.equal(capability.riskClass, "R0_READ_ONLY");
  assert.match(capability.limitations.join(" "), /never dispatches mutations/i);
  assert.match(capability.limitations.join(" "), /production runtime registration remains withheld/i);
  assert.match(capability.routes[0].limitations.join(" "), /save\/reopen plus distinct authenticated CEP reconnect.*retained through P5/i);
  assert.match(capability.routes[0].limitations.join(" "), /live SAM 3\.1 provider-generated sequence proof.*blocked/i);
});
