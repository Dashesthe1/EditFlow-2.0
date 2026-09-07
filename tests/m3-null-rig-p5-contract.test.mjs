import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const cliPath = "apps/desktop-host/src/m3-null-rig-p5-cli.ts";
const reopenPath = "scripts/windows/m3-null-rig-p5-reopen.jsx";
const cleanupPath = "scripts/windows/m3-null-rig-p5-cleanup.jsx";
const acceptancePath = "scripts/windows/run-m3-null-rig-p5.ps1";
const selfHostedPath = "scripts/windows/run-m3-null-rig-p5-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-null-rig-real-ae-p5.yml";

test("null-rig P5 proves save reopen distinct protocol 1.5 reconnect and transferred managed-null authority", async () => {
  const source = await readFile(cliPath, "utf8");

  assert.match(source, /AE_NULL_RIG_PROTOCOL_VERSION_V15/);
  assert.match(source, /AE_PARENTING_PROTOCOL_VERSION_V14/);
  assert.match(source, /buildNullRigRequestV15/);
  assert.match(source, /buildParentingRequestV14/);
  assert.match(source, /"project\.save"/);
  assert.match(source, /"rig\.null\.create"/);
  assert.match(source, /"rig\.null\.readback"/);
  assert.match(source, /"rig\.null\.remove"/);
  assert.match(source, /"layer\.clear_parent_preserve_transform"/);
  assert.match(source, /await broker\.stop\(\)/);
  assert.match(source, /await broker\.start\(\)/);
  assert.match(source, /secondPanel\.sessionId !== firstSessionId/);
  assert.match(source, /secondPanel\.protocolVersion === AE_NULL_RIG_PROTOCOL_VERSION_V15/);
  assert.match(source, /saved_structural_fingerprint_preserved/);
  assert.match(source, /null_rig_exact_after_reopen_reconnect/);
  assert.match(source, /parenting_exact_after_reopen_reconnect/);
  assert.match(source, /post_reconnect_transferred_remove_applied/);
  assert.match(source, /transferred_remove_reclaims_owned_source/);
  assert.match(source, /fresh_post_reconnect_create_applied/);
  assert.match(source, /fresh_post_reconnect_readback_exact/);
  assert.match(source, /fresh_post_reconnect_remove_applied/);
  assert.match(source, /post_reconnect_mutation_readback/);
  assert.match(source, /P5_save_reopen_reconnect_transfer: ok/);
});

test("null-rig P5 uses a materially different transfer fixture and checks driven geometry across reconnect", async () => {
  const source = await readFile(cliPath, "utf8");

  assert.match(source, /width: 420,[\s\S]*?height: 220,[\s\S]*?frameRate: 30/);
  assert.match(source, /width: 900,[\s\S]*?height: 500,[\s\S]*?frameRate: 30/);
  assert.match(source, /position: \[590, 170\], scale: \[115, 75\], rotation: 14/);
  assert.match(source, /position: \[410, 290\], scale: \[88, 88\], rotation: -19/);
  assert.match(source, /pre_save_controller_geometry_moved/);
  assert.match(source, /geometryClose\(drivenGeometry, geometryPoints\(afterReconnectParenting\)\)/);
  assert.match(source, /geometryClose\(drivenGeometry, geometryPoints\(afterDetachParenting\)\)/);
  assert.match(source, /nullRigParentCommit: "09cb3e88eaba3dfbb365f3341e8a847b0f147dc1"/);
  assert.match(source, /p3p4RealAeRun: 34140788458/);
});

