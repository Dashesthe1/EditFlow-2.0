import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/m3-motion-render-p3-p4-cli.ts";
const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_motion_render.jsx";
const wrapperPath = "scripts/windows/run-m3-motion-render-p3-p4.ps1";
const selfHostedPath = "scripts/windows/run-m3-motion-render-p3-p4-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-motion-render-real-ae-p3-p4.yml";

test("motion-render P3/P4 CLI emits distinct visual families while leaving P3 unaccepted", async () => {
  const source = await readFile(cliPath, "utf8");
  for (const name of [
    "p3-motion-baseline.avi",
    "p3-motion-blur-enabled.avi",
    "p3-motion-restored-baseline.avi",
    "p3-blend-none.avi",
    "p3-blend-frame-mix.avi",
    "p3-blend-pixel-motion.avi",
    "p3-blend-restored-none.avi",
    "p4-post-rollback-motion-baseline.avi",
    "p4-post-rollback-blend-none.avi",
  ]) assert.match(source, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, /frameBlendingType: "FRAME_MIX"/);
  assert.match(source, /frameBlendingType: "PIXEL_MOTION"/);
  assert.match(source, /frameBlendingType: "NO_FRAME_BLEND"/);
  assert.match(source, /shutterAngle: 270/);
  assert.match(source, /frameRate: 12/);
  assert.match(source, /frameRate: 24/);
  assert.match(source, /P3_visual_proof: false/);
  assert.match(source, /P4_failure_injection_rollback: p4Pass/);
  assert.match(source, /visualReviewRequired: true/);
});

test("motion-render P3/P4 render path contract preserves the request while accepting AE canonicalization", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /const requestedOutputPath = readback\?\.\["requestedOutputPath"\]/);
  assert.match(source, /sameFilesystemPath\(requestedOutputPath, outputPath\)/);
  assert.match(source, /After Effects' canonical OutputModule\.file path/);
  assert.match(source, /path\.relative\(artifactDir, canonicalOutputPath\)/);
  assert.match(source, /sameFilesystemPath\(completion\.outputPath, canonicalOutputPath\)/);
  assert.doesNotMatch(source, /sameFilesystemPath\(canonicalOutputPath, outputPath\)/);
});

test("motion-render P4 host injection is double-gated and occurs only after verified writes", async () => {
  const source = await readFile(hostPath, "utf8");
  assert.match(source, /request\.readbackProfile === "M3_MOTION_RENDER_P4_FAILURE_INJECTION"/);
  assert.match(source, /\$\.getenv\("EDITFLOW_M3_MOTION_RENDER_P4_PROOF"\) === "1"/);
  assert.match(source, /M3_MOTION_RENDER_P4_COMP_INDUCED_FAILURE/);
  assert.match(source, /M3_MOTION_RENDER_P4_LAYER_INDUCED_FAILURE/);
  const verifyComp = source.indexOf("verifyComp(prepared.comp, request.payload.settings);");
  const compInject = source.indexOf('shouldInjectP4(request, "comp.motion_render.set")');
  const verifyLayer = source.indexOf("verifyLayer(prepared.layer, request.payload.settings);");
  const layerInject = source.indexOf('shouldInjectP4(request, "layer.motion_render.set")');
  assert.ok(verifyComp >= 0 && compInject > verifyComp);
  assert.ok(verifyLayer >= 0 && layerInject > verifyLayer);
  assert.match(source, /restoreComp\(prepared\.comp, beforeComp\)/);
  assert.match(source, /restoreLayer\(prepared\.layer, beforeLayer\)/);
});

test("P3/P4 Windows wrapper accepts P4 only and requires independent P3 review", async () => {
  const source = await readFile(wrapperPath, "utf8");
  assert.match(source, /m3-motion-render-p1-p2-acceptance\.json/);
  assert.match(source, /m3-motion-render-p3-p4-cli\.js/);
  assert.match(source, /P3_visual_proof -ne \$false/);
  assert.match(source, /P4_failure_injection_rollback -ne \$true/);
  assert.match(source, /visualReviewRequired -ne \$true/);
  assert.match(source, /p4_comp_fingerprint_restored/);
  assert.match(source, /p4_layer_fingerprint_restored/);
});

test("P3/P4 self-hosted runner arms proof injection before launch and reuses isolated v1.10 lifecycle", async () => {
  const source = await readFile(selfHostedPath, "utf8");
  assert.match(source, /run-m3-motion-render-self-hosted\.ps1/);
  assert.match(source, /run-m3-motion-render-p3-p4\.ps1/);
  assert.match(source, /install-editflow-cep-v110-preview\.ps1/);
  assert.match(source, /EDITFLOW_M3_MOTION_RENDER_P4_PROOF = "1"/);
  assert.match(source, /Remove-Item Env:EDITFLOW_M3_MOTION_RENDER_P4_PROOF/);
  assert.match(source, /\$MaxPanelRegistrationAttempts = 2/);
});

test("P3/P4 workflow is isolated, bounded, explicit-triggered, and retains artifacts", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /ae-test\/m3-motion-render-p3-p4-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-motion-render-p3-p4\.txt/);
  assert.match(source, /runs-on:\s*\[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /timeout-minutes:\s*15/);
  assert.match(source, /run-m3-motion-render-p3-p4-self-hosted\.ps1/);
  assert.match(source, /proofs\/artifacts\/m3-motion-render-p3-p4\//);
  assert.match(source, /if:\s*always\(\)/);
  assert.doesNotMatch(source, /pull_request:/);
});
