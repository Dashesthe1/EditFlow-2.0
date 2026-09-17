import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestPath = "proofs/manifests/m5-mocha-ae-planar-tracking-development.request.json";
const runnerPath = "scripts/windows/run-m5-mocha-ae-planar-tracking-live-proof.ps1";
const seekPath = "scripts/windows/m5-mocha-ae-seek-frame-one.ps1";
const trackPath = "scripts/windows/m5-mocha-ae-guarded-track-range.ps1";
const verifyPath = "scripts/windows/m5-mocha-ae-isolation-verify.jsx";

test("M5 Mocha planar-tracking proof is warm-AE, retained, and non-retrying", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.proofId, "M5_MOCHA_AE_PLANAR_TRACKING_RETAINED_REAL_AE_V1");
  assert.equal(manifest.lifecycle, "REUSE_AE");
  assert.equal(manifest.allowInfrastructureRetry, false);
  assert.equal(manifest.allowEvidenceReuse, false);
  assert.equal(manifest.incrementalNodeId, "M5_MOCHA_AE_PLANAR_TRACKING");
  assert.ok(manifest.incrementalDependencies.includes(seekPath));
  assert.ok(manifest.incrementalDependencies.includes(trackPath));
  assert.ok(manifest.incrementalDependencies.includes(verifyPath));
  const runner = await readFile(runnerPath, "utf8");
  assert.match(runner, /PlanarTrackingVerified/);
  assert.match(runner, /trackedRangeVerified/);
  assert.match(runner, /forwardEndpointVerified/);
  assert.match(runner, /backwardEndpointVerified/);
  assert.match(runner, /sameAeProcess/i);
  assert.match(runner, /maxMeasuredWarmAeRoundtripMs/);
  assert.match(runner, /maxMeasuredMochaOneFrameSolveMs/);
  assert.match(runner, /EditFlow2_M5_Mocha_AE_Proof/);
  assert.match(runner, /WaitOne\(0\)/);
  assert.match(runner, /owns the local proof lease/);
  assert.match(runner, /ProofScriptEndpoint/);
  assert.match(runner, /127\.0\.0\.1:32146\/proof-script/);
  assert.match(runner, /Invoke-WebRequest/);
  assert.match(runner, /WARM_CEP_PROOF_SCRIPT/);
  assert.doesNotMatch(runner, /Start-Process -FilePath \$AfterFxPath/);
});

test("tracking gate uses exact single-frame semantic controls and independent tracked-end readback", async () => {
  const track = await readFile(trackPath, "utf8");
  assert.match(track, /Track To Next Frame/);
  assert.match(track, /Track To Previous Frame/);
  assert.match(track, /nextTrackedRegionB/);
  assert.match(track, /prevTrackedRegionB/);
  assert.match(track, /seedFrame=1/);
  assert.match(track, /startFrame=0;endFrame=2/);
  assert.match(track, /InvokePattern/);
  assert.match(track, /trackedRangeVerified/);
  assert.doesNotMatch(track, /SetCursorPos|mouse_event|SendInput/);
  assert.doesNotMatch(track, /Track Forwards[^ a-zA-Z]|Track Backwards[^ a-zA-Z]/);
});

test("seed positioning uses exact transport identity and bounded frame 0 to 1", async () => {
  const seek = await readFile(seekPath, "utf8");
  assert.match(seek, /frmMain\.centralArea\.timelineControlsW\.transportControlsW\.btnNextFrame/);
  assert.match(seek, /before -ne 0/);
  assert.match(seek, /after -ne 1/);
  assert.match(seek, /InvokePattern/);
  assert.doesNotMatch(seek, /SetCursorPos|mouse_event|SendInput/);
});