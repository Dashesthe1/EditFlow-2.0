import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const cliPath = "apps/desktop-host/src/m3-temporal-interpolation-p5-cli.ts";
const reopenPath = "scripts/windows/m3-temporal-interpolation-p5-reopen.jsx";
const cleanupPath = "scripts/windows/m3-temporal-interpolation-p5-cleanup.jsx";
const acceptancePath = "scripts/windows/run-m3-temporal-interpolation-p5.ps1";
const selfHostedPath = "scripts/windows/run-m3-temporal-interpolation-p5-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-temporal-interpolation-real-ae-p5.yml";

test("temporal interpolation P5 proves save reopen distinct protocol 1.7 reconnect and fresh transferred authority", async () => {
  const source = await readFile(cliPath, "utf8");

  assert.match(source, /AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17/);
  assert.match(source, /buildTemporalInterpolationRequestV17/);
  assert.match(source, /"project\.save"/);
  assert.match(source, /"property\.temporal_interpolation\.set"/);
  assert.match(source, /"property\.temporal_interpolation\.readback"/);
  assert.match(source, /await broker\.stop\(\)/);
  assert.match(source, /await broker\.start\(\)/);
  assert.match(source, /secondPanel\.sessionId !== firstSessionId/);
  assert.match(source, /secondPanel\.protocolVersion === AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17/);
  assert.match(source, /saved_structural_fingerprint_preserved/);
  assert.match(source, /temporal_exact_after_reopen_reconnect/);
  assert.match(source, /post_reconnect_mutation_applied/);
  assert.match(source, /post_reconnect_mutation_readback/);
  assert.match(source, /P5_save_reopen_reconnect_transfer: ok/);
});

test("temporal interpolation P5 transfers a distinctive flag-bearing state then proves asymmetric post-reconnect mutation", async () => {
  const source = await readFile(cliPath, "utf8");

  assert.match(source, /inType: "BEZIER"/);
  assert.match(source, /outType: "BEZIER"/);
  assert.match(source, /temporalContinuous: true/);
  assert.match(source, /temporalAutoBezier: true/);
  assert.match(source, /inType: "HOLD"/);
  assert.match(source, /outType: "LINEAR"/);
  assert.match(source, /keyIndex = 2/);
  assert.match(source, /keyTime = 0\.5/);
  assert.match(source, /saved_project_artifact/);
  assert.match(source, /saved_project_retained_after_cleanup/);
  assert.match(source, /P3_P4_run: 34166441340/);
  assert.match(source, /P3_P4_artifact: 10034335983/);
});

test("temporal interpolation P5 fixed reopen and cleanup scripts are proof-gated v17-aware fixed-path and exact-fixture only", async () => {
  const [reopen, cleanup] = await Promise.all([
    readFile(reopenPath, "utf8"),
    readFile(cleanupPath, "utf8"),
  ]);

  assert.match(reopen, /EDITFLOW_M3_TEMPORAL_INTERPOLATION_P5_PROOF/);
  assert.match(reopen, /m3-temporal-interpolation-p5-transfer\.aep/);
  assert.match(reopen, /M3_TEMPORAL_INTERPOLATION_P5_REOPEN/);
  assert.match(reopen, /editflow_host_current_v17\.jsx/);
  assert.match(reopen, /EditFlow2_dispatch = undefined/);
  assert.match(reopen, /\$\.evalFile\(hostScript\)/);
  assert.match(reopen, /app\.project\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\)/);
  assert.match(reopen, /app\.open\(projectFile\)/);

  assert.match(cleanup, /EDITFLOW_M3_TEMPORAL_INTERPOLATION_P5_PROOF/);
  assert.match(cleanup, /M3_TEMPORAL_P5_/);
  assert.match(cleanup, /app\.project\.numItems !== 2/);
  assert.match(cleanup, /targetComp\.numLayers !== 1/);
  assert.match(cleanup, /ADBE Opacity/);
  assert.match(cleanup, /opacity\.numKeys !== 3/);
  assert.match(cleanup, /KeyframeInterpolationType\.HOLD/);
  assert.match(cleanup, /KeyframeInterpolationType\.LINEAR/);
  assert.match(cleanup, /keyTemporalContinuous\(2\) !== false/);
  assert.match(cleanup, /keyTemporalAutoBezier\(2\) !== false/);
  assert.match(cleanup, /project\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\)/);
  assert.match(cleanup, /app\.newProject\(\)/);

  assert.doesNotThrow(() => new vm.Script(reopen, { filename: reopenPath }));
  assert.doesNotThrow(() => new vm.Script(cleanup, { filename: cleanupPath }));
});

