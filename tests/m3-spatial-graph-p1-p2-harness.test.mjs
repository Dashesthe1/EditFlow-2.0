import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/m3-spatial-graph-p1-p2-cli.ts";
const acceptancePath = "scripts/windows/run-m3-spatial-graph-p1-p2.ps1";
const selfHostedPath = "scripts/windows/run-m3-spatial-graph-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-spatial-graph-real-ae-p1-p2.yml";

test("spatial-graph P1/P2 CLI negotiates 1.9 while reusing accepted 1.5 null and 1.1 fixture routes", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19/);
  assert.match(source, /AE_NULL_RIG_PROTOCOL_VERSION_V15/);
  assert.match(source, /AE_ADAPTER_PROTOCOL_VERSION_V11/);
  assert.match(source, /supportedProtocolVersions:\s*\[\s*AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19,\s*AE_NULL_RIG_PROTOCOL_VERSION_V15,\s*AE_ADAPTER_PROTOCOL_VERSION_V11/);
  assert.match(source, /panel\.protocolVersion === AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19/);
  assert.match(source, /rig\.null\.create/);
  assert.match(source, /threeDLayer:\s*false/);
  assert.match(source, /threeDLayer:\s*true/);
  assert.match(source, /"property\.set_keyframes"/);
  assert.match(source, /"ADBE Transform Group", "ADBE Position"/);
  assert.match(source, /\{ time: 0, value: \[80, 280\] \}/);
  assert.match(source, /\{ time: interiorTime, value: \[320, 85, 140\] \}/);
});

test("P1 proves documented spatial preconditions reject without revision, fingerprint, or spatial-state mutation", async () => {
  const source = await readFile(cliPath, "utf8");
  for (const code of [
    "SPATIAL_PROPERTY_REQUIRED",
    "SPATIAL_TANGENT_DIMENSION_MISMATCH",
    "ROVING_ENDPOINT_FORBIDDEN",
    "AUTO_BEZIER_TANGENTS_FORBIDDEN",
    "HOST_REVISION_CONFLICT",
  ]) {
    assert.match(source, new RegExp(code));
  }
  assert.match(source, /proveRejectedWithoutMutation/);
  assert.match(source, /projectFingerprint === before\.observed\.projectFingerprint/);
  assert.match(source, /after\.hostRevision === before\.hostRevision/);
  assert.match(source, /observedStateEqual\(spatialBefore, spatialAfter\)/);
  assert.match(source, /beforeStale\.hostRevision \+ 1000/);
});

test("P2 proves exact manual 2D/3D tangents, interior roving, host-owned Auto-Bezier, and idempotency", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /inTangent: \[-42\.5, 18\.25\]/);
  assert.match(source, /outTangent: \[63\.75, -21\.5\]/);
  assert.match(source, /inTangent: \[-31\.5, 16\.25, 9\.75\]/);
  assert.match(source, /outTangent: \[58\.5, -27\.25, 22\.5\]/);
  assert.match(source, /proveManual\("2d_manual", layer2dStable, manual2d, 2\)/);
  assert.match(source, /proveManual\("3d_manual", layer3dStable, manual3d, 3\)/);
  assert.match(source, /roving2d/);
  assert.match(source, /p2_interior_roving_readback/);
  assert.match(source, /mode: "AUTO_BEZIER"/);
  assert.match(source, /p2_auto_3d_readback_host_shaped/);
  assert.match(source, /vectorIsFiniteDimension/);
  assert.match(source, /p2_auto_3d_host_tangents_stable_on_noop/);
  assert.match(source, /repeat\.outcome === "NO_OP"/);
  assert.match(source, /cleanup_fingerprint_restored/);
  assert.match(source, /P3_visual_proof:\s*false/);
  assert.match(source, /P4_failure_injection_rollback:\s*false/);
  assert.match(source, /P5_save_reopen_reconnect_transfer:\s*false/);
});

test("spatial-graph acceptance wrapper fails closed on incomplete evidence or maturity overclaim", async () => {
  const source = await readFile(acceptancePath, "utf8");
  assert.match(source, /M3 spatial Graph Editor real-AE P1\/P2 proof/);
  assert.match(source, /p1_non_spatial_rejected/);
  assert.match(source, /p1_bad_2d_dimension_rejected/);
  assert.match(source, /p1_roving_endpoint_rejected/);
  assert.match(source, /p1_auto_manual_tangent_forbidden_rejected/);
  assert.match(source, /p2_2d_manual_readback_exact/);
  assert.match(source, /p2_3d_manual_readback_exact/);
  assert.match(source, /p2_interior_roving_readback/);
  assert.match(source, /p2_auto_3d_readback_host_shaped/);
  assert.match(source, /P3_visual_proof/);
  assert.match(source, /P4_failure_injection_rollback/);
  assert.match(source, /P5_save_reopen_reconnect_transfer/);
  assert.match(source, /cleanup_fingerprint_restored/);
  assert.match(source, /build:test-runtime/);
});

test("self-hosted runner makes protocol 1.9 an isolated test-only install and retains CEP failure diagnostics", async () => {
  const source = await readFile(selfHostedPath, "utf8");
  assert.match(source, /run-m3-mask-self-hosted\.ps1/);
  assert.match(source, /run-m3-spatial-graph-p1-p2\.ps1/);
  assert.match(source, /editflow_host_m3_spatial_graph\.jsx/);
  assert.match(source, /editflow_host_current_v19\.jsx/);
  assert.match(source, /var KNOWN_PROTOCOLS = \[\\"1\.9\.0\\"/);
  assert.match(source, /EditFlow2_HOST_PROTOCOL_19/);
  assert.match(source, /supportedProtocolVersions = @\("1\.9\.0"/);
  assert.match(source, /normal installer defaults remain accepted protocol 1\.8/);
  assert.match(source, /HKCU:\\Software\\Adobe\\CSXS\.12/);
  assert.match(source, /LogLevel/);
  assert.match(source, /CEP12-AEFT\*\.log/);
  assert.match(source, /CEPHtmlEngine12-AEFT-/);
  assert.match(source, /Remove-Item \$TempPath -Force -ErrorAction SilentlyContinue/);
});

test("real-AE spatial-graph workflow is bounded, self-hosted, explicit-triggered, and artifact-producing", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /ae-test\/m3-spatial-graph-p1-p2-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-spatial-graph-p1-p2\.txt/);
  assert.match(source, /runs-on:\s*\[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /timeout-minutes:\s*10/);
  assert.match(source, /shell:\s*cmd/);
  assert.match(source, /run-m3-spatial-graph-self-hosted\.ps1/);
  assert.match(source, /proofs\/artifacts\/m3-spatial-graph-p1-p2\//);
  assert.match(source, /if:\s*always\(\)/);
  assert.doesNotMatch(source, /pull_request:/);
});
