import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const runnerPath = "scripts/windows/run-m4-tracking-brain-real-ae.ps1";

test("M4 tracking-to-brain runner chains only retained passing tracking evidence into the decision-only stage", async () => {
  const source = await readFile(runnerPath, "utf8");
  assert.match(source, /run-m4-tracking-real-ae\.ps1/);
  assert.match(source, /\$Tracking\.ok/);
  assert.match(source, /\$Tracking\.classification -ne "PASS"/);
  assert.match(source, /m4-tracking-semantic-decision-cli\.js/);
  assert.match(source, /semantic-decision\.json/);
  assert.match(source, /PASS_DECISION_ONLY_FAIL_CLOSED/);
});

test("M4 tracking-to-brain runner preserves one warm AE PID and does not own host shutdown", async () => {
  const source = await readFile(runnerPath, "utf8");
  assert.match(source, /requires exactly one responsive After Effects project process/);
  assert.match(source, /\$InitialPid = \[int\]\$Before\[0\]\.Id/);
  assert.match(source, /After Effects PID changed during the tracking-to-brain REUSE_AE proof/);
  assert.doesNotMatch(source, /Stop-Process\s+-Name\s+["']?AfterFX/i);
  assert.doesNotMatch(source, /taskkill.*AfterFX/i);
  assert.doesNotMatch(source, /project\.(save|open|close|newProject)/i);
});
