import assert from "node:assert/strict";
import test from "node:test";

import {
  PracticeProductionCoordinatorV1,
  practiceResearchReuseKeyV1,
  practiceSourceCertificateKeyV1,
} from "../.tmp/runtime/packages/practice-homework/src/index.js";

test("production coordinator builds whole-edit coverage before deep phase proof", () => {
  const coordinator = new PracticeProductionCoordinatorV1("practice:fast", ["shot:1", "shot:2"]);
  coordinator.lockSource("shot:1", "lock:1");
  coordinator.lockSource("shot:2", "lock:2");
  assert.equal(coordinator.snapshot().wholeEditCovered, false);
  coordinator.markWholeEditCovered(10);
  assert.equal(coordinator.snapshot().wholeEditCovered, true);
});

test("whole-edit proof supplies second pass to all provisional phases", () => {
  const coordinator = new PracticeProductionCoordinatorV1("practice:proof", ["shot:1", "shot:2"]);
  for (const id of ["shot:1", "shot:2"]) {
    coordinator.lockSource(id, "lock:" + id);
  }
  coordinator.markWholeEditCovered(1);
  for (const id of ["shot:1", "shot:2"]) {
    coordinator.markResearchReady(id, "research:shared");
    coordinator.markConstructed(id, 2);
    coordinator.markLocalProof(id, true, 0.96);
  }
  assert.ok(coordinator.snapshot().phases.every(p => p.state === "PROVISIONAL_PASS"));
  coordinator.confirmProvisionalFromWholeEdit(["shot:1", "shot:2"]);
  const snapshot = coordinator.snapshot();
  assert.ok(snapshot.phases.every((phase) => phase.state === "PROVEN"));
  assert.equal(snapshot.wholeEditPasses, 1);
});

test("localized invalidation preserves unrelated proven phases", () => {
  const coordinator = new PracticeProductionCoordinatorV1("practice:invalidate", ["a", "b"]);
  for (const id of ["a", "b"]) {
    coordinator.lockSource(id, "lock:" + id);
  }
  coordinator.markWholeEditCovered(1);
  for (const id of ["a", "b"]) {
    coordinator.markResearchReady(id, "research:" + id);
    coordinator.markConstructed(id, 3);
    coordinator.markLocalProof(id, true, 0.97);
    coordinator.markLocalProof(id, true, 0.98);
  }
  coordinator.invalidate(["a"], "PROOF");
  const [a, b] = coordinator.snapshot().phases;
  assert.equal(a.state, "CONSTRUCTED");
  assert.equal(b.state, "PROVEN");
});

test("dependency-aware invalidation expands only through declared connected phases", () => {
  const coordinator = new PracticeProductionCoordinatorV1("practice:deps", ["a", "b", "c"]);
  for (const id of ["a", "b", "c"]) {
    coordinator.lockSource(id, "lock:" + id);
  }
  coordinator.markWholeEditCovered(1);
  for (const id of ["a", "b", "c"]) {
    coordinator.markResearchReady(id, "research:" + id);
    coordinator.markConstructed(id, 2);
    coordinator.markLocalProof(id, true, 0.97);
    coordinator.markLocalProof(id, true, 0.98);
  }
  coordinator.updateResiduals([
    { phaseId: "a", similarity: 0.8, durationMs: 300, dependencyPhaseIds: ["b"] },
    { phaseId: "b", similarity: 0.9, durationMs: 300, dependencyPhaseIds: ["a"] },
    { phaseId: "c", similarity: 0.99, durationMs: 300 },
  ]);
  coordinator.invalidate(["a"], "PROOF");
  const states = Object.fromEntries(coordinator.snapshot().phases.map(p => [p.phaseId, p.state]));
  assert.equal(states.a, "CONSTRUCTED");
  assert.equal(states.b, "CONSTRUCTED");
  assert.equal(states.c, "PROVEN");
});

test("AE checkpoint identity persists independently of chat lifecycle", () => {
  const coordinator = new PracticeProductionCoordinatorV1("practice:ae", ["a"]);
  coordinator.markAeCheckpoint({
    projectId: "shadow-current-project", projectRevision: 6255,
    environmentFingerprint: "env:1", activeCompId: "comp:practice", projectPath: "C:/Practice/Open Template.aep",
  });
  assert.equal(coordinator.snapshot().aeCheckpoint.projectRevision, 6255);
  assert.equal(coordinator.snapshot().aeCheckpoint.activeCompId, "comp:practice");
});

