import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/m3-spatial-graph-p1-p2-cli.ts";
const brokerPath = "apps/desktop-host/src/loopback-cep.ts";
const acceptancePath = "scripts/windows/run-m3-spatial-graph-p1-p2.ps1";
const selfHostedPath = "scripts/windows/run-m3-spatial-graph-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-spatial-graph-real-ae-p1-p2.yml";

test("spatial-graph P1/P2 CLI negotiates 1.9 while reusing accepted 1.5 and 1.1 fixture routes", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19/);
  assert.match(source, /AE_NULL_RIG_PROTOCOL_VERSION_V15/);
  assert.match(source, /AE_ADAPTER_PROTOCOL_VERSION_V11/);
  assert.doesNotMatch(source, /AE_LAYER_CONTROLS_PROTOCOL_VERSION_V16/);
  assert.match(source, /supportedProtocolVersions:\s*\[\s*AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19,\s*AE_NULL_RIG_PROTOCOL_VERSION_V15,\s*AE_ADAPTER_PROTOCOL_VERSION_V11/);
  assert.match(source, /panel\.protocolVersion === AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19/);
  assert.match(source, /panel_supports_v11_v15_v19/);
  assert.match(source, /rig\.null\.create/);
  assert.match(source, /"effect\.add"/);
  assert.match(source, /matchName: "ADBE Point Control"/);
  assert.match(source, /"ADBE Effect Parade", "ADBE Point Control", "ADBE Point Control-0001"/);
  assert.match(source, /threeDLayer:\s*true/);
  assert.match(source, /"property\.set_keyframes"/);
  assert.match(source, /"ADBE Transform Group", "ADBE Position"/);
  assert.match(source, /"ADBE Transform Group", "ADBE Opacity"/);
  assert.match(source, /propertyPath: point2dPath/);
  assert.match(source, /\{ time: 0, value: \[80, 280\] \}/);
  assert.match(source, /\{ time: interiorTime, value: \[320, 85, 140\] \}/);
  assert.match(source, /\{ time: interiorTime, value: 60 \}/);
});

test("authenticated loopback broker compiles protocol 1.9 without making it the default runtime", async () => {
  const source = await readFile(brokerPath, "utf8");
  assert.match(source, /AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19/);
  assert.match(source, /AeSpatialGraphTransportV19/);
  assert.match(source, /AeSpatialGraphRequestV19/);
  assert.match(source, /AeSpatialGraphResponseV19/);
  assert.match(source, /COMPILED_PROTOCOLS = \[(?:AE_POINT_TRACKING_PROTOCOL_VERSION_V21, )?(?:AE_MARKER_MOTION_PROTOCOL_VERSION_V20, )?AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19, AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18/);
  assert.match(source, /supportedProtocolVersions: normalizeBrokerProtocols/);
  assert.match(source, /const requested = input \?\? \[AE_ADAPTER_PROTOCOL_VERSION_V11\]/);
  assert.match(source, /dispatch\(request: AeSpatialGraphRequestV19\): Promise<AeSpatialGraphResponseV19>/);
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
  assert.match(source, /propertyPath: opacityPath/);
  assert.match(source, /targetPayload\(layer2dStable, interiorKey, point2dPath\)/);
  assert.match(source, /targetPayload\(layer2dStable, 1, point2dPath\)/);
  assert.match(source, /proveRejectedWithoutMutation/);
  assert.match(source, /projectFingerprint === before\.observed\.projectFingerprint/);
  assert.match(source, /after\.hostRevision === before\.hostRevision/);
  assert.match(source, /observedStateEqual\(spatialBefore, spatialAfter\)/);
  assert.match(source, /beforeStale\.hostRevision \+ 1000/);
});

test("P2 proves real TwoD Point Control and ThreeD Position spatial tangents, roving, Auto-Bezier, and idempotency", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /fixture_2d_point_control_added/);
  assert.match(source, /p2_fixture_2d_spatial/);
  assert.match(source, /p2_fixture_3d_spatial/);
  assert.match(source, /initial2d = await readSpatial\(layer2dStable, point2dPath\)/);
  assert.match(source, /initial3d = await readSpatial\(layer3dStable, positionPath\)/);
  assert.match(source, /inTangent: \[-42\.5, 18\.25\]/);
  assert.match(source, /outTangent: \[63\.75, -21\.5\]/);
  assert.match(source, /inTangent: \[-31\.5, 16\.25, 9\.75\]/);
  assert.match(source, /outTangent: \[58\.5, -27\.25, 22\.5\]/);
  assert.match(source, /proveManual\("2d_manual", layer2dStable, point2dPath, manual2d, 2\)/);
  assert.match(source, /proveManual\("3d_manual", layer3dStable, positionPath, manual3d, 3\)/);
  assert.match(source, /roving2d/);
  assert.match(source, /targetPayload\(layer2dStable, interiorKey, point2dPath\)/);
  assert.match(source, /p2_interior_roving_readback/);
  assert.match(source, /mode: "AUTO_BEZIER"/);
  assert.match(source, /p2_auto_3d_readback_host_shaped/);
  assert.match(source, /vectorIsFiniteDimension/);
  assert.match(source, /p2_auto_3d_host_tangents_stable_on_noop/);
  assert.match(source, /repeat\.outcome === "NO_OP"/);
  assert.match(source, /point2dPath,/);
  assert.match(source, /P3_visual_proof:\s*false/);
  assert.match(source, /P4_failure_injection_rollback:\s*false/);
  assert.match(source, /P5_save_reopen_reconnect_transfer:\s*false/);
});

