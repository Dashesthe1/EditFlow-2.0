import assert from "node:assert/strict";
import test from "node:test";

import {
  PracticeM6SubjectIsolationRouterV1,
  PracticeSubjectIsolationBackendFailureV1,
  createPracticeM6SubjectIsolationRouterV1,
} from "../.tmp/runtime/apps/desktop-host/src/practice-m6-subject-isolation-router.js";

const proof = (routeId, maskSource = "SEGMENTATION") => ({
  verified: true,
  routeId,
  referenceSemanticId: "subject:reference",
  sourceSemanticId: "subject:source",
  crossSourceIdentityVerified: true,
  maskSource,
  appliedOperations: 5,
  evidenceRefs: ["proof:" + routeId],
});

test("Practice isolation router keeps the verified primary backend when it succeeds", async () => {
  let fallbackCalls = 0;
  const router = new PracticeM6SubjectIsolationRouterV1([
    {
      id: "SAM31_TEMPORAL_MATTE",
      route: { async prepare() { return proof("sam31"); } },
    },
    {
      id: "ROTO_BRUSH_TRACK_MATTE",
      route: {
        async prepare() {
          fallbackCalls += 1;
          return proof("roto", "ROTO_BRUSH");
        },
      },
    },
  ]);
  const result = await router.prepare({});
  assert.equal(result.routeId, "sam31");
  assert.equal(fallbackCalls, 0);
  assert.ok(result.evidenceRefs.includes(
    "practice-subject-isolation-backend:SAM31_TEMPORAL_MATTE",
  ));
  assert.equal(
    result.evidenceRefs.some((item) =>
      item.startsWith("practice-subject-isolation-fallback-after:")),
    false,
  );
});

test("Practice isolation router falls back only after the primary backend rejects", async () => {
  const router = createPracticeM6SubjectIsolationRouterV1([
    {
      id: "SAM31_TEMPORAL_MATTE",
      route: { async prepare() { throw new Error("SAM_REJECTED"); } },
    },
    {
      id: "ROTO_BRUSH_TRACK_MATTE",
      route: { async prepare() { return proof("roto", "ROTO_BRUSH"); } },
    },
  ]);
  assert.ok(router);
  const result = await router.prepare({});
  assert.equal(result.routeId, "roto");
  assert.equal(result.maskSource, "ROTO_BRUSH");
  assert.ok(result.evidenceRefs.includes(
    "practice-subject-isolation-backend:ROTO_BRUSH_TRACK_MATTE",
  ));
  assert.ok(result.evidenceRefs.includes(
    "practice-subject-isolation-fallback-after:SAM31_TEMPORAL_MATTE",
  ));
  assert.ok(result.evidenceRefs.includes(
    "practice-subject-isolation-rejected-backend:SAM31_TEMPORAL_MATTE",
  ));
  assert.ok(result.evidenceRefs.includes(
    "practice-subject-isolation-rejection-code:SAM31_TEMPORAL_MATTE:SAM_REJECTED",
  ));
});

test("Practice isolation router fails closed when every retained backend rejects", async () => {
  const router = new PracticeM6SubjectIsolationRouterV1([
    { id: "SAM31", route: { async prepare() { throw new Error("SAM"); } } },
    { id: "ROTO", route: { async prepare() { throw new Error("ROTO"); } } },
  ]);
  await assert.rejects(
    () => router.prepare({}),
    /PRACTICE_SUBJECT_ISOLATION_ALL_BACKENDS_REJECTED:SAM31,ROTO/,
  );
});

test("Practice isolation router reaches native tracked-mask only after SAM and Roto reject", async () => {
  const calls = [];
  const router = new PracticeM6SubjectIsolationRouterV1([
    {
      id: "SAM31_TEMPORAL_MATTE",
      route: { async prepare() { calls.push("sam"); throw new Error("SAM"); } },
    },
    {
      id: "ROTO_BRUSH_TRACK_MATTE",
      route: { async prepare() { calls.push("roto"); throw new Error("ROTO"); } },
    },
    {
      id: "AE_TRACKED_MASK",
      route: {
        async prepare() {
          calls.push("tracked");
          return proof("tracked", "AE_TRACKED_MASK");
        },
      },
    },
  ]);
  const result = await router.prepare({});
  assert.deepEqual(calls, ["sam", "roto", "tracked"]);
  assert.equal(result.maskSource, "AE_TRACKED_MASK");
  assert.ok(result.evidenceRefs.includes(
    "practice-subject-isolation-fallback-after:SAM31_TEMPORAL_MATTE",
  ));
  assert.ok(result.evidenceRefs.includes(
    "practice-subject-isolation-fallback-after:ROTO_BRUSH_TRACK_MATTE",
  ));
  assert.ok(result.evidenceRefs.includes(
    "practice-subject-isolation-backend:AE_TRACKED_MASK",
  ));
});

test("Practice isolation router carries verified cleanup undo entries into the succeeding backend", async () => {
  const router = new PracticeM6SubjectIsolationRouterV1([
    {
      id: "ROTO_BRUSH_TRACK_MATTE",
      route: {
        async prepare() {
          throw new PracticeSubjectIsolationBackendFailureV1(
            "ROTO_REJECTED_AFTER_CLEANUP",
            3,
            ["roto:cleanup:verified"],
            true,
          );
        },
      },
    },
    {
      id: "AE_TRACKED_MASK",
      route: {
        async prepare() {
          return proof("tracked", "AE_TRACKED_MASK");
        },
      },
    },
  ]);

  const result = await router.prepare({});
  assert.equal(result.appliedOperations, 8);
  assert.ok(result.evidenceRefs.includes("roto:cleanup:verified"));
  assert.ok(result.evidenceRefs.includes(
    "practice-subject-isolation-failed-backend-undo-entries:ROTO_BRUSH_TRACK_MATTE:3",
  ));
  assert.ok(result.evidenceRefs.includes(
    "practice-subject-isolation-carried-undo-entries:3",
  ));
});

test("Practice isolation router stops before another backend after unsafe cleanup failure", async () => {
  let fallbackCalls = 0;
  const router = new PracticeM6SubjectIsolationRouterV1([
    {
      id: "ROTO_BRUSH_TRACK_MATTE",
      route: {
        async prepare() {
          throw new PracticeSubjectIsolationBackendFailureV1(
            "ROTO_CLEANUP_FAILED",
            2,
            ["roto:cleanup:failed"],
            false,
          );
        },
      },
    },
    {
      id: "AE_TRACKED_MASK",
      route: {
        async prepare() {
          fallbackCalls += 1;
          return proof("tracked", "AE_TRACKED_MASK");
        },
      },
    },
  ]);

  await assert.rejects(
    () => router.prepare({}),
    /PRACTICE_SUBJECT_ISOLATION_UNSAFE_BACKEND_FAILURE:ROTO_BRUSH_TRACK_MATTE/,
  );
  assert.equal(fallbackCalls, 0);
});
