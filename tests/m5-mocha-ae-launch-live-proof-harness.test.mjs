import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestPath = "proofs/manifests/m5-mocha-ae-launch-development.request.json";
const runnerPath = "scripts/windows/run-m5-mocha-ae-launch-live-proof.ps1";
const detectorPath = "scripts/m5-mocha-ae-launch-target.py";
const tabDetectorPath = "scripts/m5-mocha-ae-effect-controls-tab-target.py";
const tabClickPath = "scripts/windows/m5-mocha-ae-guarded-effect-controls-tab-click.ps1";
const clickPath = "scripts/windows/m5-mocha-ae-guarded-launch-click.ps1";
const activatePath = "scripts/windows/m5-mocha-ae-activate-effect-controls.ps1";
const enterPath = "scripts/windows/m5-mocha-ae-isolation-enter.jsx";
const restorePath = "scripts/windows/m5-mocha-ae-isolation-restore.jsx";
const registrationPath = "scripts/windows/m5-mocha-ae-registration-later.ps1";
const startupPromptPath = "scripts/windows/m5-mocha-ae-startup-prompts.ps1";
const dialogEvidencePath = "scripts/windows/m5-ae-dialog-evidence.ps1";

test("M5 Mocha launch proof is warm-AE, no-retry, and requires clean external-session ownership", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.lifecycle, "REUSE_AE");
  assert.equal(manifest.allowInfrastructureRetry, false);
  assert.equal(manifest.allowEvidenceReuse, false);
  assert.ok(manifest.incrementalDependencies.includes("scripts/windows/m5-capture-ae-screen-physical.ps1"));
  assert.ok(manifest.incrementalDependencies.includes("scripts/windows/m5-ae-dialog-evidence.ps1"));
  assert.ok(manifest.incrementalDependencies.includes("scripts/windows/m5-mocha-ae-registration-later.ps1"));
  assert.ok(manifest.incrementalDependencies.includes("scripts/windows/m5-mocha-ae-startup-prompts.ps1"));
  const runner = await readFile(runnerPath, "utf8");
  assert.match(runner, /BaselineMochaPids/);
  assert.match(runner, /pre-existing Mocha AE process/);
  assert.match(runner, /sameAeProcess/i);
  assert.match(runner, /maxMeasuredWarmAeRoundtripMs/);
  assert.match(runner, /Boris FX/);
});

test("visual launch target is bounded, fresh-frame checked, and exact-AE foreground clicked", async () => {
  const detector = await readFile(detectorPath, "utf8");
  const tabDetector = await readFile(tabDetectorPath, "utf8");
  const tabClick = await readFile(tabClickPath, "utf8");
  const click = await readFile(clickPath, "utf8");
  const activate = await readFile(activatePath, "utf8");
  const runner = await readFile(runnerPath, "utf8");
  assert.match(detector, /expected exactly one bounded Mocha-orange target/);
  assert.match(detector, /0\.04 \* width/);
  assert.match(runner, /m5-capture-ae-screen-physical\.ps1/);
  assert.match(runner, /m5-ae-dialog-evidence\.ps1/);
  assert.match(click, /SetThreadDpiAwarenessContext/);
  assert.match(runner, /TargetStabilityPx/);
  assert.match(runner, /TargetAreaDelta/);
  assert.match(activate, /AttachThreadInput/);
  assert.match(activate, /SetForegroundWindow/);
  assert.match(activate, /Get-ForegroundPid/);
  assert.match(activate, /SendKeys/);
  assert.match(activate, /foreground ownership could not be restored/);
  assert.match(tabDetector, /expected exactly one bounded Effect Controls tab icon/);
  assert.match(tabDetector, /0\.12 \* width/);
  assert.match(tabClick, /GetForegroundWindow/);
  assert.match(runner, /GUARDED_TAB_CLICK/);
  assert.match(click, /GetForegroundWindow/);
  assert.match(click, /foreground process/);
});

test("Mocha isolation keeps an independent restore-state backup", async () => {
  const enter = await readFile(enterPath, "utf8");
  const restore = await readFile(restorePath, "utf8");
  assert.match(enter, /isolation-state-backup\.json/);
  assert.match(enter, /write\(backupStateFile, state\)/);
  assert.match(restore, /isolation-state-backup\.json/);
  assert.match(restore, /stateFile\.exists \? stateFile : backupStateFile/);
  assert.match(restore, /Restore refuses an unsaved project containing non-M5 proof items/);
});

test("Mocha first-run registration is handled only by the fixed Register later action", async () => {
  const registration = await readFile(registrationPath, "utf8");
  const runner = await readFile(runnerPath, "utf8");
  assert.match(registration, /Register later/);
  assert.match(registration, /Registration/);
  assert.match(registration, /InvokePattern/);
  assert.doesNotMatch(registration, /Parameter\(Mandatory=\$true\).*ButtonName/);
  assert.match(runner, /m5-mocha-ae-registration-later\.ps1/);
  assert.match(runner, /registrationDismissMs/);
  const dialogEvidence = await readFile(dialogEvidencePath, "utf8");
  assert.match(dialogEvidence, /Width -le 900/);
  assert.match(dialogEvidence, /Height -le 700/);
});