test("temporal interpolation P5 wrappers reuse accepted P5 and protocol 1.7 self-hosted launch machinery without rewriting generator guards", async () => {
  const [acceptance, selfHosted] = await Promise.all([
    readFile(acceptancePath, "utf8"),
    readFile(selfHostedPath, "utf8"),
  ]);

  assert.match(acceptance, /run-m3-mask-p5\.ps1/);
  assert.match(acceptance, /m3-temporal-interpolation-p5-transfer/);
  assert.match(acceptance, /EDITFLOW_M3_TEMPORAL_INTERPOLATION_P5_PROOF/);
  assert.match(acceptance, /m3-temporal-interpolation-p5-cli\.js/);
  assert.match(acceptance, /temporal_exact_after_reopen_reconnect/);
  assert.match(acceptance, /34166441340/);

  assert.match(selfHosted, /run-m3-mask-p3-p4-self-hosted\.ps1/);
  assert.match(selfHosted, /run-m3-temporal-interpolation-p5\.ps1/);
  assert.match(selfHosted, /npm run check/);
  assert.match(selfHosted, /authenticated protocol 1\.7 registration/);
  assert.match(selfHosted, /The M3 mask P3\/P4 acceptance runner is missing/);
  assert.match(selfHosted, /EDITFLOW_M3_TEMPORAL_INTERPOLATION_P5_PROOF/);
  assert.match(selfHosted, /EDITFLOW_M3_MASK_P5_PROOF/);
  assert.match(selfHosted, /EDITFLOW_M3_LAYER_CONTROLS_P5_PROOF/);
  assert.doesNotMatch(selfHosted, /\$P5 = \$Template/);
  assert.doesNotMatch(selfHosted, /EDITFLOW_M3_TEMPORAL_INTERPOLATION_P5_PROOF=1/);
});

test("temporal interpolation P5 permits one bounded retry only for pre-mutation CEP registration timeout from a zero-AE baseline", async () => {
  const source = await readFile(selfHostedPath, "utf8");

  assert.match(source, /\$MaxPanelRegistrationAttempts = 2/);
  assert.match(source, /function Test-RetryablePanelRegistrationFailure/);
  assert.match(source, /M3_TEMPORAL_INTERPOLATION_P5_REAL_AE/);
  assert.match(source, /CEP_PANEL_REGISTRATION_TIMEOUT/);
  assert.match(source, /\$null -eq \$Failure\.panel\.initialSession/);
  assert.match(source, /\$null -eq \$Failure\.panel\.reconnectedSession/);
  assert.match(source, /\$null -eq \$Failure\.baseline\.projectFingerprint/);
  assert.match(source, /\$null -eq \$Failure\.saved\.projectFingerprint/);
  assert.match(source, /\$Responses\.Count -eq 0/);
  assert.match(source, /-not \(Test-Path \$SavedProjectPath -PathType Leaf\)/);
  assert.match(source, /function Retain-PanelRetryEvidence/);
  assert.match(source, /panel-registration-retry-attempt-/);
  assert.match(source, /Get-Process -Name "AfterFX"/);
  assert.match(source, /\$RemainingAfterFx\.Count -ne 0/);
  assert.match(source, /Start-Sleep -Seconds 2/);
  assert.match(source, /retrying one fresh isolated AE launch from the verified zero-process baseline/);
});

test("temporal interpolation P5 workflow is isolated on its control branch and retains transfer evidence", async () => {
  const source = await readFile(workflowPath, "utf8");

  assert.match(source, /ae-test\/m3-temporal-interpolation-p5-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-temporal-interpolation-p5\.txt/);
  assert.match(source, /run-m3-temporal-interpolation-p5-self-hosted\.ps1/);
  assert.match(source, /m3-temporal-interpolation-p5-proof-/);
  assert.match(source, /proofs\/artifacts\/m3-temporal-interpolation-p5-transfer/);
  assert.match(source, /runs-on: \[self-hosted, Windows, editflow-ae\]/);
});
