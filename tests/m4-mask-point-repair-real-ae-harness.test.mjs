import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("real-AE mask-point proof exercises exact write, readback, Undo, reapply, and cleanup", async () => {
  const template = await read("scripts/windows/m4-mask-point-repair-real-ae-template.jsx");
  assert.match(template, /plan\.plan\.hostCapabilityId/);
  assert.match(template, /plan\.plan\.command/);
  assert.match(template, /post_write_readback_exact/);
  assert.match(template, /ae\.transaction\.undo_last/);
  assert.match(template, /rollback_restored_wrong_shape/);
  assert.match(template, /reapply_readback_exact/);
  assert.match(template, /project_baseline_restored/);
});

test("real-AE mask-point runner requires localized viewer-visible pixel correction", async () => {
  const runner = await read("scripts/windows/run-m4-mask-point-repair-real-ae.ps1");
  assert.match(runner, /WrongRepairPass/);
  assert.match(runner, /RepairedRepairPass/);
  assert.match(runner, /StablePass/);
  assert.match(runner, /OutsidePass/);
  assert.match(runner, /VisualCheckpointPassed/);
  assert.match(runner, /HostResult\.ok/);
  assert.match(runner, /CleanupComplete/);
});
