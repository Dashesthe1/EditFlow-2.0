import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/m3-null-rig-p1-p2-cli.ts";
const acceptancePath = "scripts/windows/run-m3-null-rig-p1-p2.ps1";
const selfHostedPath = "scripts/windows/run-m3-null-rig-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-null-rig-real-ae-p1-p2.yml";

test("null-rig P1/P2 CLI opts into 1.5+1.4+1.1, proves guarded lifecycle/topology, and does not overclaim maturity", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /supportedProtocolVersions:\s*\[AE_NULL_RIG_PROTOCOL_VERSION_V15, AE_PARENTING_PROTOCOL_VERSION_V14, AE_ADAPTER_PROTOCOL_VERSION_V11\]/);
  assert.match(source, /panel\.protocolVersion === AE_NULL_RIG_PROTOCOL_VERSION_V15/);
  assert.match(source, /new AeCepAdapterClientV11/);
  assert.match(source, /buildNullRigRequestV15/);
  assert.match(source, /buildParentingRequestV14/);
  assert.match(source, /rig\.null\.create/);
  assert.match(source, /rig\.null\.readback/);
  assert.match(source, /rig\.null\.remove/);
  assert.match(source, /layer\.set_parent_preserve_transform/);
  assert.match(source, /layer\.clear_parent_preserve_transform/);
  assert.match(source, /HOST_REVISION_CONFLICT/);
  assert.match(source, /NULL_RIG_HAS_CHILDREN/);
  assert.match(source, /NULL_RIG_NOT_FOUND/);
  assert.match(source, /p2_repeat_create_no_op/);
  assert.match(source, /p2_topology_reports_child/);
  assert.match(source, /p2_topology_empty_after_detach/);
  assert.match(source, /p1_child_protected_fingerprint_unchanged/);
  assert.match(source, /p2_project_snapshot_rig_absent/);
  assert.match(source, /cleanup_fingerprint_restored/);
  assert.match(source, /P1_validation_rejection/);
  assert.match(source, /P2_structural_readback/);
  assert.match(source, /P3_visual_proof:\s*false/);
  assert.match(source, /P4_failure_injection_rollback:\s*false/);
  assert.match(source, /P5_save_reopen_reconnect_transfer:\s*false/);
});

test("null-rig acceptance wrapper requires cleanup, topology evidence, exact removal, and no P3/P4/P5 overclaim", async () => {
  const source = await readFile(acceptancePath, "utf8");
  assert.match(source, /cleanupComplete -ne \$true/);
  assert.match(source, /p1_child_protected_remove_rejected/);
  assert.match(source, /p1_child_protected_fingerprint_unchanged/);
  assert.match(source, /p2_create_exact_identity/);
  assert.match(source, /p2_topology_reports_child/);
  assert.match(source, /p2_topology_empty_after_detach/);
  assert.match(source, /p2_project_snapshot_rig_absent/);
  assert.match(source, /cleanup_fingerprint_restored/);
  assert.match(source, /must not claim P3, P4, or P5/);
  assert.match(source, /m3-null-rig-p1-p2-cli\.js/);
});

test("null-rig self-hosted wrapper reuses the accepted M3 runner in a repo-relative generated script", async () => {
  const source = await readFile(selfHostedPath, "utf8");
  assert.match(source, /\$TemplatePath = Join-Path \$RepoRoot "scripts\\windows\\run-m3-mask-self-hosted\.ps1"/);
  assert.match(source, /\$TempPath = Join-Path \$PSScriptRoot \("run-m3-null-rig-self-hosted-generated-"/);
  assert.match(source, /run-m3-null-rig-p1-p2\.ps1/);
  assert.match(source, /m3-null-rig-p1-p2/);
  assert.match(source, /authenticated protocol 1\.5 registration/);
  assert.doesNotMatch(source, /\$TempPath = Join-Path \$env:TEMP/);
  assert.doesNotMatch(source, /Invoke-Expression/);
  assert.match(source, /Remove-Item \$TempPath -Force -ErrorAction SilentlyContinue/);
});

test("null-rig real-AE workflow is self-hosted, bounded, path-scoped and artifact-producing", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /ae-test\/m3-null-rig-p1-p2-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-null-rig-p1-p2\.txt/);
  assert.match(source, /runs-on:\s*\[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /timeout-minutes:\s*10/);
  assert.match(source, /shell:\s*cmd/);
  assert.match(source, /powershell\.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File/);
  assert.match(source, /run-m3-null-rig-self-hosted\.ps1/);
  assert.match(source, /proofs\/artifacts\/m3-null-rig-p1-p2\//);
  assert.match(source, /if:\s*always\(\)/);
  assert.doesNotMatch(source, /pull_request:/);
});
