import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PracticeProductionWorkerV1 } from "../.tmp/runtime/packages/practice-homework/src/index.js";

const fixture = async (t, execute) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "practice-worker-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "jobs.jsonl");
  return { file, worker: new PracticeProductionWorkerV1(file, execute, async () => true) };
};
const job = (kind = "AE_TRANSACTION", dependencies = []) => ({ assignmentId: "assignment:1", kind,
  payload: { id: Math.random() }, dependencyIds: dependencies });

test("queued decisions survive restart and finish in dependency order without a chat", async (t) => {
  const calls = [];
  const f = await fixture(t, async (j) => { calls.push(j.jobId); return { result: "committed" }; });
  const a = await f.worker.enqueue(job());
  const b = await f.worker.enqueue(job("SAVE_CHECKPOINT", [a.jobId]));
  const fresh = new PracticeProductionWorkerV1(f.file, async j => { calls.push(j.jobId); return { result: "saved" }; }, async () => true);
  await fresh.runOnce(); await fresh.runOnce();
  assert.deepEqual(calls, [a.jobId, b.jobId]);
  assert.ok(fresh.list().every(j => j.status === "SUCCEEDED"));
});

test("concurrent duplicate submissions create exactly one durable job", async (t) => {
  const f = await fixture(t, async () => ({ result: null }));
  const input = job();
  const ids = await Promise.all(Array.from({ length: 20 }, async () => (await f.worker.enqueue(input)).jobId));
  assert.equal(new Set(ids).size, 1);
  assert.equal(f.worker.list().length, 1);
});

test("crashed AE writes require reconciliation and are never replayed", async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => { calls++; return { result: null }; });
  const j = await f.worker.enqueue(job());
  await writeFile(f.file, JSON.stringify({ ...j, status: "RUNNING" }) + "\n");
  const fresh = new PracticeProductionWorkerV1(f.file, async () => { calls++; return { result: null }; }, async () => true);
  await fresh.runOnce();
  assert.equal(fresh.list()[0].status, "RECONCILE_REQUIRED");
  assert.equal(calls, 0);
});

test("search finalists stop dependent canonical writes until explicit review", async (t) => {
  const f = await fixture(t, async j => ({ result: j.kind, reviewRequired: j.kind === "SCRATCH_SEARCH" }));
  const a = await f.worker.enqueue(job("SCRATCH_SEARCH"));
  await f.worker.enqueue(job("AE_TRANSACTION", [a.jobId]));
  await f.worker.runOnce(); await f.worker.runOnce();
  assert.deepEqual(f.worker.list().map(j => j.status), ["REVIEW_REQUIRED", "PENDING"]);
  await f.worker.resolve(a.jobId, { inspected: true });
  await f.worker.runOnce();
  assert.equal(f.worker.list()[1].status, "SUCCEEDED");
});

test("one writer overlaps bounded read-only preparation, never another writer", async (t) => {
  let writers = 0, peakWriters = 0, readers = 0, overlap = false;
  const f = await fixture(t, async j => {
    const readOnly = j.kind === "REFERENCE_ANALYSIS";
    if (readOnly) readers++; else { writers++; peakWriters = Math.max(peakWriters, writers); }
    await new Promise(resolve => setTimeout(resolve, 20));
    overlap ||= readers > 0 && writers > 0;
    if (readOnly) readers--; else writers--;
    return { result: null };
  });
  await f.worker.enqueue(job()); await f.worker.enqueue(job());
  await f.worker.enqueue(job("REFERENCE_ANALYSIS")); await f.worker.enqueue(job("REFERENCE_ANALYSIS"));
  await f.worker.runOnce(); await f.worker.runOnce();
  assert.equal(peakWriters, 1); assert.equal(overlap, true);
});

test("a busy writer is retried without marking its operation complete", async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => { if (++calls === 1) throw Object.assign(new Error("busy"), { status: 423 }); return { result: "committed" }; });
  await f.worker.enqueue(job()); await f.worker.runOnce();
  assert.equal(f.worker.list()[0].status, "PENDING");
  await f.worker.runOnce(); assert.equal(f.worker.list()[0].status, "SUCCEEDED");
});


test("partial final journal append is repaired before later durable writes", async t => {
  const f = await fixture(t, async () => ({ result: null }));
  const first = await f.worker.enqueue(job());
  await writeFile(f.file, JSON.stringify(first) + '\n' + '{"jobId":"interrupted');
  const fresh = new PracticeProductionWorkerV1(f.file, async () => ({ result: null }), async () => true);
  await fresh.enqueue(job());
  const reopened = new PracticeProductionWorkerV1(f.file, async () => ({ result: null }), async () => true);
  await reopened.load();
  assert.equal(reopened.list().length, 2);
});

test("failed operations hold later writes until evidence-based reconciliation", async t => {
  let calls = 0;
  const f = await fixture(t, async () => { if (++calls === 1) throw new Error("write failed"); return { result: null }; });
  const first = await f.worker.enqueue(job());
  await f.worker.enqueue(job());
  await f.worker.runOnce(); await f.worker.runOnce();
  assert.equal(calls, 1);
  await f.worker.resolve(first.jobId, {reviewEvidenceRef:"repaired-state"});
  await f.worker.runOnce();
  assert.equal(calls, 2);
});
