import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_spatial_graph.jsx";
const cliPath = "apps/desktop-host/src/m3-spatial-graph-p3-p4-cli.ts";
const acceptancePath = "scripts/windows/run-m3-spatial-graph-p3-p4.ps1";
const previewInstallerPath = "scripts/windows/install-editflow-cep-v19-preview.ps1";
const selfHostedPath = "scripts/windows/run-m3-spatial-graph-p3-p4-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-spatial-graph-real-ae-p3-p4.yml";

test("spatial host exposes P4 failure injection only behind exact proof profile and process flag", async () => {
  const source = await readFile(hostPath, "utf8");
  assert.match(source, /BUILD = "0\.4\.0-dev\.9\.1"/);
  assert.match(source, /request\.readbackProfile === "M3_SPATIAL_GRAPH_P4_FAILURE_INJECTION"/);
  assert.match(source, /\$\.getenv\("EDITFLOW_M3_SPATIAL_GRAPH_P4_PROOF"\) === "1"/);
  assert.match(source, /M3_SPATIAL_GRAPH_P4_INDUCED_FAILURE/);
  const applyIndex = source.indexOf("applyRequestedState(property, payload.keyIndex, payload.state);");
  const verifyIndex = source.indexOf("SPATIAL_GRAPH_READBACK_MISMATCH");
  const injectIndex = source.indexOf("M3_SPATIAL_GRAPH_P4_INDUCED_FAILURE");
  const restoreIndex = source.indexOf("restoreObservedState(property, payload.keyIndex, before);");
  assert.ok(applyIndex >= 0 && verifyIndex > applyIndex && injectIndex > verifyIndex && restoreIndex > injectIndex);
  assert.match(source, /SPATIAL_GRAPH_ROLLBACK_READBACK_MISMATCH/);
  assert.match(source, /exact prior spatial state was restored by structural rollback/);
});

test("P3/P4 CLI requires the accepted P1/P2 artifact and keeps visual acceptance independent", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /M3_SPATIAL_GRAPH_P1_P2_REAL_AE/);
  assert.match(source, /status: "PASS"/);
  assert.match(source, /P1_validation_rejection: true/);
  assert.match(source, /P2_structural_readback: true/);
  assert.match(source, /acceptedP1P2Sha256/);
  assert.match(source, /p3-straight-baseline\.avi/);
  assert.match(source, /p3-curved-spatial-path\.avi/);
  assert.match(source, /p3-restored-straight-baseline\.avi/);
  assert.match(source, /p4-post-rollback-straight-baseline\.avi/);
  assert.match(source, /P3_visual_artifact_emitted/);
  assert.match(source, /P3_visual_proof: false/);
  assert.match(source, /visualReviewRequired: true/);
  assert.match(source, /sampleTimesSeconds: \[0, 0\.25, 0\.5, 0\.75, 1\]/);
});

test("P3 uses identical Position keys with zero versus strong manual spatial tangents", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /propertyPath = \["ADBE Transform Group", "ADBE Position"\]/);
  assert.match(source, /\{ time: 0, value: \[96, 180\] \}/);
  assert.match(source, /\{ time: 0\.5, value: \[320, 180\] \}/);
  assert.match(source, /\{ time: 1, value: \[544, 180\] \}/);
  assert.match(source, /inTangent: \[0, 0, 0\]/);
  assert.match(source, /outTangent: \[0, 0, 0\]/);
  assert.match(source, /inTangent: \[-150, -220, 0\]/);
  assert.match(source, /outTangent: \[150, 220, 0\]/);
  assert.match(source, /setSpatialExact\(1, zeroState\)/);
  assert.match(source, /setSpatialExact\(2, zeroState\)/);
  assert.match(source, /setSpatialExact\(3, zeroState\)/);
  assert.match(source, /setSpatialExact\(2, curvedState\)/);
  assert.match(source, /setSpatialExact\(2, zeroState\)/);
});

