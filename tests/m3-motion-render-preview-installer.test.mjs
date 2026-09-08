import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const previewInstallerPath = "scripts/windows/install-editflow-cep-v110-preview.ps1";

test("protocol 1.10 preview installer trusts PowerShell exception propagation instead of ambient LASTEXITCODE", async () => {
  const source = await readFile(previewInstallerPath, "utf8");
  assert.match(source, /try\s*\{\s*& \$AcceptedInstaller -Port \$Port\s*\}\s*catch\s*\{/s);
  assert.match(source, /Accepted EditFlow CEP installer failed before protocol 1\.10 preview installation:/);
  assert.doesNotMatch(source, /\$LASTEXITCODE/);
});
