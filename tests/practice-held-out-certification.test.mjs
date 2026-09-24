import assert from "node:assert/strict";
import test from "node:test";

import {
  EditTypeRegistryV1,
  PracticeHomeworkEngineV1,
} from "../.tmp/runtime/packages/practice-homework/src/index.js";
import {
  recordPracticeHeldOutCertificationV1,
} from "../.tmp/runtime/apps/desktop-host/src/practice-held-out-certification.js";

const report = {
  schema: "editflow.practice-similarity.v1",
  breakdown: {
    sceneIdentity: 0.98,
    temporalAlignment: 0.98,
    cutTiming: 0.98,
    framing: 0.98,
    motion: 0.98,
    effectFidelity: 0.98,
    transitionFidelity: 0.98,
    colorFinish: 0.98,
    pixelStructure: 0.98,
  },
  definingEffectCoverage: 1,
  wrongSceneCount: 0,
  unmatchedSceneCount: 0,
  overallSimilarity: 0.98,
  passed: true,
  reasons: [],
  evidenceRefs: ["comparison:held-out"],
};

const masteryRecord = (sessionId) => ({
  sessionId,
  scope: "TRANSFER_VERIFIED",
  proofRef: "proof:training",
  referenceId: "finish:training",
  sourceIndexId: "source-index:training",
  referenceFingerprint: "reference:training",
  sourceFingerprint: "source:training",
  finalRenderRef: "render:training",
  overallSimilarity: 0.98,
  definingEffectCoverage: 1,
  effectFamilyIds: ["SHUTTER_FRAGMENTATION"],
  verifiedAt: "2026-09-23T12:00:00.000Z",
});
const proof = (sessionId, editTypeId) => ({
  schema: "editflow.practice-mastery-proof.v1",
  sessionId,
  editTypeId,
  referenceId: "finish:held-out",
  sourceIndexId: "source-index:held-out",
  referenceFingerprint: "reference:held-out",
  sourceFingerprint: "source:held-out",
  finalRenderRef: "render:held-out",
  minimumSimilarity: 0.95,
  exactSceneConfidence: 0.95,
  effectFamilyIds: ["MOTION_WARP"],
  report,
  matches: [],
  audioMatch: null,
  evidenceRefs: ["proof:held-out:machine"],
  verifiedAt: "2026-09-23T13:00:00.000Z",
});

const transferVerifiedRegistry = (editTypeId) => {
  const registry = new EditTypeRegistryV1();
  registry.create({ editTypeId, title: "Held Out Test" });
  const trainingSession = "practice:training:transfer";
  registry.beginGptLearningSession(editTypeId, trainingSession, "PRACTICE");
  registry.completeGptLearningSession({
    editTypeId,
    sessionId: trainingSession,
    mode: "PRACTICE",
    mastered: true,
    masteryRecord: masteryRecord(trainingSession),
  });
  return registry;
};

test("shared held-out recorder retains machine proof and benchmark evidence", () => {
  const editTypeId = "held-out-live";
  const sessionId = "practice:held-out:001";
  const registry = transferVerifiedRegistry(editTypeId);
  const recorded = recordPracticeHeldOutCertificationV1({
    registry,
    editTypeId,
    sessionId,
    proof: proof(sessionId, editTypeId),
    proofRef: "proof:held-out:bundle",
  });
  assert.equal(recorded.heldOutCase.passed, true);
  assert.equal(recorded.benchmark.caseCount, 1);
  assert.equal(recorded.benchmark.passedCaseCount, 1);
  assert.equal(recorded.benchmark.robust, false);
  assert.ok(recorded.benchmark.reasons.some((reason) => /fewer than 20 cases/.test(reason)));
  const retained = registry.knowledge(editTypeId);
  assert.equal(retained.gptLearning.heldOutCases.length, 1);
  assert.equal(retained.gptLearning.heldOutBenchmarks.length, 1);
});

test("shared held-out recorder rejects unverified or mismatched certification", () => {
  const editTypeId = "held-out-blocked";
  const sessionId = "practice:held-out:blocked";
  const unverified = new EditTypeRegistryV1();
  unverified.create({ editTypeId, title: "Blocked" });
  assert.throws(
    () => recordPracticeHeldOutCertificationV1({
      registry: unverified,
      editTypeId,
      sessionId,
      proof: proof(sessionId, editTypeId),
      proofRef: "proof:blocked",
    }),
    /TRANSFER_VERIFIED/,
  );

  const registry = transferVerifiedRegistry(editTypeId);
  assert.throws(
    () => recordPracticeHeldOutCertificationV1({
      registry,
      editTypeId,
      sessionId,
      proof: proof("practice:wrong-session", editTypeId),
      proofRef: "proof:wrong-session",
    }),
    /proof session/,
  );
});

test("held-out certification rejects training and repeated material fingerprints", () => {
  const editTypeId = "held-out-novelty";
  const registry = transferVerifiedRegistry(editTypeId);
  const overlapSession = "practice:held-out:training-overlap";
  assert.throws(
    () => recordPracticeHeldOutCertificationV1({
      registry,
      editTypeId,
      sessionId: overlapSession,
      proof: {
        ...proof(overlapSession, editTypeId),
        referenceFingerprint: "reference:training",
      },
      proofRef: "proof:training-overlap",
    }),
    /overlaps retained Practice training material/,
  );

  const firstSession = "practice:held-out:novel-001";
  recordPracticeHeldOutCertificationV1({
    registry,
    editTypeId,
    sessionId: firstSession,
    proof: proof(firstSession, editTypeId),
    proofRef: "proof:novel-001",
  });

  const repeatedSession = "practice:held-out:novel-002";
  assert.throws(
    () => recordPracticeHeldOutCertificationV1({
      registry,
      editTypeId,
      sessionId: repeatedSession,
      proof: proof(repeatedSession, editTypeId),
      proofRef: "proof:novel-002",
    }),
    /novel reference and source fingerprints/,
  );
});
