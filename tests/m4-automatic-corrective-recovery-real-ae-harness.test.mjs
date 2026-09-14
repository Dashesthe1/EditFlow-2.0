import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("automatic corrective real-AE fixture remains wrong until the composer supplies the correction", async () => {
  const fixture = await read("scripts/windows/m4-automatic-corrective-recovery-fixture.jsx");
  const planner = await read("scripts/m4-automatic-corrective-recovery-plan-live.mjs");
  assert.match(fixture, /wrongFeatureCenter:\[250,330\]/);
  assert.match(fixture, /desiredRepairCenter:\[276,360\]/);
  assert.doesNotMatch(fixture, /tracker\.repair\.set_feature_center/);
  assert.match(planner, /AutomaticTrackingRepairMonitorV1/);
  assert.match(planner, /buildM4AutomaticCorrectiveRecoveryPlanV1/);
  assert.match(planner, /TRACK_DRIFT_RISK_HIGH/);
});

test("automatic corrective real-AE apply and resume consume the emitted exact plan", async () => {
  const apply = await read("scripts/windows/m4-automatic-corrective-recovery-apply.jsx");
  const driver = await read("scripts/m4-automatic-corrective-recovery-driver-live.mjs");
  const readback = await read("scripts/windows/m4-automatic-corrective-recovery-readback.jsx");
  assert.match(apply, /plan\.operations\[0\]/);
  assert.match(apply, /plan\.operations\[1\]/);
  assert.match(apply, /plan\.operations\[2\]/);
  assert.match(apply, /wrongStateObserved/);
  assert.match(apply, /postReadbackExact/);
  assert.match(driver, /TRACKER_ANALYZE_FORWARD/);
  assert.match(driver, /requiredPointIndices/);
  assert.match(readback, /protocolVersion:"2\.1\.0"/);
  assert.match(readback, /keyCountGrew/);
  assert.match(readback, /groundTruthTrajectoryMatched/);
});

test("automatic corrective acceptance requires verified resume and proof-owned cleanup", async () => {
  const acceptance = await read("scripts/m4-automatic-corrective-recovery-acceptance.mjs");
  const cleanup = await read("scripts/windows/m4-automatic-corrective-recovery-cleanup.jsx");
  assert.match(acceptance, /type: "VERIFY_REPAIR"/);
  assert.match(acceptance, /type: "RESUME"/);
  assert.match(acceptance, /repairStateResumed/);
  assert.match(acceptance, /cleanupRestoredBaseline/);
  assert.match(cleanup, /EF2_M4_AUTO_CORRECT_OWNED/);
  assert.match(cleanup, /itemCountAfter:app\.project\.numItems/);
});

test("identity-confidence live proof isolates identity loss and preserves acceptance gates", async () => {
  const planner = await read("scripts/m4-automatic-corrective-recovery-identity-plan-live.mjs");
  const acceptance = await read("scripts/m4-automatic-corrective-recovery-identity-acceptance.mjs");
  assert.match(planner, /trackConfidence: 0\.96/);
  assert.match(planner, /driftRisk: 0\.04/);
  assert.match(planner, /identityConfidence/);
  assert.match(planner, /IDENTITY_UNCERTAIN/);
  assert.match(acceptance, /explicitIdentityEscalated/);
  assert.match(acceptance, /PASS_REAL_AE_AUTOMATIC_IDENTITY_CORRECTIVE_RECOVERY/);
  assert.match(acceptance, /repairStateResumed/);
  assert.match(acceptance, /cleanupRestoredBaseline/);
});
