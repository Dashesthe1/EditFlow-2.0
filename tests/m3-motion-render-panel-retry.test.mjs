import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const selfHostedPath = "scripts/windows/run-m3-motion-render-self-hosted.ps1";

test("motion-render runner retries only one zero-command CEP registration timeout from zero AE", async () => {
  const source = await readFile(selfHostedPath, "utf8");
  assert.match(source, /\$MaxPanelRegistrationAttempts = 2/);
  assert.match(source, /function Test-RetryablePanelRegistrationFailure/);
  assert.match(source, /CEP_PANEL_REGISTRATION_TIMEOUT/);
  assert.match(source, /\$null -eq \$Result\.panel/);
  assert.match(source, /\$null -eq \$Result\.environment/);
  assert.match(source, /\$Responses\.Count -eq 0/);
  assert.match(source, /\$Evidence\.Count -eq 0/);
  assert.match(source, /\$CheckProperties\.Count -eq 0/);
  assert.match(source, /Get-Process -Name "AfterFX"/);
  assert.match(source, /\$RemainingAfterFx\.Count -ne 0/);
  assert.match(source, /panel-registration-retry-attempt-/);
  assert.match(source, /Retain-PanelRetryEvidence -Attempt \$Attempt/);
  assert.match(source, /retrying one fresh isolated AE launch from the verified zero-process baseline/);
  assert.doesNotMatch(source, /MaxPanelRegistrationAttempts = [3-9]/);
  assert.doesNotMatch(source, /\$LASTEXITCODE/);
});
