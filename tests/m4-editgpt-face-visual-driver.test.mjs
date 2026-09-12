import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { EditGptFaceVisualDriverV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-editgpt-face-visual-driver.js";

const config = {
  executablePath: "C:\\EditGPT\\python.exe",
  scriptPath: "C:\\EditFlow\\editgpt_face_tracking_visual_driver.py",
  workingDirectory: "C:\\EditFlow",
  evidenceDirectory: "C:\\EditFlow\\proofs\\face-tracking",
  timeoutMs: 90000,
};
const request = {
  direction: "FORWARD", compHostId: 101, layerHostId: 202, maskStableId: "FACE_1",
  expectedCompName: "Face Comp", expectedLayerName: "Face Layer", expectedMaskName: "Face Mask",
  expectedControl: "FACE_ANALYZE_FORWARD",
};
const processResult = (stdout, extra = {}) => ({
  exitCode: 0, signal: null, stdout, stderr: "", timedOut: false, ...extra,
});
const binding = () => ({
  direction: request.direction, expectedControl: request.expectedControl,
  compHostId: request.compHostId, layerHostId: request.layerHostId, maskStableId: request.maskStableId,
  expectedCompName: request.expectedCompName, expectedLayerName: request.expectedLayerName, expectedMaskName: request.expectedMaskName,
});

test("face visual driver launches the fixed sidecar with a correlated Detailed Features request", async () => {
  const calls = [];
  const runner = { async run(invocation) {
    calls.push(invocation);
    return processResult(JSON.stringify({
      status: "COMPLETED", visualEvidenceId: "FACE_EVIDENCE", guardedVisualTargetVerified: true,
      targetBinding: binding(),
    }));
  } };
  const result = await new EditGptFaceVisualDriverV1(config, runner).analyze(request);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.visualEvidenceId, "FACE_EVIDENCE");
  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].args[2]);
  assert.equal(payload.schema, "editflow.face-tracking.visual.v1");
  assert.equal(payload.expectedControl, "FACE_ANALYZE_FORWARD");
  assert.equal(payload.maskStableId, "FACE_1");
  assert.equal(calls[0].args.at(-2), "--analysis-window-seconds");
  assert.equal(calls[0].args.at(-1), "4");
});

test("face visual driver fails closed on correlation mismatch, Backward, failure, and timeout", async () => {
  const mismatch = new EditGptFaceVisualDriverV1(config, { async run() {
    return processResult(JSON.stringify({
      status: "COMPLETED", visualEvidenceId: "BAD", guardedVisualTargetVerified: true,
      targetBinding: { ...binding(), maskStableId: "OTHER" },
    }));
  } });
  assert.match((await mismatch.analyze(request)).detail, /correlation mismatch/);

  let calls = 0;
  const backward = new EditGptFaceVisualDriverV1(config, { async run() { calls += 1; return processResult(""); } });
  assert.equal((await backward.analyze({ ...request, direction: "BACKWARD", expectedControl: "FACE_ANALYZE_BACKWARD" })).status, "REFUSED");
  assert.equal(calls, 0);

  const failed = new EditGptFaceVisualDriverV1(config, { async run() { return processResult("", { exitCode: 2, stderr: "face refused" }); } });
  assert.match((await failed.analyze(request)).detail, /face refused/);
  const timed = new EditGptFaceVisualDriverV1(config, { async run() { return processResult("", { exitCode: null, timedOut: true }); } });
  assert.match((await timed.analyze(request)).detail, /timed out/);
});

test("face sidecar always selects Detailed Features and leaves semantic method recognition advisory", async () => {
  const ts = await readFile("packages/adapters/ae-cep/src/m4-editgpt-face-visual-driver.ts", "utf8");
  const py = await readFile("packages/adapters/ae-cep/runtime/editgpt_face_tracking_visual_driver.py", "utf8");
  assert.match(ts, /editflow\.face-tracking\.visual\.v1/);
  assert.match(ts, /FACE_ANALYZE_FORWARD/);
  assert.match(py, /Face Tracking \(Detailed Features\)/);
  assert.match(py, /face_method_dropdown/);
  assert.match(py, /face_detailed_method_item/);
  assert.match(py, /detailedMethodPreAdvisoryMatched/);
  assert.match(py, /host facial-point readback remains authoritative/);
  assert.match(py, /boundedStopClicked/);
  assert.doesNotMatch(py, /if detailed:\s*return meta, image/);
  assert.doesNotMatch(py, /C:\\\\Users\\\\Shadow|pyautogui|SetCursorPos/);
});
