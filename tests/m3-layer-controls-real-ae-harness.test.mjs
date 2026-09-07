import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/m3-layer-controls-p1-p2-cli.ts";
const acceptancePath = "scripts/windows/run-m3-layer-controls-p1-p2.ps1";
const selfHostedPath = "scripts/windows/run-m3-layer-controls-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-layer-controls-p1-p2-real-ae.yml";
const fixturePath = "packages/adapters/ae-cep/host/editflow_host_m3_layer_controls_p12_fixture.jsx";
const cleanupPath = "packages/adapters/ae-cep/host/editflow_host_m3_layer_controls_p12_cleanup.jsx";

test("layer-controls P1/P2 CLI exercises every protocol-1.6 control and preserves proof boundaries", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /supportedProtocolVersions:\s*\[AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16, AE_ADAPTER_PROTOCOL_VERSION_V11\]/);
  assert.match(source, /panel\.protocolVersion === AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16/);
  assert.match(source, /new AeCepAdapterClientV11/);
  assert.match(source, /buildLayerControlsRequestV16/);
  for (const token of [
    "enabled", "solo", "shy", "locked", "audioEnabled", "adjustmentLayer",
    "collapseTransformation", "effectsActive", "guideLayer", "preserveTransparency",
    "quality", "samplingQuality", "threeDLayer", "hideShyLayers",
  ]) assert.match(source, new RegExp(token));
  for (const check of [
    "p1_unknown_control_rejected", "p1_av_only_camera_rejected", "p1_no_audio_rejected",
    "p1_unsettable_collapse_rejected", "p1_locked_conflict_rejected", "p1_stale_revision_rejected",
    "p2_audio_disable_exact", "p2_audio_enable_exact", "p2_quality_draft_bicubic",
    "p2_quality_wireframe_bilinear", "p2_quality_best", "p2_collapse_exact",
    "p2_unlock_first_exact", "p2_lock_last_exact", "p2_comp_hide_shy_on",
    "p2_comp_hide_shy_off", "p2_order_preserved", "cleanup_fingerprint_restored",
  ]) assert.match(source, new RegExp(check));
  assert.match(source, /P1_validation_rejection/);
  assert.match(source, /P2_structural_readback/);
  assert.match(source, /P3_visual_proof:\s*false/);
  assert.match(source, /P4_failure_injection_rollback:\s*false/);
  assert.match(source, /P5_save_reopen_reconnect_transfer:\s*false/);
  assert.match(source, /excluded:\s*\["frameBlending", "motionBlur", "shutterAngle", "shutterPhase", "markers"\]/);
});

test("proof-only fixture builds the exact audio/precomp/solid/camera matrix and no production command", async () => {
  const source = await readFile(fixturePath, "utf8");
  assert.match(source, /EDITFLOW_M3_LAYER_CONTROLS_P12_PROOF/);
  assert.match(source, /EDITFLOW_M3_LAYER_CONTROLS_P12_PREFIX/);
  assert.match(source, /app\.project\.items\.addComp/);
  assert.match(source, /new ImportOptions\(audioFile\)/);
  assert.match(source, /target\.layers\.add\(audioItem\)/);
  assert.match(source, /target\.layers\.addSolid/);
  assert.match(source, /target\.layers\.addCamera/);
  assert.match(source, /target\.numLayers !== 4/);
  assert.match(source, /app\.project\.numItems !== 4/);
  assert.match(source, /M3_LAYER_CONTROLS_P1_P2_FIXTURE/);
  assert.doesNotMatch(source, /EditFlow2_dispatch\s*=/);
  assert.doesNotMatch(source, /\beval\s*\(/);
});

test("proof-only cleanup validates the fixed prefix-owned fixture before restoring blank project", async () => {
  const source = await readFile(cleanupPath, "utf8");
  assert.match(source, /EDITFLOW_M3_LAYER_CONTROLS_P12_PROOF/);
  assert.match(source, /app\.project\.numItems !== 4/);
  assert.match(source, /target\.numLayers !== 4/);
  assert.match(source, /CloseOptions\.DO_NOT_SAVE_CHANGES/);
  assert.match(source, /app\.newProject\(\)/);
  assert.match(source, /app\.project\.numItems !== 0/);
  assert.match(source, /M3_LAYER_CONTROLS_P1_P2_CLEANUP/);
  assert.doesNotMatch(source, /EditFlow2_dispatch\s*=/);
  assert.doesNotMatch(source, /\beval\s*\(/);
});

test("layer-controls acceptance wrapper requires exact P1/P2 checks, cleanup, safe native argv quoting, and no higher-proof overclaim", async () => {
  const source = await readFile(acceptancePath, "utf8");
  assert.match(source, /EDITFLOW_M3_LAYER_CONTROLS_P12_PROOF/);
  assert.match(source, /EDITFLOW_M3_LAYER_CONTROLS_P12_PREFIX/);
  assert.match(source, /m3-layer-controls-p1-p2-cli\.js/);
  assert.match(source, /function Quote-StartProcessArgument/);
  assert.match(source, /"--afterfx-path", \(Quote-StartProcessArgument \$AfterFx\)/);
  assert.match(source, /"--setup-script", \(Quote-StartProcessArgument \$SetupScript\)/);
  assert.match(source, /"--cleanup-script", \(Quote-StartProcessArgument \$CleanupScript\)/);
  assert.match(source, /cleanupComplete -ne \$true/);
  assert.match(source, /p1_unknown_control_rejected/);
  assert.match(source, /p2_audio_enable_exact/);
  assert.match(source, /p2_quality_wireframe_bilinear/);
  assert.match(source, /p2_order_preserved/);
  assert.match(source, /cleanup_fingerprint_restored/);
  assert.match(source, /must not claim P3, P4, or P5/);
});

test("layer-controls self-hosted wrapper reuses accepted startup logic and proof-gates AE before launch", async () => {
  const source = await readFile(selfHostedPath, "utf8");
  assert.match(source, /\$TemplatePath = Join-Path \$RepoRoot "scripts\\windows\\run-m3-mask-self-hosted\.ps1"/);
  assert.match(source, /run-m3-layer-controls-p1-p2\.ps1/);
  assert.match(source, /m3-layer-controls-p1-p2/);
  assert.match(source, /authenticated protocol 1\.6 registration/);
  assert.match(source, /EDITFLOW_M3_LAYER_CONTROLS_P12_PROOF = "1"/);
  assert.match(source, /EDITFLOW_M3_LAYER_CONTROLS_P12_PREFIX = "M3_LAYER_CONTROLS_P12_"/);
  assert.doesNotMatch(source, /\$TempPath = Join-Path \$env:TEMP/);
  assert.doesNotMatch(source, /Invoke-Expression/);
  assert.match(source, /Remove-Item \$TempPath -Force -ErrorAction SilentlyContinue/);
});

test("layer-controls real-AE workflow is self-hosted, bounded, path-scoped and artifact-producing", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /ae-test\/m3-layer-controls-p1-p2-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-layer-controls-p1-p2\.txt/);
  assert.match(source, /runs-on:\s*\[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /timeout-minutes:\s*12/);
  assert.match(source, /shell:\s*cmd/);
  assert.match(source, /powershell\.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File/);
  assert.match(source, /run-m3-layer-controls-self-hosted\.ps1/);
  assert.match(source, /proofs\/artifacts\/m3-layer-controls-p1-p2\//);
  assert.match(source, /if:\s*always\(\)/);
  assert.doesNotMatch(source, /pull_request:/);
});
