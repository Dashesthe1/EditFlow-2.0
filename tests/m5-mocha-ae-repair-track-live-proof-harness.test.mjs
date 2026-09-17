import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestPath = "proofs/manifests/m5-mocha-ae-repair-track-development.request.json";
const runnerPath = "scripts/windows/run-m5-mocha-ae-repair-track-live-proof.ps1";
const preparePath = "scripts/windows/m5-mocha-ae-prepare-adjusttrack.ps1";
const repairPath = "scripts/windows/m5-mocha-ae-repair-track.ps1";
const verifyPath = "scripts/m5-mocha-ae-verify-repair.py";
const workspacePath = "scripts/windows/m5-mocha-ae-switch-workspace.ps1";

test("M5 Mocha repair proof is retained, warm-CEP, and non-retrying", async () => {
  const manifest = JSON.parse((await readFile(manifestPath, "utf8")).replace(/^\uFEFF/, ""));
  assert.equal(manifest.proofId, "M5_MOCHA_AE_REPAIR_TRACK_RETAINED_REAL_AE_V1");
  assert.equal(manifest.lifecycle, "REUSE_AE");
  assert.equal(manifest.allowInfrastructureRetry, false);
  assert.equal(manifest.allowEvidenceReuse, false);
  assert.equal(manifest.incrementalNodeId, "M5_MOCHA_AE_REPAIR_TRACK");
  for (const dep of [preparePath, repairPath, verifyPath, workspacePath]) assert.ok(manifest.incrementalDependencies.includes(dep));
  const runner = await readFile(runnerPath, "utf8");
  assert.match(runner, /127\.0\.0\.1:32146\/proof-script/);
  assert.match(runner, /Invoke-WebRequest/);
  assert.match(runner, /WARM_CEP_PROOF_SCRIPT/);
  assert.doesNotMatch(runner, /Start-Process -FilePath \$AfterFxPath/);
  assert.match(runner, /RepairTrackVerified/);
  assert.match(runner, /sameAeProcess/i);
  assert.match(runner, /EditFlow2_M5_Mocha_AE_Proof/);
  assert.match(runner, /WaitOne\(0\)/);
});

test("AdjustTrack preparation binds exact semantic controls without raw pointer input", async () => {
  const prepare = await readFile(preparePath, "utf8");
  assert.match(prepare, /Workspace: Essentials/);
  assert.match(prepare, /Workspace: Classic/);
  assert.match(prepare, /AdjustTrack/);
  assert.match(prepare, /btnSetPoints/);
  assert.match(prepare, /btnSelectNextPoint/);
  assert.match(prepare, /SelectionItemPattern/);
  assert.match(prepare, /InvokePattern/);
  assert.match(prepare, /setPointsVerified/);
  assert.doesNotMatch(prepare, /SetCursorPos|SendInput|mouse_event/);
});

test("repair action is bounded to one correction frame and an exact inverse semantic nudge", async () => {
  const repair = await readFile(repairPath, "utf8");
  assert.match(repair, /CorrectionFrame -lt 0 -or \$CorrectionFrame -gt 2/);
  assert.match(repair, /DefectNudges -lt 1 -or \$DefectNudges -gt 16/);
  assert.match(repair, /btnReferenceFrame/);
  assert.match(repair, /btnNudgeRight/);
  assert.match(repair, /btnNudgeLeft/);
  assert.match(repair, /SET_REFERENCE_FRAME -> NUDGE_RIGHT/);
  assert.match(repair, /repair-baseline/);
  assert.match(repair, /repair-defect/);
  assert.match(repair, /repair-repaired/);
  assert.match(repair, /maxSemanticActionInvokeMs/);
  assert.doesNotMatch(repair, /SetCursorPos|SendInput|mouse_event/);
});

test("independent repair verifier requires visible defect and strong restoration", async () => {
  const verify = await readFile(verifyPath, "utf8");
  assert.match(verify, /defect_visible=dc>=25/);
  assert.match(verify, /residual_ratio<=0\.35/);
  assert.match(verify, /mean_ratio<=0\.35/);
  assert.match(verify, /repair-defect-diff\.png/);
  assert.match(verify, /repair-residual-diff\.png/);
  assert.match(verify, /SystemExit\(0 if out\['ok'\] else 2\)/);
});

test("workspace helper restores Essentials through exact process-bound QAction identity", async () => {
  const workspace = await readFile(workspacePath, "utf8");
  assert.match(workspace, /Workspace: Essentials/);
  assert.match(workspace, /ControlType\.MenuItem/);
  assert.match(workspace, /QAction/);
  assert.match(workspace, /ProcessId/);
  assert.match(workspace, /WorkspaceOnly/);
});

test("repair proof can use generated footage while requiring exact project fingerprint restoration", async () => {
  const manifest = JSON.parse((await readFile(manifestPath, "utf8")).replace(/^\uFEFF/, ""));
  const runner = await readFile(runnerPath, "utf8");
  assert.ok(manifest.incrementalDependencies.includes("scripts/m5-mocha-ae-generate-proof-source.py"));
  assert.match(runner, /GenerateSourceScript/);
  assert.match(runner, /ControlsScript/);
  assert.match(runner, /Mocha effect apply/);
  assert.match(runner, /GUARDED_EFFECT_CONTROLS_LAUNCH/);
  assert.match(runner, /-File \$ClickScript/);
  assert.doesNotMatch(runner, /NATIVE_TRACK_IN_BORIS_FX_MOCHA/);
  assert.match(runner, /m5-mocha-proof-source\.avi/);
  assert.match(runner, /ControlStateEndpoint/);
  assert.match(runner, /BaselineProjectFingerprint/);
  assert.match(runner, /FinalProjectFingerprint/);
  assert.match(runner, /FingerprintRestored/);
  assert.match(runner, /projectFingerprintRestored/);
});
