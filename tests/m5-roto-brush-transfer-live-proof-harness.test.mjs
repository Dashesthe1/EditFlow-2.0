import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const runnerPath = "scripts/windows/run-m5-roto-brush-transfer-live-proof.ps1";

test("material transfer reuses the accepted warm TRACK_MATTE proof on two distinct sources", async () => {
  const source = await readFile(runnerPath, "utf8");
  assert.match(source, /M5_ROTO_BRUSH_MATERIAL_TRANSFER_RETAINED_REAL_AE_V1/);
  assert.match(source, /run-m5-roto-brush-export-live-proof\.ps1/);
  assert.match(source, /label="source-a"/);
  assert.match(source, /label="source-b"/);
  assert.match(source, /EF2_M5_ROTO_XFER_A/);
  assert.match(source, /EF2_M5_ROTO_XFER_B/);
  assert.match(source, /-LayerName \$Cycle\.layerName/);
  assert.match(source, /Get-FileHash.*SHA256/);
  assert.match(source, /differentSourceDigest/);
  assert.match(source, /differentImportedGeometryOrTiming/);
  assert.match(source, /compWidth.*compHeight/);
  assert.match(source, /frameRate.*duration/);
});

test("material transfer requires exact output truth, restore, one AE process, and bounded latency", async () => {
  const source = await readFile(runnerPath, "utf8");
  assert.match(source, /structuralOutputVerified/);
  assert.match(source, /nativeRotoOutputVerified/);
  assert.match(source, /M5_ROTO_TRACK_MATTE_001/);
  assert.match(source, /restoreStabilityVerified/);
  assert.match(source, /sameAeProcess/);
  assert.match(source, /subSecondAll/);
  assert.match(source, /withinThreeSecondCeiling/);
  assert.doesNotMatch(source, /Start-Process|Stop-Process|taskkill/i);
  assert.doesNotMatch(source, /Remove-Item\s+\$SourceA|Remove-Item\s+\$SourceB/);
});
