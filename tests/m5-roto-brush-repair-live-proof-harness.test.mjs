import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const nodeProof = "scripts/m5-roto-brush-repair-live-proof.mjs";
const runnerPath = "scripts/windows/run-m5-roto-brush-repair-live-proof.ps1";

test("repair retained harness proves one guarded visible native foreground repair", async () => {
  const source = await readFile(nodeProof, "utf8");
  assert.match(source, /contract: "KNOWN_DEFECT_VISIBLE_NATIVE_REPAIR"/);
  assert.match(source, /const bootstrapPath = Object\.freeze/);
  assert.match(source, /const defectPath = Object\.freeze/);
  assert.match(source, /repairUsesExactSamePath: true/);
  assert.match(source, /operation: "SEED_BACKGROUND"/);
  assert.match(source, /knownDefect/);
  assert.match(source, /visiblyObserved/);
  assert.match(source, /stroke: \{ role: "FOREGROUND", pointsNormalized: defectPath/);
  assert.match(source, /repair\.visibleRepairChangeObserved === true/);
  assert.match(source, /finalRepairRoleStrokeCount > repair\.baselineRepairRoleStrokeCount/);
  assert.match(source, /baselineEffectFingerprint !== repair\.finalEffectFingerprint/);
  assert.match(source, /aeActionToActionLatenciesMs/);
  assert.match(source, /withinThreeSecondCeiling/);
  assert.match(source, /subSecondAll/);
  assert.match(source, /defectController/);
  assert.match(source, /repair\.baselineEffectFingerprint === defect\.finalEffectFingerprint/);
});

test("repair runner preserves one warm AE process and restores the original project in finally", async () => {
  const source = await readFile(runnerPath, "utf8");
  assert.match(source, /requires exactly one already-running After Effects process/);
  assert.match(source, /SameAeProcess/);
  assert.match(source, /m5-roto-brush-isolation-restore\.jsx/);
  assert.match(source, /finally \{/);
  assert.match(source, /RestoreAttempted/);
  assert.match(source, /sameAeProcess = \$SameAeProcess/);
  assert.match(source, /known visible background defect/);
  assert.doesNotMatch(source, /Stop-Process|taskkill|Restart-Computer/);
});

test("repair runner recovers a retained stale isolation state before a new entry", async () => {
  const source = await readFile(runnerPath, "utf8");
  const recovery = source.indexOf("M5 prior isolation recovery");
  const entry = source.indexOf("Invoke-AeScript $EnterScript");
  assert.ok(recovery >= 0 && entry > recovery);
  assert.match(source, /Invoke-AeScript \$RestoreScript/);
  assert.match(source, /Remove-Item \$LiveResultPath,\$ResultPath,\$EnterMarker/);
});

test("repair runner dispatches isolation fixture and restore through the warm CEP proof endpoint", async () => {
  const source = await readFile(runnerPath, "utf8");
  assert.match(source, /ProofScriptEndpoint = "http:\/\/127\.0\.0\.1:32146\/proof-script"/);
  assert.match(source, /Invoke-WebRequest -UseBasicParsing -Method Post -Uri \$ProofScriptEndpoint/);
  assert.match(source, /Invoke-AeScript \$EnterScript/);
  assert.match(source, /Invoke-AeScript \$FixtureScript/);
  assert.match(source, /Invoke-AeScript \$RestoreScript/);
  assert.doesNotMatch(source, /Start-Process -FilePath \$AfterFxPath/);
});

test("repair proof uses warm CEP readback dispatch instead of per-readback AfterFX launch", async () => {
  const source = await readFile(nodeProof, "utf8");
  assert.match(source, /proofScriptEndpoint/);
  assert.match(source, /fetch\(proofScriptEndpoint/);
  assert.match(source, /Warm CEP proof script dispatch failed/);
  assert.doesNotMatch(source, /spawn\(afterFxPath|execFile\(afterFxPath/);
});

test("repair live and retained proof identities stay aligned with the repair-stroke manifest", async () => {
  const live = await readFile(nodeProof, "utf8");
  const runner = await readFile(runnerPath, "utf8");
  assert.match(live, /proofId: "M5_ROTO_BRUSH_REPAIR_STROKE_REAL_AE_V1"/);
  assert.match(runner, /M5_ROTO_BRUSH_REPAIR_STROKE_REAL_AE_V1/);
  assert.match(runner, /proofId = "M5_ROTO_BRUSH_REPAIR_STROKE_RETAINED_REAL_AE_V1"/);
});
