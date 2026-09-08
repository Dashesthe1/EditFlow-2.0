import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const cliPath = "apps/desktop-host/src/m3-temporal-ease-p5-cli.ts";
const reopenPath = "scripts/windows/m3-temporal-ease-p5-reopen.jsx";
const cleanupPath = "scripts/windows/m3-temporal-ease-p5-cleanup.jsx";
const acceptancePath = "scripts/windows/run-m3-temporal-ease-p5.ps1";
const selfHostedPath = "scripts/windows/run-m3-temporal-ease-p5-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-temporal-ease-real-ae-p5.yml";

test("temporal ease P5 is blocked on explicit independently reviewed P1-P4 acceptance", async () => {
  const [cli, acceptance, selfHosted, workflow] = await Promise.all([
    readFile(cliPath, "utf8"),
    readFile(acceptancePath, "utf8"),
    readFile(selfHostedPath, "utf8"),
    readFile(workflowPath, "utf8"),
  ]);

  assert.match(cli, /--accepted-p1-p4/);
  assert.match(cli, /M3_TEMPORAL_EASE_P1_P4_ACCEPTANCE/);
  assert.match(cli, /P1_validation_rejection/);
  assert.match(cli, /P2_structural_readback/);
  assert.match(cli, /P3_visual_proof/);
  assert.match(cli, /P4_failure_injection_rollback/);
  assert.match(cli, /createHash\("sha256"\)/);
  assert.match(acceptance, /m3-temporal-ease-p1-p4-acceptance\.json/);
  assert.match(acceptance, /refuses to run until the retained P1-P4 acceptance record exists/);
  assert.match(selfHosted, /intentionally blocked until retained P1-P4 acceptance exists/);
  assert.match(workflow, /Require retained P1-P4 acceptance gate/);
  assert.match(workflow, /independently reviewed protocol-1\.8 P1-P4 acceptance/);
});

test("temporal ease P5 saves scalar Opacity ease then transfers fresh-session authority to the live three-component Scale surface", async () => {
  const source = await readFile(cliPath, "utf8");

  assert.match(source, /AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18/);
  assert.match(source, /AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17/);
  assert.match(source, /buildTemporalEaseRequestV18/);
  assert.match(source, /buildTemporalInterpolationRequestV17/);
  assert.match(source, /temporalContinuous: false/);
  assert.match(source, /temporalAutoBezier: false/);
  assert.match(source, /savedOpacityEase/);
  assert.match(source, /speed: 37\.5, influence: 26\.25/);
  assert.match(source, /speed: 142\.75, influence: 73\.5/);
  assert.match(source, /transferredScaleEase/);
  assert.match(source, /speed: 18\.25, influence: 32\.5/);
  assert.match(source, /speed: 72\.25, influence: 58\.75/);
  assert.match(source, /speed: 128\.5, influence: 61\.25/);
  assert.match(source, /propertyPath: opacityPath/);
  assert.match(source, /propertyPath: scalePath/);
  assert.match(source, /setEaseExact\(opacityPath, savedOpacityEase, 1/);
  assert.match(source, /SCALE_CARDINALITY_PROBE/);
  assert.match(source, /scale_live_cardinality_three/);
  assert.match(source, /easeCardinality\(scaleCardinalityProbe\) === 3/);
  assert.match(source, /setEaseExact\(scalePath, transferredScaleEase, 3/);
  assert.match(source, /\[140, 80, 115\]/);
  assert.match(source, /"project\.save"/);
  assert.match(source, /await broker\.stop\(\)/);
  assert.match(source, /await broker\.start\(\)/);
  assert.match(source, /secondPanel\.sessionId !== firstSessionId/);
  assert.match(source, /opacity_ease_exact_after_reopen_reconnect/);
  assert.match(source, /post_reconnect_scale_mutation_readback/);
  assert.match(source, /P5_save_reopen_reconnect_transfer: ok/);
});

test("temporal ease P5 fixed reopen and cleanup scripts are proof-gated v18-aware and exact-fixture only", async () => {
  const [reopen, cleanup] = await Promise.all([
    readFile(reopenPath, "utf8"),
    readFile(cleanupPath, "utf8"),
  ]);

  assert.match(reopen, /EDITFLOW_M3_TEMPORAL_EASE_P5_PROOF/);
  assert.match(reopen, /m3-temporal-ease-p5-transfer\.aep/);
  assert.match(reopen, /M3_TEMPORAL_EASE_P5_REOPEN/);
  assert.match(reopen, /editflow_host_current_v18\.jsx/);
  assert.match(reopen, /EditFlow2_dispatch = undefined/);
  assert.match(reopen, /\$\.evalFile\(hostScript\)/);
  assert.match(reopen, /app\.project\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\)/);
  assert.match(reopen, /app\.open\(projectFile\)/);

  assert.match(cleanup, /EDITFLOW_M3_TEMPORAL_EASE_P5_PROOF/);
  assert.match(cleanup, /M3_TEMPORAL_EASE_P5_/);
  assert.match(cleanup, /app\.project\.numItems !== 2/);
  assert.match(cleanup, /targetComp\.numLayers !== 1/);
  assert.match(cleanup, /ADBE Opacity/);
  assert.match(cleanup, /ADBE Scale/);
  assert.match(cleanup, /scaleValue\.length !== 3/);
  assert.match(cleanup, /closeNumber\(scaleValue\[2\], 115\)/);
  assert.match(cleanup, /speed: 72\.25, influence: 58\.75/);
  assert.match(cleanup, /keyTemporalContinuous\(keyIndex\) !== false/);
  assert.match(cleanup, /keyTemporalAutoBezier\(keyIndex\) !== false/);
  assert.match(cleanup, /keyInTemporalEase\(2\)/);
  assert.match(cleanup, /keyOutTemporalEase\(2\)/);
  assert.match(cleanup, /SAVED_OPACITY_IN/);
  assert.match(cleanup, /TRANSFER_SCALE_IN/);
  assert.match(cleanup, /project\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\)/);
  assert.match(cleanup, /app\.newProject\(\)/);

  assert.doesNotThrow(() => new vm.Script(reopen, { filename: reopenPath }));
  assert.doesNotThrow(() => new vm.Script(cleanup, { filename: cleanupPath }));
});

