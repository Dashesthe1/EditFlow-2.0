import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("live SAM 3.1 sequence matte E2E proof stays warm-AE and bounded", async () => {
  const manifest = JSON.parse(await read("proofs/manifests/m4-sam31-live-sequence-matte-e2e-real-ae.request.json"));
  const runner = await read("scripts/windows/run-m4-sam31-live-sequence-matte-e2e.ps1");
  const template = await read("scripts/windows/m4-sam31-live-sequence-matte-e2e-real-ae-template.jsx");
  const planner = await read("scripts/m4-sam31-live-sequence-matte-e2e-proof-plan.mjs");
  const plannerPath = fileURLToPath(new URL("../scripts/m4-sam31-live-sequence-matte-e2e-proof-plan.mjs", import.meta.url));

  await execFileAsync(process.execPath, ["--check", plannerPath]);
  assert.equal(manifest.lifecycle, "REUSE_AE");
  assert.equal(manifest.allowInfrastructureRetry, false);
  assert.equal(manifest.preserveCurrentAfterEffectsProcess, true);
  assert.equal(manifest.mutationScope, "PROOF_OWNED_ITEMS_ONLY");
  assert.equal(manifest.productionPromotionOnPass, false);

  assert.match(planner, /Sam31LocalSegmentationSequenceProviderV1/);
  assert.match(planner, /provider\.segmentSequence\(request\)/);
  assert.match(planner, /provider\.resolveSequence\(request\.requestId\)/);
  assert.match(planner, /material masks on every requested frame/);
  assert.match(planner, /media\.sequence\.import/);
  assert.match(planner, /layer\.add_media/);
  assert.match(planner, /layer\.set_transform/);
  assert.match(planner, /layer\.set_timing/);
  assert.match(planner, /layer\.set_track_matte/);

  assert.match(template, /media\.sequence\.readback/);
  assert.match(template, /layer\.composite_readback/);
  assert.match(template, /saveFrameToPng/);
  assert.match(template, /project_baseline_restored/);
  assert.match(template, /ownedComp\.remove/);

  assert.match(runner, /BaselineAePids/);
  assert.match(runner, /AeProcessReused/);
  assert.match(runner, /DynamicFramesPass/);
  assert.match(runner, /VisualCheckpointPassed/);
  assert.doesNotMatch(runner, /Stop-Process[^\n]*AfterFX/i);
  assert.doesNotMatch(runner, /AfterFX\.exe[^\n]*-m/i);
});

test("retained live SAM 3.1 E2E acceptance proves dynamic visual materialization", async () => {
  const retained = JSON.parse(await read("proofs/diagnostics/m4-sam31-live-sequence-matte-e2e-live-acceptance.json"));

  assert.equal(retained.proofId, "M4_SAM31_LIVE_SEQUENCE_MATTE_E2E_REAL_AE");
  assert.equal(retained.classification, "PASS");
  assert.equal(retained.ok, true);
  assert.equal(retained.source.providerId, "sam3.1.local");
  assert.equal(retained.source.frameCount, 6);
  assert.equal(retained.materialization.cleanupComplete, true);
  assert.equal(retained.visual.checkpointPassed, true);
  assert.equal(retained.afterEffects.warmProcessReused, true);
  assert.equal(retained.afterEffects.projectBaselineRestored, true);
  assert.deepEqual(retained.afterEffects.baselinePids, retained.afterEffects.afterPids);
  assert.equal(new Set(retained.visual.reviewFrameSha256).size, 3);
  assert.ok(Object.values(retained.materialization.hostChecks).every((value) => value === true));
  assert.ok(retained.visual.frames.every((frame) => frame.pass === true));
  assert.equal(retained.lifecycle.ok, true);
  assert.equal(retained.lifecycle.authenticatedReconnect, true);
  assert.equal(retained.lifecycle.originalProjectRestored, true);
  assert.equal(retained.scope.runtimePlannerRegistration, "DIGEST_BOUND_FULL_TRANSFER_R0_READ_ONLY");
  assert.equal(retained.scope.productionWriteDispatchPromoted, false);
});
