import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  fingerprintPracticeHeldOutMaterialV1,
  resolvePracticeRunRoleV1,
  validatePracticeHeldOutMaterialNoveltyV1,
} from "../.tmp/runtime/apps/desktop-host/src/practice-panel-server.js";

test("Practice AUTO lifecycle learns before transfer verification", () => {
  assert.equal(resolvePracticeRunRoleV1(null, false), "LEARNING");
});

test("Practice AUTO lifecycle certifies after transfer verification", () => {
  assert.equal(
    resolvePracticeRunRoleV1(null, true),
    "HELD_OUT_CERTIFICATION",
  );
});

test("explicit Practice lifecycle overrides remain deliberate", () => {
  assert.equal(resolvePracticeRunRoleV1("LEARNING", true), "LEARNING");
  assert.equal(
    resolvePracticeRunRoleV1("HELD_OUT_CERTIFICATION", false),
    "HELD_OUT_CERTIFICATION",
  );
});

test("held-out preflight fingerprints exact media bytes and detects duplicate Start content", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-held-out-preflight-"));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  const finishPath = path.join(root, "finish.mp4");
  const sourceA = path.join(root, "source-a.mp4");
  const sourceACopy = path.join(root, "source-a-copy.mp4");
  await writeFile(finishPath, "finish-bytes", "utf8");
  await writeFile(sourceA, "source-bytes", "utf8");
  await writeFile(sourceACopy, "source-bytes", "utf8");

  const fingerprint = await fingerprintPracticeHeldOutMaterialV1({
    finishPath,
    videoPaths: [sourceA, sourceACopy],
  });
  const finishSha = createHash("sha256").update("finish-bytes", "utf8").digest("hex");
  const sourceSha = createHash("sha256").update("source-bytes", "utf8").digest("hex");
  const sourceSetFingerprint = createHash("sha256")
    .update("source-video:sha256:" + sourceSha, "utf8")
    .digest("hex");

  assert.equal(fingerprint.referenceFingerprint, finishSha);
  assert.deepEqual(fingerprint.sourceMediaSha256, [sourceSha]);
  assert.equal(fingerprint.sourceFingerprint, sourceSetFingerprint);
  assert.equal(fingerprint.duplicateStartMedia, true);
});

test("held-out preflight rejects any Start media reused from training", () => {
  const reasons = validatePracticeHeldOutMaterialNoveltyV1({
    material: {
      referenceFingerprint: "finish:new",
      sourceFingerprint: "aggregate:new-plus-extra",
      sourceMediaSha256: ["source:trained", "source:extra"],
      duplicateStartMedia: false,
    },
    masteryRecords: [{
      sessionId: "practice:training",
      scope: "TRANSFER_VERIFIED",
      proofRef: "proof:training",
      referenceId: "finish:training",
      sourceIndexId: "source-index:training",
      referenceFingerprint: "finish:training",
      sourceFingerprint: "aggregate:training-only",
      sourceMediaSha256: ["source:trained"],
      finalRenderRef: "render:training",
      overallSimilarity: 0.99,
      definingEffectCoverage: 1,
      effectFamilyIds: ["SHUTTER_TRAIL"],
      verifiedAt: "2026-09-23T00:00:00.000Z",
    }],
    heldOutCases: [],
  });
  assert.deepEqual(reasons, [
    "Start source reuses retained Practice training media.",
  ]);
});

test("held-out preflight rejects prior certification media and duplicate Start bytes", () => {
  const reasons = validatePracticeHeldOutMaterialNoveltyV1({
    material: {
      referenceFingerprint: "finish:held-out-old",
      sourceFingerprint: "aggregate:new",
      sourceMediaSha256: ["source:new"],
      duplicateStartMedia: true,
    },
    masteryRecords: [],
    heldOutCases: [{
      caseId: "held-out:old",
      sessionId: "practice:held-out:old",
      referenceFingerprint: "finish:held-out-old",
      sourceFingerprint: "aggregate:old",
      sourceMediaSha256: ["source:old"],
      effectFamilyIds: ["ZOOM_IMPACT"],
      objectAwareVerified: true,
      overallSimilarity: 0.99,
      definingEffectCoverage: 1,
      passed: true,
      reasons: [],
      evidenceRefs: ["proof:old"],
    }],
  });
  assert.deepEqual(reasons, [
    "Held-out Start inputs contain duplicate media bytes.",
    "Finish reference reuses prior held-out certification media.",
  ]);
});

test("held-out preflight accepts genuinely unseen material", () => {
  const reasons = validatePracticeHeldOutMaterialNoveltyV1({
    material: {
      referenceFingerprint: "finish:new",
      sourceFingerprint: "aggregate:new",
      sourceMediaSha256: ["source:new"],
      duplicateStartMedia: false,
    },
    masteryRecords: [{
      sessionId: "practice:training",
      scope: "TRANSFER_VERIFIED",
      proofRef: "proof:training",
      referenceId: "finish:training",
      sourceIndexId: "source-index:training",
      referenceFingerprint: "finish:training",
      sourceFingerprint: "aggregate:training",
      sourceMediaSha256: ["source:training"],
      finalRenderRef: "render:training",
      overallSimilarity: 0.99,
      definingEffectCoverage: 1,
      effectFamilyIds: ["SHUTTER_TRAIL"],
      verifiedAt: "2026-09-23T00:00:00.000Z",
    }],
    heldOutCases: [],
  });
  assert.deepEqual(reasons, []);
});
