import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_layer_controls.jsx";
const acceptancePath = "scripts/windows/run-m3-layer-controls-p3-p4.ps1";
const selfHostedPath = "scripts/windows/run-m3-layer-controls-p3-p4-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-layer-controls-real-ae-p3-p4.yml";
const cliPath = "apps/desktop-host/src/m3-layer-controls-p3-p4-cli.ts";

test("layer-controls P4 proof injection is fixed, post-mutation, environment-gated, and uses the existing AE-Undo recovery", async () => {
  const source = await readFile(hostPath, "utf8");
  const mutation = source.indexOf("applySwitches(prepared.layer, request.payload.switches);");
  const verification = source.indexOf("verifySwitches(prepared.layer, request.payload.switches);", mutation);
  const injection = source.indexOf('request.readbackProfile === "M3_LAYER_CONTROLS_P4_FAILURE_INJECTION"');
  const endUndo = source.indexOf("app.endUndoGroup();", verification);
  const catchUndo = source.indexOf("app.executeCommand(16);", injection);

  assert.ok(mutation >= 0);
  assert.ok(verification > mutation, "P4 injection must follow a real layer-switch mutation and structural verification");
  assert.ok(injection > verification, "P4 injection must occur after structural verification");
  assert.ok(endUndo > injection, "P4 injection must occur before the normal undo group is closed");
  assert.ok(catchUndo > injection, "existing catch path must perform AE Undo after the induced failure");
  assert.match(source, /request\.command === "layer\.switches\.set"/);
  assert.match(source, /\$\.getenv\("EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF"\) === "1"/);
  assert.match(source, /M3_LAYER_CONTROLS_P4_INDUCED_FAILURE/);
  assert.match(source, /Layer-controls mutation failed and was rolled back through the transaction undo boundary\./);
  assert.doesNotMatch(source, /\beval\s*\(/);
});

test("layer-controls P3/P4 harness proves viewer-visible Video-switch and stack-order states plus exact rollback restoration", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /switches: \{ enabled: false \}/);
  assert.match(source, /switches: \{ enabled: true \}/);
  assert.match(source, /placement: \{ kind: "END" \}/);
  assert.match(source, /placement: \{ kind: "BEGINNING" \}/);
  assert.match(source, /M3_LAYER_CONTROLS_P4_FAILURE_INJECTION/);
  assert.match(source, /M3_LAYER_CONTROLS_P4_INDUCED_FAILURE/);
  assert.match(source, /p4_response_readback_restored/);
  assert.match(source, /p4_fingerprint_restored/);
  assert.match(source, /p4_layer_controls_state_restored/);
  assert.match(source, /p3_visual_artifacts_emitted/);
  assert.match(source, /P3_visual_proof: false/);
  assert.match(source, /P4_failure_injection_rollback: checks\.p4 === true/);
  assert.match(source, /P5_save_reopen_reconnect_transfer: false/);
  assert.match(source, /p3-switch-disabled-blue\.avi/);
  assert.match(source, /p3-switch-enabled-red\.avi/);
  assert.match(source, /p3-order-bottom-blue\.avi/);
  assert.match(source, /p3-order-top-red\.avi/);
  assert.match(source, /p4-post-rollback-red\.avi/);
});

test("layer-controls P3/P4 wrappers derive from accepted mask machinery while isolating proof environment flags", async () => {
  const [acceptance, selfHosted] = await Promise.all([
    readFile(acceptancePath, "utf8"),
    readFile(selfHostedPath, "utf8"),
  ]);

  assert.match(acceptance, /run-m3-mask-p3-p4\.ps1/);
  assert.match(acceptance, /m3-layer-controls-p3-p4-cli\.js/);
  assert.match(acceptance, /EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF/);
  assert.match(selfHosted, /run-m3-mask-p3-p4-self-hosted\.ps1/);
  assert.match(selfHosted, /run-m3-layer-controls-p3-p4\.ps1/);
  assert.match(selfHosted, /EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF/);
  assert.match(selfHosted, /authenticated protocol 1\.6 registration/);
  assert.match(selfHosted, /OriginalMaskProofEnv = \$env:EDITFLOW_M3_MASK_P4_PROOF/);
  assert.match(selfHosted, /OriginalCompositeProofEnv = \$env:EDITFLOW_M3_COMPOSITE_P4_PROOF/);
  assert.match(selfHosted, /Remove-Item Env:EDITFLOW_M3_MASK_P4_PROOF -ErrorAction SilentlyContinue/);
  assert.match(selfHosted, /Remove-Item Env:EDITFLOW_M3_COMPOSITE_P4_PROOF -ErrorAction SilentlyContinue/);
  assert.doesNotMatch(selfHosted, /EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF=1/);
});

test("layer-controls P3/P4 real-AE workflow is isolated on its own control branch and artifact namespace", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /ae-test\/m3-layer-controls-p3-p4-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-layer-controls-p3-p4\.txt/);
  assert.match(source, /run-m3-layer-controls-p3-p4-self-hosted\.ps1/);
  assert.match(source, /proofs\/artifacts\/m3-layer-controls-p3-p4\//);
  assert.match(source, /editflow-m3-layer-controls-p3-p4-real-ae-workstation/);
});