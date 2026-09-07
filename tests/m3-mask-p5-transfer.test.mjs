import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/m3-mask-p5-cli.ts";
const reopenPath = "scripts/windows/m3-mask-p5-reopen.jsx";
const cleanupPath = "scripts/windows/m3-mask-p5-cleanup.jsx";
const acceptancePath = "scripts/windows/run-m3-mask-p5.ps1";
const selfHostedPath = "scripts/windows/run-m3-mask-p5-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-real-ae-p5.yml";
const protocolPath = "packages/adapters/ae-cep/src/protocol-v1_2.ts";

test("M3 P5 harness proves save reopen authenticated reconnect exact mask transfer and fresh write authority", async () => {
  const source = await readFile(cliPath, "utf8");

  assert.match(source, /executeV11\("project\.save"/);
  assert.match(source, /m3-mask-p5-transfer\.aep/);
  assert.match(source, /launchAfterFxScript\(afterFxPath, reopenScriptPath\)/);
  assert.match(source, /await broker\.stop\(\)/);
  assert.match(source, /await broker\.start\(\)/);
  assert.match(source, /await broker\.waitForPanel\(timeoutMs\)/);
  assert.match(source, /secondPanel\.sessionId !== firstSessionId/);
  assert.match(source, /mask_exact_after_reopen_reconnect/);
  assert.match(source, /stableJson\(afterReconnectMask\) === stableJson\(beforeSaveMask\)/);
  assert.match(source, /mask\.set_properties/);
  assert.match(source, /M3_MASK_P5_POST_RECONNECT_MUTATION/);
  assert.match(source, /path_animation_survived_post_reconnect_mutation/);
  assert.match(source, /saved_project_retained_after_cleanup/);
  assert.match(source, /cleanup_fingerprint_restored/);
  assert.match(source, /P5_save_reopen_reconnect_transfer:\s*ok/);
});

test("M3 P5 records prior P1-P4 as accepted baseline rather than replaying or overclaiming them", async () => {
  const source = await readFile(cliPath, "utf8");

  assert.match(source, /mainMergeCommit:\s*"2f7af5fba1fe67d663ff84b17c59ca8c5c551ebb"/);
  assert.match(source, /p3p4RealAeRun:\s*34073726432/);
  assert.match(source, /P1_validation_rejection:\s*"accepted-baseline-not-replayed"/);
  assert.match(source, /P2_structural_readback:\s*"accepted-baseline-not-replayed"/);
  assert.match(source, /P3_visual_proof:\s*"accepted-baseline-not-replayed"/);
  assert.match(source, /P4_failure_injection_rollback:\s*"accepted-baseline-not-replayed"/);
});

test("M3 P5 reopen is fixed-path proof-only and forces a fresh dispatcher registration", async () => {
  const source = await readFile(reopenPath, "utf8");

  assert.match(source, /PROOF_ENV = "EDITFLOW_M3_MASK_P5_PROOF"/);
  assert.match(source, /\$\.getenv\(PROOF_ENV\) !== "1"/);
  assert.match(source, /proofs\/artifacts\/m3-mask-p5-transfer/);
  assert.match(source, /m3-mask-p5-transfer\.aep/);
  assert.match(source, /app\.project\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\)|app\.project\.close/);
  assert.match(source, /app\.open\(projectFile\)/);
  assert.match(source, /\$\.global\.EditFlow2_dispatch = undefined/);
  assert.match(source, /\$\.evalFile\(hostScript\)/);
  assert.match(source, /typeof \$\.global\.EditFlow2_dispatch !== "function"/);
  assert.doesNotMatch(source, /EditFlow2_dispatch\s*=\s*function/);
});

test("M3 P5 cleanup fails closed to the exact saved proof fixture and retains the AEP evidence", async () => {
  const source = await readFile(cleanupPath, "utf8");

  assert.match(source, /EDITFLOW_M3_MASK_P5_PROOF/);
  assert.match(source, /app\.project\.numItems !== 2/);
  assert.match(source, /M3_MASK_P5_/);
  assert.match(source, /_SOURCE_COMP/);
  assert.match(source, /_TARGET_COMP/);
  assert.match(source, /_LAYER/);
  assert.match(source, /_MASK/);
  assert.match(source, /sourceComp\.numLayers !== 0/);
  assert.match(source, /targetComp\.numLayers !== 1/);
  assert.match(source, /masks\.numProperties !== 1/);
  assert.match(source, /project\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\)/);
  assert.match(source, /app\.newProject\(\)/);
  assert.match(source, /retainedProjectPath:\s*projectFile\.fsName/);
  assert.doesNotMatch(source, /projectFile\.remove/);
});

test("M3 P5 acceptance wrapper requires real transfer, cleanup, and retained saved project evidence", async () => {
  const source = await readFile(acceptancePath, "utf8");

  assert.match(source, /EDITFLOW_M3_MASK_P5_PROOF/);
  assert.match(source, /m3-mask-p5-cli\.js/);
  assert.match(source, /cleanupComplete -ne \$true/);
  assert.match(source, /status -ne "ACCEPTED"/);
  assert.match(source, /P5_save_reopen_reconnect_transfer/);
  assert.match(source, /authenticated_reconnect/);
  assert.match(source, /mask_exact_after_reopen_reconnect/);
  assert.match(source, /post_reconnect_mutation_readback/);
  assert.match(source, /saved_project_retained_after_cleanup/);
});

test("M3 P5 self-hosted runner is zero-baseline isolated and arms proof scripts only for its owned AE process", async () => {
  const source = await readFile(selfHostedPath, "utf8");

  assert.match(source, /refuses to touch an already-running After Effects session/);
  assert.match(source, /\$env:EDITFLOW_M3_MASK_P5_PROOF = "1"/);
  assert.match(source, /P5_PROOF_ARMED/);
  assert.match(source, /Remove-Item Env:EDITFLOW_M3_MASK_P5_PROOF/);
  assert.match(source, /P5_PROOF_DISARMED/);
  assert.match(source, /run-m3-mask-p5\.ps1/);
  assert.match(source, /EXECUTE_COMMAND_SENT/);
  assert.match(source, /Stop-OwnedAfterFxSet/);
  assert.doesNotMatch(source, /Invoke-Expression/);
});

test("M3 P5 workflow remains isolated to a manual control branch on the interactive Windows AE runner", async () => {
  const source = await readFile(workflowPath, "utf8");

  assert.match(source, /ae-test\/m3-mask-p5-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-mask-p5\.txt/);
  assert.match(source, /runs-on:\s*\[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /run-m3-mask-p5-self-hosted\.ps1/);
  assert.match(source, /proofs\/artifacts\/m3-mask-p5-transfer\/\*\*/);
  assert.match(source, /if:\s*always\(\)/);
  assert.doesNotMatch(source, /pull_request:/);
});

test("M3 P5 proof adds no public mask commands and leaves protocol 1.2 command surface unchanged", async () => {
  const source = await readFile(protocolPath, "utf8");
  for (const command of ["mask.create", "mask.remove", "mask.duplicate", "mask.reorder", "mask.set_path", "mask.set_properties", "mask.readback"]) {
    assert.match(source, new RegExp(command.replace(".", "\\.")));
  }
  assert.doesNotMatch(source, /mask\.save|mask\.reopen|mask\.reconnect|mask\.proof/);
});
