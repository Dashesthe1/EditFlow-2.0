import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("segmentation sequence P5 proof is current-session safe and crosses save/reopen/reconnect", async () => {
  const manifest = JSON.parse(await read("proofs/manifests/m4-segmentation-sequence-p5-real-ae.request.json"));
  const runner = await read("scripts/windows/run-m4-segmentation-sequence-p5.ps1");
  const proof = await read("scripts/m4-segmentation-sequence-p5-proof.mjs");
  const stage1 = await read("scripts/windows/m4-segmentation-sequence-p5-stage1-template.jsx");
  const reopen = await read("scripts/windows/m4-segmentation-sequence-p5-reopen-template.jsx");
  const cleanup = await read("scripts/windows/m4-segmentation-sequence-p5-cleanup-template.jsx");
  const proofPath = fileURLToPath(new URL("../scripts/m4-segmentation-sequence-p5-proof.mjs", import.meta.url));

  await execFileAsync(process.execPath, ["--check", proofPath]);

  assert.equal(manifest.lifecycle, "REUSE_AE");
  assert.equal(manifest.allowInfrastructureRetry, false);
  assert.equal(manifest.preserveCurrentAfterEffectsProcess, true);
  assert.equal(manifest.userProjectPolicy, "SAVE_ONCE_THEN_USE_DISPOSABLE_COPY_AND_RESTORE_SAVED_BASELINE");
  assert.equal(manifest.sessionBoundary, "SAVE_REOPEN_THEN_DISTINCT_AUTHENTICATED_CEP_SESSION");
  assert.equal(manifest.productionPromotionOnPass, false);

  assert.match(runner, /Reusing current After Effects PID/);
  assert.match(runner, /exactly one already-running After Effects process/);
  assert.doesNotMatch(runner, /Stop-Process[^\n]*AfterFX/i);
  assert.doesNotMatch(runner, /AfterFX\.exe[^\n]*-m/i);
  assert.match(runner, /Compiled proof runtime is incomplete; building test runtime once/);
  assert.match(runner, /Reusing existing compiled proof runtime; no rebuild required/);
  assert.match(runner, /npm run build:test-runtime/);
  assert.match(runner, /post-reopen/);
  assert.match(runner, /stableAcrossBoundary/);

  assert.match(proof, /supportedProtocolVersions: \[AE_COMPOSITE_PROTOCOL_VERSION_V13, AE_ADAPTER_PROTOCOL_VERSION_V11\]/);
  assert.doesNotMatch(proof, /supportedProtocolVersions: \[[^\]]*2\.5\.0/);
  assert.match(proof, /sessionId !== firstSessionId/);
  assert.match(proof, /layer\.clear_track_matte/);
  assert.match(proof, /layer\.set_track_matte/);
  assert.match(proof, /trackMatteType: "LUMA"/);
  assert.match(proof, /project\.save/);
  assert.match(proof, /user-project-pre-proof-disk-backup\.aep/);
  assert.match(proof, /user-project-saved-snapshot\.aep/);
  assert.match(proof, /original_project_restored/);
  assert.match(proof, /reopened_fingerprint_preserved/);

  assert.match(stage1, /app\.open\(lifecycleProjectFile\)/);
  assert.match(stage1, /media\.sequence\.readback/);
  assert.match(stage1, /lifecycle_state_retained/);
  assert.doesNotMatch(stage1, /ownedComp\.remove/);

  assert.match(reopen, /app\.open\(projectFile\)/);
  assert.match(reopen, /dispatcher_reloaded/);
  assert.match(reopen, /sequence_import_idempotent_after_reopen/);
  assert.match(reopen, /track_matte_exact/);

  assert.match(cleanup, /cleanup_scope_guarded/);
  assert.match(cleanup, /M4_TRANSFER_SEQUENCE_COMP/);
  assert.match(cleanup, /original_project_reopened/);
});

test("retained P5 acceptance proves same-process save/reopen/reconnect transfer and restoration", async () => {
  const retained = JSON.parse(await read("proofs/diagnostics/m4-segmentation-sequence-p5-live-acceptance.json"));

  assert.equal(retained.proofId, "M4_SEGMENTATION_SEQUENCE_P5_SAVE_REOPEN_RECONNECT");
  assert.equal(retained.status, "ACCEPTED");
  assert.equal(retained.ok, true);
  assert.equal(retained.classification, "PASS");
  assert.equal(retained.cleanupComplete, true);
  assert.equal(retained.visualCheckpointPassed, true);
  assert.equal(retained.failure, null);
  assert.equal(retained.checks.user_project_saved_in_place, true);
  assert.equal(retained.checks.direct_reopen_readback_passed, true);
  assert.equal(retained.checks.authenticated_reconnect, true);
  assert.equal(retained.checks.post_reconnect_host_probe, true);
  assert.equal(retained.checks.composite_exact_after_reconnect, true);
  assert.equal(retained.checks.post_reconnect_mutation_readback, true);
  assert.equal(retained.checks.post_reconnect_saved_state_reopens, true);
  assert.equal(retained.checks.original_project_restored, true);
  assert.notEqual(retained.sessions.initial.sessionId, retained.sessions.reconnected.sessionId);
});
