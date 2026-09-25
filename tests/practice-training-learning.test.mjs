import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EditTypeRegistryV1,
  GptOrchestrationStoreV1,
  PracticeM6ExecutionBridgeV1,
  ProCreationPreparationEngineV1,
  buildPracticeHeldOutBenchmarkCaseV1,
  buildPracticeMasteryRecordV1,
  classifyPracticeMasteryScopeV1,
  comparePracticeObjectAwareWindowsV1,
  composePracticeM6ExecutionAdaptersV1,
  evaluatePracticeHeldOutBenchmarkV1,
  evaluatePracticeRetainedTruthSuiteV1,
  resolvePracticeLocalMediaPathV1,
  summarizePracticeSubjectIdentityV1,
} from "../.tmp/runtime/packages/practice-homework/src/index.js";
import {
  buildConstructionGraphV1,
  classifyEffectFamilyV1,
  createCanonicalProfessionalBenchmarkV1,
  deriveEffectAnatomyV1,
} from "../.tmp/runtime/packages/visual-effects-intelligence/src/index.js";
import {
  PracticeM6AeRenderDriverCurrentV1,
  PracticeM6CurrentAeRuntimeV1,
  applyPracticeRobustRecertificationV1,
  buildPracticeCrossSourceSubjectProofV1,
  createPracticeM6CurrentAeAssemblyV1,
  createPracticeM6CurrentAeTrainingRuntimeV1,
  refreshPracticeHeldOutBenchmarkV1,
} from "../.tmp/runtime/apps/desktop-host/src/index.js";

const passedReport = (value = 0.98) => ({
  schema: "editflow.practice-similarity.v1",
  breakdown: {
    sceneIdentity: value,
    temporalAlignment: value,
    cutTiming: value,
    framing: value,
    motion: value,
    effectFidelity: value,
    transitionFidelity: value,
    colorFinish: value,
    pixelStructure: value,
  },
  definingEffectCoverage: 1,
  wrongSceneCount: 0,
  unmatchedSceneCount: 0,
  overallSimilarity: value,
  passed: true,
  reasons: [],
  evidenceRefs: ["test:report"],
});

const failedReport = () => ({
  ...passedReport(0.7),
  passed: false,
  definingEffectCoverage: 0.5,
});

const professionalBenchmarkEvidenceFor = (...families) =>
  createCanonicalProfessionalBenchmarkV1()
    .filter((item) => families.includes(item.family))
    .map((item) => ({
      caseId: item.caseId,
      achievedLevel: "PROFESSIONAL_FIDELITY_VERIFIED",
      maturityProof: {
        functionallyPresent: true,
        structuralCoverageComplete: true,
        visuallyRecognizable: true,
        referenceFaithful: true,
        transferVariantCount: 1,
        professionalCasePassCount: 2,
        robustnessAxesPassed: [],
      },
      referenceEvidenceRef: item.referenceEvidenceRef,
      directAbReferenceRef: "proof:a-b:" + item.caseId,
      comparisonEvidenceRef: "proof:comparison:" + item.caseId,
      transferEvidence: item.transferAxes.map((axis, index) => ({
        axis,
        passed: true,
        evidenceRef: "proof:transfer:" + item.caseId + ":" + axis,
        variantFingerprint: "variant:" + item.caseId + ":" + String(index + 1),
      })),
      degradedCaseRejected: true,
      degradedCaseEvidenceRef: "proof:degraded:" + item.caseId,
    }));

const retainedTruthCertificationReport = (editTypeId) => {
  const difficultyKinds = [
    "FAST_CUTS",
    "NEAR_DUPLICATE_SOURCES",
    "REVERSE_OR_REWIND",
    "IDENTITY_AMBIGUITY",
  ];
  const cases = Array.from({ length: 20 }, (_, index) => {
    const caseId = "truth:robust-gate:" + String(index + 1);
    const sourceId = "source:robust-gate:" + String(index + 1);
    const finishSha256 = (index + 1).toString(16).padStart(64, "0");
    const sourceSha256 = (1000 + index).toString(16).padStart(64, "0");
    return {
      truth: {
        caseId,
        referenceId: "finish:robust-gate:" + String(index + 1),
        finishSha256,
        referenceDurationMs: 1000,
        sourceMediaSha256: [sourceSha256],
        truthAuthority: "INDEPENDENT_VERIFIER",
        difficultyTags: [difficultyKinds[index % difficultyKinds.length]],
        shots: [{
          shotId: "shot:0001",
          order: 0,
          referenceStartMs: 0,
          referenceEndMs: 1000,
          expectedSourceId: sourceId,
          expectedSourceStartMs: 4000,
          expectedSourceEndMs: 5000,
          expectedDirection: "FORWARD",
          truthEvidenceRefs: ["truth:evidence:" + caseId],
        }],
        evidenceRefs: ["truth:case:" + caseId],
      },
      observation: {
        caseId,
        matches: [{
          shotId: "shot:0001",
          sourceId,
          sourceStartMs: 4000,
          sourceEndMs: 5000,
          direction: "FORWARD",
          playbackRate: 1,
          appearanceSimilarity: 0.98,
          temporalSimilarity: 0.98,
          motionSimilarity: 0.98,
          confidence: 0.98,
          candidateScore: 0.98,
          runnerUpScore: 0.72,
          candidateMargin: 0.26,
          evidenceRefs: ["machine:evidence:" + caseId],
        }],
        evidenceRefs: ["machine:case:" + caseId],
      },
    };
  });
  return evaluatePracticeRetainedTruthSuiteV1({
    editTypeId,
    mode: "CERTIFICATION",
    cases,
  });
};

const masteryRecord = (
  sessionId,
  scope = "TRANSFER_VERIFIED",
  referenceId = "finish:verified",
  sourceIndexId = "practice-source-set:verified",
) => ({
  sessionId,
  scope,
  proofRef: "proof:mastery:" + sessionId,
  referenceId,
  sourceIndexId,
  referenceFingerprint: "reference-fingerprint:" + referenceId,
  sourceFingerprint: "source-fingerprint:" + sourceIndexId,
  finalRenderRef: "render:mastered:" + sessionId,
  overallSimilarity: 0.98,
  definingEffectCoverage: 1,
  effectFamilyIds: ["SHUTTER_FRAGMENTATION"],
  verifiedAt: "2026-09-23T12:00:00.000Z",
});

const samplePatch = {
  patchId: "patch:1:distortion",
  invariantId: "inv:distortion",
  nodeId: "node:distortion",
  parameter: "distortionPeak",
  previousValue: 0.2,
  nextValue: 0.32,
  rationale: "Reference distortion was stronger.",
};

const episode = {
  sessionId: "practice:learning:001",
  selectedEditTypeId: "spider-man-high-potency",
  styleFingerprint: "style:high-potency",
  baselineId: "baseline:001",
  matches: [],
  audioMatch: null,
  attempts: [
    {
      attempt: 1,
      renderRef: "render:1",
      report: failedReport(),
      decisionTraces: [{
        decisionId: "decision:1",
        cueIds: ["effect-window:w1"],
        constructionIds: ["graph:failed"],
        rationaleCodes: ["M6_FAMILY_SHUTTER_FRAGMENTATION"],
        semanticPatches: [samplePatch],
      }],
      elapsedMs: 1200,
      evidenceRefs: ["attempt:1"],
    },
    {
      attempt: 2,
      renderRef: "render:2",
      report: passedReport(),
      decisionTraces: [{
        decisionId: "decision:2",
        cueIds: ["effect-window:w1"],
        constructionIds: ["graph:passed"],
        rationaleCodes: ["M6_FAMILY_SHUTTER_FRAGMENTATION"],
        semanticPatches: [{
          ...samplePatch,
          patchId: "patch:2:distortion",
          nextValue: 0.38,
        }],
      }],
      elapsedMs: 900,
      evidenceRefs: ["attempt:2"],
    },
  ],
  mastered: true,
  bestAttempt: null,
};
episode.bestAttempt = episode.attempts[1];

test("Edit Type allocation retains success, failure, efficiency, and semantic correction evidence", () => {
  const registry = new EditTypeRegistryV1();
  registry.create({
    editTypeId: "spider-man-high-potency",
    title: "Spider-Man High Potency",
    choiceWords: ["spidey potency"],
  });

  const profile = registry.allocateEpisode(episode, "spider-man-high-potency");
  assert.equal(profile.sessionIds.length, 1);
  assert.equal(profile.masteredSessionIds.length, 1);
  assert.equal(profile.behaviorEvidence.length, 2);

  const knowledge = registry.knowledge("spider-man-high-potency");
  assert.ok(knowledge);
  assert.deepEqual(knowledge.successfulConstructionIds, ["graph:passed"]);
  assert.deepEqual(knowledge.failedConstructionIds, ["graph:failed"]);
  assert.equal(knowledge.successfulSemanticPatches.length, 1);
  assert.equal(knowledge.failedSemanticPatches.length, 1);
  assert.equal(knowledge.behaviorEvidence[0].elapsedMs, 1200);
});
test("Practice transfer classification uses stable media fingerprints instead of session-local ids", () => {
  const prior = {
    ...masteryRecord(
      "practice:fingerprint:001",
      "REFERENCE_VERIFIED",
      "finish:id:one",
      "source-index:id:one",
    ),
    sourceMediaSha256: ["source-sha:one"],
  };
  const baseProof = {
    schema: "editflow.practice-mastery-proof.v1",
    sessionId: "practice:fingerprint:002",
    editTypeId: "proof-gated",
    referenceId: "finish:id:two",
    sourceIndexId: "source-index:id:two",
    referenceFingerprint: prior.referenceFingerprint,
    sourceFingerprint: prior.sourceFingerprint,
    sourceMediaSha256: ["source-sha:one"],
    finalRenderRef: "render:two",
    minimumSimilarity: 0.95,
    exactSceneConfidence: 0.95,
    effectFamilyIds: ["SHUTTER_FRAGMENTATION"],
    report: passedReport(),
    matches: [],
    audioMatch: null,
    evidenceRefs: ["proof:comparison"],
    verifiedAt: "2026-09-23T12:01:00.000Z",
  };

  assert.equal(
    classifyPracticeMasteryScopeV1([prior], baseProof),
    "REFERENCE_VERIFIED",
  );
  assert.equal(
    classifyPracticeMasteryScopeV1([prior], {
      ...baseProof,
      referenceFingerprint: "reference-fingerprint:different",
      sourceFingerprint: "source-fingerprint:different",
      sourceMediaSha256: ["source-sha:two"],
    }),
    "TRANSFER_VERIFIED",
  );
  assert.equal(
    classifyPracticeMasteryScopeV1([prior], {
      ...baseProof,
      sourceFingerprint: "source-fingerprint:different-only",
      sourceMediaSha256: ["source-sha:two"],
    }),
    "REFERENCE_VERIFIED",
  );
  assert.equal(
    classifyPracticeMasteryScopeV1([prior], {
      ...baseProof,
      referenceFingerprint: "reference-fingerprint:different",
      sourceFingerprint: "source-fingerprint:different-with-extra",
      sourceMediaSha256: ["source-sha:one", "source-sha:extra"],
    }),
    "REFERENCE_VERIFIED",
  );
  assert.equal(
    classifyPracticeMasteryScopeV1([prior], {
      ...baseProof,
      referenceFingerprint: "reference-fingerprint:different",
      sourceFingerprint: "source-fingerprint:different",
      sourceMediaSha256: undefined,
    }),
    "REFERENCE_VERIFIED",
  );
});

test("shared mastery record builder binds proof authority and transfer scope", () => {
  const prior = {
    ...masteryRecord(
      "practice:mastery-builder:001",
      "REFERENCE_VERIFIED",
      "finish:builder:one",
      "source-index:builder:one",
    ),
    sourceMediaSha256: ["source-sha:builder:one"],
  };
  const proof = {
    schema: "editflow.practice-mastery-proof.v1",
    sessionId: "practice:mastery-builder:002",
    editTypeId: "proof-gated",
    referenceId: "finish:builder:two",
    sourceIndexId: "source-index:builder:two",
    referenceFingerprint: "reference-fingerprint:builder:two",
    sourceFingerprint: "source-fingerprint:builder:two",
    sourceMediaSha256: ["source-sha:builder:two"],
    finalRenderRef: "render:builder:two",
    minimumSimilarity: 0.95,
    exactSceneConfidence: 0.95,
    effectFamilyIds: ["SHUTTER_FRAGMENTATION"],
    report: passedReport(),
    matches: [],
    audioMatch: null,
    evidenceRefs: ["proof:builder:comparison"],
    verifiedAt: "2026-09-23T12:02:00.000Z",
  };

  const record = buildPracticeMasteryRecordV1({
    sessionId: proof.sessionId,
    priorRecords: [prior],
    proof,
    proofRef: "proofs/practice/mastery-builder-002.json",
    attempt: null,
  });
  assert.equal(record.scope, "TRANSFER_VERIFIED");
  assert.equal(record.proofRef, "proofs/practice/mastery-builder-002.json");
  assert.deepEqual(record.sourceMediaSha256, ["source-sha:builder:two"]);
  assert.equal(record.finalRenderRef, proof.finalRenderRef);
  assert.equal(record.subjectIdentityMemories, undefined);

  assert.throws(() => buildPracticeMasteryRecordV1({
    sessionId: proof.sessionId,
    priorRecords: [prior],
    proof: { ...proof, report: failedReport() },
    proofRef: "proofs/practice/failed.json",
    attempt: null,
  }), /passing machine verification report/);
  assert.throws(() => buildPracticeMasteryRecordV1({
    sessionId: proof.sessionId,
    priorRecords: [prior],
    proof,
    proofRef: "   ",
    attempt: null,
  }), /retained proof reference/);
});

