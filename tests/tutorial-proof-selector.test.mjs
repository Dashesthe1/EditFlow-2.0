import test from "node:test";
import assert from "node:assert/strict";

import {
  selectTutorialProofStagesV1,
  tutorialProofIdForStageV1,
} from "../.tmp/runtime/packages/tutorial-learning/src/index.js";
import {
  createProofToken,
} from "../.tmp/runtime/packages/incremental-proof-engine/src/index.js";

const stage = (level, required, liveAeRequired) => ({
  level,
  stageId: "skill.trail:L" + level,
  kind: [
    "IR_CONTRACT",
    "VIRTUAL_AE_STRUCTURE",
    "LIVE_AE_MICROPROOF",
    "SPARSE_VISUAL",
    "SHORT_MOTION",
    "TUTORIAL_RECONSTRUCTION",
    "TRANSFER",
    "BROAD_PRODUCTION",
  ][level],
  required,
  liveAeRequired,
  assertions: ["assert L" + level],
  rationale: "proof level " + level,
});
const proofPlan = (overrides = {}) => ({
  schema: "editflow.tutorial-proof-plan.v1",
  skillId: "skill.trail",
  risk: "HIGH",
  targetState: "TRANSFER_VERIFIED",
  blockedByCapabilities: [],
  reusableCapabilityProofs: ["ae.layer.duplicate"],
  stages: [
    stage(0, true, false),
    stage(1, true, false),
    stage(2, false, false),
    stage(3, true, true),
    stage(4, false, false),
    stage(5, true, true),
    stage(6, true, true),
    stage(7, false, false),
  ],
  evidenceStopRule: "stop when required evidence passes",
  ...overrides,
});

const context = (stageId, sha = "a".repeat(64), token = null) => ({
  environmentFingerprint: stageId.endsWith("L0") || stageId.endsWith("L1")
    ? "offline=runtime-v1"
    : "afterfx=25.6.6|cep=warm",
  checkpointKey: stageId,
  dependencies: [{ id: "dep:" + stageId, sha256: sha }],
  token,
});

const contextsFor = (plan, shaByStage = {}) =>
  Object.fromEntries(plan.stages
    .filter((item) => item.required)
    .map((item) => [item.stageId, context(item.stageId, shaByStage[item.stageId])]));
const withAcceptedTokens = (plan, contexts) => {
  const first = selectTutorialProofStagesV1({ plan, stageContexts: contexts });
  const byStage = new Map(first.decisions.map((decision) => [decision.stageId, decision]));
  return Object.fromEntries(Object.entries(contexts).map(([stageId, value]) => {
    const proofNode = byStage.get(stageId)?.proofNode;
    assert.ok(proofNode, "expected proof node for " + stageId);
    return [stageId, {
      ...value,
      token: createProofToken(proofNode, "b".repeat(64), "2026-09-17T20:00:00Z"),
    }];
  }));
};

test("matching tutorial stage PASS evidence satisfies the stop rule without AE work", () => {
  const plan = proofPlan();
  const contexts = withAcceptedTokens(plan, contextsFor(plan));
  const selection = selectTutorialProofStagesV1({ plan, stageContexts: contexts });

  assert.equal(selection.completeFromCache, true);
  assert.equal(selection.evidenceStopSatisfied, true);
  assert.equal(selection.nextStageId, null);
  assert.deepEqual(selection.plannedRunStageIds, []);
  assert.deepEqual(selection.blockedStageIds, []);
  assert.deepEqual(selection.reusableStageIds, [
    "skill.trail:L0",
    "skill.trail:L1",
    "skill.trail:L3",
    "skill.trail:L5",
    "skill.trail:L6",
  ]);
  assert.equal(selection.decisions.find((item) => item.stageId === "skill.trail:L2").action,
    "SKIP_NOT_REQUIRED");
});
test("a changed dependency schedules only the invalidated tutorial stage", () => {
  const plan = proofPlan();
  const original = contextsFor(plan);
  const accepted = withAcceptedTokens(plan, original);
  const changed = {
    ...accepted,
    "skill.trail:L1": {
      ...accepted["skill.trail:L1"],
      dependencies: [{ id: "dep:skill.trail:L1", sha256: "c".repeat(64) }],
    },
  };
  const selection = selectTutorialProofStagesV1({ plan, stageContexts: changed });

  assert.deepEqual(selection.plannedRunStageIds, ["skill.trail:L1"]);
  assert.equal(selection.nextStageId, "skill.trail:L1");
  assert.equal(selection.completeFromCache, false);
  assert.match(
    selection.decisions.find((item) => item.stageId === "skill.trail:L1").reason,
    /dependencies no longer match/i,
  );
});

