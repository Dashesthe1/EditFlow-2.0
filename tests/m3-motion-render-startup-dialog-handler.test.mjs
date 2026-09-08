import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const helperPath = "scripts/windows/handle-known-ae-startup-dialog.ps1";
const selfHostedPath = "scripts/windows/run-m3-motion-render-p3-p4-self-hosted.ps1";

test("AE recovery-dialog handler is process/path scoped and cannot click arbitrary UI", async () => {
  const source = await readFile(helperPath, "utf8");
  assert.match(source, /Get-Process -Name "AfterFX"/);
  assert.match(source, /InitialAfterFxPids/);
  assert.match(source, /OrdinalIgnoreCase\.Equals\(\$CandidatePath, \$ResolvedAfterFxPath\)/);
  assert.match(source, /EnumChildWindows/);
  assert.match(source, /ClassName -ne "#32770"/);
  assert.match(source, /ClassName -eq "Button"/);
  assert.match(source, /-ieq "Continue"/);
  assert.match(source, /RecoveryContext/);
  assert.match(source, /crash/);
  assert.match(source, /safe\\s\+mode/);
  assert.match(source, /BM_CLICK/);
  assert.match(source, /SetForegroundWindow/);
  assert.match(source, /INVOKE_CONTINUE/);
  assert.match(source, /REFUSED_CONTINUE/);
  assert.doesNotMatch(source, /mouse_event|SendKeys|SetCursorPos|keybd_event/i);
});

test("P3/P4 self-hosted runner starts and cleans up the guarded dialog watcher", async () => {
  const source = await readFile(selfHostedPath, "utf8");
  assert.match(source, /handle-known-ae-startup-dialog\.ps1/);
  assert.match(source, /startup-dialog-handler\.log/);
  assert.match(source, /Start-Process -FilePath "powershell\.exe"/);
  assert.match(source, /Guarded After Effects startup-dialog helper exited before the proof launch/);
  assert.match(source, /Stop-Process -Id \$DialogHelperProcess\.Id/);
  assert.match(source, /EDITFLOW_M3_MOTION_RENDER_P4_PROOF = "1"/);
});