test("P1/P2 cleanup removes managed nulls through 1.5 before removing the temporary comp", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /const cleanupRig = async/);
  assert.match(source, /dispatchV15\("rig\.null\.remove"/);
  const remove3d = source.indexOf("await cleanupRig(layer3dStable, layer3dCreated);");
  const remove2d = source.indexOf("await cleanupRig(layer2dStable, layer2dCreated);");
  const removeComp = source.indexOf("await cleanupComp(targetStable);");
  assert.ok(remove3d >= 0 && remove2d > remove3d && removeComp > remove2d);
  assert.match(source, /cleanup_target_removed/);
  assert.match(source, /cleanup_item_count_restored/);
  assert.match(source, /cleanup_fingerprint_restored/);
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
  assert.match(source, /var KNOWN_PROTOCOLS = \["1\.9\.0"/);
  assert.match(source, /EditFlow2_HOST_PROTOCOL_19/);
  assert.match(source, /supportedProtocolVersions = @\("1\.9\.0"/);
  assert.match(source, /normal installer defaults remain accepted protocol 1\.8/);
  assert.match(source, /HKCU:\\Software\\Adobe\\CSXS\.12/);
  assert.match(source, /LogLevel/);
  assert.match(source, /CEP12-AEFT\*\.log/);
  assert.match(source, /CEPHtmlEngine12-AEFT-/);
  assert.match(source, /Remove-Item \$TempPath -Force -ErrorAction SilentlyContinue/);
});

test("self-hosted runner retries only a proven zero-command CEP registration timeout once from zero AE", async () => {
  const source = await readFile(selfHostedPath, "utf8");
  assert.match(source, /\$MaxPanelRegistrationAttempts = 2/);
  assert.match(source, /function Test-RetryablePanelRegistrationFailure/);
  assert.match(source, /CEP_PANEL_REGISTRATION_TIMEOUT/);
  assert.match(source, /\$null -eq \$Result\.panel/);
  assert.match(source, /\$null -eq \$Result\.environment/);
  assert.match(source, /\$Responses\.Count -eq 0/);
  assert.match(source, /\$Evidence\.Count -eq 0/);
  assert.match(source, /\$CheckProperties\.Count -eq 0/);
  assert.match(source, /Get-Process -Name "AfterFX"/);
  assert.match(source, /\$RemainingAfterFx\.Count -ne 0/);
  assert.match(source, /panel-registration-retry-attempt-/);
  assert.match(source, /Retain-PanelRetryEvidence -Attempt \$Attempt/);
  assert.match(source, /retrying one fresh isolated AE launch from the verified zero-process baseline/);
  assert.doesNotMatch(source, /MaxPanelRegistrationAttempts = [3-9]/);
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
