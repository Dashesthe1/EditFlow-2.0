import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const legacyCliPath = "scripts/m3-marker-motion-p3-p4-fast.mjs";
const legacyWrapperPath = "scripts/windows/run-m3-marker-motion-p3-p4-warm.ps1";
const panelOpenerPath = "scripts/windows/open-editflow2-panel.jsx";
const installerPath = "scripts/windows/install-editflow-cep-v20-preview.ps1";
const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_marker_motion.jsx";
const bootstrapRequestPath = ".github/ae-proof-request/m3-marker-motion-p3-p4-bootstrap.json";
const reuseRequestPath = ".github/ae-proof-request/m3-marker-motion-p3-p4.json";
const workflowPath = ".github/workflows/m3-marker-motion-real-ae-p3-p4.yml";
const authorityPath = "proofs/diagnostics/m3-marker-motion-proof-authority.json";
const fixturePath = "proofs/fixtures/m3-marker-motion-p3-visual.json";
const p4CliPath = "scripts/m3-marker-motion-p4-fast-regression.mjs";
const p4WrapperPath = "scripts/windows/run-m3-marker-motion-p4-fast-regression.ps1";

test("historical combined P3/P4 diagnostic retains coverage but never self-promotes P3", async () => {
  const source = await readFile(legacyCliPath, "utf8");
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
    "VISUAL_REVIEW_REQUIRED",
  ]) assert.ok(source.includes(token), `missing legacy diagnostic token ${token}`);
  assert.match(source, /timeSpanDuration:\s*0\.5/);
  assert.match(source, /width:\s*320,\s*height:\s*180/);
  assert.match(source, /duration:\s*0\.5,\s*frameRate:\s*24/);
});

test("promotion authority binds P3 to the committed strong fixture and P4 to the dedicated bounded regression", async () => {
  const authority = JSON.parse(await readFile(authorityPath, "utf8"));
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const [p4Cli, p4Wrapper] = await Promise.all([
    readFile(p4CliPath, "utf8"),
    readFile(p4WrapperPath, "utf8"),
  ]);

  assert.equal(authority.protocolVersion, "2.0.0");
  assert.equal(authority.promotionMaturity, "TRANSFER");
  assert.equal(authority.legacyDiagnostics.promotionAuthority, false);
  assert.ok(authority.legacyDiagnostics.paths.includes(legacyCliPath));
  assert.equal(authority.authoritativeEvidence.P3.fixture, fixturePath);
  assert.equal(authority.authoritativeEvidence.P3.independentVisualReviewAccepted, true);
  assert.deepEqual(fixture.positionMotion, { start: [-80, 90], end: [400, 90], durationSeconds: 0.5 });
  assert.equal(authority.authoritativeEvidence.P4.cli, p4CliPath);
  assert.equal(authority.authoritativeEvidence.P4.wrapper, p4WrapperPath);
  assert.equal(authority.authoritativeEvidence.P4.cleanupModel, "PROOF_OWNED_STABLE_ID_NAMESPACE_PLUS_FINAL_BLANK_UNSAVED_VERIFY");
  assert.ok(authority.authoritativeEvidence.P4.elapsedMs < authority.authoritativeEvidence.P4.speedTargetMs);
  assert.match(p4Cli, /M3_MARKER_MOTION_P4_FAILURE_INJECTION/);
  assert.match(p4Cli, /comp_motion_set/);
  assert.match(p4Cli, /layer_motion_set/);
  assert.match(p4Cli, /marker_set/);
  assert.match(p4Cli, /marker_remove/);
  assert.doesNotMatch(p4Cli, /restoreWarmBaseline|client\.undoLast/);
  assert.match(p4Wrapper, /cleanup-m3-marker-motion-stale-proof\.jsx/);
  assert.match(p4Wrapper, /verify-blank-unsaved-ae\.jsx/);
  assert.match(p4Wrapper, /speedTargetMs=30000/);
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

test("historical combined requests remain available only as warm diagnostics", async () => {
  const bootstrap = JSON.parse(await readFile(bootstrapRequestPath, "utf8"));
  const reuse = JSON.parse(await readFile(reuseRequestPath, "utf8"));
  const authority = JSON.parse(await readFile(authorityPath, "utf8"));
  assert.equal(bootstrap.proofScript, "scripts/windows/run-m3-marker-motion-p3-p4-warm.ps1");
  assert.equal(reuse.proofScript, "scripts/windows/run-m3-marker-motion-p3-p4-warm-armed.ps1");
  assert.equal(bootstrap.lifecycle, "RESTART_AE");
  assert.equal(reuse.lifecycle, "REUSE_AE");
  assert.equal(authority.legacyDiagnostics.promotionAuthority, false);
  assert.ok(authority.legacyDiagnostics.paths.includes(bootstrapRequestPath));
  assert.ok(authority.legacyDiagnostics.paths.includes(reuseRequestPath));
});

test("legacy warm wrapper never owns AE shutdown and opens only the declared EditFlow panel", async () => {
  const source = await readFile(legacyWrapperPath, "utf8");
  const opener = await readFile(panelOpenerPath, "utf8");
  assert.match(source, /EDITFLOW_AE_WARM_SESSION/);
  assert.match(source, /EDITFLOW_M3_MARKER_MOTION_P4_PROOF/);
  assert.match(source, /npm run build:test-runtime/);
  assert.match(source, /m3-marker-motion-p3-p4-fast\.mjs/);
  assert.match(source, /open-editflow2-panel\.jsx/);
  assert.match(source, /\$PanelArguments\s*=\s*@\("-r",\s*\$PanelOpenerRuntimePath\)/);
  assert.match(source, /Start-Process\s+-FilePath\s+\$AfterFxPath\s+-ArgumentList\s+\$PanelArguments\s+-PassThru/);
  assert.match(opener, /EditFlow 2\.0 Bridge/);
  assert.match(opener, /app\.findMenuCommandId/);
  assert.match(opener, /app\.executeCommand/);
  assert.doesNotMatch(opener, /SendKeys|SetCursorPos|mouse_event|Invoke-Expression/);
  assert.doesNotMatch(source, /Stop-Process\s+.*AfterFX/i);
  assert.doesNotMatch(source, /taskkill/i);
});

test("protocol-2.0 compatibility verifier delegates to the accepted standard installer", async () => {
  const source = await readFile(installerPath, "utf8");
  assert.match(source, /install-editflow-cep\.ps1/);
  assert.match(source, /editflow_host_current_v20\.jsx/);
  assert.match(source, /editflow_host_m3_marker_motion\.jsx/);
  assert.match(source, /2\.0\.0/);
  assert.match(source, /no longer installs a separate preview runtime/);
  assert.doesNotMatch(source, /RotateToken/);
});

test("real-AE workflow retains the shared accelerated lane for historical combined diagnostics", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /editflow-accelerated-real-ae-workstation/);
  assert.match(source, /34286914057/);
  assert.match(source, /m3-marker-motion-p1-p2-proof-/);
  assert.match(source, /install-editflow-cep-v20-preview\.ps1/);
  assert.match(source, /invoke-editflow-ae-proof\.ps1/);
  assert.match(source, /BOOTSTRAP/);
  assert.match(source, /REUSE/);
});
