import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflowPath = ".github/workflows/m4-point-tracking-real-ae.yml";

test("M4 real-AE workflow is manual, serialized, and uses the persistent warm AE lane", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /push:\s*\n/);
  assert.match(source, /group: editflow-accelerated-real-ae-workstation/);
  assert.match(source, /runs-on: \[self-hosted, Windows, editflow-ae\]/);
  assert.match(source, /git -C \$repoRoot reset --hard FETCH_HEAD/);
  assert.match(source, /No git clean was executed/);
});

test("M4 real-AE workflow enforces tracking, project safety, semantic readback, and fail-closed Brain evidence", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /run-m4-tracking-brain-real-ae\.ps1/);
  assert.match(source, /result\.json/);
  assert.match(source, /semantic-decision\.json/);
  assert.match(source, /fixedTrackingProfile/);
  assert.match(source, /exactFrameManifest/);
  assert.match(source, /stableMotion/);
  assert.match(source, /projectStructureUnchanged/);
  assert.match(source, /renderQueueOwnedAndRemoved/);
  assert.match(source, /identityNotInvented/);
  assert.match(source, /extentNotInvented/);
  assert.match(source, /pointTrackingCapabilityStillUnavailable/);
  assert.match(source, /brainFailClosed/);
  assert.match(source, /noAeMutationExecuted/);
});

test("M4 real-AE workflow verifies the same warm AE PID and contains no host shutdown command", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /EDITFLOW_M4_AE_PID/);
  assert.match(source, /Warm AE PID preserved/);
  assert.doesNotMatch(source, /Stop-Process\s+-Name\s+["']?AfterFX/i);
  assert.doesNotMatch(source, /taskkill.*AfterFX/i);
  assert.doesNotMatch(source, /RESTART_AE|CLEAN_BOOT/);
});
