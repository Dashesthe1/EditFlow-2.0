import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/m3-marker-motion-p3-p4-cli.ts";
const wrapperPath = "scripts/windows/run-m3-marker-motion-p3-p4-warm.ps1";
const installerPath = "scripts/windows/install-editflow-cep-v20-preview.ps1";
const bootstrapRequestPath = ".github/ae-proof-request/m3-marker-motion-p3-p4-bootstrap.json";
const reuseRequestPath = ".github/ae-proof-request/m3-marker-motion-p3-p4.json";
const workflowPath = ".github/workflows/m3-marker-motion-real-ae-p3-p4.yml";

test("marker-motion P3/P4 CLI emits visual contrasts without self-accepting P3", async () => {
  const source = await readFile(cliPath, "utf8");
  for (const token of [
    "M3_MARKER_MOTION_P1_P2_REAL_AE",
    "FRAME_MIX",
    "PIXEL_MOTION",
    "render.capture",
    "M3_MARKER_MOTION_P4_FAILURE_INJECTION",
    "M3_MARKER_MOTION_P4_INDUCED_FAILURE",
    "p4_fingerprint_restored",
    "client.undoLast",
    "P3_visual_artifact_emitted",
    "P3_visual_proof: false",
    "P4_failure_injection_rollback",
    "P5_save_reopen_reconnect_transfer: false",
    "VISUAL_REVIEW_REQUIRED",
  ]) assert.ok(source.includes(token), `missing P3/P4 proof token ${token}`);
  assert.match(source, /timeSpanDuration:\s*0\.75/);
  assert.match(source, /width:\s*320,\s*height:\s*180/);
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

test("warm wrapper never owns AE process shutdown", async () => {
  const source = await readFile(wrapperPath, "utf8");
  assert.match(source, /EDITFLOW_AE_WARM_SESSION/);
  assert.match(source, /EDITFLOW_M3_MARKER_MOTION_P4_PROOF/);
  assert.match(source, /npm run build:test-runtime/);
  assert.match(source, /m3-marker-motion-p3-p4-cli\.js/);
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

test("real-AE marker-motion P3/P4 workflow uses the shared accelerated lane and pinned P1/P2", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /editflow-accelerated-real-ae-workstation/);
  assert.match(source, /34286914057/);
  assert.match(source, /m3-marker-motion-p1-p2-proof-/);
  assert.match(source, /install-editflow-cep-v20-preview\.ps1/);
  assert.match(source, /invoke-editflow-ae-proof\.ps1/);
  assert.match(source, /BOOTSTRAP/);
  assert.match(source, /REUSE/);
});
