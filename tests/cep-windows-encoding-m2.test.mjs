import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const installerPath = "scripts/windows/install-editflow-cep.ps1";
const smokeCliPath = "apps/desktop-host/src/cep-smoke-cli.ts";

test("Windows CEP installer writes runtime files as UTF-8 without BOM", async () => {
  const source = await readFile(installerPath, "utf8");
  assert.match(source, /UTF8Encoding\(\$false\)/);
  assert.match(source, /WriteAllText\(\$ConfigPath, \$ConfigJson \+ \[Environment\]::NewLine, \$Utf8NoBom\)/);
  assert.match(source, /WriteAllText\(\$RuntimeConfigPath, \$RuntimeConfig, \$Utf8NoBom\)/);
  assert.doesNotMatch(source, /Set-Content\s+-Path\s+\$ConfigPath/);
  assert.doesNotMatch(source, /Set-Content\s+-Path\s+\$RuntimeConfigPath/);
});

test("CEP smoke CLI tolerates an existing UTF-8 BOM in bridge-config.json", async () => {
  const source = await readFile(smokeCliPath, "utf8");
  assert.match(source, /charCodeAt\(0\) === 0xfeff/);
  assert.match(source, /stripUtf8Bom\(await readFile\(configPath, "utf8"\)\)/);
});
