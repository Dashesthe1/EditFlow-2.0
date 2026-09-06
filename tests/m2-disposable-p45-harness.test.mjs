import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const proofPath = "proofs/ae/m2-disposable-p4-p5-proof.jsx";
const runnerPath = "scripts/windows/run-m2-ae-p4-p5.ps1";
const bootstrapPath = "scripts/windows/m2-p45-command-bootstrap-template.jsx";
const boundedRunnerPath = "scripts/windows/run-m2-ae-self-hosted.ps1";
const workflowPath = ".github/workflows/m2-real-ae-p4-p5.yml";

test("P4/P5 proof refuses before AE mutations unless the project is blank and unsaved", async () => {
  const source = await readFile(proofPath, "utf8");
  assert.match(source, /initialWasBlankUnsaved = app\.project && app\.project\.file === null && app\.project\.numItems === 0/);
  const guardIndex = source.indexOf("if (!initialWasBlankUnsaved)");
  const firstAdapterMutation = source.indexOf('call("comp.create"');
  assert.ok(guardIndex >= 0 && firstAdapterMutation > guardIndex);
  assert.match(source, /REFUSED: P4\/P5 proof requires a blank unsaved project/);
  assert.match(source, /CloseOptions\.DO_NOT_SAVE_CHANGES/);
  assert.match(source, /app\.newProject\(\)/);
});

test("P4/P5 proof uses timestamps supported by the target ExtendScript runtime", async () => {
  const source = await readFile(proofPath, "utf8");
  assert.match(source, /function utcTimestamp\(\)/);
  assert.match(source, /\(new Date\(\)\)\.toUTCString\(\)/);
  assert.match(source, /startedAt = utcTimestamp\(\)/);
  assert.match(source, /completedAt: utcTimestamp\(\)/);
  assert.doesNotMatch(source, /toISOString/);
});

test("P4/P5 proof explicitly covers rollback and required stable-identity cases", async () => {
  const source = await readFile(proofPath, "utf8");
  assert.match(source, /failure_injected/);
  assert.match(source, /transaction\.undo_last/);
  assert.match(source, /rename_identity/);
  assert.match(source, /duplicate_identity/);
  assert.match(source, /reorder_identity/);
  assert.match(source, /precompose_replacement_identity/);
  assert.match(source, /project\.save/);
  assert.match(source, /app\.open\(projectFile\)/);
  assert.match(source, /reconnected_dispatcher/);
  assert.match(source, /transfer_after_reconnect/);
});

test("P4/P5 and bounded M2 runners share the same default target After Effects executable", async () => {
  const [runner, boundedRunner] = await Promise.all([
    readFile(runnerPath, "utf8"),
    readFile(boundedRunnerPath, "utf8"),
  ]);
  const target = '[string]$AfterFxPath = "C:\\Program Files\\Adobe\\Adobe After Effects 2025\\Support Files\\AfterFX.exe"';
  assert.ok(runner.includes(target));
  assert.ok(boundedRunner.includes(target));
  assert.match(runner, /declared M2 target After Effects/);
});

test("P4/P5 command runner requires a zero-AE baseline and never attaches to a pre-existing session", async () => {
  const runner = await readFile(runnerPath, "utf8");

  assert.match(runner, /Get-Process -Name "AfterFX"/);
  assert.match(runner, /\$ExistingAfterFx\.Count -gt 0/);
  assert.match(runner, /Refusing disposable P4\/P5 command proof because After Effects is already running/);
  assert.match(runner, /Close AE first; no writes were attempted/);
});

test("P4/P5 runner writes a bounded wrapper and passes only that fixed file through AfterFX -r", async () => {
  const runner = await readFile(runnerPath, "utf8");

  assert.match(runner, /m2-p45-command-bootstrap-template\.jsx/);
  assert.match(runner, /m2-p45-command-bootstrap\.jsx/);
  assert.match(runner, /System\.IO\.File\]::WriteAllText\(\$CommandBootstrap, \$BootstrapSource, \$Utf8NoBom\)/);
  assert.match(runner, /\$Arguments = @\("-r", \('\"' \+ \$CommandBootstrap \+ '\"'\)\)/);
  assert.match(runner, /Start-Process -FilePath \$AfterFx -ArgumentList \$Arguments -PassThru/);
  assert.match(runner, /delivery=-r/);
  assert.doesNotMatch(runner, /Scripts\\Startup/);
});

