import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/m3-parenting-p1-p2-cli.ts";
const acceptancePath = "scripts/windows/run-m3-parenting-p1-p2.ps1";
const selfHostedPath = "scripts/windows/run-m3-parenting-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-parenting-real-ae-p1-p2.yml";

test("parenting P1/P2 CLI opts into 1.4, exercises rejection/idempotency, and does not overclaim proof maturity", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /supportedProtocolVersions:\s*\[AE_PARENTING_PROTOCOL_VERSION_V14, AE_ADAPTER_PROTOCOL_VERSION_V11\]/);
  assert.match(source, /panel\.protocolVersion === AE_PARENTING_PROTOCOL_VERSION_V14/);
  assert.match(source, /new AeCepAdapterClientV11/);
  assert.match(source, /buildParentingRequestV14/);
  assert.match(source, /transformReadback\(parentTransformResponse\)/);
  assert.match(source, /transformReadback\(childTransformResponse\)/);
  assert.match(source, /transformMatches\(parentSetupTransform, parentTransform\)/);
  assert.match(source, /transformMatches\(childSetupTransform, childTransform\)/);
  assert.match(source, /setupTransformEvidence/);
  assert.match(source, /PARENT_SELF_REFERENCE/);
  assert.match(source, /HOST_REVISION_CONFLICT/);
  assert.match(source, /PARENT_CYCLE/);
  assert.match(source, /layer\.set_parent_preserve_transform/);
  assert.match(source, /layer\.clear_parent_preserve_transform/);
  assert.match(source, /layer\.parenting_readback/);
  assert.match(source, /p2_repeat_set_no_op/);
  assert.match(source, /p2_repeat_clear_no_op/);
  assert.match(source, /p2_set_parent_comp_space_preserved/);
  assert.match(source, /p2_clear_parent_comp_space_preserved/);
  assert.match(source, /p2_set_parent_local_transform_compensated/);
  assert.match(source, /cleanup_fingerprint_restored/);
  assert.match(source, /P1_validation_rejection/);
  assert.match(source, /P2_structural_readback/);
  assert.match(source, /P3_visual_proof:\s*false/);
  assert.match(source, /P4_failure_injection_rollback:\s*false/);
  assert.match(source, /P5_save_reopen_reconnect_transfer:\s*false/);
});

test("parenting acceptance wrapper requires cleanup, no-jump geometry evidence, and no P3/P4/P5 overclaim", async () => {
  const source = await readFile(acceptancePath, "utf8");
  assert.match(source, /cleanupComplete -ne \$true/);
  assert.match(source, /p2_set_parent_local_transform_compensated/);
  assert.match(source, /p2_set_parent_comp_space_preserved/);
  assert.match(source, /p2_clear_parent_comp_space_preserved/);
  assert.match(source, /cleanup_fingerprint_restored/);
  assert.match(source, /must not claim P3, P4, or P5/);
  assert.match(source, /m3-parenting-p1-p2-cli\.js/);
});

test("parenting self-hosted wrapper reuses the accepted runner in a repo-relative generated script", async () => {
  const source = await readFile(selfHostedPath, "utf8");
  assert.match(source, /\$TemplatePath = Join-Path \$RepoRoot "scripts\\windows\\run-m3-mask-self-hosted\.ps1"/);
  assert.match(source, /\$TempPath = Join-Path \$PSScriptRoot \("run-m3-parenting-self-hosted-generated-"/);
  assert.match(source, /run-m3-parenting-p1-p2\.ps1/);
  assert.match(source, /m3-parenting-p1-p2/);
  assert.match(source, /authenticated protocol 1\.4 registration/);
  assert.doesNotMatch(source, /\$TempPath = Join-Path \$env:TEMP/);
  assert.doesNotMatch(source, /Invoke-Expression/);
  assert.match(source, /Remove-Item \$TempPath -Force -ErrorAction SilentlyContinue/);
});

test("parenting real-AE workflow is self-hosted, bounded, path-scoped and artifact-producing", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /ae-test\/m3-parenting-p1-p2-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-parenting-p1-p2\.txt/);
  assert.match(source, /runs-on:\s*\[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /timeout-minutes:\s*10/);
  assert.match(source, /shell:\s*cmd/);
  assert.match(source, /powershell\.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File/);
  assert.match(source, /run-m3-parenting-self-hosted\.ps1/);
  assert.match(source, /proofs\/artifacts\/m3-parenting-p1-p2\//);
  assert.match(source, /if:\s*always\(\)/);
  assert.doesNotMatch(source, /pull_request:/);
});
