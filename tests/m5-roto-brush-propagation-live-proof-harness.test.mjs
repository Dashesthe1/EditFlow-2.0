import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(name, "utf8");

test("M5 propagation retained runner is symmetric, same-process, and restore-first", async () => {
  const ps = await read("scripts/windows/run-m5-roto-brush-propagation-live-proof.ps1");
  assert.match(ps, /ValidateSet\("FORWARD","BACKWARD"\)/);
  assert.match(ps, /m5-roto-brush-propagation-live-proof\.mjs/);
  assert.match(ps, /m5-roto-brush-isolation-enter\.jsx/);
  assert.match(ps, /m5-roto-brush-isolation-restore\.jsx/);
  assert.match(ps, /Get-Process -Name "AfterFX"/);
  assert.match(ps, /requires exactly one already-running After Effects process/);
  assert.match(ps, /finally\s*\{/);
  assert.match(ps, /restoreAttempted/);
  assert.match(ps, /sameAeProcess/);
  assert.match(ps, /M5_ROTO_BRUSH_PROPAGATION_/);
  assert.match(ps, /--seed-visual-script/);
  assert.match(ps, /--propagation-visual-script/);
  assert.match(ps, /--direction \$Direction/);
  assert.match(ps, /if \(\$NodeExit -ne 0 -or \$Live\.ok -ne \$true\)/);
});

test("M5 propagation live proof is exactly bounded and speed-gated", async () => {
  const node = await read("scripts/m5-roto-brush-propagation-live-proof.mjs");
  assert.match(node, /GuardedRotoBrushSeedControllerV1/);
  assert.match(node, /GuardedRotoBrushPropagationControllerV1/);
  assert.match(node, /EditGptRotoBrushSeedVisualDriverV1/);
  assert.match(node, /EditGptRotoBrushPropagationVisualDriverV1/);
  assert.match(node, /const frameSteps = 3;/);
  assert.match(node, /PROPAGATE_FORWARD/);
  assert.match(node, /PROPAGATE_BACKWARD/);
  assert.match(node, /propagation\.expectedFrameSteps === frameSteps/);
  assert.match(node, /propagation\.finalTime !== propagation\.baselineTime/);
  assert.match(node, /allGaps\.every\(\(value\) => value <= 3000\)/);
  assert.match(node, /allGaps\.every\(\(value\) => value < 1000\)/);
  assert.match(node, /propagation\.route === "LOCAL"/);
  assert.match(node, /typedReadbackRoundtripsMs/);
});

test("M5 propagation visual batch keeps semantic checks outside local frame loop", async () => {
  const py = await read("packages/adapters/ae-cep/runtime/editgpt_roto_brush_propagation_visual_driver.py");
  assert.match(py, /\["CTRL", "RIGHT"\]/);
  assert.match(py, /\["CTRL", "LEFT"\]/);
  assert.match(py, /hands_keypress", \{"keys": keys\}/);
  assert.match(py, /expectedFrameSteps/);
  assert.match(py, /actionToActionLatenciesMs/);
  assert.match(py, /inspect_error_popup/);
  assert.match(py, /acknowledgementOnly/);
  const loop = py.slice(py.indexOf('for index in range(request["expectedFrameSteps"]):'), py.indexOf('proof["frameStepBatch"]'));
  assert.doesNotMatch(loop, /qwen\.|verify_visible|choose_pointer_target|capture\(/);
});
