import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import {
  EditTypeRegistryFileV1,
  EditTypeRegistryV1,
} from "../.tmp/runtime/packages/practice-homework/src/index.js";
import {
  evaluatePracticeRetainedTruthSuiteManifestV1,
} from "../.tmp/runtime/apps/desktop-host/src/index.js";

const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");

test("retained truth manifest verifies media bytes and survives registry restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-truth-manifest-"));
  try {
    const finishPath = path.join(root, "finish.bin");
    const sourcePath = path.join(root, "source.bin");
    const manifestPath = path.join(root, "suite.json");
    const registryPath = path.join(root, "edit-types.json");
    const finishBytes = Buffer.from("finish-media-01");
    const sourceBytes = Buffer.from("source-media-01");
    await writeFile(finishPath, finishBytes);
    await writeFile(sourcePath, sourceBytes);
    const finishSha256 = sha256(finishBytes);
    const sourceSha256 = sha256(sourceBytes);
    const manifest = {
      schema: "editflow.practice-retained-truth-suite-manifest.v1",
      editTypeId: "manifest-edit",
      mode: "MEASURE_ONLY",
      cases: [{
        finishPath: "finish.bin",
        sourceMedia: [{
          path: "source.bin",
          sha256: sourceSha256,
        }],
        truth: {
          caseId: "manifest-case-01",
          referenceId: "finish:manifest:01",
          finishSha256,
          referenceDurationMs: 1000,
          sourceMediaSha256: [sourceSha256],
          truthAuthority: "INDEPENDENT_VERIFIER",
          difficultyTags: ["FAST_CUTS"],
          shots: [{
            shotId: "shot:01",
            order: 0,
            referenceStartMs: 0,
            referenceEndMs: 1000,
            expectedSourceId: "source:01",
            expectedSourceStartMs: 5000,
            expectedSourceEndMs: 6000,
            expectedDirection: "FORWARD",
            truthEvidenceRefs: ["truth:manifest:shot:01"],
          }],
          evidenceRefs: ["truth:manifest:case:01"],
        },
        observation: {
          caseId: "manifest-case-01",
          matches: [{
            shotId: "shot:01",
            sourceId: "source:01",
            sourceStartMs: 5000,
            sourceEndMs: 6000,
            direction: "FORWARD",
            playbackRate: 1,
            appearanceSimilarity: 0.99,
            temporalSimilarity: 0.99,
            motionSimilarity: 0.98,
            confidence: 0.96,
            candidateMargin: 0.2,
            evidenceRefs: ["machine:manifest:shot:01"],
          }],
          evidenceRefs: ["machine:manifest:case:01"],
        },
      }],
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    const report = await evaluatePracticeRetainedTruthSuiteManifestV1(manifestPath);
    assert.equal(report.caseCount, 1);
    assert.equal(report.passedCaseCount, 1);
    assert.equal(report.sceneErrorCount, 0);
    assert.equal(report.certified, false);
    assert.ok(report.evidenceRefs.includes(
      "retained-finish-sha256:" + finishSha256,
    ));
    assert.ok(report.evidenceRefs.includes(
      "retained-source-sha256:" + sourceSha256,
    ));

    const registry = new EditTypeRegistryV1();
    registry.create({ editTypeId: "manifest-edit", title: "Manifest Edit" });
    registry.recordRetainedTruthSuite(report);
    const file = new EditTypeRegistryFileV1(registryPath);
    await file.save(registry);
    const restored = await file.load();
    const knowledge = restored.knowledge("manifest-edit");
    assert.ok(knowledge);
    assert.equal(knowledge.gptLearning.retainedTruthSuiteReports.length, 1);
    assert.equal(
      knowledge.gptLearning.retainedTruthSuiteReports[0].caseCount,
      1,
    );

    await writeFile(finishPath, Buffer.from("tampered-finish-media"));
    await assert.rejects(
      () => evaluatePracticeRetainedTruthSuiteManifestV1(manifestPath),
      /PRACTICE_TRUTH_FINISH_SHA256_MISMATCH/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
