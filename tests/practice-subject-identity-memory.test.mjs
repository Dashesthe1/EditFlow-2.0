import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildPracticeSubjectIdentityMemoriesV1,
  selectReusablePracticeSubjectIdentityMemoryV1,
  practiceSourceSetFingerprintV1,
} from "../.tmp/runtime/packages/practice-homework/src/index.js";
import {
  PracticeM6LocalMediaAnalyzerV1,
} from "../.tmp/runtime/apps/desktop-host/src/practice-m6-media.js";

const referenceSha = "ref-0123456789abcdef";
const sourceSha = "src-0123456789abcdef";

const match = {
  shotId: "shot:001",
  sourceId: "raw:movie",
  sourcePath: "C:\\Raw\\movie.mp4",
  sourceStartMs: 1000,
  sourceEndMs: 1500,
  direction: "FORWARD",
  playbackRate: 1,
  appearanceSimilarity: 0.99,
  temporalSimilarity: 0.99,
  motionSimilarity: 0.99,
  confidence: 0.99,
  evidenceRefs: ["source-video:sha256:" + sourceSha],
};

const sourceFingerprint = practiceSourceSetFingerprintV1([match]);

const binding = {
  referenceWindowId: "effect-window:001",
  shotId: "shot:001",
  sourceId: "raw:movie",
  referenceTimeMs: 1100,
  sourceTimeMs: 2100,
  referenceSemanticId: "subject:primary:v1",
  sourceSemanticId: "practice-source-subject:raw:movie:verified",
  referenceSubjectBox: [0.2, 0.1, 0.4, 0.7],
  sourceSubjectBox: [0.24, 0.17, 0.43, 0.71],
  confidence: 0.94,
  verified: true,
  reason: null,
  algorithmId: "editflow.practice-cross-source-subject-bind.orb-homography.v1",
  sourceVideo: {
    fps: 30,
    frameCount: 300,
    width: 1920,
    height: 1080,
    durationMs: 10000,
    sampleTimeMs: 2100,
  },
  evidenceRefs: ["proof:finish-to-start-binding"],
};

const proof = {
  schema: "editflow.practice-mastery-proof.v1",
  sessionId: "practice:subject-memory:001",
  editTypeId: "impact-edit",
  referenceId: "finish:1",
  sourceIndexId: "source-index:1",
  referenceFingerprint: referenceSha,
  sourceFingerprint,
  sourceMediaSha256: [sourceSha],
  finalRenderRef: "C:\\renders\\final.mp4",
  minimumSimilarity: 0.95,
  exactSceneConfidence: 0.95,
  effectFamilyIds: ["MOTION_WARP"],
  crossSourceSubjectProof: {
    schema: "editflow.practice-cross-source-subject-proof.v1",
    required: true,
    referenceWindowCount: 1,
    requiredBindingCount: 1,
    verifiedBindingCount: 1,
    verifiedWindowCount: 1,
    verified: true,
    bindings: [binding],
    reasons: [],
    evidenceRefs: ["proof:finish-to-start-binding"],
  },
  report: {
    schema: "editflow.practice-similarity.v1",
    breakdown: {},
    definingEffectCoverage: 1,
    wrongSceneCount: 0,
    unmatchedSceneCount: 0,
    overallSimilarity: 0.99,
    passed: true,
    reasons: [],
    evidenceRefs: ["comparison:passed"],
  },
  matches: [match],
  audioMatch: null,
  evidenceRefs: ["proof:mastery"],
  verifiedAt: "2026-09-23T23:10:00.000Z",
};

const masteredAttempt = {
  attempt: 2,
  renderRef: proof.finalRenderRef,
  decisionTraces: [],
  evidenceRefs: [
    "practice-subject-mask-source:SEGMENTATION",
    "practice-subject-cross-source-identity:true",
    "practice-subject-isolation-transaction:tx:COMMITTED",
  ],
};

const knowledgeWith = (memory) => ({
  editTypeId: "impact-edit",
  title: "Impact Edit",
  revision: 4,
  maturityStage: "REFERENCE_VERIFIED",
  knowledgeScope: "ALL_RETAINED",
  masteredSessionCount: 1,
  referenceVerifiedPracticeSessionCount: 1,
  transferVerifiedPracticeSessionCount: 0,
  totalSessionCount: 1,
  successfulConstructionIds: [],
  failedConstructionIds: [],
  successfulSemanticPatches: [],
  failedSemanticPatches: [],
  behaviorEvidence: [],
  gptLearning: {
    practiceSessionIds: [proof.sessionId],
    proCreationSessionIds: [],
    masteredPracticeSessionIds: [proof.sessionId],
    masteryRecords: [{
      sessionId: proof.sessionId,
      scope: "REFERENCE_VERIFIED",
      proofRef: "proof.json",
      referenceId: proof.referenceId,
      sourceIndexId: proof.sourceIndexId,
      referenceFingerprint: referenceSha,
      sourceFingerprint,
      sourceMediaSha256: [sourceSha],
      finalRenderRef: proof.finalRenderRef,
      overallSimilarity: 0.99,
      definingEffectCoverage: 1,
      effectFamilyIds: ["MOTION_WARP"],
      subjectIdentityMemories: [memory],
      verifiedAt: proof.verifiedAt,
    }],
    heldOutCases: [],
    heldOutBenchmarks: [],
    eventCount: 0,
    successLessons: [],
    failureAvoidanceLessons: [],
    developmentPatterns: [],
    capabilityGaps: [],
    learnedSkills: [],
  },
});