test("GPT Practice cannot promote itself to mastery without a machine proof record", () => {
  const registry = new EditTypeRegistryV1();
  registry.create({
    editTypeId: "proof-gated",
    title: "Proof Gated",
  });
  const sessionId = "practice:proof-gated:001";
  registry.beginGptLearningSession("proof-gated", sessionId, "PRACTICE");
  assert.throws(
    () => registry.completeGptLearningSession({
      editTypeId: "proof-gated",
      sessionId,
      mode: "PRACTICE",
      mastered: true,
    }),
    /machine-verified mastery record/,
  );
  assert.equal(
    registry.knowledge("proof-gated").referenceVerifiedPracticeSessionCount,
    0,
  );
});

test("Pro Creation stays blocked until Practice knowledge is transfer-verified", () => {
  const registry = new EditTypeRegistryV1();
  registry.create({
    editTypeId: "spider-man-high-potency",
    title: "Spider-Man High Potency",
  });
  const engine = new ProCreationPreparationEngineV1(registry);
  const request = {
    sessionId: "pro:create:001",
    mode: "PRO_CREATION",
    editTypeId: "spider-man-high-potency",
    start: [
      {
        mediaId: "raw:video",
        role: "START_SOURCE",
        mediaKind: "VIDEO",
        uri: "file:///raw.mp4",
      },
      {
        mediaId: "raw:song",
        role: "START_SOURCE",
        mediaKind: "AUDIO",
        uri: "file:///song.wav",
      },
    ],
  };

  assert.equal(engine.prepare(request).status, "BLOCKED");
  registry.allocateEpisode(episode, "spider-man-high-potency");
  assert.equal(engine.prepare(request).status, "BLOCKED");

  const firstSession = "practice:verified:001";
  registry.beginGptLearningSession("spider-man-high-potency", firstSession, "PRACTICE");
  registry.completeGptLearningSession({
    editTypeId: "spider-man-high-potency",
    sessionId: firstSession,
    mode: "PRACTICE",
    mastered: true,
    masteryRecord: masteryRecord(
      firstSession,
      "REFERENCE_VERIFIED",
      "finish:one",
      "practice-source-set:one",
    ),
  });
  assert.equal(engine.prepare(request).status, "BLOCKED");

  const transferSession = "practice:verified:002";
  registry.beginGptLearningSession("spider-man-high-potency", transferSession, "PRACTICE");
  registry.completeGptLearningSession({
    editTypeId: "spider-man-high-potency",
    sessionId: transferSession,
    mode: "PRACTICE",
    mastered: true,
    masteryRecord: masteryRecord(
      transferSession,
      "TRANSFER_VERIFIED",
      "finish:two",
      "practice-source-set:two",
    ),
  });
  const ready = engine.prepare(request);
  assert.equal(ready.status, "READY");
  assert.equal(ready.knowledge?.transferVerifiedPracticeSessionCount, 1);
  assert.equal(ready.knowledge?.knowledgeScope, "TRANSFER_VERIFIED_ONLY");
  assert.equal(ready.knowledge?.maturityStage, "TRANSFER_VERIFIED");
  assert.deepEqual(ready.knowledge?.successfulConstructionIds, []);
  assert.equal(
    ready.knowledge?.behaviorEvidence.some((item) =>
      item.sessionId === episode.sessionId),
    false,
  );
  assert.equal(ready.start.some((item) => item.mediaKind === "AUDIO"), true);
});

test("held-out benchmark is fail-closed and can advance maturity only from retained proof", () => {
  const registry = new EditTypeRegistryV1();
  registry.create({ editTypeId: "benchmark-gated", title: "Benchmark Gated" });
  const transferSession = "practice:benchmark:transfer";
  registry.beginGptLearningSession("benchmark-gated", transferSession, "PRACTICE");
  const prior = masteryRecord(
    transferSession,
    "TRANSFER_VERIFIED",
    "finish:training",
    "source:training",
  );
  registry.completeGptLearningSession({
    editTypeId: "benchmark-gated",
    sessionId: transferSession,
    mode: "PRACTICE",
    mastered: true,
    masteryRecord: prior,
  });
  assert.equal(registry.knowledge("benchmark-gated").maturityStage, "TRANSFER_VERIFIED");
  const initialProgression = registry.knowledge("benchmark-gated").progressionGate;
  assert.equal(initialProgression.robustClaimAllowed, false);
  assert.equal(initialProgression.retainedTruthCertificationComplete, false);
  assert.ok(initialProgression.blockingDependencies.some((reason) =>
    /No retained real-media truth-suite evaluation/i.test(reason)));

  const cases = Array.from({ length: 20 }, (_, index) => ({
    caseId: "held-out:" + String(index + 1),
    sessionId: "practice:held-out:" + String(index + 1),
    referenceFingerprint: "reference:held-out:" + String(index + 1),
    sourceFingerprint: "source:held-out:" + String(index + 1),
    effectFamilyIds: [index % 2 === 0 ? "SHUTTER_FRAGMENTATION" : "MOTION_WARP"],
    objectAwareVerified: index < 3,
    subjectRelativeDirectionWindowCount: index < 3 ? 1 : 0,
    subjectRelativeDirectionVerified: index < 3,
    subjectRelativeDirectionBuckets: index === 0
      ? ["RIGHT"]
      : index === 1
        ? ["UP"]
        : index === 2
          ? ["DOWN_LEFT"]
          : [],
    subjectContinuityHardCaseVerified: index < 3,
    subjectContinuityChallengeWindowCount: index < 3 ? 1 : 0,
    subjectContinuityChallenges: index === 0
      ? ["LOW_MOTION", "BACKGROUND_MOTION"]
      : index === 1
        ? ["OCCLUSION", "IDENTITY_AMBIGUITY"]
        : index === 2
          ? ["LOW_MOTION", "OCCLUSION", "BACKGROUND_MOTION", "IDENTITY_AMBIGUITY"]
          : [],
    overallSimilarity: 0.97,
    definingEffectCoverage: 1,
    passed: true,
    evidenceRefs: ["proof:held-out:" + String(index + 1)],
  }));
  const unboundReport = evaluatePracticeHeldOutBenchmarkV1({
    editTypeId: "benchmark-gated",
    cases,
    priorMasteryRecords: [prior],
    professionalBenchmarkEvidence: professionalBenchmarkEvidenceFor("SHUTTER_FRAGMENTATION"),
  });
  assert.equal(unboundReport.robust, false);
  assert.equal(unboundReport.heldOutProofVerified, true);
  assert.equal(unboundReport.retainedTruthSuiteAuthorityVerified, false);
  assert.ok(unboundReport.reasons.some((reason) => /retained real-media truth suite/i.test(reason)));
  for (const heldOutCase of cases) registry.recordHeldOutCase("benchmark-gated", heldOutCase);
  registry.recordHeldOutBenchmark(unboundReport);
  assert.equal(registry.knowledge("benchmark-gated").maturityStage, "OBJECT_AWARE_VERIFIED");

  const retainedTruthReport = retainedTruthCertificationReport("benchmark-gated");
  assert.equal(retainedTruthReport.certified, true);
  registry.recordRetainedTruthSuite(retainedTruthReport);
  assert.equal(
    registry.knowledge("benchmark-gated").maturityStage,
    "OBJECT_AWARE_VERIFIED",
    "a stale unbound benchmark must not compose with a later truth certificate",
  );
  const certifiedProgression = registry.knowledge("benchmark-gated").progressionGate;
  assert.equal(certifiedProgression.populationWindowComplete, true);
  assert.equal(certifiedProgression.independentTruthReviewComplete, true);
  assert.equal(certifiedProgression.sourceAcquisitionComplete, true);
  assert.equal(certifiedProgression.retainedTruthCertificationComplete, true);
  assert.equal(certifiedProgression.heldOutBenchmarkComplete, false);
  assert.equal(certifiedProgression.robustClaimAllowed, false);
  assert.ok(certifiedProgression.blockingDependencies.some((reason) =>
    /No ROBUST held-out benchmark/i.test(reason)));

  const initialRefreshedReport = refreshPracticeHeldOutBenchmarkV1({
    registry,
    editTypeId: "benchmark-gated",
    professionalBenchmarkEvidence: professionalBenchmarkEvidenceFor("SHUTTER_FRAGMENTATION"),
  });
  assert.equal(initialRefreshedReport.heldOutProofVerified, true);
  assert.equal(initialRefreshedReport.retainedTruthSuiteAuthorityVerified, true);
  assert.equal(initialRefreshedReport.robust, true);
  assert.equal(registry.knowledge("benchmark-gated").maturityStage, "ROBUST");

  const report = evaluatePracticeHeldOutBenchmarkV1({
    editTypeId: "benchmark-gated",
    cases,
    priorMasteryRecords: [prior],
    professionalBenchmarkEvidence: professionalBenchmarkEvidenceFor("SHUTTER_FRAGMENTATION"),
    retainedTruthSuiteReports: [retainedTruthReport],
  });
  assert.equal(report.caseCount, 20);
  assert.equal(report.passedCaseCount, 20);
  assert.equal(report.distinctMaterialPairCount, 20);
  assert.equal(report.distinctEffectFamilyCount, 2);
  assert.deepEqual(report.requiredEffectFamilyIds, ["SHUTTER_FRAGMENTATION"]);
  assert.deepEqual(report.verifiedEffectFamilyIds, ["MOTION_WARP", "SHUTTER_FRAGMENTATION"]);
  assert.deepEqual(report.missingEffectFamilyIds, []);
  assert.equal(report.effectFamilyCoverageVerified, true);
  assert.deepEqual(report.professionalBenchmarkVerifiedEffectFamilyIds, ["SHUTTER_FRAGMENTATION"]);
  assert.deepEqual(report.professionalBenchmarkMissingEffectFamilyIds, []);
  assert.equal(report.professionalBenchmarkCoverageVerified, true);
  assert.equal(report.professionalBenchmarkFailures.length, 0);
  assert.equal(report.retainedTruthSuiteAuthorityVerified, true);
  assert.equal(report.retainedTruthSuiteEvaluatedAt, retainedTruthReport.evaluatedAt);
  assert.ok(report.retainedTruthSuiteEvidenceRefs.length > 0);
  assert.equal(report.objectAwareVerified, true);
  assert.equal(report.subjectRelativeDirectionCaseCount, 3);
  assert.equal(report.subjectRelativeDirectionVerified, true);
  assert.equal(report.subjectRelativeDirectionBucketCount, 3);
  assert.deepEqual(report.subjectRelativeDirectionBuckets, ["RIGHT", "DOWN_LEFT", "UP"]);
  assert.equal(report.subjectRelativeDirectionDiversityVerified, true);
  assert.equal(report.subjectContinuityHardCaseCount, 3);
  assert.equal(report.subjectContinuityHardCaseVerified, true);
  assert.equal(report.subjectContinuityChallengeKindCount, 4);
  assert.deepEqual(
    report.subjectContinuityChallenges,
    ["LOW_MOTION", "OCCLUSION", "BACKGROUND_MOTION", "IDENTITY_AMBIGUITY"],
  );
  assert.equal(report.subjectContinuityChallengeDiversityVerified, true);
  assert.equal(report.robust, true);
  assert.deepEqual(report.reasons, []);
  assert.throws(
    () => registry.recordHeldOutBenchmark({
      ...report,
      retainedTruthSuiteEvaluatedAt: "2026-09-20T00:00:00.000Z",
    }),
    /truth-suite authority is missing, stale/i,
  );
  assert.throws(
    () => registry.recordHeldOutBenchmark({
      ...report,
      requiredEffectFamilyIds: [],
    }),
    /current TRANSFER_VERIFIED target set/i,
  );

  const nondirectional = evaluatePracticeHeldOutBenchmarkV1({
    editTypeId: "benchmark-gated",
    cases: cases.map((item) => ({
      ...item,
      subjectRelativeDirectionWindowCount: 0,
      subjectRelativeDirectionVerified: false,
      subjectRelativeDirectionBuckets: [],
    })),
    priorMasteryRecords: [prior],
    professionalBenchmarkEvidence: professionalBenchmarkEvidenceFor("SHUTTER_FRAGMENTATION"),
    retainedTruthSuiteReports: [retainedTruthReport],
  });
  assert.equal(nondirectional.objectAwareVerified, true);
  assert.equal(nondirectional.subjectRelativeDirectionVerified, false);
  assert.equal(nondirectional.robust, false);
  assert.ok(nondirectional.reasons.some((reason) => /subject-relative direction cases/i.test(reason)));

  const sameDirectionOnly = evaluatePracticeHeldOutBenchmarkV1({
    editTypeId: "benchmark-gated",
    cases: cases.map((item) => ({
      ...item,
      subjectRelativeDirectionBuckets: item.subjectRelativeDirectionVerified ? ["RIGHT"] : [],
    })),
    priorMasteryRecords: [prior],
    professionalBenchmarkEvidence: professionalBenchmarkEvidenceFor("SHUTTER_FRAGMENTATION"),
    retainedTruthSuiteReports: [retainedTruthReport],
  });
  assert.equal(sameDirectionOnly.subjectRelativeDirectionCaseCount, 3);
  assert.equal(sameDirectionOnly.subjectRelativeDirectionVerified, true);
  assert.equal(sameDirectionOnly.subjectRelativeDirectionBucketCount, 1);
  assert.deepEqual(sameDirectionOnly.subjectRelativeDirectionBuckets, ["RIGHT"]);
  assert.equal(sameDirectionOnly.subjectRelativeDirectionDiversityVerified, false);
  assert.equal(sameDirectionOnly.robust, false);
  assert.ok(sameDirectionOnly.reasons.some((reason) => /direction sectors/i.test(reason)));

  const easyOnly = evaluatePracticeHeldOutBenchmarkV1({
    editTypeId: "benchmark-gated",
    cases: cases.map((item) => ({
      ...item,
      subjectContinuityHardCaseVerified: false,
      subjectContinuityChallengeWindowCount: 0,
      subjectContinuityChallenges: [],
    })),
    priorMasteryRecords: [prior],
    professionalBenchmarkEvidence: professionalBenchmarkEvidenceFor("SHUTTER_FRAGMENTATION"),
    retainedTruthSuiteReports: [retainedTruthReport],
  });
  assert.equal(easyOnly.subjectContinuityHardCaseCount, 0);
  assert.equal(easyOnly.subjectContinuityHardCaseVerified, false);
  assert.equal(easyOnly.subjectContinuityChallengeDiversityVerified, false);
  assert.equal(easyOnly.robust, false);
  assert.ok(easyOnly.reasons.some((reason) => /hard subject-continuity cases/i.test(reason)));

  const lowMotionOnly = evaluatePracticeHeldOutBenchmarkV1({
    editTypeId: "benchmark-gated",
    cases: cases.map((item) => ({
      ...item,
      subjectContinuityChallenges: item.subjectContinuityHardCaseVerified ? ["LOW_MOTION"] : [],
    })),
    priorMasteryRecords: [prior],
    professionalBenchmarkEvidence: professionalBenchmarkEvidenceFor("SHUTTER_FRAGMENTATION"),
    retainedTruthSuiteReports: [retainedTruthReport],
  });
  assert.equal(lowMotionOnly.subjectContinuityHardCaseCount, 3);
  assert.equal(lowMotionOnly.subjectContinuityHardCaseVerified, true);
  assert.equal(lowMotionOnly.subjectContinuityChallengeKindCount, 1);
  assert.deepEqual(lowMotionOnly.subjectContinuityChallenges, ["LOW_MOTION"]);
  assert.equal(lowMotionOnly.subjectContinuityChallengeDiversityVerified, false);
  assert.equal(lowMotionOnly.robust, false);
  assert.ok(lowMotionOnly.reasons.some((reason) => /challenge kinds/i.test(reason)));

  const legacyTwoChallengeOnly = evaluatePracticeHeldOutBenchmarkV1({
    editTypeId: "benchmark-gated",
    cases: cases.map((item, index) => ({
      ...item,
      subjectContinuityChallenges: item.subjectContinuityHardCaseVerified
        ? index % 2 === 0
          ? ["LOW_MOTION"]
          : ["OCCLUSION"]
        : [],
    })),
    priorMasteryRecords: [prior],
    professionalBenchmarkEvidence: professionalBenchmarkEvidenceFor("SHUTTER_FRAGMENTATION"),
    retainedTruthSuiteReports: [retainedTruthReport],
  });
  assert.equal(legacyTwoChallengeOnly.subjectContinuityChallengeKindCount, 2);
  assert.deepEqual(
    legacyTwoChallengeOnly.subjectContinuityChallenges,
    ["LOW_MOTION", "OCCLUSION"],
  );
  assert.equal(legacyTwoChallengeOnly.subjectContinuityChallengeDiversityVerified, false);
  assert.equal(legacyTwoChallengeOnly.robust, false);
  assert.ok(legacyTwoChallengeOnly.reasons.some((reason) => /challenge kinds/i.test(reason)));

  const practiceOnly = evaluatePracticeHeldOutBenchmarkV1({
    editTypeId: "benchmark-gated",
    cases,
    priorMasteryRecords: [prior],
    retainedTruthSuiteReports: [retainedTruthReport],
  });
  assert.equal(practiceOnly.effectFamilyCoverageVerified, true);
  assert.equal(practiceOnly.professionalBenchmarkCoverageVerified, false);
  assert.equal(practiceOnly.robust, false);
  assert.ok(practiceOnly.reasons.some((reason) => /M6 professional benchmark authority/.test(reason)));

  registry.recordHeldOutBenchmark(report);
  assert.equal(registry.knowledge("benchmark-gated").maturityStage, "ROBUST");
  const robustProgression = registry.knowledge("benchmark-gated").progressionGate;
  assert.equal(robustProgression.heldOutBenchmarkComplete, true);
  assert.equal(robustProgression.robustClaimAllowed, true);
  assert.deepEqual(robustProgression.blockingDependencies, []);

  const incompleteTruthReport = {
    ...retainedTruthReport,
    evaluatedAt: new Date(
      Date.parse(retainedTruthReport.evaluatedAt) + 1000,
    ).toISOString(),
    caseCount: 10,
    passedCaseCount: 10,
    distinctCaseIdCount: 10,
    distinctReferenceCount: 10,
    distinctFinishSha256Count: 10,
    distinctSourceSetCount: 1,
    independentTruthCaseCount: 5,
    fullLengthTruthCaseCount: 5,
    difficultyKindCount: 2,
    difficultyKinds: retainedTruthReport.difficultyKinds.slice(0, 2),
    certified: false,
    reasons: ["Population and independent review are incomplete."],
    cases: retainedTruthReport.cases.slice(0, 10),
    evidenceRefs: ["truth:incomplete:latest"],
  };
  const blockedRecertification = applyPracticeRobustRecertificationV1({
    registry,
    retainedTruthReport: incompleteTruthReport,
    professionalBenchmarkEvidence: professionalBenchmarkEvidenceFor("SHUTTER_FRAGMENTATION"),
  });
  assert.equal(blockedRecertification.retainedTruthCertified, false);
  assert.equal(blockedRecertification.heldOutRefreshAttempted, false);
  assert.equal(blockedRecertification.robustClaimAllowed, false);
  const blockedByLatestTruth = registry.knowledge("benchmark-gated");
  assert.equal(blockedByLatestTruth.maturityStage, "OBJECT_AWARE_VERIFIED");
  assert.equal(blockedByLatestTruth.progressionGate.populationWindowComplete, false);
  assert.equal(blockedByLatestTruth.progressionGate.independentTruthReviewComplete, false);
  assert.equal(blockedByLatestTruth.progressionGate.sourceAcquisitionComplete, false);
  assert.equal(blockedByLatestTruth.progressionGate.retainedTruthCertificationComplete, false);
  assert.equal(blockedByLatestTruth.progressionGate.robustClaimAllowed, false);
  assert.ok(blockedByLatestTruth.progressionGate.blockingDependencies.some((reason) =>
    /10\/20 required cases/i.test(reason)));
  assert.ok(blockedByLatestTruth.progressionGate.blockingDependencies.some((reason) =>
    /5\/10 retained cases/i.test(reason)));
  assert.ok(blockedByLatestTruth.progressionGate.blockingDependencies.some((reason) =>
    /distinct Start source sets/i.test(reason)));
  assert.throws(
    () => registry.recordHeldOutBenchmark(report),
    /truth-suite authority is missing, stale/i,
    "an older certified truth suite must not authorize a ROBUST write after newer incomplete evidence",
  );

  const refreshedTruthReport = {
    ...retainedTruthReport,
    evaluatedAt: new Date(
      Date.parse(retainedTruthReport.evaluatedAt) + 2000,
    ).toISOString(),
  };
  const recertified = applyPracticeRobustRecertificationV1({
    registry,
    retainedTruthReport: refreshedTruthReport,
    professionalBenchmarkEvidence: professionalBenchmarkEvidenceFor("SHUTTER_FRAGMENTATION"),
  });
  assert.equal(recertified.retainedTruthCertified, true);
  assert.equal(recertified.heldOutRefreshAttempted, true);
  assert.equal(recertified.heldOutRefreshCompleted, true);
  assert.equal(recertified.heldOutRefreshError, null);
  assert.equal(recertified.heldOutBenchmarkRobust, true);
  assert.equal(recertified.maturityStage, "ROBUST");
  assert.equal(recertified.robustClaimAllowed, true);
  assert.deepEqual(recertified.progressionGate.blockingDependencies, []);
  assert.equal(registry.knowledge("benchmark-gated").maturityStage, "ROBUST");
  assert.equal(registry.knowledge("benchmark-gated").progressionGate.robustClaimAllowed, true);

  const contaminated = evaluatePracticeHeldOutBenchmarkV1({
    editTypeId: "benchmark-gated",
    cases: cases.map((item, index) => index === 3
      ? { ...item, referenceFingerprint: prior.referenceFingerprint }
      : item),
    priorMasteryRecords: [prior],
    professionalBenchmarkEvidence: professionalBenchmarkEvidenceFor("SHUTTER_FRAGMENTATION"),
    retainedTruthSuiteReports: [retainedTruthReport],
  });
  assert.equal(contaminated.robust, false);
  assert.ok(contaminated.reasons.some((reason) => /training reference fingerprint/.test(reason)));

  const expandedTransferSession = "practice:benchmark:expanded-transfer";
  registry.beginGptLearningSession("benchmark-gated", expandedTransferSession, "PRACTICE");
  registry.completeGptLearningSession({
    editTypeId: "benchmark-gated",
    sessionId: expandedTransferSession,
    mode: "PRACTICE",
    mastered: true,
    masteryRecord: {
      ...masteryRecord(
        expandedTransferSession,
        "TRANSFER_VERIFIED",
        "finish:expanded-transfer",
        "source:expanded-transfer",
      ),
      effectFamilyIds: ["MOTION_WARP"],
    },
  });
  assert.equal(
    registry.knowledge("benchmark-gated").maturityStage,
    "OBJECT_AWARE_VERIFIED",
    "new transfer targets must invalidate a stale ROBUST benchmark until re-certification",
  );
});

