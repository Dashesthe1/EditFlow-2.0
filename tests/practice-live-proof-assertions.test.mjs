import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluatePracticeIsolationEvidenceV1,
  evaluatePracticeIsolationReadinessV1,
  evaluatePracticeLivePersistenceV1,
} from "../.tmp/runtime/apps/desktop-host/src/practice-live-proof-assertions.js";

const learningReload = {
  episodeRestored: true,
  editTypeRestored: true,
  allocationRestored: true,
  editTypeContainsSession: true,
  learningMemoryUnchanged: false,
};

const heldOutReload = {
  episodeRestored: false,
  editTypeRestored: true,
  allocationRestored: false,
  editTypeContainsSession: false,
  learningMemoryUnchanged: true,
};

test("learning persistence requires the episode and Edit Type to reload", () => {
  const accepted = evaluatePracticeLivePersistenceV1("LEARNING", learningReload);
  assert.equal(accepted.passed, true);
  const rejected = evaluatePracticeLivePersistenceV1("LEARNING", {
    ...learningReload,
    episodeRestored: false,
  });
  assert.equal(rejected.passed, false);
  assert.match(rejected.reasons.join("\n"), /episode did not survive/);
});

test("held-out persistence proves the certification did not enter learning memory", () => {
  const accepted = evaluatePracticeLivePersistenceV1(
    "HELD_OUT_CERTIFICATION",
    heldOutReload,
  );
  assert.equal(accepted.passed, true);

  const leaked = evaluatePracticeLivePersistenceV1(
    "HELD_OUT_CERTIFICATION",
    {
      ...heldOutReload,
      episodeRestored: true,
      editTypeContainsSession: true,
      learningMemoryUnchanged: false,
    },
  );
  assert.equal(leaked.passed, false);
  assert.match(leaked.reasons.join("\n"), /leaked an episode/);
  assert.match(leaked.reasons.join("\n"), /changed the Practice learning-memory/);
});
test("live isolation readiness proves the requested SAM-to-Roto path before reconstruction", () => {
  const accepted = evaluatePracticeIsolationReadinessV1({
    availableBackendIds: [
      "SAM31_TEMPORAL_MATTE",
      "ROTO_BRUSH_TRACK_MATTE",
      "AE_TRACKED_MASK",
    ],
    expectedBackend: "ROTO_BRUSH_TRACK_MATTE",
    expectedFallbackAfter: "SAM31_TEMPORAL_MATTE",
  });
  assert.equal(accepted.passed, true);
  assert.deepEqual(accepted.availableBackendIds, [
    "SAM31_TEMPORAL_MATTE",
    "ROTO_BRUSH_TRACK_MATTE",
    "AE_TRACKED_MASK",
  ]);

  const missing = evaluatePracticeIsolationReadinessV1({
    availableBackendIds: ["AE_TRACKED_MASK"],
    expectedBackend: "ROTO_BRUSH_TRACK_MATTE",
    expectedFallbackAfter: "SAM31_TEMPORAL_MATTE",
  });
  assert.equal(missing.passed, false);
  assert.match(missing.reasons.join("\n"), /ROTO_BRUSH_TRACK_MATTE/);
  assert.match(missing.reasons.join("\n"), /SAM31_TEMPORAL_MATTE/);

  const contradictory = evaluatePracticeIsolationReadinessV1({
    availableBackendIds: ["ROTO_BRUSH_TRACK_MATTE"],
    expectedBackend: "ROTO_BRUSH_TRACK_MATTE",
    expectedFallbackAfter: "ROTO_BRUSH_TRACK_MATTE",
  });
  assert.equal(contradictory.passed, false);
  assert.match(contradictory.reasons.join("\n"), /must be different/);
});

test("live isolation assertion can require a real SAM-to-Roto fallback trace", () => {
  const accepted = evaluatePracticeIsolationEvidenceV1({
    evidenceRefs: [
      "practice-subject-isolation-rejected-backend:SAM31_TEMPORAL_MATTE",
      "practice-subject-isolation-rejection-code:SAM31_TEMPORAL_MATTE:PRACTICE_SUBJECT_ISOLATION_SEGMENTATION_REJECTED",
      "practice-subject-isolation-fallback-after:SAM31_TEMPORAL_MATTE",
      "practice-subject-isolation-backend:ROTO_BRUSH_TRACK_MATTE",
      "practice-subject-isolation-route:practice-m6.roto-brush-track-matte.v1",
      "practice-subject-cross-source-identity:true",
      "practice-subject-mask-source:ROTO_BRUSH",
      "practice-roto-export-host-id:4312",
      "practice-roto-final-matte:PRACTICE_ROTO_MATTE_TEST",
      "practice-roto-working-layer-cleaned:true",
      "practice-roto-applied-undo-entries:5",
    ],
    expectedBackend: "ROTO_BRUSH_TRACK_MATTE",
    expectedFallbackAfter: "SAM31_TEMPORAL_MATTE",
  });
  assert.equal(accepted.passed, true);
  assert.deepEqual(accepted.observedBackends, ["ROTO_BRUSH_TRACK_MATTE"]);
  assert.deepEqual(accepted.observedFallbacks, ["SAM31_TEMPORAL_MATTE"]);
  assert.deepEqual(accepted.observedRejectedBackends, ["SAM31_TEMPORAL_MATTE"]);
  assert.deepEqual(accepted.observedRejectionCodes, [
    "SAM31_TEMPORAL_MATTE:PRACTICE_SUBJECT_ISOLATION_SEGMENTATION_REJECTED",
  ]);

  const rejected = evaluatePracticeIsolationEvidenceV1({
    evidenceRefs: ["practice-subject-isolation-backend:SAM31_TEMPORAL_MATTE"],
    expectedBackend: "ROTO_BRUSH_TRACK_MATTE",
    expectedFallbackAfter: "SAM31_TEMPORAL_MATTE",
  });
  assert.equal(rejected.passed, false);
  assert.ok(rejected.reasons.length >= 2);

  const labelOnly = evaluatePracticeIsolationEvidenceV1({
    evidenceRefs: [
      "practice-subject-isolation-rejected-backend:SAM31_TEMPORAL_MATTE",
      "practice-subject-isolation-rejection-code:SAM31_TEMPORAL_MATTE:SAM_REJECTED",
      "practice-subject-isolation-fallback-after:SAM31_TEMPORAL_MATTE",
      "practice-subject-isolation-backend:ROTO_BRUSH_TRACK_MATTE",
    ],
    expectedBackend: "ROTO_BRUSH_TRACK_MATTE",
    expectedFallbackAfter: "SAM31_TEMPORAL_MATTE",
  });
  assert.equal(labelOnly.passed, false);
  assert.match(labelOnly.reasons.join("\n"), /Roto Brush certification is missing committed/);
});
