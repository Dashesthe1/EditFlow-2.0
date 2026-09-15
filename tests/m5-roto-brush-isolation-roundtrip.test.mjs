import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

test("M5 isolation entry captures exact clean project state before creating a blank proof project", async () => {
  const source = await read("scripts/windows/m5-roto-brush-isolation-enter.jsx");
  assert.match(source, /Isolation entry requires a saved project/);
  assert.match(source, /Original project must be clean/);
  assert.match(source, /originalProjectPath/);
  assert.match(source, /originalItemCount/);
  assert.match(source, /originalActiveItemId/);
  const stateWrite = source.indexOf("write(stateFile, state)");
  const projectClose = source.indexOf("project.close(CloseOptions.DO_NOT_SAVE_CHANGES)");
  assert.ok(stateWrite >= 0 && projectClose > stateWrite, "restoration state must be durable before project close");
  assert.match(source, /app\.newProject\(\)/);
  assert.match(source, /blankItems !== 0/);
  assert.match(source, /blankDirty !== false/);
  assert.match(source, /blankRevision === null/);
  assert.doesNotMatch(source, /\.save\s*\(/);
});
test("M5 isolation restore discards only proof-owned unsaved scope and reopens the exact original", async () => {
  const source = await read("scripts/windows/m5-roto-brush-isolation-restore.jsx");
  assert.match(source, /Restore refuses unexpected saved project/);
  assert.match(source, /EF2_M5_ROTO_/);
  assert.match(source, /current\.numItems === 0 \|\| allOwned/);
  assert.match(source, /current\.close\(CloseOptions\.DO_NOT_SAVE_CHANGES\)/);
  assert.match(source, /app\.open\(originalFile\)/);
  assert.match(source, /originalItemCount/);
  assert.match(source, /active_item_restored/);
  assert.match(source, /original_project_clean/);
  assert.doesNotMatch(source, /\.save\s*\(/);
});

test("M5 isolation runner preserves one warm AE process and restores in finally", async () => {
  const source = await read("scripts/windows/run-m5-roto-brush-isolation-roundtrip.ps1");
  assert.match(source, /requires exactly one already-running After Effects process/);
  assert.match(source, /\.Responding/);
  assert.match(source, /run-m5-roto-brush-proof-preflight\.ps1/);
  assert.match(source, /finally\s*\{/);
  assert.match(source, /Invoke-AeScript \$RestoreScript/);
  assert.match(source, /SameAeProcess/);
  assert.match(source, /baselineAePids/);
  assert.match(source, /afterAePids/);
  assert.doesNotMatch(source, /Stop-Process|taskkill|kill_process|CloseMainWindow/);
});
