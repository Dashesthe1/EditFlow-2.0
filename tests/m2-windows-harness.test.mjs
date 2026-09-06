import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const proofPath = "proofs/ae/m2-real-host-proof.jsx";
const runnerPath = "scripts/windows/run-m2-ae-acceptance.ps1";
const selfHostedRunnerPath = "scripts/windows/run-m2-ae-self-hosted.ps1";
const panelBootstrapPath = "scripts/windows/open-editflow-bridge.jsx";
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

test("Windows acceptance prints render lifecycle evidence on bounded proof failure", async () => {
  const source = await readFile(runnerPath, "utf8");
  assert.match(source, /\$RenderLifecyclePath = \$RenderPath \+ "\.editflow-render\.json"/);
  assert.match(source, /function Write-RenderLifecycleEvidence/);
  assert.match(source, /Render lifecycle marker:/);
  assert.match(source, /if \(-not \$Result\.ok\)[\s\S]*Write-RenderLifecycleEvidence[\s\S]*M2 bounded real-AE proof did not pass/);
});

test("self-hosted AE launcher runs only in an interactive clean session, publishes bootstrap evidence, and owns the AE process it stops", async () => {
  const source = await readFile(selfHostedRunnerPath, "utf8");
  assert.match(source, /\[Environment\]::UserInteractive/);
  assert.match(source, /Get-Process -Name "AfterFX"/);
  assert.match(source, /refuses to touch an already-running After Effects session/);
  assert.match(source, /install-editflow-cep\.ps1/);
  assert.match(source, /open-editflow-bridge\.jsx/);
  assert.match(source, /EditFlow2-self-hosted-panel-bootstrap\.log/);
  assert.match(source, /function Publish-PanelBootstrapEvidence/);
  assert.match(source, /panel-bootstrap\.log/);
  assert.match(source, /Start-Process -FilePath \$AfterFxPath -ArgumentList @\("-r", \$QuotedBootstrap\)/);
  assert.match(source, /run-m2-ae-acceptance\.ps1/);
  assert.match(source, /finally\s*\{[\s\S]*Publish-PanelBootstrapEvidence/);
  assert.match(source, /if \(\$StartedAfterFx\)/);
  assert.match(source, /Stop-Process -Force/);
  assert.doesNotMatch(source, /Stop-Process -Force[\s\S]*before.*Start-Process/i);
});

test("self-hosted AE bootstrap opens only the fixed EditFlow CEP menu command, records stages, and retries boundedly", async () => {
  const source = await readFile(panelBootstrapPath, "utf8");
  assert.match(source, /EditFlow2-self-hosted-panel-bootstrap\.log/);
  assert.match(source, /SCRIPT_STARTED/);
  assert.match(source, /INITIAL_TASK_SCHEDULED/);
  assert.match(source, /MENU_PROBE/);
  assert.match(source, /MENU_FOUND/);
  assert.match(source, /EXECUTE_COMMAND_SENT/);
  assert.match(source, /RETRY_EXHAUSTED/);
  assert.match(source, /var menuName = "EditFlow 2\.0 Bridge"/);
  assert.match(source, /app\.findMenuCommandId\(menuName\)/);
  assert.match(source, /app\.executeCommand\(commandId\)/);
  assert.match(source, /app\.scheduleTask\("\$\.global\.EditFlow2_selfHostedOpenBridge\(\)"/);
  assert.match(source, /var maxAttempts = 120/);
  assert.doesNotMatch(source, /eval\s*\(/);
  assert.doesNotMatch(source, /requestJson|payload|process\.argv/);
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

test("real-AE workflow is self-hosted and remotely triggerable only through the dedicated maintainer test branch", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /push:[\s\S]*branches:[\s\S]*ae-test\/m2-control/);
  assert.match(source, /paths:[\s\S]*\.github\/ae-test-trigger\/m2\.txt/);
  assert.match(source, /runs-on: \[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /run-m2-ae-self-hosted\.ps1/);
  assert.match(source, /concurrency:[\s\S]*editflow-m2-real-ae-workstation/);
  assert.doesNotMatch(source, /pull_request:/);
});
