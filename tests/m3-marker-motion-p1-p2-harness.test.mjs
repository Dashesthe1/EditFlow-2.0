import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cli = "apps/desktop-host/src/m3-marker-motion-p1-p2-cli.ts";
const broker = "apps/desktop-host/src/loopback-cep.ts";
const wrapper = "scripts/windows/run-m3-marker-motion-p1-p2.ps1";
const selfHosted = "scripts/windows/run-m3-marker-motion-self-hosted.ps1";
const workflow = ".github/workflows/m3-marker-motion-real-ae-p1-p2.yml";

test("protocol 2.0 is compiled into the authenticated broker without becoming its default", async () => {
  const source = await readFile(broker, "utf8");
  assert.match(source, /AE_MARKER_MOTION_PROTOCOL_VERSION_V20/);
  assert.match(source, /AeMarkerMotionTransportV20/);
  assert.match(source, /COMPILED_PROTOCOLS = \[(?:AE_POINT_TRACKING_PROTOCOL_VERSION_V21, )?AE_MARKER_MOTION_PROTOCOL_VERSION_V20/);
  assert.match(source, /const requested = input \?\? \[AE_ADAPTER_PROTOCOL_VERSION_V11\]/);
  assert.match(source, /dispatch\(request: AeMarkerMotionRequestV20\): Promise<AeMarkerMotionResponseV20>/);
});

test("P1/P2 CLI proves bounds, target rules, exact readback, removal, idempotency, and cleanup", async () => {
  const source = await readFile(cli, "utf8");
  for (const token of [
    "panel_negotiated_v20", "panel_supports_v11_v20", "HOST_REVISION_CONFLICT", "SHUTTER_ANGLE_INVALID",
    "LAYER_PROTECTED_REGION_FORBIDDEN", "FRAME_BLENDING_TYPE_INVALID", "p2_comp_motion_exact",
    "p2_layer_motion_exact", "p2_comp_motion_idempotent", "p2_layer_motion_idempotent",
    "p2_comp_marker_exact", "p2_comp_marker_idempotent", "p2_layer_marker_exact",
    "p2_layer_marker_remove_exact", "p2_comp_marker_remove_exact", "cleanup_fingerprint_restored",
  ]) assert.ok(source.includes(token), `missing proof token ${token}`);
  assert.match(source, /P3_visual_proof: false/);
  assert.match(source, /P4_failure_injection_rollback: false/);
  assert.match(source, /P5_save_reopen_reconnect_transfer: false/);
  assert.match(source, /Object\.keys\(object\)\.sort\(\)/);
});

test("acceptance wrapper fails closed and isolated runner installs only the protocol 2.0 preview", async () => {
  const [acceptance, runner] = await Promise.all([readFile(wrapper, "utf8"), readFile(selfHosted, "utf8")]);
  assert.match(acceptance, /M3 marker-motion real-AE P1\/P2 proof/);
  assert.match(acceptance, /p2_comp_marker_idempotent/);
  assert.match(acceptance, /p2_layer_marker_remove_exact/);
  assert.match(acceptance, /cleanup_fingerprint_restored/);
  assert.match(runner, /editflow_host_m3_marker_motion\.jsx/);
  assert.match(runner, /editflow_host_current_v20\.jsx/);
  assert.match(runner, /var KNOWN_PROTOCOLS = \["2\.0\.0"/);
  assert.match(runner, /EditFlow2_HOST_PROTOCOL_20/);
  assert.match(runner, /supportedProtocolVersions = @\("2\.0\.0"/);
  assert.match(runner, /normal installer defaults remain accepted protocol 1\.9/);
  assert.match(runner, /\$MaxPanelRegistrationAttempts = 2/);
});

test("real-AE workflow is bounded, explicit, self-hosted, and retains artifacts", async () => {
  const source = await readFile(workflow, "utf8");
  assert.match(source, /ae-test\/m3-marker-motion-p1-p2-control/);
  assert.match(source, /runs-on:\s*\[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /timeout-minutes:\s*10/);
  assert.match(source, /run-m3-marker-motion-self-hosted\.ps1/);
  assert.match(source, /proofs\/artifacts\/m3-marker-motion-p1-p2\//);
  assert.match(source, /if:\s*always\(\)/);
  assert.doesNotMatch(source, /pull_request:/);
});
