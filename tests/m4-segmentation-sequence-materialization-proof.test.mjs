import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("dynamic sequence materialization proof stays warm-AE, temporal, visual, and baseline-safe", async () => {
  const manifest = JSON.parse(await read("proofs/manifests/m4-segmentation-sequence-materialization-real-ae.request.json"));
  const runner = await read("scripts/windows/run-m4-segmentation-sequence-materialization.ps1");
  const template = await read("scripts/windows/m4-segmentation-sequence-materialization-real-ae-template.jsx");
  const planner = await read("scripts/m4-segmentation-sequence-materialization-proof-plan.mjs");

  assert.equal(manifest.lifecycle, "REUSE_AE");
  assert.equal(manifest.allowInfrastructureRetry, false);
  assert.match(planner, /media\.sequence\.import/);
  assert.match(planner, /frameTimes: \[0\.5 \/ frameRate, 1\.5 \/ frameRate, 2\.5 \/ frameRate\]/);
  assert.match(template, /layer\.set_track_matte/);
  assert.match(template, /media\.sequence\.readback/);
  assert.match(template, /saveFrameToPng/);
  assert.match(template, /project_baseline_restored/);
  assert.match(runner, /VisualCheckpointPassed/);
  assert.match(runner, /SUBJECT/);
  assert.match(runner, /BACKGROUND/);
});
