import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const cliPath = "apps/desktop-host/src/m3-composite-p5-cli.ts";
const reopenPath = "scripts/windows/m3-composite-p5-reopen.jsx";
const cleanupPath = "scripts/windows/m3-composite-p5-cleanup.jsx";
const acceptancePath = "scripts/windows/run-m3-composite-p5.ps1";
const selfHostedPath = "scripts/windows/run-m3-composite-p5-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-composite-real-ae-p5.yml";

test("composite P5 transfer harness covers save reopen reconnect and all four protocol 1.3 commands", async () => {
  const source = await readFile(cliPath, "utf8");

  assert.match(source, /AE_COMPOSITE_PROTOCOL_VERSION_V13/);
  assert.match(source, /buildCompositeRequestV13/);
  assert.match(source, /"project\.save"/);
  assert.match(source, /"layer\.set_track_matte"/);
  assert.match(source, /"layer\.clear_track_matte"/);
  assert.match(source, /"layer\.set_blend_mode"/);
  assert.match(source, /"layer\.composite_readback"/);
  assert.match(source, /trackMatteType: "LUMA"/);
  assert.match(source, /blendMode: "ADD"/);
  assert.match(source, /trackMatteType: "ALPHA_INVERTED"/);
  assert.match(source, /blendMode: "SCREEN"/);
  assert.match(source, /await broker\.stop\(\)/);
  assert.match(source, /await broker\.start\(\)/);
  assert.match(source, /secondPanel\.sessionId !== firstSessionId/);
  assert.match(source, /saved_structural_fingerprint_preserved/);
  assert.match(source, /composite_exact_after_reopen_reconnect/);
  assert.match(source, /post_reconnect_clear_applied/);
  assert.match(source, /post_reconnect_matte_reassigned/);
  assert.match(source, /post_reconnect_blend_applied/);
  assert.match(source, /post_reconnect_mutation_readback/);
  assert.match(source, /P5_save_reopen_reconnect_transfer: ok/);
});

test("composite P5 fixed reopen and cleanup scripts are proof-gated and parse before AE execution", async () => {
  const [reopen, cleanup] = await Promise.all([
    readFile(reopenPath, "utf8"),
    readFile(cleanupPath, "utf8"),
  ]);

  assert.match(reopen, /EDITFLOW_M3_COMPOSITE_P5_PROOF/);
  assert.match(reopen, /m3-composite-p5-transfer\.aep/);
  assert.match(reopen, /M3_COMPOSITE_P5_REOPEN/);
  assert.match(reopen, /EditFlow2_dispatch = undefined/);
  assert.match(reopen, /\$\.evalFile\(hostScript\)/);

  assert.match(cleanup, /EDITFLOW_M3_COMPOSITE_P5_PROOF/);
  assert.match(cleanup, /M3_COMPOSITE_P5_/);
  assert.match(cleanup, /app\.project\.numItems !== 2/);
  assert.match(cleanup, /targetComp\.numLayers !== 3/);
  assert.match(cleanup, /_TARGET_LAYER/);
  assert.match(cleanup, /_SPACER_LAYER/);
  assert.match(cleanup, /_MATTE_LAYER/);
  assert.match(cleanup, /TrackMatteType\.ALPHA_INVERTED/);
  assert.match(cleanup, /BlendingMode\.SCREEN/);
  assert.match(cleanup, /project\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\)/);
  assert.match(cleanup, /app\.newProject\(\)/);

  assert.doesNotThrow(() => new vm.Script(reopen, { filename: reopenPath }));
  assert.doesNotThrow(() => new vm.Script(cleanup, { filename: cleanupPath }));
});

test("composite P5 wrappers derive from accepted mask P5 machinery but isolate proof flags and artifact namespace", async () => {
  const [acceptance, selfHosted] = await Promise.all([
    readFile(acceptancePath, "utf8"),
    readFile(selfHostedPath, "utf8"),
  ]);

  assert.match(acceptance, /run-m3-mask-p5\.ps1/);
  assert.match(acceptance, /m3-composite-p5-transfer/);
  assert.match(acceptance, /EDITFLOW_M3_COMPOSITE_P5_PROOF/);
  assert.match(acceptance, /m3-composite-p5-cli\.js/);
  assert.match(acceptance, /composite_exact_after_reopen_reconnect/);

  assert.match(selfHosted, /run-m3-mask-p5-self-hosted\.ps1/);
  assert.match(selfHosted, /run-m3-composite-p5\.ps1/);
  assert.match(selfHosted, /EDITFLOW_M3_COMPOSITE_P5_PROOF/);
  assert.match(selfHosted, /OriginalMaskP5Env = \$env:EDITFLOW_M3_MASK_P5_PROOF/);
  assert.match(selfHosted, /Remove-Item Env:EDITFLOW_M3_MASK_P5_PROOF -ErrorAction SilentlyContinue/);
  assert.doesNotMatch(selfHosted, /EDITFLOW_M3_MASK_P5_PROOF=1/);
});

test("composite P5 workflow is isolated on its own control branch and proof artifacts", async () => {
  const source = await readFile(workflowPath, "utf8");

  assert.match(source, /ae-test\/m3-composite-p5-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-composite-p5\.txt/);
  assert.match(source, /run-m3-composite-p5-self-hosted\.ps1/);
  assert.match(source, /m3-composite-p5-proof-/);
  assert.match(source, /proofs\/artifacts\/m3-composite-p5-transfer/);
});
