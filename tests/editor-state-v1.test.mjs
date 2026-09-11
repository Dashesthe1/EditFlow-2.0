import test from "node:test";
import assert from "node:assert/strict";
import {
  findHeroSubjectV1,
  isEditorCapabilityUsableV1,
  validateEditorSubjectStateV1,
} from "../.tmp/runtime/packages/editor-state/src/index.js";

const subject = (overrides = {}) => ({
  entityId: "SUBJECT_1",
  label: "Hero",
  center: { x: 0.5, y: 0.5 },
  box: { left: 0.35, top: 0.2, right: 0.65, bottom: 0.85 },
  scale: 0.2,
  speed: 0.4,
  acceleration: 0.1,
  motionDirection: "RIGHT",
  observationConfidence: 0.95,
  identityConfidence: 0.94,
  geometryConfidence: 0.93,
  trackConfidence: 0.9,
  occlusionConfidence: 0.85,
  trackStatus: "STABLE",
  isolationStatus: "NOT_NEEDED",
  occludedFraction: 0.05,
  foregroundOccluderEntityId: null,
  framingQuality: 0.9,
  attachPoints: [
    { id: "center", kind: "CENTER", point: { x: 0.5, y: 0.5 }, confidence: 0.95 },
  ],
  evidenceRefs: ["OBS_1"],
  observedAtMs: 1000,
  ...overrides,
});

test("trusted subject state validates without structural errors", () => {
  assert.deepEqual(validateEditorSubjectStateV1(subject()), []);
});

test("invalid normalized geometry fails validation", () => {
  const errors = validateEditorSubjectStateV1(subject({
    center: { x: 1.2, y: 0.5 },
    box: { left: 0.8, top: 0.2, right: 0.4, bottom: 0.7 },
  }));
  assert.ok(errors.includes("INVALID_CENTER_X"));
  assert.ok(errors.includes("INVALID_BOUNDING_BOX_ORDER"));
});

test("capability use requires an available FULL/PARTIAL route at the requested proof maturity", () => {
  assert.equal(isEditorCapabilityUsableV1({
    capabilityId: "m4.point_tracking",
    status: "FULL",
    proofMaturity: "STRUCTURAL",
    available: true,
  }), true);
  assert.equal(isEditorCapabilityUsableV1({
    capabilityId: "m4.point_tracking",
    status: "FULL",
    proofMaturity: "DECLARED",
    available: true,
  }), false);
  assert.equal(isEditorCapabilityUsableV1({
    capabilityId: "m4.point_tracking",
    status: "ADAPTER_REQUIRED",
    proofMaturity: "ROBUST",
    available: true,
  }), false);
});

test("hero subject selection uses explicit identity when supplied", () => {
  const first = subject({ entityId: "A", identityConfidence: 0.99 });
  const second = subject({ entityId: "B", identityConfidence: 0.7 });
  const selected = findHeroSubjectV1({
    heroSubjectId: "B",
    subjects: [first, second],
    capabilities: {},
  });
  assert.equal(selected?.entityId, "B");
});

test("ambiguous multi-subject state does not guess a hero", () => {
  const selected = findHeroSubjectV1({
    subjects: [
      subject({ entityId: "A", identityConfidence: 0.91, observationConfidence: 0.95 }),
      subject({ entityId: "B", identityConfidence: 0.9, observationConfidence: 0.95 }),
    ],
    capabilities: {},
  });
  assert.equal(selected, null);
});
