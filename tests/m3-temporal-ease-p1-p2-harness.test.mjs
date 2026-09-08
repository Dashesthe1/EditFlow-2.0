import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const cliPath = "apps/desktop-host/src/m3-temporal-ease-p1-p2-cli.ts";
const wrapperPath = "scripts/windows/run-m3-temporal-ease-p1-p2.ps1";
const selfHostedPath = "scripts/windows/run-m3-temporal-ease-self-hosted.ps1";
const diagnosticBootstrapPath = "scripts/windows/open-editflow-temporal-ease-bridge.jsx";
const workflowPath = ".github/workflows/m3-temporal-ease-real-ae-p1-p2.yml";
const diagnosticWorkflowPath = ".github/workflows/m3-temporal-ease-host-bootstrap-diagnostic.yml";

test("temporal-ease P1/P2 CLI uses protocol 1.8 with accepted 1.7 precondition setup and 1.1 disposable fixtures", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18/);
  assert.match(source, /AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17/);
  assert.match(source, /AE_ADAPTER_PROTOCOL_VERSION_V11/);
  assert.match(source, /AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18,\s+AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17,\s+AE_ADAPTER_PROTOCOL_VERSION_V11/);
  assert.match(source, /"property\.set_keyframes"/);
  assert.match(source, /"ADBE Transform Group", "ADBE Opacity"/);
  assert.match(source, /"ADBE Transform Group", "ADBE Scale"/);
  assert.match(source, /const keyIndex = 2/);
  assert.match(source, /const keyTime = 0\.5/);
  assert.match(source, /cleanupComp\(targetStable\)/);
  assert.match(source, /cleanupComp\(sourceStable\)/);
  assert.match(source, /cleanup_fingerprint_restored/);
  assert.match(source, /cleanup_item_count_restored/);
  assert.doesNotMatch(source, /project\.save|project\.open/);
});

test("P1 proves deterministic temporal-ease rejection without mutation across target, range, cardinality, precondition, and revision failures", async () => {
  const source = await readFile(cliPath, "utf8");
  for (const code of [
    "KEY_INDEX_OUT_OF_RANGE",
    "PROPERTY_PATH_NOT_FOUND",
    "TEMPORAL_EASE_REQUIRES_BEZIER_INTERPOLATION",
    "TEMPORAL_EASE_CARDINALITY_MISMATCH",
    "KEYFRAME_EASE_INFLUENCE_INVALID",
    "TEMPORAL_EASE_REQUIRES_MANUAL_BEZIER",
    "HOST_REVISION_CONFLICT",
  ]) {
    assert.match(source, new RegExp(code));
  }
  assert.match(source, /proveRejectedWithoutMutation/);
  assert.match(source, /projectFingerprint === before\.observed\.projectFingerprint/);
  assert.match(source, /after\.hostRevision === before\.hostRevision/);
  assert.match(source, /influence: 0/);
  assert.match(source, /\(hostRevision \?\? 0\) \+ 1000/);
});

test("P2 proves exact speed/influence on scalar Opacity and the live three-handle Scale surface including cardinality and no-op", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /const scalarEase/);
  assert.match(source, /speed: 40, influence: 28\.5/);
  assert.match(source, /speed: 120, influence: 72\.25/);
  assert.match(source, /const scaleEase/);
  assert.match(source, /speed: 20, influence: 31\.25/);
  assert.match(source, /speed: 35, influence: 44\.5/);
  assert.match(source, /speed: 50, influence: 57\.75/);
  assert.match(source, /speed: 90, influence: 68\.75/);
  assert.match(source, /speed: 60, influence: 52\.5/);
  assert.match(source, /speed: 45, influence: 39\.25/);
  assert.match(source, /proveEase\("opacity_scalar", opacityPath, scalarEase, 1\)/);
  assert.match(source, /proveEase\("scale_twod", scalePath, scaleEase, 3\)/);
  assert.match(source, /p2_scalar_exact_noop/);
  assert.match(source, /p2_scalar_noop_revision_unchanged/);
  assert.match(source, /interpolationIsManualBezier/);
  assert.match(source, /easeStateMatches/);
  assert.match(source, /three KeyframeEase handles exposed by the live AE Scale key surface/);
  assert.doesNotMatch(source, /setSpatialTangentsAtKey|setRovingAtKey/);
});

