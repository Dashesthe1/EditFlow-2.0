import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const cliPath = "apps/desktop-host/src/m3-parenting-p5-cli.ts";
const reopenPath = "scripts/windows/m3-parenting-p5-reopen.jsx";
const cleanupPath = "scripts/windows/m3-parenting-p5-cleanup.jsx";
const acceptancePath = "scripts/windows/run-m3-parenting-p5.ps1";
const selfHostedPath = "scripts/windows/run-m3-parenting-p5-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-parenting-real-ae-p5.yml";

test("parenting P5 transfer harness proves save reopen distinct reconnect and fresh protocol 1.4 authority", async () => {
  const source = await readFile(cliPath, "utf8");

  assert.match(source, /AE_PARENTING_PROTOCOL_VERSION_V14/);
  assert.match(source, /buildParentingRequestV14/);
  assert.match(source, /"project\.save"/);
  assert.match(source, /"layer\.set_parent_preserve_transform"/);
  assert.match(source, /"layer\.clear_parent_preserve_transform"/);
  assert.match(source, /"layer\.parenting_readback"/);
  assert.match(source, /await broker\.stop\(\)/);
  assert.match(source, /await broker\.start\(\)/);
  assert.match(source, /secondPanel\.sessionId !== firstSessionId/);
  assert.match(source, /secondPanel\.protocolVersion === AE_PARENTING_PROTOCOL_VERSION_V14/);
  assert.match(source, /saved_structural_fingerprint_preserved/);
  assert.match(source, /parenting_exact_after_reopen_reconnect/);
  assert.match(source, /post_reconnect_clear_applied/);
  assert.match(source, /post_reconnect_reparent_applied/);
  assert.match(source, /post_reconnect_mutation_readback/);
  assert.match(source, /layer_order_survived_post_reconnect_mutations/);
  assert.match(source, /P5_save_reopen_reconnect_transfer: ok/);
});

test("parenting P5 uses a materially different transfer fixture and preserves five-point visible geometry", async () => {
  const source = await readFile(cliPath, "utf8");

  assert.match(source, /width: 480,[\s\S]*?height: 240,[\s\S]*?frameRate: 30/);
  assert.match(source, /width: 960,[\s\S]*?height: 540,[\s\S]*?frameRate: 30/);
  assert.match(source, /position: \[205, 355\], scale: \[82, 82\], rotation: -31/);
  assert.match(source, /position: \[610, 165\], scale: \[130, 65\], rotation: 18/);
  assert.match(source, /topLeft/);
  assert.match(source, /topRight/);
  assert.match(source, /bottomRight/);
  assert.match(source, /bottomLeft/);
  assert.match(source, /center/);
  assert.match(source, /geometryClose\(initialGeometry, geometryPoints\(afterReconnectParenting\)\)/);
  assert.match(source, /geometryClose\(initialGeometry, geometryPoints\(afterClearParenting\)\)/);
  assert.match(source, /geometryClose\(initialGeometry, geometryPoints\(afterReparentParenting\)\)/);
  assert.match(source, /mainMergeCommit: "a2d4acf47668f47d18fce86ccce60ed52674cab2"/);
  assert.match(source, /p3p4RealAeRun: 34084958343/);
});

test("parenting P5 fixed reopen and cleanup scripts are proof-gated, fixed-path, and parse before AE execution", async () => {
  const [reopen, cleanup] = await Promise.all([
    readFile(reopenPath, "utf8"),
    readFile(cleanupPath, "utf8"),
  ]);

  assert.match(reopen, /EDITFLOW_M3_PARENTING_P5_PROOF/);
  assert.match(reopen, /m3-parenting-p5-transfer\.aep/);
  assert.match(reopen, /M3_PARENTING_P5_REOPEN/);
  assert.match(reopen, /EditFlow2_dispatch = undefined/);
  assert.match(reopen, /\$\.evalFile\(hostScript\)/);
  assert.match(reopen, /app\.project\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\)/);

  assert.match(cleanup, /EDITFLOW_M3_PARENTING_P5_PROOF/);
  assert.match(cleanup, /M3_PARENTING_P5_/);
  assert.match(cleanup, /app\.project\.numItems !== 2/);
  assert.match(cleanup, /targetComp\.numLayers !== 2/);
  assert.match(cleanup, /_PARENT_LAYER/);
  assert.match(cleanup, /_CHILD_LAYER/);
  assert.match(cleanup, /childLayer\.parent !== parentLayer/);
  assert.match(cleanup, /parentLayer\.parent !== null/);
  assert.match(cleanup, /project\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\)/);
  assert.match(cleanup, /app\.newProject\(\)/);

  assert.doesNotThrow(() => new vm.Script(reopen, { filename: reopenPath }));
  assert.doesNotThrow(() => new vm.Script(cleanup, { filename: cleanupPath }));
});

test("parenting P5 wrappers inherit accepted P5 machinery, run repository preflight, and isolate all nearby proof modes", async () => {
  const [acceptance, selfHosted] = await Promise.all([
    readFile(acceptancePath, "utf8"),
    readFile(selfHostedPath, "utf8"),
  ]);

  assert.match(acceptance, /run-m3-mask-p5\.ps1/);
  assert.match(acceptance, /m3-parenting-p5-transfer/);
  assert.match(acceptance, /EDITFLOW_M3_PARENTING_P5_PROOF/);
  assert.match(acceptance, /m3-parenting-p5-cli\.js/);
  assert.match(acceptance, /parenting_exact_after_reopen_reconnect/);
  assert.match(acceptance, /a2d4acf47668f47d18fce86ccce60ed52674cab2/);
  assert.match(acceptance, /34084958343/);

  assert.match(selfHosted, /run-m3-mask-p5-self-hosted\.ps1/);
  assert.match(selfHosted, /run-m3-parenting-p5\.ps1/);
  assert.match(selfHosted, /npm run check/);
  assert.match(selfHosted, /EDITFLOW_M3_PARENTING_P5_PROOF/);
  assert.match(selfHosted, /OriginalMaskP5Env = \$env:EDITFLOW_M3_MASK_P5_PROOF/);
  assert.match(selfHosted, /OriginalCompositeP5Env = \$env:EDITFLOW_M3_COMPOSITE_P5_PROOF/);
  assert.match(selfHosted, /OriginalParentingP4Env = \$env:EDITFLOW_M3_PARENTING_P4_PROOF/);
  assert.match(selfHosted, /Remove-Item Env:EDITFLOW_M3_MASK_P5_PROOF -ErrorAction SilentlyContinue/);
  assert.match(selfHosted, /Remove-Item Env:EDITFLOW_M3_COMPOSITE_P5_PROOF -ErrorAction SilentlyContinue/);
  assert.match(selfHosted, /Remove-Item Env:EDITFLOW_M3_PARENTING_P4_PROOF -ErrorAction SilentlyContinue/);
  assert.doesNotMatch(selfHosted, /EDITFLOW_M3_MASK_P5_PROOF=1/);
});

test("parenting P5 workflow is isolated on its control branch and retains transfer evidence", async () => {
  const source = await readFile(workflowPath, "utf8");

  assert.match(source, /ae-test\/m3-parenting-p5-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-parenting-p5\.txt/);
  assert.match(source, /run-m3-parenting-p5-self-hosted\.ps1/);
  assert.match(source, /m3-parenting-p5-proof-/);
  assert.match(source, /proofs\/artifacts\/m3-parenting-p5-transfer/);
  assert.match(source, /runs-on: \[self-hosted, Windows, editflow-ae\]/);
});
