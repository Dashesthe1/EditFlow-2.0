import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const cleanupPath = "packages/adapters/ae-cep/host/editflow_host_m3_composite_proof_cleanup.jsx";
const currentHostPath = "packages/adapters/ae-cep/host/editflow_host_current.jsx";
const installerPath = "scripts/windows/install-editflow-cep.ps1";

test("M3 composite disposable-project cleanup is proof-gated and does not extend the dispatch protocol", async () => {
  const source = await readFile(cleanupPath, "utf8");

  assert.match(source, /PROOF_ENV = "EDITFLOW_M3_COMPOSITE_P4_PROOF"/);
  assert.match(source, /\$\.getenv\(PROOF_ENV\) !== "1"/);
  assert.match(source, /RECOVERY_REQUEST_NAME = "p4-post-rollback\.avi"/);
  assert.match(source, /job\.requestedOutputPath/);
  assert.doesNotMatch(source, /EditFlow2_dispatch\s*=/);
});

test("M3 composite proof cleanup fails closed unless the unsaved project is exactly one composite fixture generation", async () => {
  const source = await readFile(cleanupPath, "utf8");

  assert.match(source, /if \(app\.project\.file\)/);
  assert.match(source, /app\.project\.numItems !== 4/);
  assert.match(source, /M3_COMPOSITE_P34_/);
  assert.match(source, /_TARGET_COMP/);
  assert.match(source, /_BG_MEDIA/);
  assert.match(source, /_FG_MEDIA/);
  assert.match(source, /_MATTE_MEDIA/);
  assert.match(source, /target\.numLayers !== 3/);
  assert.match(source, /_BG_LAYER/);
  assert.match(source, /_FG_LAYER/);
  assert.match(source, /_MATTE_LAYER/);
  assert.match(source, /mixed proof fixture generations/);
  assert.match(source, /foregroundLayer\.source !== foreground/);
  assert.match(source, /matteLayer\.source !== matte/);
});

test("M3 composite proof cleanup verifies restored LUMA plus ADD state before discarding the disposable project", async () => {
  const source = await readFile(cleanupPath, "utf8");

  assert.match(source, /foregroundLayer\.hasTrackMatte/);
  assert.match(source, /foregroundLayer\.trackMatteLayer !== matteLayer/);
  assert.match(source, /foregroundLayer\.trackMatteType !== TrackMatteType\.LUMA/);
  assert.match(source, /foregroundLayer\.blendingMode !== BlendingMode\.ADD/);
  assert.match(source, /project\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\)/);
  assert.match(source, /app\.newProject\(\)/);
  assert.match(source, /app\.project\.file \|\| app\.project\.numItems !== 0/);
  assert.match(source, /EditFlow2_lastProofCleanup/);
  assert.match(source, /proofId: "M3_COMPOSITE_P3_P4_REAL_AE"/);
  assert.match(source, /proofCleanupCompleted = true/);
});

test("current host keeps proof cleanup fail-closed while making load faults visible after panel registration", async () => {
  const [currentHost, installer] = await Promise.all([
    readFile(currentHostPath, "utf8"),
    readFile(installerPath, "utf8"),
  ]);

  assert.match(currentHost, /m3ProofMode = \$\.getenv\("EDITFLOW_M3_MASK_P4_PROOF"\) === "1"/);
  assert.match(currentHost, /m3CompositeProofMode = \$\.getenv\("EDITFLOW_M3_COMPOSITE_P4_PROOF"\) === "1"/);
  assert.match(currentHost, /proofCleanupLoadError = "EditFlow M3 proof cleanup modes are mutually exclusive\."/);
  assert.match(currentHost, /try \{ \$\.evalFile\(m3CompositeProofCleanup\); \} catch \(compositeProofCleanupError\)/);
  assert.match(currentHost, /M3_PROOF_CLEANUP_MODULE_LOAD_FAILED/);
  assert.match(currentHost, /All proof protocol traffic is blocked before mutation until the load defect is repaired\./);
  assert.doesNotMatch(currentHost, /if \(m3ProofMode && m3CompositeProofMode\) throw/);
  assert.match(installer, /"editflow_host_m3_composite_proof_cleanup\.jsx"/);
});

test("current loader and composite cleanup remain ordinary JavaScript parseable before AE execution", async () => {
  const [currentHost, cleanup] = await Promise.all([
    readFile(currentHostPath, "utf8"),
    readFile(cleanupPath, "utf8"),
  ]);

  assert.doesNotThrow(() => new vm.Script(currentHost, { filename: currentHostPath }));
  assert.doesNotThrow(() => new vm.Script(cleanup, { filename: cleanupPath }));
});
