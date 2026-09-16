import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { EditGptRotoBrushRepairVisualDriverV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-editgpt-roto-brush-repair-visual-driver.js";

const config = {
  executablePath: "C:\\EditGPT\\python.exe",
  scriptPath: "C:\\EditFlow\\editgpt_roto_brush_repair_visual_driver.py",
  workingDirectory: "C:\\EditFlow",
  afterFxPath: "C:\\Adobe\\AfterFX.exe",
  toolSelectScriptPath: "C:\\EditFlow\\m5-roto-brush-tool-select.jsx",
  evidenceDirectory: "C:\\EditFlow\\proofs\\m5-roto-repair",
  timeoutMs: 90000,
};
const request = {
  operation: "REPAIR_STROKE",
  compHostId: 101,
  layerHostId: 202,
  expectedCompName: "Roto Proof",
  expectedLayerName: "Subject",
  expectedSessionRevision: "ROTO_REV_2",
  expectedEffectFingerprint: "ROTO_EFFECT_2",
  expectedEffectMatchCount: 1,
  atTime: 0.5,
  stroke: { role: "FOREGROUND", pointsNormalized: [{ x: 0.48, y: 0.4 }, { x: 0.52, y: 0.55 }], radiusNormalized: 0.03 },
  expectedTool: "ROTO_BRUSH",
  evidenceIds: ["EVIDENCE_REPAIR_1"],
};
const binding = (value = request) => ({
  operation: value.operation,
  compHostId: value.compHostId,
  layerHostId: value.layerHostId,
  expectedCompName: value.expectedCompName,
  expectedLayerName: value.expectedLayerName,
  expectedSessionRevision: value.expectedSessionRevision,
  expectedEffectFingerprint: value.expectedEffectFingerprint,
  expectedEffectMatchCount: value.expectedEffectMatchCount,
  atTime: value.atTime,
  stroke: value.stroke,
  expectedTool: value.expectedTool,
  evidenceIds: value.evidenceIds,
});
const processResult = (stdout, extra = {}) => ({
  exitCode: 0, signal: null, stdout, stderr: "", timedOut: false, ...extra,
});

test("Roto Brush repair visual driver launches one fixed correlated sidecar", async () => {
  const calls = [];
  const runner = { async run(invocation) {
    calls.push(invocation);
    return processResult(JSON.stringify({
      status: "COMPLETED", visualEvidenceId: "REPAIR_EVIDENCE", guardedVisualTargetVerified: true,
      nativeRepairStrokeAttempted: true, visibleRepairChangeObserved: true,
      targetBinding: binding(), aeActionToActionLatenciesMs: [190],
    }));
  } };
  const driver = new EditGptRotoBrushRepairVisualDriverV1(config, runner);
  const result = await driver.repair(request);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.visibleRepairChangeObserved, true);
  assert.deepEqual(result.aeActionToActionLatenciesMs, [190]);
  assert.deepEqual(driver.supportedRoles, ["FOREGROUND", "BACKGROUND"]);
  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].args[2]);
  assert.equal(payload.schema, "editflow.roto-brush-repair.visual.v1");
  assert.equal(payload.operation, "REPAIR_STROKE");
  assert.equal(payload.expectedEffectFingerprint, request.expectedEffectFingerprint);
  assert.deepEqual(payload.stroke, request.stroke);
});

