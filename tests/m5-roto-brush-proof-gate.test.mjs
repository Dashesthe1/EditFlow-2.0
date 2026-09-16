import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  assertM5RotoBrushProofGateV1,
  evaluateM5RotoBrushProofGateV1,
} from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-roto-brush-proof-gate.js";

const blank = (overrides = {}) => ({
  hasProject: true,
  filePath: null,
  itemCount: 0,
  dirty: false,
  projectRevision: 1,
  ...overrides,
});

test("M5 Roto Brush proof gate allows only a clean blank unsaved project", () => {
  const result = evaluateM5RotoBrushProofGateV1(blank());
  assert.equal(result.eligible, true);
  assert.equal(result.refusalCode, null);
  assert.equal(result.safeToLoadDevelopmentHost, true);
  assert.equal(result.safeToIssueInteractiveActions, true);
  assert.doesNotThrow(() => assertM5RotoBrushProofGateV1(blank()));
});

test("saved or nonempty projects are refused before any development host or UI action", () => {
  const saved = evaluateM5RotoBrushProofGateV1(blank({ filePath: "C:/work/psier.aep", itemCount: 9, dirty: true, projectRevision: 42 }));
  assert.equal(saved.refusalCode, "SAVED_PROJECT");
  assert.equal(saved.safeToLoadDevelopmentHost, false);
  assert.equal(saved.safeToIssueInteractiveActions, false);
  assert.equal(evaluateM5RotoBrushProofGateV1(blank({ itemCount: 1 })).refusalCode, "NONEMPTY_PROJECT");
});

test("blank-but-dirty and unknown dirty state fail closed", () => {
  assert.equal(evaluateM5RotoBrushProofGateV1(blank({ dirty: true })).refusalCode, "DIRTY_PROJECT");
  assert.equal(evaluateM5RotoBrushProofGateV1(blank({ dirty: null })).refusalCode, "DIRTY_STATE_UNAVAILABLE");
});

test("invalid/no-project state cannot become eligible", () => {
  assert.equal(evaluateM5RotoBrushProofGateV1(blank({ hasProject: false })).refusalCode, "NO_PROJECT");
  assert.equal(evaluateM5RotoBrushProofGateV1(blank({ itemCount: -1 })).refusalCode, "INVALID_ITEM_COUNT");
  assert.equal(evaluateM5RotoBrushProofGateV1(blank({ projectRevision: null })).refusalCode, "INVALID_PROJECT_REVISION");
  assert.throws(() => assertM5RotoBrushProofGateV1(blank({ filePath: "C:/saved.aep" })), /SAVED_PROJECT/);
});

test("ExtendScript preflight is read-only and evaluates file, item, dirty, and revision truth", async () => {
  const source = await readFile(new URL("../scripts/windows/m5-roto-brush-proof-preflight.jsx", import.meta.url), "utf8");
  assert.match(source, /app\.project/);
  assert.match(source, /project\.file/);
  assert.match(source, /project\.numItems/);
  assert.match(source, /project\.dirty/);
  assert.match(source, /project\.revision/);
  assert.match(source, /SAVED_PROJECT/);
  assert.match(source, /NONEMPTY_PROJECT/);
  assert.match(source, /DIRTY_PROJECT/);
  assert.doesNotMatch(source, /app\.newProject\s*\(/);
  assert.doesNotMatch(source, /app\.open\s*\(/);
  assert.doesNotMatch(source, /project\.save\s*\(/);
  assert.doesNotMatch(source, /project\.close\s*\(/);
  assert.doesNotMatch(source, /\.setValue\s*\(/);
  assert.doesNotMatch(source, /\.addProperty\s*\(/);
  assert.doesNotMatch(source, /EditFlow2_dispatch\s*\(/);
  assert.doesNotMatch(source, /evalFile\s*\(/);
});

test("Windows preflight reuses one responsive AE process and cannot restart, close, clean, or load protocol 2.6", async () => {
  const source = await readFile(new URL("../scripts/windows/run-m5-roto-brush-proof-preflight.ps1", import.meta.url), "utf8");
  assert.match(source, /Get-Process -Name "AfterFX"/);
  assert.match(source, /\$Running\.Count -ne 1/);
  assert.match(source, /Responding/);
  assert.match(source, /127\.0\.0\.1:32146\/proof-script/);
  assert.match(source, /dispatchTransport = "WARM_CEP"/);
  assert.doesNotMatch(source, /-ArgumentList @\("-r", \$PreflightScript\)/);
  assert.match(source, /Start-Sleep -Milliseconds 100/);
  assert.match(source, /Protocol 2\.6 host loading and interactive proof actions are blocked/);
  assert.doesNotMatch(source, /Stop-Process/);
  assert.doesNotMatch(source, /CloseMainWindow/);
  assert.doesNotMatch(source, /app\.newProject/);
  assert.doesNotMatch(source, /editflow_host_current_v26/);
  assert.doesNotMatch(source, /editflow_host_m5_roto_brush/);
});