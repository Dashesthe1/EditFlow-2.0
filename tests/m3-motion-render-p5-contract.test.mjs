import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const cliPath = "apps/desktop-host/src/m3-motion-render-p5-cli.ts";
const reopenPath = "scripts/windows/m3-motion-render-p5-reopen.jsx";
const cleanupPath = "scripts/windows/m3-motion-render-p5-cleanup.jsx";
const acceptancePath = "scripts/windows/run-m3-motion-render-p5.ps1";
const selfHostedPath = "scripts/windows/run-m3-motion-render-p5-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-motion-render-real-ae-p5.yml";

test("motion-render P5 proves save reopen distinct protocol 1.10 reconnect and fresh transferred authority", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /AE_MOTION_RENDER_PROTOCOL_VERSION_V110/);
  assert.match(source, /buildMotionRenderRequestV110/);
  assert.match(source, /"project\.save"/);
  assert.match(source, /"comp\.motion_render\.set"/);
  assert.match(source, /"layer\.motion_render\.set"/);
  assert.match(source, /"motion_render\.readback"/);
  assert.match(source, /await broker\.stop\(\)/);
  assert.match(source, /await broker\.start\(\)/);
  assert.match(source, /secondPanel\.sessionId !== firstSessionId/);
  assert.match(source, /secondPanel\.protocolVersion === AE_MOTION_RENDER_PROTOCOL_VERSION_V110/);
  assert.match(source, /saved_structural_fingerprint_preserved/);
  assert.match(source, /native_layer_id_preserved/);
  assert.match(source, /motion_render_exact_after_reopen_reconnect/);
  assert.match(source, /post_reconnect_comp_mutation_readback/);
  assert.match(source, /post_reconnect_layer_mutation_readback/);
  assert.match(source, /P5_save_reopen_reconnect_transfer: ok/);
});

test("motion-render P5 transfers a distinctive saved state then proves a distinct post-reconnect state", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /shutterAngle: 315/);
  assert.match(source, /shutterPhase: -105/);
  assert.match(source, /samplesPerFrame: 24/);
  assert.match(source, /adaptiveSampleLimit: 96/);
  assert.match(source, /frameBlendingType: "FRAME_MIX"/);
  assert.match(source, /shutterAngle: 180/);
  assert.match(source, /shutterPhase: -45/);
  assert.match(source, /samplesPerFrame: 32/);
  assert.match(source, /adaptiveSampleLimit: 128/);
  assert.match(source, /frameBlendingType: "PIXEL_MOTION"/);
  assert.match(source, /P1_P2_run: 34275036819/);
  assert.match(source, /P3_P4_run: 34279808693/);
});

test("motion-render P5 fixed reopen and cleanup scripts are proof-gated v110 fixed-path exact-fixture only", async () => {
  const [reopen, cleanup] = await Promise.all([readFile(reopenPath, "utf8"), readFile(cleanupPath, "utf8")]);
  assert.match(reopen, /EDITFLOW_M3_MOTION_RENDER_P5_PROOF/);
  assert.match(reopen, /m3-motion-render-p5-transfer\.aep/);
  assert.match(reopen, /M3_MOTION_RENDER_P5_REOPEN/);
  assert.match(reopen, /editflow_host_current_v110\.jsx/);
  assert.match(reopen, /EditFlow2_dispatch = undefined/);
  assert.match(reopen, /\$\.evalFile\(hostScript\)/);
  assert.match(reopen, /app\.project\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\)/);
  assert.match(reopen, /app\.open\(projectFile\)/);

  assert.match(cleanup, /EDITFLOW_M3_MOTION_RENDER_P5_PROOF/);
  assert.match(cleanup, /M3_MOTION_RENDER_P5_/);
  assert.match(cleanup, /app\.project\.numItems !== 2/);
  assert.match(cleanup, /targetComp\.numLayers !== 1/);
  assert.match(cleanup, /targetComp\.shutterAngle, 180/);
  assert.match(cleanup, /targetComp\.motionBlurSamplesPerFrame, 32/);
  assert.match(cleanup, /FrameBlendingType\.PIXEL_MOTION/);
  assert.match(cleanup, /project\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\)/);
  assert.match(cleanup, /app\.newProject\(\)/);
  assert.doesNotThrow(() => new vm.Script(reopen, { filename: reopenPath }));
  assert.doesNotThrow(() => new vm.Script(cleanup, { filename: cleanupPath }));
});

test("motion-render P5 wrappers retain the isolated protocol 1.10 preview installer and guarded startup dialog handling", async () => {
  const [acceptance, selfHosted] = await Promise.all([readFile(acceptancePath, "utf8"), readFile(selfHostedPath, "utf8")]);
  assert.match(acceptance, /m3-motion-render-p5-transfer/);
  assert.match(acceptance, /EDITFLOW_M3_MOTION_RENDER_P5_PROOF/);
  assert.match(acceptance, /m3-motion-render-p5-cli\.js/);
  assert.match(acceptance, /motion_render_exact_after_reopen_reconnect/);
  assert.match(acceptance, /post_reconnect_comp_mutation_readback/);
  assert.match(acceptance, /post_reconnect_layer_mutation_readback/);

  assert.match(selfHosted, /run-m3-motion-render-self-hosted\.ps1/);
  assert.match(selfHosted, /run-m3-motion-render-p5\.ps1/);
  assert.match(selfHosted, /EDITFLOW_M3_MOTION_RENDER_P5_PROOF/);
  assert.match(selfHosted, /install-editflow-cep-v110-preview\.ps1/);
  assert.match(selfHosted, /handle-known-ae-startup-dialog\.ps1/);
  assert.doesNotMatch(selfHosted, /install-editflow-cep\.ps1'\)/);
});

test("motion-render P5 workflow is isolated on its control branch and retains transfer evidence", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /ae-test\/m3-motion-render-p5-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-motion-render-p5\.txt/);
  assert.match(source, /run-m3-motion-render-p5-self-hosted\.ps1/);
  assert.match(source, /m3-motion-render-p5-proof-/);
  assert.match(source, /proofs\/artifacts\/m3-motion-render-p5-transfer/);
  assert.match(source, /runs-on: \[self-hosted, Windows, editflow-ae\]/);
});
