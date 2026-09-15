import test from "node:test";
import assert from "node:assert/strict";

import { createDesktopAeSession } from "../.tmp/runtime/apps/desktop-host/src/index.js";
import {
  M5_ROTO_BRUSH_CAPABILITIES_V1,
  M5_ROTO_BRUSH_SESSION_INSPECT_CAPABILITY_V1,
  prepareRotoBrushSemanticActionV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-roto-brush.js";

const fakeObservedState = (projectId) => ({
  observed: {
    projectId,
    projectRevision: "m5-roto-revision",
    projectFingerprint: "m5-roto-project-fingerprint",
    environmentFingerprint: "m5-roto-environment",
  },
  project: { schemaVersion: 1, projectId, filePath: null, itemCount: 0, items: [] },
  hostRevision: 1,
});
const adapter = { observe: async (projectId) => fakeObservedState(projectId) };
const target = {
  compHostId: 11,
  layerHostId: 22,
  expectedCompName: "Roto Proof",
  expectedLayerName: "Subject Footage",
};
const evidenceIds = ["M5:ROTO:TARGET:001"];
const revision = "ROTO_SESSION_REV_001";
const stroke = {
  role: "FOREGROUND",
  pointsNormalized: [{ x: 0.4, y: 0.35 }, { x: 0.45, y: 0.42 }],
  radiusNormalized: 0.03,
};

test("M5 Roto Brush capabilities are declared as unavailable subsystem adapters", () => {
  assert.equal(M5_ROTO_BRUSH_CAPABILITIES_V1.length, 7);
  for (const capability of M5_ROTO_BRUSH_CAPABILITIES_V1) {
    assert.equal(capability.status, "ADAPTER_REQUIRED");
    assert.equal(capability.proofMaturity, "DECLARED");
    assert.equal(capability.fallbackPolicy, "EXPLICIT_ONLY");
    assert.ok(capability.routes.length > 0);
    assert.ok(capability.routes.every((route) => route.kind === "SUBSYSTEM_ADAPTER" && route.available === false));
    assert.ok(capability.limitations.some((value) => value.includes("must not be represented as ordinary effect-property access")));
  }
  assert.equal(M5_ROTO_BRUSH_SESSION_INSPECT_CAPABILITY_V1.riskClass, "R0_READ_ONLY");
  assert.ok(M5_ROTO_BRUSH_CAPABILITIES_V1.slice(1).every((capability) => capability.riskClass === "R4_EXTERNAL_UI"));
});

test("default desktop runtime does not expose unproven M5 Roto Brush capabilities", async () => {
  const session = await createDesktopAeSession(adapter, "m5-roto-default");
  for (const capability of M5_ROTO_BRUSH_CAPABILITIES_V1) assert.equal(session.registry.get(capability.id), null);
});

test("read-only session inspection binds an exact target without inventing mutation evidence", () => {
  const action = prepareRotoBrushSemanticActionV1({ operation: "INSPECT_SESSION", target });
  assert.equal(action.operation, "INSPECT_SESSION");
  assert.equal(action.expectedSessionRevision, null);
  assert.deepEqual(action.evidenceIds, []);
});

test("foreground seed requires revision, evidence, time, matching role, and normalized stroke geometry", () => {
  const action = prepareRotoBrushSemanticActionV1({
    operation: "SEED_FOREGROUND", target, expectedSessionRevision: revision,
    atTime: 0.25, stroke, evidenceIds,
  });
  assert.equal(action.stroke.role, "FOREGROUND");
  assert.equal(action.atTime, 0.25);
  assert.throws(() => prepareRotoBrushSemanticActionV1({ operation: "SEED_FOREGROUND", target, atTime: 0.25, stroke, evidenceIds }), /expectedSessionRevision/);
  assert.throws(() => prepareRotoBrushSemanticActionV1({ operation: "SEED_FOREGROUND", target, expectedSessionRevision: revision, atTime: 0.25, stroke, evidenceIds: [] }), /evidenceId/);
  assert.throws(() => prepareRotoBrushSemanticActionV1({ operation: "SEED_FOREGROUND", target, expectedSessionRevision: revision, atTime: 0.25, stroke: { ...stroke, role: "BACKGROUND" }, evidenceIds }), /role/);
  assert.throws(() => prepareRotoBrushSemanticActionV1({ operation: "SEED_FOREGROUND", target, expectedSessionRevision: revision, atTime: 0.25, stroke: { ...stroke, pointsNormalized: [{ x: -0.1, y: 0.5 }, { x: 0.2, y: 0.2 }] }, evidenceIds }), /normalized/);
});

test("propagation is bounded and fails closed on non-increasing ranges", () => {
  const forward = prepareRotoBrushSemanticActionV1({
    operation: "PROPAGATE_FORWARD", target, expectedSessionRevision: revision,
    range: { startTime: 0.25, endTime: 1.25 }, evidenceIds,
  });
  assert.deepEqual(forward.range, { startTime: 0.25, endTime: 1.25 });
  assert.throws(() => prepareRotoBrushSemanticActionV1({
    operation: "PROPAGATE_BACKWARD", target, expectedSessionRevision: revision,
    range: { startTime: 1, endTime: 1 }, evidenceIds,
  }), /increasing time range/);
});

test("Refine Edge and export require bounded explicit semantic payloads", () => {
  const refineStroke = {
    role: "REFINE_EDGE",
    pointsNormalized: [{ x: 0.31, y: 0.24 }, { x: 0.34, y: 0.3 }, { x: 0.36, y: 0.36 }],
    radiusNormalized: 0.02,
  };
  const refine = prepareRotoBrushSemanticActionV1({
    operation: "REFINE_EDGE", target, expectedSessionRevision: revision,
    atTime: 0.5, stroke: refineStroke, evidenceIds,
  });
  assert.equal(refine.atTime, 0.5);
  assert.equal(refine.stroke.role, "REFINE_EDGE");
  const exported = prepareRotoBrushSemanticActionV1({
    operation: "EXPORT_MATTE", target, expectedSessionRevision: revision,
    export: { kind: "TRACK_MATTE", stableId: "M5_ROTO_MATTE_001" }, evidenceIds,
  });
  assert.equal(exported.export.stableId, "M5_ROTO_MATTE_001");
  assert.throws(() => prepareRotoBrushSemanticActionV1({
    operation: "REFINE_EDGE", target, expectedSessionRevision: revision,
    stroke: refineStroke, evidenceIds,
  }), /REFINE_EDGE/);
  assert.throws(() => prepareRotoBrushSemanticActionV1({
    operation: "REFINE_EDGE", target, expectedSessionRevision: revision,
    atTime: 0.5, stroke: { ...refineStroke, role: "FOREGROUND" }, evidenceIds,
  }), /role/);
  assert.throws(() => prepareRotoBrushSemanticActionV1({
    operation: "EXPORT_MATTE", target, expectedSessionRevision: revision,
    export: { kind: "TRACK_MATTE", stableId: "" }, evidenceIds,
  }), /EXPORT_MATTE/);
});