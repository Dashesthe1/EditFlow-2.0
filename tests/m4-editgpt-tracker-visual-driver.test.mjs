import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  EditGptTrackerVisualDriverV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-editgpt-tracker-visual-driver.js";

const config = {
  executablePath: "C:\\EditGPT\\python.exe",
  scriptPath: "C:\\EditFlow\\editgpt_tracker_visual_driver.py",
  workingDirectory: "C:\\EditFlow",
  evidenceDirectory: "C:\\EditFlow\\proofs\\tracker",
  timeoutMs: 90000,
};

const request = {
  direction: "FORWARD",
  trackerIndex: 1,
  pointIndex: 1,
  compHostId: 101,
  layerHostId: 202,
  expectedCompName: "Bound Comp",
  expectedLayerName: "Bound Layer",
  expectedTrackerName: "Tracker 1",
  expectedControl: "TRACKER_ANALYZE_FORWARD",
};

const processResult = (stdout, extra = {}) => ({
  exitCode: 0,
  signal: null,
  stdout,
  stderr: "",
  timedOut: false,
  ...extra,
});
test("EditGPT visual driver launches only the fixed sidecar command with request JSON as data", async () => {
  const calls = [];
  const runner = { async run(invocation) {
    calls.push(invocation);
    return processResult(JSON.stringify({
      status: "COMPLETED",
      visualEvidenceId: "EVIDENCE_1",
      guardedVisualTargetVerified: true,
      targetBinding: {
        direction: request.direction,
        expectedControl: request.expectedControl,
        compHostId: request.compHostId,
        layerHostId: request.layerHostId,
        expectedCompName: request.expectedCompName,
        expectedLayerName: request.expectedLayerName,
        expectedTrackerName: request.expectedTrackerName,
      },
    }));
  } };
  const result = await new EditGptTrackerVisualDriverV1(config, runner).analyze(request);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.visualEvidenceId, "EVIDENCE_1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executablePath, config.executablePath);
  assert.deepEqual(calls[0].args.slice(0, 2), [config.scriptPath, "--request-json"]);
  assert.equal(calls[0].args[3], "--evidence-dir");
  assert.equal(calls[0].args[4], config.evidenceDirectory);
  assert.equal(calls[0].args[5], "--analysis-window-seconds");
  assert.equal(calls[0].args[6], "5");
  const payload = JSON.parse(calls[0].args[2]);
  assert.equal(payload.schema, "editflow.tracker.visual.v1");
  assert.equal(payload.expectedCompName, "Bound Comp");
  assert.equal(payload.expectedLayerName, "Bound Layer");
});
test("EditGPT visual driver fails closed on malformed or mismatched sidecar output", async () => {
  const malformed = new EditGptTrackerVisualDriverV1(config, {
    async run() { return processResult("not-json"); },
  });
  assert.equal((await malformed.analyze(request)).status, "REFUSED");

  const mismatched = new EditGptTrackerVisualDriverV1(config, {
    async run() { return processResult(JSON.stringify({
      status: "COMPLETED",
      visualEvidenceId: "EVIDENCE_2",
      guardedVisualTargetVerified: true,
      targetBinding: {
        direction: "FORWARD",
        expectedControl: "TRACKER_ANALYZE_FORWARD",
        compHostId: 999,
        layerHostId: request.layerHostId,
        expectedCompName: request.expectedCompName,
        expectedLayerName: request.expectedLayerName,
        expectedTrackerName: request.expectedTrackerName,
      },
    })); },
  });
  const mismatch = await mismatched.analyze(request);
  assert.equal(mismatch.status, "REFUSED");
  assert.match(mismatch.detail, /correlation mismatch/);
});

test("EditGPT visual driver supports Backward only with the exact correlated control", async () => {
  let calls = 0;
  const backward = { ...request, direction: "BACKWARD", expectedControl: "TRACKER_ANALYZE_BACKWARD" };
  const runner = { async run(invocation) {
    calls += 1;
    const payload = JSON.parse(invocation.args[2]);
    assert.equal(payload.direction, "BACKWARD");
    assert.equal(payload.expectedControl, "TRACKER_ANALYZE_BACKWARD");
    return processResult(JSON.stringify({
      status: "COMPLETED", visualEvidenceId: "EVIDENCE_BACKWARD", guardedVisualTargetVerified: true,
      targetBinding: {
        direction: backward.direction, expectedControl: backward.expectedControl,
        compHostId: backward.compHostId, layerHostId: backward.layerHostId,
        expectedCompName: backward.expectedCompName, expectedLayerName: backward.expectedLayerName,
        expectedTrackerName: backward.expectedTrackerName,
      },
    }));
  } };
  const driver = new EditGptTrackerVisualDriverV1(config, runner);
  assert.equal((await driver.analyze(backward)).status, "COMPLETED");
  assert.equal(calls, 1);
  const mismatch = await driver.analyze({ ...backward, expectedControl: "TRACKER_ANALYZE_FORWARD" });
  assert.equal(mismatch.status, "REFUSED");
  assert.equal(calls, 1);
});
test("EditGPT visual driver refuses sidecar failure and timeout", async () => {
  const failed = new EditGptTrackerVisualDriverV1(config, {
    async run() { return processResult("", { exitCode: 2, stderr: "sidecar refused" }); },
  });
  assert.match((await failed.analyze(request)).detail, /sidecar refused/);

  const timed = new EditGptTrackerVisualDriverV1(config, {
    async run() { return processResult("", { exitCode: null, timedOut: true }); },
  });
  assert.match((await timed.analyze(request)).detail, /timed out/);
});

test("production visual route is shell-free, target-bound, and contains no workstation path", async () => {
  const ts = await readFile("packages/adapters/ae-cep/src/m4-editgpt-tracker-visual-driver.ts", "utf8");
  const py = await readFile("packages/adapters/ae-cep/runtime/editgpt_tracker_visual_driver.py", "utf8");
  assert.match(ts, /shell:\s*false/);
  assert.doesNotMatch(ts, /exec\(|execFile\(|Invoke-Expression|cmd\.exe/);
  assert.match(py, /visible AE state does not match the typed tracker target/);
  assert.match(py, /detect_analyze_row_cv/);
  assert.match(py, /2-1-1-2 Tracker Analyze row signature/);
  assert.match(py, /target_patch_change/);
  assert.match(py, /one-frame forward/);
  assert.match(py, /one-frame backward/);
  assert.match(py, /controlFillRatio/);
  assert.match(py, /active Stop state/);
  assert.match(py, /fillRatios/);
  assert.match(py, /STOP_CLICKED/);
  assert.match(py, /result\.json/);
  assert.match(py, /Tracker Motion Target/);
  assert.match(py, /Motion Source field to equal the layer name/);
  assert.match(py, /targetBinding/);
  assert.doesNotMatch(py, /C:\\\\Users\\\\Shadow|pyautogui|SetCursorPos/);
});
