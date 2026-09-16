import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestPath = "proofs/manifests/m5-mocha-ae-discovery.request.json";
const proofPath = "scripts/windows/run-m5-mocha-ae-discovery.ps1";

test("M5 Mocha discovery request is read-only, non-retrying, and warm-AE bound", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.lifecycle, "REUSE_AE");
  assert.equal(manifest.allowInfrastructureRetry, false);
  assert.equal(manifest.allowEvidenceReuse, false);
  assert.equal(manifest.proofId, "M5_MOCHA_AE_DISCOVERY_RETAINED_REAL_AE_V1");
});

test("Mocha discovery enumerates AE effect metadata without adding an effect", async () => {
  const source = await readFile(proofPath, "utf8");
  assert.match(source, /app\.effects/);
  assert.match(source, /displayName/);
  assert.match(source, /matchName/);
  assert.match(source, /canAddProperty/);
  assert.doesNotMatch(source, /addProperty\(/);
  assert.match(source, /REVISION_BEFORE/);
  assert.match(source, /REVISION_AFTER/);
  assert.match(source, /sameAeProcess/);
  assert.match(source, /mutationStarted = \$false/);
});