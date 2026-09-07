import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_composite.jsx";
const acceptancePath = "scripts/windows/run-m3-composite-p3-p4.ps1";
const selfHostedPath = "scripts/windows/run-m3-composite-p3-p4-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-composite-real-ae-p3-p4.yml";
const cliPath = "apps/desktop-host/src/m3-composite-p3-p4-cli.ts";

test("composite P4 proof injection is fixed, post-mutation, environment-gated, and uses existing AE-Undo recovery", async () => {
  const source = await readFile(hostPath, "utf8");
  const mutation = source.indexOf("var result = executePrepared(request, prepared);");
  const injection = source.indexOf('request.readbackProfile === "M3_COMPOSITE_P4_FAILURE_INJECTION"');
  const endUndo = source.indexOf("app.endUndoGroup();", mutation);
  const catchUndo = source.indexOf("app.executeCommand(16);", injection);

  assert.ok(mutation >= 0);
  assert.ok(injection > mutation, "P4 injection must occur after the real composite mutation");
  assert.ok(endUndo > injection, "P4 injection must occur before the normal undo group is closed");
  assert.ok(catchUndo > injection, "existing catch path must perform AE Undo after the induced failure");
  assert.match(source, /request\.command === "layer\.set_blend_mode"/);
  assert.match(source, /\$\.getenv\("EDITFLOW_M3_COMPOSITE_P4_PROOF"\) === "1"/);
  assert.match(source, /M3_COMPOSITE_P4_INDUCED_FAILURE/);
  assert.match(source, /Failed mutation self-rolled back with AE Undo\./);
  assert.doesNotMatch(source, /\beval\s*\(/);
});

test("composite P3/P4 harness proves deterministic LUMA matte plus ADD blend and exact rollback restoration", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /trackMatteType: "LUMA"/);
  assert.match(source, /blendMode: "ADD"/);
  assert.match(source, /blendMode: "MULTIPLY"/);
  assert.match(source, /M3_COMPOSITE_P4_FAILURE_INJECTION/);
  assert.match(source, /M3_COMPOSITE_P4_INDUCED_FAILURE/);
  assert.match(source, /p4_fingerprint_restored/);
  assert.match(source, /p4_composite_state_restored/);
  assert.match(source, /p3_visual_artifact_emitted/);
  assert.match(source, /P3_visual_proof: false/);
  assert.match(source, /P4_failure_injection_rollback: checks\.p4 === true/);
  assert.match(source, /P5_save_reopen_reconnect_transfer: false/);
});

test("composite P3/P4 wrappers derive from accepted mask machinery while isolating proof environment flags", async () => {
  const [acceptance, selfHosted] = await Promise.all([
    readFile(acceptancePath, "utf8"),
    readFile(selfHostedPath, "utf8"),
  ]);

  assert.match(acceptance, /run-m3-mask-p3-p4\.ps1/);
  assert.match(acceptance, /m3-composite-p3-p4-cli\.js/);
  assert.match(acceptance, /EDITFLOW_M3_COMPOSITE_P4_PROOF/);
  assert.match(selfHosted, /run-m3-mask-p3-p4-self-hosted\.ps1/);
  assert.match(selfHosted, /run-m3-composite-p3-p4\.ps1/);
  assert.match(selfHosted, /EDITFLOW_M3_COMPOSITE_P4_PROOF/);
  assert.match(selfHosted, /authenticated protocol 1\.3 registration/);
  assert.match(selfHosted, /OriginalMaskProofEnv = \$env:EDITFLOW_M3_MASK_P4_PROOF/);
  assert.match(selfHosted, /Remove-Item Env:EDITFLOW_M3_MASK_P4_PROOF -ErrorAction SilentlyContinue/);
  assert.match(selfHosted, /\$env:EDITFLOW_M3_MASK_P4_PROOF = \$OriginalMaskProofEnv/);
  assert.doesNotMatch(selfHosted, /EDITFLOW_M3_MASK_P4_PROOF=1/);
});

test("composite P3/P4 real-AE workflow is isolated on its own control branch and artifact namespace", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /ae-test\/m3-composite-p3-p4-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-composite-p3-p4\.txt/);
  assert.match(source, /run-m3-composite-p3-p4-self-hosted\.ps1/);
  assert.match(source, /proofs\/artifacts\/m3-composite-p3-p4\//);
  assert.match(source, /editflow-m3-composite-p3-p4-real-ae-workstation/);
});