test("ROBUST requires held-out transfer coverage for every mastered effect family", () => {
  const shutter = masteryRecord(
    "practice:family-training:shutter",
    "TRANSFER_VERIFIED",
    "finish:family-training:shutter",
    "source:family-training:shutter",
  );
  const displacementWarp = {
    ...masteryRecord(
      "practice:family-training:displacement-warp",
      "TRANSFER_VERIFIED",
      "finish:family-training:displacement-warp",
      "source:family-training:displacement-warp",
    ),
    effectFamilyIds: ["DISPLACEMENT_WARP"],
  };
  const retainedTruthReport = retainedTruthCertificationReport("family-coverage");
  assert.equal(retainedTruthReport.certified, true);
  const shutterOnlyCases = Array.from({ length: 20 }, (_, index) => ({
    caseId: "held-out:family:" + String(index + 1),
    sessionId: "practice:held-out:family:" + String(index + 1),
    referenceFingerprint: "reference:family:" + String(index + 1),
    sourceFingerprint: "source:family:" + String(index + 1),
    effectFamilyIds: ["SHUTTER_FRAGMENTATION"],
    objectAwareVerified: index < 3,
    subjectRelativeDirectionWindowCount: index < 3 ? 1 : 0,
    subjectRelativeDirectionVerified: index < 3,
    subjectRelativeDirectionBuckets: index === 0
      ? ["RIGHT"]
      : index === 1
        ? ["UP"]
        : index === 2
          ? ["DOWN_LEFT"]
          : [],
    subjectContinuityHardCaseVerified: index < 3,
    subjectContinuityChallengeWindowCount: index < 3 ? 1 : 0,
    subjectContinuityChallenges: index === 0
      ? ["LOW_MOTION", "BACKGROUND_MOTION"]
      : index === 1
        ? ["OCCLUSION", "IDENTITY_AMBIGUITY"]
        : index === 2
          ? ["LOW_MOTION", "OCCLUSION", "BACKGROUND_MOTION", "IDENTITY_AMBIGUITY"]
          : [],
    overallSimilarity: 0.98,
    definingEffectCoverage: 1,
    passed: true,
    reasons: [],
    evidenceRefs: ["proof:family:" + String(index + 1)],
  }));

  const missingFamily = evaluatePracticeHeldOutBenchmarkV1({
    editTypeId: "family-coverage",
    cases: shutterOnlyCases,
    priorMasteryRecords: [shutter, displacementWarp],
    professionalBenchmarkEvidence: professionalBenchmarkEvidenceFor(
      "SHUTTER_FRAGMENTATION",
      "DISPLACEMENT_WARP",
    ),
    retainedTruthSuiteReports: [retainedTruthReport],
  });
  assert.equal(missingFamily.passedCaseCount, 20);
  assert.deepEqual(
    missingFamily.requiredEffectFamilyIds,
    ["DISPLACEMENT_WARP", "SHUTTER_FRAGMENTATION"],
  );
  assert.deepEqual(missingFamily.verifiedEffectFamilyIds, ["SHUTTER_FRAGMENTATION"]);
  assert.deepEqual(missingFamily.missingEffectFamilyIds, ["DISPLACEMENT_WARP"]);
  assert.equal(missingFamily.effectFamilyCoverageVerified, false);
  assert.equal(missingFamily.robust, false);
  assert.ok(missingFamily.reasons.some((reason) =>
    /missing passing transfer coverage.*DISPLACEMENT_WARP/i.test(reason)));

  const coveredCases = shutterOnlyCases.map((item, index) =>
    index === shutterOnlyCases.length - 1
      ? { ...item, effectFamilyIds: ["DISPLACEMENT_WARP"] }
      : item);
  const covered = evaluatePracticeHeldOutBenchmarkV1({
    editTypeId: "family-coverage",
    cases: coveredCases,
    priorMasteryRecords: [shutter, displacementWarp],
    professionalBenchmarkEvidence: professionalBenchmarkEvidenceFor(
      "SHUTTER_FRAGMENTATION",
      "DISPLACEMENT_WARP",
    ),
    retainedTruthSuiteReports: [retainedTruthReport],
  });
  assert.deepEqual(covered.missingEffectFamilyIds, []);
  assert.equal(covered.effectFamilyCoverageVerified, true);
  assert.equal(covered.robust, true);

  const failedCoverageCases = coveredCases.map((item, index) =>
    index === coveredCases.length - 1
      ? { ...item, passed: false, reasons: ["Effect-family transfer failed."] }
      : item);
  const failedCoverage = evaluatePracticeHeldOutBenchmarkV1({
    editTypeId: "family-coverage",
    cases: failedCoverageCases,
    priorMasteryRecords: [shutter, displacementWarp],
    professionalBenchmarkEvidence: professionalBenchmarkEvidenceFor(
      "SHUTTER_FRAGMENTATION",
      "DISPLACEMENT_WARP",
    ),
    retainedTruthSuiteReports: [retainedTruthReport],
  });
  assert.deepEqual(failedCoverage.verifiedEffectFamilyIds, ["SHUTTER_FRAGMENTATION"]);
  assert.deepEqual(failedCoverage.missingEffectFamilyIds, ["DISPLACEMENT_WARP"]);
  assert.equal(failedCoverage.effectFamilyCoverageVerified, false);
  assert.equal(failedCoverage.robust, false);
});

