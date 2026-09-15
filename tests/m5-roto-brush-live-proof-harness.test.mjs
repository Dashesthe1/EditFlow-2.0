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
test("M5 seed fast path keeps retained Roto Brush flyout actions local and enforces speed proof", async () => {
  const py = await read("packages/adapters/ae-cep/runtime/editgpt_roto_brush_seed_visual_driver.py");
  const node = await read("scripts/m5-roto-brush-live-proof.mjs");
  assert.match(py, /select_grouped_toolbar_tool/);
  assert.match(py, /retained_tool_flyout/);
  assert.match(py, /flyout_hold_to_roto_member_click/);
  assert.match(py, /roto_member_click_to_draw_seed/);
  assert.match(py, /holdToMemberClickGapMs/);
  assert.match(node, /allGaps\.every\(\(value\) => value <= 3000\)/);
  assert.match(node, /finalEffectMatchCount === 1/);
  assert.match(node, /baselineEffectFingerprint !== controllerResult\.finalEffectFingerprint/);
});