test("research and source keys are stable and reusable", () => {
  assert.equal(
    practiceResearchReuseKeyV1({ editTypeId: "microwave", effectIds: ["zoom", "retime"] }),
    practiceResearchReuseKeyV1({ editTypeId: "microwave", effectIds: ["retime", "zoom"] }),
  );
  assert.equal(
    practiceSourceCertificateKeyV1({ sourceMediaId: "movie", sourceStartMs: 1, sourceEndMs: 2, direction: "FORWARD", playbackRate: 1 }),
    practiceSourceCertificateKeyV1({ sourceMediaId: "movie", sourceStartMs: 1, sourceEndMs: 2, direction: "FORWARD", playbackRate: 1 }),
  );
});

test("production liveness protects in-flight work and stalls idle workers", () => {
  const coordinator = new PracticeProductionCoordinatorV1("practice:liveness", ["a"]);
  coordinator.heartbeat("render:shot:a");
  assert.equal(coordinator.liveness({ now: Date.now(), staleAfterMs: 180_000 }).stalled, false);
  assert.equal(coordinator.liveness({ now: Date.now() + 999_999, staleAfterMs: 180_000 }).stalled, true);
  coordinator.heartbeat(null);
  const snap = coordinator.snapshot();
  const progressAt = Date.parse(snap.lastProgressAt);
  assert.equal(coordinator.liveness({ now: progressAt + 181_000, staleAfterMs: 180_000 }).stalled, true);
});

test("failed proof and reconstruction demote a previously proven phase", () => {
  const c = new PracticeProductionCoordinatorV1("test:demote", ["a"]);
  c.lockSource("a", "source"); c.markResearchReady("a", "research"); c.markWholeEditCovered(1);
  c.markConstructed("a", 2); c.markLocalProof("a", true, .97); c.markLocalProof("a", true, .97);
  c.markLocalProof("a", false, .5);
  assert.equal(c.snapshot().phases[0].state, "CONSTRUCTED");
  assert.equal(typeof c.nextAction, "undefined");
  c.markLocalProof("a", true, .97); c.markLocalProof("a", true, .97);
  c.markConstructed("a", 3);
  assert.equal(c.snapshot().phases[0].state, "CONSTRUCTED");
  assert.equal(c.snapshot().phases[0].consecutivePasses, 0);
});

test("a repeated render cannot count twice; a new candidate starts a new proof sequence", () => {
  const c = new PracticeProductionCoordinatorV1("test:proof-identity", ["a"]);
  c.lockSource("a", "source"); c.markResearchReady("a", "research"); c.markWholeEditCovered(1); c.markConstructed("a", 2);
  c.markLocalProof("a", true, .97, { evidenceRef: "render:1", candidateKey: "candidate:1" });
  c.markLocalProof("a", true, .97, { evidenceRef: "render:1", candidateKey: "candidate:1" });
  assert.equal(c.snapshot().phases[0].consecutivePasses, 1);
  c.markLocalProof("a", true, .98, { evidenceRef: "render:2", candidateKey: "candidate:2" });
  assert.equal(c.snapshot().phases[0].consecutivePasses, 1);
  c.confirmProvisionalFromWholeEdit(["a"], { evidenceRef: "full:1", candidateKey: "full-state:2", passed: true });
  c.confirmProvisionalFromWholeEdit(["a"], { evidenceRef: "full:1", candidateKey: "full-state:2", passed: true });
  assert.equal(c.snapshot().wholeEditPasses, 1);
  c.confirmProvisionalFromWholeEdit([], { evidenceRef: "full:2", candidateKey: "full-state:2", passed: false });
  assert.equal(c.snapshot().wholeEditPasses, 0);
  assert.equal(c.snapshot().phases[0].state, "CONSTRUCTED");
});

test("empty or unproven work never reports completion", () => {
  const c = new PracticeProductionCoordinatorV1("empty", []);
  assert.deepEqual(c.snapshot().phases, []);
  assert.throws(() => c.markWholeEditCovered(), /every retained phase/);
  assert.throws(() => c.markCertified(), /cannot bypass/);
});


test("new candidate demotes proven state and connected invalidation never promotes unresolved work", () => {
  const c = new PracticeProductionCoordinatorV1("test:changed", ["a", "b"]);
  c.lockSource("a", "source"); c.markResearchReady("a", "research"); c.markConstructed("a", null);
  c.markLocalProof("a", true, .97, { evidenceRef: "one", candidateKey: "old" });
  c.markLocalProof("a", true, .97, { evidenceRef: "two", candidateKey: "old" });
  assert.equal(c.snapshot().phases[0].state, "PROVEN");
  c.markLocalProof("a", true, .97, { evidenceRef: "three", candidateKey: "new" });
  assert.equal(c.snapshot().phases[0].state, "PROVISIONAL_PASS");
  c.updateResiduals([{phaseId:"a", similarity:.8, durationMs:100, dependencyPhaseIds:["b"]}]);
  c.requireSourceValidation("a");
  assert.equal(c.snapshot().phases[0].sourceValidationRequired, true);
  assert.equal(c.snapshot().phases[1].state, "UNRESOLVED");
});
