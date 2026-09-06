import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/m3-mask-p1-p2-cli.ts";
const acceptancePath = "scripts/windows/run-m3-mask-p1-p2.ps1";
const selfHostedPath = "scripts/windows/run-m3-mask-self-hosted.ps1";
const bootstrapPath = "scripts/windows/open-editflow-bridge.jsx";
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

test("shared self-hosted panel bootstrap attempts the menu open synchronously before bounded retries", async () => {
  const source = await readFile(bootstrapPath, "utf8");
  assert.match(source, /INITIAL_ATTEMPT_DIRECT/);
  assert.match(source, /\$\.global\.EditFlow2_selfHostedOpenBridge\(\);/);
  assert.match(source, /app\.findMenuCommandId\(menuName\)/);
  assert.match(source, /app\.executeCommand\(commandId\)/);
  assert.match(source, /EXECUTE_COMMAND_SENT/);
  assert.match(source, /RETRY_SCHEDULED/);
  assert.match(source, /app\.scheduleTask\("\$\.global\.EditFlow2_selfHostedOpenBridge\(\)"/);
  assert.doesNotMatch(source, /INITIAL_TASK_SCHEDULED/);
});

test("M3 self-hosted runner waits for a proven project window, bounds cold-start retry, settles force-stop cleanup, requires panel evidence, and safely cleans owned AE", async () => {
  const source = await readFile(selfHostedPath, "utf8");
  assert.match(source, /\[Environment\]::UserInteractive/);
  assert.match(source, /refuses to touch an already-running After Effects session/);
  assert.match(source, /install-editflow-cep\.ps1/);
  assert.match(source, /open-editflow-bridge\.jsx/);
  assert.match(source, /startup-diagnostics\.log/);
  assert.match(source, /function Write-AeProcessSnapshot/);
  assert.match(source, /function Find-ProjectReadyTargetAfterFx/);
  assert.match(source, /\$Candidate\.Responding/);
  assert.match(source, /\$Candidate\.MainWindowHandle -ne 0/);
  assert.match(source, /\$WindowTitle -like "Adobe After Effects\*"/);
  assert.match(source, /StartupTimeoutSeconds = 45/);
  assert.match(source, /MaxColdStartAttempts = 2/);
  assert.match(source, /MaxColdStartAttempts must be 1 or 2/);
  assert.match(source, /COLD_START_ATTEMPT_BEGIN/);
  assert.match(source, /COLD_START_ATTEMPT_FAILED/);
  assert.match(source, /COLD_START_RETRY/);
  assert.match(source, /COLD_START_PROJECT_READY/);
  assert.match(source, /function Stop-OwnedAfterFxSet/);
  assert.match(source, /RETRY_CLEANUP_ATTEMPT_/);
  assert.match(source, /CloseMainWindow\(\)/);
  assert.match(source, /Graceful AE close did not finish/);
  assert.match(source, /_FORCE_STOP/);
  assert.match(source, /_POST_FORCE_SETTLEMENT_BEGIN/);
  assert.match(source, /\$PostForceDeadline = \(Get-Date\)\.AddSeconds\(5\)/);
  assert.match(source, /_POST_FORCE_SETTLEMENT_END/);
  assert.match(source, /_ZERO_CONFIRMED/);
  assert.match(source, /@\("-r", \$PanelBootstrap\)/);
  assert.match(source, /EXECUTE_COMMAND_SENT/);
  assert.match(source, /RETRY_EXHAUSTED/);
  assert.match(source, /run-m3-mask-p1-p2\.ps1/);
  assert.doesNotMatch(source, /Invoke-Expression/);

  const titleGate = source.indexOf('$WindowTitle -like "Adobe After Effects*"');
  const retry = source.indexOf('Write-StartupDiagnostic "COLD_START_RETRY"');
  const dispatch = source.indexOf('$Arguments = @("-r", $PanelBootstrap)');
  assert.ok(titleGate >= 0 && retry > titleGate && dispatch > retry,
    "M3 must wait for titled project readiness and exhaust the bounded cold-start path before -r delivery");

  const gracefulClose = source.indexOf("CloseMainWindow()");
  const forceStop = source.indexOf("Stop-Process -Force");
  const settle = source.indexOf("_POST_FORCE_SETTLEMENT_BEGIN");
  const zero = source.indexOf("_ZERO_CONFIRMED");
  assert.ok(gracefulClose >= 0 && forceStop > gracefulClose && settle > forceStop && zero > settle,
    "M3 cleanup must try a normal close, then force-stop, then allow bounded Windows process settlement before zero confirmation");
});

test("M3 startup diagnostics inspect only metadata for top-level windows owned by AfterFX processes", async () => {
  const source = await readFile(selfHostedPath, "utf8");
  assert.match(source, /NativeWindowProbe/);
  assert.match(source, /EnumWindows/);
  assert.match(source, /GetWindowThreadProcessId/);
  assert.match(source, /GetWindowText/);
  assert.match(source, /GetClassName/);
  assert.match(source, /IsWindowVisible/);
  assert.match(source, /IsWindowEnabled/);
  assert.match(source, /EnumerateForProcessIds/);
  assert.match(source, /function Write-AeTopLevelWindowSnapshot/);
  assert.match(source, /COLD_START_WAIT_ATTEMPT_/);
  assert.match(source, /COLD_START_READY_CHECK_ATTEMPT_/);
  assert.match(source, /COLD_START_FINAL_FAILURE/);
  assert.match(source, /PANEL_BOOTSTRAP_EVIDENCE_TIMEOUT/);

  const readyCheck = source.indexOf('$ReadyCheckStage = "COLD_START_READY_CHECK_ATTEMPT_" + $Attempt');
  const retry = source.indexOf('Write-StartupDiagnostic "COLD_START_RETRY"');
  assert.ok(readyCheck >= 0 && retry > readyCheck,
    "read-only window metadata must be captured before a failed cold start is recycled");

  assert.doesNotMatch(source, /SendKeys|PostMessage|SendMessage|SetForegroundWindow|mouse_event|keybd_event|UIAutomation/);
});

test("M3 real-AE workflow is self-hosted, bounded, branch-scoped, artifact-producing, and execution-policy tolerant", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /ae-test\/m3-mask-p1-p2-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-mask-p1-p2\.txt/);
  assert.match(source, /runs-on:\s*\[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /timeout-minutes:\s*10/);
  assert.match(source, /shell:\s*cmd/);
  assert.match(source, /powershell\.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File/);
  assert.match(source, /EDITFLOW_AFTERFX_PATH/);
  assert.match(source, /run-m3-mask-self-hosted\.ps1/);
  assert.match(source, /proofs\/artifacts\/m3-mask-p1-p2\//);
  assert.match(source, /if:\s*always\(\)/);
  assert.doesNotMatch(source, /pull_request:/);
});