test("temporal ease P5 self-hosted lifecycle reuses accepted low-level launcher and allows only bounded pre-mutation registration retry", async () => {
  const source = await readFile(selfHostedPath, "utf8");

  assert.match(source, /run-m3-mask-p3-p4-self-hosted\.ps1/);
  assert.match(source, /run-m3-temporal-ease-p5\.ps1/);
  assert.match(source, /npm run check/);
  assert.match(source, /authenticated protocol 1\.8 registration/);
  assert.match(source, /EDITFLOW_M3_TEMPORAL_EASE_P5_PROOF/);
  assert.match(source, /EDITFLOW_M3_TEMPORAL_INTERPOLATION_P5_PROOF/);
  assert.match(source, /\$MaxPanelRegistrationAttempts = 2/);
  assert.match(source, /function Test-RetryablePanelRegistrationFailure/);
  assert.match(source, /CEP_PANEL_REGISTRATION_TIMEOUT/);
  assert.match(source, /\$null -eq \$Failure\.panel\.initialSession/);
  assert.match(source, /\$null -eq \$Failure\.panel\.reconnectedSession/);
  assert.match(source, /\$null -eq \$Failure\.baseline\.projectFingerprint/);
  assert.match(source, /\$null -eq \$Failure\.saved\.projectFingerprint/);
  assert.match(source, /\$Responses\.Count -eq 0/);
  assert.match(source, /-not \(Test-Path \$SavedProjectPath -PathType Leaf\)/);
  assert.match(source, /Get-Process -Name "AfterFX"/);
  assert.match(source, /\$RemainingAfterFx\.Count -ne 0/);
  assert.match(source, /Start-Sleep -Seconds 2/);
});

test("temporal ease P5 workflow is isolated on a dedicated control branch and retains artifacts", async () => {
  const source = await readFile(workflowPath, "utf8");

  assert.match(source, /ae-test\/m3-temporal-ease-p5-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-temporal-ease-p5\.txt/);
  assert.match(source, /run-m3-temporal-ease-p5-self-hosted\.ps1/);
  assert.match(source, /m3-temporal-ease-p5-proof-/);
  assert.match(source, /proofs\/artifacts\/m3-temporal-ease-p5-transfer/);
  assert.match(source, /runs-on: \[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /timeout-minutes: 15/);
});