test("P4 proves post-write failure response, exact structural state, fingerprint, and recovery render", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /M3_SPATIAL_GRAPH_P4_FAILURE_INJECTION/);
  assert.match(source, /M3_SPATIAL_GRAPH_P4_INDUCED_FAILURE/);
  assert.match(source, /category === "PROOF_INJECTION"/);
  assert.match(source, /p4_response_readback_restored/);
  assert.match(source, /p4_fingerprint_restored/);
  assert.match(source, /p4_item_count_unchanged/);
  assert.match(source, /p4_structural_state_restored/);
  assert.match(source, /spatialStatesEqual\(afterObserved, baselineObserved\)/);
  assert.match(source, /p4_recovery_visual_artifact_emitted/);
  assert.match(source, /P4_failure_injection_rollback: checks\.p4 === true/);
  assert.match(source, /P5_save_reopen_reconnect_transfer: false/);
});

test("P3/P4 cleanup requires exact blank-project fingerprint and item-count restoration", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /baseline\.project\.itemCount === 0 && baseline\.project\.filePath === null/);
  assert.match(source, /restoreBaselineThroughUndo/);
  assert.match(source, /for \(let attempt = 0; attempt < 60; attempt \+= 1\)/);
  assert.match(source, /cleanup_temp_items_absent/);
  assert.match(source, /cleanup_item_count_restored/);
  assert.match(source, /cleanup_fingerprint_restored/);
});

test("protocol 1.9 preview installer is isolated and does not alter accepted repository installer defaults", async () => {
  const source = await readFile(previewInstallerPath, "utf8");
  assert.match(source, /install-editflow-cep\.ps1/);
  assert.match(source, /editflow_host_m3_spatial_graph\.jsx/);
  assert.match(source, /editflow_host_current_v19\.jsx/);
  assert.match(source, /var KNOWN_PROTOCOLS = \["1\.9\.0"/);
  assert.match(source, /editflow_host_current_v18\.jsx/);
  assert.match(source, /EditFlow2_HOST_PROTOCOL_18/);
  assert.match(source, /EditFlow2_HOST_PROTOCOL_19/);
  assert.match(source, /supportedProtocolVersions = @\("1\.9\.0"/);
  assert.match(source, /Repository\/default installer remains accepted protocol 1\.8/);
});

test("self-hosted P3/P4 runner derives from accepted temporal lifecycle and swaps only proof-specific surfaces", async () => {
  const source = await readFile(selfHostedPath, "utf8");
  assert.match(source, /run-m3-temporal-ease-p3-p4-self-hosted\.ps1/);
  assert.match(source, /run-m3-spatial-graph-p3-p4\.ps1/);
  assert.match(source, /m3-spatial-graph-p3-p4/);
  assert.match(source, /EDITFLOW_M3_SPATIAL_GRAPH_P4_PROOF/);
  assert.match(source, /authenticated protocol 1\.9 preview registration/);
  assert.match(source, /install-editflow-cep-v19-preview\.ps1/);
  assert.match(source, /AcceptedP1P2Path/);
  assert.match(source, /Remove-Item \$TempPath -Force -ErrorAction SilentlyContinue/);
});

test("real-AE P3/P4 workflow downloads the accepted P1/P2 artifact and retains review media", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /ae-test\/m3-spatial-graph-p3-p4-control/);
  assert.match(source, /accepted_p1_p2_run_id/);
  assert.match(source, /34182897797/);
  assert.match(source, /actions\/download-artifact@v4/);
  assert.match(source, /m3-spatial-graph-p1-p2-proof-/);
  assert.match(source, /run-m3-spatial-graph-p3-p4-self-hosted\.ps1/);
  assert.match(source, /AcceptedP1P2Path/);
  assert.match(source, /runs-on:\s*\[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /timeout-minutes:\s*15/);
  assert.match(source, /proofs\/artifacts\/m3-spatial-graph-p3-p4\//);
  assert.match(source, /if:\s*always\(\)/);
  assert.doesNotMatch(source, /pull_request:/);
});