test("held-out certification retains failed machine cases instead of cherry-picking passes", () => {
  const registry = new EditTypeRegistryV1();
  registry.create({ editTypeId: "held-out-failures", title: "Held Out Failures" });
  const transferSession = "practice:held-out-training:001";
  const prior = masteryRecord(
    transferSession,
    "TRANSFER_VERIFIED",
    "finish:held-out-training",
    "source:held-out-training",
  );
  registry.beginGptLearningSession("held-out-failures", transferSession, "PRACTICE");
  registry.completeGptLearningSession({
    editTypeId: "held-out-failures",
    sessionId: transferSession,
    mode: "PRACTICE",
    mastered: true,
    masteryRecord: prior,
  });

  const report = {
    ...failedReport(),
    reasons: ["Reference effect behavior was not reproduced."],
    evidenceRefs: ["proof:held-out-failed:comparison"],
  };
  const proof = {
    schema: "editflow.practice-mastery-proof.v1",
    sessionId: "practice:held-out-failed:001",
    editTypeId: "held-out-failures",
    referenceId: "finish:held-out-failed",
    sourceIndexId: "source-index:held-out-failed",
    referenceFingerprint: "reference:held-out-failed",
    sourceFingerprint: "source:held-out-failed",
    finalRenderRef: "render:held-out-failed",
    minimumSimilarity: 0.95,
    exactSceneConfidence: 0.95,
    effectFamilyIds: ["MOTION_WARP"],
    report,
    matches: [],
    audioMatch: null,
    evidenceRefs: ["proof:held-out-failed:machine"],
    verifiedAt: "2026-09-23T13:00:00.000Z",
  };
  const heldOutCase = buildPracticeHeldOutBenchmarkCaseV1({
    sessionId: proof.sessionId,
    proof,
    proofRef: "proof:held-out-failed:bundle",
  });
  assert.equal(heldOutCase.passed, false);
  assert.ok(heldOutCase.reasons.some((reason) => /not reproduced/.test(reason)));
  registry.recordHeldOutCase("held-out-failures", heldOutCase);

  const retained = registry.knowledge("held-out-failures");
  assert.equal(retained.gptLearning.heldOutCases.length, 1);
  assert.equal(retained.gptLearning.heldOutCases[0].passed, false);
  const benchmark = evaluatePracticeHeldOutBenchmarkV1({
    editTypeId: "held-out-failures",
    cases: retained.gptLearning.heldOutCases,
    priorMasteryRecords: retained.gptLearning.masteryRecords,
  });
  assert.equal(benchmark.robust, false);
  assert.equal(benchmark.passedCaseCount, 0);
  assert.ok(benchmark.reasons.some((reason) => /did not pass its machine proof gate/.test(reason)));
  assert.ok(benchmark.reasons.some((reason) => /not reproduced/.test(reason)));
});

const summary = {
  frameCount: 7,
  frameIntervalMs: 1000 / 30,
  temporalStateCountPeak: 4,
  temporalPersistence: 0.55,
  motionEnergyPeak: 0.5,
  displacementPeak: 0.16,
  displacementDirection: { x: 1, y: 0 },
  scaleRange: 0,
  rotationRange: 0,
  blurPeak: 0.35,
  blurPeakPhase: 0.5,
  distortionPeak: 0.2,
  exposurePeak: 0.7,
  subjectSeparationPeak: 0.42,
  overlapDensityPeak: 0.4,
  stateSeparationPeak: 0.08,
  occlusionPeak: 0,
  accelerationPeak: 0.09,
  recoveryFrames: 3,
  opticalPeakPhase: 0.5,
  motionPeakPhase: 0.5,
};
const frame = (index) => ({
  timeMs: index * summary.frameIntervalMs,
  lumaMean: 0.5,
  lumaStd: 0.3,
  exposure: index === 3 ? 0.7 : 0.45,
  sharpness: 0.5,
  edgeDensity: 0.25,
  chromaticSeparation: 0.04,
  alphaCoverage: 1,
  visualDensity: 0.3,
  frameDifference: index === 3 ? 0.45 : 0.05,
  structuralDifference: index === 3 ? 0.4 : 0.05,
  motionEnergy: index === 3 ? 0.5 : 0.03,
  motionDirection: { x: 1, y: 0 },
  subjectMotion: { x: 0.2, y: 0 },
  backgroundMotion: { x: 0.02, y: 0 },
  subjectBackgroundDivergence: index === 3 ? 0.18 : 0,
  subjectSemanticId: "subject:primary:v1",
  subjectTrackState: "OBSERVED",
  subjectIdentityConfidence: 0.91,
  subjectVisibility: 0.96,
  subjectBoundingBox: [0.25, 0.18, 0.42, 0.7],
  subjectMaskSource: "SEGMENTATION",
  subjectMaskValidated: true,
  subjectEvidenceIds: ["fixture:subject:primary:v1", "fixture:subject:frame:" + index],
  displacementMagnitude: index === 3 ? 0.16 : 0.01,
  scale: 1,
  rotationDegrees: 0,
  perspectiveEnergy: 0,
  blurStrength: index === 3 ? 0.35 : 0.05,
  distortionStrength: index === 3 ? 0.2 : 0.02,
  subjectSeparation: index === 3 ? 0.42 : 0,
  overlapDensity: index === 3 ? 0.4 : 0,
  stateSeparation: index === 3 ? 0.08 : 0,
  temporalStateCount: index === 3 ? 4 : 1,
  occlusion: 0,
  maskCoverage: 0.25,
});

const referenceEvidence = {
  schema: "editflow.dense-effect-evidence.v1",
  sourceId: "reference:learning-transfer",
  sourceKind: "REFERENCE",
  range: { startMs: 0, endMs: 200 },
  analyzerFingerprint: "fixture-analyzer-v1",
  settingsFingerprint: "fixture-settings-v1",
  contentKey: "fixture-content",
  frames: Array.from({ length: 7 }, (_, index) => frame(index)),
  summary,
  evidenceRefs: ["fixture:reference"],
};

const verifiedSubjectIsolationRoute = {
  async prepare(input) {
    return {
      verified: true,
      routeId: "test.segmentation.subject-isolation.v1",
      referenceSemanticId: input.referenceSemanticId,
      sourceSemanticId: "source-subject:" + input.shotId,
      crossSourceIdentityVerified: true,
      maskSource: "SEGMENTATION",
      evidenceRefs: [
        "test:subject-isolation:" + input.shotId,
        "test:cross-source-identity:" + input.referenceSemanticId,
      ],
    };
  },
};

const reference = {
  referenceId: "finish:learning-transfer",
  styleFingerprint: "style:learning-transfer",
  shots: [{
    shotId: "shot:001",
    order: 0,
    referenceStartMs: 0,
    referenceEndMs: 500,
    evidenceRefs: ["shot:001"],
  }],
  evidenceRefs: ["reference:analysis"],
};

const oneWindowSequence = (sourceId, evidence) => ({
  schema: "editflow.dense-effect-sequence.v1",
  sourceId,
  windows: [{
    windowId: "window:object-aware",
    startIndex: 0,
    endIndex: 6,
    anchorIndex: 3,
    startMs: 0,
    endMs: 200,
    anchorMs: 100,
    peakEnergy: 0.5,
    evidence,
  }],
  evidenceRefs: ["sequence:" + sourceId],
});

test("object-aware proof preserves subject/background relation and fails when it collapses", () => {
  const referenceSequence = oneWindowSequence("reference:object-aware", referenceEvidence);
  const matchingRenderEvidence = {
    ...referenceEvidence,
    sourceId: "render:object-aware:matching",
    sourceKind: "RENDER",
    contentKey: "fixture-content:render-matching",
    evidenceRefs: ["fixture:render:matching"],
  };
  const passed = comparePracticeObjectAwareWindowsV1(
    referenceSequence,
    oneWindowSequence("render:object-aware:matching", matchingRenderEvidence),
  );
  assert.equal(passed.required, true);
  assert.equal(passed.referenceWindowCount, 1);
  assert.equal(passed.verified, true);
  assert.equal(passed.windows[0].relationMatched, true);
  assert.equal(passed.windows[0].subjectRelativeDirectionRequired, true);
  assert.equal(passed.windows[0].subjectRelativeDirectionVerified, true);
  assert.ok(passed.windows[0].subjectRelativeDirectionScore >= 0.72);
  assert.ok(passed.windows[0].evidenceRefs.some((ref) =>
    ref.startsWith("practice-subject-relative-direction-score:")));
  assert.ok(passed.overallScore >= 0.8);

  const collapsedFrames = referenceEvidence.frames.map((item) => ({
    ...item,
    subjectMotion: { x: 0.02, y: 0 },
    backgroundMotion: { x: 0.02, y: 0 },
    subjectBackgroundDivergence: 0,
    subjectSeparation: 0.02,
    maskCoverage: 0.01,
  }));
  const collapsedRenderEvidence = {
    ...referenceEvidence,
    sourceId: "render:object-aware:collapsed",
    sourceKind: "RENDER",
    contentKey: "fixture-content:render-collapsed",
    frames: collapsedFrames,
    summary: {
      ...referenceEvidence.summary,
      subjectSeparationPeak: 0.02,
    },
    evidenceRefs: ["fixture:render:collapsed"],
  };
  const failed = comparePracticeObjectAwareWindowsV1(
    referenceSequence,
    oneWindowSequence("render:object-aware:collapsed", collapsedRenderEvidence),
  );
  assert.equal(failed.required, true);
  assert.equal(failed.verified, false);
  assert.equal(failed.windows[0].passed, false);
  assert.ok(failed.reasons.some((reason) => /Object relation changed/.test(reason)));
});

test("cross-source subject proof binds Finish identity to the matched raw Start subject", async () => {
  const bindingReference = {
    ...reference,
    sourcePath: "C:\\Finish\\reference.mp4",
  };
  const bindingMatch = {
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
    evidenceRefs: ["source-video:sha256:binding-source"],
  };
  let capturedRequest = null;
  const verified = await buildPracticeCrossSourceSubjectProofV1({
    reference: bindingReference,
    sequence: oneWindowSequence("reference:cross-source", referenceEvidence),
    matches: [bindingMatch],
    binder: {
      async bindCrossSourceSubject(request) {
        capturedRequest = request;
        return {
          schema: "editflow.practice-cross-source-subject-binding.v1",
          algorithmId: "test.cross-source-binder.v1",
          verified: true,
          reason: null,
          referenceSemanticId: request.referenceSemanticId,
          sourceSemanticId: "practice-source-subject:raw:movie:verified",
          referenceSubjectBox: request.referenceSubjectBox,
          sourceSubjectBox: [0.24, 0.17, 0.43, 0.71],
          sourceVideo: {
            fps: 30,
            frameCount: 300,
            width: 1920,
            height: 1080,
            durationMs: 10000,
            sampleTimeMs: request.sourceTimeMs,
          },
          confidence: 0.94,
          evidenceRefs: ["proof:finish-to-start-binding"],
        };
      },
    },
  });
  assert.equal(verified.required, true);
  assert.equal(verified.referenceWindowCount, 1);
  assert.equal(verified.requiredBindingCount, 1);
  assert.equal(verified.verifiedBindingCount, 1);
  assert.equal(verified.verifiedWindowCount, 1);
  assert.equal(verified.verified, true);
  assert.ok(capturedRequest);
  assert.equal(capturedRequest.referenceSemanticId, "subject:primary:v1");
  assert.equal(capturedRequest.sourceId, "raw:movie");
  assert.ok(Math.abs(capturedRequest.sourceTimeMs - 1100) < 0.01);

  const rejected = await buildPracticeCrossSourceSubjectProofV1({
    reference: bindingReference,
    sequence: oneWindowSequence("reference:cross-source:failed", referenceEvidence),
    matches: [bindingMatch],
    binder: {
      async bindCrossSourceSubject(request) {
        return {
          schema: "editflow.practice-cross-source-subject-binding.v1",
          algorithmId: "test.cross-source-binder.v1",
          verified: false,
          reason: "CROSS_SOURCE_IDENTITY_BELOW_PROOF_FLOOR",
          referenceSemanticId: request.referenceSemanticId,
          sourceSemanticId: null,
          referenceSubjectBox: request.referenceSubjectBox,
          sourceSubjectBox: null,
          sourceVideo: {
            fps: 30,
            frameCount: 300,
            width: 1920,
            height: 1080,
            durationMs: 10000,
            sampleTimeMs: request.sourceTimeMs,
          },
          confidence: 0.2,
          evidenceRefs: ["proof:finish-to-start-binding:rejected"],
        };
      },
    },
  });
  assert.equal(rejected.required, true);
  assert.equal(rejected.verified, false);
  assert.equal(rejected.verifiedBindingCount, 0);
  assert.ok(rejected.reasons.some((reason) =>
    /Finish-to-Start subject binding failed/.test(reason)));
});

