import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { EditGptRotoBrushSeedVisualDriverV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-editgpt-roto-brush-seed-visual-driver.js";

const config = {
  executablePath: "C:\\EditGPT\\python.exe",
  scriptPath: "C:\\EditFlow\\editgpt_roto_brush_seed_visual_driver.py",
  workingDirectory: "C:\\EditFlow",
  afterFxPath: "C:\\Adobe\\AfterFX.exe",
  toolSelectScriptPath: "C:\\EditFlow\\m5-roto-brush-tool-select.jsx",
  evidenceDirectory: "C:\\EditFlow\\proofs\\m5-roto-seed",
  timeoutMs: 90000,
};
const request = {
  operation: "SEED_FOREGROUND",
  compHostId: 101,
  layerHostId: 202,
  expectedCompName: "Roto Proof",
  expectedLayerName: "Subject",
  expectedSessionRevision: "ROTO_REV_1",
  expectedEffectMatchCount: 0,
  atTime: 0.5,
  stroke: { role: "FOREGROUND", pointsNormalized: [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.6 }], radiusNormalized: 0.04 },
  expectedTool: "ROTO_BRUSH",
  evidenceIds: ["EVIDENCE_1"],
};
const binding = (value = request) => ({
  operation: value.operation,
  compHostId: value.compHostId,
  layerHostId: value.layerHostId,
  expectedCompName: value.expectedCompName,
  expectedLayerName: value.expectedLayerName,
  expectedSessionRevision: value.expectedSessionRevision,
  expectedEffectMatchCount: value.expectedEffectMatchCount,
  atTime: value.atTime,
  stroke: value.stroke,
  expectedTool: value.expectedTool,
  evidenceIds: value.evidenceIds,
});
const processResult = (stdout, extra = {}) => ({
  exitCode: 0, signal: null, stdout, stderr: "", timedOut: false, ...extra,
});

test("Roto Brush seed visual driver launches a fixed correlated foreground sidecar", async () => {
  const calls = [];
  const runner = { async run(invocation) {
    calls.push(invocation);
    return processResult(JSON.stringify({
      status: "COMPLETED", visualEvidenceId: "ROTO_EVIDENCE", guardedVisualTargetVerified: true,
      nativeStrokeAttempted: true, targetBinding: binding(), aeActionToActionLatenciesMs: [420],
    }));
  } };
  const driver = new EditGptRotoBrushSeedVisualDriverV1(config, runner);
  const result = await driver.seed(request);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.visualEvidenceId, "ROTO_EVIDENCE");
  assert.deepEqual(result.aeActionToActionLatenciesMs, [420]);
  assert.deepEqual(driver.supportedRoles, ["FOREGROUND", "BACKGROUND"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executablePath, config.executablePath);
  const payload = JSON.parse(calls[0].args[2]);
  assert.equal(payload.schema, "editflow.roto-brush-seed.visual.v1");
  assert.equal(payload.operation, "SEED_FOREGROUND");
  assert.deepEqual(payload.stroke, request.stroke);
  assert.deepEqual(payload.evidenceIds, ["EVIDENCE_1"]);
});

test("Roto Brush seed visual driver launches correlated background sidecar", async () => {
  const calls = [];
  const backgroundRequest = {
    ...request,
    operation: "SEED_BACKGROUND",
    stroke: { ...request.stroke, role: "BACKGROUND" },
  };
  const driver = new EditGptRotoBrushSeedVisualDriverV1(config, { async run(invocation) {
    calls.push(invocation);
    return processResult(JSON.stringify({
      status: "COMPLETED", visualEvidenceId: "ROTO_BACKGROUND_EVIDENCE", guardedVisualTargetVerified: true,
      nativeStrokeAttempted: true, targetBinding: binding(backgroundRequest), aeActionToActionLatenciesMs: [410],
    }));
  } });
  const result = await driver.seed(backgroundRequest);
  assert.equal(result.status, "COMPLETED");
  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].args[2]);
  assert.equal(payload.operation, "SEED_BACKGROUND");
  assert.equal(payload.stroke.role, "BACKGROUND");
});
test("Roto Brush seed visual driver fails closed on mismatched or unverified sidecar output", async () => {
  const mismatch = new EditGptRotoBrushSeedVisualDriverV1(config, { async run() {
    return processResult(JSON.stringify({
      status: "COMPLETED", visualEvidenceId: "BAD", guardedVisualTargetVerified: true,
      nativeStrokeAttempted: true, targetBinding: { ...binding(), expectedSessionRevision: "OTHER" },
    }));
  } });
  assert.match((await mismatch.seed(request)).detail, /correlation mismatch/);

  const unverified = new EditGptRotoBrushSeedVisualDriverV1(config, { async run() {
    return processResult(JSON.stringify({
      status: "COMPLETED", visualEvidenceId: "BAD", guardedVisualTargetVerified: false,
      nativeStrokeAttempted: true, targetBinding: binding(),
    }));
  } });
  assert.match((await unverified.seed(request)).detail, /verified stroke evidence/);

  const timed = new EditGptRotoBrushSeedVisualDriverV1(config, { async run() {
    return processResult("", { exitCode: null, timedOut: true });
  } });
  assert.match((await timed.seed(request)).detail, /timed out/);
});
test("Roto Brush seed sidecar is target-bound, normalized, popup-aware, and uses guarded modifier drag", async () => {
  const ts = await readFile("packages/adapters/ae-cep/src/m5-editgpt-roto-brush-seed-visual-driver.ts", "utf8");
  const py = await readFile("packages/adapters/ae-cep/runtime/editgpt_roto_brush_seed_visual_driver.py", "utf8");
  assert.match(ts, /supportedRoles = Object\.freeze\(\["FOREGROUND", "BACKGROUND"\]/);
  assert.match(ts, /expectedSessionRevision/);
  assert.match(ts, /JSON\.stringify\(binding\["stroke"\]\)/);
  assert.match(py, /pointsNormalized/);
  assert.match(py, /locate_layer_canvas/);
  assert.match(py, /hands_computer_action/);
  assert.match(py, /"type": "drag"/);
  assert.match(py, /stroke_modifiers = \["ALT"\]/);
  assert.match(py, /"modifiers": stroke_modifiers/);
  assert.match(py, /tool_select = select_native_tool\(afterfx_path, tool_select_script, "ROTO_BRUSH"\)/);
  assert.match(py, /127\.0\.0\.1:32146\/proof-script/);
  assert.match(py, /dispatchTransport.*WARM_CEP/);
  assert.match(py, /expected_tool_type = "9041"/);
  assert.doesNotMatch(py, /retained_tool_flyout/);
  assert.match(py, /inspect_error_popup/);
  assert.match(py, /acknowledgementOnly/);
  assert.match(py, /isModalDialog/);
  assert.match(py, /blocksEditorUI/);
  assert.match(py, /modalFalsePositiveRejected/);
  assert.match(py, /Local runtime unavailable: Failed to fetch/);
  assert.match(py, /aeActionToActionLatenciesMs/);
  assert.doesNotMatch(py, /pyautogui|SetCursorPos|C:\\\\Users\\\\Shadow/);
});
