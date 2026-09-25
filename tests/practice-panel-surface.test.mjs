import assert from "node:assert/strict";
import { mkdir, readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";
import { PracticePanelServerV1 } from "../.tmp/runtime/apps/desktop-host/src/practice-panel-server.js";
import { GptOrchestrationStoreV1 } from "../.tmp/runtime/packages/practice-homework/src/index.js";

const token = "practice-panel-test-token-0123456789abcdef";
const headers = {
  "Content-Type": "application/json",
  "X-EditFlow-Token": token,
};

test("Practice panel product API is authenticated and preserves readiness gates", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-practice-panel-"));
  const videoPath = path.join(root, "raw-video.mp4");
  await writeFile(videoPath, "fixture-video", "utf8");

  const broker = new LoopbackCepBroker({ port: 0, token });
  await broker.start();
  const service = new PracticePanelServerV1({
    port: 0,
    token,
    repositoryRoot: process.cwd(),
    artifactDir: path.join(root, "artifacts"),
    learningMemoryFilePath: path.join(root, "state", "memory.json"),
    editTypeRegistryFilePath: path.join(root, "state", "edit-types.json"),
    broker,
  });
  const port = await service.start();
  const base = "http://127.0.0.1:" + String(port);
  t.after(async () => {
    await service.stop();
    await broker.stop();
    await rm(root, { recursive: true, force: true });
  });

  const unauthorized = await fetch(base + "/v1/product/status");
  assert.equal(unauthorized.status, 401);

  const status = await fetch(base + "/v1/product/status", { headers });
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), {
    service: "READY",
    panelConnected: false,
    gptOrchestration: "ASSIGNMENT_QUEUE_READY",
    activeRunId: null,
    latestRunId: null,
  });

  const created = await fetch(base + "/v1/product/edit-types", {
    method: "POST",
    headers,
    body: JSON.stringify({
      editTypeId: "cinematic-action",
      title: "Cinematic Action",
    }),
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).editType.title, "Cinematic Action");

  const listed = await fetch(base + "/v1/product/edit-types", { headers });
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).editTypes.length, 1);

  const preparation = await fetch(base + "/v1/product/pro-creation/prepare", {
    method: "POST",
    headers,
    body: JSON.stringify({
      editTypeId: "cinematic-action",
      videoPaths: [videoPath],
      audioPaths: [],
    }),
  });
  assert.equal(preparation.status, 200);
  const result = (await preparation.json()).preparation;
  assert.equal(result.status, "BLOCKED");
  assert.ok(
    result.reasons.some((reason) => /no transfer-verified GPT Practice knowledge/.test(reason)),
  );

  const practice = await fetch(base + "/v1/product/practice", {
    method: "POST",
    headers,
    body: JSON.stringify({
      editTypeId: "cinematic-action",
      finishPath: videoPath,
      videoPaths: [videoPath],
      audioPaths: [],
    }),
  });
  assert.equal(practice.status, 409);
  assert.match((await practice.json()).error, /CEP panel is not connected/);
});

test("Practice panel restores persisted runs and saved human review after restart", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-practice-recovery-"));
  const artifactDir = path.join(root, "artifacts");
  const gptPath = path.join(root, "state", "gpt-orchestration.json");
  const registryPath = path.join(root, "state", "edit-types.json");
  const finishPath = path.join(root, "finish.mp4");
  const videoPath = path.join(root, "raw-video.mp4");
  await writeFile(finishPath, "finish", "utf8");
  await writeFile(videoPath, "start", "utf8");

  const store = new GptOrchestrationStoreV1(gptPath);
  const assignment = await store.createAssignment({
    sessionId: "practice:recovered",
    mode: "PRACTICE",
    practiceRole: "LEARNING",
    editTypeId: "cinematic-action",
    finish: {
      mediaId: "finish:1",
      role: "FINISH_REFERENCE",
      mediaKind: "VIDEO",
      uri: finishPath,
    },
    start: [{
      mediaId: "video:1",
      role: "START_SOURCE",
      mediaKind: "VIDEO",
      uri: videoPath,
    }],
    artifactDir: path.join(artifactDir, "practice-recovered"),
    knowledge: null,
  });

  const broker = new LoopbackCepBroker({ port: 0, token });
  await broker.start();
  let service = new PracticePanelServerV1({
    port: 0,
    token,
    repositoryRoot: process.cwd(),
    artifactDir,
    learningMemoryFilePath: path.join(root, "state", "memory.json"),
    editTypeRegistryFilePath: registryPath,
    gptOrchestrationFilePath: gptPath,
    broker,
  });
  let port = await service.start();
  let base = "http://127.0.0.1:" + String(port);
  t.after(async () => {
    await service.stop();
    await broker.stop();
    await rm(root, { recursive: true, force: true });
  });

  let status = await (await fetch(base + "/v1/product/status", { headers })).json();
  assert.equal(status.activeRunId, "practice:recovered");
  assert.equal(status.latestRunId, "practice:recovered");
  let run = (await (await fetch(
    base + "/v1/product/runs/" + encodeURIComponent("practice:recovered"),
    { headers },
  )).json()).run;
  assert.equal(run.state, "WAITING_FOR_GPT");
  assert.deepEqual(run.videoPaths, [videoPath]);
  assert.equal(run.finishPath, finishPath);

  await service.stop();
  await store.claim(assignment.assignmentId, "recovery-test");
  await store.complete(assignment.assignmentId, {
    success: true,
    finalRenderRef: videoPath,
    finalSummary: "Recovered completion.",
  });
  const reviewDir = path.join(artifactDir, "human-reviews");
  await mkdir(reviewDir, { recursive: true });
  await writeFile(
    path.join(reviewDir, "practice-recovered.json"),
    JSON.stringify({
      schema: "editflow.practice-human-review.v1",
      sessionId: "practice:recovered",
      editTypeId: "cinematic-action",
      sceneFidelity: 4,
      timingPacing: 4,
      effectsTransitions: 3,
      visualFinish: 4,
      overall: 4,
      notes: "Retained review",
      createdAt: "2026-09-23T00:00:00.000Z",
      evidenceRefs: ["practice-human-review:NON_AUTHORITATIVE_V1"],
    }),
    "utf8",
  );

  service = new PracticePanelServerV1({
    port: 0,
    token,
    repositoryRoot: process.cwd(),
    artifactDir,
    learningMemoryFilePath: path.join(root, "state", "memory.json"),
    editTypeRegistryFilePath: registryPath,
    gptOrchestrationFilePath: gptPath,
    broker,
  });
  port = await service.start();
  base = "http://127.0.0.1:" + String(port);
  status = await (await fetch(base + "/v1/product/status", { headers })).json();
  assert.equal(status.activeRunId, null);
  assert.equal(status.latestRunId, "practice:recovered");
  run = (await (await fetch(
    base + "/v1/product/runs/" + encodeURIComponent("practice:recovered"),
    { headers },
  )).json()).run;
  assert.equal(run.state, "COMPLETED");
  assert.equal(run.finalRenderRef, videoPath);
  assert.equal(run.finalSummary, "Recovered completion.");
  assert.equal(run.humanReview.overall, 4);
  assert.equal(run.humanReview.notes, "Retained review");
});

