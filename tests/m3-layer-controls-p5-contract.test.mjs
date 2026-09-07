import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const cliPath = "apps/desktop-host/src/m3-layer-controls-p5-cli.ts";
const reopenPath = "scripts/windows/m3-layer-controls-p5-reopen.jsx";
const cleanupPath = "scripts/windows/m3-layer-controls-p5-cleanup.jsx";
const acceptancePath = "scripts/windows/run-m3-layer-controls-p5.ps1";
const selfHostedPath = "scripts/windows/run-m3-layer-controls-p5-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-layer-controls-real-ae-p5.yml";

test("layer-controls P5 proves save reopen distinct protocol 1.6 reconnect and transferred authority", async () => {
  const source = await readFile(cliPath, "utf8");

  assert.match(source, /AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16/);
  assert.match(source, /AE_LAYER_SWITCH_KEYS_V16/);
  assert.match(source, /buildLayerControlsRequestV16/);
  assert.match(source, /"project\.save"/);
  assert.match(source, /"layer\.switches\.set"/);
  assert.match(source, /"layer\.order\.set"/);
  assert.match(source, /"layer\.controls\.readback"/);
  assert.match(source, /await broker\.stop\(\)/);
  assert.match(source, /await broker\.start\(\)/);
  assert.match(source, /secondPanel\.sessionId !== firstSessionId/);
  assert.match(source, /secondPanel\.protocolVersion === AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16/);
  assert.match(source, /saved_structural_fingerprint_preserved/);
  assert.match(source, /layer_controls_exact_after_reopen_reconnect/);
  assert.match(source, /native_layer_id_persisted/);
  assert.match(source, /post_reconnect_switch_mutation_applied/);
  assert.match(source, /post_reconnect_order_mutation_applied/);
  assert.match(source, /post_reconnect_mutation_readback/);
  assert.match(source, /post_reconnect_untouched_switches_preserved/);
  assert.match(source, /P5_save_reopen_reconnect_transfer: ok/);
});

test("layer-controls P5 saves a distinctive locked switch and stacking-order state across all accepted switch readbacks", async () => {
  const source = await readFile(cliPath, "utf8");

  assert.match(source, /AE_LAYER_SWITCH_KEYS_V16\.every\(\(key\) => initialSupport\[key\] === true\)/);
  assert.match(source, /audioEnabled: false/);
  assert.match(source, /locked: true/);
  assert.match(source, /shy: true/);
  assert.match(source, /quality: "DRAFT"/);
  assert.match(source, /effectsActive: false/);
  assert.match(source, /preserveTransparency: true/);
  assert.match(source, /samplingQuality: "BICUBIC"/);
  assert.match(source, /placement: \{ kind: "END" \}/);
  assert.match(source, /pre_save_locked_order_applied/);
  assert.match(source, /stableJson\(afterReconnectSemantic\) === stableJson\(beforeSaveSemantic\)/);
  assert.match(source, /hostId/);
  assert.match(source, /placement: \{ kind: "BEGINNING" \}/);
  assert.match(source, /P3_P4_merge_commit: "7dc3558b932995dba078030089226b894cf95d85"/);
  assert.match(source, /P3_P4_run: 34159635705/);
});

test("layer-controls P5 fixed reopen and cleanup scripts are proof-gated, v16-aware, fixed-path, and exact-fixture only", async () => {
  const [reopen, cleanup] = await Promise.all([
    readFile(reopenPath, "utf8"),
    readFile(cleanupPath, "utf8"),
  ]);

  assert.match(reopen, /EDITFLOW_M3_LAYER_CONTROLS_P5_PROOF/);
  assert.match(reopen, /m3-layer-controls-p5-transfer\.aep/);
  assert.match(reopen, /M3_LAYER_CONTROLS_P5_REOPEN/);
  assert.match(reopen, /editflow_host_current_v16\.jsx/);
  assert.match(reopen, /EditFlow2_dispatch = undefined/);
  assert.match(reopen, /\$\.evalFile\(hostScript\)/);
  assert.match(reopen, /app\.project\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\)/);
  assert.match(reopen, /app\.open\(projectFile\)/);

  assert.match(cleanup, /EDITFLOW_M3_LAYER_CONTROLS_P5_PROOF/);
  assert.match(cleanup, /M3_LAYER_CONTROLS_P5_/);
  assert.match(cleanup, /app\.project\.numItems !== 3/);
  assert.match(cleanup, /targetComp\.numLayers !== 2/);
  assert.match(cleanup, /_FRONT_LAYER/);
  assert.match(cleanup, /_BACK_LAYER/);
  assert.match(cleanup, /frontLayer\.locked !== false/);
  assert.match(cleanup, /frontLayer\.shy !== false/);
  assert.match(cleanup, /project\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\)/);
  assert.match(cleanup, /app\.newProject\(\)/);

  assert.doesNotThrow(() => new vm.Script(reopen, { filename: reopenPath }));
  assert.doesNotThrow(() => new vm.Script(cleanup, { filename: cleanupPath }));
});

test("layer-controls P5 wrappers reuse accepted machinery, preflight repository state, and isolate proof modes", async () => {
  const [acceptance, selfHosted] = await Promise.all([
    readFile(acceptancePath, "utf8"),
    readFile(selfHostedPath, "utf8"),
  ]);

  assert.match(acceptance, /run-m3-mask-p5\.ps1/);
  assert.match(acceptance, /m3-layer-controls-p5-transfer/);
  assert.match(acceptance, /EDITFLOW_M3_LAYER_CONTROLS_P5_PROOF/);
  assert.match(acceptance, /m3-layer-controls-p5-cli\.js/);
  assert.match(acceptance, /layer_controls_exact_after_reopen_reconnect/);
  assert.match(acceptance, /7dc3558b932995dba078030089226b894cf95d85/);
  assert.match(acceptance, /34159635705/);

  assert.match(selfHosted, /run-m3-layer-controls-p3-p4-self-hosted\.ps1/);
  assert.match(selfHosted, /run-m3-layer-controls-p5\.ps1/);
  assert.match(selfHosted, /npm run check/);
  assert.match(selfHosted, /watch-ae-startup-dialogs\.ps1/);
  assert.match(selfHosted, /PROOF_CLEAN_QUIT_DISPATCH/);
  assert.match(selfHosted, /EDITFLOW_M3_LAYER_CONTROLS_P5_PROOF/);
  assert.match(selfHosted, /EDITFLOW_M3_MASK_P5_PROOF/);
  assert.match(selfHosted, /EDITFLOW_M3_COMPOSITE_P5_PROOF/);
  assert.match(selfHosted, /EDITFLOW_M3_PARENTING_P5_PROOF/);
  assert.match(selfHosted, /EDITFLOW_M3_NULL_RIG_P5_PROOF/);
  assert.doesNotMatch(selfHosted, /EDITFLOW_M3_LAYER_CONTROLS_P5_PROOF=1/);
});

test("layer-controls P5 workflow is isolated on its control branch and retains transfer evidence", async () => {
  const source = await readFile(workflowPath, "utf8");

  assert.match(source, /ae-test\/m3-layer-controls-p5-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-layer-controls-p5\.txt/);
  assert.match(source, /run-m3-layer-controls-p5-self-hosted\.ps1/);
  assert.match(source, /m3-layer-controls-p5-proof-/);
  assert.match(source, /proofs\/artifacts\/m3-layer-controls-p5-transfer/);
  assert.match(source, /runs-on: \[self-hosted, Windows, editflow-ae\]/);
});
