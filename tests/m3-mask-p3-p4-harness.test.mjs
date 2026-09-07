import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/m3-mask-p3-p4-cli.ts";
const acceptancePath = "scripts/windows/run-m3-mask-p3-p4.ps1";
const selfHostedPath = "scripts/windows/run-m3-mask-p3-p4-self-hosted.ps1";
const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_masks.jsx";
const protocolPath = "packages/adapters/ae-cep/src/protocol-v1_2.ts";
const workflowPath = ".github/workflows/m3-real-ae-p3-p4.yml";

test("M3 P3/P4 CLI builds a deterministic visible mask construction and retains visual evidence", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /createBmp24/);
  assert.match(source, /p3-background\.bmp/);
  assert.match(source, /p3-foreground\.bmp/);
  assert.match(source, /media\.import/);
  assert.match(source, /layer\.add_media/);
  assert.match(source, /mask\.create/);
  assert.match(source, /mask\.set_path/);
  assert.match(source, /render\.capture/);
  assert.match(source, /p3-mask-reveal\.avi/);
  assert.match(source, /p4-post-rollback\.avi/);
  assert.match(source, /P3_visual_artifact_emitted/);
  assert.match(source, /P3_visual_proof:\s*false/);
  assert.match(source, /visualReviewRequired:\s*true/);
  assert.match(source, /VISUAL_REVIEW_REQUIRED/);
});

test("M3 P4 proof induces a post-mutation host failure and verifies real AE Undo recovery", async () => {
  const host = await readFile(hostPath, "utf8");
  const execute = host.indexOf("var result = executePrepared(request, prepared);");
  const injection = host.indexOf('request.readbackProfile === "M3_MASK_P4_FAILURE_INJECTION"');
  const endUndo = host.indexOf("app.endUndoGroup();", execute);
  const catchBlock = host.indexOf("catch (operationError)", execute);
  const undo = host.indexOf("app.executeCommand(16);", catchBlock);
  assert.ok(execute >= 0 && injection > execute && endUndo > injection,
    "proof injection must occur after the real mutation but before the undo group is successfully closed");
  assert.ok(catchBlock > injection && undo > catchBlock,
    "the induced failure must flow through the existing M3 catch/AE-Undo recovery path");
  assert.match(host, /request\.command === "mask\.set_properties"/);
  assert.match(host, /\$\.getenv\("EDITFLOW_M3_MASK_P4_PROOF"\) === "1"/);
  assert.match(host, /M3_MASK_P4_INDUCED_FAILURE/);
  assert.match(host, /Failed mutation self-rolled back with AE Undo/);

  const cli = await readFile(cliPath, "utf8");
  assert.match(cli, /M3_MASK_P4_FAILURE_INJECTION/);
  assert.match(cli, /M3_MASK_P4_INDUCED_FAILURE/);
  assert.match(cli, /p4_self_rollback_note/);
  assert.match(cli, /p4_fingerprint_restored/);
  assert.match(cli, /p4_mask_state_restored/);
  assert.match(cli, /P4_failure_injection_rollback/);
  assert.match(cli, /P5_save_reopen_reconnect_transfer:\s*false/);
});

test("M3 P4 proof hook is doubly gated and the runner arms it only for its owned AE process", async () => {
  const host = await readFile(hostPath, "utf8");
  assert.match(host, /request\.readbackProfile === "M3_MASK_P4_FAILURE_INJECTION"/);
  assert.match(host, /EDITFLOW_M3_MASK_P4_PROOF/);

  const runner = await readFile(selfHostedPath, "utf8");
  assert.match(runner, /\$env:EDITFLOW_M3_MASK_P4_PROOF = "1"/);
  assert.match(runner, /P4_PROOF_INJECTION_ARMED/);
  assert.match(runner, /Remove-Item Env:EDITFLOW_M3_MASK_P4_PROOF/);
  assert.match(runner, /P4_PROOF_INJECTION_DISARMED/);
  assert.match(runner, /run-m3-mask-p3-p4\.ps1/);
  assert.match(runner, /refuses to touch an already-running After Effects session/);
  assert.doesNotMatch(runner, /Invoke-Expression/);
});

test("M3 P3/P4 acceptance wrapper requires artifact evidence, recovery, cleanup, and forbids P3/P5 overclaim", async () => {
  const source = await readFile(acceptancePath, "utf8");
  assert.match(source, /EDITFLOW_M3_MASK_P4_PROOF/);
  assert.match(source, /cleanupComplete -ne \$true/);
  assert.match(source, /VISUAL_REVIEW_REQUIRED/);
  assert.match(source, /P3_visual_artifact_emitted/);
  assert.match(source, /P3_visual_proof/);
  assert.match(source, /must not self-claim P3 visual acceptance/);
  assert.match(source, /P4_failure_injection_rollback/);
  assert.match(source, /P5_save_reopen_reconnect_transfer/);
  assert.match(source, /must not claim P5 transfer/);
  assert.match(source, /m3-mask-p3-p4-cli\.js/);
});

test("M3 mask adapter build advances without changing the protocol version or public command set", async () => {
  const source = await readFile(protocolPath, "utf8");
  assert.match(source, /AE_MASK_PROTOCOL_VERSION_V12 = "1\.2\.0"/);
  assert.match(source, /AE_MASK_ADAPTER_BUILD_V12 = "0\.4\.0-dev\.2"/);
  for (const command of ["mask.create", "mask.remove", "mask.duplicate", "mask.reorder", "mask.set_path", "mask.set_properties", "mask.readback"]) {
    assert.match(source, new RegExp(command.replace(".", "\\.")));
  }
  assert.doesNotMatch(source, /mask\.proof|failure_injection.*AE_MASK_COMMANDS_V12/);
});

test("M3 P3/P4 workflow remains isolated to the interactive self-hosted Windows AE runner", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /ae-test\/m3-mask-p3-p4-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-mask-p3-p4\.txt/);
  assert.match(source, /runs-on:\s*\[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /run-m3-mask-p3-p4-self-hosted\.ps1/);
  assert.match(source, /proofs\/artifacts\/m3-mask-p3-p4\//);
  assert.match(source, /if:\s*always\(\)/);
  assert.doesNotMatch(source, /pull_request:/);
});