test("CEP surface exposes Practice and Pro Creation without weakening media roles", async () => {
  const root = path.join(
    process.cwd(),
    "packages",
    "adapters",
    "ae-cep",
    "extension",
  );
  const html = await readFile(path.join(root, "html", "index.html"), "utf8");
  const client = await readFile(path.join(root, "client", "practice-panel.js"), "utf8");

  assert.match(html, /data-mode="PRACTICE"/);
  assert.match(html, /data-mode="PRO_CREATION"/);
  assert.match(html, />Finish</);
  assert.match(html, />Start</);
  assert.match(html, /Proceed to do homework/);
  assert.match(html, /value="AUTO"/);
  assert.match(html, /Automatic progression/);
  assert.match(html, /HELD_OUT_CERTIFICATION/);
  assert.match(html, /held-out certification/i);
  assert.match(html, /id="practice-lifecycle-card"/);
  assert.match(html, /id="practice-lifecycle-maturity"/);
  assert.match(html, /id="practice-lifecycle-steps"/);
  assert.match(html, /id="practice-lifecycle-next"/);
  assert.match(html, /practice-panel\.js/);

  assert.match(client, /finishPath/);
  assert.match(client, /videoPaths/);
  assert.match(client, /audioPaths/);
  assert.match(client, /practiceRole: selectedPracticeRole\(\)/);
  assert.match(client, /effectivePracticeRole/);
  assert.match(client, /transferVerifiedReady/);
  assert.match(client, /referenceVerifiedPracticeSessionCount/);
  assert.match(client, /transferVerifiedPracticeSessionCount/);
  assert.match(client, /heldOutCases/);
  assert.match(client, /heldOutProofVerified/);
  assert.match(client, /retainedTruthSuiteReports/);
  assert.match(client, /autoProgressionBlock/);
  assert.match(client, /Retained truth required/);
  assert.match(client, /Benchmark refresh required/);
  assert.match(client, /1 Reference proof/);
  assert.match(client, /2 Transfer proof/);
  assert.match(client, /3 Held-out generalization/);
  assert.match(client, /4 Retained truth authority/);
  assert.match(client, /Reused reference or Start bytes are rejected before transfer promotion/);
  assert.match(client, /AUTO runs held-out generalization/);
  assert.match(client, /More held-out edits are not the current blocker/);
  assert.match(client, /No new edit is required for this refresh/);
  assert.match(client, /Practice is ROBUST/);
  assert.match(client, /frozen transfer-verified knowledge/i);
  assert.match(client, /Failed machine-proven cases remain in the benchmark/);
  assert.match(html, /id="cancel-action"/);
  assert.match(html, /id="open-best-attempt"/);
  assert.match(html, /id="human-review-form"/);
  assert.match(html, /Human review is diagnostic feedback only/);
  assert.match(html, /name="sceneFidelity"/);
  assert.match(html, /name="timingPacing"/);
  assert.match(html, /name="effectsTransitions"/);
  assert.match(html, /name="visualFinish"/);
  assert.match(client, /\/v1\/product\/pro-creation/);
  assert.match(client, /\/v1\/product\/runs\//);
  assert.match(client, /\/cancel/);
  assert.match(client, /\/open-best-attempt/);
  assert.match(client, /\/human-review/);
  assert.match(client, /It does not change machine mastery/);
  assert.match(client, /WAITING_FOR_GPT/);
  assert.match(client, /GPT is orchestrating EditFlow Brain/);
});
