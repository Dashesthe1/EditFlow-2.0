import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  EditGptStabilizationVisualDriverV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-editgpt-stabilization-visual-driver.js";

const config = {
  executablePath: "C:\\EditGPT\\python.exe",
  scriptPath: "C:\\EditFlow\\editgpt_stabilization_visual_driver.py",
  workingDirectory: "C:\\EditFlow",
  evidenceDirectory: "C:\\EditFlow\\proofs\\stabilization",
  timeoutMs: 90000,
  analysisWindowSeconds: 4,
};

const request = {
  direction: "FORWARD",
  compHostId: 101,
  layerHostId: 202,
  expectedCompName: "Stabilize Comp",
  expectedLayerName: "Stabilize Layer",
  expectedControl: "STABILIZE_ANALYZE_APPLY_FORWARD",
};

const processResult = (stdout, extra = {}) => ({
  exitCode: 0, signal: null, stdout, stderr: "", timedOut: false, ...extra,
});
test("stabilization visual driver launches fixed sidecar with correlated request data", async () => {
  const calls = [];
  const runner = { async run(invocation) {
    calls.push(invocation);
    return processResult(JSON.stringify({
      status: "COMPLETED",
      visualEvidenceId: "STAB_EVIDENCE",
      guardedVisualTargetVerified: true,
      targetBinding: {
        direction: request.direction,
        expectedControl: request.expectedControl,
        compHostId: request.compHostId,
        layerHostId: request.layerHostId,
        expectedCompName: request.expectedCompName,
        expectedLayerName: request.expectedLayerName,
      },
    }));
  } };
  const result = await new EditGptStabilizationVisualDriverV1(config, runner).stabilize(request);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.visualEvidenceId, "STAB_EVIDENCE");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 2), [config.scriptPath, "--request-json"]);
  const payload = JSON.parse(calls[0].args[2]);
  assert.equal(payload.schema, "editflow.stabilization.visual.v1");
  assert.equal(payload.expectedControl, "STABILIZE_ANALYZE_APPLY_FORWARD");
  assert.equal(calls[0].args.at(-1), "4");
});
test("stabilization visual driver fails closed on malformed, mismatched, and backward requests", async () => {
  const malformed = new EditGptStabilizationVisualDriverV1(config, {
    async run() { return processResult("not-json"); },
  });
  assert.equal((await malformed.stabilize(request)).status, "REFUSED");

  const mismatched = new EditGptStabilizationVisualDriverV1(config, {
    async run() { return processResult(JSON.stringify({
      status: "COMPLETED", visualEvidenceId: "BAD", guardedVisualTargetVerified: true,
      targetBinding: { ...request, compHostId: 999 },
    })); },
  });
  const mismatch = await mismatched.stabilize(request);
  assert.equal(mismatch.status, "REFUSED");
  assert.match(mismatch.detail, /correlation mismatch/);

  const backward = await malformed.stabilize({ ...request, direction: "BACKWARD" });
  assert.equal(backward.status, "REFUSED");
});

test("runtime Apply path requires the real dialog and uses bottom-row CV geometry", async () => {
  const py = await readFile("packages/adapters/ae-cep/runtime/editgpt_stabilization_visual_driver.py", "utf8");
  assert.match(py, /cv2\.findContours/);
  assert.match(py, /Motion Tracker Apply Options did not open after Apply/);
  assert.match(py, /Reset\/Apply row missing|Reset\/Apply/);
  assert.match(py, /CV Apply target escaped expected bottom-right Tracker geometry/);
  assert.match(py, /Eyes geometry changed before Apply/);
  assert.match(py, /Apply target changed before action/);
  assert.match(py, /target_patch_change/);
});