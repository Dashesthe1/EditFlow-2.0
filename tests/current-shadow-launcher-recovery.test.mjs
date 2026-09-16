import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("current Shadow launcher reopens only the CEP bridge in a healthy running AE process", async () => {
  const source = await readFile(new URL("../scripts/windows/Start_Current_EditFlow_Shadow.ps1", import.meta.url), "utf8");
  assert.match(source, /function Open-WarmCepBridge/);
  assert.match(source, /open-editflow-bridge\.jsx/);
  assert.match(source, /Get-Process -Name "AfterFX"/);
  assert.match(source, /Candidates\.Count -ne 1/);
  assert.match(source, /Test-Listening 32145/);
  assert.match(source, /Start-Process -FilePath \$Candidates\[0\]\.Path/);
  assert.doesNotMatch(source, /Stop-Process.*AfterFX/);
});