import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(name, "utf8");

test("M5 Refine Edge retained runner reuses one warm AE process and restores in finally", async () => {
  const ps = await read("scripts/windows/run-m5-roto-brush-refine-edge-live-proof.ps1");
  assert.match(ps, /m5-roto-brush-refine-edge-live-proof\.mjs/);
  assert.match(ps, /m5-roto-brush-isolation-enter\.jsx/);
  assert.match(ps, /m5-roto-brush-isolation-restore\.jsx/);
  assert.match(ps, /Get-Process -Name "AfterFX"/);
  assert.match(ps, /requires exactly one already-running After Effects process/);
  assert.match(ps, /finally\s*\{/);
  assert.match(ps, /restoreAttempted/);
  assert.match(ps, /sameAeProcess/);
  assert.match(ps, /M5_ROTO_BRUSH_REFINE_EDGE_RETAINED_REAL_AE_V1/);
  assert.match(ps, /--seed-visual-script/);
  assert.match(ps, /--refine-visual-script/);
  assert.match(ps, /--tool-select-script/);
  assert.match(ps, /if \(\$NodeExit -ne 0 -or \$Live\.ok -ne \$true\)/);
});

test("M5 Refine Edge live proof bootstraps one native Roto effect then requires native Refine Edge readback", async () => {
  const node = await read("scripts/m5-roto-brush-refine-edge-live-proof.mjs");
  assert.match(node, /GuardedRotoBrushSeedControllerV1/);
  assert.match(node, /GuardedRotoBrushRefineEdgeControllerV1/);
  assert.match(node, /EditGptRotoBrushSeedVisualDriverV1/);
  assert.match(node, /EditGptRotoBrushRefineEdgeVisualDriverV1/);
  assert.match(node, /operation: "SEED_FOREGROUND"/);
  assert.match(node, /role: "REFINE_EDGE"/);
  assert.match(node, /refine\.finalRefineEdgeStrokeCount > refine\.baselineRefineEdgeStrokeCount/);
  assert.match(node, /refine\.baselineEffectFingerprint !== refine\.finalEffectFingerprint/);
  assert.match(node, /allGaps\.every\(\(value\) => value <= 3000\)/);
  assert.match(node, /allGaps\.every\(\(value\) => value < 1000\)/);
  assert.match(node, /typedReadbackRoundtripsMs/);
});

test("M5 Refine Edge uses warm CEP native tool selection without a semantic rethink loop", async () => {
  const py = await read("packages/adapters/ae-cep/runtime/editgpt_roto_brush_refine_edge_visual_driver.py");
  const first = py.indexOf('tool_select = select_native_tool(afterfx_path, tool_select_script, "REFINE_EDGE")');
  const checkpoint = py.indexOf('tool_meta, tool_image = await capture');
  assert.ok(first >= 0 && checkpoint > first);
  const localBatch = py.slice(first, checkpoint);
  assert.doesNotMatch(localBatch, /qwen\.|verify_visible|choose_pointer_target/);
  assert.match(py, /127\.0\.0\.1:32146\/proof-script/);
  assert.match(py, /native_refine_tool_to_draw/);
  assert.match(py, /smallLayerCanvasDetected/);
  assert.match(py, /layerTabFocusBeforeMaximize/);
  assert.match(py, /\["GRAVE"\]/);
  assert.match(py, /maximized_here/);
  assert.doesNotMatch(py, /retained_tool_flyout/);
  assert.match(py, /aeActionToActionLatenciesMs/);
  assert.match(py, /inspect_error_popup/);
  assert.match(py, /acknowledgementOnly/);
});
