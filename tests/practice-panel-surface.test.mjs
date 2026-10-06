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
  const service = new PracticePanelServerV1({ productionSupervision: false,
    port: 0,
    token,
    repositoryRoot: process.cwd(),
    artifactDir: path.join(root, "artifacts"),
    learningMemoryFilePath: path.join(root, "state", "memory.json"),
    editTypeRegistryFilePath: path.join(root, "state", "edit-types.json"),
    retainedTruthManifestPath: path.join(root, "missing-retained-truth.json"),
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
    primaryWorkflow: "CHATGPT_PRODUCTION_WORKFLOW_V1",
    availableWorkflows: ["CHATGPT_PRODUCTION_WORKFLOW_V1"],
    workflowSelectionAllowed: false,
    workflowFallback: false,
    practiceWorkflow: "CHATGPT_PRODUCTION_WORKFLOW_V1",
    proCreationWorkflow: "CHATGPT_PRODUCTION_WORKFLOW_V1",
    practiceStartup: "RESUMABLE_PREFLIGHT_V1",
    practiceWorkflowAuthority: "CHATGPT_DIRECT_EDITORIAL_AUTHORITY_V1",
    primaryProductionSystem: "DURABLE_PRODUCTION_QUEUE_V1",
    productionModes: ["PRACTICE", "PRO_CREATION"],
    directMutationRoutes: "REMOVED",
    productionJobKinds: ["AE_TRANSACTION", "AE_CORRECTION", "AE_GOAL", "AE_BATCH", "BUILD_BASELINE", "PROOF_SCRIPT", "SCRATCH_SEARCH", "LOCAL_RENDER", "SAVE_CHECKPOINT", "REFERENCE_ANALYSIS"],
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

  const recertification = await fetch(
    base + "/v1/product/edit-types/cinematic-action/robust-recertification",
    { method: "POST", headers, body: "{}" },
  );
  assert.equal(recertification.status, 404);
  assert.match((await recertification.json()).error, /NOT_FOUND|Not found|not found/);

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
  assert.equal(result.status, "READY");
  assert.deepEqual(result.reasons, []);

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
  assert.equal(practice.status, 202);
  const persistedRun = (await practice.json()).run;
  assert.ok(persistedRun.assignmentId);
  const resume = await (await fetch(base + "/v1/product/practice/resume-or-start", { headers })).json();
  assert.equal(resume.assignment.assignmentId, persistedRun.assignmentId);
  assert.equal(resume.nextOperation, "RESUME_PREFLIGHT");
  assert.ok(resume.production);
  const production = await (await fetch(
    base + "/v1/product/gpt/assignments/" + encodeURIComponent(persistedRun.assignmentId) + "/production",
    { headers },
  )).json();
  assert.equal(production.production.sessionId, persistedRun.sessionId);
  assert.equal(production.strategy.action, "CONTINUE");
  assert.ok(production.telemetry);
  const assignmentStore = new GptOrchestrationStoreV1(path.join(root, "artifacts", "state", "gpt-orchestration.json"));
  await assignmentStore.claim(persistedRun.assignmentId, "test-controller");
  const checkpoint = await fetch(
    base + "/v1/product/gpt/assignments/" + encodeURIComponent(persistedRun.assignmentId) + "/production",
    {
      method: "POST", headers,
      body: JSON.stringify({
        action: "AE_CHECKPOINT", claimedBy: "test-controller", projectId: "practice-test-project", projectRevision: 7,
        activeCompId: "comp:test", projectPath: "C:/Practice/test.aep",
      }),
    },
  );
  assert.equal(checkpoint.status, 200);
  assert.equal((await checkpoint.json()).production.aeCheckpoint.projectRevision, 7);
  const mutation = await fetch(base + "/v1/product/control/run-batch", {
    method: "POST", headers, body: JSON.stringify({ intents: [] }),
  });
  assert.equal(mutation.status, 410);
  assert.equal((await mutation.json()).error, "EDIT_EXECUTION_PATH_REMOVED");
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
  let service = new PracticePanelServerV1({ productionSupervision: false,
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

  service = new PracticePanelServerV1({ productionSupervision: false,
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
  assert.doesNotMatch(html, /HELD_OUT_CERTIFICATION|Automatic progression|practice-recertify/);
  assert.match(html, /Practice notebook/);
  assert.match(html, /practice-panel\.js/);

  assert.match(client, /finishPath/);
  assert.match(client, /videoPaths/);
  assert.match(client, /audioPaths/);
  assert.match(client, /practiceRole: "LEARNING"/);
  assert.doesNotMatch(client, /robust-recertification|HELD_OUT_CERTIFICATION|autoProgressionBlock/);
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
  assert.match(client, /Review saved as feedback/);
  assert.match(client, /WAITING_FOR_GPT/);
  assert.match(client, /ChatGPT is directly reviewing footage/);
});


test("Practice event batch endpoint preserves individual validated events with one HTTP roundtrip", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "editflow-practice-event-batch-"));
  const artifactDir = path.join(root, "artifacts");
  const gptPath = path.join(root, "state", "gpt-orchestration.json");
  const registryPath = path.join(root, "state", "edit-types.json");
  const broker = new LoopbackCepBroker({ port: 0, token });
  await broker.start();
  const service = new PracticePanelServerV1({ productionSupervision: false,
    port: 0,
    token,
    repositoryRoot: process.cwd(),
    artifactDir,
    learningMemoryFilePath: path.join(root, "state", "memory.json"),
    editTypeRegistryFilePath: registryPath,
    gptOrchestrationFilePath: gptPath,
    broker,
  });
  const port = await service.start();
  const base = "http://127.0.0.1:" + String(port);
  t.after(async () => {
    await service.stop();
    await broker.stop();
    await rm(root, { recursive: true, force: true });
  });

  const editType = await fetch(base + "/v1/product/edit-types", {
    method: "POST",
    headers,
    body: JSON.stringify({ editTypeId: "batch-test", title: "Batch Test" }),
  });
  assert.equal(editType.status, 201);

  const store = new GptOrchestrationStoreV1(gptPath);
  const assignment = await store.createAssignment({
    sessionId: "practice:event-batch",
    mode: "PRACTICE",
    practiceRole: "LEARNING",
    editTypeId: "batch-test",
    finish: {
      mediaId: "finish:batch",
      role: "FINISH_REFERENCE",
      mediaKind: "VIDEO",
      uri: path.join(root, "finish.mp4"),
    },
    start: [{
      mediaId: "start:batch",
      role: "START_SOURCE",
      mediaKind: "VIDEO",
      uri: path.join(root, "start.mp4"),
    }],
    artifactDir: path.join(artifactDir, "practice-event-batch"),
    knowledge: null,
  });
  await store.claim(assignment.assignmentId, "batch-test-controller");

  const response = await fetch(
    base + "/v1/product/gpt/assignments/" + encodeURIComponent(assignment.assignmentId) + "/events/batch",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        events: [
          { stage: "OBSERVATION", summary: "Observed reference overview." },
          { stage: "HYPOTHESIS", summary: "Defined one bounded construction hypothesis." },
        ],
      }),
    },
  );
  assert.equal(response.status, 201);
  assert.equal((await response.json()).eventCount, 2);
  const events = await store.eventsForSession(assignment.sessionId);
  assert.deepEqual(events.map((event) => event.stage), ["OBSERVATION", "HYPOTHESIS"]);

  const rejected = await fetch(
    base + "/v1/product/gpt/assignments/" + encodeURIComponent(assignment.assignmentId) + "/events/batch",
    {
      method: "POST",
      headers,
      body: JSON.stringify({ events: [
        { stage: "DIAGNOSIS", summary: "This must not partially persist." },
        { stage: "CAPABILITY_PROOF", summary: "Missing required capability gap." },
      ] }),
    },
  );
  assert.equal(rejected.status, 400);
  assert.deepEqual(
    (await store.eventsForSession(assignment.sessionId)).map((event) => event.stage),
    ["OBSERVATION", "HYPOTHESIS"],
  );
});
