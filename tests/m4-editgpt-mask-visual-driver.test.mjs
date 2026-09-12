import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EditGptMaskVisualDriverV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-editgpt-mask-visual-driver.js";

const config = {
  executablePath: "C:\\EditGPT\\python.exe",
  scriptPath: "C:\\EditFlow\\editgpt_mask_tracking_visual_driver.py",
  workingDirectory: "C:\\EditFlow",
  evidenceDirectory: "C:\\EditFlow\\proofs\\mask-tracking",
  timeoutMs: 90000,
};
const request = {
  direction: "FORWARD", compHostId: 101, layerHostId: 202, maskStableId: "MASK_1",
  expectedCompName: "Bound Comp", expectedLayerName: "Bound Layer", expectedMaskName: "Track Mask",
  expectedControl: "MASK_ANALYZE_FORWARD",
};
const processResult = (stdout, extra = {}) => ({
  exitCode: 0, signal: null, stdout, stderr: "", timedOut: false, ...extra,
});
const binding = () => ({
  direction: request.direction, expectedControl: request.expectedControl,
  compHostId: request.compHostId, layerHostId: request.layerHostId, maskStableId: request.maskStableId,
  expectedCompName: request.expectedCompName, expectedLayerName: request.expectedLayerName, expectedMaskName: request.expectedMaskName,
});
test("mask visual driver launches the fixed sidecar with a correlated request schema", async () => {
  const calls = [];
  const runner = { async run(invocation) {
    calls.push(invocation);
    return processResult(JSON.stringify({
      status: "COMPLETED", visualEvidenceId: "MASK_EVIDENCE", guardedVisualTargetVerified: true,
      targetBinding: binding(),
    }));
  } };
  const result = await new EditGptMaskVisualDriverV1(config, runner).analyze(request);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.visualEvidenceId, "MASK_EVIDENCE");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executablePath, config.executablePath);
  const payload = JSON.parse(calls[0].args[2]);
  assert.equal(payload.schema, "editflow.mask-tracking.visual.v1");
  assert.equal(payload.maskStableId, "MASK_1");
  assert.equal(payload.expectedMaskName, "Track Mask");
  assert.equal(calls[0].args.at(-2), "--analysis-window-seconds");
  assert.equal(calls[0].args.at(-1), "3");
});
test("mask visual driver fails closed on correlation mismatch, Backward, failure, and timeout", async () => {
  const mismatch = new EditGptMaskVisualDriverV1(config, { async run() {
    return processResult(JSON.stringify({
      status: "COMPLETED", visualEvidenceId: "BAD", guardedVisualTargetVerified: true,
      targetBinding: { ...binding(), maskStableId: "OTHER" },
    }));
  } });
  assert.match((await mismatch.analyze(request)).detail, /correlation mismatch/);

  let calls = 0;
  const backward = new EditGptMaskVisualDriverV1(config, { async run() { calls += 1; return processResult(""); } });
  assert.equal((await backward.analyze({ ...request, direction: "BACKWARD", expectedControl: "MASK_ANALYZE_BACKWARD" })).status, "REFUSED");
  assert.equal(calls, 0);

  const failed = new EditGptMaskVisualDriverV1(config, { async run() { return processResult("", { exitCode: 2, stderr: "mask refused" }); } });
  assert.match((await failed.analyze(request)).detail, /mask refused/);
  const timed = new EditGptMaskVisualDriverV1(config, { async run() { return processResult("", { exitCode: null, timedOut: true }); } });
  assert.match((await timed.analyze(request)).detail, /timed out/);
});
test("mask sidecar is target-bound and explicitly verifies mask tracking mode", async () => {
  const ts = await readFile("packages/adapters/ae-cep/src/m4-editgpt-mask-visual-driver.ts", "utf8");
  const py = await readFile("packages/adapters/ae-cep/runtime/editgpt_mask_tracking_visual_driver.py", "utf8");
  assert.match(ts, /editflow\.mask-tracking\.visual\.v1/);
  assert.match(ts, /maskStableId/);
  assert.match(py, /Masks (?:selector|field)/);
  assert.match(py, /Method selector/);
  assert.match(py, /Reject point Track Motion mode/);
  assert.match(py, /verify_mask_binding/);
  assert.match(py, /boundedStopClicked/);
  assert.match(py, /analyzeRowRestoredAdvisory/);
  assert.doesNotMatch(py, /C:\\\\Users\\\\Shadow|pyautogui|SetCursorPos/);
});
