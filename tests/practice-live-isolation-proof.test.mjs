import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluatePracticeLiveIsolationProofV1,
} from "../.tmp/runtime/apps/desktop-host/src/practice-live-isolation-proof.js";

const session = (evidenceRefs) => ({
  evidenceRefs: [],
  attempts: [{ evidenceRefs }],
});

const targetEvidence = [
  "practice-subject-isolation-fallback-after:SAM31_TEMPORAL_MATTE",
  "practice-subject-isolation-backend:ROTO_BRUSH_TRACK_MATTE",
  "practice-subject-isolation-route:practice-m6.roto-brush-track-matte.v1",
  "practice-subject-reference-id:subject:reference",
  "practice-subject-source-id:subject:source",
  "practice-subject-cross-source-identity:true",
  "practice-subject-target-binding:true",
  "practice-subject-target-shot:shot:001",
  "practice-subject-target-comp:PRACTICE_COMP_001",
  "practice-subject-target-layer:PRACTICE_SHOT_0001",
  "practice-subject-mask-source:ROTO_BRUSH",
];
test("live isolation proof certifies exact target plus required fallback/backend", () => {
  const proof = evaluatePracticeLiveIsolationProofV1(
    session(targetEvidence),
    {
      required: true,
      requiredBackendIds: ["ROTO_BRUSH_TRACK_MATTE"],
      requiredFallbackAfterIds: ["SAM31_TEMPORAL_MATTE"],
    },
  );

  assert.equal(proof.verified, true);
  assert.deepEqual(proof.backendIds, ["ROTO_BRUSH_TRACK_MATTE"]);
  assert.deepEqual(proof.fallbackAfterBackendIds, ["SAM31_TEMPORAL_MATTE"]);
  assert.equal(proof.targets.length, 1);
  assert.equal(proof.targets[0].complete, true);
  assert.equal(proof.targets[0].targetShotId, "shot:001");
  assert.equal(proof.targets[0].targetCompStableId, "PRACTICE_COMP_001");
  assert.equal(proof.targets[0].targetLayerStableId, "PRACTICE_SHOT_0001");
});

test("live isolation proof rejects incomplete target identity", () => {
  const proof = evaluatePracticeLiveIsolationProofV1(
    session(targetEvidence.filter((item) =>
      item !== "practice-subject-target-layer:PRACTICE_SHOT_0001")),
    {
      required: true,
      requiredBackendIds: [],
      requiredFallbackAfterIds: [],
    },
  );
  assert.equal(proof.verified, false);
  assert.equal(proof.targets.length, 1);
  assert.equal(proof.targets[0].complete, false);
  assert.ok(proof.reasons.some((reason) => /shot\/comp\/layer/.test(reason)));
});

test("live isolation proof reports missing required backend and fallback", () => {
  const proof = evaluatePracticeLiveIsolationProofV1(
    session(targetEvidence),
    {
      required: true,
      requiredBackendIds: ["AE_TRACKED_MASK"],
      requiredFallbackAfterIds: ["ROTO_BRUSH_TRACK_MATTE"],
    },
  );

  assert.equal(proof.verified, false);
  assert.ok(proof.reasons.some((reason) =>
    reason.includes("AE_TRACKED_MASK")));
  assert.ok(proof.reasons.some((reason) =>
    reason.includes("ROTO_BRUSH_TRACK_MATTE")));
});

test("live isolation proof remains non-blocking when no proof requirement is requested", () => {
  const proof = evaluatePracticeLiveIsolationProofV1(
    session([]),
    {
      required: false,
      requiredBackendIds: [],
      requiredFallbackAfterIds: [],
    },
  );
  assert.equal(proof.required, false);
  assert.equal(proof.verified, true);
  assert.deepEqual(proof.targets, []);
});
