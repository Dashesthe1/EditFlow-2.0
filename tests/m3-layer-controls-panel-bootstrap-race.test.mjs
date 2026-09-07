import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const wrapperPath = "scripts/windows/run-m3-layer-controls-self-hosted.ps1";

test("layer-controls self-hosted wrapper does not toggle an already auto-loaded CEP panel closed", async () => {
  const source = await readFile(wrapperPath, "utf8");

  assert.match(source, /EditFlow2-cep-panel-diagnostics\.log/);
  assert.match(source, /Remove-Item \$PanelDiagnosticLog -Force/);
  assert.match(source, /LastIndexOf\("DIAGNOSTICS_SCRIPT_STARTED"\)/);
  assert.match(source, /LastIndexOf\("PANEL_BEFORE_UNLOAD"\)/);
  assert.match(source, /\$PanelAlreadyLoaded = \$PanelStartedAt -ge 0 -and \$PanelStartedAt -gt \$PanelUnloadedAt/);
  assert.match(source, /PANEL_BOOTSTRAP_SKIPPED_ALREADY_LOADED/);
  assert.match(source, /\$BootstrapSucceeded = \$PanelAlreadyLoaded/);
  assert.match(source, /while \(-not \$BootstrapSucceeded -and \(Get-Date\) -lt \$BootstrapDeadline\)/);
  assert.match(source, /active EditFlow CEP panel \(already loaded or opened by the fixed bootstrap\)/);
});

test("layer-controls bootstrap race mitigation remains a scoped transformation of the accepted runner template", async () => {
  const source = await readFile(wrapperPath, "utf8");

  assert.match(source, /\$TemplatePath = Join-Path \$RepoRoot "scripts\\windows\\run-m3-mask-self-hosted\.ps1"/);
  assert.match(source, /\$LayerControls = \$Template/);
  assert.match(source, /\$LayerControls\.Replace\(\$OldPanelArguments/);
  assert.doesNotMatch(source, /Invoke-Expression/);
});
