import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/m3-temporal-interpolation-p1-p2-cli.ts";
const wrapperPath = "scripts/windows/run-m3-temporal-interpolation-p1-p2.ps1";
const selfHostedPath = "scripts/windows/run-m3-temporal-interpolation-self-hosted.ps1";
const bootstrapPath = "scripts/windows/open-editflow-temporal-bridge.jsx";
const workflowPath = ".github/workflows/m3-temporal-interpolation-real-ae-p1-p2.yml";

test("M3 temporal-interpolation P1/P2 CLI is bounded to a disposable Opacity keyframe and protocols 1.7 plus 1.1 setup", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17/);
  assert.match(source, /AE_ADAPTER_PROTOCOL_VERSION_V11/);
  assert.match(source, /supportedProtocolVersions: \[AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17, AE_ADAPTER_PROTOCOL_VERSION_V11\]/);
  assert.match(source, /"property\.set_keyframes"/);
  assert.match(source, /"ADBE Transform Group", "ADBE Opacity"/);
  assert.match(source, /\{ time: 0\.5, value: 90 \}/);
  assert.match(source, /const keyIndex = 2/);
  assert.match(source, /cleanupComp\(targetStable\)/);
  assert.match(source, /cleanupComp\(sourceStable\)/);
  assert.match(source, /cleanup_fingerprint_restored/);
  assert.match(source, /cleanup_item_count_restored/);
  assert.doesNotMatch(source, /project\.save|project\.open/);
});

test("P1 proves deterministic pre-mutation rejection for bad key, bad path, invalid Bezier flags, and stale revision", async () => {
  const source = await readFile(cliPath, "utf8");
  for (const code of [
    "KEY_INDEX_OUT_OF_RANGE",
    "PROPERTY_PATH_NOT_FOUND",
    "TEMPORAL_BEZIER_FLAG_REQUIRES_BEZIER",
    "HOST_REVISION_CONFLICT",
  ]) {
    assert.match(source, new RegExp(code));
  }
  assert.match(source, /proveRejectedWithoutMutation/);
  assert.match(source, /projectFingerprint === before\.observed\.projectFingerprint/);
  assert.match(source, /after\.hostRevision === before\.hostRevision/);
});

test("P2 exercises independent directions, all declared interpolation kinds, continuity, auto-Bezier, and exact no-op", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /inType: "BEZIER",\s+outType: "LINEAR"/);
  assert.match(source, /inType: "BEZIER",\s+outType: "BEZIER",\s+temporalContinuous: true,\s+temporalAutoBezier: false/);
  assert.match(source, /inType: "BEZIER",\s+outType: "BEZIER",\s+temporalContinuous: true,\s+temporalAutoBezier: true/);
  assert.match(source, /inType: "HOLD",\s+outType: "HOLD"/);
  assert.match(source, /inType: "LINEAR",\s+outType: "LINEAR"/);
  assert.match(source, /p2_opacity_supports_linear/);
  assert.match(source, /p2_opacity_supports_bezier/);
  assert.match(source, /p2_opacity_supports_hold/);
  assert.match(source, /p2_exact_noop/);
  assert.match(source, /p2_noop_revision_unchanged/);
  assert.doesNotMatch(source, /setTemporalEaseAtKey|KeyframeEase|setSpatialTangentsAtKey|setRovingAtKey/);
});

test("P1/P2 acceptance wrapper fails closed on proof overclaim, missing exact state evidence, or incomplete cleanup", async () => {
  const source = await readFile(wrapperPath, "utf8");
  assert.match(source, /M3 temporal-interpolation P1\/P2 real-AE proof/);
  assert.match(source, /P1_validation_rejection/);
  assert.match(source, /P2_structural_readback/);
  assert.match(source, /P3_visual_proof/);
  assert.match(source, /P4_failure_injection_rollback/);
  assert.match(source, /P5_save_reopen_reconnect_transfer/);
  assert.match(source, /p2_mixed_bezier_linear_readback_exact/);
  assert.match(source, /p2_bezier_auto_readback_exact/);
  assert.match(source, /p2_exact_noop/);
  assert.match(source, /cleanup_fingerprint_restored/);
  assert.match(source, /cleanup_item_count_restored/);
  assert.match(source, /build:test-runtime/);
  assert.doesNotMatch(source, /AfterFX\.exe.*-r/);
});

test("temporal panel bootstrap preflights the installed v17 loader inside AE and records exact host state before opening CEP", async () => {
  const source = await readFile(bootstrapPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /Folder\.userData\.fsName/);
  assert.match(source, /editflow_host_current_v17\.jsx/);
  assert.match(source, /\$\.evalFile\(installedHost\)/);
  assert.match(source, /HOST_STATE_BEFORE/);
  assert.match(source, /HOST_LOAD_RETURNED/);
  assert.match(source, /HOST_LOAD_ERROR/);
  assert.match(source, /EditFlow2_HOST_PROTOCOL_17/);
  assert.match(source, /EditFlow2-self-hosted-panel-bootstrap\.log/);
  assert.match(source, /app\.findMenuCommandId\(menuName\)/);
  assert.match(source, /app\.executeCommand\(commandId\)/);
  assert.doesNotMatch(source, /\beval\s*\(/);
});

test("self-hosted temporal runner reuses accepted M3 startup machinery, preflights v17, and retains documented CEP failure diagnostics", async () => {
  const source = await readFile(selfHostedPath, "utf8");
  assert.match(source, /run-m3-mask-self-hosted\.ps1/);
  assert.match(source, /run-m3-temporal-interpolation-p1-p2\.ps1/);
  assert.match(source, /open-editflow-temporal-bridge\.jsx/);
  assert.match(source, /authenticated protocol 1\.7 registration/);
  assert.match(source, /CEP_12\.x\/Documentation\/Debugging%20Handbook\.md/);
  assert.match(source, /CEP12-AEFT\*\.log/);
  assert.match(source, /CEPHtmlEngine12-AEFT-\*\.log/);
  assert.match(source, /LogLevel registry readback before AE launch/);
  assert.match(source, /Copy-CepFailureDiagnostics/);
});

test("real-AE temporal P1/P2 workflow is isolated to the Windows AE runner, control branch, and proof artifact namespace", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /runs-on: \[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /ae-test\/m3-temporal-interpolation-p1-p2-control/);
  assert.match(source, /\.github\/ae-test-trigger\/m3-temporal-interpolation-p1-p2\.txt/);
  assert.match(source, /run-m3-temporal-interpolation-self-hosted\.ps1/);
  assert.match(source, /proofs\/artifacts\/m3-temporal-interpolation-p1-p2\//);
  assert.match(source, /if: always\(\)/);
  assert.match(source, /timeout-minutes: 10/);
});