test("Roto Brush repair visual driver fails closed on correlation or visible-proof loss", async () => {
  const mismatch = new EditGptRotoBrushRepairVisualDriverV1(config, { async run() {
    return processResult(JSON.stringify({
      status: "COMPLETED", visualEvidenceId: "BAD", guardedVisualTargetVerified: true,
      nativeRepairStrokeAttempted: true, visibleRepairChangeObserved: true,
      targetBinding: { ...binding(), expectedEffectFingerprint: "OTHER" },
    }));
  } });
  assert.match((await mismatch.repair(request)).detail, /correlation mismatch/);
  const invisible = new EditGptRotoBrushRepairVisualDriverV1(config, { async run() {
    return processResult(JSON.stringify({
      status: "COMPLETED", visualEvidenceId: "BAD", guardedVisualTargetVerified: true,
      nativeRepairStrokeAttempted: true, visibleRepairChangeObserved: false, targetBinding: binding(),
    }));
  } });
  assert.match((await invisible.repair(request)).detail, /visible repair evidence/);
  const badRole = await new EditGptRotoBrushRepairVisualDriverV1(config, { async run() { throw new Error("unreachable"); } })
    .repair({ ...request, stroke: { ...request.stroke, role: "REFINE_EDGE" } });
  assert.match(badRole.detail, /FOREGROUND or BACKGROUND/);
});

test("Roto Brush repair sidecar keeps routine tool-to-stroke execution local and popup-aware", async () => {
  const py = await readFile("packages/adapters/ae-cep/runtime/editgpt_roto_brush_repair_visual_driver.py", "utf8");
  const first = py.indexOf('tool_select = select_native_tool(afterfx_path, tool_select_script, "ROTO_BRUSH")');
  const checkpoint = py.indexOf('tool_meta, tool_image = await capture', first);
  assert.ok(first >= 0 && checkpoint > first);
  const localBatch = py.slice(first, checkpoint);
  assert.doesNotMatch(localBatch, /qwen\.|verify_visible|choose_pointer_target/);
  assert.match(py, /native_roto_tool_to_draw_repair/);
  assert.match(py, /visibleRepairChange/);
  assert.match(py, /visibleRepairChangeObserved/);
  assert.match(py, /stroke_modifiers = \["ALT"\] if request\["stroke"\]\["role"\] == "BACKGROUND"/);
  assert.match(py, /127\.0\.0\.1:32146\/proof-script/);
  assert.match(py, /acknowledgementOnly/);
  assert.match(py, /aeActionToActionLatenciesMs/);
});

test("repair sidecar is exact-target, popup-aware, same-path visible-change guarded, and avoids raw desktop APIs", async () => {
  const py = await readFile("packages/adapters/ae-cep/runtime/editgpt_roto_brush_repair_visual_driver.py", "utf8");
  assert.match(py, /editflow\.roto-brush-repair\.visual\.v1/);
  assert.match(py, /expectedEffectFingerprint/);
  assert.match(py, /operation != "REPAIR_STROKE"/);
  assert.match(py, /stroke_modifiers = \["ALT"\] if request\["stroke"\]\["role"\] == "BACKGROUND"/);
  assert.match(py, /visible_repair_change = target_patch_change\(tool_image, final_image, repair_bounds\)/);
  assert.match(py, /visibleRepairChangeObserved/);
  assert.match(py, /nativeRepairStrokeAttempted/);
  assert.match(py, /inspect_error_popup/);
  assert.match(py, /acknowledgementOnly/);
  assert.match(py, /127\.0\.0\.1:32146\/proof-script/);
  assert.doesNotMatch(py, /pyautogui|SetCursorPos/);
});
test("Roto Brush repair visual driver safely maximizes a verified Layer viewer when canvas grounding is too small", async () => {
  const py = await readFile("packages/adapters/ae-cep/runtime/editgpt_roto_brush_repair_visual_driver.py", "utf8");
  assert.match(py, /smallLayerCanvasDetected/);
  assert.match(py, /letterbox\/pillarbox padding/);
  assert.match(py, /image\.shape\[0\] \* image\.shape\[1\] \* 0\.08/);
  assert.match(py, /layerTabFocusBeforeMaximize/);
  assert.match(py, /\["GRAVE"\]/);
  assert.match(py, /maximized_here = True/);
  assert.match(py, /if maximized_here:/);
  assert.match(py, /verify_target_binding\(qwen, canvas_image, request, "m5_roto_repair_binding_maximized"\)/);
  assert.doesNotMatch(py, /did not change enough after maximizing Layer viewer/);
});
