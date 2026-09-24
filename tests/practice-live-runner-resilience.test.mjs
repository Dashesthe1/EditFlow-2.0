import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/practice-live-cli.ts";
const runnerPath = "scripts/windows/run-practice-live-proof.ps1";

test("Practice live runner defaults to canonical persistent state with an explicit override", async () => {
  const source = await readFile(runnerPath, "utf8");

  assert.match(source, /EDITFLOW_PRACTICE_STATE_DIR/);
  assert.match(source, /LOCALAPPDATA/);
  assert.match(source, /EditFlow2\\practice-state/);
  assert.match(source, /\.editflow2\\practice-state/);
  assert.match(source, /\$NodeArgs \+= @\("--state-dir", \$StateDir\)/);
});

test("Practice live runner can re-open the installed CEP panel through the active After Effects process", async () => {
  const source = await readFile(runnerPath, "utf8");

  assert.match(source, /open-editflow2-panel\.jsx/);
  assert.match(source, /Get-Process -Name "AfterFX"/);
  assert.match(source, /\$AfterFxCandidates\.Count -eq 1/);
  assert.match(source, /"--afterfx-path", \$AfterFxPath, "--panel-bootstrap", \$PanelBootstrap/);
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
