import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const proofPath = "proofs/ae/m2-real-host-proof.jsx";
const runnerPath = "scripts/windows/run-m2-ae-acceptance.ps1";
const workflowPath = ".github/workflows/m2-real-ae.yml";

test("real-AE proof is bounded and does not replace or save the user's project", async () => {
  const source = await readFile(proofPath, "utf8");
  assert.match(source, /finally\s*\{/);
  assert.match(source, /cleanup_restored_item_count/);
  assert.match(source, /removeItemIfPresent/);
  assert.doesNotMatch(source, /app\.newProject\s*\(/);
  assert.doesNotMatch(source, /app\.open\s*\(/);
  assert.doesNotMatch(source, /app\.project\.save\s*\(/);
  assert.match(source, /P4_failure_injection_rollback:\s*false/);
  assert.match(source, /P5_save_reopen_reconnect_transfer:\s*false/);
});

test("Windows runner binds the proof to an already running AE executable and never guesses newest installed", async () => {
  const source = await readFile(runnerPath, "utf8");
  assert.match(source, /Get-Process -Name "AfterFX"/);
  assert.match(source, /\$Process\.Path/);
  assert.match(source, /Multiple After Effects installations are running/);
  assert.match(source, /explicit AfterFxPath is not an already running After Effects executable/);
  assert.match(source, /proofs\\ae\\m2-real-host-proof\.jsx/);
  assert.match(source, /Start-Process -FilePath \$AfterFx -ArgumentList \$Arguments/);
  assert.match(source, /-r/);
  assert.doesNotMatch(source, /Get-ChildItem \$AdobeRoot/);
  assert.doesNotMatch(source, /Sort-Object Name -Descending/);
});

test("real-AE GitHub workflow is manual and self-hosted rather than PR-triggered", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /runs-on: \[self-hosted, Windows, editflow-ae\]/);
  assert.doesNotMatch(source, /pull_request:/);
});
