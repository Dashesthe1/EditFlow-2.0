import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const proofPath = "proofs/ae/m2-disposable-p4-p5-proof.jsx";
const runnerPath = "scripts/windows/run-m2-ae-p4-p5.ps1";
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

test("P4/P5 Windows runner binds a pre-existing session to its exact AfterFX executable", async () => {
  const runner = await readFile(runnerPath, "utf8");

  assert.match(runner, /Get-Process -Name "AfterFX"/);
  assert.match(runner, /Count -gt 1/);
  assert.match(runner, /multiple pre-existing After Effects sessions make the target ambiguous/);
  assert.match(runner, /\$ExistingPath = \$ExistingAfterFx\[0\]\.Path/);
  assert.match(runner, /\$AfterFx = \(Resolve-Path \$ExistingPath\)\.Path/);
  assert.match(runner, /StringComparer\]::OrdinalIgnoreCase\.Equals\(\$ExplicitResolved, \$AfterFx\)/);
  assert.match(runner, /does not match pre-existing AE PID/);
  assert.match(runner, /exact executable of pre-existing AE PID/);
  assert.match(runner, /blank\/unsaved\/zero-item gate is authoritative/);
  assert.match(runner, /runner will not close this process/);
});

test("P4/P5 Windows runner owns and closes AE only when no process existed before launch", async () => {
  const runner = await readFile(runnerPath, "utf8");

  assert.match(runner, /Start-Process -FilePath \$AfterFx -ArgumentList \$Arguments -PassThru/);
  assert.match(runner, /\$OwnedAfterFx = \$LaunchedAfterFx/);
  assert.match(runner, /\$OwnedAfterFx\.Id/);
  assert.match(runner, /Stop-Process -Id \$OwnedAfterFx\.Id -Force/);
  assert.match(runner, /Leaving pre-existing After Effects PID/);
  assert.match(runner, /status -eq "REFUSED"/);
  assert.doesNotMatch(runner, /Start AE first/);
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
