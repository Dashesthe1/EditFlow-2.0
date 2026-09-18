import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const hostPath = "scripts/windows/tutorial-001-sparse-visual.jsx";
const runnerPath = "scripts/proofs/tutorial-001-live-structural.mjs";

test("Tutorial 001 sparse visual proof is bounded and uses deterministic proof-only imagery", async () => {
  const source = await readFile(hostPath, "utf8");
  assert.match(source, /M5_TUTORIAL_001_SPARSE_VISUAL_V1/);
  assert.match(source, /saveFrameToPng/);
  assert.match(source, /var times = \[1800, 1950, 2000, 2050, 2200\]/);
  assert.match(source, /EF2_T001_LIVE_SOURCE_OUT/);
  assert.match(source, /EF2_T001_LIVE_SOURCE_IN/);
  assert.match(source, /EF2_T001_LIVE_LAYER_OUT/);
  assert.match(source, /EF2_T001_LIVE_LAYER_IN/);
  assert.match(source, /outLayer\.outPoint = 2\.0/);
  assert.match(source, /inLayer\.inPoint = 2\.0/);
  assert.match(source, /addRect\(/);
  assert.match(source, /addRing\(/);
  assert.doesNotMatch(source, /renderQueue\.render\s*\(/);
  assert.doesNotMatch(source, /app\.quit\s*\(/);
});

test("Tutorial 001 live runner keeps structural mode default and gates sparse visual capture explicitly", async () => {
  const source = await readFile(runnerPath, "utf8");
  assert.match(source, /EDITFLOW_T001_VISUAL === "1"/);
  assert.match(source, /m5-tutorial-001-live-adaptive-structural\.json/);
  assert.match(source, /m5-tutorial-001-live-adaptive-visual\.json/);
  assert.match(source, /\/proof-script/);
  assert.match(source, /baseline\.json/);
  assert.match(source, /edited\.json/);
});
