import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(name, "utf8");

test("M5 Roto Brush live runner is same-process, proof-owned, and restore-first", async () => {
  const ps = await read("scripts/windows/run-m5-roto-brush-live-proof.ps1");
  const fixture = await read("scripts/windows/m5-roto-brush-fixture-setup.jsx");
  assert.match(ps, /Get-Process -Name "AfterFX"/);
  assert.match(ps, /finally\s*\{/);
  assert.match(ps, /m5-roto-brush-isolation-restore\.jsx/);
  assert.match(ps, /sameAeProcess/);
  assert.match(ps, /EF2_M5_ROTO_PROOF_COMP/);
  assert.match(fixture, /EF2_M5_ROTO_/);
  assert.match(fixture, /layer\.openInViewer\(\)/);
  assert.doesNotMatch(fixture, /\b(?:app\.project|project)\.(?:save|saveAs|close)\s*\(/i);
  assert.doesNotMatch(fixture, /\bapp\.(?:quit|exit)\s*\(/i);
});

test("M5 Roto Brush readback fallback is fixed protocol-2.6 data dispatch", async () => {
  const jsx = await read("scripts/windows/m5-roto-brush-readback-dispatch.jsx");
  assert.match(jsx, /EditFlow2-m5-roto-brush-readback-request\.json/);
  assert.match(jsx, /editflow_host_current_v26\.jsx/);
  assert.match(jsx, /protocolVersion !== "2\.6\.0"/);
  assert.match(jsx, /command !== "roto_brush\.readback"/);
  assert.match(jsx, /EditFlow2_dispatch\(requestText\)/);
  assert.doesNotMatch(jsx, /eval\(requestText\)|evalScript/);
});
test("M5 seed fast path uses warm CEP native Roto Brush identity and enforces speed proof", async () => {
  const py = await read("packages/adapters/ae-cep/runtime/editgpt_roto_brush_seed_visual_driver.py");
  const node = await read("scripts/m5-roto-brush-live-proof.mjs");
  const selector = await read("scripts/windows/m5-roto-brush-tool-select.jsx");
  assert.match(py, /tool_select = select_native_tool\(afterfx_path, tool_select_script, "ROTO_BRUSH"\)/);
  assert.match(py, /127\.0\.0\.1:32146\/proof-script/);
  assert.match(py, /native_roto_tool_to_draw_seed/);
  assert.match(selector, /if \(requestedTool === "ROTO_BRUSH"\) expected = 9041/);
  assert.match(selector, /else if \(requestedTool === "REFINE_EDGE"\) expected = 9042/);
  assert.doesNotMatch(selector, /\? 9041/);
  assert.doesNotMatch(py, /retained_tool_flyout/);
  assert.match(node, /allGaps\.every\(\(value\) => value <= 3000\)/);
  assert.match(node, /finalEffectMatchCount === 1/);
  assert.match(node, /baselineEffectFingerprint !== controllerResult\.finalEffectFingerprint/);
});
