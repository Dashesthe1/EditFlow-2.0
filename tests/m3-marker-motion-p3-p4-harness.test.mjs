import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("marker-motion host exposes guarded post-verification P4 rollback injection", async () => {
  const host = await read("packages/adapters/ae-cep/host/editflow_host_m3_marker_motion.jsx");
  assert.ok(host.includes('request.readbackProfile === "M3_MARKER_MOTION_P4_FAILURE_INJECTION"'));
  assert.ok(host.includes('$.global.EditFlow2_M3_MARKER_MOTION_P4_PROOF === true'));
  assert.ok(host.includes('M3_MARKER_MOTION_P4_INDUCED_FAILURE'));
  assert.ok(host.includes('setCompMotion(comp, before)'));
  assert.ok(host.includes('COMP_MOTION_ROLLBACK_READBACK_MISMATCH'));
  assert.ok(host.includes('the exact prior motion/shutter state was restored by structural rollback'));
  assert.equal(host.includes('$.getenv("EDITFLOW_M3_MARKER_MOTION_P4_PROOF")'), false, "warm proof must not depend on a process-start environment variable");
});

test("marker-motion warm runner never terminates or closes After Effects", async () => {
  const runner = await read("scripts/windows/run-m3-marker-motion-p3-p4.ps1");
  assert.ok(runner.includes('Invoke-ExistingAeScript'));
  assert.ok(runner.includes('@("-r",'));
  assert.ok(runner.includes('pidBefore'));
  assert.ok(runner.includes('restarted = $false'));
  assert.equal(runner.includes('Stop-Process -Name "AfterFX"'), false);
  assert.equal(runner.includes('Stop-Process -Id $TargetPid'), false);
  assert.equal(runner.includes('CloseMainWindow'), false);
  assert.equal(runner.includes('taskkill'), false);
});

test("protocol 2.0 preview preparation preserves the live process and only patches installed bridge/config files", async () => {
  const prepare = await read("scripts/windows/prepare-m3-marker-motion-v20-preview.ps1");
  assert.ok(prepare.includes('Prepared protocol 2.0 marker-motion preview in place without closing or restarting After Effects.'));
  assert.ok(prepare.includes('"2.0.0"'));
  assert.ok(prepare.includes('editflow_host_current_v20.jsx'));
  assert.ok(prepare.includes('EditFlow2_HOST_PROTOCOL_20'));
  assert.equal(prepare.includes('Stop-Process'), false);
  assert.equal(prepare.includes('Start-Process'), false);
});

test("P3 fixture follows Adobe semantics: transform motion blur and retimed footage frame blending are separate evidence", async () => {
  const cli = await read("apps/desktop-host/src/m3-marker-motion-p3-p4-cli.ts");
  assert.ok(cli.includes('property.set_keyframes'));
  assert.ok(cli.includes('p3-motion-blur-off.avi'));
  assert.ok(cli.includes('p3-motion-blur-shutter-on.avi'));
  assert.ok(cli.includes('sequence: true'));
  assert.ok(cli.includes('stretch: 400'));
  assert.ok(cli.includes('frameBlendingType: "FRAME_MIX"'));
  assert.ok(cli.includes('frameBlendingType: "PIXEL_MOTION"'));
  assert.ok(cli.includes('p4_fingerprint_restored'));
  assert.ok(cli.includes('p4_structural_state_restored'));
});

test("primary marker-motion P3/P4 accelerated request reuses AE", async () => {
  const request = JSON.parse(await read(".github/ae-proof-request/m3-marker-motion-p3-p4.json"));
  assert.equal(request.lifecycle, "REUSE_AE");
  assert.equal(request.proofScript, "scripts/windows/run-m3-marker-motion-p3-p4.ps1");
  assert.equal(request.allowInfrastructureRetry, true);
});
