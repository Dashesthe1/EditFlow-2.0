import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/m3-layer-control-p1-p2-cli.ts";
const runnerPath = "scripts/windows/run-m3-layer-control-p1-p2.ps1";
const selfHostedPath = "scripts/windows/run-m3-layer-control-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-layer-control-real-ae-p1-p2.yml";

test("layer-control P1/P2 CLI proves stale-state rejection and exact structural readback without overclaiming", async () => {
  const source = await readFile(cliPath, "utf8");

  assert.match(source, /AE_LAYER_CONTROL_PROTOCOL_VERSION_V16/);
  assert.match(source, /supportedProtocolVersions: \[AE_LAYER_CONTROL_PROTOCOL_VERSION_V16, AE_ADAPTER_PROTOCOL_VERSION_V11\]/);
  assert.match(source, /checks\.panel_negotiated_v16/);
  assert.match(source, /HOST_REVISION_CONFLICT/);
  assert.match(source, /p1_stale_switch_rejected/);
  assert.match(source, /p1_stale_switch_fingerprint_unchanged/);
  assert.match(source, /beforeP1\.observed\.projectFingerprint === afterP1\.observed\.projectFingerprint/);

  assert.match(source, /layer\.switches\.set/);
  assert.match(source, /p2_switch_exact_readback/);
  assert.match(source, /layer\.order\.set/);
  assert.match(source, /position: "BEGINNING"/);
  assert.match(source, /position: "AFTER"/);
  assert.match(source, /p2_absolute_order_exact_readback/);
  assert.match(source, /p2_relative_order_exact_readback/);
  assert.match(source, /layer\.controls\.readback/);
  assert.match(source, /p2_read_only_readback/);

  assert.match(source, /cleanup_fingerprint_restored/);
  assert.match(source, /cleanup_item_count_restored/);
  assert.match(source, /P1_validation_rejection:/);
  assert.match(source, /P2_structural_readback:/);
  assert.match(source, /P3_visual_proof: false/);
  assert.match(source, /P4_failure_injection_rollback: false/);
  assert.match(source, /P5_save_reopen_reconnect_transfer: false/);
});

test("bounded Windows wrapper refuses to promote incomplete layer-control evidence", async () => {
  const source = await readFile(runnerPath, "utf8");

  assert.match(source, /m3-layer-control-p1-p2/);
  assert.match(source, /m3-layer-control-p1-p2-cli\.js/);
  assert.match(source, /P1 stale-state rejection and P2 exact switch\/order structural readback only/);
  assert.match(source, /P3\/P4\/P5 are not claimed/);
  assert.match(source, /P1_validation_rejection/);
  assert.match(source, /P2_structural_readback/);
  assert.match(source, /P3_visual_proof/);
  assert.match(source, /P4_failure_injection_rollback/);
  assert.match(source, /P5_save_reopen_reconnect_transfer/);
  assert.match(source, /p1_stale_switch_fingerprint_unchanged/);
  assert.match(source, /p2_switch_exact_readback/);
  assert.match(source, /p2_absolute_order_exact_readback/);
  assert.match(source, /p2_relative_order_exact_readback/);
  assert.match(source, /cleanup_fingerprint_restored/);
});

test("self-hosted launcher derives from the accepted isolated M3 runner and pins protocol 1.6", async () => {
  const source = await readFile(selfHostedPath, "utf8");

  assert.match(source, /run-m3-mask-self-hosted\.ps1/);
  assert.match(source, /run-m3-layer-control-p1-p2\.ps1/);
  assert.match(source, /proofs\\artifacts\\m3-layer-control-p1-p2/);
  assert.match(source, /authenticated protocol 1\.6 registration/);
  assert.match(source, /Accepted self-hosted runner template drifted/);
});

test("real-AE P1/P2 workflow is isolated, manually dispatchable, and always uploads proof artifacts", async () => {
  const source = await readFile(workflowPath, "utf8");

  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /runs-on: \[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /run-m3-layer-control-self-hosted\.ps1/);
  assert.match(source, /if: always\(\)/);
  assert.match(source, /proofs\/artifacts\/m3-layer-control-p1-p2\//);
  assert.match(source, /retention-days: 14/);
});
