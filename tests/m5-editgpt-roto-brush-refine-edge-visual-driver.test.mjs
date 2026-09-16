import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { EditGptRotoBrushRefineEdgeVisualDriverV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-editgpt-roto-brush-refine-edge-visual-driver.js";

const config = {
  executablePath: "C:\\EditGPT\\python.exe",
  scriptPath: "C:\\EditFlow\\editgpt_roto_brush_refine_edge_visual_driver.py",
  workingDirectory: "C:\\EditFlow",
  afterFxPath: "C:\\Adobe\\AfterFX.exe",
  toolSelectScriptPath: "C:\\EditFlow\\m5-roto-brush-tool-select.jsx",
  evidenceDirectory: "C:\\EditFlow\\proofs\\m5-roto-refine",
  timeoutMs: 90000,
};
const request = {
  operation: "REFINE_EDGE",
  compHostId: 101,
  layerHostId: 202,
  expectedCompName: "Roto Proof",
  expectedLayerName: "Subject",
  expectedSessionRevision: "ROTO_REV_1",
  expectedEffectFingerprint: "ROTO_EFFECT_V26_ABC",
  expectedEffectMatchCount: 1,
  atTime: 0.5,
  stroke: { role: "REFINE_EDGE", pointsNormalized: [{ x: 0.31, y: 0.24 }, { x: 0.36, y: 0.36 }], radiusNormalized: 0.02 },
  expectedTool: "REFINE_EDGE",
  evidenceIds: ["REFINE_EVIDENCE_1"],
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

test("Refine Edge visual driver launches one exact correlated sidecar", async () => {
  const calls = [];
  const runner = { async run(invocation) {
    calls.push(invocation);
    return processResult(JSON.stringify({
      status: "COMPLETED", visualEvidenceId: "REFINE_VISUAL", guardedVisualTargetVerified: true,
      nativeStrokeAttempted: true, targetBinding: binding(), aeActionToActionLatenciesMs: [70, 75, 190],
    }));
  } };
  const driver = new EditGptRotoBrushRefineEdgeVisualDriverV1(config, runner);
  const result = await driver.refine(request);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.visualEvidenceId, "REFINE_VISUAL");
  assert.deepEqual(result.aeActionToActionLatenciesMs, [70, 75, 190]);
  assert.equal(driver.supportsRefineEdge, true);
  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].args[2]);
  assert.equal(payload.schema, "editflow.roto-brush-refine-edge.visual.v1");
  assert.equal(payload.operation, "REFINE_EDGE");
  assert.equal(payload.expectedEffectFingerprint, request.expectedEffectFingerprint);
  assert.deepEqual(payload.stroke, request.stroke);
});

test("Refine Edge visual driver refuses mismatched role or missing native effect guard before launch", async () => {
  const calls = [];
  const driver = new EditGptRotoBrushRefineEdgeVisualDriverV1(config, { async run(invocation) {
    calls.push(invocation);
    return processResult("{}");
  } });
  assert.match((await driver.refine({ ...request, stroke: { ...request.stroke, role: "FOREGROUND" } })).detail, /REFINE_EDGE/);
  assert.match((await driver.refine({ ...request, expectedEffectMatchCount: 0 })).detail, /native effect/);
  assert.equal(calls.length, 0);
});

test("Refine Edge visual driver fails closed on sidecar correlation, evidence, or timeout failures", async () => {
  const mismatch = new EditGptRotoBrushRefineEdgeVisualDriverV1(config, { async run() {
    return processResult(JSON.stringify({
      status: "COMPLETED", visualEvidenceId: "BAD", guardedVisualTargetVerified: true,
      nativeStrokeAttempted: true, targetBinding: { ...binding(), expectedEffectFingerprint: "OTHER" },
    }));
  } });
  assert.match((await mismatch.refine(request)).detail, /correlation mismatch/);
  const unverified = new EditGptRotoBrushRefineEdgeVisualDriverV1(config, { async run() {
    return processResult(JSON.stringify({
      status: "COMPLETED", visualEvidenceId: "BAD", guardedVisualTargetVerified: false,
      nativeStrokeAttempted: true, targetBinding: binding(),
    }));
  } });
  assert.match((await unverified.refine(request)).detail, /verified stroke evidence/);
  const timed = new EditGptRotoBrushRefineEdgeVisualDriverV1(config, { async run() {
    return processResult("", { exitCode: null, timedOut: true });
  } });
  assert.match((await timed.refine(request)).detail, /timed out/);
});

test("Refine Edge sidecar uses exact native tool selection, grounds normalized stroke, and handles modal errors", async () => {
  const ts = await readFile("packages/adapters/ae-cep/src/m5-editgpt-roto-brush-refine-edge-visual-driver.ts", "utf8");
  const py = await readFile("packages/adapters/ae-cep/runtime/editgpt_roto_brush_refine_edge_visual_driver.py", "utf8");
  assert.match(ts, /supportsRefineEdge = true/);
  assert.match(ts, /expectedEffectFingerprint/);
  assert.match(ts, /JSON\.stringify\(binding\["stroke"\]\)/);
  assert.match(py, /stroke\.role must be REFINE_EDGE/);
  assert.match(py, /locate_layer_canvas/);
  assert.match(py, /local_frame_stability_lease/);
  assert.match(py, /requiredConsecutiveStableFrames/);
  assert.match(py, /smallLayerCanvasDetected/);
  assert.match(py, /layerTabFocusBeforeMaximize/);
  assert.match(py, /\["GRAVE"\]/);
  assert.match(py, /maximized_here/);
  assert.match(py, /hands_computer_action/);
  assert.match(py, /"type": "drag"/);
  assert.match(py, /"modifiers": \[\]/);
  assert.match(py, /tool_select = select_native_tool\(afterfx_path, tool_select_script, "REFINE_EDGE"\)/);
  assert.match(py, /127\.0\.0\.1:32146\/proof-script/);
  assert.match(py, /dispatchTransport.*WARM_CEP/);
  assert.match(py, /"9042" if tool == "REFINE_EDGE"/);
  assert.doesNotMatch(py, /retained_tool_flyout/);
  assert.match(py, /inspect_error_popup/);
  assert.match(py, /acknowledgementOnly/);
  assert.match(py, /aeActionToActionLatenciesMs/);
  assert.doesNotMatch(py, /pyautogui|SetCursorPos|C:\\\\Users\\\\Shadow/);
});