import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rename, rm, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { GptOrchestrationStoreV1 } from "../.tmp/runtime/packages/practice-homework/src/index.js";
import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";
import { PracticePanelServerV1 } from "../.tmp/runtime/apps/desktop-host/src/practice-panel-server.js";
import { patchReadlineCleanup } from "../scripts/windows/repair-desktop-commander-read-handles.mjs";

const token = "practice-file-lock-repair-test-0123456789abcdef";
const headers = { "X-EditFlow-Token": token };
const input = root => ({ sessionId: "practice:lock-test", mode: "PRACTICE", editTypeId: "test",
  finish: { mediaId: "ref", role: "FINISH_REFERENCE", mediaKind: "VIDEO", uri: "ref.mp4" },
  start: [{ mediaId: "raw", role: "START_SOURCE", mediaKind: "VIDEO", uri: "raw.mp4" }],
  artifactDir: root, knowledge: null });

async function windowsLock(file, seconds) {
  const escaped = file.replaceAll("'", "''");
  const child = spawn("powershell.exe", ["-NoProfile", "-Command",
    "$f=[IO.File]::Open('" + escaped + "',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite); Write-Output 'LOCK_READY'; Start-Sleep -Seconds " + seconds + "; $f.Dispose()"]);
  await new Promise((resolve, reject) => {
    child.stdout.on("data", value => { if (String(value).includes("LOCK_READY")) resolve(); });
    child.once("error", reject);
    child.once("exit", code => reject(new Error("Lock holder exited before ready: " + code)));
  });
  return child;
}

test("idle Practice startup leaves the checkpoint unchanged even while a Windows reader holds it", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "practice-lock-start-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "gpt.json");
  await writeFile(file, JSON.stringify({ schema: "editflow.gpt-orchestration-store.v1", assignments: [], events: [] }));
  const previous = await stat(file);
  let holder;
  if (process.platform === "win32") holder = await windowsLock(file, 20);
  t.after(() => holder?.kill());
  const broker = new LoopbackCepBroker({ port: 0, token });
  await broker.start();
  const service = new PracticePanelServerV1({ port: 0, token, broker, repositoryRoot: process.cwd(),
    artifactDir: path.join(root, "artifacts"), learningMemoryFilePath: path.join(root, "memory.json"),
    editTypeRegistryFilePath: path.join(root, "types.json"), gptOrchestrationFilePath: file });
  t.after(async () => { await service.stop(); await broker.stop(); });
  await service.start();
  assert.equal((await stat(file)).mtimeMs, previous.mtimeMs);
  const response = await fetch("http://127.0.0.1:" + service.port + "/v1/product/practice/resume-or-start", { headers });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).nextOperation, "START_PRACTICE");
  holder?.kill();
  if (holder) await new Promise(resolve => holder.once("exit", resolve));
});

test("a transient Windows checkpoint lock retries atomically and preserves the assignment", { skip: process.platform !== "win32" }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "practice-lock-retry-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "gpt.json");
  const store = new GptOrchestrationStoreV1(file);
  const assignment = await store.createAssignment(input(root));
  const holder = await windowsLock(file, 1);
  t.after(() => holder.kill());
  const claimed = await store.claim(assignment.assignmentId, "test-controller");
  assert.equal(claimed.assignmentId, assignment.assignmentId);
  assert.equal(claimed.status, "RUNNING");
  assert.equal((await store.listAssignments()).length, 1);
  assert.deepEqual((await readdir(root)).filter(name => name.includes(".tmp-")), []);
});

