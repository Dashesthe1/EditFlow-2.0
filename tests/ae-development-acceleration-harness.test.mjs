import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const lifecycleModes = [
  "REUSE_AE",
  "REOPEN_PROJECT",
  "RECONNECT_BROKER",
  "RESTART_AE",
  "CLEAN_BOOT",
];

test("accelerated AE proof request declares the permanent lifecycle contract", async () => {
  const schema = JSON.parse(await read("spec/ae-development-proof-request.schema.json"));
  assert.deepEqual(schema.properties.lifecycle.enum, lifecycleModes);
  assert.equal(schema.properties.lifecycle.default, "REUSE_AE");
  assert.equal(schema.properties.allowInfrastructureRetry.default, false);
  assert.equal(schema.properties.expectedScriptErrorContains.minLength, 8);
  assert.equal(schema.properties.expectedScriptErrorContains.maxLength, 240);
  assert.match(schema.properties.proofScript.pattern, /scripts\/windows\/run-/);
  assert.match(schema.properties.artifactDir.pattern, /proofs\/artifacts/);
});

test("warm orchestrator never silently escalates REUSE_AE into process termination", async () => {
  const runner = await read("scripts/windows/invoke-editflow-ae-proof.ps1");
  const restartGate = 'if ($Lifecycle -in @("RESTART_AE", "CLEAN_BOOT"))';
  assert.ok(runner.includes(restartGate), "explicit restart gate must remain present");
  assert.ok(runner.includes("REUSE_AE refuses silent restart escalation"));

  const stopCall = "Stop-TargetAfterFx -ExpectedPath $AfterFxPath";
  assert.equal(runner.split(stopCall).length - 1, 1, "target-AE stop helper must have exactly one call site");
  assert.ok(runner.indexOf(stopCall) > runner.indexOf(restartGate), "AE stop call must remain behind explicit restart gate");
  assert.ok(runner.includes("Proof passed and the host-verified warm After Effects session remains healthy."));
  assert.ok(runner.includes("Get-SupervisorScriptErrors"));
  assert.ok(runner.includes("SCRIPT_ERROR_DETECTED"));
  assert.ok(runner.includes("After Effects rejected a script:"));
  assert.ok(runner.includes("exitCode = 65"));
  assert.ok(runner.includes("Consume-NewSupervisorScriptErrors"));
  assert.ok(runner.includes("expectedScriptErrorContains"));
  assert.ok(runner.includes("expectedScriptErrorObserved"));
  assert.ok(runner.includes("Expected script-error fault injection is allowed only with REUSE_AE."));
  assert.ok(runner.includes("Expected script-error fault injection cannot enable infrastructure retry."));
});

test("blank or nonstandard AE titles require a direct existing-process host probe", async () => {
  const runner = await read("scripts/windows/invoke-editflow-ae-proof.ps1");
  const probe = await read("scripts/windows/ae-host-readiness-probe-template.jsx");
  assert.ok(runner.includes("function Test-AfterFxDirectReadiness"));
  assert.ok(runner.includes('if ($Process.MainWindowTitle -like "Adobe After Effects*")'));
  assert.ok(runner.includes("Test-AfterFxDirectReadiness -ExpectedPath $ExpectedPath -Process $Process"));
  assert.ok(runner.includes("DIRECT_AE_SCRIPT"));
  assert.ok(runner.includes("healthEvidence = $LastHealthEvidence"));
  assert.ok(runner.includes("-r \"") || runner.includes("'-r \"'"), "probe must use the supported After Effects -r script route");
  assert.ok(probe.includes("EDITFLOW_AE_READINESS_V1"));
  assert.ok(probe.includes("app.name"));
  assert.ok(probe.includes("app.project"));
  assert.equal(probe.includes("app.executeCommand"), false, "readiness probe must remain read-only against AE state");
});

test("only the exact AfterFX launch is detached from GitHub job orphan tracking", async () => {
  const runner = await read("scripts/windows/invoke-editflow-ae-proof.ps1");
  assert.ok(runner.includes("function Start-WarmAfterFx"));
  assert.ok(runner.includes('$PreviousTrackingId = $env:RUNNER_TRACKING_ID'));
  assert.ok(runner.includes('$env:RUNNER_TRACKING_ID = ""'));
  assert.ok(runner.includes('Start-Process -FilePath $ExpectedPath -PassThru'));
  assert.ok(runner.includes('$env:RUNNER_TRACKING_ID = $PreviousTrackingId'));

  const warmLaunchCall = "Start-WarmAfterFx -ExpectedPath $AfterFxPath";
  assert.equal(runner.split(warmLaunchCall).length - 1, 2, "both authorized AE launch paths must use the warm launch helper");
  assert.equal(runner.includes("Start-Process -FilePath $AfterFxPath | Out-Null"), false, "direct tracked AE launch must not return");

  const supervisorStart = 'Start-Process -FilePath "powershell.exe" -ArgumentList $SupervisorArgs';
  const proofStart = 'Start-Process -FilePath "powershell.exe" -ArgumentList $Arguments';
  assert.ok(runner.includes(supervisorStart), "supervisor must remain an ordinary tracked job child");
  assert.ok(runner.includes(proofStart), "proof runner must remain an ordinary tracked job child");
});