test("subject identity proof survives low-motion, occlusion, camera-motion, and ambiguity stress but rejects identity switches", () => {
  const continuityFrames = referenceEvidence.frames.map((item, index) => ({
    ...item,
    subjectTrackState: index === 4
      ? "PREDICTED_LOW_MOTION"
      : index === 5
        ? "PREDICTED_OCCLUDED"
        : "OBSERVED",
    subjectIdentityConfidence: index === 2
      ? 0.58
      : index === 4
        ? 0.72
        : index === 5
          ? 0.61
          : 0.91,
    subjectVisibility: index === 5 ? 0.3 : 0.9,
    backgroundMotion: index === 3 ? { x: 0.24, y: 0 } : item.backgroundMotion,
    occlusion: index === 5 ? 0.35 : 0,
  }));
  const continuous = summarizePracticeSubjectIdentityV1(continuityFrames);
  assert.equal(continuous.tracked, true);
  assert.equal(continuous.continuityVerified, true);
  assert.equal(continuous.identitySwitchCount, 0);
  assert.equal(continuous.lowMotionFrameCount > 0, true);
  assert.equal(continuous.lowMotionSurvived, true);
  assert.equal(continuous.occlusionFrameCount > 0, true);
  assert.equal(continuous.occlusionSurvived, true);
  assert.equal(continuous.backgroundMotionStressFrameCount > 0, true);
  assert.equal(continuous.backgroundMotionStressSurvived, true);
  assert.equal(continuous.identityAmbiguityFrameCount > 0, true);
  assert.equal(continuous.identityAmbiguitySurvived, true);
  assert.equal(continuous.validatedMaskFrameCount, continuityFrames.length);

  const switched = summarizePracticeSubjectIdentityV1(
    continuityFrames.map((item, index) => index < 5
      ? item
      : { ...item, subjectSemanticId: "subject:wrong:v2" }),
  );
  assert.equal(switched.continuityVerified, false);
  assert.equal(switched.identitySwitchCount > 0, true);
  assert.ok(switched.reasons.some((reason) => /switched/i.test(reason)));
});

test("held-out object-aware maturity is derived from machine proof and failed cases do not count", () => {
  const proof = {
    schema: "editflow.practice-mastery-proof.v1",
    sessionId: "practice:object-aware:held-out",
    editTypeId: "object-aware-edit",
    referenceId: "finish:object-aware",
    sourceIndexId: "source-index:object-aware",
    referenceFingerprint: "reference-object-aware-0001",
    sourceFingerprint: "source-object-aware-0001",
    finalRenderRef: "render:object-aware",
    minimumSimilarity: 0.95,
    exactSceneConfidence: 0.95,
    effectFamilyIds: ["SUBJECT_ISOLATED_TRANSITION"],
    objectAwareProof: {
      schema: "editflow.practice-object-aware-proof.v1",
      required: true,
      referenceWindowCount: 1,
      matchedWindowCount: 1,
      passedWindowCount: 1,
      overallScore: 0.94,
      verified: true,
      windows: [{
        subjectRelativeDirectionRequired: true,
        subjectRelativeDirectionVerified: true,
        subjectRelativeDirectionScore: 0.96,
        referenceSubjectRelativeDirection: { x: 0.6, y: -0.8 },
        subjectIdentityVerified: true,
        referenceSubjectIdentity: {
          lowMotionFrameCount: 2,
          lowMotionSurvived: true,
          occlusionFrameCount: 1,
          occlusionSurvived: true,
          backgroundMotionStressFrameCount: 1,
          backgroundMotionStressSurvived: true,
          identityAmbiguityFrameCount: 1,
          identityAmbiguitySurvived: true,
        },
        renderSubjectIdentity: {
          lowMotionFrameCount: 2,
          lowMotionSurvived: true,
          occlusionFrameCount: 1,
          occlusionSurvived: true,
          backgroundMotionStressFrameCount: 1,
          backgroundMotionStressSurvived: true,
          identityAmbiguityFrameCount: 1,
          identityAmbiguitySurvived: true,
        },
        passed: true,
      }],
      reasons: [],
      evidenceRefs: ["proof:object-aware"],
    },
    crossSourceSubjectProof: {
      schema: "editflow.practice-cross-source-subject-proof.v1",
      required: true,
      referenceWindowCount: 1,
      requiredBindingCount: 1,
      verifiedBindingCount: 1,
      verifiedWindowCount: 1,
      verified: true,
      bindings: [],
      reasons: [],
      evidenceRefs: ["proof:cross-source-subject"],
    },
    report: passedReport(0.98),
    matches: [],
    audioMatch: null,
    evidenceRefs: ["proof:machine"],
    verifiedAt: "2026-09-23T17:00:00.000Z",
  };
  const heldOutCase = buildPracticeHeldOutBenchmarkCaseV1({
    sessionId: proof.sessionId,
    proof,
    proofRef: "proof:bundle",
  });
  assert.equal(heldOutCase.objectAwareVerified, true);
  assert.equal(heldOutCase.subjectRelativeDirectionWindowCount, 1);
  assert.equal(heldOutCase.subjectRelativeDirectionVerified, true);
  assert.deepEqual(heldOutCase.subjectRelativeDirectionBuckets, ["UP_RIGHT"]);
  assert.equal(heldOutCase.subjectContinuityHardCaseVerified, true);
  assert.equal(heldOutCase.subjectContinuityChallengeWindowCount, 1);
  assert.deepEqual(
    heldOutCase.subjectContinuityChallenges,
    ["LOW_MOTION", "OCCLUSION", "BACKGROUND_MOTION", "IDENTITY_AMBIGUITY"],
  );

  const missingCameraStressCase = buildPracticeHeldOutBenchmarkCaseV1({
    sessionId: "practice:object-aware:missing-camera-stress",
    proof: {
      ...proof,
      sessionId: "practice:object-aware:missing-camera-stress",
      objectAwareProof: {
        ...proof.objectAwareProof,
        windows: proof.objectAwareProof.windows.map((window) => ({
          ...window,
          renderSubjectIdentity: {
            ...window.renderSubjectIdentity,
            backgroundMotionStressFrameCount: 0,
          },
        })),
      },
    },
    proofRef: "proof:missing-camera-stress:bundle",
  });
  assert.equal(missingCameraStressCase.subjectContinuityHardCaseVerified, false);
  assert.equal(missingCameraStressCase.subjectContinuityChallengeWindowCount, 1);
  assert.deepEqual(missingCameraStressCase.subjectContinuityChallenges, []);

  const nondirectionalCase = buildPracticeHeldOutBenchmarkCaseV1({
    sessionId: "practice:object-aware:nondirectional",
    proof: {
      ...proof,
      sessionId: "practice:object-aware:nondirectional",
      objectAwareProof: {
        ...proof.objectAwareProof,
        windows: [],
      },
    },
    proofRef: "proof:nondirectional:bundle",
  });
  assert.equal(nondirectionalCase.objectAwareVerified, true);
  assert.equal(nondirectionalCase.subjectRelativeDirectionWindowCount, 0);
  assert.equal(nondirectionalCase.subjectRelativeDirectionVerified, false);
  assert.equal(nondirectionalCase.subjectContinuityHardCaseVerified, false);
  assert.equal(nondirectionalCase.subjectContinuityChallengeWindowCount, 0);

  const missingBindingCase = buildPracticeHeldOutBenchmarkCaseV1({
    sessionId: "practice:object-aware:no-binding",
    proof: {
      ...proof,
      sessionId: "practice:object-aware:no-binding",
      crossSourceSubjectProof: undefined,
    },
    proofRef: "proof:no-binding:bundle",
  });
  assert.equal(missingBindingCase.passed, false);
  assert.equal(missingBindingCase.objectAwareVerified, false);
  assert.ok(missingBindingCase.reasons.some((reason) =>
    /Finish-to-Start subject binding/.test(reason)));

  const failedProof = {
    ...proof,
    sessionId: "practice:failed-object",
    referenceFingerprint: "reference-object-aware-0002",
    sourceFingerprint: "source-object-aware-0002",
    objectAwareProof: {
      ...proof.objectAwareProof,
      passedWindowCount: 0,
      overallScore: 0.42,
      verified: false,
      reasons: ["Object relation collapsed."],
      evidenceRefs: ["proof:object-aware:failed"],
    },
  };
  const failedCase = buildPracticeHeldOutBenchmarkCaseV1({
    sessionId: failedProof.sessionId,
    proof: failedProof,
    proofRef: "proof:failed-object:bundle",
  });
  assert.equal(failedCase.passed, false);
  assert.equal(failedCase.objectAwareVerified, false);
  assert.ok(failedCase.reasons.some((reason) => /Object relation collapsed/.test(reason)));
  const benchmark = evaluatePracticeHeldOutBenchmarkV1({
    editTypeId: "object-aware-edit",
    cases: [failedCase],
    policy: { minimumCases: 1, maximumCases: 30, minimumObjectAwareCases: 1 },
  });
  assert.equal(benchmark.objectAwareCaseCount, 0);
  assert.equal(benchmark.objectAwareVerified, false);
});

test("M6 Practice seeds a new reference with transferable Edit Type corrections", async () => {
  const family = classifyEffectFamilyV1(referenceEvidence);
  assert.notEqual(family, "UNKNOWN");
  const anatomy = deriveEffectAnatomyV1(referenceEvidence, family);
  const baseGraph = buildConstructionGraphV1(anatomy);
  const invariant = anatomy.dna.definingInvariants.find((candidate) => {
    const nodeId = baseGraph.invariantCoverage[candidate.invariantId]?.[0];
    const node = baseGraph.nodes.find((item) => item.nodeId === nodeId);
    return typeof node?.parameters[candidate.metric] === "number";
  });
  assert.ok(invariant);
  const nodeId = baseGraph.invariantCoverage[invariant.invariantId][0];
  const node = baseGraph.nodes.find((item) => item.nodeId === nodeId);
  const prior = node.parameters[invariant.metric];
  assert.equal(typeof prior, "number");

  const transferredSourcePatch = {
    patchId: "patch:mastered:1",
    invariantId: invariant.invariantId,
    nodeId,
    parameter: invariant.metric,
    previousValue: prior,
    nextValue: prior * 1.5,
    rationale: "Mastered Practice correction",
  };

  let capturedRequest = null;
  let capturedPrepareAttempt = null;
  let prepareCompleted = false;
  const brain = {
    async run(requestValue) {
      assert.equal(prepareCompleted, true);
      capturedRequest = requestValue;
      return {
        schema: "editflow.m6-production-result.v1",
        route: "VISUAL_INTELLIGENCE",
        status: "COMPLETED",
        correction: null,
        synthesis: null,
        evidenceRefs: requestValue.evidenceRefs,
      };
    },
  };
  const runtime = {
    availableCapabilities: [],
    async analyzeReference() {
      return referenceEvidence;
    },
    async prepareAttempt(input) {
      capturedPrepareAttempt = input;
      prepareCompleted = true;
    },
    async applyWindowGraph() {},
    async renderWindowEvidence() {
      throw new Error("custom brain should not render a window in this test");
    },
    async renderFullEdit() {
      return { renderRef: "render:learning-transfer", evidenceRefs: ["render:full"] };
    },
    async analyzeRender() {
      throw new Error("not used");
    },
    async evaluateContentStructure() {
      throw new Error("not used");
    },
  };
  const knowledge = {
    editTypeId: "spider-man-high-potency",
    title: "Spider-Man High Potency",
    revision: 4,
    masteredSessionCount: 1,
    totalSessionCount: 1,
    successfulConstructionIds: ["graph:passed"],
    failedConstructionIds: [],
    successfulSemanticPatches: [transferredSourcePatch],
    failedSemanticPatches: [],
    behaviorEvidence: [{
      evidenceId: "edit-type-evidence:mastered",
      sessionId: "practice:mastered",
      attempt: 2,
      outcome: "MASTERED_SUPPORT",
      cueIds: ["effect-window:mastered"],
      constructionIds: ["graph:passed"],
      rationaleCodes: [`M6_FAMILY_${family}`],
      semanticPatches: [transferredSourcePatch],
      overallSimilarity: 0.98,
      definingEffectCoverage: 1,
      elapsedMs: 900,
    }],
  };

  const bridge = new PracticeM6ExecutionBridgeV1(runtime, brain);
  const reconstruction = await bridge.reconstruct({
    sessionId: "practice:new",
    editTypeId: knowledge.editTypeId,
    editTypeKnowledge: knowledge,
    attempt: 1,
    reference,
    baseline: {
      baselineId: "baseline:new",
      timelineRef: "ae:comp:new",
      evidenceRefs: ["baseline:new"],
    },
    matches: [],
    audioMatch: {
      matchId: "audio:beat-aware",
      sourceId: "song:raw",
      segments: [],
      beatGrid: {
        beatTimesMs: [100, 600, 1100],
        estimatedBpm: 120,
        confidence: 0.98,
        evidenceRefs: ["audio:beat-aware:grid"],
      },
      overallConfidence: 0.99,
      evidenceRefs: ["audio:beat-aware"],
    },
    priorAttempts: [],
  });

  assert.ok(capturedPrepareAttempt);
  assert.equal(capturedPrepareAttempt.subjectMotionTracks.length, 1);
  assert.equal(capturedPrepareAttempt.subjectMotionTracks[0].shotId, "shot:001");
  assert.equal(capturedPrepareAttempt.subjectMotionTracks[0].semanticId, "subject:primary:v1");
  assert.equal(capturedPrepareAttempt.subjectMotionTracks[0].usableForReconstruction, true);
  assert.equal(capturedPrepareAttempt.subjectMotionTracks[0].sampleCount, 7);
  assert.ok(capturedRequest);
  assert.equal(capturedRequest.risk, "HIGH");
  assert.match(capturedRequest.learnedTechniqueId, /^edit-type:/);
  assert.ok(capturedRequest.learnedGraph);
  assert.ok(
    capturedRequest.evidenceRefs.some((item) =>
      item === "practice-edit-type-transferred-patches:1"),
  );
  assert.ok(capturedRequest.evidenceRefs.includes("audio:beat-aware:grid"));
  assert.ok(capturedRequest.evidenceRefs.includes(
    "practice-subject-motion-tracks-before-effect:1",
  ));
  assert.ok(capturedRequest.evidenceRefs.includes(
    "practice-proactive-subject-relative-tracks-before-effect:1",
  ));
  assert.ok(
    capturedRequest.evidenceRefs.some((item) =>
      item.startsWith("practice-proactive-subject-relative-track:subject-track:shot:001:")),
  );
  assert.ok(
    reconstruction.decisionTraces[0].cueIds.some((item) =>
      item.startsWith("subject-motion-track:subject-track:shot:001:")),
  );
  assert.ok(
    reconstruction.decisionTraces[0].cueIds.some((item) =>
      item.startsWith("subject-relative-proactive-isolation:subject-track:shot:001:")),
  );
  assert.ok(
    reconstruction.decisionTraces[0].rationaleCodes
      .includes("REFERENCE_SUBJECT_MOTION_TRACK_RETAINED"),
  );
  assert.ok(
    reconstruction.decisionTraces[0].rationaleCodes
      .includes("REFERENCE_PROACTIVE_SUBJECT_RELATIVE_ISOLATION"),
  );
  assert.ok(reconstruction.decisionTraces[0].cueIds.includes("effect-anchor-beat:ON_BEAT"));
  assert.ok(reconstruction.decisionTraces[0].cueIds.includes("effect-anchor-beat-offset-ms:0.000"));
  assert.ok(
    reconstruction.decisionTraces[0].rationaleCodes
      .includes("REFERENCE_EFFECT_ANCHOR_ON_BEAT"),
  );

  const learnedNode = capturedRequest.learnedGraph.nodes
    .find((item) => item.nodeId === nodeId);
  assert.ok(learnedNode);
  assert.ok(learnedNode.parameters[invariant.metric] > prior);
});

