import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { GptOrchestrationStoreV1 } from "../.tmp/runtime/packages/practice-homework/src/index.js";

test("learning events append to journal without growing assignment snapshot", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-gpt-journal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "gpt-orchestration.json");
  const store = new GptOrchestrationStoreV1(file);
  const assignment = await store.createAssignment({
    sessionId: "practice:journal",
    mode: "PRACTICE",
    practiceRole: "LEARNING",
    editTypeId: "journal-test",
    finish: { mediaId: "finish", role: "FINISH_REFERENCE", mediaKind: "VIDEO", uri: "finish.mp4" },
    start: [{ mediaId: "raw", role: "START_SOURCE", mediaKind: "VIDEO", uri: "raw.mp4" }],
    artifactDir: root,
    knowledge: null,
  });
  await store.claim(assignment.assignmentId, "journal-controller");
  await store.appendEvent({ assignmentId: assignment.assignmentId, stage: "OBSERVATION", summary: "Observed reference." });
  const snapshotAfterEvent = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(snapshotAfterEvent.events, []);
  const journalLines = (await readFile(file + ".events.jsonl", "utf8")).trim().split(/\r?\n/);
  assert.equal(journalLines.length, 1);
  await store.releaseController(assignment.assignmentId, "journal-controller");
  const snapshotAfterAssignmentMutation = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(snapshotAfterAssignmentMutation.events, []);
  assert.equal((await readFile(file + ".events.jsonl", "utf8")).trim().split(/\r?\n/).length, 1);
  const reloaded = new GptOrchestrationStoreV1(file);
  assert.equal((await reloaded.eventsForSession("practice:journal")).length, 1);
});

test("legacy snapshot events migrate once into the append-only journal on assignment mutation", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-gpt-journal-migrate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "gpt-orchestration.json");
  const store = new GptOrchestrationStoreV1(file);
  const assignment = await store.createAssignment({
    sessionId: "practice:migrate",
    mode: "PRACTICE",
    practiceRole: "LEARNING",
    editTypeId: "journal-test",
    finish: { mediaId: "finish", role: "FINISH_REFERENCE", mediaKind: "VIDEO", uri: "finish.mp4" },
    start: [{ mediaId: "raw", role: "START_SOURCE", mediaKind: "VIDEO", uri: "raw.mp4" }],
    artifactDir: root,
    knowledge: null,
  });
  await store.claim(assignment.assignmentId, "journal-controller");
  await store.appendEvent({ assignmentId: assignment.assignmentId, stage: "OBSERVATION", summary: "Retained event." });
  await store.releaseController(assignment.assignmentId, "journal-controller");
  assert.equal((await store.eventsForSession("practice:migrate")).length, 1);
  const snapshot = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(snapshot.events, []);
});