test("warm smoke proof is non-mutating and never closes After Effects", async () => {
  const smoke = await read("scripts/windows/run-ae-warm-health-smoke.ps1");
  assert.ok(smoke.includes("mutationStarted = $false"));
  assert.ok(smoke.includes("cleanupComplete = $true"));
  assert.equal(smoke.includes("Stop-Process"), false);
  assert.equal(smoke.includes("CloseMainWindow"), false);
  assert.equal(smoke.includes("taskkill"), false);
});

test("popup-guard integration smoke uses the proven AfterFX -r argument route", async () => {
  const smoke = await read("scripts/windows/run-popup-guard-integration-smoke.ps1");
  assert.ok(smoke.includes("intentionalPopupGuardFailure = ;"));
  assert.ok(smoke.includes("$Arguments = @('-r', $Path)"));
  assert.ok(smoke.includes("Invoke-AeScript -Path $BadScript"));
  assert.ok(smoke.includes("Start-Process -FilePath $AfterFxPath -ArgumentList $Arguments"));
  assert.ok(smoke.includes("popupFaultInjected = $true"));
  assert.ok(smoke.includes("postFaultAeResponsive"));
  assert.ok(smoke.includes("sameAeProcess"));
  assert.ok(smoke.includes("recoveryRoundtripMs"));
  assert.equal(smoke.includes("Stop-Process"), false);
  assert.equal(smoke.includes("SetCursorPos"), false);
});

test("AE supervisor has narrow recovery and script-error dismissal routes", async () => {
  const supervisor = await read("scripts/windows/ae-host-supervisor.ps1");
  assert.ok(supervisor.includes("RecoveryContext"));
  assert.ok(supervisor.includes('NativeContinueButtons.Count -eq 1'));
  assert.ok(supervisor.includes('ClassName -eq "Button"'));
  assert.ok(supervisor.includes("UIAutomationClient"));
  assert.ok(supervisor.includes("UIAutomationTypes"));
  assert.ok(supervisor.includes("Invoke-UiaElement"));
  assert.ok(supervisor.includes("InvokePattern"));
  assert.ok(supervisor.includes("INVOKE_CONTINUE_UIA"));
  assert.ok(supervisor.includes("VisualContinueMatches"));
  assert.ok(supervisor.includes("VisualRecoveryEnterSafe"));
  assert.ok(supervisor.includes("INVOKE_CONTINUE_OCR_ENTER"));
  assert.ok(supervisor.includes("REFUSED_CONTINUE"));
  assert.ok(supervisor.includes("ScriptErrorContext"));
  assert.ok(supervisor.includes("unable\\s+to\\s+execute\\s+script"));
  assert.ok(supervisor.includes("NativeScriptAckButtons.Count -eq 1"));
  assert.ok(supervisor.includes("DISMISS_SCRIPT_ERROR_NATIVE"));
  assert.ok(supervisor.includes("DISMISS_SCRIPT_ERROR_UIA"));
  assert.ok(supervisor.includes("DISMISS_SCRIPT_ERROR_OCR_ENTER"));
  assert.ok(supervisor.includes("Windows.Media.Ocr.OcrEngine"));
  assert.ok(supervisor.includes("PrintWindowToHdc"));
  assert.ok(supervisor.includes("GetDpiForWindow"));
  assert.ok(supervisor.includes("VisualUnsafeButtonMatches"));
  assert.ok(supervisor.includes("InvokeDialogEnter"));
  assert.ok(supervisor.includes("REFUSED_SCRIPT_ERROR_DISMISS"));
  assert.equal(supervisor.includes("SetCursorPos"), false);
  assert.equal(supervisor.includes("mouse_event"), false);
  assert.equal(supervisor.includes("SendKeys"), false);
  assert.equal(supervisor.includes("Invoke-Expression"), false);
});

test("real-AE acceleration workflow stays serialized on the interactive AE runner", async () => {
  const workflow = await read(".github/workflows/ae-development-proof.yml");
  assert.ok(workflow.includes("runs-on: [self-hosted, Windows, editflow-ae]"));
  assert.ok(workflow.includes("group: editflow-accelerated-real-ae-workstation"));
  assert.ok(workflow.includes("cancel-in-progress: false"));
  assert.ok(workflow.includes("invoke-editflow-ae-proof.ps1"));
});

test("ADR makes warm AE reusable through the remaining product roadmap", async () => {
  const adr = await read("docs/adr/0009-warm-ae-development-harness.md");
  for (const lifecycle of lifecycleModes) assert.ok(adr.includes(`\`${lifecycle}\``));
  assert.ok(adr.includes("M4–M11"));
  assert.ok(adr.includes("RUNNER_TRACKING_ID"));
  assert.ok(adr.includes("A proof MUST NOT close or restart AE merely as a convenient cleanup mechanism."));
  assert.ok(adr.includes("built-in Windows OCR locally"));
  assert.ok(adr.includes("exact extracted script-error body is logged and surfaced as a product failure"));
  assert.ok(adr.includes("No cursor coordinates, mouse events, arbitrary typing, or external OCR service"));
});