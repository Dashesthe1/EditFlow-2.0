import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cliPath = path.resolve(".tmp/runtime/apps/desktop-host/src/m4-tracking-semantic-decision-cli.js");

const sample = (frameId, timeMs, x, y, jumpPx) => ({
  frameId,
  timeMs,
  point: { x, y },
  confidence: 0.95,
  normalizedError: 0.01,
  uniqueness: 0.9,
  jumpPx,
  roundTripErrorPx: 0,
  status: "STABLE",
  evidenceRefs: [`PIX_${frameId}`],
});

test("compiled M4 semantic CLI turns a stable point track into trusted motion state but refuses invented object identity", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "editflow-m4-semantic-"));
  try {
    const trackingPath = path.join(dir, "tracking.json");
    const resultPath = path.join(dir, "semantic.json");
    await writeFile(trackingPath, JSON.stringify({
      proofId: "M4_POINT_TRACK_REAL_AE_V1",
      ok: true,
      classification: "PASS",
      pointTrack: {
        targetEntityId: "M4_REAL_AE_PROOF_FEATURE",
        status: "STABLE",
        confidence: 0.95,
        samples: [
          sample("A", 0, 0.25, 0.5, 0),
          sample("B", 100, 0.3, 0.5, 2),
          sample("C", 200, 0.37, 0.5, 3),
        ],
        evidenceRefs: ["PIX_A", "PIX_B", "PIX_C"],
      },
    }), "utf8");

    const run = spawnSync(process.execPath, [cliPath, "--tracking-result", trackingPath, "--result", resultPath], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    assert.equal(result.ok, true);
    assert.equal(result.classification, "PASS_DECISION_ONLY_FAIL_CLOSED");
    assert.equal(result.semanticSubject.trackStatus, "STABLE");
    assert.equal(result.semanticSubject.trackConfidence, 0.95);
    assert.equal(result.semanticSubject.identityConfidence, 0);
    assert.equal(result.semanticSubject.geometryConfidence, 0);
    assert.equal(result.semanticSubject.motionDirection, "RIGHT");
    assert.ok(result.semanticSubject.speed > 0);
    assert.equal(result.editorBrainDecision.route, "ESCALATE");
    assert.equal(result.editorBrainDecision.intent, "DELEGATE_V0");
    assert.equal(result.editorBrainDecision.escalationReason, "LOW_OBJECT_CONFIDENCE");
    assert.equal(result.checks.noAeMutationExecuted, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
