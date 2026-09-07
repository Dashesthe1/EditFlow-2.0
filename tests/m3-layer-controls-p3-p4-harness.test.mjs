import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/m3-layer-controls-p3-p4-cli.ts";
const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_layer_controls.jsx";
const cleanupPath = "packages/adapters/ae-cep/host/editflow_host_m3_layer_controls_proof_cleanup.jsx";
const loaderPath = "packages/adapters/ae-cep/host/editflow_host_current_v16.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";
const acceptancePath = "scripts/windows/run-m3-layer-controls-p3-p4.ps1";
const selfHostedPath = "scripts/windows/run-m3-layer-controls-p3-p4-self-hosted.ps1";
const dialogWatcherPath = "scripts/windows/watch-ae-startup-dialogs.ps1";
const crashRepairHelperPath = "scripts/windows/continue-known-ae-crash-repair.ps1";
const workflowPath = ".github/workflows/m3-layer-controls-real-ae-p3-p4.yml";

test("M3 layer-controls P3/P4 CLI requires rendered switch/order evidence and external visual review", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /M3_LAYER_CONTROLS_P3_P4_REAL_AE/);
  assert.match(source, /layer\.controls\.readback/);
  assert.match(source, /layer\.switches\.set/);
  assert.match(source, /layer\.order\.set/);
  assert.match(source, /switches: \{ enabled: false \}/);
  assert.match(source, /switches: \{ enabled: true \}/);
  assert.match(source, /placement: \{ kind: "END" \}/);
  assert.match(source, /placement: \{ kind: "BEGINNING" \}/);
  assert.match(source, /M3_LAYER_CONTROLS_P4_FAILURE_INJECTION/);
  for (const artifact of [
    "p3-initial-front.avi",
    "p3-disabled-back.avi",
    "p3-restored-front.avi",
    "p3-order-back.avi",
    "p3-order-restored-front.avi",
    "p4-post-rollback-front.avi",
  ]) assert.match(source, new RegExp(artifact.replaceAll(".", "\\.")));
  assert.match(source, /P3_visual_artifact_emitted: checks\.p3_visual_artifact_emitted === true/);
  assert.match(source, /P3_visual_proof: false/);
  assert.match(source, /P4_failure_injection_rollback: checks\.p4 === true/);
  assert.match(source, /P5_save_reopen_reconnect_transfer: false/);
  assert.match(source, /cleanup_fingerprint_restored/);
  assert.doesNotMatch(source, /\beval\s*\(/);
});

test("P4 injection is doubly gated and occurs only after verified protocol-1.6 order mutation", async () => {
  const source = await readFile(hostPath, "utf8");
  assert.match(source, /request\.command === "layer\.order\.set"/);
  assert.match(source, /request\.readbackProfile === "M3_LAYER_CONTROLS_P4_FAILURE_INJECTION"/);
  assert.match(source, /\$\.getenv\("EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF"\) === "1"/);
  assert.match(source, /M3_LAYER_CONTROLS_P4_INDUCED_FAILURE/);
  assert.match(source, /verifyPlacement\(prepared\.comp, prepared\.layer, request\.payload\.placement, prepared\.relative\);[\s\S]*M3_LAYER_CONTROLS_P4_FAILURE_INJECTION/);
  assert.match(source, /app\.executeCommand\(16\)/);
  assert.match(source, /Layer-controls mutation failed and was rolled back through the transaction undo boundary/);
});

test("proof cleanup is exact, disposable, unsaved-only, and recovery-render gated", async () => {
  const source = await readFile(cleanupPath, "utf8");
  assert.match(source, /EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF/);
  assert.match(source, /p4-post-rollback-front\.avi/);
  assert.match(source, /app\.project\.file/);
  assert.match(source, /app\.project\.numItems !== 3/);
  assert.match(source, /target\.numLayers !== 2/);
  assert.match(source, /_FRONT_LAYER/);
  assert.match(source, /_BACK_LAYER/);
  assert.match(source, /layer\.enabled !== true/);
  assert.match(source, /layer\.locked !== false/);
  assert.match(source, /CloseOptions\.DO_NOT_SAVE_CHANGES/);
  assert.match(source, /app\.newProject\(\)/);
});

test("protocol-1.6 loader and installer expose proof cleanup only to the isolated P4 process", async () => {
  const loader = await readFile(loaderPath, "utf8");
  const installer = await readFile(installerPath, "utf8");
  assert.match(loader, /editflow_host_m3_layer_controls_proof_cleanup\.jsx/);
  assert.match(loader, /\$\.getenv\("EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF"\) === "1"/);
  assert.match(installer, /editflow_host_m3_layer_controls_proof_cleanup\.jsx/);
});

