import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_layer_controls.jsx";
const cleanupPath = "packages/adapters/ae-cep/host/editflow_host_m3_layer_controls_proof_cleanup.jsx";
const loaderPath = "packages/adapters/ae-cep/host/editflow_host_current_v16.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";
const cliPath = "apps/desktop-host/src/m3-layer-controls-p3-p4-cli.ts";
const wrapperPath = "scripts/windows/run-m3-layer-controls-p3-p4.ps1";
const selfHostedPath = "scripts/windows/run-m3-layer-controls-p3-p4-self-hosted.ps1";
const sharedMaskSelfHostedPath = "scripts/windows/run-m3-mask-p3-p4-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-layer-controls-real-ae-p3-p4.yml";

test("protocol 1.6 P4 hook is fixed, proof-gated, and occurs after a real switch mutation", async () => {
  const source = await readFile(hostPath, "utf8");
  assert.match(source, /EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF/);
  assert.match(source, /M3_LAYER_CONTROLS_P4_FAILURE_INJECTION/);
  assert.match(source, /M3_LAYER_CONTROLS_P4_INDUCED_FAILURE/);
  const mutation = source.indexOf("applyPatch(prepared.layer, prepared.patch);");
  const gate = source.indexOf('request.readbackProfile === "M3_LAYER_CONTROLS_P4_FAILURE_INJECTION"');
  const undo = source.indexOf("app.executeCommand(16)", gate);
  assert.ok(mutation >= 0 && gate > mutation, "P4 failure must be induced only after the real typed switch mutation");
  assert.ok(undo > gate, "the existing AE Undo recovery path must remain downstream of the proof injection");
});

test("layer-controls P3/P4 harness emits reviewable visibility renders and never self-accepts P3", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /p3-enabled-visible\.avi/);
  assert.match(source, /p3-disabled-hidden\.avi/);
  assert.match(source, /p3-restored-visible\.avi/);
  assert.match(source, /p4-post-rollback-visible\.avi/);
  assert.match(source, /switches: \{ enabled: false \}/);
  assert.match(source, /switches: \{ enabled: true \}/);
  assert.match(source, /switches: \{ shy: true \}/);
  assert.match(source, /"M3_LAYER_CONTROLS_P4_FAILURE_INJECTION"/);
  assert.match(source, /status: ok \? "VISUAL_REVIEW_REQUIRED" : "FAILURE"/);
  assert.match(source, /P3_visual_proof: false/);
  assert.match(source, /P4_failure_injection_rollback: checks\.p4 === true/);
  assert.match(source, /P5_save_reopen_reconnect_transfer: false/);
  assert.match(source, /cleanup_fingerprint_restored/);
});

test("layer-controls proof cleanup is env-gated, bound to the exact recovery request, fixture-exact, and discards only the owned unsaved project", async () => {
  const [cleanup, loader, installer, cli] = await Promise.all([
    readFile(cleanupPath, "utf8"),
    readFile(loaderPath, "utf8"),
    readFile(installerPath, "utf8"),
    readFile(cliPath, "utf8"),
  ]);
  assert.match(cleanup, /EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF/);
  assert.match(cleanup, /RECOVERY_REQUEST_NAME = "p4-post-rollback-visible\.avi"/);
  assert.match(cli, /recoveryRenderPath = path\.join\(artifactDir, "p4-post-rollback-visible\.avi"\)/);
  assert.match(cleanup, /app\.project\.file/);
  assert.match(cleanup, /app\.project\.numItems !== 2/);
  assert.match(cleanup, /M3_LAYER_CONTROLS_P34_/);
  assert.match(cleanup, /target\.numLayers !== 1/);
  assert.match(cleanup, /layer\.source !== sourceMedia/);
  assert.match(cleanup, /layer\.enabled !== true/);
  assert.match(cleanup, /layer\.shy !== false/);
  assert.match(cleanup, /project\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\)/);
  assert.match(cleanup, /app\.newProject\(\)/);
  assert.match(cleanup, /M3_LAYER_CONTROLS_P3_P4_REAL_AE/);
  assert.match(loader, /editflow_host_m3_layer_controls_proof_cleanup\.jsx/);
  assert.match(loader, /EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF/);
  assert.match(installer, /"editflow_host_m3_layer_controls_proof_cleanup\.jsx"/);
});

test("layer-controls P3/P4 runner safely accepts verified already-loaded panel bootstrap evidence without weakening the shared template", async () => {
  const [selfHosted, sharedMaskSelfHosted] = await Promise.all([
    readFile(selfHostedPath, "utf8"),
    readFile(sharedMaskSelfHostedPath, "utf8"),
  ]);
  assert.match(selfHosted, /PANEL_ALREADY_LOADED/);
  assert.match(selfHosted, /EXECUTE_COMMAND_SENT.*PANEL_ALREADY_LOADED/);
  assert.match(selfHosted, /authenticated protocol 1\.6 broker/);
  assert.match(selfHosted, /manifest script-path marker/);
  assert.match(sharedMaskSelfHosted, /if \(\$BootstrapText -match "EXECUTE_COMMAND_SENT"\) \{/);
  assert.doesNotMatch(sharedMaskSelfHosted, /EXECUTE_COMMAND_SENT" -or \$BootstrapText -match "PANEL_ALREADY_LOADED/);
});

test("layer-controls P3/P4 runners are isolated to protocol 1.6 and a dedicated AE control branch", async () => {
  const [wrapper, selfHosted, workflow] = await Promise.all([
    readFile(wrapperPath, "utf8"),
    readFile(selfHostedPath, "utf8"),
    readFile(workflowPath, "utf8"),
  ]);
  assert.match(wrapper, /EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF/);
  assert.match(wrapper, /m3-layer-controls-p3-p4-cli\.js/);
  assert.match(wrapper, /VISUAL_REVIEW_REQUIRED/);
  assert.match(selfHosted, /authenticated protocol 1\.6 registration/);
  assert.match(selfHosted, /run-m3-layer-controls-p3-p4\.ps1/);
  assert.match(selfHosted, /EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF/);
  assert.match(workflow, /ae-test\/m3-layer-controls-p3-p4-control/);
  assert.match(workflow, /run-m3-layer-controls-p3-p4-self-hosted\.ps1/);
  assert.match(workflow, /m3-layer-controls-p3-p4-proof-/);
});
