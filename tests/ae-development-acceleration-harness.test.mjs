import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const lifecycleModes = [
  "REUSE_AE",
  "REOPEN_PROJECT",
  "RECONNECT_BROKER",
  "RESTART_AE",
  "CLEAN_BOOT",
];

test("accelerated AE proof request declares the permanent lifecycle contract", async () => {
  const schema = JSON.parse(await read("spec/ae-development-proof-request.schema.json"));
  assert.deepEqual(schema.properties.lifecycle.enum, lifecycleModes);
  assert.equal(schema.properties.lifecycle.default, "REUSE_AE");
  assert.equal(schema.properties.allowInfrastructureRetry.default, false);
  assert.match(schema.properties.proofScript.pattern, /scripts\/windows\/run-/);
  assert.match(schema.properties.artifactDir.pattern, /proofs\/artifacts/);
});

test("warm orchestrator never silently escalates REUSE_AE into process termination", async () => {
  const runner = await read("scripts/windows/invoke-editflow-ae-proof.ps1");
  const restartGate = 'if ($Lifecycle -in @("RESTART_AE", "CLEAN_BOOT"))';
  assert.ok(runner.includes(restartGate), "explicit restart gate must remain present");
  assert.ok(runner.includes("REUSE_AE refuses silent restart escalation"));

  const stopCall = "Stop-TargetAfterFx -ExpectedPath $AfterFxPath";
  assert.equal(runner.split(stopCall).length - 1, 1, "target-AE stop helper must have exactly one call site");
  assert.ok(runner.indexOf(stopCall) > runner.indexOf(restartGate), "AE stop call must remain behind explicit restart gate");
  assert.ok(runner.includes("Proof passed and the warm After Effects session remains healthy."));
});

test("warm smoke proof is non-mutating and never closes After Effects", async () => {
  const smoke = await read("scripts/windows/run-ae-warm-health-smoke.ps1");
  assert.ok(smoke.includes("mutationStarted = $false"));
  assert.ok(smoke.includes("cleanupComplete = $true"));
  assert.equal(smoke.includes("Stop-Process"), false);
  assert.equal(smoke.includes("CloseMainWindow"), false);
  assert.equal(smoke.includes("taskkill"), false);
});

test("AE supervisor has a narrow recovery-Continue allow list", async () => {
  const supervisor = await read("scripts/windows/ae-host-supervisor.ps1");
  assert.ok(supervisor.includes("RecoveryContext"));
  assert.ok(supervisor.includes('ContinueButtons.Count -eq 1'));
  assert.ok(supervisor.includes('ClassName -eq "Button"'));
  assert.ok(supervisor.includes("REFUSED_CONTINUE"));
  assert.equal(supervisor.includes("SetCursorPos"), false);
  assert.equal(supervisor.includes("mouse_event"), false);
  assert.equal(supervisor.includes("SendKeys"), false);
  assert.equal(supervisor.includes("Invoke-Expression"), false);
});

test("real-AE acceleration workflow stays serialized on the interactive AE runner", async () => {
  const workflow = await read(".github/workflows/ae-development-proof.yml");
  assert.ok(workflow.includes("runs-on: [self-hosted, Windows, editflow-ae]"));
  assert.ok(workflow.includes("group: editflow-accelerated-real-ae-workstation"));
  assert.ok(workflow.includes("cancel-in-progress: false"));
  assert.ok(workflow.includes("invoke-editflow-ae-proof.ps1"));
});

test("ADR makes warm AE reusable through the remaining product roadmap", async () => {
  const adr = await read("docs/adr/0009-warm-ae-development-harness.md");
  for (const lifecycle of lifecycleModes) assert.ok(adr.includes(`\`${lifecycle}\``));
  assert.ok(adr.includes("M4–M11"));
  assert.ok(adr.includes("A proof MUST NOT close or restart AE merely as a convenient cleanup mechanism."));
});
