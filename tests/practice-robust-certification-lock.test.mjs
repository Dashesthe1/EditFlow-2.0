import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPracticeRobustCertificationLockV1,
  derivePracticeMaturityStageV1,
  practiceRetainedTruthAuthorityVerifiedV1,
  practiceRobustCertificationLockMatchesV1,
} from "../.tmp/runtime/packages/practice-homework/src/index.js";

const sha = (digit) => digit.repeat(64);

const authorityReport = ({
  authorityDigit = "a",
  manifestDigit = "b",
  evaluatedAt = "2026-09-24T20:00:00.000Z",
} = {}) => ({
  schema: "editflow.practice-retained-truth-suite-report.v1",
  editTypeId: "edit:lock",
  mode: "CERTIFICATION",
  policy: {
    minimumCases: 20,
    maximumCases: 30,
    minimumTruthCoverage: 0.98,
    minimumDifficultyKinds: 4,
    minimumDistinctSourceSets: 3,
    sourceRangeToleranceMs: 250,
    highConfidenceFalseMatchThreshold: 0.85,
    ambiguousFalseMatchMarginThreshold: 0.08,
  },
  caseCount: 20,
  passedCaseCount: 20,
  distinctCaseIdCount: 20,
  distinctReferenceCount: 20,
  distinctFinishSha256Count: 20,
  distinctSourceSetCount: 4,
  independentTruthCaseCount: 20,
  fullLengthTruthCaseCount: 20,
  difficultyKindCount: 4,
  difficultyKinds: [
    "FAST_CUTS",
    "NEAR_DUPLICATE_SOURCES",
    "STRONG_CAMERA_MOTION",
    "IDENTITY_AMBIGUITY",
  ],
  sceneErrorCount: 0,
  diagnosticCounts: [],
  tuningFocus: [],
  tuningPlan: [],
  certified: true,
  authorityRef: "practice-retained-truth-authority:sha256:" + sha(authorityDigit),
  authorityManifestSha256: sha(manifestDigit),
  reasons: [],
  cases: Array.from({ length: 20 }, (_, index) => ({
    caseId: "truth-case-" + String(index).padStart(2, "0"),
    truthCoverage: 1,
    independentTruthVerified: true,
    fullLengthTruthVerified: true,
    sceneErrorCount: 0,
    passed: true,
    diagnostics: [],
    reasons: [],
    evidenceRefs: [],
  })),
  evidenceRefs: [
    ...Array.from({ length: 20 }, (_, index) =>
      "retained-finish-sha256:" + String(index + 1).padStart(64, "0")),
    "retained-source-sha256:" + sha("c"),
    "retained-source-sha256:" + sha("d"),
    "retained-source-sha256:" + sha("e"),
  ],
  evaluatedAt,
});

const baseLearning = (truthReport) => ({
  practiceSessionIds: [],
  proCreationSessionIds: [],
  masteredPracticeSessionIds: [],
  masteryRecords: [{
    sessionId: "practice:transfer:01",
    scope: "TRANSFER_VERIFIED",
    effectFamilyIds: ["TRAIL"],
  }],
  heldOutCases: [],
  heldOutBenchmarks: [],
  retainedTruthSuiteReports: [truthReport],
  eventCount: 0,
  successLessons: [],
  failureAvoidanceLessons: [],
  developmentPatterns: [],
  capabilityGaps: [],
  learnedSkills: [{
    skillId: "skill:trail",
    maturity: "TRANSFER_VERIFIED",
  }],
});

const profileWith = (learning) => ({
  schema: "editflow.edit-type-profile.v1",
  editTypeId: "edit:lock",
  title: "Certification Lock",
  choiceWords: [],
  revision: 1,
  sessionIds: [],
  masteredSessionIds: [],
  behaviorEvidence: [],
  gptLearning: learning,
});

