import assert from "node:assert/strict";
import test from "node:test";

import {
  EditTypeRegistryV1,
  evaluatePracticeRetainedTruthSuiteV1,
} from "../.tmp/runtime/packages/practice-homework/src/index.js";

const sha256 = (value) => value.toString(16).padStart(64, "0");
const difficulties = [
  "FAST_CUTS",
  "NEAR_DUPLICATE_SOURCES",
  "STRONG_CAMERA_MOTION",
  "IDENTITY_AMBIGUITY",
];

const sceneMatch = (index, shot, sourceId, startMs, endMs) => ({
  shotId: shot,
  sourceId,
  sourceStartMs: startMs,
  sourceEndMs: endMs,
  direction: "FORWARD",
  playbackRate: 1,
  appearanceSimilarity: 0.98,
  temporalSimilarity: 0.97,
  motionSimilarity: 0.96,
  confidence: 0.94,
  candidateScore: 0.95,
  runnerUpScore: 0.72,
  candidateMargin: 0.23,
  evidenceRefs: [
    "machine:case:" + String(index) + ":" + shot,
  ],
});

const retainedCase = (index) => {
  const caseId = "truth-case-" + String(index).padStart(2, "0");
  const sourceA = "source:" + String(index) + ":a";
  const sourceB = "source:" + String(index) + ":b";
  const truth = {
    caseId,
    referenceId: "finish:" + String(index),
    finishSha256: sha256(index + 1),
    referenceDurationMs: 2000,
    sourceMediaSha256: [sha256(1000 + index), sha256(2000 + index)],
    truthAuthority: index % 2 === 0
      ? "INDEPENDENT_HUMAN"
      : "INDEPENDENT_VERIFIER",
    difficultyTags: [difficulties[index % difficulties.length]],
    shots: [{
      shotId: "shot:a",
      order: 0,
      referenceStartMs: 0,
      referenceEndMs: 1000,
      expectedSourceId: sourceA,
      expectedSourceStartMs: 10000,
      expectedSourceEndMs: 11000,
      expectedDirection: "FORWARD",
      truthEvidenceRefs: ["truth:" + caseId + ":a"],
    }, {
      shotId: "shot:b",
      order: 1,
      referenceStartMs: 1000,
      referenceEndMs: 2000,
      expectedSourceId: sourceB,
      expectedSourceStartMs: 20000,
      expectedSourceEndMs: 21000,
      expectedDirection: "FORWARD",
      truthEvidenceRefs: ["truth:" + caseId + ":b"],
    }],
    evidenceRefs: ["truth:" + caseId],
  };
  return {
    truth,
    observation: {
      caseId,
      matches: [
        sceneMatch(index, "shot:a", sourceA, 10000, 11000),
        sceneMatch(index, "shot:b", sourceB, 20000, 21000),
      ],
      evidenceRefs: ["observed:" + caseId],
    },
  };
};

const certificationCases = () =>
  Array.from({ length: 20 }, (_, index) => retainedCase(index));

test("20 independent full-length truth cases can certify scene retrieval and persist", () => {
  const report = evaluatePracticeRetainedTruthSuiteV1({
    editTypeId: "truth-certified-edit",
    mode: "CERTIFICATION",
    cases: certificationCases(),
  });

  assert.equal(report.certified, true);
  assert.equal(report.caseCount, 20);
  assert.equal(report.passedCaseCount, 20);
  assert.equal(report.distinctCaseIdCount, 20);
  assert.equal(report.distinctReferenceCount, 20);
  assert.equal(report.distinctFinishSha256Count, 20);
  assert.equal(report.distinctSourceSetCount, 20);
  assert.equal(report.policy.minimumDistinctSourceSets, 3);
  assert.equal(report.independentTruthCaseCount, 20);
  assert.equal(report.fullLengthTruthCaseCount, 20);
  assert.equal(report.difficultyKindCount, 4);
  assert.equal(report.sceneErrorCount, 0);
  assert.deepEqual(report.diagnosticCounts, []);
  assert.deepEqual(report.reasons, []);

  const registry = new EditTypeRegistryV1();
  registry.create({
    editTypeId: "truth-certified-edit",
    title: "Truth Certified Edit",
  });
  registry.recordRetainedTruthSuite(report);
  const knowledge = registry.knowledge("truth-certified-edit");
  assert.ok(knowledge);
  assert.equal(knowledge.maturityStage, null);
  assert.equal(knowledge.gptLearning.retainedTruthSuiteReports.length, 1);
  assert.equal(
    knowledge.gptLearning.retainedTruthSuiteReports[0].certified,
    true,
  );
});

