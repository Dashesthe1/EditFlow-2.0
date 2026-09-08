import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const acceptancePath = "scripts/windows/run-m3-motion-render-p1-p2.ps1";
const selfHostedPath = "scripts/windows/run-m3-motion-render-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-motion-render-real-ae-p1-p2.yml";

test("motion-render acceptance wrapper requires truthful P1/P2 and exact cleanup only", async () => {
  const source = await readFile(acceptancePath, "utf8");
  assert.match(source, /m3-motion-render-p1-p2-cli\.js/);
  assert.match(source, /P1 deterministic rejection and P2 exact composition\/layer motion-render structural readback only/);
  assert.match(source, /p1_invalid_comp_rejected/);
  assert.match(source, /p1_invalid_layer_rejected/);
  assert.match(source, /p1_stale_revision_rejected/);
  assert.match(source, /p2_comp_settings_applied/);
  assert.match(source, /p2_layer_frame_mix/);
  assert.match(source, /p2_layer_pixel_motion/);
  assert.match(source, /p2_layer_no_frame_blend/);
  assert.match(source, /cleanup_fingerprint_restored/);
  assert.match(source, /must not claim P3, P4, or P5/);
});

test("self-hosted motion-render proof derives from accepted lifecycle and injects only isolated v1.10 preview installation", async () => {
  const source = await readFile(selfHostedPath, "utf8");
  assert.match(source, /run-m3-mask-self-hosted\.ps1/);
  assert.match(source, /run-m3-motion-render-p1-p2\.ps1/);
  assert.match(source, /proofs\\artifacts\\m3-motion-render-p1-p2/);
  assert.match(source, /authenticated protocol 1\.10 preview registration/);
  assert.match(source, /install-editflow-cep-v110-preview\.ps1/);
  assert.match(source, /accepted production runtime remains protocol 1\.9/);
  assert.match(source, /CEP12-AEFT/);
});

test("motion-render real-AE workflow is isolated to its control branch and retains artifacts", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /ae-test\/m3-motion-render-p1-p2-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-motion-render-p1-p2\.txt/);
  assert.match(source, /run-m3-motion-render-self-hosted\.ps1/);
  assert.match(source, /runs-on: \[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /timeout-minutes: 10/);
  assert.match(source, /m3-motion-render-p1-p2-proof-/);
  assert.match(source, /proofs\/artifacts\/m3-motion-render-p1-p2\//);
  assert.match(source, /if: always\(\)/);
  assert.doesNotMatch(source, /pull_request:/);
});
