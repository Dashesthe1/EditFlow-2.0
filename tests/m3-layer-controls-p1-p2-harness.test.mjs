import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/m3-layer-controls-p1-p2-cli.ts";
const acceptancePath = "scripts/windows/run-m3-layer-controls-p1-p2.ps1";
const selfHostedPath = "scripts/windows/run-m3-layer-controls-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-layer-controls-real-ae-p1-p2.yml";

test("M3 layer-controls P1/P2 CLI is bounded to protocol 1.6 structural rejection/readback evidence", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16/);
  assert.match(source, /M3_LAYER_CONTROLS_P1_P2_REAL_AE/);
  assert.match(source, /HOST_REVISION_CONFLICT/);
  assert.match(source, /LAYER_SWITCHES_EMPTY/);
  assert.match(source, /LAYER_RELATIVE_SELF/);
  for (const key of [
    "enabled",
    "audioEnabled",
    "solo",
    "locked",
    "shy",
    "collapseTransformation",
    "quality",
    "effectsActive",
    "adjustmentLayer",
    "threeDLayer",
    "preserveTransparency",
    "samplingQuality",
  ]) assert.match(source, new RegExp(`\\"${key}\\"`));
  for (const kind of ["BEGINNING", "END", "BEFORE", "AFTER"]) assert.match(source, new RegExp(`kind: \\"${kind}\\"`));
  assert.match(source, /cleanup_fingerprint_restored/);
  assert.match(source, /P1_validation_rejection: checks\.p1 === true/);
  assert.match(source, /P2_structural_readback: checks\.p2 === true/);
  assert.match(source, /P3_visual_proof: false/);
  assert.match(source, /P4_failure_injection_rollback: false/);
  assert.match(source, /P5_save_reopen_reconnect_transfer: false/);
  assert.doesNotMatch(source, /render\.capture/);
  assert.doesNotMatch(source, /\beval\s*\(/);
});

test("M3 layer-controls P1/P2 acceptance wrapper fails closed unless exact switches/order and cleanup pass", async () => {
  const source = await readFile(acceptancePath, "utf8");
  assert.match(source, /run-m3-layer-controls-p1-p2/);
  assert.match(source, /p1_stale_revision_rejected/);
  assert.match(source, /p1_empty_switches_rejected/);
  assert.match(source, /p1_self_relative_order_rejected/);
  assert.match(source, /p2_all_switches_report_supported/);
  assert.match(source, /p2_all_switch_writes_exact/);
  assert.match(source, /p2_locked_move_end_exact/);
  assert.match(source, /p2_move_before_exact/);
  assert.match(source, /p2_move_after_exact/);
  assert.match(source, /p2_move_beginning_exact/);
  assert.match(source, /cleanup_fingerprint_restored/);
  assert.match(source, /P3_visual_proof/);
  assert.match(source, /P4_failure_injection_rollback/);
  assert.match(source, /P5_save_reopen_reconnect_transfer/);
});

test("self-hosted wrapper reuses the accepted M3 startup template with guarded protocol-1.6 substitutions", async () => {
  const source = await readFile(selfHostedPath, "utf8");
  assert.match(source, /run-m3-mask-self-hosted\.ps1/);
  assert.match(source, /Accepted self-hosted runner template drifted/);
  assert.match(source, /run-m3-layer-controls-p1-p2\.ps1/);
  assert.match(source, /proofs\\artifacts\\m3-layer-controls-p1-p2/);
  assert.match(source, /authenticated protocol 1\.6 registration/);
  assert.match(source, /isolated M3 layer-controls AE proof/);
  assert.match(source, /Remove-Item \$TempPath/);
});

test("real-AE workflow is isolated to the self-hosted Windows AE runner and proof artifact path", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /ae-test\/m3-layer-controls-p1-p2-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-layer-controls-p1-p2\.txt/);
  assert.match(source, /runs-on: \[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /run-m3-layer-controls-self-hosted\.ps1/);
  assert.match(source, /proofs\/artifacts\/m3-layer-controls-p1-p2\//);
  assert.match(source, /retention-days: 14/);
});
