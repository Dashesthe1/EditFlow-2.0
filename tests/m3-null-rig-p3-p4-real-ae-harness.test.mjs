import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/m3-null-rig-p3-p4-cli.ts";
const acceptancePath = "scripts/windows/run-m3-null-rig-p3-p4.ps1";
const selfHostedPath = "scripts/windows/run-m3-null-rig-p3-p4-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-null-rig-real-ae-p3-p4.yml";

test("null-rig P3/P4 CLI emits reviewable controller renders and exact rollback evidence without overclaim", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /AE_NULL_RIG_PROTOCOL_VERSION_V15/);
  assert.match(source, /AE_PARENTING_PROTOCOL_VERSION_V14/);
  assert.match(source, /AE_ADAPTER_PROTOCOL_VERSION_V11/);
  assert.match(source, /supportedProtocolVersions:\s*\[AE_NULL_RIG_PROTOCOL_VERSION_V15, AE_PARENTING_PROTOCOL_VERSION_V14, AE_ADAPTER_PROTOCOL_VERSION_V11\]/);

  assert.match(source, /p3-attached-neutral\.avi/);
  assert.match(source, /p3-rig-driven\.avi/);
  assert.match(source, /p3-detached-preserved\.avi/);
  assert.match(source, /p4-post-rollback\.avi/);
  assert.match(source, /rig\.null\.create/);
  assert.match(source, /rig\.null\.readback/);
  assert.match(source, /layer\.set_parent_preserve_transform/);
  assert.match(source, /layer\.clear_parent_preserve_transform/);
  assert.match(source, /layer\.set_transform/);
  assert.match(source, /geometryMoved\(neutralGeometry, drivenGeometry\)/);
  assert.match(source, /geometryClose\(drivenGeometry, detachedGeometry\)/);
  assert.match(source, /M3_NULL_RIG_P4_FAILURE_INJECTION/);
  assert.match(source, /M3_NULL_RIG_P4_INDUCED_FAILURE/);
  assert.match(source, /p4_fingerprint_restored/);
  assert.match(source, /p4_item_count_restored/);
  assert.match(source, /p4_failed_rig_absent/);
  assert.match(source, /p4_main_rig_readback_restored/);
  assert.match(source, /cleanup_fingerprint_restored/);
  assert.match(source, /VISUAL_REVIEW_REQUIRED/);
  assert.match(source, /P3_visual_artifact_emitted:/);
  assert.match(source, /P3_visual_proof:\s*false/);
  assert.match(source, /P4_failure_injection_rollback:/);
  assert.match(source, /P5_save_reopen_reconnect_transfer:\s*false/);
});

test("null-rig P3/P4 acceptance requires independent P3 review, P4 exact recovery, and baseline cleanup", async () => {
  const source = await readFile(acceptancePath, "utf8");
  assert.match(source, /EDITFLOW_M3_NULL_RIG_P4_PROOF/);
  assert.match(source, /m3-null-rig-p3-p4-cli\.js/);
  assert.match(source, /VISUAL_REVIEW_REQUIRED/);
  assert.match(source, /P3_visual_artifact_emitted/);
  assert.match(source, /must not self-claim P3 visual acceptance/);
  assert.match(source, /P4_failure_injection_rollback/);
  assert.match(source, /must not claim P5 transfer/);
  assert.match(source, /p3_rig_drive_geometry_moved/);
  assert.match(source, /p3_detach_no_jump/);
  assert.match(source, /p4_fingerprint_restored/);
  assert.match(source, /p4_item_count_restored/);
  assert.match(source, /p4_failed_rig_absent/);
  assert.match(source, /cleanup_fingerprint_restored/);
  assert.match(source, /cleanup_item_count_restored/);
});

test("null-rig P3/P4 self-hosted wrapper preflights repository and isolates the proof environment", async () => {
  const source = await readFile(selfHostedPath, "utf8");
  assert.match(source, /run-m3-mask-p3-p4-self-hosted\.ps1/);
  assert.match(source, /npm run check/);
  assert.match(source, /run-m3-null-rig-p3-p4\.ps1/);
  assert.match(source, /m3-null-rig-p3-p4/);
  assert.match(source, /EDITFLOW_M3_NULL_RIG_P4_PROOF/);
  assert.match(source, /authenticated protocol 1\.5 registration/);
  assert.match(source, /EDITFLOW_M3_MASK_P4_PROOF/);
  assert.match(source, /EDITFLOW_M3_COMPOSITE_P4_PROOF/);
  assert.match(source, /EDITFLOW_M3_PARENTING_P4_PROOF/);
  assert.doesNotMatch(source, /Invoke-Expression/);
  assert.doesNotMatch(source, /\$TempPath = Join-Path \$env:TEMP/);
});

test("null-rig P3/P4 workflow is bounded, self-hosted, trigger-only, and always uploads evidence", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /ae-test\/m3-null-rig-p3-p4-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-null-rig-p3-p4\.txt/);
  assert.match(source, /runs-on:\s*\[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /timeout-minutes:\s*12/);
  assert.match(source, /run-m3-null-rig-p3-p4-self-hosted\.ps1/);
  assert.match(source, /proofs\/artifacts\/m3-null-rig-p3-p4\//);
  assert.match(source, /if:\s*always\(\)/);
  assert.doesNotMatch(source, /pull_request:/);
});