const robustBenchmark = (lock) => ({
  schema: "editflow.practice-held-out-benchmark.v1",
  editTypeId: "edit:lock",
  objectAwareVerified: true,
  subjectRelativeDirectionVerified: true,
  subjectRelativeDirectionDiversityVerified: true,
  subjectContinuityHardCaseVerified: true,
  subjectContinuityChallengeDiversityVerified: true,
  effectFamilyCoverageVerified: true,
  learnedSkillCoverageVerified: true,
  professionalBenchmarkCoverageVerified: true,
  robust: true,
  robustCertificationLock: lock,
});

test("ROBUST certification lock binds current retained truth, skills, and effect families", () => {
  const truthReport = authorityReport();
  assert.equal(practiceRetainedTruthAuthorityVerifiedV1(truthReport), true);

  const learning = baseLearning(truthReport);
  const lock = buildPracticeRobustCertificationLockV1(learning);
  assert.ok(lock);
  assert.deepEqual(lock.transferVerifiedSkillIds, ["skill:trail"]);
  assert.deepEqual(lock.transferVerifiedEffectFamilyIds, ["TRAIL"]);
  assert.equal(practiceRobustCertificationLockMatchesV1(lock, learning), true);

  const certifiedLearning = {
    ...learning,
    heldOutBenchmarks: [robustBenchmark(lock)],
  };
  assert.equal(
    derivePracticeMaturityStageV1(profileWith(certifiedLearning)),
    "ROBUST",
  );
});

test("new transfer knowledge invalidates a stale ROBUST lock", () => {
  const truthReport = authorityReport();
  const learning = baseLearning(truthReport);
  const lock = buildPracticeRobustCertificationLockV1(learning);
  assert.ok(lock);

  const changedSkillLearning = {
    ...learning,
    learnedSkills: [
      ...learning.learnedSkills,
      { skillId: "skill:new", maturity: "TRANSFER_VERIFIED" },
    ],
    heldOutBenchmarks: [robustBenchmark(lock)],
  };
  assert.equal(
    practiceRobustCertificationLockMatchesV1(lock, changedSkillLearning),
    false,
  );
  assert.equal(
    derivePracticeMaturityStageV1(profileWith(changedSkillLearning)),
    "OBJECT_AWARE_VERIFIED",
  );

  const changedEffectLearning = {
    ...learning,
    masteryRecords: [
      ...learning.masteryRecords,
      {
        sessionId: "practice:transfer:02",
        scope: "TRANSFER_VERIFIED",
        effectFamilyIds: ["MOTION_WARP"],
      },
    ],
    heldOutBenchmarks: [robustBenchmark(lock)],
  };
  assert.equal(
    practiceRobustCertificationLockMatchesV1(lock, changedEffectLearning),
    false,
  );
  assert.equal(
    derivePracticeMaturityStageV1(profileWith(changedEffectLearning)),
    "OBJECT_AWARE_VERIFIED",
  );
});

test("new retained truth authority invalidates the prior ROBUST lock", () => {
  const truthReport = authorityReport();
  const learning = baseLearning(truthReport);
  const lock = buildPracticeRobustCertificationLockV1(learning);
  assert.ok(lock);

  const refreshedTruth = authorityReport({
    authorityDigit: "f",
    manifestDigit: "1",
    evaluatedAt: "2026-09-24T21:00:00.000Z",
  });
  const changedLearning = {
    ...learning,
    retainedTruthSuiteReports: [truthReport, refreshedTruth],
    heldOutBenchmarks: [robustBenchmark(lock)],
  };
  assert.equal(
    practiceRobustCertificationLockMatchesV1(lock, changedLearning),
    false,
  );
  assert.equal(
    derivePracticeMaturityStageV1(profileWith(changedLearning)),
    "OBJECT_AWARE_VERIFIED",
  );
});

test("synthetic truth reports cannot mint a ROBUST lock", () => {
  const report = {
    ...authorityReport(),
    authorityRef: undefined,
    authorityManifestSha256: undefined,
  };
  assert.equal(practiceRetainedTruthAuthorityVerifiedV1(report), false);
  assert.equal(buildPracticeRobustCertificationLockV1(baseLearning(report)), null);
});
