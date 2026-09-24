import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/practice-live-cli.ts";
const runnerPath = "scripts/windows/run-practice-live-proof.ps1";
const openerPath = "scripts/windows/open-editflow-bridge.jsx";

test("Practice live runner defaults to canonical persistent state with an explicit override", async () => {
  const source = await readFile(runnerPath, "utf8");

  assert.match(source, /EDITFLOW_PRACTICE_STATE_DIR/);
  assert.match(source, /LOCALAPPDATA/);
  assert.match(source, /EditFlow2\\practice-state/);
  assert.match(source, /\.editflow2\\practice-state/);
  assert.match(source, /\$NodeArgs \+= @\("--state-dir", \$StateDir\)/);
});

test("Practice live runner can cold-start or re-open the installed CEP panel", async () => {
  const source = await readFile(runnerPath, "utf8");

  assert.match(source, /open-editflow-bridge\.jsx/);
  assert.match(source, /Get-Process -Name "AfterFX"/);
  assert.match(source, /\$AfterFxCandidates\.Count -eq 1/);
  assert.match(source, /\$AfterFxCandidates\.Count -eq 0/);
  assert.match(source, /Adobe After Effects \*/);
  assert.match(source, /Support Files\\AfterFX\.exe/);
  assert.match(source, /\$InstalledAfterFx\.Count -gt 0/);
  assert.match(source, /"--afterfx-path", \$AfterFxPath, "--panel-bootstrap", \$PanelBootstrap/);
});

test("Practice AE bridge opener retries extension registration during cold start", async () => {
  const source = await readFile(openerPath, "utf8");

  assert.match(source, /var maxAttempts = 120/);
  assert.match(source, /var retryDelayMs = 500/);
  assert.match(source, /INITIAL_ATTEMPT_DIRECT/);
  assert.match(source, /MENU_FOUND/);
  assert.match(source, /app\.scheduleTask\("\$\.global\.EditFlow2_selfHostedOpenBridge\(\)"/);
  assert.match(source, /RETRY_EXHAUSTED/);
});

test("Practice live CLI fails closed on incomplete bootstrap configuration and self-recovers after reconnect grace", async () => {
  const source = await readFile(cliPath, "utf8");

  assert.match(source, /--afterfx-path and --panel-bootstrap must be supplied together/);
  assert.match(source, /isPanelRegistrationTimeout/);
  assert.match(source, /const reconnectGraceMs = Math\.min\(2_000/);
  assert.match(source, /await invokeAePanelBootstrap\(afterFxPath, panelBootstrapPath\)/);
  assert.match(source, /panelBootstrapInvoked = true/);
  assert.match(source, /panel = await broker\.waitForPanel\(Math\.max\(1_000, timeoutMs - reconnectGraceMs\)\)/);
});

test("Practice live result retains whether CEP recovery was invoked", async () => {
  const source = await readFile(cliPath, "utf8");

  assert.match(source, /panelBootstrap:\s*\{/);
  assert.match(source, /invoked: panelBootstrapInvoked/);
  assert.match(source, /afterFxPath/);
  assert.match(source, /panelBootstrapPath/);
});


test("Practice live held-out runner forwards only explicit learned-skill audit claims", async () => {
  const cli = await readFile(cliPath, "utf8");
  const runner = await readFile(runnerPath, "utf8");

  assert.match(cli, /argumentsFor\("--applied-skill-id"\)/);
  assert.match(cli, /--applied-skill-id is reserved for held-out certification/);
  assert.match(cli, /appliedSkillIds,/);
  assert.match(runner, /\[string\[\]\]\$AppliedSkillId = @\(\)/);
  assert.match(runner, /"--applied-skill-id", \$skillId\.Trim\(\)/);
  assert.match(runner, /Held-out skill coverage verified/);
});


test("Practice live learning allocation persists machine mastery before held-out lifecycle", async () => {
  const source = await readFile(cliPath, "utf8");
  const runner = await readFile(runnerPath, "utf8");

  assert.match(source, /practice-live-learning:/);
  assert.match(source, /practiceRole: "LEARNING"/);
  assert.match(source, /buildPracticeMasteryRecordV1\(\{/);
  assert.match(source, /registry\.beginGptLearningSession\(editTypeId, sessionId, "PRACTICE"\)/);
  assert.match(source, /registry\.completeGptLearningSession\(\{/);
  assert.match(source, /mastered: true/);
  assert.match(source, /masteryRecordRestored/);
  assert.match(source, /masteryProofRef/);
  assert.match(source, /learningMasteryAccepted/);
  assert.match(source, /learningProof,/);
  assert.match(source, /process\.exitCode = 7/);
  assert.match(runner, /Learning mastery scope/);
  assert.match(runner, /Learning mastery proof/);
  assert.match(runner, /Learning mastery restored/);
});

test("Practice live media preflight runs before CEP/AE connection", async () => {
  const source = await readFile(cliPath, "utf8");
  const fingerprintIndex = source.indexOf("fingerprintPracticeHeldOutMaterialV1({");
  const compatibilityIndex = source.indexOf("validatePracticePreAeSceneCompatibilityV1({ material })");
  const brokerIndex = source.indexOf("new LoopbackCepBroker({");
  assert.ok(fingerprintIndex >= 0, "media fingerprint preflight must be present");
  assert.ok(compatibilityIndex >= 0, "scene compatibility preflight must be present");
  assert.ok(brokerIndex >= 0, "CEP broker creation must be present");
  assert.ok(fingerprintIndex < compatibilityIndex, "scene compatibility requires material analysis first");
  assert.ok(compatibilityIndex < brokerIndex, "scene compatibility must happen before AE connection");
  assert.match(source, /exactSceneConfidence,/);
  assert.match(source, /AE connection was not opened/);
  assert.match(source, /validatePracticeTransferLearningMaterialV1/);
  assert.match(source, /validatePracticeHeldOutMaterialNoveltyV1/);
});
