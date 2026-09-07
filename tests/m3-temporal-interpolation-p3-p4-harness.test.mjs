import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_temporal_interpolation.jsx";
const cliPath = "apps/desktop-host/src/m3-temporal-interpolation-p3-p4-cli.ts";
const wrapperPath = "scripts/windows/run-m3-temporal-interpolation-p3-p4.ps1";
const selfHostedPath = "scripts/windows/run-m3-temporal-interpolation-p3-p4-self-hosted.ps1";
const workflowPath = ".github/workflows/m3-temporal-interpolation-real-ae-p3-p4.yml";

test("temporal P4 injection is double-gated and occurs only after verified mutation inside the normal undo group", async () => {
  const source = await readFile(hostPath, "utf8");
  const beginIndex = source.indexOf('app.beginUndoGroup("EditFlow M3 temporal interpolation")');
  const applyIndex = source.indexOf("applyState(prepared.property, prepared.keyIndex, request.payload.interpolation)", beginIndex);
  const verifyIndex = source.indexOf("verifyState(prepared.property, prepared.keyIndex, request.payload.interpolation)", applyIndex);
  const profileIndex = source.indexOf('request.readbackProfile === "M3_TEMPORAL_INTERPOLATION_P4_FAILURE_INJECTION"', verifyIndex);
  const envIndex = source.indexOf('$.getenv("EDITFLOW_M3_TEMPORAL_INTERPOLATION_P4_PROOF") === "1"', profileIndex);
  const failureIndex = source.indexOf('"M3_TEMPORAL_INTERPOLATION_P4_INDUCED_FAILURE"', envIndex);
  const endIndex = source.indexOf("app.endUndoGroup()", failureIndex);
  assert.ok(beginIndex >= 0 && applyIndex > beginIndex && verifyIndex > applyIndex);
  assert.ok(profileIndex > verifyIndex && envIndex > profileIndex && failureIndex > envIndex && endIndex > failureIndex);
  assert.match(source, /app\.executeCommand\(16\)/);
  assert.match(source, /Temporal-interpolation mutation failed and was rolled back through the transaction undo boundary\./);
});

test("temporal P3 fixture makes independent incoming and outgoing HOLD states visually distinguishable from LINEAR", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /\{ time: 0, value: 0 \}/);
  assert.match(source, /\{ time: 0\.5, value: 100 \}/);
  assert.match(source, /\{ time: 1, value: 0 \}/);
  assert.match(source, /inType: "HOLD", outType: "LINEAR"/);
  assert.match(source, /inType: "LINEAR", outType: "HOLD"/);
  assert.match(source, /p3-linear\.avi/);
  assert.match(source, /p3-incoming-hold\.avi/);
  assert.match(source, /p3-outgoing-hold\.avi/);
  assert.match(source, /p3-restored-linear\.avi/);
  assert.match(source, /sampleTimesSeconds: \[0\.25, 0\.75\]/);
  assert.match(source, /P3_visual_proof: false/);
  assert.match(source, /visualReviewRequired: true/);
});

test("temporal P4 CLI requires exact failed response, structural rollback, fingerprint restoration, and recovery render", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /M3_TEMPORAL_INTERPOLATION_P4_FAILURE_INJECTION/);
  assert.match(source, /M3_TEMPORAL_INTERPOLATION_P4_INDUCED_FAILURE/);
  assert.match(source, /p4_response_readback_restored/);
  assert.match(source, /p4_fingerprint_restored/);
  assert.match(source, /p4_item_count_unchanged/);
  assert.match(source, /p4_structural_state_restored/);
  assert.match(source, /p4-post-rollback-linear\.avi/);
  assert.match(source, /P4_failure_injection_rollback: checks\.p4 === true/);
  assert.match(source, /P5_save_reopen_reconnect_transfer: false/);
});

test("temporal P3/P4 cleanup returns the isolated project to its exact pre-proof fingerprint by bounded undo", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /baseline_blank/);
  assert.match(source, /for \(let attempt = 0; attempt < 60; attempt \+= 1\)/);
  assert.match(source, /client\.undoLast/);
  assert.match(source, /cleanup_temp_items_absent/);
  assert.match(source, /cleanup_item_count_restored/);
  assert.match(source, /cleanup_fingerprint_restored/);
  assert.match(source, /cleanupUndoCount/);
});

test("temporal P3/P4 wrapper refuses to self-accept visual proof or overclaim P5", async () => {
  const source = await readFile(wrapperPath, "utf8");
  assert.match(source, /VISUAL_REVIEW_REQUIRED/);
  assert.match(source, /visualReviewRequired/);
  assert.match(source, /P3_visual_artifact_emitted/);
  assert.match(source, /P3_visual_proof/);
  assert.match(source, /P4_failure_injection_rollback/);
  assert.match(source, /P5_save_reopen_reconnect_transfer/);
  assert.match(source, /p4_induced_failure_reported/);
  assert.match(source, /cleanup_fingerprint_restored/);
  assert.doesNotMatch(source, /P3_visual_proof\s*=\s*\$true/);
});

test("self-hosted temporal P3/P4 runner arms only the proof-owned rollback gate before launching isolated AE", async () => {
  const source = await readFile(selfHostedPath, "utf8");
  assert.match(source, /run-m3-mask-p3-p4-self-hosted\.ps1/);
  assert.match(source, /run-m3-temporal-interpolation-p3-p4\.ps1/);
  assert.match(source, /EDITFLOW_M3_TEMPORAL_INTERPOLATION_P4_PROOF/);
  assert.match(source, /authenticated protocol 1\.7 registration/);
  assert.match(source, /npm run check/);
  assert.match(source, /LogLevel registry readback before AE launch/);
  assert.match(source, /Copy-CepFailureDiagnostics/);
});

test("real-AE temporal P3/P4 workflow is isolated and always retains review artifacts", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /runs-on: \[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /ae-test\/m3-temporal-interpolation-p3-p4-control/);
  assert.match(source, /m3-temporal-interpolation-p3-p4\.txt/);
  assert.match(source, /run-m3-temporal-interpolation-p3-p4-self-hosted\.ps1/);
  assert.match(source, /Upload proof artifacts for independent visual review/);
  assert.match(source, /if: always\(\)/);
  assert.match(source, /timeout-minutes: 12/);
});
