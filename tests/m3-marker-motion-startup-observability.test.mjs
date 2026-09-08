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

test("startup watcher captures only exact visible AE dialog bounds and remains read-only", async () => {
  const watcher = await read("scripts/windows/watch-ae-startup-dialogs.ps1");

  assert.match(watcher, /\$Dialogs = @\(\$TopLevels \| Where-Object \{ \$_\.Visible -and \$_\.ClassName -eq "#32770" \}\)/);
  assert.match(watcher, /GetWindowRect/);
  assert.match(watcher, /CopyFromScreen/);
  assert.match(watcher, /startup-dialog-screenshots/);
  assert.match(watcher, /bounds=\$\(\$Dialog\.Left\),\$\(\$Dialog\.Top\),\$\(\$Dialog\.Right\),\$\(\$Dialog\.Bottom\)/);
  assert.match(watcher, /Pixel capture is limited to the exact bounds of visible AE-owned #32770 dialogs/);
  assert.doesNotMatch(watcher, /SendKeys/);
  assert.doesNotMatch(watcher, /SetForegroundWindow/);
  assert.doesNotMatch(watcher, /InvokePattern/);
  assert.doesNotMatch(watcher, /mouse_event/);
  assert.doesNotMatch(watcher, /keybd_event/);
  assert.doesNotMatch(watcher, /PostMessage/);
  assert.doesNotMatch(watcher, /SendMessage/);
});