test("P1/P2 wrapper fails closed on overclaim, missing exact evidence, or incomplete cleanup", async () => {
  const source = await readFile(wrapperPath, "utf8");
  assert.match(source, /M3 temporal-ease P1\/P2 real-AE proof/);
  assert.match(source, /P1_validation_rejection/);
  assert.match(source, /P2_structural_readback/);
  assert.match(source, /P3_visual_proof/);
  assert.match(source, /P4_failure_injection_rollback/);
  assert.match(source, /P5_save_reopen_reconnect_transfer/);
  assert.match(source, /p1_bad_cardinality_rejected/);
  assert.match(source, /p1_bad_influence_rejected/);
  assert.match(source, /p2_opacity_scalar_readback_exact/);
  assert.match(source, /p2_scale_twod_readback_exact/);
  assert.match(source, /live three-handle Scale temporal-ease surface/);
  assert.match(source, /cleanup_fingerprint_restored/);
  assert.match(source, /cleanup_item_count_restored/);
  assert.match(source, /build:test-runtime/);
  assert.doesNotMatch(source, /AfterFX\.exe.*-r/);
});

test("self-hosted temporal-ease runner inherits the accepted isolated AE lifecycle while keeping v18 host preflight diagnostic-only", async () => {
  const source = await readFile(selfHostedPath, "utf8");
  assert.match(source, /run-m3-temporal-interpolation-self-hosted\.ps1/);
  assert.match(source, /run-m3-temporal-ease-p1-p2\.ps1/);
  assert.match(source, /authenticated protocol 1\.8 registration/);
  assert.match(source, /production-equivalent CEP bootstrap of protocol 1\.8/);
  assert.match(source, /\[switch\]\$PreflightHostLoader/);
  assert.match(source, /open-editflow-temporal-ease-bridge\.jsx/);
  assert.match(source, /diagnostic-only, not acceptance evidence/);
  assert.match(source, /CEP12-AEFT\*\.log/);
  assert.match(source, /CEPHtmlEngine12-AEFT-\*\.log/);
  assert.match(source, /LogLevel registry readback before AE launch/);
  assert.match(source, /Copy-CepFailureDiagnostics/);
});

test("protocol 1.8 bootstrap diagnostic records exact host-loader state before opening the normal panel command", async () => {
  const source = await readFile(diagnosticBootstrapPath, "utf8");
  assert.match(source, /editflow_host_current_v18\.jsx/);
  assert.match(source, /HOST_STATE_BEFORE/);
  assert.match(source, /HOST_LOAD_RETURNED/);
  assert.match(source, /HOST_LOAD_ERROR/);
  assert.match(source, /EditFlow2_HOST_PROTOCOL_18/);
  assert.match(source, /EditFlow2_M3_TEMPORAL_EASE_LOAD_ERROR/);
  assert.match(source, /EditFlow 2\.0 Bridge/);
  assert.match(source, /EXECUTE_COMMAND_SENT/);
  assert.doesNotMatch(source, /setTemporalEaseAtKey|setValueAtTime|project\.save/);
  assert.doesNotThrow(() => new vm.Script(source, { filename: diagnosticBootstrapPath }));
});

test("real-AE temporal-ease P1/P2 workflow is isolated to the Windows AE runner and dedicated control branch/artifact namespace", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /runs-on: \[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /ae-test\/m3-temporal-ease-p1-p2-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-temporal-ease-p1-p2\.txt/);
  assert.match(source, /run-m3-temporal-ease-self-hosted\.ps1/);
  assert.match(source, /proofs\/artifacts\/m3-temporal-ease-p1-p2\//);
  assert.match(source, /if: always\(\)/);
  assert.match(source, /timeout-minutes: 10/);
});

test("host-bootstrap diagnostic workflow is isolated from the acceptance control branch and requires explicit preflight mode", async () => {
  const source = await readFile(diagnosticWorkflowPath, "utf8");
  assert.match(source, /ae-test\/m3-temporal-ease-host-diagnostic-control/);
  assert.match(source, /m3-temporal-ease-host-diagnostic\.txt/);
  assert.match(source, /runs-on: \[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /run-m3-temporal-ease-self-hosted\.ps1/);
  assert.match(source, /-PreflightHostLoader/);
  assert.match(source, /if: always\(\)/);
  assert.match(source, /m3-temporal-ease-host-diagnostic-/);
});
