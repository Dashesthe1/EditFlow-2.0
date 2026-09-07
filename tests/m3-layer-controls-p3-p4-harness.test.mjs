import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_layer_controls.jsx";
const cliPath = "apps/desktop-host/src/m3-layer-controls-p3-p4-cli.ts";
const wrapperPath = "scripts/windows/run-m3-layer-controls-p3-p4.ps1";
const selfHostedPath = "scripts/windows/run-m3-layer-controls-p3-p4-self-hosted.ps1";
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