test("P4/P5 runner records process diagnostics around command delivery", async () => {
  const runner = await readFile(runnerPath, "utf8");

  assert.match(runner, /startup-diagnostics\.log/);
  assert.match(runner, /function Write-StartupDiagnostic/);
  assert.match(runner, /function Write-AeProcessSnapshot/);
  assert.match(runner, /runnerSessionId=/);
  assert.match(runner, /bootstrapLength=/);
  assert.match(runner, /MainWindowHandle/);
  assert.match(runner, /MainWindowTitle/);
  assert.match(runner, /\.Responding/);
  assert.match(runner, /Get-CimInstance Win32_Process/);
  assert.match(runner, /COMMAND_WAIT/);
  assert.match(runner, /COMMAND_WAIT_END/);
});

test("P4/P5 runner cleans only owned AE and prefers graceful close before force-stop", async () => {
  const runner = await readFile(runnerPath, "utf8");
  const guard = runner.indexOf("if ($ExistingAfterFx.Count -gt 0)");
  const launch = runner.indexOf("Start-Process -FilePath $AfterFx -ArgumentList $Arguments -PassThru");
  const cleanup = runner.indexOf('$OwnedProcesses = @(Get-Process -Name "AfterFX"');
  const graceful = runner.indexOf("$Owned.CloseMainWindow()", cleanup);
  const force = runner.indexOf("Stop-Process -Force", cleanup);
  assert.ok(guard >= 0 && launch > guard && cleanup > launch);
  assert.ok(graceful > cleanup && force > graceful);
  assert.match(runner, /Every\s*\n\s*# AfterFX process present now belongs to this bounded proof/);
  assert.match(runner, /Graceful AE close did not finish/);
  assert.match(runner, /CLEANUP_FORCE_STOP/);
});

test("command bootstrap logs before proof execution, self-deletes, and invokes only the fixed P4/P5 proof file", async () => {
  const source = await readFile(bootstrapPath, "utf8");

  assert.match(source, /__EDITFLOW_PROOF_PATH__/);
  assert.match(source, /__EDITFLOW_RESULT_PATH__/);
  assert.match(source, /__EDITFLOW_LOG_PATH__/);
  assert.match(source, /__EDITFLOW_BOOTSTRAP_PATH__/);
  assert.match(source, /bootstrapFile\.remove\(\)/);
  assert.match(source, /COMMAND_BOOTSTRAP_LOADED/);
  assert.match(source, /if \(!app\.project\)/);
  assert.match(source, /app\.scheduleTask\("\$\.global\.EditFlow2_runM2P45CommandProof\(\)", 250, false\)/);
  assert.match(source, /\$\.evalFile\(proof\)/);
  assert.match(source, /PROOF_STARTED/);
  assert.match(source, /PROOF_RETURNED/);
  assert.match(source, /BOOTSTRAP_FAILED/);
  assert.doesNotMatch(source, /\beval\s*\(/);
});

test("P4/P5 workflow is self-hosted, serialized with other AE proofs, and has an explicit control-branch trigger", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /ae-test\/m2-p45-control/);
  assert.match(workflow, /\.github\/ae-test-trigger\/m2-p45\.txt/);
  assert.match(workflow, /group: editflow-m2-real-ae-workstation/);
  assert.match(workflow, /runs-on: \[self-hosted, Windows, editflow-ae\]/);
  assert.doesNotMatch(workflow, /pull_request:/);
});

test("current AE host loader includes failed-operation atomicity wrapper", async () => {
  const loader = await readFile("packages/adapters/ae-cep/host/editflow_host_current.jsx", "utf8");
  const atomicity = await readFile("packages/adapters/ae-cep/host/editflow_host_atomicity.jsx", "utf8");
  assert.match(loader, /editflow_host_atomicity\.jsx/);
  assert.match(atomicity, /response\.outcome === "FAILED"/);
  assert.match(atomicity, /app\.executeCommand\(16\)/);
  assert.match(atomicity, /self-rollback the failed operation/);
  assert.doesNotMatch(atomicity, /\beval\s*\(/);
});
