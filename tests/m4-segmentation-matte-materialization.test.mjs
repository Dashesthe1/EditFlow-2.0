import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";


import {
  M4_SEGMENTATION_MATTE_MATERIALIZATION_CAPABILITY_V1,
  buildSegmentationMatteMaterializationPlanV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-segmentation-matte-materialization.js";

const sha = "a".repeat(64);
const baseSegmentation = {
  requestId: "SEG_REQ_001",
  sourceId: "MEDIA_SOURCE_001",
  timestampMs: 1200,
  semanticId: "PERSON_001",
  entityClass: "PERSON",
  providerId: "sam3.1.local",
  providerVersion: "sam3.1:proof",
  mask: {
    encoding: "ALPHA",
    width: 1920,
    height: 1080,
    boundsNormalized: [0, 0, 1, 1],
    artifact: { artifactId: "SEG_ART_001", contentType: "image/png", sha256: sha },
  },
  confidence: 0.95,
  edgeQuality: 0.9,
  temporalConsistency: 0,
  occlusion: 0.05,
  evidenceIds: ["SEG:E1", "SEG:E2"],
};
const baseInput = () => ({
  segmentation: structuredClone(baseSegmentation),
  artifact: {
    artifactId: "SEG_ART_001",
    absolutePath: "C:\\EditFlowArtifacts\\segmentation-mask.png",
    contentType: "image/png",
    sha256: sha,
    evidenceIds: ["ART:SHA", "ART:SHA"],
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
    evidenceIds: ["AE:TARGET_READBACK"],
  },
  importItemStableId: "SEG_ITEM_001",
  matteLayerStableId: "SEG_MATTE_001",
  channel: "ALPHA",
});
test("materialization planner composes accepted import, layer, alignment, timing, and matte surfaces", () => {
  const plan = buildSegmentationMatteMaterializationPlanV1(baseInput());
  assert.ok(plan);
  assert.deepEqual(plan.matteTransform, {
    anchorPoint: [960, 540],
    position: [960, 540],
    scale: [100, 100],
    rotation: 0,
    opacity: 100,
  });
  assert.deepEqual(plan.matteTiming, { startTime: 0, inPoint: 0, outPoint: 4, stretch: 100 });
  assert.equal(plan.trackMatteType, "ALPHA");
  assert.deepEqual(plan.operations.map((item) => [item.protocolVersion, item.capabilityId, item.command]), [
    ["1.1.0", "ae.media.import", "media.import"],
    ["1.1.0", "ae.layer.create", "layer.add_media"],
    ["1.1.0", "ae.layer.transform.set", "layer.set_transform"],
    ["1.1.0", "ae.layer.timing.set", "layer.set_timing"],
    ["1.3.0", "ae.layer.track_matte.set", "layer.set_track_matte"],
  ]);
  assert.deepEqual(plan.operations[0].payload, {
    path: "C:\\EditFlowArtifacts\\segmentation-mask.png",
    stableId: "SEG_ITEM_001",
    sequence: false,
  });
  assert.deepEqual(plan.evidenceIds, ["SEG:E1", "SEG:E2", "ART:SHA", "SOURCE:GEOMETRY", "AE:TARGET_READBACK"]);
});
test("cropped raster alignment maps through target rotation in source space", () => {
  const input = baseInput();
  input.segmentation.mask.width = 960;
  input.segmentation.mask.height = 540;
  input.segmentation.mask.boundsNormalized = [0, 0, 0.5, 0.5];
  input.targetState.transform.rotation = 90;
  const plan = buildSegmentationMatteMaterializationPlanV1(input);
  assert.ok(plan);
  assert.deepEqual(plan.matteTransform.anchorPoint, [480, 270]);
  assert.ok(Math.abs(plan.matteTransform.position[0] - 1230) < 1e-9);
  assert.ok(Math.abs(plan.matteTransform.position[1] - 60) < 1e-9);
  assert.deepEqual(plan.matteTransform.scale, [100, 100]);
  assert.equal(plan.matteTransform.rotation, 90);
});

test("cropped raster resolution scales independently from normalized source bounds", () => {
  const input = baseInput();
  input.segmentation.mask.width = 480;
  input.segmentation.mask.height = 270;
  input.segmentation.mask.boundsNormalized = [0.25, 0.25, 0.5, 0.5];
  input.targetState.transform.scale = [50, 75];
  const plan = buildSegmentationMatteMaterializationPlanV1(input);
  assert.ok(plan);
  assert.deepEqual(plan.matteTransform.position, [960, 540]);
  assert.deepEqual(plan.matteTransform.scale, [100, 150]);
});
test("inversion remains explicit and is never inferred from mask encoding", () => {
  const input = baseInput();
  input.segmentation.mask.encoding = "PROBABILITY";
  input.inverted = true;
  const plan = buildSegmentationMatteMaterializationPlanV1(input);
  assert.ok(plan);
  assert.equal(plan.trackMatteType, "ALPHA_INVERTED");
  assert.deepEqual(plan.operations[4].payload, {
    comp: { stableId: "COMP_001" },
    layer: { stableId: "LAYER_TARGET_001" },
    matteLayer: { stableId: "SEG_MATTE_001" },
    trackMatteType: "ALPHA_INVERTED",
  });
});

test("artifact identity, content type, digest, and absolute material path must match exactly", () => {
  const mutations = [
    (input) => { input.artifact.artifactId = "OTHER"; },
    (input) => { input.artifact.contentType = "image/jpeg"; },
    (input) => { input.artifact.sha256 = "b".repeat(64); },
    (input) => { input.artifact.absolutePath = "relative\\mask.png"; },
    (input) => { input.artifact.evidenceIds = []; },
  ];
  for (const mutate of mutations) {
    const input = baseInput();
    mutate(input);
    assert.equal(buildSegmentationMatteMaterializationPlanV1(input), null);
  }
});
test("ambiguous target geometry fails closed instead of approximating", () => {
  const mutations = [
    (input) => { input.targetState.stableId = "OTHER_LAYER"; },
    (input) => { input.targetState.threeDLayer = true; },
    (input) => { input.targetState.transform.scale = [0, 100]; },
    (input) => { input.targetState.evidenceIds = []; },
    (input) => { input.sourceFrame.pixelAspect = 1.2; },
    (input) => { input.sourceFrame.evidenceIds = []; },
  ];
  for (const mutate of mutations) {
    const input = baseInput();
    mutate(input);
    assert.equal(buildSegmentationMatteMaterializationPlanV1(input), null);
  }
});

test("planner refuses stable-ID collisions and unsupported matte channels", () => {
  const itemCollision = baseInput();
  itemCollision.importItemStableId = itemCollision.matteLayerStableId;
  assert.equal(buildSegmentationMatteMaterializationPlanV1(itemCollision), null);
  const layerCollision = baseInput();
  layerCollision.matteLayerStableId = layerCollision.targetLayer.stableId;
  assert.equal(buildSegmentationMatteMaterializationPlanV1(layerCollision), null);
  const badChannel = baseInput();
  badChannel.channel = "UNKNOWN";
  assert.equal(buildSegmentationMatteMaterializationPlanV1(badChannel), null);
});
test("materialization planner retains deterministic real-AE visual and rollback evidence without runtime dispatch", () => {
  assert.equal(String(M4_SEGMENTATION_MATTE_MATERIALIZATION_CAPABILITY_V1.id), "tracking.segmentation.matte_materialize.plan");
  assert.equal(M4_SEGMENTATION_MATTE_MATERIALIZATION_CAPABILITY_V1.status, "PARTIAL");
  assert.equal(M4_SEGMENTATION_MATTE_MATERIALIZATION_CAPABILITY_V1.proofMaturity, "VISUAL");
  assert.equal(M4_SEGMENTATION_MATTE_MATERIALIZATION_CAPABILITY_V1.riskClass, "R0_READ_ONLY");
  assert.match(M4_SEGMENTATION_MATTE_MATERIALIZATION_CAPABILITY_V1.limitations.join(" "), /does not dispatch AE mutations/i);
  assert.match(M4_SEGMENTATION_MATTE_MATERIALIZATION_CAPABILITY_V1.routes[0].limitations.join(" "), /pixel-validated viewer-visible output.*guarded failure Undo\/reapply/i);
});

const proofRunnerSource = readFileSync(new URL("../scripts/windows/run-m4-segmentation-matte-materialization.ps1", import.meta.url), "utf8");
const proofHostSource = readFileSync(new URL("../scripts/windows/m4-segmentation-matte-materialization-real-ae-template.jsx", import.meta.url), "utf8");

test("real-AE materialization proof is bounded, warm-process safe, and baseline restoring", () => {
  assert.match(proofRunnerSource, /TimeoutSeconds\s*=\s*90/);
  assert.match(proofRunnerSource, /Start-Process\s+-FilePath\s+\$AfterFxPath\s+-ArgumentList\s+\$Arguments/);
  assert.doesNotMatch(proofHostSource, /app\.quit\s*\(/);
  assert.doesNotMatch(proofHostSource, /app\.project\.close\s*\(/);
  assert.doesNotMatch(proofHostSource, /app\.project\.save\s*\(/);
  assert.match(proofHostSource, /project_baseline_restored/);
});

test("real-AE materialization proof retains visual evidence and explicit rollback-reapply coverage", () => {
  assert.match(proofHostSource, /M4_MATERIALIZATION_MISSING_COMP/);
  assert.match(proofHostSource, /transaction\.undo_last/);
  assert.match(proofHostSource, /rollback_cleared_track_matte/);
  assert.match(proofHostSource, /rollback_reapply_restored_matte/);
  assert.match(proofHostSource, /saveFrameToPng/);
  assert.match(proofRunnerSource, /VisualCheckpointPassed/);
});