test("null-rig P5 fixed reopen and cleanup scripts are proof-gated, v15-aware, fixed-path, and fail closed on leaked null ownership", async () => {
  const [reopen, cleanup] = await Promise.all([
    readFile(reopenPath, "utf8"),
    readFile(cleanupPath, "utf8"),
  ]);

  assert.match(reopen, /EDITFLOW_M3_NULL_RIG_P5_PROOF/);
  assert.match(reopen, /m3-null-rig-p5-transfer\.aep/);
  assert.match(reopen, /M3_NULL_RIG_P5_REOPEN/);
  assert.match(reopen, /editflow_host_current_v15\.jsx/);
  assert.match(reopen, /EditFlow2_dispatch = undefined/);
  assert.match(reopen, /\$\.evalFile\(hostScript\)/);
  assert.match(reopen, /app\.project\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\)/);

  assert.match(cleanup, /EDITFLOW_M3_NULL_RIG_P5_PROOF/);
  assert.match(cleanup, /M3_NULL_RIG_P5_/);
  assert.match(cleanup, /app\.project\.numItems !== 2/);
  assert.match(cleanup, /targetComp\.numLayers !== 1/);
  assert.match(cleanup, /_CHILD_LAYER/);
  assert.match(cleanup, /childLayer\.parent !== null/);
  assert.match(cleanup, /found a non-composition project item after null removal/);
  assert.match(cleanup, /project\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\)/);
  assert.match(cleanup, /app\.newProject\(\)/);

  assert.doesNotThrow(() => new vm.Script(reopen, { filename: reopenPath }));
  assert.doesNotThrow(() => new vm.Script(cleanup, { filename: cleanupPath }));
});

test("null-rig P5 wrappers inherit accepted P5 machinery, run repository preflight, and isolate nearby proof modes", async () => {
  const [acceptance, selfHosted] = await Promise.all([
    readFile(acceptancePath, "utf8"),
    readFile(selfHostedPath, "utf8"),
  ]);

  assert.match(acceptance, /run-m3-mask-p5\.ps1/);
  assert.match(acceptance, /m3-null-rig-p5-transfer/);
  assert.match(acceptance, /EDITFLOW_M3_NULL_RIG_P5_PROOF/);
  assert.match(acceptance, /m3-null-rig-p5-cli\.js/);
  assert.match(acceptance, /null_rig_exact_after_reopen_reconnect/);
  assert.match(acceptance, /09cb3e88eaba3dfbb365f3341e8a847b0f147dc1/);
  assert.match(acceptance, /34140788458/);

  assert.match(selfHosted, /run-m3-mask-p5-self-hosted\.ps1/);
  assert.match(selfHosted, /run-m3-null-rig-p5\.ps1/);
  assert.match(selfHosted, /npm run check/);
  assert.match(selfHosted, /EDITFLOW_M3_NULL_RIG_P5_PROOF/);
  assert.match(selfHosted, /OriginalMaskP5Env = \$env:EDITFLOW_M3_MASK_P5_PROOF/);
  assert.match(selfHosted, /OriginalCompositeP5Env = \$env:EDITFLOW_M3_COMPOSITE_P5_PROOF/);
  assert.match(selfHosted, /OriginalParentingP5Env = \$env:EDITFLOW_M3_PARENTING_P5_PROOF/);
  assert.match(selfHosted, /OriginalNullRigP4Env = \$env:EDITFLOW_M3_NULL_RIG_P4_PROOF/);
  assert.match(selfHosted, /Remove-Item Env:EDITFLOW_M3_NULL_RIG_P4_PROOF -ErrorAction SilentlyContinue/);
  assert.doesNotMatch(selfHosted, /EDITFLOW_M3_NULL_RIG_P5_PROOF=1/);
});

test("null-rig P5 workflow is isolated on its control branch and retains transfer evidence", async () => {
  const source = await readFile(workflowPath, "utf8");

  assert.match(source, /ae-test\/m3-null-rig-p5-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-null-rig-p5\.txt/);
  assert.match(source, /run-m3-null-rig-p5-self-hosted\.ps1/);
  assert.match(source, /m3-null-rig-p5-proof-/);
  assert.match(source, /proofs\/artifacts\/m3-null-rig-p5-transfer/);
  assert.match(source, /runs-on: \[self-hosted, Windows, editflow-ae\]/);
});