test("mastered Practice retains only machine-proven cross-source subject identity", () => {
  const memories = buildPracticeSubjectIdentityMemoriesV1({
    sessionId: proof.sessionId,
    proof,
    attempt: masteredAttempt,
  });
  assert.equal(memories.length, 1);
  assert.equal(memories[0].sourceVideoSha256, sourceSha);
  assert.equal(memories[0].referenceSemanticId, "subject:primary:v1");
  assert.equal(
    memories[0].sourceSemanticId,
    "practice-source-subject:raw:movie:verified",
  );
  assert.deepEqual(memories[0].maskSources, ["SEGMENTATION"]);
  assert.ok(memories[0].evidenceRefs.includes(
    "practice-subject-isolation-transaction:tx:COMMITTED",
  ));

  const unproven = buildPracticeSubjectIdentityMemoriesV1({
    sessionId: proof.sessionId,
    proof,
    attempt: { ...masteredAttempt, evidenceRefs: [] },
  });
  assert.deepEqual(unproven, []);
});

test("subject identity memory is reusable only for the exact retained media binding", () => {
  const [memory] = buildPracticeSubjectIdentityMemoriesV1({
    sessionId: proof.sessionId,
    proof,
    attempt: masteredAttempt,
  });
  assert.ok(memory);

  const currentReference = {
    referenceId: "finish:current",
    shots: [],
    styleFingerprint: "style:1",
    evidenceRefs: ["video:sha256:" + referenceSha],
  };
  const selected = selectReusablePracticeSubjectIdentityMemoryV1({
    knowledge: knowledgeWith(memory),
    reference: currentReference,
    matches: [match],
    referenceWindowId: binding.referenceWindowId,
    shotId: binding.shotId,
    sourceMatch: match,
    referenceSemanticId: binding.referenceSemanticId,
  });
  assert.equal(selected?.memoryId, memory.memoryId);

  const changedReference = selectReusablePracticeSubjectIdentityMemoryV1({
    knowledge: knowledgeWith(memory),
    reference: {
      ...currentReference,
      evidenceRefs: ["video:sha256:different-reference-012345"],
    },
    matches: [match],
    referenceWindowId: binding.referenceWindowId,
    shotId: binding.shotId,
    sourceMatch: match,
    referenceSemanticId: binding.referenceSemanticId,
  });
  assert.equal(changedReference, null);

  const changedSource = {
    ...match,
    evidenceRefs: ["source-video:sha256:different-source-012345"],
  };
  const selectedChangedSource = selectReusablePracticeSubjectIdentityMemoryV1({
    knowledge: knowledgeWith(memory),
    reference: currentReference,
    matches: [changedSource],
    referenceWindowId: binding.referenceWindowId,
    shotId: binding.shotId,
    sourceMatch: changedSource,
    referenceSemanticId: binding.referenceSemanticId,
  });
  assert.equal(selectedChangedSource, null);
});

test("local media binder reuses exact retained subject proof without rediscovery", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-subject-memory-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const referencePath = path.join(root, "finish.mp4");
  const sourcePath = path.join(root, "raw.mp4");
  await writeFile(referencePath, "finish");
  await writeFile(sourcePath, "raw");
  const [memory] = buildPracticeSubjectIdentityMemoriesV1({
    sessionId: proof.sessionId,
    proof,
    attempt: masteredAttempt,
  });
  assert.ok(memory);
  const analyzer = new PracticeM6LocalMediaAnalyzerV1({
    repositoryRoot: root,
    artifactDir: path.join(root, "artifacts"),
  });
  const result = await analyzer.bindCrossSourceSubject({
    referenceVideoPath: referencePath,
    sourceVideoPath: sourcePath,
    referenceTimeMs: binding.referenceTimeMs,
    sourceTimeMs: binding.sourceTimeMs,
    referenceSubjectBox: binding.referenceSubjectBox,
    referenceSemanticId: binding.referenceSemanticId,
    sourceId: binding.sourceId,
    shotId: binding.shotId,
    retainedSubjectIdentity: memory,
  });
  assert.equal(result.verified, true);
  assert.equal(result.sourceSemanticId, binding.sourceSemanticId);
  assert.deepEqual(result.sourceSubjectBox, binding.sourceSubjectBox);
  assert.ok(result.evidenceRefs.some((ref) =>
    ref === "practice-subject-memory-reuse:" + memory.memoryId));
  assert.ok(result.evidenceRefs.some((ref) =>
    ref === "practice-subject-memory-origin-session:" + proof.sessionId));
});