test("P3/P4 wrappers fail closed on structural recovery and never self-accept pixels or P5", async () => {
  const acceptance = await readFile(acceptancePath, "utf8");
  assert.match(acceptance, /VISUAL_REVIEW_REQUIRED/);
  assert.match(acceptance, /P3_visual_artifact_emitted/);
  assert.match(acceptance, /P3_visual_proof/);
  assert.match(acceptance, /P4_failure_injection_rollback/);
  assert.match(acceptance, /P5_save_reopen_reconnect_transfer/);
  assert.match(acceptance, /cleanupComplete/);

  const selfHosted = await readFile(selfHostedPath, "utf8");
  assert.match(selfHosted, /run-m3-mask-p3-p4-self-hosted\.ps1/);
  assert.match(selfHosted, /npm run check/);
  assert.match(selfHosted, /EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF/);
  assert.match(selfHosted, /Copy-CepFailureDiagnostics/);
  assert.match(selfHosted, /LogLevel/);
  assert.match(selfHosted, /watch-ae-startup-dialogs\.ps1/);
  assert.match(selfHosted, /continue-known-ae-crash-repair\.ps1/);
  assert.match(selfHosted, /EDITFLOW_M3_LAYER_CONTROLS_CRASH_REPAIR_CONTINUE/);
  assert.match(selfHosted, /crash-repair-recovery\.log/);
});

test("startup-dialog diagnostics can retain pixels but expose no AE input or activation mechanism", async () => {
  const source = await readFile(dialogWatcherPath, "utf8");
  assert.match(source, /GetWindowRect/);
  assert.match(source, /CopyFromScreen/);
  assert.match(source, /SCREENSHOT_CAPTURED/);
  assert.match(source, /startup-dialog-pid-/);
  assert.match(source, /MaxCaptures = 8/);
  assert.match(source, /Where-Object \{ \$_\.Visible -and \$_\.ClassName -eq "#32770" \}/);
  for (const forbiddenCall of [
    /\bSendInput\s*\(/,
    /\bSendMessage\s*\(/,
    /\bPostMessage\s*\(/,
    /\bSetForegroundWindow\s*\(/,
    /\bSetFocus\s*\(/,
    /\bmouse_event\s*\(/,
    /\bkeybd_event\s*\(/,
    /\.Invoke\s*\(/,
    /\.SetValue\s*\(/,
  ]) assert.doesNotMatch(source, forbiddenCall);
});

test("Crash Repair Continue helper is proof-gated, exact-state-only, foreground-verified, and keyboard-only", async () => {
  const source = await readFile(crashRepairHelperPath, "utf8");
  assert.match(source, /EDITFLOW_M3_LAYER_CONTROLS_CRASH_REPAIR_CONTINUE -ne "1"/);
  assert.match(source, /ClassName -ne "#32770"/);
  assert.match(source, /Width -lt 760 -or \$Width -gt 800/);
  assert.match(source, /Height -lt 470 -or \$Height -gt 510/);
  assert.match(source, /OS_ViewContainer/);
  assert.match(source, /OS_EditTextContainer/);
  assert.match(source, /AE_CApplication_\*/);
  assert.match(source, /Process\.MainWindowHandle/);
  assert.match(source, /GetForegroundWindow/);
  assert.match(source, /SetForegroundWindow/);
  assert.match(source, /Foreground -ne \[long\]\$Dialog\.Handle/);
  assert.match(source, /\[System\.Windows\.Forms\.SendKeys\]::SendWait\("\{ENTER\}"\)/);
  assert.match(source, /CONTINUE_ENTER_SENT/);
  assert.match(source, /CRASH_REPAIR_DISMISSED/);
  assert.doesNotMatch(source, /mouse_event/);
  assert.doesNotMatch(source, /keybd_event/);
  assert.doesNotMatch(source, /Click\s*\(/);
  assert.doesNotMatch(source, /ResetPreferences\s*\(/);
});

test("real-AE P3/P4 workflow is isolated to the Windows AE control branch", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /ae-test\/m3-layer-controls-p3-p4-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-layer-controls-p3-p4\.txt/);
  assert.match(source, /runs-on: \[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /run-m3-layer-controls-p3-p4-self-hosted\.ps1/);
  assert.match(source, /proofs\/artifacts\/m3-layer-controls-p3-p4\//);
  assert.match(source, /retention-days: 14/);
});