test("impact-map drift fails closed even when cache dependencies still match", () => {
  const plan = proofPlan();
  const contexts = withAcceptedTokens(plan, contextsFor(plan));
  const target = plan.stages.find((item) => item.level === 3);
  const proofId = tutorialProofIdForStageV1(plan, target);
  const selection = selectTutorialProofStagesV1({
    plan,
    stageContexts: contexts,
    impact: {
      changedNodeIds: ["code:visual-review"],
      affectedNodeIds: ["code:visual-review", proofId],
      affectedProofIds: [proofId],
      unmappedChangedIds: [],
      requiresBroadValidation: false,
    },
  });

  assert.deepEqual(selection.plannedRunStageIds, ["skill.trail:L3"]);
  assert.equal(selection.decisions.find((item) => item.stageId === "skill.trail:L3").impactAffected,
    true);
  assert.match(selection.decisions.find((item) => item.stageId === "skill.trail:L3").reason,
    /dependency-map drift/i);
});
test("unmapped changes bypass reusable evidence for required stages only", () => {
  const plan = proofPlan();
  const contexts = withAcceptedTokens(plan, contextsFor(plan));
  const selection = selectTutorialProofStagesV1({
    plan,
    stageContexts: contexts,
    impact: {
      changedNodeIds: ["code:new-unknown-subsystem"],
      affectedNodeIds: [],
      affectedProofIds: [],
      unmappedChangedIds: ["code:new-unknown-subsystem"],
      requiresBroadValidation: true,
    },
  });

  assert.equal(selection.broadValidationRequired, true);
  assert.deepEqual(selection.plannedRunStageIds, [
    "skill.trail:L0",
    "skill.trail:L1",
    "skill.trail:L3",
    "skill.trail:L5",
    "skill.trail:L6",
  ]);
  assert.equal(selection.decisions.find((item) => item.stageId === "skill.trail:L2").action,
    "SKIP_NOT_REQUIRED");
});
test("missing capabilities block live stages while preserving cheap offline evidence", () => {
  const baselinePlan = proofPlan();
  const contexts = withAcceptedTokens(baselinePlan, contextsFor(baselinePlan));
  const plan = proofPlan({ blockedByCapabilities: ["ae.subject.isolate"] });
  const selection = selectTutorialProofStagesV1({ plan, stageContexts: contexts });

  assert.deepEqual(selection.reusableStageIds, ["skill.trail:L0", "skill.trail:L1"]);
  assert.deepEqual(selection.blockedStageIds, [
    "skill.trail:L3",
    "skill.trail:L5",
    "skill.trail:L6",
  ]);
  assert.deepEqual(selection.plannedRunStageIds, []);
  assert.equal(selection.nextStageId, null);
  assert.equal(selection.evidenceStopSatisfied, false);
});

test("full acceptance explicitly bypasses matching stage evidence", () => {
  const plan = proofPlan();
  const contexts = withAcceptedTokens(plan, contextsFor(plan));
  const selection = selectTutorialProofStagesV1({
    plan,
    stageContexts: contexts,
    strategy: "FULL_ACCEPTANCE",
  });

  assert.deepEqual(selection.plannedRunStageIds, [
    "skill.trail:L0",
    "skill.trail:L1",
    "skill.trail:L3",
    "skill.trail:L5",
    "skill.trail:L6",
  ]);
  assert.ok(selection.decisions
    .filter((item) => item.required)
    .every((item) => item.action === "RUN_FULL"));
});
test("missing proof identity context runs once without pretending evidence is reusable", () => {
  const plan = proofPlan();
  const selection = selectTutorialProofStagesV1({ plan, stageContexts: {} });

  assert.equal(selection.nextStageId, "skill.trail:L0");
  assert.deepEqual(selection.plannedRunStageIds, [
    "skill.trail:L0",
    "skill.trail:L1",
    "skill.trail:L3",
    "skill.trail:L5",
    "skill.trail:L6",
  ]);
  assert.equal(selection.decisions.find((item) => item.stageId === "skill.trail:L0").contentKey,
    null);
  assert.match(selection.decisions.find((item) => item.stageId === "skill.trail:L0").reason,
    /declare dependencies before caching/i);
});

test("invalid proof identity context blocks caching instead of accepting ambiguous evidence", () => {
  const plan = proofPlan();
  const contexts = contextsFor(plan);
  contexts["skill.trail:L0"] = {
    ...contexts["skill.trail:L0"],
    environmentFingerprint: "",
  };
  const selection = selectTutorialProofStagesV1({ plan, stageContexts: contexts });
  assert.equal(selection.decisions.find((item) => item.stageId === "skill.trail:L0").action,
    "BLOCKED");
  assert.match(selection.decisions.find((item) => item.stageId === "skill.trail:L0").reason,
    /environmentFingerprint must not be empty/i);
});
