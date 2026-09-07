import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/m3-layer-controls-p1-p2-cli.ts";
const wrapperPath = "scripts/windows/run-m3-layer-controls-p1-p2.ps1";
const selfHostedPath = "scripts/windows/run-m3-layer-controls-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-layer-controls-real-ae-p1-p2.yml";

test("M3 layer-controls P1/P2 proof harness is bounded, exhaustive, and evidence-retaining", async () => {
  const [cli, wrapper, selfHosted, workflow] = await Promise.all([
    readFile(cliPath, "utf8"),
    readFile(wrapperPath, "utf8"),
    readFile(selfHostedPath, "utf8"),
    readFile(workflowPath, "utf8"),
  ]);

  assert.match(cli, /AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16/);
  assert.match(cli, /supportedProtocolVersions: \[AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16, AE_ADAPTER_PROTOCOL_VERSION_V11\]/);
  for (const key of [
    "enabled", "solo", "shy", "locked", "quality", "adjustmentLayer", "guideLayer",
    "threeDLayer", "effectsActive", "collapseTransformation", "preserveTransparency",
  ]) assert.match(cli, new RegExp(`\\"${key}\\"`));
  assert.match(cli, /switches: \{ motionBlur: true \}/);
  assert.match(cli, /LAYER_SWITCH_UNKNOWN/);
  assert.match(cli, /HOST_REVISION_CONFLICT/);
  assert.match(cli, /LAYER_LOCKED_REQUIRES_EXPLICIT_UNLOCK/);
  assert.match(cli, /p2_repeat_patch_no_op/);
  assert.match(cli, /p2_atomic_unlock_restore_exact/);
  assert.match(cli, /cleanup_fingerprint_restored/);
  assert.match(cli, /P3_visual_proof: false/);
  assert.match(cli, /P4_failure_injection_rollback: false/);
  assert.match(cli, /P5_save_reopen_reconnect_transfer: false/);

  assert.match(wrapper, /m3-layer-controls-p1-p2-cli\.js/);
  assert.match(wrapper, /p1_unknown_switch_rejected/);
  assert.match(wrapper, /p1_locked_change_rejected/);
  assert.match(wrapper, /p2_full_patch_exact/);
  assert.match(wrapper, /p2_final_readback_matches_baseline/);
  assert.match(wrapper, /cleanup_fingerprint_restored/);

  assert.match(selfHosted, /run-m3-mask-self-hosted\.ps1/);
  assert.match(selfHosted, /run-m3-layer-controls-p1-p2\.ps1/);
  assert.match(selfHosted, /authenticated protocol 1\.6 registration/);
  assert.match(selfHosted, /m3-layer-controls-p1-p2/);

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /ae-test\/m3-layer-controls-p1-p2-control/);
  assert.match(workflow, /runs-on: \[self-hosted, Windows, editflow-ae\]/);
  assert.match(workflow, /run-m3-layer-controls-self-hosted\.ps1/);
  assert.match(workflow, /proofs\/artifacts\/m3-layer-controls-p1-p2\//);
  assert.match(workflow, /retention-days: 14/);
});