test("certification rejects many Finishes backed by one repeated Start source set", () => {
  const cases = certificationCases();
  const repeatedSourceSet = [sha256(9001), sha256(9002)];
  for (let index = 0; index < cases.length; index += 1) {
    cases[index] = {
      ...cases[index],
      truth: {
        ...cases[index].truth,
        sourceMediaSha256: repeatedSourceSet,
      },
    };
  }

  const report = evaluatePracticeRetainedTruthSuiteV1({
    editTypeId: "truth-source-set-reuse",
    mode: "CERTIFICATION",
    cases,
  });
  assert.equal(report.passedCaseCount, 20);
  assert.equal(report.distinctSourceSetCount, 1);
  assert.equal(report.certified, false);
  assert.ok(report.reasons.some((reason) =>
    /fewer than 3 distinct content-addressed Start source sets/.test(reason)));
});

test("MEASURE_ONLY keeps diagnostics but cannot certify generalization", () => {
  const report = evaluatePracticeRetainedTruthSuiteV1({
    editTypeId: "truth-measure-only",
    mode: "MEASURE_ONLY",
    cases: certificationCases(),
  });
  assert.equal(report.passedCaseCount, 20);
  assert.equal(report.sceneErrorCount, 0);
  assert.equal(report.certified, false);
  assert.ok(report.reasons.some((reason) => /MEASURE_ONLY/.test(reason)));
});

test("wrong-source matches are categorized for retrieval tuning", () => {
  const cases = certificationCases();
  const first = cases[0];
  cases[0] = {
    ...first,
    observation: {
      ...first.observation,
      matches: first.observation.matches.map((match, index) => index === 0
        ? {
          ...match,
          sourceId: "source:wrong",
          confidence: 0.97,
          candidateMargin: 0.03,
        }
        : match),
    },
  };
  const report = evaluatePracticeRetainedTruthSuiteV1({
    editTypeId: "truth-false-match",
    mode: "CERTIFICATION",
    cases,
  });
  assert.equal(report.certified, false);
  assert.equal(report.passedCaseCount, 19);
  assert.equal(report.sceneErrorCount, 1);
  const firstReport = report.cases[0];
  assert.equal(firstReport.passed, false);
  assert.ok(firstReport.diagnostics.some((item) => item.kind === "WRONG_SOURCE"));
  assert.ok(firstReport.diagnostics.some((item) =>
    item.kind === "HIGH_CONFIDENCE_FALSE_MATCH"));
  assert.ok(firstReport.diagnostics.some((item) =>
    item.kind === "AMBIGUOUS_FALSE_MATCH"));
  assert.equal(
    report.diagnosticCounts.find((item) => item.kind === "WRONG_SOURCE")?.count,
    1,
  );
  const identityFocus = report.tuningFocus.find((item) => item.kind === "WRONG_SOURCE");
  assert.deepEqual(identityFocus, {
    kind: "WRONG_SOURCE",
    subsystem: "SOURCE_IDENTITY_RETRIEVAL",
    count: 1,
    caseCount: 1,
    difficultyKinds: ["FAST_CUTS"],
    highConfidenceFalseMatchCount: 1,
    ambiguousFalseMatchCount: 1,
  });
  const calibrationKinds = report.tuningFocus
    .filter((item) => item.subsystem === "CONFIDENCE_CALIBRATION")
    .map((item) => item.kind)
    .sort();
  assert.deepEqual(calibrationKinds, [
    "AMBIGUOUS_FALSE_MATCH",
    "HIGH_CONFIDENCE_FALSE_MATCH",
  ]);
  const identityPlan = report.tuningPlan.find((item) =>
    item.subsystem === "SOURCE_IDENTITY_RETRIEVAL");
  assert.deepEqual(identityPlan?.diagnosticKinds, ["WRONG_SOURCE"]);
  assert.deepEqual(identityPlan?.caseIds, [first.truth.caseId]);
  assert.equal(identityPlan?.highConfidenceFalseMatchCount, 1);
  assert.equal(identityPlan?.ambiguousFalseMatchCount, 1);
  assert.match(identityPlan?.recommendedAction ?? "", /Re-rank source candidates/);
  assert.ok((identityPlan?.evidenceRefs.length ?? 0) > 0);

  const confidencePlan = report.tuningPlan.find((item) =>
    item.subsystem === "CONFIDENCE_CALIBRATION");
  assert.deepEqual(confidencePlan?.diagnosticKinds, [
    "HIGH_CONFIDENCE_FALSE_MATCH",
    "AMBIGUOUS_FALSE_MATCH",
  ]);
  assert.equal(confidencePlan?.highConfidenceFalseMatchCount, 1);
  assert.equal(confidencePlan?.ambiguousFalseMatchCount, 1);
  assert.match(confidencePlan?.recommendedAction ?? "", /Down-calibrate scene confidence/);
});