test("M6 Practice composition preserves raw-audio matching", async () => {
  const expected = {
    matchId: "audio:match:1",
    sourceId: "song:raw",
    segments: [],
    overallConfidence: 0.99,
    evidenceRefs: ["audio:matched"],
  };
  const adapters = composePracticeM6ExecutionAdaptersV1(
    {
      async reconstruct() { throw new Error("not used"); },
      async evaluate() { throw new Error("not used"); },
    },
    {
      async analyzeFinish() { throw new Error("not used"); },
      async indexStart() { throw new Error("not used"); },
      async matchScenes() { return []; },
      async matchAudio() { return expected; },
      async buildContentBaseline() { throw new Error("not used"); },
    },
  );
  assert.equal(typeof adapters.matchAudio, "function");
  const actual = await adapters.matchAudio({});
  assert.equal(actual?.sourceId, "song:raw");
  assert.equal(actual?.overallConfidence, 0.99);
});

test("Practice M6 current-AE runtime lowers a reference graph onto the matched shot layer", async () => {
  const family = classifyEffectFamilyV1(referenceEvidence);
  const graph = buildConstructionGraphV1(
    deriveEffectAnatomyV1(referenceEvidence, family),
  );
  const runtimeReference = {
    ...reference,
    sourcePath: "C:\\Finish\\reference.mp4",
    video: {
      fps: 30,
      frameCount: 16,
      width: 640,
      height: 360,
      durationMs: 500,
    },
  };
  const match = {
    shotId: "shot:001",
    sourceId: "raw:movie",
    sourcePath: "C:\\Media\\movie.mp4",
    sourceStartMs: 1000,
    sourceEndMs: 1500,
    direction: "FORWARD",
    playbackRate: 1,
    appearanceSimilarity: 1,
    temporalSimilarity: 1,
    motionSimilarity: 1,
    confidence: 1,
    evidenceRefs: ["match:exact"],
  };
  const baselinePlan = {
    schema: "editflow.practice-ae-baseline-plan.v1",
    baselineId: "baseline:native",
    referenceId: runtimeReference.referenceId,
    compStableId: "PRACTICE_BASELINE_COMP_NATIVE",
    durationMs: 500,
    frameRate: 30,
    audioMatchId: null,
    operations: [{
      operationId: "baseline:native:op:001",
      command: "layer.add_media",
      capabilityId: "ae.layer.create",
      payload: { stableId: "PRACTICE_SHOT_NATIVE_0001" },
    }],
    evidenceRefs: ["baseline:native"],
  };
  const baseline = {
    baselineId: baselinePlan.baselineId,
    timelineRef: "ae:comp:" + baselinePlan.compStableId,
    evidenceRefs: ["baseline:native"],
  };

  let capturedPlan = null;
  const transaction = {
    maxOperations: 64,
    async observe() {
      return {
        projectId: "project",
        projectRevision: "1",
        projectFingerprint: "project-fingerprint",
        environmentFingerprint: "environment-fingerprint",
      };
    },
    async execute(plan) {
      capturedPlan = plan;
      return {
        transactionId: "tx:native",
        state: "COMMITTED",
        recovered: false,
        appliedOperations: plan.operations.length,
      };
    },
    async executeCorrection(plan) {
      capturedPlan = plan;
      return {
        transactionId: "tx:native:correction",
        state: "COMMITTED",
        recovered: false,
        appliedOperations: plan.operations.length,
      };
    },
  };
  const mediaCalls = [];
  const media = {
    async analyzeVideo(input) {
      mediaCalls.push(input);
      return { ...referenceEvidence, sourceId: input.sourceId, sourceKind: input.sourceKind };
    },
    async compareContentStructure() { throw new Error("not used"); },
  };

  const renderDriver = {
    async prepareAttempt() {
      return { evidenceRefs: ["render-driver:prepared"] };
    },
    async renderWindow() {
      return {
        renderPath: "C:\\Renders\\practice-window.mp4",
        evidenceRefs: ["render-driver:window"],
      };
    },
    async renderFullEdit() {
      return {
        renderPath: "C:\\Renders\\practice-full.mp4",
        evidenceRefs: ["render-driver:full"],
      };
    },
  };
  const subjectIsolationInputs = [];
  const runtime = new PracticeM6CurrentAeRuntimeV1({
    transaction,
    baselineBuilder: {
      plan(id) { return id === baselinePlan.baselineId ? baselinePlan : null; },
    },
    media,
    renderDriver,
    subjectIsolationRoute: {
      async prepare(input) {
        subjectIsolationInputs.push(input);
        return {
          ...(await verifiedSubjectIsolationRoute.prepare(input)),
          appliedOperations: 1,
        };
      },
    },
    availableCapabilities: [...new Set(
      graph.nodes.flatMap((node) => node.capabilityCandidates),
    )],
  });

  const retainedSubjectMotionTrack = {
    schema: "editflow.practice-reference-subject-motion-track.v1",
    trackId: "subject-track:shot:001:subject:primary:v1",
    shotId: "shot:001",
    semanticId: "subject:primary:v1",
    referenceStartMs: 0,
    referenceEndMs: 500,
    sampleCount: 3,
    identityCoverage: 1,
    observedCoverage: 1,
    meanIdentityConfidence: 0.91,
    continuityVerified: true,
    usableForReconstruction: true,
    relativeMotionPeak: 0.2,
    relativeMotionMean: 0.09,
    relativeMotionDirection: { x: 0.12, y: -0.16 },
    samples: [
      {
        timeMs: 50,
        trackState: "OBSERVED",
        identityConfidence: 0.91,
        visibility: 0.96,
        subjectMotion: { x: 0.05, y: 0 },
        backgroundMotion: { x: 0.01, y: 0 },
        relativeMotion: { x: 0.04, y: 0 },
        subjectBoundingBox: [0.25, 0.18, 0.42, 0.7],
        evidenceRefs: ["test:subject-relative-sample:50"],
      },
      {
        timeMs: 150,
        trackState: "OBSERVED",
        identityConfidence: 0.94,
        visibility: 0.98,
        subjectMotion: { x: 0.14, y: -0.17 },
        backgroundMotion: { x: 0.02, y: -0.01 },
        relativeMotion: { x: 0.12, y: -0.16 },
        subjectBoundingBox: [0.28, 0.18, 0.42, 0.7],
        evidenceRefs: ["test:subject-relative-sample:150"],
      },
      {
        timeMs: 190,
        trackState: "OBSERVED",
        identityConfidence: 0.92,
        visibility: 0.97,
        subjectMotion: { x: 0.04, y: 0 },
        backgroundMotion: { x: 0.01, y: 0 },
        relativeMotion: { x: 0.03, y: 0 },
        subjectBoundingBox: [0.31, 0.18, 0.42, 0.7],
        evidenceRefs: ["test:subject-relative-sample:190"],
      },
    ],
    evidenceRefs: ["test:retained-subject-motion-track"],
  };
  await runtime.prepareAttempt({
    sessionId: "practice:native",
    editTypeId: "spider-man-high-potency",
    editTypeKnowledge: {},
    attempt: 1,
    reference: runtimeReference,
    baseline,
    matches: [match],
    subjectMotionTracks: [retainedSubjectMotionTrack],
    priorAttempts: [],
  });
  const window = {
    windowId: "window:native",
    startIndex: 0,
    endIndex: 6,
    anchorIndex: 3,
    startMs: 0,
    endMs: 200,
    anchorMs: 100,
    peakEnergy: 0.5,
    evidence: referenceEvidence,
  };
  await runtime.applyWindowGraph({
    sessionId: "practice:native",
    attempt: 1,
    reference: runtimeReference,
    baseline,
    window,
    referenceWindow: {
      windowId: "window:native",
      objectCue: {
        objectAware: true,
        relation: "SUBJECT_DOMINANT",
        evidencePersistence: 1,
        subjectSeparationPeak: 0.42,
        subjectBackgroundDivergencePeak: 0.18,
        subjectMotionPeak: 0.2,
        backgroundMotionPeak: 0.01,
        subjectMotionDirection: { x: 0.12, y: -0.16 },
        backgroundMotionDirection: { x: 0.01, y: 0 },
        maskCoveragePeak: 0.25,
        validatedMaskCoveragePeak: 0.25,
        maskTruthValidated: true,
        subjectIdentityContinuityVerified: true,
        subjectIdentityCoverage: 1,
        occlusionPeak: 0,
      },
      anchorBeatCue: {
        eventMs: 100,
        nearestBeatMs: 600,
        beatIntervalMs: 1000,
        offsetMs: -500,
        offsetBeats: -0.5,
        alignment: "OFF_BEAT",
        confidence: 0.98,
        evidenceRefs: ["test:beat-anchor:off-beat"],
      },
    },
    graph,
  });

  assert.equal(subjectIsolationInputs.length, 1);
  assert.equal(subjectIsolationInputs[0].shotId, "shot:001");
  assert.equal(subjectIsolationInputs[0].referenceSemanticId, retainedSubjectMotionTrack.semanticId);
  assert.ok(capturedPlan);
  assert.ok(capturedPlan.operations.length > 0);
  assert.match(String(capturedPlan.planId), /^practice-m6:practice:native:1:window:native:/);
  assert.match(JSON.stringify(capturedPlan), /PRACTICE_BASELINE_COMP_NATIVE/);
  assert.match(JSON.stringify(capturedPlan), /PRACTICE_SHOT_NATIVE_0001/);
  assert.ok(capturedPlan.recipeRefs.includes(retainedSubjectMotionTrack.trackId));
  assert.ok(capturedPlan.recipeRefs.includes(
    "practice-subject-relative-effect-anchor:" + retainedSubjectMotionTrack.trackId,
  ));
  assert.ok(capturedPlan.recipeRefs.includes(
    "practice-subject-relative-effect-steering:" + retainedSubjectMotionTrack.trackId,
  ));
  assert.match(
    capturedPlan.creativeObjective,
    /Preserve the retained Finish subject-relative motion track/,
  );
  assert.match(capturedPlan.creativeObjective, /relative-motion peak 0\.2000/);
  assert.match(
    capturedPlan.creativeObjective,
    /Anchor the native effect peak to the retained subject-relative motion peak at 150\.000 ms/,
  );
  assert.match(
    capturedPlan.creativeObjective,
    /direction \(0\.600000, -0\.800000\) while preserving the reference effect amplitudes/,
  );
  const nativeEventExpressions = capturedPlan.operations
    .filter((operation) => operation.input?.command === "property.set_expression")
    .map((operation) => operation.input?.payload?.expression)
    .filter((value) => typeof value === "string");
  assert.ok(nativeEventExpressions.some((value) => value.includes("var event=0.15;")));
  assert.ok(nativeEventExpressions.some((value) =>
    value.includes("var directionX=0.6;")
      && value.includes("var directionY=-0.8;")
      && value.includes("var dx=-directionX*amplitude*stateScale*envelope;")
      && value.includes("var dy=-directionY*amplitude*stateScale*envelope;")
      && value.includes("return [0,impulse];")
      && value.includes("var dx=d0[0]+d1[0];")
      && value.includes("var dy=d0[1]+d1[1];")),
  JSON.stringify(nativeEventExpressions));
  const blurDirectionWrites = capturedPlan.operations
    .filter((operation) => operation.input?.command === "effect.set_property")
    .filter((operation) => operation.input?.payload?.propertyPath?.includes("ADBE Motion Blur-0001"))
    .map((operation) => operation.input?.payload?.value)
    .filter((value) => typeof value === "number");
  const expectedBlurDirection = Math.atan2(-0.8, 0.6) * 180 / Math.PI;
  assert.ok(blurDirectionWrites.some((value) =>
    Math.abs(value - expectedBlurDirection) < 1e-9));

  const rendered = await runtime.renderWindowEvidence({
    sessionId: "practice:native",
    attempt: 1,
    reference: runtimeReference,
    baseline,
    window,
    graph,
  });
  assert.equal(rendered.sourceKind, "RENDER");
  assert.equal(mediaCalls.at(-1)?.videoPath, "C:\\Renders\\practice-window.mp4");
  assert.equal(mediaCalls.at(-1)?.startMs, 0);
  assert.equal(mediaCalls.at(-1)?.endMs, 200);

  const fullRender = await runtime.renderFullEdit({
    sessionId: "practice:native",
    attempt: 1,
    reference: runtimeReference,
    baseline,
  });
  assert.ok(fullRender.evidenceRefs.includes("practice-m6-beat-anchor:OFF_BEAT:-500.000"));
  assert.ok(fullRender.evidenceRefs.includes("practice-effect-anchor-beat-event-ms:100.000"));
  assert.ok(fullRender.evidenceRefs.includes("practice-effect-anchor-beat-offset-ms:-500.000"));
  assert.ok(fullRender.evidenceRefs.includes(
    "practice-m6-subject-motion-track:" + retainedSubjectMotionTrack.trackId,
  ));
  assert.ok(fullRender.evidenceRefs.includes(
    "practice-m6-subject-relative-motion-peak:0.200000",
  ));
  assert.ok(fullRender.evidenceRefs.includes(
    "practice-subject-relative-isolation-mode:PROACTIVE",
  ));
  assert.ok(fullRender.evidenceRefs.includes(
    "practice-proactive-subject-relative-track:" + retainedSubjectMotionTrack.trackId,
  ));
  assert.ok(fullRender.evidenceRefs.includes(
    "practice-proactive-subject-relative-relation:SUBJECT_DOMINANT",
  ));
  assert.ok(fullRender.evidenceRefs.includes(
    "practice-m6-subject-relative-effect-anchor-ms:150.000",
  ));
  assert.ok(fullRender.evidenceRefs.includes(
    "practice-m6-subject-relative-effect-anchor-phase:0.750000",
  ));
  assert.ok(fullRender.evidenceRefs.includes(
    "practice-m6-subject-relative-effect-anchor-magnitude:0.200000",
  ));
  assert.ok(fullRender.evidenceRefs.includes(
    "practice-m6-subject-relative-effect-steering-direction:0.600000,-0.800000",
  ));
  assert.ok(fullRender.evidenceRefs.some((ref) =>
    ref.startsWith("practice-subject-relative-effect-steering-parameter:")
      && ref.endsWith(":fragmentationStateSeparationDirection")));
  assert.ok(fullRender.evidenceRefs.some((ref) =>
    ref.startsWith("practice-subject-relative-effect-steering-parameter:")
      && ref.endsWith(":blurDirectionVector")));
  assert.ok(fullRender.evidenceRefs.includes(
    "practice-m6-subject-relative-effect-steering-count:2",
  ));
  assert.ok(fullRender.evidenceRefs.includes("test:subject-relative-sample:150"));

  const isolationGraph = {
    ...graph,
    graphId: graph.graphId + ":subject-isolation-gate",
    nodes: [
      ...graph.nodes,
      {
        nodeId: "test:subject-isolation",
        kind: "SUBJECT_ISOLATION",
        dimension: "ISOLATION",
        dependsOn: [],
        requiredInvariantIds: [],
        capabilityCandidates: ["ae.subject.isolate", "ae.layer.matte.set"],
        parameters: {},
        optional: false,
      },
    ],
  };
  const blockedRuntime = new PracticeM6CurrentAeRuntimeV1({
    transaction,
    baselineBuilder: {
      plan(id) { return id === baselinePlan.baselineId ? baselinePlan : null; },
    },
    media,
    renderDriver,
    availableCapabilities: [...new Set(
      isolationGraph.nodes.flatMap((node) => node.capabilityCandidates),
    )],
  });
  await blockedRuntime.prepareAttempt({
    sessionId: "practice:native:blocked",
    editTypeId: "spider-man-high-potency",
    editTypeKnowledge: {},
    attempt: 1,
    reference: runtimeReference,
    baseline,
    matches: [match],
    priorAttempts: [],
  });
  await assert.rejects(
    () => blockedRuntime.applyWindowGraph({
      sessionId: "practice:native:blocked",
      attempt: 1,
      reference: runtimeReference,
      baseline,
      window,
      graph: isolationGraph,
    }),
    /PRACTICE_M6_SUBJECT_ISOLATION_ROUTE_UNVERIFIED/,
  );
});

