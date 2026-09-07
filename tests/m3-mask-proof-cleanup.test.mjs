import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cleanupPath = "packages/adapters/ae-cep/host/editflow_host_m3_proof_cleanup.jsx";
const currentHostPath = "packages/adapters/ae-cep/host/editflow_host_current.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";

test("M3 disposable-project cleanup is proof-gated and does not extend the dispatch protocol", async () => {
  const source = await readFile(cleanupPath, "utf8");

  assert.match(source, /PROOF_ENV = "EDITFLOW_M3_MASK_P4_PROOF"/);
  assert.match(source, /\$\.getenv\(PROOF_ENV\) !== "1"/);
  assert.match(source, /RECOVERY_REQUEST_NAME = "p4-post-rollback\.avi"/);
  assert.match(source, /job\.requestedOutputPath/);
  assert.doesNotMatch(source, /EditFlow2_dispatch\s*=/);
});

test("M3 proof cleanup fails closed unless the unsaved project is exactly one proof-owned fixture generation", async () => {
  const source = await readFile(cleanupPath, "utf8");

  assert.match(source, /if \(app\.project\.file\)/);
  assert.match(source, /app\.project\.numItems !== 3/);
  assert.match(source, /M3_MASK_P34_/);
  assert.match(source, /_TARGET_COMP/);
  assert.match(source, /_BG_MEDIA/);
  assert.match(source, /_FG_MEDIA/);
  assert.match(source, /target\.numLayers !== 2/);
  assert.match(source, /_BG_LAYER/);
  assert.match(source, /_FG_LAYER/);
  assert.match(source, /masks\.numProperties !== 1/);
  assert.match(source, /_MASK/);
  assert.match(source, /mixed proof fixture generations/);
});

test("M3 proof cleanup discards only the verified disposable project and verifies a fresh blank project", async () => {
  const source = await readFile(cleanupPath, "utf8");

  assert.match(source, /project\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\)/);
  assert.match(source, /app\.newProject\(\)/);
  assert.match(source, /app\.project\.file \|\| app\.project\.numItems !== 0/);
  assert.match(source, /EditFlow2_lastProofCleanup/);
  assert.match(source, /proofCleanupCompleted = true/);
});

test("current host preserves mask proof cleanup gating under the diagnosable fail-closed proof loader", async () => {
  const [currentHost, installer] = await Promise.all([
    readFile(currentHostPath, "utf8"),
    readFile(installerPath, "utf8"),
  ]);

  assert.match(currentHost, /m3ProofMode = \$\.getenv\("EDITFLOW_M3_MASK_P4_PROOF"\) === "1"/);
  assert.match(currentHost, /else if \(m3ProofMode\)/);
  assert.match(currentHost, /if \(!m3ProofCleanup\.exists\)/);
  assert.match(currentHost, /try \{ \$\.evalFile\(m3ProofCleanup\); \} catch \(maskProofCleanupError\)/);
  assert.match(currentHost, /M3_PROOF_CLEANUP_MODULE_LOAD_FAILED/);
  assert.match(currentHost, /All proof protocol traffic is blocked before mutation until the load defect is repaired\./);
  assert.match(installer, /"editflow_host_m3_proof_cleanup\.jsx"/);
});
