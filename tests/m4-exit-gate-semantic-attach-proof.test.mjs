import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("M4 exit-gate semantic attach proof stays warm-AE, bounded, and fast-looped", async () => {
  const manifest = JSON.parse(await read("proofs/manifests/m4-exit-gate-semantic-attach-real-ae.request.json"));
  const runner = await read("scripts/windows/run-m4-exit-gate-semantic-attach.ps1");
  const template = await read("scripts/windows/m4-exit-gate-semantic-attach-real-ae-template.jsx");
  const planner = await read("scripts/m4-exit-gate-semantic-attach-plan.mjs");
  const plannerPath = fileURLToPath(new URL("../scripts/m4-exit-gate-semantic-attach-plan.mjs", import.meta.url));
  await execFileAsync(process.execPath, ["--check", plannerPath]);

  assert.equal(manifest.lifecycle, "REUSE_AE");
  assert.equal(manifest.preserveCurrentAfterEffectsProcess, true);
  assert.equal(manifest.mutationScope, "PROOF_OWNED_ITEMS_ONLY");
  assert.equal(manifest.productionPromotionOnPass, false);
  assert.match(planner, /resolveSemanticAttachPointV1/);
  assert.match(planner, /materializeSourceSequence/);
  assert.match(planner, /transitionTrackingRepairV1/);
  assert.match(planner, /ambiguous class-only attach did not fail closed/);
  assert.match(template, /media\.sequence\.import/);
  assert.match(template, /layer\.set_track_matte/);
  assert.match(template, /KeyframeInterpolationType\.HOLD/);
  assert.match(template, /saveFrameToPng/);
  assert.match(template, /project_baseline_restored/);
  assert.match(template, /hostRevision = app\.project\.revision/);
  assert.match(runner, /BaselineAePids/);
  assert.match(runner, /maxRoutineGapMs/);
  assert.match(runner, /VisualCheckpointPassed/);
  assert.doesNotMatch(runner, /Stop-Process[^\n]*AfterFX/i);
  assert.doesNotMatch(runner, /AfterFX\.exe[^\n]*-m/i);
});

test("retained M4 exit-gate acceptance proves attach, repair, transfer, and cleanup", async () => {
  const retained = JSON.parse(await read("proofs/diagnostics/m4-exit-gate-semantic-attach-real-ae-acceptance.json"));
  assert.equal(retained.proofId, "M4_EXIT_GATE_SEMANTIC_ATTACH_REAL_AE");
  assert.equal(retained.classification, "PASS");
  assert.equal(retained.ok, true);
  assert.equal(retained.source.fixtureCount, 2);
  assert.equal(new Set(retained.source.fixtures.map((fixture) => fixture.sourceSha256)).size, 2);
  assert.ok(retained.source.fixtures.every((fixture) => fixture.distinctAttachPoints >= 2));
  assert.ok(Object.values(retained.semanticAttach.gates).every((value) => value === true));
  assert.equal(retained.semanticAttach.repairStatus, "RESUMED");
  assert.equal(retained.materialization.cleanupComplete, true);
  assert.ok(Object.values(retained.materialization.hostChecks).every((value) => value === true));
  assert.equal(retained.visual.checkpointPassed, true);
  assert.equal(retained.visual.passCount, retained.visual.evidenceCount);
  assert.equal(retained.visual.evidenceCount, 7);
  assert.equal(retained.visual.reviewFrameSha256.length, 8);
  assert.ok(new Set(retained.visual.reviewFrameSha256).size >= 7);
  assert.equal(retained.afterEffects.warmProcessReused, true);
  assert.equal(retained.afterEffects.projectBaselineRestored, true);
  assert.deepEqual(retained.afterEffects.baselinePids, retained.afterEffects.afterPids);
  assert.equal(retained.afterEffects.baselineItemCount, retained.afterEffects.afterItemCount);
  assert.ok(retained.fastPath.dispatchCount >= 20);
  assert.ok(retained.fastPath.maxRoutineGapMs <= 3000);
  assert.equal(retained.scope.runtimeCapabilityPromotion, "FULL_TRANSFER_R0_READ_ONLY");
  assert.equal(retained.scope.runtimeFoundationRegistration, true);
  assert.equal(retained.scope.fallbackPolicy, "FORBID");
  assert.equal(retained.scope.productionWriteDispatchPromoted, false);
});
