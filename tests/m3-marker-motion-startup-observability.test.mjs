import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("marker-motion P3/P4 keeps the startup dialog watcher inside its fixed duration contract", async () => {
  const runner = await read("scripts/windows/run-m3-marker-motion-p3-p4-self-hosted.ps1");
  const watcher = await read("scripts/windows/watch-ae-startup-dialogs.ps1");

  assert.match(watcher, /DurationSeconds -lt 10 -or \$DurationSeconds -gt 300/);
  assert.match(runner, /\[Math\]::Min\(300, \[Math\]::Max\(180, \$TimeoutSeconds \+ 90\)\)/);
  assert.doesNotMatch(runner, /\[Math\]::Min\(420, \[Math\]::Max\(180, \$TimeoutSeconds \+ 90\)\)/);
  assert.match(runner, /startup-dialog-details\.log/);
});
