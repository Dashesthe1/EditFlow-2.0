import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/m3-parenting-p3-p4-cli.ts";
const acceptancePath = "scripts/windows/run-m3-parenting-p3-p4.ps1";
const selfHostedPath = "scripts/windows/run-m3-parenting-p3-p4-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-parenting-real-ae-p3-p4.yml";

test("parenting P3/P4 CLI retains three visual states, five-point geometry, and an independent recovery render", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /supportedProtocolVersions:\s*\[AE_PARENTING_PROTOCOL_VERSION_V14, AE_ADAPTER_PROTOCOL_VERSION_V11\]/);
  for (const point of ["topLeft", "topRight", "bottomRight", "bottomLeft", "center"]) {
    assert.match(source, new RegExp(point));
  }
  assert.match(source, /geometryClose\(initialGeometry, parentedGeometry\)/);
  assert.match(source, /geometryClose\(initialGeometry, clearedGeometry\)/);
  assert.match(source, /p3-initial\.avi/);
  assert.match(source, /p3-parented\.avi/);
  assert.match(source, /p3-cleared\.avi/);
  assert.match(source, /p4-post-rollback\.avi/);
  assert.match(source, /P3_visual_artifact_emitted/);
  assert.match(source, /P3_visual_proof:\s*false/);
  assert.match(source, /visualReviewRequired:\s*true/);
  assert.match(source, /VISUAL_REVIEW_REQUIRED/);
});

test("parenting P3/P4 refreshes checked v1.1 state after each v1.4 mutation", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /const setParent = await dispatchV14[\s\S]*?await refreshState\(\);[\s\S]*?renderComp\(parentedRenderPath\)/);
  assert.match(source, /const clearParent = await dispatchV14[\s\S]*?await refreshState\(\);[\s\S]*?renderComp\(clearedRenderPath\)/);
  assert.match(source, /p3_parented_v11_state_refreshed/);
  assert.match(source, /p3_cleared_v11_state_refreshed/);
  assert.match(source, /cross-protocol revision\/fingerprint safety is preserved rather than bypassed/);
});

test("parenting P3/P4 harness verifies proof-owned cleanup and never loops broad fallback Undo", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /const verifyBaselineOnly = async/);
  assert.match(source, /Proof-owned cleanup did not restore the blank baseline/);
  assert.match(source, /await verifyBaselineOnly\(\)/);
  assert.doesNotMatch(source, /undoUntilBaseline/);
  assert.doesNotMatch(source, /client\.undoLast\(/);
  assert.doesNotMatch(source, /CLEANUP_UNDO_/);
});

test("parenting P4 CLI demands a proof-gated post-mutation failure and exact fresh recovery", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /M3_PARENTING_P4_FAILURE_INJECTION/);
  assert.match(source, /M3_PARENTING_P4_INDUCED_FAILURE/);
  assert.match(source, /Failed parenting mutation self-rolled back with AE Undo\./);
  assert.match(source, /afterFailure\.observed\.projectFingerprint === beforeFailure\.observed\.projectFingerprint/);
  assert.match(source, /stableJson\(afterFailureParenting\) === beforeFailureJson/);
  assert.match(source, /geometryClose\(beforeFailureGeometry, geometryPoints\(afterFailureParenting\)\)/);
  assert.match(source, /P4_failure_injection_rollback/);
  assert.match(source, /P5_save_reopen_reconnect_transfer:\s*false/);
});

test("parenting P3/P4 wrapper cannot self-accept P3 and requires P4 plus cleanup", async () => {
  const source = await readFile(acceptancePath, "utf8");
  assert.match(source, /EDITFLOW_M3_PARENTING_P4_PROOF/);
  assert.match(source, /cleanupComplete -ne \$true/);
  assert.match(source, /status -ne "VISUAL_REVIEW_REQUIRED"/);
  assert.match(source, /P3_visual_artifact_emitted/);
  assert.match(source, /P3_visual_proof/);
  assert.match(source, /must not self-claim P3 visual acceptance/);
  assert.match(source, /P4_failure_injection_rollback/);
  assert.match(source, /p3_parented_multi_point_geometry_preserved/);
  assert.match(source, /p3_cleared_multi_point_geometry_preserved/);
  assert.match(source, /p4_fingerprint_restored/);
  assert.match(source, /p4_fresh_readback_restored/);
});

test("parenting self-hosted wrapper derives from the accepted P3/P4 runner and isolates proof flags", async () => {
  const source = await readFile(selfHostedPath, "utf8");
  assert.match(source, /run-m3-mask-p3-p4-self-hosted\.ps1/);
  assert.match(source, /run-m3-parenting-p3-p4\.ps1/);
  assert.match(source, /proofs\\artifacts\\m3-parenting-p3-p4/);
  assert.match(source, /EDITFLOW_M3_PARENTING_P4_PROOF/);
  assert.match(source, /Remove-Item Env:EDITFLOW_M3_MASK_P4_PROOF/);
  assert.match(source, /Remove-Item Env:EDITFLOW_M3_COMPOSITE_P4_PROOF/);
  assert.match(source, /authenticated protocol 1\.4 registration/);
  assert.doesNotMatch(source, /Invoke-Expression/);
  assert.doesNotMatch(source, /\$TempPath = Join-Path \$env:TEMP/);
});

test("parenting P3/P4 workflow is bounded, self-hosted, trigger-only, and always uploads evidence", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /ae-test\/m3-parenting-p3-p4-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-parenting-p3-p4\.txt/);
  assert.match(source, /runs-on:\s*\[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /timeout-minutes:\s*12/);
  assert.match(source, /run-m3-parenting-p3-p4-self-hosted\.ps1/);
  assert.match(source, /proofs\/artifacts\/m3-parenting-p3-p4\//);
  assert.match(source, /if:\s*always\(\)/);
  assert.doesNotMatch(source, /pull_request:/);
});
