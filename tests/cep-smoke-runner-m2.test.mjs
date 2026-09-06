import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const runnerPath = "scripts/windows/run-m2-cep-smoke.ps1";

test("CEP smoke runner has a hard runtime and recovers a completed proof from a stuck Node shutdown", async () => {
  const runner = await readFile(runnerPath, "utf8");

  assert.match(runner, /Start-Process -FilePath "node"/);
  assert.match(runner, /\$HardDeadline = \(Get-Date\)\.AddSeconds\(\$TimeoutSeconds \+ 45\)/);
  assert.match(runner, /Test-Path \$ResultPath -PathType Leaf/);
  assert.match(runner, /\$ResultSeenAt/);
  assert.match(runner, /Stop-Process -Id \$NodeProcess\.Id -Force/);
  assert.match(runner, /proof artifact is complete but the Node process did not exit/);
  assert.match(runner, /exceeded its hard runtime without producing a proof artifact/);
  assert.match(runner, /M2 CEP transport status:/);
  assert.doesNotMatch(runner, /^\s*node \$Cli /m);
});