test("Practice M6 applies a cut-spanning transition to both participating shot layers", async () => {
  const family = classifyEffectFamilyV1(referenceEvidence);
  const graph = buildConstructionGraphV1(
    deriveEffectAnatomyV1(referenceEvidence, family),
  );
  const runtimeReference = {
    ...reference,
    shots: [
      {
        shotId: "shot:001",
        order: 0,
        referenceStartMs: 0,
        referenceEndMs: 250,
        evidenceRefs: ["shot:001"],
      },
      {
        shotId: "shot:002",
        order: 1,
        referenceStartMs: 250,
        referenceEndMs: 500,
        evidenceRefs: ["shot:002"],
      },
    ],
    sourcePath: "C:\\Finish\\reference.mp4",
    video: {
      fps: 30,
      frameCount: 16,
      width: 640,
      height: 360,
      durationMs: 500,
    },
  };
  const makeMatch = (shotId, sourceId, sourcePath, startMs) => ({
    shotId,
    sourceId,
    sourcePath,
    sourceStartMs: startMs,
    sourceEndMs: startMs + 250,
    direction: "FORWARD",
    playbackRate: 1,
    appearanceSimilarity: 1,
    temporalSimilarity: 1,
    motionSimilarity: 1,
    confidence: 1,
    evidenceRefs: ["match:" + shotId],
  });
  const matches = [
    makeMatch("shot:001", "raw:a", "C:\\Media\\a.mp4", 1000),
    makeMatch("shot:002", "raw:b", "C:\\Media\\b.mp4", 2000),
  ];
  const baselinePlan = {
    schema: "editflow.practice-ae-baseline-plan.v1",
    baselineId: "baseline:cut-span",
    referenceId: runtimeReference.referenceId,
    compStableId: "PRACTICE_BASELINE_COMP_CUT_SPAN",
    durationMs: 500,
    frameRate: 30,
    audioMatchId: null,
    operations: [
      {
        operationId: "baseline:cut-span:op:001",
        command: "layer.add_media",
        capabilityId: "ae.layer.create",
        payload: { stableId: "PRACTICE_SHOT_CUT_0001" },
      },
      {
        operationId: "baseline:cut-span:op:002",
        command: "layer.add_media",
        capabilityId: "ae.layer.create",
        payload: { stableId: "PRACTICE_SHOT_CUT_0002" },
      },
    ],
    evidenceRefs: ["baseline:cut-span"],
  };
  const baseline = {
    baselineId: baselinePlan.baselineId,
    timelineRef: "ae:comp:" + baselinePlan.compStableId,
    evidenceRefs: ["baseline:cut-span"],
  };

  const capturedPlans = [];
  const transaction = {
    maxOperations: 64,
    async observe() {
      return {
        projectId: "project",
        projectRevision: String(capturedPlans.length + 1),
        projectFingerprint: "project-fingerprint-" + String(capturedPlans.length),
        environmentFingerprint: "environment-fingerprint",
      };
    },
    async execute(plan) {
      capturedPlans.push(plan);
      return {
        transactionId: "tx:cut:" + String(capturedPlans.length),
        state: "COMMITTED",
        recovered: false,
        appliedOperations: plan.operations.length,
      };
    },
    async executeCorrection(plan) {
      return this.execute(plan);
    },
  };
  const runtime = new PracticeM6CurrentAeRuntimeV1({
    transaction,
    baselineBuilder: {
      plan(id) { return id === baselinePlan.baselineId ? baselinePlan : null; },
    },
    media: {
      async analyzeVideo() { return referenceEvidence; },
      async compareContentStructure() { throw new Error("not used"); },
    },
    renderDriver: {
      async prepareAttempt() { return {}; },
      async renderWindow() { throw new Error("not used"); },
      async renderFullEdit() { throw new Error("not used"); },
    },
    subjectIsolationRoute: verifiedSubjectIsolationRoute,
    availableCapabilities: [...new Set(
      graph.nodes.flatMap((node) => node.capabilityCandidates),
    )],
  });
  await runtime.prepareAttempt({
    sessionId: "practice:cut-span",
    editTypeId: "spider-man-high-potency",
    editTypeKnowledge: {},
    attempt: 1,
    reference: runtimeReference,
    baseline,
    matches,
    priorAttempts: [],
  });
  await runtime.applyWindowGraph({
    sessionId: "practice:cut-span",
    attempt: 1,
    reference: runtimeReference,
    baseline,
    window: {
      windowId: "window:cut-span",
      startIndex: 0,
      endIndex: 6,
      anchorIndex: 3,
      startMs: 100,
      endMs: 400,
      anchorMs: 250,
      peakEnergy: 0.5,
      evidence: referenceEvidence,
    },
    graph,
  });

  assert.equal(capturedPlans.length, 2);
  assert.match(JSON.stringify(capturedPlans[0]), /PRACTICE_SHOT_CUT_0001/);
  assert.match(JSON.stringify(capturedPlans[1]), /PRACTICE_SHOT_CUT_0002/);
  assert.match(String(capturedPlans[0].planId), /shot:001/);
  assert.match(String(capturedPlans[1].planId), /shot:002/);
});

test("Practice M6 current-AE assembly connects media, baseline, M6, render, and audio adapters", () => {
  const assembly = createPracticeM6CurrentAeAssemblyV1({
    transport: {
      async dispatch() {
        throw new Error("constructor test must not contact AE");
      },
    },
    projectId: "after-effects-project",
    repositoryRoot: "C:\\EditFlow-2.0",
    artifactDir: "C:\\EditFlow-2.0\\.tmp\\practice",
    mediaRoots: ["C:\\Media"],
  });
  assert.equal(typeof assembly.adapters.analyzeFinish, "function");
  assert.equal(typeof assembly.adapters.matchAudio, "function");
  assert.equal(typeof assembly.adapters.reconstruct, "function");
  assert.equal(typeof assembly.adapters.evaluate, "function");
  assert.equal(assembly.m6Runtime.renderDriver, assembly.renderDriver);
  assert.equal(assembly.m6Runtime.baselineBuilder, assembly.baselineBuilder);
  assert.equal(assembly.mediaMatcher.config.analysisProxyFps, 12);
  assert.equal(assembly.mediaMatcher.config.analysisTimeoutMs, 60 * 60 * 1000);
  assert.match(
    assembly.mediaMatcher.config.analysisCacheDir,
    /proofs[\\/]artifacts[\\/]practice-media-cache$/,
  );
});

const practiceRenderResponse = (request, overrides = {}) => ({
  protocolVersion: "1.1.0",
  requestId: request.requestId,
  transactionId: request.transactionId,
  operationId: request.operationId,
  capabilityId: request.capabilityId,
  command: request.command,
  outcome: "NO_OP",
  error: null,
  affectedObjects: [],
  readback: null,
  projectSnapshot: null,
  environmentProbe: null,
  hostProjectRevision: null,
  diagnostics: {
    adapterProtocolVersion: "1.1.0",
    adapterBuild: "0.1.0-dev.3",
    command: request.command,
  },
  proofArtifactRefs: [],
  ...overrides,
});

const practiceBaselineComp = (hostId, stableId) => ({
  hostId,
  stableId,
  kind: "COMPOSITION",
  name: stableId,
  parentHostId: null,
  comment: "[[EDITFLOW2_STABLE:" + stableId + "]]",
  composition: {
    hostId,
    stableId,
    name: stableId,
    width: 640,
    height: 360,
    pixelAspect: 1,
    duration: 0.5,
    frameRate: 30,
    displayStartTime: 0,
    layers: [],
  },
});

