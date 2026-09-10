import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "scripts/m3-marker-motion-p3-p4-fast.mjs";
const wrapperPath = "scripts/windows/run-m3-marker-motion-p3-p4-warm.ps1";
const panelOpenerPath = "scripts/windows/open-editflow2-panel.jsx";
const installerPath = "scripts/windows/install-editflow-cep-v20-preview.ps1";
const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_marker_motion.jsx";
const bootstrapRequestPath = ".github/ae-proof-request/m3-marker-motion-p3-p4-bootstrap.json";
const reuseRequestPath = ".github/ae-proof-request/m3-marker-motion-p3-p4.json";
const workflowPath = ".github/workflows/m3-marker-motion-real-ae-p3-p4.yml";

test("fast marker-motion P3/P4 emits bounded visual contrasts and all-mutator P4 matrix", async () => {
  const source = await readFile(cliPath, "utf8");
  for (const token of [
    "M3_MARKER_MOTION_P1_P2_REAL_AE",
    "FRAME_MIX",
    "PIXEL_MOTION",
    "render.capture",
    "M3_MARKER_MOTION_P4_FAILURE_INJECTION",
    "M3_MARKER_MOTION_P4_INDUCED_FAILURE",
    'name: "comp_motion_set"',
    'name: "layer_motion_set"',
    'name: "marker_set"',
    'name: "marker_remove"',
    "client.undoLast",
    "P3_visual_artifact_emitted",
    "P3_visual_proof: false",
    "P4_failure_injection_rollback",
    "P5_save_reopen_reconnect_transfer: false",
    "speedTargetMs: 30_000",
    "VISUAL_REVIEW_REQUIRED",
  ]) assert.ok(source.includes(token), `missing fast P3/P4 proof token ${token}`);
  assert.match(source, /timeSpanDuration:\s*0\.5/);
  assert.match(source, /width:\s*320,\s*height:\s*180/);
  assert.match(source, /duration:\s*0\.5,\s*frameRate:\s*24/);
});

test("protocol-2.0 production host gates failure injection after all four mutator families and verifies rollback readback", async () => {
  const source = await readFile(hostPath, "utf8");
  const injectionRefs = source.match(/maybeInjectP4Failure\(request\)/g) ?? [];
  assert.ok(injectionRefs.length >= 5, "expected one helper declaration plus four mutator injection sites");
  assert.match(source, /sameMarkerReadback/);
  assert.match(source, /rollbackMatches/);
  assert.match(source, /MARKER_ROLLBACK_READBACK_MISMATCH/);
  assert.match(source, /COMP_MOTION_ROLLBACK_READBACK_MISMATCH/);
  assert.match(source, /LAYER_MOTION_ROLLBACK_READBACK_MISMATCH/);
  assert.match(source, /app\.executeCommand\(16\)/);
});

test("accelerated marker-motion requests separate one-time bootstrap from steady-state reuse", async () => {
  const bootstrap = JSON.parse(await readFile(bootstrapRequestPath, "utf8"));
  const reuse = JSON.parse(await readFile(reuseRequestPath, "utf8"));
  assert.equal(bootstrap.proofScript, "scripts/windows/run-m3-marker-motion-p3-p4-warm.ps1");
  assert.equal(reuse.proofScript, bootstrap.proofScript);
  assert.equal(bootstrap.lifecycle, "RESTART_AE");
  assert.equal(bootstrap.allowInfrastructureRetry, false);
  assert.equal(reuse.lifecycle, "REUSE_AE");
  assert.equal(reuse.allowInfrastructureRetry, true);
  assert.equal(reuse.artifactDir, "proofs/artifacts/m3-marker-motion-p3-p4");
});

test("warm wrapper never owns AE shutdown and opens only the declared EditFlow panel", async () => {
  const source = await readFile(wrapperPath, "utf8");
  const opener = await readFile(panelOpenerPath, "utf8");
  assert.match(source, /EDITFLOW_AE_WARM_SESSION/);
  assert.match(source, /EDITFLOW_M3_MARKER_MOTION_P4_PROOF/);
  assert.match(source, /npm run build:test-runtime/);
  assert.match(source, /m3-marker-motion-p3-p4-fast\.mjs/);
  assert.match(source, /open-editflow2-panel\.jsx/);
  assert.match(source, /-r \\"|'-r "/);
  for (const surface of ["comp_motion_set", "layer_motion_set", "marker_set", "marker_remove"]) assert.ok(source.includes(surface));
  assert.match(opener, /EditFlow 2\.0 Bridge/);
  assert.match(opener, /app\.findMenuCommandId/);
  assert.match(opener, /app\.executeCommand/);
  assert.doesNotMatch(opener, /SendKeys|SetCursorPos|mouse_event|Invoke-Expression/);
  assert.doesNotMatch(source, /Stop-Process\s+.*AfterFX/i);
  assert.doesNotMatch(source, /taskkill/i);
});

test("protocol-2.0 preview installer derives from accepted 1.9 and preserves auth", async () => {
  const source = await readFile(installerPath, "utf8");
  assert.match(source, /install-editflow-cep\.ps1/);
  assert.match(source, /editflow_host_current_v20\.jsx/);
  assert.match(source, /editflow_host_m3_marker_motion\.jsx/);
  assert.match(source, /2\.0\.0/);
  assert.doesNotMatch(source, /RotateToken/);
});

test("real-AE workflow seeds the P4 gate before bootstrap and uses the shared accelerated lane", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /editflow-accelerated-real-ae-workstation/);
  assert.match(source, /34286914057/);
  assert.match(source, /m3-marker-motion-p1-p2-proof-/);
  assert.match(source, /install-editflow-cep-v20-preview\.ps1/);
  assert.match(source, /invoke-editflow-ae-proof\.ps1/);
  assert.match(source, /EDITFLOW_M3_MARKER_MOTION_P4_PROOF:\s*"1"/);
  assert.match(source, /BOOTSTRAP/);
  assert.match(source, /REUSE/);
});