import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestPath = "proofs/manifests/m5-mocha-ae-apply-development.request.json";
const runnerPath = "scripts/windows/run-m5-mocha-ae-apply-live-proof.ps1";
const fixturePath = "scripts/windows/m5-mocha-ae-fixture-apply.jsx";
const enterPath = "scripts/windows/m5-mocha-ae-isolation-enter.jsx";
const restorePath = "scripts/windows/m5-mocha-ae-isolation-restore.jsx";
const sourceProbePath = "scripts/windows/m5-mocha-ae-source-probe.jsx";

test("M5 Mocha apply proof is warm-AE, non-retrying, and exact-restore bound", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.lifecycle, "REUSE_AE");
  assert.equal(manifest.allowInfrastructureRetry, false);
  assert.equal(manifest.allowEvidenceReuse, false);
  const runner = await readFile(runnerPath, "utf8");
  assert.match(runner, /finally/);
  assert.match(runner, /sameAeProcess/i);
  assert.match(runner, /maxMeasuredWarmAeRoundtripMs/);
  assert.match(runner, /ProofScriptEndpoint/);
  assert.match(runner, /127\.0\.0\.1:32146\/proof-script/);
  assert.match(runner, /Invoke-WebRequest/);
  assert.match(runner, /WARM_CEP_PROOF_SCRIPT/);
  assert.doesNotMatch(runner, /Start-Process -FilePath \$AfterFxPath/);
});

test("Mocha source probe publishes one complete atomic read-only result", async () => {
  const probe = await readFile(sourceProbePath, "utf8");
  assert.match(probe, /EditFlow2-m5-mocha-ae-source\.pending\.json/);
  assert.match(probe, /pending\.write\(text\)/);
  assert.match(probe, /pending\.rename\(out\.name\)/);
  assert.match(probe, /Cannot publish source probe atomically/);
  assert.match(probe, /e\.line/);
  assert.doesNotMatch(probe, /out\.write\(JSON\.stringify/);
});

test("Mocha fixture adds exactly one registered mochaAECC effect inside owned isolation", async () => {
  const fixture = await readFile(fixturePath, "utf8");
  assert.match(fixture, /EF2_M5_MOCHA_/);
  assert.match(fixture, /canAddProperty\("mochaAECC"\)/);
  assert.match(fixture, /addProperty\("mochaAECC"\)/);
  assert.match(fixture, /afterCount !== beforeCount \+ 1/);
  assert.match(fixture, /snapshotProperty/);
});

test("Mocha isolation is separately namespaced and restore refuses unrelated unsaved items", async () => {
  const enter = await readFile(enterPath, "utf8");
  const restore = await readFile(restorePath, "utf8");
  assert.match(enter, /M5_MOCHA_AE_ISOLATION_V1/);
  assert.match(restore, /M5_MOCHA_AE_ISOLATION_V1/);
  assert.match(restore, /EF2_M5_MOCHA_/);
  assert.match(restore, /Restore refuses an unsaved project containing non-M5 proof items/);
  assert.match(restore, /DO_NOT_SAVE_CHANGES/);
});