test("timing and direction failures route to distinct tuning subsystems", () => {
  const cases = certificationCases();
  const first = cases[0];
  cases[0] = {
    ...first,
    observation: {
      ...first.observation,
      matches: first.observation.matches.map((match, index) => index === 1
        ? {
          ...match,
          sourceStartMs: 20500,
          sourceEndMs: 21500,
          direction: "REVERSE",
          confidence: 0.96,
          candidateMargin: 0.15,
        }
        : match),
    },
  };
  const report = evaluatePracticeRetainedTruthSuiteV1({
    editTypeId: "truth-timing-direction",
    mode: "CERTIFICATION",
    cases,
  });
  const timingFocus = report.tuningFocus.find((item) =>
    item.kind === "SOURCE_RANGE_MISMATCH");
  const directionFocus = report.tuningFocus.find((item) =>
    item.kind === "DIRECTION_MISMATCH");
  assert.equal(timingFocus?.subsystem, "SOURCE_TIMING_RETRIEVAL");
  assert.equal(directionFocus?.subsystem, "TEMPORAL_DIRECTION");
  assert.equal(timingFocus?.highConfidenceFalseMatchCount, 1);
  assert.equal(directionFocus?.highConfidenceFalseMatchCount, 1);
  assert.equal(timingFocus?.ambiguousFalseMatchCount, 0);
  assert.equal(directionFocus?.ambiguousFalseMatchCount, 0);
});

test("duplicate Finish bytes and partial truth both fail closed", () => {
  const duplicateFinish = certificationCases();
  duplicateFinish[1] = {
    ...duplicateFinish[1],
    truth: {
      ...duplicateFinish[1].truth,
      finishSha256: duplicateFinish[0].truth.finishSha256,
    },
  };
  const duplicateReport = evaluatePracticeRetainedTruthSuiteV1({
    editTypeId: "truth-duplicate-finish",
    mode: "CERTIFICATION",
    cases: duplicateFinish,
  });
  assert.equal(duplicateReport.certified, false);
  assert.equal(duplicateReport.distinctFinishSha256Count, 19);
  assert.ok(duplicateReport.reasons.some((reason) => /Finish byte identity/.test(reason)));

  const partialTruth = certificationCases();
  partialTruth[0] = {
    ...partialTruth[0],
    truth: {
      ...partialTruth[0].truth,
      shots: [partialTruth[0].truth.shots[0]],
    },
    observation: {
      ...partialTruth[0].observation,
      matches: [partialTruth[0].observation.matches[0]],
    },
  };
  const partialReport = evaluatePracticeRetainedTruthSuiteV1({
    editTypeId: "truth-partial",
    mode: "CERTIFICATION",
    cases: partialTruth,
  });
  assert.equal(partialReport.certified, false);
  assert.equal(partialReport.fullLengthTruthCaseCount, 19);
  assert.ok(partialReport.cases[0].reasons.some((reason) =>
    /full Finish reference/.test(reason)));
});

test("Edit Type memory refuses a forged certified truth report", () => {
  const report = evaluatePracticeRetainedTruthSuiteV1({
    editTypeId: "truth-forged",
    mode: "CERTIFICATION",
    cases: certificationCases(),
  });
  assert.equal(report.certified, true);
  const registry = new EditTypeRegistryV1();
  registry.create({ editTypeId: "truth-forged", title: "Truth Forged" });
  assert.throws(
    () => registry.recordRetainedTruthSuite({
      ...report,
      mode: "MEASURE_ONLY",
    }),
    /fail-closed integrity gates/,
  );
  assert.throws(
    () => registry.recordRetainedTruthSuite({
      ...report,
      distinctSourceSetCount: 1,
    }),
    /fail-closed integrity gates/,
  );
});
