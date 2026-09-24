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
  assert.match(source, /AutoReconnectDeadline/);
  assert.match(source, /127\.0\.0\.1:32146\/healthz/);
  assert.match(source, /WarmPanelReady/);
  assert.match(source, /automatic reconnect; no AE menu bootstrap was needed/);
  assert.match(source, /Start-Process -FilePath \$Candidates\[0\]\.Path/);
  assert.doesNotMatch(source, /Stop-Process.*AfterFX/);
});

test("current Shadow launcher can bootstrap local AE proof without requiring Tailscale", async () => {
  const source = await readFile(new URL("../scripts/windows/Start_Current_EditFlow_Shadow.ps1", import.meta.url), "utf8");
  assert.match(source, /\[switch\]\$LocalOnly/);
  assert.match(source, /Get-Command tailscale\.exe -ErrorAction SilentlyContinue/);
  assert.match(source, /-not \$LocalOnly -and \[string\]::IsNullOrWhiteSpace\(\$Tailscale\)/);
  assert.match(source, /rerun with -LocalOnly for local CEP\/AE proof work/);
  assert.match(source, /if \(-not \$LocalOnly\)/);
  assert.match(source, /if \(\$LocalOnly\)[\s\S]*public tunnel skipped/);
  assert.match(source, /else \{[\s\S]*\$Tailscale funnel/);
});