class PracticeAttemptRestoreTransport {
  constructor(compStableId) {
    this.requests = [];
    this.undoStack = [];
    this.project = {
      hostRevision: 30,
      filePath: "C:/EditFlow/practice.aep",
      activeItemHostId: 501,
      itemCount: 1,
      items: [practiceBaselineComp(501, compStableId)],
    };
  }
  mutateAfterAttempt() {
    this.undoStack.push(structuredClone(this.project));
    this.project.items.push(practiceBaselineComp(502, "ATTEMPT_TEMP_COMP"));
    this.project.itemCount = this.project.items.length;
    this.project.activeItemHostId = 502;
    this.project.hostRevision += 1;
  }

  async dispatch(request) {
    this.requests.push(structuredClone(request));
    if (request.command === "host.probe") {
      return practiceRenderResponse(request, {
        environmentProbe: {
          adapterProtocolVersion: "1.1.0",
          adapterBuild: "0.1.0-dev.3",
          hostName: "Adobe After Effects",
          hostVersion: "26.0-test",
          hostBuild: "test-build",
          os: "Windows test",
          projectOpen: true,
        },
        hostProjectRevision: this.project.hostRevision,
      });
    }
    if (request.command === "project.inspect") {
      return practiceRenderResponse(request, {
        projectSnapshot: structuredClone(this.project),
        hostProjectRevision: this.project.hostRevision,
      });
    }
    if (request.command === "transaction.undo_last") {
      const previous = this.undoStack.pop();
      if (previous === undefined) {
        return practiceRenderResponse(request, {
          outcome: "FAILED",
          error: {
            category: "ROLLBACK_FAILURE",
            code: "NO_UNDO_AVAILABLE",
            message: "Nothing to undo.",
          },
          hostProjectRevision: this.project.hostRevision,
        });
      }
      const revision = this.project.hostRevision + 1;
      this.project = previous;
      this.project.hostRevision = revision;
      return practiceRenderResponse(request, {
        outcome: "APPLIED",
        readback: { undone: true },
        hostProjectRevision: revision,
      });
    }
    throw new Error("Unhandled Practice render request: " + request.command);
  }
}

test("Practice M6 retry restores the exact AE baseline and preserves matched-audio identity", async () => {
  const compStableId = "PRACTICE_BASELINE_COMP_RETRY";
  const transport = new PracticeAttemptRestoreTransport(compStableId);
  const driver = new PracticeM6AeRenderDriverCurrentV1({
    transport,
    projectId: "after-effects-project",
    artifactDir: "C:\\EditFlow\\.tmp\\practice-renders",
  });
  const baselinePlan = {
    schema: "editflow.practice-ae-baseline-plan.v1",
    baselineId: "baseline:retry",
    referenceId: "finish:retry",
    compStableId,
    durationMs: 500,
    frameRate: 30,
    audioMatchId: "audio:match:retry",
    operations: [],
    evidenceRefs: ["baseline:retry"],
  };

  const first = await driver.prepareAttempt({
    sessionId: "practice:retry",
    attempt: 1,
    baselinePlan,
  });
  assert.ok(
    first.evidenceRefs?.includes(
      "practice-attempt-audio-preserved:audio:match:retry",
    ),
  );

  transport.mutateAfterAttempt();
  driver.recordAppliedOperations({
    sessionId: "practice:retry",
    attempt: 1,
    count: 1,
  });
  assert.equal(transport.project.itemCount, 2);
  await driver.finalizeAttempt("practice:retry");

  transport.mutateAfterAttempt();
  await assert.rejects(
    driver.prepareAttempt({
      sessionId: "practice:retry",
      attempt: 2,
      baselinePlan,
    }),
    /PRACTICE_ATTEMPT_BASELINE_DRIFT/,
  );
  assert.equal(transport.project.itemCount, 3);
  assert.equal(
    transport.requests.filter((request) =>
      request.command === "transaction.undo_last").length,
    0,
  );
  transport.project = transport.undoStack.pop();

  const second = await driver.prepareAttempt({
    sessionId: "practice:retry",
    attempt: 2,
    baselinePlan,
  });

  assert.equal(transport.project.itemCount, 1);
  assert.equal(
    transport.project.items[0]?.stableId,
    compStableId,
  );
  assert.ok(
    second.evidenceRefs?.includes(
      "practice-attempt-restore-undo-count:1",
    ),
  );
  assert.ok(
    transport.requests.some((request) =>
      request.command === "transaction.undo_last"),
  );
});

test("Practice Current-AE training runtime persists Edit Type allocation across restart", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-practice-runtime-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const learningMemoryFilePath = path.join(root, "practice-learning.json");
  const editTypeRegistryFilePath = path.join(root, "edit-types.json");
  const baseConfig = {
    transport: {
      async dispatch() {
        throw new Error("persistence test must not contact AE");
      },
    },
    projectId: "after-effects-project",
    repositoryRoot: process.cwd(),
    artifactDir: path.join(root, "artifacts"),
    mediaRoots: [root],
    learningMemoryFilePath,
    editTypeRegistryFilePath,
  };

  const runtime = await createPracticeM6CurrentAeTrainingRuntimeV1(baseConfig);
  await runtime.createEditType({
    editTypeId: "high-potency-character-edit",
    title: "High Potency Character Edit",
    choiceWords: ["character potency"],
  });
  runtime.engine.memory.remember({
    sessionId: "practice:persistent:001",
    selectedEditTypeId: "high-potency-character-edit",
    styleFingerprint: "style:persistent",
    baselineId: "baseline:persistent",
    matches: [],
    audioMatch: null,
    attempts: [],
    mastered: false,
    bestAttempt: null,
  });

  const allocation = await runtime.allocateLearning({
    sessionId: "practice:persistent:001",
    editTypeId: "high-potency-character-edit",
  });
  assert.equal(allocation.profileRevision, 2);

  const reloaded = await createPracticeM6CurrentAeTrainingRuntimeV1(baseConfig);
  const retainedProfile = reloaded.engine.editTypes.get(
    "high-potency-character-edit",
  );
  assert.ok(retainedProfile);
  assert.deepEqual(
    retainedProfile.sessionIds,
    ["practice:persistent:001"],
  );
  assert.equal(
    reloaded.engine.memory.get("practice:persistent:001")
      ?.allocatedEditTypeId,
    "high-potency-character-edit",
  );

  const proCreation = reloaded.prepareProCreation({
    sessionId: "pro:persistent:001",
    mode: "PRO_CREATION",
    editTypeId: "high-potency-character-edit",
    start: [{
      mediaId: "raw:video:001",
      uri: path.join(root, "raw-video.mp4"),
      mediaKind: "VIDEO",
      role: "START_SOURCE",
    }],
  });
  assert.equal(proCreation.status, "BLOCKED");
  assert.ok(
    proCreation.reasons.some((reason) => /no transfer-verified GPT Practice knowledge/.test(reason)),
  );
  assert.equal(
    proCreation.knowledge?.totalSessionCount,
    1,
  );
});

test("Practice local media path resolver accepts Windows drive paths without treating C: as a URI scheme", () => {
  const windowsPath = "C:\\Users\\Shadow\\Downloads\\clip [2012].mp4";
  assert.equal(
    resolvePracticeLocalMediaPathV1(windowsPath),
    path.win32.normalize(windowsPath),
  );
  assert.throws(
    () => resolvePracticeLocalMediaPathV1("https://example.com/clip.mp4"),
    /accepts only local file media/,
  );
});


test("GPT Practice assignment persists the full learning trajectory under its Edit Type", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-gpt-practice-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const storePath = path.join(root, "gpt-orchestration.json");
  const store = new GptOrchestrationStoreV1(storePath);
  const registry = new EditTypeRegistryV1();
  registry.create({
    editTypeId: "high-potency",
    title: "High Potency",
  });
  const sessionId = "practice:gpt:001";
  registry.beginGptLearningSession("high-potency", sessionId, "PRACTICE");
  const finish = {
    mediaId: "finish:1",
    role: "FINISH_REFERENCE",
    mediaKind: "VIDEO",
    uri: "C:\\Media\\finish.mp4",
  };
  const start = [{
    mediaId: "video:1",
    role: "START_SOURCE",
    mediaKind: "VIDEO",
    uri: "C:\\Media\\raw.mp4",
  }];
  const assignment = await store.createAssignment({
    sessionId,
    mode: "PRACTICE",
    editTypeId: "high-potency",
    finish,
    start,
    artifactDir: path.join(root, "artifacts"),
    knowledge: registry.knowledge("high-potency"),
  });
  assert.equal(assignment.status, "PENDING");
  assert.match(assignment.chatMessage, /GPT is the orchestrator, creative reasoner, and learner/);
  assert.match(assignment.chatMessage, /all editorial cutting, retiming, remodeling/i);
  assert.match(assignment.chatMessage, /OBSERVATION -> INTERPRETATION -> HYPOTHESIS/);
  assert.match(assignment.chatMessage, /C:\\Media\\finish\.mp4/);

  const claimed = await store.claim(assignment.assignmentId, "chatgpt-work");
  assert.equal(claimed.status, "RUNNING");
  const failure = await store.appendEvent({
    assignmentId: assignment.assignmentId,
    attempt: 1,
    stage: "LESSON",
    outcome: "FAILURE",
    summary: "Static flash failed to reproduce spatial deformation.",
    avoidRepeat: "Do not replace motion-led impacts with luminance-only flashes.",
    developmentPattern: "Observe spatial persistence before selecting effect families.",
    evidenceRefs: ["render:attempt:1"],
  });
  registry.recordGptLearningEvent(failure);
  const success = await store.appendEvent({
    assignmentId: assignment.assignmentId,
    attempt: 2,
    stage: "LESSON",
    outcome: "SUCCESS",
    summary: "Layered displacement and smear matched the reference behavior.",
    reusableLesson: "Scale directional smear and recovery to shot velocity and duration.",
    developmentPattern: "Match source and timing before layering transition behavior.",
    evidenceRefs: ["render:attempt:2", "comparison:attempt:2"],
  });
  registry.recordGptLearningEvent(success);
  const completed = await store.complete(assignment.assignmentId, {
    success: true,
    finalRenderRef: "render:mastered",
    finalSummary: "Reference reconstructed at the proof gate.",
  });
  registry.completeGptLearningSession({
    editTypeId: "high-potency",
    sessionId,
    mode: "PRACTICE",
    mastered: completed.status === "COMPLETED",
    masteryRecord: masteryRecord(sessionId),
  });

  const knowledge = registry.knowledge("high-potency");
  assert.equal(knowledge.masteredSessionCount, 1);
  assert.equal(knowledge.referenceVerifiedPracticeSessionCount, 1);
  assert.equal(knowledge.transferVerifiedPracticeSessionCount, 1);
  assert.deepEqual(
    knowledge.gptLearning.failureAvoidanceLessons,
    ["Do not replace motion-led impacts with luminance-only flashes."],
  );
  assert.deepEqual(
    knowledge.gptLearning.successLessons,
    ["Scale directional smear and recovery to shot velocity and duration."],
  );
  assert.equal(knowledge.gptLearning.developmentPatterns.length, 2);

  const preparation = new ProCreationPreparationEngineV1(registry).prepare({
    sessionId: "pro:gpt:001",
    mode: "PRO_CREATION",
    editTypeId: "high-potency",
    start,
  });
  assert.equal(preparation.status, "READY");
  assert.equal(preparation.knowledge.gptLearning.eventCount, 2);

  const reloaded = new GptOrchestrationStoreV1(storePath);
  assert.equal(
    (await reloaded.getAssignment(assignment.assignmentId)).status,
    "COMPLETED",
  );
  assert.equal((await reloaded.eventsForSession(sessionId)).length, 2);
});


test("GPT cancellation is immediate while queued and cooperative after AE work starts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-gpt-cancel-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const store = new GptOrchestrationStoreV1(
    path.join(root, "gpt-orchestration.json"),
  );
  const start = [{
    mediaId: "video:1",
    role: "START_SOURCE",
    mediaKind: "VIDEO",
    uri: "C:\\Media\\raw.mp4",
  }];
  const queued = await store.createAssignment({
    sessionId: "pro:queued",
    mode: "PRO_CREATION",
    editTypeId: "high-potency",
    finish: null,
    start,
    artifactDir: path.join(root, "queued"),
    knowledge: null,
  });
  const queuedCancelled = await store.requestCancel(queued.assignmentId);
  assert.equal(queuedCancelled.status, "CANCELLED");
  assert.match(queuedCancelled.finalSummary, /before GPT claimed/);

  const running = await store.createAssignment({
    sessionId: "pro:running",
    mode: "PRO_CREATION",
    editTypeId: "high-potency",
    finish: null,
    start,
    artifactDir: path.join(root, "running"),
    knowledge: null,
  });
  await store.claim(running.assignmentId, "chatgpt-work");
  const requested = await store.requestCancel(running.assignmentId);
  assert.equal(requested.status, "CANCEL_REQUESTED");
  assert.ok(requested.cancelRequestedAt);

  const stopped = await store.complete(running.assignmentId, {
    success: true,
    finalRenderRef: "render:must-not-be-certified",
    finalSummary: "Stopped after restoring the last safe AE checkpoint.",
  });
  assert.equal(stopped.status, "CANCELLED");
  assert.equal(stopped.finalRenderRef, null);
  assert.match(stopped.finalSummary, /safe AE checkpoint/);

  const idempotent = await store.requestCancel(running.assignmentId);
  assert.equal(idempotent.status, "CANCELLED");
});
