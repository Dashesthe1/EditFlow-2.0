import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("segmentation sequence materialization transfers to real footage without touching the source item", async () => {
  const manifest = JSON.parse(await read("proofs/manifests/m4-segmentation-sequence-transfer-real-ae.request.json"));
  const runner = await read("scripts/windows/run-m4-segmentation-sequence-transfer.ps1");
  const template = await read("scripts/windows/m4-segmentation-sequence-transfer-real-ae-template.jsx");
  const planner = await read("scripts/m4-segmentation-sequence-transfer-proof-plan.mjs");
  const diagnostic = JSON.parse(await read("proofs/diagnostics/m4-segmentation-sequence-transfer-live-acceptance.json"));

  assert.equal(manifest.lifecycle, "REUSE_AE");
  assert.equal(manifest.allowInfrastructureRetry, false);
  assert.match(planner, /buildSegmentationSequenceMatteMaterializationPlanV1/);
  assert.match(planner, /AE_FOOTAGE_HOST_/);
  assert.match(template, /app\.project\.itemByID/);
  assert.match(template, /source_item_preserved/);
  assert.match(template, /project_baseline_restored/);
  assert.match(runner, /SOURCE_BASELINE/);
  assert.match(runner, /BACKGROUND/);
  assert.match(runner, /VisualCheckpointPassed/);
  assert.equal(diagnostic.runtimePromotion, "WITHHELD_LIVE_PROVIDER_AND_SESSION_BOUNDARY");
  assert.equal(diagnostic.liveProof.materiallyDifferentRealFootage, true);
  assert.equal(diagnostic.providerGate.liveSam31InferenceAccepted, false);
  assert.equal(diagnostic.sessionBoundaryGate.saveReopenReconnectAccepted, false);
});
