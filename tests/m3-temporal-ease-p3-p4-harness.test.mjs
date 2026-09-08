import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cliPath = "apps/desktop-host/src/m3-temporal-ease-p3-p4-cli.ts";
const baselinePath = "apps/desktop-host/src/m3-temporal-ease-p3-p4-baseline-cli.ts";
const hostPath = "packages/adapters/ae-cep/host/editflow_host_m3_temporal_ease.jsx";
const cleanupPath = "scripts/windows/m3-temporal-ease-p3-p4-cleanup.jsx";

test("temporal-ease P3/P4 harness refuses to inherit an unaccepted P1/P2 baseline", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /--accepted-p1-p2/);
  assert.match(source, /M3_TEMPORAL_EASE_P1_P2_REAL_AE/);
  assert.match(source, /P1_validation_rejection/);
  assert.match(source, /P2_structural_readback/);
  assert.match(source, /P3_visual_proof.*false/s);
  assert.match(source, /P4_failure_injection_rollback.*false/s);
  assert.match(source, /P5_save_reopen_reconnect_transfer.*false/s);
  assert.match(source, /createHash\("sha256"\)/);
  assert.match(source, /accepted_p1_p2_artifact_verified/);
});

test("P3 captures AE's actual manual-Bezier baseline ease before creating a deliberate zero-speed high-influence contrast", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /property\.temporal_ease\.readback/);
  assert.match(source, /baselineEase = easeStateFromResponse/);
  assert.match(source, /contrastingEase\(baselineEase, 80\)/);
  assert.match(source, /speed: 0, influence/);
  assert.match(source, /p3-baseline\.avi/);
  assert.match(source, /p3-zero-speed-high-influence\.avi/);
  assert.match(source, /p3-restored-baseline\.avi/);
  assert.match(source, /P3_visual_artifact_emitted/);
  assert.match(source, /P3_visual_proof: false/);
  assert.match(source, /visualReviewRequired: true/);
  assert.match(source, /P3 remains false until retained renders are decoded and independently reviewed/);
});

test("P3 changes only protocol-1.8 ease handles after fixture key creation and uses accepted 1.7 only for manual-Bezier precondition", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17/);
  assert.match(source, /property\.temporal_interpolation\.set/);
  assert.match(source, /M3_TEMPORAL_EASE_P3_P4_INTERPOLATION_SETUP/);
  assert.match(source, /property\.set_keyframes/);
  assert.match(source, /property\.temporal_ease\.set/);
  assert.match(source, /property\.temporal_ease\.readback/);
  assert.doesNotMatch(source, /setSpatialTangentsAtKey|setRovingAtKey|spatial_tangent/);
});

test("P4 host injection is two-factor, post-verification, and uses the production undo rollback path", async () => {
  const source = await readFile(hostPath, "utf8");
  const verifyIndex = source.indexOf("verifyEaseState(prepared.property, prepared.keyIndex, request.payload.ease)");
  const profileIndex = source.indexOf('request.readbackProfile === "M3_TEMPORAL_EASE_P4_FAILURE_INJECTION"');
  const envIndex = source.indexOf('$.getenv("EDITFLOW_M3_TEMPORAL_EASE_P4_PROOF") === "1"');
  const failureIndex = source.indexOf('M3_TEMPORAL_EASE_P4_INDUCED_FAILURE');
  const undoIndex = source.indexOf("app.executeCommand(16)");
  assert.ok(verifyIndex >= 0);
  assert.ok(profileIndex > verifyIndex);
  assert.ok(envIndex > verifyIndex);
  assert.ok(failureIndex > verifyIndex);
  assert.ok(undoIndex > failureIndex);
  assert.match(source, /PROOF_INJECTION/);
  assert.match(source, /Temporal-ease mutation failed and was rolled back through the transaction undo boundary/);
});

test("P4 harness verifies exact structural and project restoration and emits a post-rollback render without self-accepting P3", async () => {
  const source = await readFile(cliPath, "utf8");
  assert.match(source, /M3_TEMPORAL_EASE_P4_FAILURE_INJECTION/);
  assert.match(source, /M3_TEMPORAL_EASE_P4_INDUCED_FAILURE/);
  assert.match(source, /p4_response_readback_restored/);
  assert.match(source, /p4_fingerprint_restored/);
  assert.match(source, /p4_item_count_unchanged/);
  assert.match(source, /p4_structural_state_restored/);
  assert.match(source, /p4-post-rollback-baseline\.avi/);
  assert.match(source, /P4_failure_injection_rollback: checks\.p4 === true/);
  assert.match(source, /P3_visual_proof: false/);
});

test("exact-baseline probe negotiates protocol 1.8 and validates blank unsaved project identity", async () => {
  const source = await readFile(baselinePath, "utf8");
  assert.match(source, /AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18/);
  assert.match(source, /M3_TEMPORAL_EASE_P3_P4_BASELINE/);
  assert.match(source, /baseline\.itemCount !== 0 \|\| baseline\.filePath !== null/);
  assert.match(source, /EXACT_MATCH/);
  assert.match(source, /projectFingerprint === expected\.projectFingerprint/);
});

test("proof-owned cleanup refuses saved or foreign projects and requires the isolated P4 environment", async () => {
  const source = await readFile(cleanupPath, "utf8");
  assert.match(source, /EDITFLOW_M3_TEMPORAL_EASE_P4_PROOF/);
  assert.match(source, /M3_TEMPORAL_EASE_P34_/);
  assert.match(source, /if \(app\.project\.file\) throw new Error/);
  assert.match(source, /found an item without an EditFlow stableId/);
  assert.match(source, /found an item outside the fixed proof fixture/);
  assert.match(source, /found mixed proof fixture generations/);
  assert.match(source, /CloseOptions\.DO_NOT_SAVE_CHANGES/);
  assert.match(source, /app\.newProject\(\)/);
  assert.match(source, /blankItemCount/);
});
