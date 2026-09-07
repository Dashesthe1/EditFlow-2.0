import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const wrapperPath = "scripts/windows/run-m3-composite-self-hosted.ps1";

test("composite self-hosted wrapper preserves the accepted runner's repo-relative PSScriptRoot semantics", async () => {
  const source = await readFile(wrapperPath, "utf8");

  assert.match(source, /\$TemplatePath = Join-Path \$RepoRoot "scripts\\windows\\run-m3-mask-self-hosted\.ps1"/);
  assert.match(source, /\$TempPath = Join-Path \$PSScriptRoot \("run-m3-composite-self-hosted-generated-"/);
  assert.doesNotMatch(source, /\$TempPath = Join-Path \$env:TEMP/);
  assert.match(source, /Remove-Item \$TempPath -Force -ErrorAction SilentlyContinue/);
});
