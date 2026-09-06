import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const proofPath = "proofs/ae/m2-real-host-proof.jsx";
const runnerPath = "scripts/windows/run-m2-ae-acceptance.ps1";
const cepAcceptancePath = "apps/desktop-host/src/cep-write-acceptance-cli.ts";
const workflowPath = ".github/workflows/m2-real-ae.yml";

test("legacy direct real-AE proof remains bounded and does not replace or save the user's project", async () => {
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

test("Windows acceptance runner binds to running AE but executes proof through authenticated CEP instead of command-line JSX", async () => {
  const source = await readFile(runnerPath, "utf8");
  assert.match(source, /Get-Process -Name "AfterFX"/);
  assert.match(source, /\$Process\.Path/);
  assert.match(source, /Multiple After Effects installations are running/);
  assert.match(source, /explicit AfterFxPath is not an already running After Effects executable/);
  assert.match(source, /cep-write-acceptance-cli\.js/);
  assert.match(source, /Start-Process -FilePath "node"/);
  assert.match(source, /EditFlow 2\.0 Bridge open/);
  assert.doesNotMatch(source, /Start-Process -FilePath \$AfterFx/);
  assert.doesNotMatch(source, /\$Arguments = @\("-r"/);
  assert.doesNotMatch(source, /Get-ChildItem \$AdobeRoot/);
  assert.doesNotMatch(source, /Sort-Object Name -Descending/);
});

test("CEP real-AE acceptance performs bounded typed writes, render proof, stable-id readback, and cleanup without project save/open", async () => {
  const source = await readFile(cepAcceptancePath, "utf8");
  for (const command of [
    "comp.create",
    "layer.add_media",
    "layer.set_transform",
    "layer.set_timing",
    "effect.add",
    "effect.set_property",
    "property.set_keyframes",
    "property.set_expression",
    "render.capture",
    "layers.precompose",
    "comp.remove",
  ]) assert.match(source, new RegExp(`\\"${command.replaceAll(".", "\\.")}\\"`));
  assert.match(source, /new AeFilesystemPolicyV11\(\[artifactDir\]\)/);
  assert.match(source, /cleanup_restored_item_count/);
  assert.match(source, /projectSavePerformed:\s*false/);
  assert.match(source, /projectOpenReplacePerformed:\s*false/);
  assert.match(source, /P4_failure_injection_rollback:\s*false/);
  assert.match(source, /P5_save_reopen_reconnect_transfer:\s*false/);
  assert.doesNotMatch(source, /execute\("project\.save"/);
  assert.doesNotMatch(source, /execute\("media\.import"/);
});

test("acceptance result is final only after cleanup attempts and final readback complete", async () => {
  const cli = await readFile(cepAcceptancePath, "utf8");
  const runner = await readFile(runnerPath, "utf8");

  const catchIndex = cli.indexOf("} catch (error) {");
  const finallyIndex = cli.indexOf("} finally {", catchIndex);
  const firstResultWriteAfterCatch = cli.indexOf("writeJson(resultPath", catchIndex);
  assert.ok(catchIndex >= 0 && finallyIndex > catchIndex);
  assert.ok(firstResultWriteAfterCatch > finallyIndex, "result.json must not be finalized before cleanup begins");
  assert.match(cli, /failureError = error instanceof Error/);
  assert.match(cli, /cleanupComplete:\s*true/);
  assert.match(cli, /await cleanupComp\(targetStable\)/);
  assert.match(cli, /await cleanupComp\(precompStable\)/);
  assert.match(cli, /await cleanupComp\(sourceStable\)/);

  assert.match(runner, /\$CleanupComplete = \$CandidateResult\.cleanupComplete -eq \$true/);
  assert.match(runner, /M2 proof and cleanup are complete/);
  assert.match(runner, /before cleanup completion/);
  assert.match(runner, /\$Result\.cleanupComplete -ne \$true/);
});

test("real-AE GitHub workflow is manual and self-hosted rather than PR-triggered", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /runs-on: \[self-hosted, Windows, editflow-ae\]/);
  assert.doesNotMatch(source, /pull_request:/);
});
