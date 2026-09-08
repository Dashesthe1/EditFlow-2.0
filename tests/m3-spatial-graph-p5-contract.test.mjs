import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const cliPath = "apps/desktop-host/src/m3-spatial-graph-p5-cli.ts";
const reopenPath = "scripts/windows/m3-spatial-graph-p5-reopen.jsx";
const cleanupPath = "scripts/windows/m3-spatial-graph-p5-cleanup.jsx";
const acceptancePath = "scripts/windows/run-m3-spatial-graph-p5.ps1";
const selfHostedPath = "scripts/windows/run-m3-spatial-graph-p5-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-spatial-graph-real-ae-p5.yml";

test("spatial Graph Editor P5 proves save reopen distinct protocol 1.9 reconnect and fresh transferred authority", async () => {
  const source = await readFile(cliPath, "utf8");

  assert.match(source, /AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19/);
  assert.match(source, /buildSpatialGraphRequestV19/);
  assert.match(source, /"project\.save"/);
  assert.match(source, /"property\.spatial_graph\.set"/);
  assert.match(source, /"property\.spatial_graph\.readback"/);
  assert.match(source, /await broker\.stop\(\)/);
  assert.match(source, /await broker\.start\(\)/);
  assert.match(source, /secondPanel\.sessionId !== firstSessionId/);
  assert.match(source, /secondPanel\.protocolVersion === AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19/);
  assert.match(source, /saved_structural_fingerprint_preserved/);
  assert.match(source, /native_layer_id_preserved/);
  assert.match(source, /spatial_exact_after_reopen_reconnect/);
  assert.match(source, /post_reconnect_mutation_applied/);
  assert.match(source, /post_reconnect_mutation_readback/);
  assert.match(source, /P5_save_reopen_reconnect_transfer: ok/);
});

test("spatial Graph Editor P5 transfers distinctive host-owned auto-Bezier state then proves manual tangent mutation", async () => {
  const source = await readFile(cliPath, "utf8");

  assert.match(source, /mode: "AUTO_BEZIER"/);
  assert.match(source, /continuous: true/);
  assert.match(source, /roving: true/);
  assert.match(source, /mode: "MANUAL"/);
  assert.match(source, /inTangent: \[-96, 132, 0\]/);
  assert.match(source, /outTangent: \[156, -84, 0\]/);
  assert.match(source, /continuous: false/);
  assert.match(source, /roving: false/);
  assert.match(source, /const keyIndex = 2/);
  assert.match(source, /savedSpatialKeyTime/);
  assert.match(source, /savedNativeLayerId/);
  assert.match(source, /reopenedNativeLayerId/);
  assert.match(source, /P3_P4_run: 34184591197/);
  assert.match(source, /P3_P4_artifact: 10070526495/);
});

test("spatial Graph Editor P5 fixed reopen and cleanup scripts are proof-gated v19-aware fixed-path exact-fixture only", async () => {
  const [reopen, cleanup] = await Promise.all([
    readFile(reopenPath, "utf8"),
    readFile(cleanupPath, "utf8"),
  ]);

  assert.match(reopen, /EDITFLOW_M3_SPATIAL_GRAPH_P5_PROOF/);
  assert.match(reopen, /m3-spatial-graph-p5-transfer\.aep/);
  assert.match(reopen, /M3_SPATIAL_GRAPH_P5_REOPEN/);
  assert.match(reopen, /editflow_host_current_v19\.jsx/);
  assert.match(reopen, /EditFlow2_dispatch = undefined/);
  assert.match(reopen, /\$\.evalFile\(hostScript\)/);
  assert.match(reopen, /app\.project\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\)/);
  assert.match(reopen, /app\.open\(projectFile\)/);

  assert.match(cleanup, /EDITFLOW_M3_SPATIAL_GRAPH_P5_PROOF/);
  assert.match(cleanup, /M3_SPATIAL_GRAPH_P5_/);
  assert.match(cleanup, /app\.project\.numItems !== 2/);
  assert.match(cleanup, /targetComp\.numLayers !== 1/);
  assert.match(cleanup, /ADBE Position/);
  assert.match(cleanup, /position\.numKeys !== 3/);
  assert.match(cleanup, /keySpatialAutoBezier\(2\) !== false/);
  assert.match(cleanup, /keySpatialContinuous\(2\) !== false/);
  assert.match(cleanup, /keyRoving\(2\) !== false/);
  assert.match(cleanup, /EXPECTED_IN = \[-96, 132, 0\]/);
  assert.match(cleanup, /EXPECTED_OUT = \[156, -84, 0\]/);
  assert.match(cleanup, /project\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\)/);
  assert.match(cleanup, /app\.newProject\(\)/);

  assert.doesNotThrow(() => new vm.Script(reopen, { filename: reopenPath }));
  assert.doesNotThrow(() => new vm.Script(cleanup, { filename: cleanupPath }));
});

test("spatial Graph Editor P5 wrappers reuse accepted transfer launchers and exercise the standard protocol 1.9 installation", async () => {
  const [acceptance, selfHosted] = await Promise.all([
    readFile(acceptancePath, "utf8"),
    readFile(selfHostedPath, "utf8"),
  ]);

  assert.match(acceptance, /run-m3-mask-p5\.ps1/);
  assert.match(acceptance, /m3-spatial-graph-p5-transfer/);
  assert.match(acceptance, /EDITFLOW_M3_SPATIAL_GRAPH_P5_PROOF/);
  assert.match(acceptance, /m3-spatial-graph-p5-cli\.js/);
  assert.match(acceptance, /spatial_exact_after_reopen_reconnect/);
  assert.match(acceptance, /native Layer\.id continuity/);

  assert.match(selfHosted, /run-m3-temporal-interpolation-p5-self-hosted\.ps1/);
  assert.match(selfHosted, /run-m3-spatial-graph-p5\.ps1/);
  assert.match(selfHosted, /EDITFLOW_M3_SPATIAL_GRAPH_P5_PROOF/);
  assert.match(selfHosted, /scripts\\windows\\install-editflow-cep\.ps1/);
  assert.match(selfHosted, /protocol 1\.9/);
  assert.match(selfHosted, /production-path promotion proof/);
  assert.match(selfHosted, /standard EditFlow CEP installer/);
  assert.doesNotMatch(selfHosted, /\.Replace\('scripts\\windows\\install-editflow-cep\.ps1', 'scripts\\windows\\install-editflow-cep-v19-preview\.ps1'\)/);
});

test("spatial Graph Editor P5 workflow is isolated on its control branch and retains transfer evidence", async () => {
  const source = await readFile(workflowPath, "utf8");

  assert.match(source, /ae-test\/m3-spatial-graph-p5-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-spatial-graph-p5\.txt/);
  assert.match(source, /run-m3-spatial-graph-p5-self-hosted\.ps1/);
  assert.match(source, /m3-spatial-graph-p5-proof-/);
  assert.match(source, /proofs\/artifacts\/m3-spatial-graph-p5-transfer/);
  assert.match(source, /runs-on: \[self-hosted, Windows, editflow-ae\]/);
});
