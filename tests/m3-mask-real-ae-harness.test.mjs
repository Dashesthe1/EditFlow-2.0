import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/m3-mask-p1-p2-cli.ts";
const acceptancePath = "scripts/windows/run-m3-mask-p1-p2.ps1";
const selfHostedPath = "scripts/windows/run-m3-mask-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-real-ae-p1-p2.yml";

test("M3 mask P1/P2 CLI explicitly opts into protocol 1.2 while retaining typed M2 setup", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /supportedProtocolVersions:\s*\[AE_MASK_PROTOCOL_VERSION_V12, AE_ADAPTER_PROTOCOL_VERSION_V11\]/);
  assert.match(source, /panel\.protocolVersion === AE_MASK_PROTOCOL_VERSION_V12/);
  assert.match(source, /new AeCepAdapterClientV11/);
  assert.match(source, /buildMaskRequestV12/);
  assert.match(source, /MASK_TANGENT_LENGTH_MISMATCH/);
  assert.match(source, /p1_revision_unchanged/);
  assert.match(source, /p1_fingerprint_unchanged/);
  assert.match(source, /mask\.create/);
  assert.match(source, /mask\.readback/);
  assert.match(source, /mask\.set_path/);
  assert.match(source, /mask\.set_properties/);
  assert.match(source, /mask\.duplicate/);
  assert.match(source, /mask\.reorder/);
  assert.match(source, /mask\.remove/);
  assert.match(source, /P1_validation_rejection/);
  assert.match(source, /P2_structural_readback/);
  assert.match(source, /P3_visual_proof:\s*false/);
  assert.match(source, /P4_failure_injection_rollback:\s*false/);
  assert.match(source, /P5_save_reopen_reconnect_transfer:\s*false/);
});

test("M3 PowerShell wrapper requires cleanup and refuses proof overclaim", async () => {
  const source = await readFile(acceptancePath, "utf8");
  assert.match(source, /cleanupComplete -ne \$true/);
  assert.match(source, /P1_validation_rejection/);
  assert.match(source, /P2_structural_readback/);
  assert.match(source, /P3_visual_proof/);
  assert.match(source, /P4_failure_injection_rollback/);
  assert.match(source, /P5_save_reopen_reconnect_transfer/);
  assert.match(source, /must not claim P3, P4, or P5/);
  assert.match(source, /m3-mask-p1-p2-cli\.js/);
});

test("M3 self-hosted runner owns an isolated AE process and uses only the fixed repository bootstrap", async () => {
  const source = await readFile(selfHostedPath, "utf8");
  assert.match(source, /\[Environment\]::UserInteractive/);
  assert.match(source, /refuses to touch an already-running After Effects session/);
  assert.match(source, /install-editflow-cep\.ps1/);
  assert.match(source, /open-editflow-bridge\.jsx/);
  assert.match(source, /@\("-r", \$PanelBootstrap\)/);
  assert.match(source, /run-m3-mask-p1-p2\.ps1/);
  assert.match(source, /Stopping only the isolated After Effects test process set/);
  assert.match(source, /Get-Process -Name "AfterFX".*Stop-Process -Force/);
  assert.doesNotMatch(source, /Invoke-Expression/);
});

test("M3 real-AE workflow is self-hosted, bounded, branch-scoped, and artifact-producing", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /ae-test\/m3-mask-p1-p2-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-mask-p1-p2\.txt/);
  assert.match(source, /runs-on:\s*\[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /timeout-minutes:\s*10/);
  assert.match(source, /run-m3-mask-self-hosted\.ps1/);
  assert.match(source, /proofs\/artifacts\/m3-mask-p1-p2\//);
  assert.match(source, /if:\s*always\(\)/);
  assert.doesNotMatch(source, /pull_request:/);
});
