import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(name, "utf8");

test("M5 Freeze state visual proof uses verified Layer binding and explicit visible state transitions", async () => {
  const py = await read("packages/adapters/ae-cep/runtime/editgpt_roto_brush_freeze_state_visual_driver.py");
  assert.match(py, /expected_layer_name/);
  assert.match(py, /VIEWER TAB for exact target layer/);
  assert.match(py, /layerTabActivated/);
  assert.match(py, /layerViewerSelectorDismissed/);
  assert.ok(py.indexOf('layerTabActivated') < py.indexOf('layerViewerSelectorDismissed'));
  assert.match(py, /select_native_tool\("", tool_select_script, "ROTO_BRUSH"\)/);
  assert.match(py, /rotoBrushToolSelection/);
  assert.match(py, /--tool-select-script/);
  assert.match(py, /freeze_state_layer_activated/);
  assert.match(py, /separate non-active Composition viewer/);
  assert.ok(py.indexOf("layerTabActivated") < py.indexOf("m5_freeze_state_layer_ready_after_activation"));
  assert.match(py, /state must be exactly FROZEN, UNFROZEN, or UNKNOWN/);
  assert.match(py, /freezeInProgress=true/);
  assert.match(py, /choose_pointer_target/);
  assert.match(py, /actual Freeze\/Unfreeze control/);
  assert.match(py, /\["GRAVE"\]/);
  assert.match(py, /wait_for_roto_state/);
  assert.match(py, /freezeInitiationSamples/);
  assert.match(py, /semantic_bbox_interior_with_visible_state_acknowledgement/);
  assert.match(py, /Freeze click did not initiate visible processing\/state change/);
  assert.ok(py.indexOf("freezeInitiationSamples") < py.indexOf("freezeWait"));
  assert.match(py, /"FROZEN"/);
  assert.match(py, /"UNFROZEN"/);
  assert.match(py, /reuse_verified_freeze_button_coordinate/);
  assert.doesNotMatch(py, /pyautogui|SetCursorPos/);
});

test("M5 Freeze retained runner preserves one warm AE process and restores exact native Roto state", async () => {
  const ps = await read("scripts/windows/run-m5-roto-brush-freeze-state-discovery.ps1");
  assert.match(ps, /requires exactly one already-running After Effects process/);
  assert.match(ps, /m5-roto-brush-isolation-enter\.jsx/);
  assert.match(ps, /m5-roto-brush-isolation-restore\.jsx/);
  assert.match(ps, /editgpt_roto_brush_freeze_state_visual_driver\.py/);
  assert.match(ps, /--tool-select-script \$ToolSelectScript/);
  assert.match(ps, /m5-floating-bridge-window\.ps1/);
  assert.match(ps, /finally\s*\{/);
  assert.match(ps, /restoreAttempted/);
  assert.match(ps, /sameAeProcess/);
  assert.match(ps, /NativeEffectRestored/);
  assert.match(ps, /\(\$NativeEffectRestored -eq \$true\)/);
  assert.match(ps, /FREEZE -> FROZEN -> UNFREEZE -> UNFROZEN/);
});

test("M5 Freeze incremental manifest is REUSE_AE and content-addresses every proof helper", async () => {
  const request = JSON.parse(await read("proofs/manifests/m5-roto-brush-freeze-state-discovery.request.json"));
  assert.equal(request.lifecycle, "REUSE_AE");
  assert.equal(request.proofStrategy, "INCREMENTAL_FIRST");
  assert.equal(request.allowEvidenceReuse, true);
  assert.ok(request.incrementalDependencies.includes("packages/adapters/ae-cep/runtime/editgpt_roto_brush_freeze_state_visual_driver.py"));
  assert.ok(request.incrementalDependencies.includes("scripts/windows/m5-floating-bridge-window.ps1"));
  assert.ok(request.focusedTests.includes("tests/m5-roto-brush-freeze-state-proof.test.mjs"));
});
