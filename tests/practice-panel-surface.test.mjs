import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";
import { PracticePanelServerV1 } from "../.tmp/runtime/apps/desktop-host/src/practice-panel-server.js";

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
  assert.ok(result.reasons.some((reason) => /no mastered Practice success path/.test(reason)));

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
  assert.match(html, /practice-panel\.js/);

  assert.match(client, /finishPath/);
  assert.match(client, /videoPaths/);
  assert.match(client, /audioPaths/);
  assert.match(html, /id="cancel-action"/);
  assert.match(client, /\/v1\/product\/pro-creation/);
  assert.match(client, /\/v1\/product\/runs\//);
  assert.match(client, /\/cancel/);
  assert.match(client, /WAITING_FOR_GPT/);
  assert.match(client, /GPT is orchestrating EditFlow Brain/);
});
