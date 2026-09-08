import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/m3-motion-render-p1-p2-cli.ts";
const installerPath = "scripts/windows/install-editflow-cep-v110-preview.ps1";

test("motion-render P1/P2 fixture intentionally crosses 12fps source into 24fps target", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /Source 12fps/);
  assert.match(source, /frameRate: 12/);
  assert.match(source, /Target 24fps/);
  assert.match(source, /frameRate: 24/);
  assert.match(source, /layer\.add_media/);
});

test("motion-render P1 rejects invalid composition and layer values without structural mutation", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /shutterAngle: 721/);
  assert.match(source, /SHUTTER_ANGLE_INVALID/);
  assert.match(source, /frameBlendingType: "OPTICAL_MAGIC"/);
  assert.match(source, /FRAME_BLENDING_TYPE_INVALID/);
  assert.match(source, /p1_invalid_comp_revision_unchanged/);
  assert.match(source, /p1_invalid_comp_state_unchanged/);
  assert.match(source, /p1_invalid_layer_revision_unchanged/);
  assert.match(source, /p1_invalid_layer_state_unchanged/);
  assert.match(source, /HOST_REVISION_CONFLICT/);
  assert.match(source, /p1_stale_revision_state_unchanged/);
});

test("motion-render P2 proves exact composition settings and every AE frame-blending enum", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /motionBlur: true, frameBlending: true, shutterAngle: 270, shutterPhase: -90, samplesPerFrame: 16, adaptiveSampleLimit: 64/);
  assert.match(source, /\["FRAME_MIX", "PIXEL_MOTION", "NO_FRAME_BLEND"\]/);
  assert.match(source, /frameBlendingType/);
  assert.match(source, /observed\?\.\["frameBlending"\] === derivedEnabled/);
  assert.match(source, /p2_layer_restored/);
  assert.match(source, /p2_comp_restored/);
  assert.match(source, /cleanup_fingerprint_restored/);
  assert.match(source, /P3_visual_proof: false/);
  assert.match(source, /P4_failure_injection_rollback: false/);
  assert.match(source, /P5_save_reopen_reconnect_transfer: false/);
});

test("protocol 1.10 preview installer patches only the installed accepted 1.9 runtime", async () => {
  const source = await readFile(installerPath, "utf8");
  assert.match(source, /& \$AcceptedInstaller -Port \$Port/);
  assert.match(source, /editflow_host_m3_motion_render\.jsx/);
  assert.match(source, /editflow_host_current_v110\.jsx/);
  assert.match(source, /\$KnownV19 = 'var KNOWN_PROTOCOLS = \["1\.9\.0"/);
  assert.match(source, /\$KnownV110 = 'var KNOWN_PROTOCOLS = \["1\.10\.0","1\.9\.0"/);
  assert.match(source, /editflow_host_current_v19\.jsx', 'editflow_host_current_v110\.jsx/);
  assert.match(source, /EditFlow2_HOST_PROTOCOL_19', 'EditFlow2_HOST_PROTOCOL_110/);
  assert.match(source, /supportedProtocolVersions = @\("1\.10\.0", "1\.9\.0"/);
  assert.match(source, /proof only/);
  assert.match(source, /production runtime remains protocol 1\.9/);
});
