import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  EditGptRotoBrushPropagationVisualDriverV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-editgpt-roto-brush-propagation-visual-driver.js";

const config = {
  executablePath: "C:\\EditGPT\\python.exe",
  scriptPath: "C:\\EditFlow\\editgpt_roto_brush_propagation_visual_driver.py",
  workingDirectory: "C:\\EditFlow",
  evidenceDirectory: "C:\\EditFlow\\proofs\\m5-roto-propagation",
  timeoutMs: 90000,
};
const request = {
  operation: "PROPAGATE_FORWARD",
  compHostId: 101,
  layerHostId: 202,
  expectedCompName: "Roto Proof",
  expectedLayerName: "Subject",
  expectedSessionRevision: "ROTO_REV_1",
  expectedEffectFingerprint: "ROTO_EFFECT_1",
  expectedEffectMatchCount: 1,
  range: { startTime: 0.5, endTime: 0.55 },
  frameDuration: 1 / 60,
  expectedFrameSteps: 3,
  expectedStartTime: 0.5,
  expectedEndTime: 0.55,
  evidenceIds: ["EVIDENCE_PROP_1"],
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
  range: value.range,
  frameDuration: value.frameDuration,
  expectedFrameSteps: value.expectedFrameSteps,
  expectedStartTime: value.expectedStartTime,
  expectedEndTime: value.expectedEndTime,
  evidenceIds: value.evidenceIds,
});
const processResult = (stdout, extra = {}) => ({
  exitCode: 0, signal: null, stdout, stderr: "", timedOut: false, ...extra,
});
test("Roto Brush propagation visual driver launches an exact correlated forward sidecar", async () => {
  const calls = [];
  const runner = { async run(invocation) {
    calls.push(invocation);
    return processResult(JSON.stringify({
      status: "COMPLETED", propagationVisualVerified: true,
      finalVisualEvidenceId: "ROTO_PROP_EVIDENCE", frameSteps: 3,
      targetBinding: binding(), aeActionToActionLatenciesMs: [130, 140],
    }));
  } };
  const driver = new EditGptRotoBrushPropagationVisualDriverV1(config, runner);
  const result = await driver.propagate(request);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.finalVisualEvidenceId, "ROTO_PROP_EVIDENCE");
  assert.deepEqual(result.aeActionToActionLatenciesMs, [130, 140]);
  assert.deepEqual(driver.supportedDirections, ["PROPAGATE_FORWARD", "PROPAGATE_BACKWARD"]);
  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].args[2]);
  assert.equal(payload.schema, "editflow.roto-brush-propagation.visual.v1");
  assert.equal(payload.operation, "PROPAGATE_FORWARD");
  assert.equal(payload.expectedFrameSteps, 3);
  assert.deepEqual(payload.range, request.range);
});
test("Roto Brush propagation visual driver accepts the exact backward direction", async () => {
  const backward = {
    ...request,
    operation: "PROPAGATE_BACKWARD",
    range: { startTime: 0.45, endTime: 0.5 },
    expectedStartTime: 0.5,
    expectedEndTime: 0.45,
  };
  const driver = new EditGptRotoBrushPropagationVisualDriverV1(config, { async run() {
    return processResult(JSON.stringify({
      status: "COMPLETED", propagationVisualVerified: true,
      finalVisualEvidenceId: "BACKWARD_EVIDENCE", frameSteps: 3,
      targetBinding: binding(backward), aeActionToActionLatenciesMs: [125, 128],
    }));
  } });
  const result = await driver.propagate(backward);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.frameSteps, 3);
});

test("correlation mismatch, wrong step count, and timeout fail closed", async () => {
  const mismatch = new EditGptRotoBrushPropagationVisualDriverV1(config, { async run() {
    return processResult(JSON.stringify({
      status: "COMPLETED", propagationVisualVerified: true,
      finalVisualEvidenceId: "BAD", frameSteps: 3,
      targetBinding: { ...binding(), expectedSessionRevision: "OTHER" },
    }));
  } });
  assert.match((await mismatch.propagate(request)).detail, /correlation mismatch/);

  const wrongSteps = new EditGptRotoBrushPropagationVisualDriverV1(config, { async run() {
    return processResult(JSON.stringify({
      status: "COMPLETED", propagationVisualVerified: true,
      finalVisualEvidenceId: "BAD", frameSteps: 2,
      targetBinding: binding(),
    }));
  } });
  assert.match((await wrongSteps.propagate(request)).detail, /verified propagation evidence/);

  const timed = new EditGptRotoBrushPropagationVisualDriverV1(config, { async run() {
    return processResult("", { exitCode: null, timedOut: true });
  } });
  assert.match((await timed.propagate(request)).detail, /timed out/);
});

test("propagation sidecar is bounded, popup-aware, and uses fast frame-step actions", async () => {
  const ts = await readFile("packages/adapters/ae-cep/src/m5-editgpt-roto-brush-propagation-visual-driver.ts", "utf8");
  const py = await readFile("packages/adapters/ae-cep/runtime/editgpt_roto_brush_propagation_visual_driver.py", "utf8");
  assert.match(ts, /expectedFrameSteps/);
  assert.match(ts, /expectedEffectFingerprint/);
  assert.match(py, /expectedFrameSteps/);
  assert.match(py, /\["CTRL", "RIGHT"\]/);
  assert.match(py, /\["CTRL", "LEFT"\]/);
  assert.match(py, /hands_keypress/);
  assert.match(py, /actionToActionLatenciesMs/);
  assert.match(py, /inspect_error_popup/);
  assert.match(py, /acknowledgementOnly/);
  assert.match(py, /segmentationPre/);
  assert.match(py, /segmentationAfter/);
  assert.doesNotMatch(py, /pyautogui|SetCursorPos|C:\\\\Users\\\\Shadow/);
});
