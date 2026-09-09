import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("committed professional references compile into editorial taste", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "editflow-taste-"));
  const outputPath = path.join(root, "taste.json");

  try {
    const result = spawnSync(
      process.execPath,
      ["scripts/editor-learning/build-taste-corpus.mjs", "training/reference-extractions", outputPath],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const snapshot = JSON.parse(await readFile(outputPath, "utf8"));
    assert.ok(snapshot.sources.some((item) => item.sourceId === "reference.spidey_sense_square_edit"));
    assert.ok(snapshot.principles.some((item) => item.id === "principle.selective_audio_accent_sync"));
    assert.ok(snapshot.principles.some((item) => item.id === "principle.source_motion_before_effect_density"));
    assert.ok(snapshot.principles.length >= 6);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