test("a failed checkpoint leaves prior bytes intact, cleans temporary files, and does not poison the write queue", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "practice-lock-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "gpt.json");
  const store = new GptOrchestrationStoreV1(file);
  const assignment = await store.createAssignment(input(root));
  const previous = await readFile(file, "utf8");
  let holder;
  if (process.platform === "win32") {
    holder = await windowsLock(file, 25);
    t.after(() => holder.kill());
    await assert.rejects(store.claim(assignment.assignmentId, "blocked"), /checkpoint was not committed/);
    assert.equal(await readFile(file, "utf8"), previous);
    assert.deepEqual((await readdir(root)).filter(name => name.includes(".tmp-")), []);
    holder.kill();
    await new Promise(resolve => holder.once("exit", resolve));
  } else {
    await assert.rejects(store.claim("missing", "blocked"), /Unknown GPT assignment/);
  }
  assert.equal((await store.claim(assignment.assignmentId, "recovered")).status, "RUNNING");
});

test("the deployed Desktop Commander reader releases handles after partial, estimated, tail and UTF16 reads", { skip: !process.env.EDITFLOW_DC_TEST_ROOT }, async t => {
  const module = path.join(process.env.EDITFLOW_DC_TEST_ROOT, "dist", "utils", "files", "text.js");
  const source = await readFile(module, "utf8");
  assert.equal(patchReadlineCleanup(source), source);
  const { TextFileHandler } = await import(pathToFileURL(module));
  const handler = new TextFileHandler();
  const root = await mkdtemp(path.join(os.tmpdir(), "desktop-reader-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "large.txt");
  const content = Array.from({ length: 20000 }, (_, n) => n + " " + "x".repeat(80)).join("\n");
  for (const mode of ["partial", "estimated", "tail", "utf16"]) {
    await writeFile(file, mode === "utf16" ? Buffer.from("\ufeff" + content, "utf16le") : content);
    if (mode === "estimated") await handler.readFromEstimatedPosition(file, 2000, 2, "text/plain", false);
    else await handler.readFileWithSmartPositioning(file, mode === "tail" ? -2 : 0, 2, "text/plain", false);
    // Windows rejects this rename when readline's paused input is still open.
    await rename(file, file + ".renamed");
    await rm(file + ".renamed");
  }
});

test("a background preflight failure stays observable and resumes the same durable assignment", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "practice-worker-failure-"));
  const file = path.join(root, "gpt.json");
  const store = new GptOrchestrationStoreV1(file);
  const assignment = await store.createAssignment({ ...input(root), preflight: {
    stage: "BLOCKED", updatedAt: new Date().toISOString(), requireTransferNovelty: false,
    completedShotIds: ["shot:retained"], unresolvedShotIds: ["shot:pending"],
    reasons: ["needs source matching"], evidenceRefs: [] } });
  const broker = new LoopbackCepBroker({ port: 0, token });
  await broker.start();
  const service = new PracticePanelServerV1({ port: 0, token, broker, repositoryRoot: process.cwd(),
    artifactDir: path.join(root, "artifacts"), learningMemoryFilePath: path.join(root, "memory.json"),
    editTypeRegistryFilePath: path.join(root, "types.json"), gptOrchestrationFilePath: file });
  await service.start();
  t.after(async () => { await service.stop(); await broker.stop(); await rm(root, { recursive: true, force: true }); });
  const url = "http://127.0.0.1:" + service.port + "/v1/product/practice/resume-or-start";
  const original = await readFile(file, "utf8");
  await writeFile(file, "{temporarily unreadable");
  const failed = await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}" });
  assert.equal(failed.status, 400);
  await failed.json();
  await writeFile(file, original);
  let handshake;
  for (let n = 0; n < 30; n++) {
    const response = await fetch(url, { headers });
    assert.equal(response.status, 200);
    handshake = await response.json();
    if (!handshake.workerRunning) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(handshake.assignment.assignmentId, assignment.assignmentId);
  assert.deepEqual(handshake.preflight.completedShotIds, ["shot:retained"]);
  assert.match(handshake.workerError, /JSON|Unexpected|property name/i);
  assert.equal(handshake.nextOperation, "RESUME_PREFLIGHT");
  const resumed = await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}" });
  assert.equal(resumed.status, 200);
  const result = await resumed.json();
  assert.equal(result.assignment.assignmentId, assignment.assignmentId);
  assert.equal(result.workerError, null);
});
