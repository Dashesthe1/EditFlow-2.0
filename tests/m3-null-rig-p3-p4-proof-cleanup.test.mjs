import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cleanupPath = "packages/adapters/ae-cep/host/editflow_host_m3_null_rig_proof_cleanup.jsx";
const loaderPath = "packages/adapters/ae-cep/host/editflow_host_current_v15.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";

test("null-rig P3/P4 cleanup is proof-gated and refuses any project outside the exact disposable fixture", async () => {
  const source = await readFile(cleanupPath, "utf8");
  assert.match(source, /EDITFLOW_M3_NULL_RIG_P4_PROOF/);
  assert.match(source, /p4-post-rollback\.avi/);
  assert.match(source, /M3_NULL_RIG_P34_/);
  assert.match(source, /_SOURCE_MEDIA/);
  assert.match(source, /_TARGET_COMP/);
  assert.match(source, /_CHILD_LAYER/);
  assert.match(source, /_RIG_MAIN/);
  assert.match(source, /\[\[EDITFLOW2_NULL_SOURCE:/);
  assert.match(source, /\[\[EDITFLOW2_NULL_SUPPORT_FOLDER\]\]/);
  assert.match(source, /rigLayer\.nullLayer !== true/);
  assert.match(source, /rigLayer\.source !== nullSource/);
  assert.match(source, /childLayer\.parent !== null/);
  assert.match(source, /CloseOptions\.DO_NOT_SAVE_CHANGES/);
  assert.match(source, /app\.newProject\(\)/);
  assert.match(source, /M3_NULL_RIG_P3_P4_REAL_AE/);
  assert.doesNotMatch(source, /app\.executeCommand\(16\)/);
});

test("v15 loader and installer expose proof cleanup only to explicitly armed P4 sessions", async () => {
  const [loader, installer] = await Promise.all([
    readFile(loaderPath, "utf8"),
    readFile(installerPath, "utf8"),
  ]);
  assert.match(loader, /editflow_host_m3_null_rig_proof_cleanup\.jsx/);
  assert.match(loader, /\$\.getenv\("EDITFLOW_M3_NULL_RIG_P4_PROOF"\) === "1"/);
  assert.match(loader, /\$\.evalFile\(m3NullRigProofCleanup\)/);
  assert.match(installer, /"editflow_host_m3_null_rig_proof_cleanup\.jsx"/);
});
