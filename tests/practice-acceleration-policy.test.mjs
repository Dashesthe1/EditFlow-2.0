import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_PRACTICE_ACCELERATION_POLICY_V1,
  GptOrchestrationStoreV1,
  affectedPracticePhaseIdsV1,
  buildGptOrchestrationChatMessageV1,
  retainTopPracticeCandidatesV1,
  selectPracticeResidualFocusSetV1,
  shouldEscalatePracticeHypothesisV1,
} from "../.tmp/runtime/packages/practice-homework/src/index.js";

test("Practice acceleration policy uses a 32 -> 8 -> 2 progressive fidelity funnel", () => {
  const policy = DEFAULT_PRACTICE_ACCELERATION_POLICY_V1;
  assert.equal(policy.targetOperatorLoopSpeedup, 100);
  assert.equal(policy.targetEndToEndSpeedup, 100);
  assert.equal(policy.buildWholeEditBeforeCertification, true);
  assert.equal(policy.candidateBatchSize, 32);
  assert.deepEqual(
    policy.funnel.map((stage) => [stage.id, stage.resolutionScale, stage.maxCandidates]),
    [["COARSE", 0.125, 32], ["MID", 0.25, 8], ["FULL", 1, 2]],
  );
});

test("candidate funnel keeps only strongest finite scores", () => {
  const ranked = retainTopPracticeCandidatesV1([
    { candidateId: "a", score: 0.8 },
    { candidateId: "b", score: Number.NaN },
    { candidateId: "c", score: 0.95 },
    { candidateId: "d", score: 0.9 },
  ], 2);
  assert.deepEqual(ranked.map((item) => item.candidateId), ["c", "d"]);
});

test("micro tuning escalates after weak gain or two rounds", () => {
  assert.equal(shouldEscalatePracticeHypothesisV1({
    microCorrectionRound: 1,
    priorScore: 0.80,
    currentScore: 0.82,
  }), false);
  assert.equal(shouldEscalatePracticeHypothesisV1({
    microCorrectionRound: 1,
    priorScore: 0.80,
    currentScore: 0.805,
  }), true);
  assert.equal(shouldEscalatePracticeHypothesisV1({
    microCorrectionRound: 2,
    priorScore: 0.80,
    currentScore: 0.90,
  }), true);
});

test("Practice orchestration builds whole edit before certification without weakening final gates", () => {
  const message = buildGptOrchestrationChatMessageV1({
    sessionId: "practice:accelerated",
    mode: "PRACTICE",
    practiceRole: "LEARNING",
    editTypeId: "reference-faithful",
    finish: { mediaId: "finish:1", role: "FINISH_REFERENCE", mediaKind: "VIDEO", uri: "C:\\Media\\finish.mp4" },
    start: [{ mediaId: "start:1", role: "START_SOURCE", mediaKind: "VIDEO", uri: "C:\\Media\\raw.mp4" }],
    practicePolicy: null,
    artifactDir: "C:\\EditFlow\\practice",
    knowledge: null,
  });
  assert.match(message, /ACCELERATED COVERAGE-FIRST SCHEDULE/);
  assert.match(message, /build a playable whole-edit reconstruction across every phase before final certification/i);
  assert.match(message, /32 coarse 1\/8-resolution/);
  assert.match(message, /full-resolution proof only for the strongest 2/);
  assert.match(message, /Machine scoring is search\/ranking evidence only and can never satisfy a Practice fidelity pass/);
  assert.match(message, /Every phase still needs at least 2 consecutive passes before successful Practice completion/);
  assert.match(message, /exact final candidate needs at least 2 consecutive whole-edit passes/);
  assert.doesNotMatch(message, /before emitting work for the next chronological phase/);
});

test("global residual scheduler spends attention on the highest-impact mismatches first", () => {
  const focus = selectPracticeResidualFocusSetV1([
    { phaseId: "p1", similarity: 0.94, durationMs: 500, viewerSalience: 0.4 },
    { phaseId: "p2", similarity: 0.86, durationMs: 700, viewerSalience: 0.9, definingEffectMissing: true },
    { phaseId: "p3", similarity: 0.91, durationMs: 450, viewerSalience: 0.6, temporalMismatch: true },
    { phaseId: "p4", similarity: 0.97, durationMs: 600, viewerSalience: 0.5 },
    { phaseId: "p5", similarity: 0.70, durationMs: 400, viewerSalience: 0.8, wrongSource: true },
  ]);
  assert.equal(focus.length, 1);
  assert.equal(focus[0].phaseId, "p5");
});

test("dependency-aware recertification invalidates only connected phases", () => {
  const affected = affectedPracticePhaseIdsV1("p3", [
    { phaseId: "p1", similarity: 0.99, durationMs: 300 },
    { phaseId: "p2", similarity: 0.99, durationMs: 300, dependencyPhaseIds: ["p3"] },
    { phaseId: "p3", similarity: 0.90, durationMs: 300 },
    { phaseId: "p4", similarity: 0.99, durationMs: 300, dependencyPhaseIds: ["p2"] },
    { phaseId: "p5", similarity: 0.99, durationMs: 300 },
  ]);
  assert.deepEqual(new Set(affected), new Set(["p2", "p3", "p4"]));
});

test("retained running Practice assignments adopt current acceleration policy without losing continuity", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "practice-acceleration-resume-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, "gpt-orchestration.json");
  const store = new GptOrchestrationStoreV1(filePath);
  const assignment = await store.createAssignment({
    sessionId: "practice:resumed",
    mode: "PRACTICE",
    editTypeId: "reference-edit",
    finish: { mediaId: "finish:1", role: "FINISH_REFERENCE", mediaKind: "VIDEO", uri: "C:\\Media\\finish.mp4" },
    start: [{ mediaId: "raw:1", role: "START_SOURCE", mediaKind: "VIDEO", uri: "C:\\Media\\raw.mp4" }],
    artifactDir: root,
    knowledge: null,
  });
  await store.claim(assignment.assignmentId, "existing-controller");
  const retained = JSON.parse(await readFile(filePath, "utf8"));
  retained.assignments[0].chatMessage = "Legacy original M6. Pass each phase before emitting work for the next chronological phase.";
  await writeFile(filePath, JSON.stringify(retained), "utf8");

  assert.equal(await store.refreshActivePracticeInstructions(), 1);
  const resumed = await store.getAssignment(assignment.assignmentId);
  assert.equal(resumed.status, "RUNNING");
  assert.equal(resumed.claimedBy, "existing-controller");
  assert.match(resumed.chatMessage, /PRACTICE_ACCELERATION_CONTINUITY_V1/);
  assert.match(resumed.chatMessage, /superseded as a construction-order rule/);
  assert.match(resumed.chatMessage, /two consecutive whole-edit passes/);
  assert.equal(await store.refreshActivePracticeInstructions(), 0);
});
