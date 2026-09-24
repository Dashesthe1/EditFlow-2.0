import assert from "node:assert/strict";
import test from "node:test";

import {
  PracticeM6SubjectIsolationRouterV1,
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
