import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("segmentation sequence P5 proof is current-session safe and crosses save/reopen/reconnect", async () => {
  const runner = await read("scripts/windows/run-m4-segmentation-sequence-p5.ps1");
  const proof = await read("scripts/m4-segmentation-sequence-p5-proof.mjs");
  const stage1 = await read("scripts/windows/m4-segmentation-sequence-p5-stage1-template.jsx");
  const reopen = await read("scripts/windows/m4-segmentation-sequence-p5-reopen-template.jsx");
  const cleanup = await read("scripts/windows/m4-segmentation-sequence-p5-cleanup-template.jsx");
  const proofPath = fileURLToPath(new URL("../scripts/m4-segmentation-sequence-p5-proof.mjs", import.meta.url));

  await execFileAsync(process.execPath, ["--check", proofPath]);

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
