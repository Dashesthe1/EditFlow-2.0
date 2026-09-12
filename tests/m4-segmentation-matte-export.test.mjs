import test from "node:test";
import assert from "node:assert/strict";
import {
  M4_SEGMENTATION_MATTE_EXPORT_CAPABILITY_V1,
  buildSegmentationMatteExportPlanV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-segmentation-matte-export.js";

const segmentation = {
  requestId: "SEG_REQ_1",
  sourceId: "MEDIA_1",
  timestampMs: 1250,
  semanticId: "PERSON_PETER_01",
  entityClass: "PERSON",
  providerId: "local-segmenter",
  mask: {
    encoding: "ALPHA",
    width: 1920,
    height: 1080,
    boundsNormalized: [0, 0, 1, 1],
    artifact: { artifactId: "SEG_ART_1", contentType: "image/png" },
  },
  confidence: 0.95,
  edgeQuality: 0.9,
  temporalConsistency: 0.88,
  occlusion: 0.1,
  evidenceIds: ["SEG:E1", "SEG:E1", "SEG:E2"],
};

const baseInput = {
  segmentation,
  comp: { stableId: "COMP_1" },
  targetLayer: { stableId: "LAYER_TARGET" },
  matteLayer: { stableId: "LAYER_MATTE" },
  channel: "ALPHA",
};

test("matte export capability remains declared/read-only until materialization and live write proof exist", () => {
  assert.equal(M4_SEGMENTATION_MATTE_EXPORT_CAPABILITY_V1.status, "PARTIAL");
  assert.equal(M4_SEGMENTATION_MATTE_EXPORT_CAPABILITY_V1.proofMaturity, "DECLARED");
  assert.equal(M4_SEGMENTATION_MATTE_EXPORT_CAPABILITY_V1.riskClass, "R0_READ_ONLY");
  assert.equal(M4_SEGMENTATION_MATTE_EXPORT_CAPABILITY_V1.fallbackPolicy, "FORBID");
});

test("alpha segmentation artifact maps to the exact protocol 1.3 track-matte payload", () => {
  const plan = buildSegmentationMatteExportPlanV1(baseInput);
  assert.ok(plan);
  assert.equal(plan.trackMatteType, "ALPHA");
  assert.equal(plan.requiredWriteCapabilityId, "ae.layer.track_matte.set");
  assert.deepEqual(plan.compositePayload, {
    comp: { stableId: "COMP_1" },
    layer: { stableId: "LAYER_TARGET" },
    matteLayer: { stableId: "LAYER_MATTE" },
    trackMatteType: "ALPHA",
  });
  assert.equal(plan.materialization.artifactId, "SEG_ART_1");
  assert.equal(plan.materialization.requiresExactArtifactProof, true);
  assert.deepEqual(plan.evidenceIds, ["SEG:E1", "SEG:E2"]);
});

test("matte channel and inversion are explicit rather than inferred from segmentation encoding", () => {
  const cases = [
    ["ALPHA", false, "ALPHA"],
    ["ALPHA", true, "ALPHA_INVERTED"],
    ["LUMA", false, "LUMA"],
    ["LUMA", true, "LUMA_INVERTED"],
  ];
  for (const [channel, inverted, expected] of cases) {
    const plan = buildSegmentationMatteExportPlanV1({ ...baseInput, channel, inverted });
    assert.ok(plan);
    assert.equal(plan.trackMatteType, expected);
  }
});

test("cropped segmentation bounds are preserved for later truthful layer alignment", () => {
  const plan = buildSegmentationMatteExportPlanV1({
    ...baseInput,
    segmentation: {
      ...segmentation,
      mask: { ...segmentation.mask, width: 700, height: 700, boundsNormalized: [0.2, 0.1, 0.4, 0.7] },
    },
  });
  assert.ok(plan);
  assert.deepEqual(plan.materialization.boundsNormalized, [0.2, 0.1, 0.4, 0.7]);
});

test("target layer cannot also be its own matte layer", () => {
  assert.equal(buildSegmentationMatteExportPlanV1({
    ...baseInput,
    matteLayer: { stableId: "LAYER_TARGET" },
  }), null);
});

test("unknown channel, malformed stable refs, and invalid inversion fail closed", () => {
  assert.equal(buildSegmentationMatteExportPlanV1({ ...baseInput, channel: "AUTO" }), null);
  assert.equal(buildSegmentationMatteExportPlanV1({ ...baseInput, comp: { stableId: "" } }), null);
  assert.equal(buildSegmentationMatteExportPlanV1({ ...baseInput, inverted: "yes" }), null);
});

test("malformed artifact geometry or identity fails closed", () => {
  const invalidMasks = [
    { ...segmentation.mask, width: 0 },
    { ...segmentation.mask, height: 1.2 },
    { ...segmentation.mask, boundsNormalized: [0.9, 0, 0.2, 1] },
    { ...segmentation.mask, artifact: { artifactId: "", contentType: "image/png" } },
    { ...segmentation.mask, artifact: { artifactId: "A", contentType: "" } },
  ];
  for (const mask of invalidMasks) {
    assert.equal(buildSegmentationMatteExportPlanV1({
      ...baseInput,
      segmentation: { ...segmentation, mask },
    }), null);
  }
});

test("segmentation provenance is mandatory for an export plan", () => {
  assert.equal(buildSegmentationMatteExportPlanV1({
    ...baseInput,
    segmentation: { ...segmentation, evidenceIds: [] },
  }), null);
  assert.equal(buildSegmentationMatteExportPlanV1({
    ...baseInput,
    segmentation: { ...segmentation, evidenceIds: null },
  }), null);
});
