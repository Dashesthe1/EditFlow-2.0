import assert from "node:assert/strict";
import test from "node:test";

import {
  PracticeM6SubjectIsolationRouterV1,
} from "../.tmp/runtime/apps/desktop-host/src/practice-m6-subject-isolation-router.js";

const retainedIdentity = (overrides = {}) => ({
  memoryId: "practice-subject-memory:fixture",
  sessionId: "practice:mastered:fixture",
  referenceFingerprint: "reference:sha256:fixture",
  sourceFingerprint: "source-set:sha256:fixture",
  sourceMediaSha256: ["source:sha256:fixture"],
  sourceVideoSha256: "source:sha256:fixture",
  referenceWindowId: "window:001",
  shotId: "shot:001",
  sourceId: "source:001",
  referenceSemanticId: "reference-subject:hero",
  sourceSemanticId: "source-subject:hero",
  referenceTimeMs: 500,
  sourceTimeMs: 2500,
  referenceSubjectBox: [20, 10, 180, 170],
  sourceSubjectBox: [25, 12, 185, 172],
  confidence: 0.97,
  algorithmId: "practice-cross-source-subject.v1",
  sourceVideo: {
    fps: 30,
    frameCount: 300,
    width: 1920,
    height: 1080,
    durationMs: 10000,
    sampleTimeMs: 2500,
  },
  maskSources: ["ROTO_BRUSH"],
  evidenceRefs: ["subject-memory:fixture"],
  verifiedAt: "2026-09-24T12:00:00.000Z",
  ...overrides,
});

const prepareInput = (overrides = {}) => ({
  sessionId: "practice:session:fixture",
  attempt: 2,
  reference: {},
  sourceMatch: {
    sourceId: "source:001",
  },
  baselinePlan: {},
  window: {},
  shotId: "shot:001",
  compStableId: "PRACTICE_COMP_FIXTURE",
  layerId: "PRACTICE_SHOT_FIXTURE_0001",
  startMs: 100,
  endMs: 900,
  referenceSemanticId: "reference-subject:hero",
  retainedSubjectIdentity: retainedIdentity(),
  ...overrides,
});

const proof = (maskSource, sourceSemanticId = "source-subject:hero") => ({
  verified: true,
  routeId: "fixture:" + maskSource,
  referenceSemanticId: "reference-subject:hero",
  sourceSemanticId,
  crossSourceIdentityVerified: true,
  maskSource,
  appliedOperations: 1,
  evidenceRefs: ["fixture-proof:" + maskSource],
});

test("Practice subject isolation prefers only retained proven mask sources", async () => {
  const calls = [];
  const router = new PracticeM6SubjectIsolationRouterV1([
    {
      id: "SAM31_TEMPORAL_MATTE",
      route: {
        async prepare() {
          calls.push("SAM31_TEMPORAL_MATTE");
          return proof("SEGMENTATION");
        },
      },
    },
    {
      id: "ROTO_BRUSH_TRACK_MATTE",
      route: {
        async prepare() {
          calls.push("ROTO_BRUSH_TRACK_MATTE");
          return proof("ROTO_BRUSH");
        },
      },
    },
    {
      id: "AE_TRACKED_MASK",
      route: {
        async prepare() {
          calls.push("AE_TRACKED_MASK");
          return proof("AE_TRACKED_MASK");
        },
      },
    },
  ]);

  const result = await router.prepare(prepareInput());

  assert.deepEqual(calls, ["ROTO_BRUSH_TRACK_MATTE"]);
  assert.equal(result.maskSource, "ROTO_BRUSH");
  assert.equal(result.sourceSemanticId, "source-subject:hero");
  assert.ok(result.evidenceRefs.includes(
    "practice-subject-isolation-retained-memory:practice-subject-memory:fixture",
  ));
  assert.ok(result.evidenceRefs.includes(
    "practice-subject-isolation-retained-provenance-honored:true",
  ));
  assert.ok(result.evidenceRefs.includes(
    "practice-subject-isolation-retained-route:ROTO_BRUSH_TRACK_MATTE",
  ));
});

test("Practice subject isolation fails closed when retained mask source is unavailable", async () => {
  let called = false;
  const router = new PracticeM6SubjectIsolationRouterV1([
    {
      id: "SAM31_TEMPORAL_MATTE",
      route: {
        async prepare() {
          called = true;
          return proof("SEGMENTATION");
        },
      },
    },
  ]);

  await assert.rejects(
    () => router.prepare(prepareInput()),
    /PRACTICE_SUBJECT_ISOLATION_RETAINED_SOURCE_UNAVAILABLE:ROTO_BRUSH/,
  );
  assert.equal(called, false);
});

test("Practice subject isolation rejects retained semantic identity drift", async () => {
  const router = new PracticeM6SubjectIsolationRouterV1([
    {
      id: "ROTO_BRUSH_TRACK_MATTE",
      route: {
        async prepare() {
          return proof("ROTO_BRUSH", "source-subject:different-person");
        },
      },
    },
  ]);

  await assert.rejects(
    () => router.prepare(prepareInput()),
    /PRACTICE_SUBJECT_ISOLATION_RETAINED_BACKENDS_REJECTED:ROTO_BRUSH_TRACK_MATTE:.*PRACTICE_SUBJECT_ISOLATION_RETAINED_SEMANTIC_MISMATCH/,
  );
});

test("Practice subject isolation rejects backend mask-source misreporting", async () => {
  const router = new PracticeM6SubjectIsolationRouterV1([
    {
      id: "ROTO_BRUSH_TRACK_MATTE",
      route: {
        async prepare() {
          return proof("AE_TRACKED_MASK");
        },
      },
    },
  ]);

  await assert.rejects(
    () => router.prepare(prepareInput()),
    /PRACTICE_SUBJECT_ISOLATION_BACKEND_SOURCE_MISMATCH/,
  );
});

test("Practice subject isolation keeps discovery fallback when no retained identity exists", async () => {
  const calls = [];
  const router = new PracticeM6SubjectIsolationRouterV1([
    {
      id: "SAM31_TEMPORAL_MATTE",
      route: {
        async prepare() {
          calls.push("SAM31_TEMPORAL_MATTE");
          throw new Error("SEGMENTATION_NOT_AVAILABLE");
        },
      },
    },
    {
      id: "AE_TRACKED_MASK",
      route: {
        async prepare() {
          calls.push("AE_TRACKED_MASK");
          return proof("AE_TRACKED_MASK");
        },
      },
    },
  ]);

  const input = prepareInput();
  delete input.retainedSubjectIdentity;
  const result = await router.prepare(input);

  assert.deepEqual(calls, ["SAM31_TEMPORAL_MATTE", "AE_TRACKED_MASK"]);
  assert.equal(result.maskSource, "AE_TRACKED_MASK");
  assert.ok(result.evidenceRefs.includes(
    "practice-subject-isolation-fallback-after:SAM31_TEMPORAL_MATTE",
  ));
  assert.equal(result.evidenceRefs.some((item) =>
    item === "practice-subject-isolation-retained-provenance-honored:true"), false);
});
