import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifestPath = "proofs/manifests/m5-roto-brush-popup-fault-development.request.json";
const smokePath = "scripts/windows/run-popup-guard-integration-smoke.ps1";
const runnerPath = "scripts/windows/invoke-editflow-ae-proof.ps1";

test("M5 popup-fault request is an explicit non-retrying REUSE_AE fault injection", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.lifecycle, "REUSE_AE");
  assert.equal(manifest.allowInfrastructureRetry, false);
  assert.equal(manifest.allowEvidenceReuse, false);
  assert.match(manifest.expectedScriptErrorContains, /Unable to execute script/i);
  assert.equal(manifest.proofScript, smokePath);
});

test("popup proof proves safe dismissal and same-process post-fault responsiveness", async () => {
  const source = await readFile(smokePath, "utf8");
  assert.match(source, /intentionalPopupGuardFailure = ;/);
  assert.match(source, /post-popup-health-probe/);
  assert.match(source, /SCRIPT_ERROR_DETECTED/);
  assert.match(source, /DISMISS_SCRIPT_ERROR_\(NATIVE\|UIA\|OCR_ENTER\)/);
  assert.match(source, /sameAeProcess = \$SameAeProcess/);
  assert.match(source, /withinThreeSecondCeiling/);
  assert.doesNotMatch(source, /Stop-Process|taskkill|SetCursorPos|mouse_event|SendKeys/);
});

test("orchestrator consumes only the declared matching popup and still fails closed on others", async () => {
  const source = await readFile(runnerPath, "utf8");
  assert.match(source, /function Consume-NewSupervisorScriptErrors/);
  assert.match(source, /IndexOf\(\$ExpectedScriptErrorContains/);
  assert.match(source, /\$script:ExpectedScriptErrorObserved = \$true/);
  assert.match(source, /\$Unexpected = \$Detail/);
  assert.match(source, /no matching popup was observed/);
  assert.match(source, /allowed only with REUSE_AE/);
  assert.match(source, /cannot enable infrastructure retry/);
});
