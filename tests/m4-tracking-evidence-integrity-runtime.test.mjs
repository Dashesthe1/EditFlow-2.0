import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cliPath = path.resolve(".tmp/runtime/apps/desktop-host/src/m4-tracking-evidence-integrity-cli.js");

test("compiled M4 integrity CLI hashes the complete retained evidence set deterministically", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "editflow-m4-integrity-"));
  try {
    const trackingPath = path.join(dir, "result.json");
    const semanticPath = path.join(dir, "semantic-decision.json");
    const completionPath = path.join(dir, "m4.tif.editflow-render.json");
    const manifestPath = `${completionPath}.frames.json`;
    const frame0 = path.join(dir, "m4_00000.tif");
    const frame1 = path.join(dir, "m4_00001.tif");
    const integrityPath = path.join(dir, "evidence-integrity.json");

    await writeFile(frame0, "frame-zero", "utf8");
    await writeFile(frame1, "frame-one", "utf8");
    await writeFile(completionPath, JSON.stringify({ status: "DONE", ok: true }), "utf8");
    await writeFile(manifestPath, JSON.stringify({ status: "DONE", ok: true, framePaths: [frame0, frame1] }), "utf8");
    await writeFile(trackingPath, JSON.stringify({
      proofId: "M4_POINT_TRACK_REAL_AE_V1",
      ok: true,
      classification: "PASS",
      renderReadback: { completionPath, trackingSequenceManifestPath: manifestPath },
      manifest: { framePaths: [frame0, frame1] },
    }), "utf8");
    await writeFile(semanticPath, JSON.stringify({
      proofId: "M4_TRACK_TO_BRAIN_DECISION_ONLY_V1",
      ok: true,
      classification: "PASS_DECISION_ONLY_FAIL_CLOSED",
    }), "utf8");

    const run = spawnSync(process.execPath, [
      cliPath,
      "--artifact-root", dir,
      "--tracking-result", trackingPath,
      "--semantic-result", semanticPath,
      "--result", integrityPath,
    ], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const result = JSON.parse(await readFile(integrityPath, "utf8"));
    assert.equal(result.ok, true);
    assert.equal(result.classification, "PASS");
    assert.equal(result.algorithm, "SHA-256");
    assert.equal(result.artifactCount, 6);
    assert.equal(result.evidenceSetSha256.length, 64);
    assert.equal(result.artifacts.length, 6);
    assert.ok(result.artifacts.every((artifact) => artifact.sha256.length === 64 && artifact.sizeBytes > 0));
    assert.deepEqual(result.artifacts.map((artifact) => artifact.relativePath), [...result.artifacts.map((artifact) => artifact.relativePath)].sort());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
