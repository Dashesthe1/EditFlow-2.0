import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");

test("Current Shadow control plane integrates Practice on the same CEP broker", async () => {
  const source = await read("scripts/current-shadow-control-daemon.mjs");
  assert.match(source, /PracticePanelServerV1/);
  assert.match(source, /resolvePracticeStatePathsV1/);
  assert.match(source, /const practicePanel = new PracticePanelServerV1/);
  assert.match(source, /broker,/);
  assert.match(source, /await practicePanel\.start\(\)/);
  assert.match(source, /url\.pathname\.startsWith\("\/v1\/product\/"\)/);
  assert.match(source, /proxyPracticeRequest\(req, res\)/);
  assert.match(source, /integrated: true/);
  assert.match(source, /await practicePanel\.stop\(\)/);
});

test("Practice launcher requires the sole ChatGPT workflow and switches only an idle EditFlow daemon", async () => {
  const source = await read("scripts/windows/run-practice-panel.ps1");
  assert.match(source, /CHATGPT_PRODUCTION_WORKFLOW_V1/);
  assert.match(source, /\/v1\/product\/status/);
  assert.match(source, /ControlStatus\.repoRoot -eq \$RepoRoot/);
  assert.match(source, /mutationLease\.held/);
  assert.match(source, /current-shadow-control-daemon\[\.\]mjs/);
  assert.match(source, /& node \$DaemonPath/);
});
