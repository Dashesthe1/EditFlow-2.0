import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const livePath = "scripts/m5-roto-brush-export-live-proof.mjs";
const runnerPath = "scripts/windows/run-m5-roto-brush-export-live-proof.ps1";
const dispatchPath = "scripts/windows/m5-roto-brush-export-dispatch.jsx";

test("TRACK_MATTE retained proof binds stable structural output to the exact duplicated native Roto fingerprint", async () => {
  const source = await readFile(livePath, "utf8");
  assert.match(source, /proofId: "M5_ROTO_BRUSH_TRACK_MATTE_EXPORT_REAL_AE_V1"/);
  assert.match(source, /contract: "STABLE_TRACK_MATTE_LAYER_EXPORT"/);
  assert.match(source, /kind: "TRACK_MATTE", stableId: "M5_ROTO_TRACK_MATTE_001"/);
  assert.match(source, /structuralOutputVerified === true/);
  assert.match(source, /nativeRotoOutputVerified === true/);
  assert.match(source, /baselineEffectFingerprint === exported\.outputEffectFingerprint/);
  assert.match(source, /exportMutationRoundtripMs/);
  assert.match(source, /withinThreeSecondCeiling/);
});

test("export proof dispatcher exposes only the bounded Roto readback, project inspect, and layer duplicate commands", async () => {
  const source = await readFile(dispatchPath, "utf8");
  assert.match(source, /roto_brush\.readback/);
  assert.match(source, /project\.inspect/);
  assert.match(source, /layer\.duplicate/);
  assert.doesNotMatch(source, /layer\.remove|render\.capture|effect\.set_property|eval\s*\(/);
});

test("export runner recovers retained isolation state before a new entry and clears it only after verified restore", async () => {
  const source = await readFile(runnerPath, "utf8");
  const recovery = source.indexOf("M5 prior export isolation recovery");
  const entry = source.indexOf("Invoke-AeScript $EnterScript");
  assert.ok(recovery >= 0 && entry > recovery);
  assert.match(source, /Remove-Item \$LiveResultPath,\$ResultPath,\$EnterMarker/);
  assert.doesNotMatch(source, /Remove-Item \$LiveResultPath,\$ResultPath,\$StatePath/);
  assert.match(source, /RestoreStabilityVerified = \$true/);
  assert.match(source, /Remove-Item \$StatePath -Force/);
  assert.match(source, /\[string\]\$LayerName = "EF2_M5_ROTO_SUBJECT"/);
  assert.match(source, /fixture names must stay proof-owned/);
});

test("export runner keeps one warm AE process and restores in finally through the warm CEP proof endpoint", async () => {
  const source = await readFile(runnerPath, "utf8");
  assert.match(source, /ProofScriptEndpoint = "http:\/\/127\.0\.0\.1:32146\/proof-script"/);
  assert.match(source, /requires exactly one already-running After Effects process/);
  assert.match(source, /Invoke-AeScript \$EnterScript/);
  assert.match(source, /Invoke-AeScript \$FixtureScript/);
  assert.match(source, /finally \{/);
  assert.match(source, /Invoke-AeScript \$RestoreScript/);
  assert.match(source, /sameAeProcess = \$SameAeProcess/);
  assert.match(source, /M5_ROTO_BRUSH_TRACK_MATTE_EXPORT_RETAINED_REAL_AE_V1/);
  assert.doesNotMatch(source, /Start-Process -FilePath \$AfterFxPath|Stop-Process|taskkill/);
});
