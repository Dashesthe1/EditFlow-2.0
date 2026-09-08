import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const paths = {
  atomicity: "packages/adapters/ae-cep/host/editflow_host_m3_marker_motion_atomicity.jsx",
  cleanup: "packages/adapters/ae-cep/host/editflow_host_m3_marker_motion_proof_cleanup.jsx",
  loader: "packages/adapters/ae-cep/host/editflow_host_current_v20.jsx",
  cli: "apps/desktop-host/src/m3-marker-motion-p3-p4-cli.ts",
  runner: "scripts/windows/run-m3-marker-motion-p3-p4.ps1",
  selfHosted: "scripts/windows/run-m3-marker-motion-p3-p4-self-hosted.ps1",
  workflow: ".github/workflows/m3-marker-motion-real-ae-p3-p4.yml",
};

test("protocol 2.0 marker-motion atomicity is fixed, structural, proof-gated, and rollback-capable", async () => {
  const source = await read(paths.atomicity);
  assert.match(source, /EDITFLOW_M3_MARKER_MOTION_P4_PROOF/);
  assert.match(source, /M3_MARKER_MOTION_P4_FAILURE_INJECTION/);
  assert.match(source, /M3_MARKER_MOTION_ATOMICITY_INTERNAL/);
  assert.match(source, /M3_MARKER_MOTION_P4_INDUCED_FAILURE/);
  assert.match(source, /M3_MARKER_MOTION_POST_WRITE_READBACK_MISMATCH/);
  assert.match(source, /"marker\.set": true/);
  assert.match(source, /"marker\.remove": true/);
  assert.match(source, /"comp\.motion\.set": true/);
  assert.match(source, /"layer\.motion\.set": true/);
  assert.match(source, /restoreMarkers/);
  assert.match(source, /restoreState/);
  assert.match(source, /statesEqual/);
  assert.match(source, /PROOF_INJECTION/);
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.doesNotMatch(source, /\bFunction\s*\(/);
});

test("P4 cleanup can discard only the exact unsaved marker-motion fixture after recovery render", async () => {
  const source = await read(paths.cleanup);
  assert.match(source, /EDITFLOW_M3_MARKER_MOTION_P4_PROOF/);
  assert.match(source, /p4-post-rollback\.avi/);
  assert.match(source, /app\.project\.file/);
  assert.match(source, /app\.project\.numItems !== 4/);
  assert.match(source, /_MOTION_MEDIA/);
  assert.match(source, /_SEQUENCE_MEDIA/);
  assert.match(source, /_MOTION_COMP/);
  assert.match(source, /_BLEND_COMP/);
  assert.match(source, /_MOTION_LAYER/);
  assert.match(source, /_BLEND_LAYER/);
  assert.match(source, /M3_MARKER_MOTION_P34_/);
  assert.match(source, /CloseOptions\.DO_NOT_SAVE_CHANGES/);
  assert.match(source, /app\.newProject\(\)/);
  assert.match(source, /M3_MARKER_MOTION_P3_P4_REAL_AE/);
});

test("protocol 2.0 loader keeps accepted lineage available and fails proof mode closed", async () => {
  const source = await read(paths.loader);
  assert.match(source, /editflow_host_current_v19\.jsx/);
  assert.match(source, /editflow_host_m3_marker_motion\.jsx/);
  assert.match(source, /editflow_host_m3_marker_motion_atomicity\.jsx/);
  assert.match(source, /editflow_host_m3_marker_motion_proof_cleanup\.jsx/);
  assert.match(source, /EDITFLOW_M3_MARKER_MOTION_P4_PROOF/);
  assert.match(source, /M3_MARKER_MOTION_ATOMICITY_LOAD_FAILED/);
  assert.match(source, /M3_MARKER_MOTION_PROOF_CLEANUP_LOAD_FAILED/);
  assert.match(source, /EditFlow2_HOST_PROTOCOL_20/);
});

test("P3/P4 CLI consumes accepted P1/P2 and emits truthful motion, frame-blending, marker, and rollback evidence", async () => {
  const source = await read(paths.cli);
  assert.match(source, /M3_MARKER_MOTION_P1_P2_REAL_AE/);
  assert.match(source, /--accepted-p1-p2/);
  assert.match(source, /createHash\("sha256"\)/);
  assert.match(source, /sequence: true/);
  assert.match(source, /stretch: 400/);
  assert.match(source, /ADBE Position/);
  assert.match(source, /shutterAngle: 360/);
  assert.match(source, /shutterPhase: -180/);
  assert.match(source, /FRAME_MIX/);
  assert.match(source, /PIXEL_MOTION/);
  assert.match(source, /p3-motion-blur-off\.avi/);
  assert.match(source, /p3-motion-blur-on\.avi/);
  assert.match(source, /p3-motion-blur-restored\.avi/);
  assert.match(source, /p3-frame-mix\.avi/);
  assert.match(source, /p3-pixel-motion\.avi/);
  assert.match(source, /p4-post-rollback\.avi/);
  assert.match(source, /M3_MARKER_MOTION_P4_FAILURE_INJECTION/);
  assert.match(source, /M3_MARKER_MOTION_P4_INDUCED_FAILURE/);
  assert.match(source, /p4_comp_motion/);
  assert.match(source, /p4_layer_motion/);
  assert.match(source, /p4_marker_set/);
  assert.match(source, /p4_marker_remove/);
  assert.match(source, /P3_visual_artifact_emitted/);
  assert.match(source, /P3_visual_proof: false/);
  assert.match(source, /P4_failure_injection_rollback/);
  assert.match(source, /P5_save_reopen_reconnect_transfer: false/);
  assert.match(source, /VISUAL_REVIEW_REQUIRED/);
  assert.match(source, /frame-mix and pixel-motion must be reviewed as retimed image-sequence footage rather than a precomp/);
});

test("Windows acceptance wrapper refuses to promote artifact existence into P3 visual acceptance", async () => {
  const source = await read(paths.runner);
  assert.match(source, /AcceptedP1P2Path/);
  assert.match(source, /m3-marker-motion-p3-p4/);
  assert.match(source, /VISUAL_REVIEW_REQUIRED/);
  assert.match(source, /P3_visual_artifact_emitted/);
  assert.match(source, /P3_visual_proof/);
  assert.match(source, /P4_failure_injection_rollback/);
  assert.match(source, /p4_comp_motion/);
  assert.match(source, /p4_layer_motion/);
  assert.match(source, /p4_marker_set/);
  assert.match(source, /p4_marker_remove/);
  assert.match(source, /cleanup_blank_unsaved/);
  assert.match(source, /cleanup_fingerprint_restored/);
});

test("self-hosted runner installs protocol 2.0 only inside proof process and preserves bounded AE hygiene", async () => {
  const source = await read(paths.selfHosted);
  assert.match(source, /npm run check/);
  assert.match(source, /EDITFLOW_M3_MARKER_MOTION_P4_PROOF/);
  assert.match(source, /EDITFLOW_M3_MARKER_MOTION_ACCEPTED_P1_P2/);
  assert.match(source, /editflow_host_m3_marker_motion\.jsx/);
  assert.match(source, /editflow_host_m3_marker_motion_atomicity\.jsx/);
  assert.match(source, /editflow_host_m3_marker_motion_proof_cleanup\.jsx/);
  assert.match(source, /editflow_host_current_v20\.jsx/);
  assert.match(source, /var KNOWN_PROTOCOLS = \["2\.0\.0"/);
  assert.match(source, /EditFlow2_HOST_PROTOCOL_20/);
  assert.match(source, /normal installer defaults remain accepted protocol 1\.9/);
  assert.match(source, /watch-ae-startup-dialogs\.ps1/);
  assert.match(source, /quit-editflow-proof-ae\.jsx/);
  assert.match(source, /EditFlow2-layer-controls-proof-quit\.log/);
  assert.doesNotMatch(source, /EditFlow2-marker-motion-proof-quit\.log/);
  assert.match(source, /PROOF_CLEAN_QUIT_CONFIRMED/);
  assert.match(source, /AcceptedP1P2Path/);
});

test("real-AE workflow is pinned to the accepted P1/P2 evidence and the isolated control branch", async () => {
  const source = await read(paths.workflow);
  assert.match(source, /ae-test\/m3-marker-motion-p3-p4-control/);
  assert.match(source, /m3-marker-motion-p3-p4\.txt/);
  assert.match(source, /accepted_p1_p2_run_id/);
  assert.match(source, /34286914057/);
  assert.match(source, /m3-marker-motion-p1-p2-proof-/);
  assert.match(source, /actions\/download-artifact@v4/);
  assert.match(source, /runs-on: \[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /run-m3-marker-motion-p3-p4-self-hosted\.ps1/);
  assert.match(source, /AcceptedP1P2Path/);
  assert.match(source, /m3-marker-motion-p3-p4-proof-/);
});
