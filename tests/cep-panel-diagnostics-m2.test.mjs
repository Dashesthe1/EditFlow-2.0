import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const diagnosticsPath = "packages/adapters/ae-cep/extension/client/diagnostics.js";
const htmlPath = "packages/adapters/ae-cep/extension/html/index.html";
const layerControlsRunnerPath = "scripts/windows/run-m3-layer-controls-self-hosted.ps1";

test("CEP panel diagnostics capture startup, JavaScript errors, and visible bridge status without exposing auth data", async () => {
  const source = await readFile(diagnosticsPath, "utf8");

  assert.match(source, /EditFlow2-cep-panel-diagnostics\.log/);
  assert.match(source, /DIAGNOSTICS_SCRIPT_STARTED/);
  assert.match(source, /INITIAL_PANEL_STATE/);
  assert.match(source, /WINDOW_ERROR/);
  assert.match(source, /UNHANDLED_REJECTION/);
  assert.match(source, /STATUS_MUTATION/);
  assert.match(source, /cep\.evalScript/);
  assert.doesNotMatch(source, /config\.token/);
  assert.doesNotMatch(source, /X-EditFlow-Token/);
});

test("CEP diagnostics load before the bridge client so early startup failures are observable", async () => {
  const source = await readFile(htmlPath, "utf8");
  const runtimeIndex = source.indexOf("../client/runtime-config.js");
  const diagnosticsIndex = source.indexOf("../client/diagnostics.js");
  const bridgeIndex = source.indexOf("../client/bridge.js");

  assert.ok(runtimeIndex >= 0);
  assert.ok(diagnosticsIndex > runtimeIndex);
  assert.ok(bridgeIndex > diagnosticsIndex);
});

test("layer-controls self-hosted proof publishes isolated CEP panel diagnostics into its artifact directory", async () => {
  const source = await readFile(layerControlsRunnerPath, "utf8");

  assert.match(source, /EditFlow2-cep-panel-diagnostics\.log/);
  assert.match(source, /cep-panel-diagnostics\.log/);
  assert.match(source, /Remove-Item \$PanelDiagnosticLog -Force/);
  assert.match(source, /Copy-Item \$PanelDiagnosticLog \$PublishedPanelDiagnosticLog -Force/);
  assert.match(source, /No CEP panel diagnostic log was produced/);
});
