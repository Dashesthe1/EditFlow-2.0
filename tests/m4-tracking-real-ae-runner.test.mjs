import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const runnerPath = "scripts/windows/run-m4-tracking-real-ae.ps1";
const bootstrapPath = "scripts/windows/open-editflow-m4-bridge.jsx";

test("M4 warm runner reuses one responsive AE process and never owns AE shutdown", async () => {
  const source = await readFile(runnerPath, "utf8");
  assert.match(source, /requires exactly one responsive After Effects project process/);
  assert.match(source, /\$InitialPid = \[int\]\$Ae\[0\]\.Id/);
  assert.match(source, /After Effects PID changed during REUSE_AE proof/);
  assert.match(source, /install-editflow-cep\.ps1/);
  assert.match(source, /m4-tracking-real-ae-cli\.js/);
  assert.match(source, /open-editflow-m4-bridge\.jsx/);
  assert.doesNotMatch(source, /Stop-Process\s+-Name\s+["']?AfterFX/i);
  assert.doesNotMatch(source, /taskkill.*AfterFX/i);
  assert.doesNotMatch(source, /RESTART_AE|CLEAN_BOOT/);
});

test("M4 bootstrap loads only the fixed installed M4 host and opens the fixed CEP menu", async () => {
  const source = await readFile(bootstrapPath, "utf8");
  assert.match(source, /editflow_host_current_m4\.jsx/);
  assert.match(source, /EditFlow2_HOST_PROTOCOL_20/);
  assert.match(source, /EditFlow2_HOST_M4/);
  assert.match(source, /TRACKING_TIFF_SEQUENCE_V1/);
  assert.match(source, /findMenuCommandId\("EditFlow 2\.0 Bridge"\)/);
  assert.match(source, /app\.executeCommand\(commandId\)/);
  assert.doesNotMatch(source, /app\.project\.(save|close|open|newProject)/);
  assert.doesNotThrow(() => new vm.Script(source, { filename: bootstrapPath }));
});
