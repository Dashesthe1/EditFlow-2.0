import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { GuardedRotoBrushSeedControllerV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-roto-brush-seed-controller.js";
import { EditGptRotoBrushSeedVisualDriverV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-editgpt-roto-brush-seed-visual-driver.js";
import { GuardedRotoBrushRepairControllerV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-roto-brush-repair-controller.js";
import { EditGptRotoBrushRepairVisualDriverV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-editgpt-roto-brush-repair-visual-driver.js";

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};
const required = (name) => {
  const value = arg(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const afterFxPath = required("--afterfx-path");
const proofScriptEndpoint = arg("--proof-script-endpoint") ?? "http://127.0.0.1:32146/proof-script";
const fixturePath = required("--fixture");
const resultPath = required("--result");
const readbackScript = required("--readback-script");
const pythonPath = required("--python");
const toolSelectScript = required("--tool-select-script");
const seedVisualScript = required("--seed-visual-script");
const repairVisualScript = required("--repair-visual-script");
const visualWorkdir = required("--visual-workdir");
const evidenceDir = required("--evidence-dir");
const timeoutMs = Number(arg("--timeout-ms") ?? "15000");
const requestPath = path.join(os.tmpdir(), "EditFlow2-m5-roto-brush-readback-request.json");
const responsePath = path.join(os.tmpdir(), "EditFlow2-m5-roto-brush-readback-response.json");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitJson = async (filePath, deadlineMs) => {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      if ((await stat(filePath)).size > 0) return JSON.parse((await readFile(filePath, "utf8")).replace(/^\uFEFF/, ""));
    } catch {}
    await sleep(20);
  }
  throw new Error(`Timed out waiting for ${filePath}`);
};
const invokeAeScript = async () => {
  const response = await fetch(proofScriptEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scriptPath: readbackScript }),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok || payload?.ok !== true) {
    throw new Error(`Warm CEP proof script dispatch failed: ${payload?.error ?? text ?? response.status}`);
  }
  return payload;
};
class FixedAeRotoReadbackTransport {
  constructor() { this.roundtripsMs = []; }
  async dispatch(request) {
    await rm(responsePath, { force: true });
    await writeFile(requestPath, `${JSON.stringify(request)}\n`, "utf8");
    const started = performance.now();
    await invokeAeScript();
    const response = await waitJson(responsePath, timeoutMs);
    this.roundtripsMs.push(Number((performance.now() - started).toFixed(3)));
    if (response.__transportError) throw new Error(`Protocol 2.6 AE dispatch failed: ${response.__transportError}`);
    if (response.protocolVersion !== request.protocolVersion || response.requestId !== request.requestId
      || response.operationId !== request.operationId || response.command !== request.command) {
      throw new Error("Protocol 2.6 AE dispatch correlation mismatch.");
    }
    return response;
  }
}

await mkdir(path.dirname(resultPath), { recursive: true });
await mkdir(evidenceDir, { recursive: true });
const bootstrapEvidenceDir = path.join(evidenceDir, "foreground-bootstrap");
const defectEvidenceDir = path.join(evidenceDir, "known-background-defect");
const repairEvidenceDir = path.join(evidenceDir, "foreground-repair");
for (const dir of [bootstrapEvidenceDir, defectEvidenceDir, repairEvidenceDir]) await mkdir(dir, { recursive: true });
const fixture = JSON.parse((await readFile(fixturePath, "utf8")).replace(/^\uFEFF/, ""));
if (fixture.ok !== true || !Number.isInteger(fixture.compHostId) || !Number.isInteger(fixture.layerHostId)) {
  throw new Error("M5 Roto Brush fixture metadata is invalid.");
}
const transport = new FixedAeRotoReadbackTransport();
const seedConfig = (evidenceDirectory) => ({
  executablePath: pythonPath,
  scriptPath: seedVisualScript,
  workingDirectory: visualWorkdir,
  afterFxPath,
  toolSelectScriptPath: toolSelectScript,
  evidenceDirectory,
  timeoutMs: 120000,
});
const bootstrapController = new GuardedRotoBrushSeedControllerV1(transport, new EditGptRotoBrushSeedVisualDriverV1(seedConfig(bootstrapEvidenceDir)));
const defectController = new GuardedRotoBrushSeedControllerV1(transport, new EditGptRotoBrushSeedVisualDriverV1(seedConfig(defectEvidenceDir)));
const repairVisualDriver = new EditGptRotoBrushRepairVisualDriverV1({
  executablePath: pythonPath,
  scriptPath: repairVisualScript,
  workingDirectory: visualWorkdir,
  afterFxPath,
  toolSelectScriptPath: toolSelectScript,
  evidenceDirectory: repairEvidenceDir,
  timeoutMs: 120000,
});
const repairController = new GuardedRotoBrushRepairControllerV1(transport, repairVisualDriver);
const bootstrapPath = Object.freeze([{ x: 0.15, y: 0.13 }, { x: 0.21, y: 0.17 }, { x: 0.27, y: 0.22 }, { x: 0.32, y: 0.29 }, { x: 0.36, y: 0.36 }, { x: 0.40, y: 0.44 }]);
const defectPath = Object.freeze([{ x: 0.31, y: 0.27 }, { x: 0.34, y: 0.33 }, { x: 0.37, y: 0.39 }]);
const proof = {
  proofId: "M5_ROTO_BRUSH_REPAIR_STROKE_REAL_AE_V1",
  ok: false,
  status: "FAILED",
  fixture: {
    compHostId: fixture.compHostId,
    layerHostId: fixture.layerHostId,
    compName: fixture.compName,
    layerName: fixture.layerName,
    width: fixture.width,
    height: fixture.height,
    atTime: fixture.atTime,
  },
  contract: "KNOWN_DEFECT_VISIBLE_NATIVE_REPAIR",
  knownDefect: {
    kind: "BACKGROUND_SUBTRACT_STROKE_ON_FOREGROUND_SUBJECT",
    pointsNormalized: defectPath,
    radiusNormalized: 0.03,
    repairRole: "FOREGROUND",
    repairUsesExactSamePath: true,
  },
  bootstrap: null,
  defect: null,
  repair: null,
  typedReadbackRoundtripsMs: [],
  speed: { maxAeActionGapMs: null, withinThreeSecondCeiling: false, subSecondAll: false },
  failure: null,
};
try {
  const bootstrap = await bootstrapController.run({
    operation: "SEED_FOREGROUND",
    compHostId: fixture.compHostId,
    layerHostId: fixture.layerHostId,
    expectedCompName: fixture.compName,
    expectedLayerName: fixture.layerName,
    atTime: fixture.atTime,
    stroke: {
      role: "FOREGROUND",
      pointsNormalized: bootstrapPath,
      radiusNormalized: 0.04,
    },
    evidenceIds: ["M5:ROTO:REPAIR:BOOTSTRAP_FOREGROUND:001"],
  });
  proof.bootstrap = bootstrap;
  if (bootstrap.route !== "LOCAL" || bootstrap.finalEffectMatchCount !== 1) {
    throw new Error(bootstrap.escalationReason || "Repair proof foreground bootstrap failed.");
  }

  const defect = await defectController.run({
    operation: "SEED_BACKGROUND",
    compHostId: fixture.compHostId,
    layerHostId: fixture.layerHostId,
    expectedCompName: fixture.compName,
    expectedLayerName: fixture.layerName,
    atTime: fixture.atTime,
    stroke: { role: "BACKGROUND", pointsNormalized: defectPath, radiusNormalized: 0.03 },
    evidenceIds: ["M5:ROTO:REPAIR:KNOWN_DEFECT_BACKGROUND:001"],
  });
  proof.defect = defect;
  if (defect.route !== "LOCAL" || defect.finalEffectMatchCount !== 1) {
    throw new Error(defect.escalationReason || "Known background defect injection failed.");
  }
  const defectVisual = JSON.parse((await readFile(path.join(defectEvidenceDir, "result.json"), "utf8")).replace(/^\uFEFF/, ""));
  const defectVisibleChangedFraction = Number(defectVisual?.proof?.visibleStrokeChange?.changedFraction ?? 0);
  proof.knownDefect.visibleChangedFraction = defectVisibleChangedFraction;
  proof.knownDefect.visibleThreshold = 0.002;
  proof.knownDefect.visiblyObserved = Number.isFinite(defectVisibleChangedFraction) && defectVisibleChangedFraction >= 0.002;
  if (!proof.knownDefect.visiblyObserved) {
    throw new Error(`Known background defect was not visibly observed (${defectVisibleChangedFraction.toFixed(6)}).`);
  }

  const repair = await repairController.run({
    compHostId: fixture.compHostId,
    layerHostId: fixture.layerHostId,
    expectedCompName: fixture.compName,
    expectedLayerName: fixture.layerName,
    atTime: fixture.atTime,
    stroke: { role: "FOREGROUND", pointsNormalized: defectPath, radiusNormalized: 0.03 },
    evidenceIds: ["M5:ROTO:REPAIR:FOREGROUND_CORRECTION:001"],
  });
  proof.repair = repair;
  proof.typedReadbackRoundtripsMs = transport.roundtripsMs;
  const allGaps = [
    ...bootstrap.aeActionToActionLatenciesMs,
    ...defect.aeActionToActionLatenciesMs,
    ...repair.aeActionToActionLatenciesMs,
  ];
  const maxGap = allGaps.length ? Math.max(...allGaps) : null;
  proof.speed = {
    maxAeActionGapMs: maxGap,
    withinThreeSecondCeiling: allGaps.length > 0 && allGaps.every((value) => value <= 3000),
    subSecondAll: allGaps.length > 0 && allGaps.every((value) => value < 1000),
  };
  proof.ok = defect.route === "LOCAL"
    && proof.knownDefect.visiblyObserved === true
    && repair.route === "LOCAL"
    && repair.visibleRepairChangeObserved === true
    && repair.baselineEffectFingerprint === defect.finalEffectFingerprint
    && repair.finalRepairRoleStrokeCount > repair.baselineRepairRoleStrokeCount
    && repair.baselineEffectFingerprint !== repair.finalEffectFingerprint
    && proof.speed.withinThreeSecondCeiling;
  proof.status = proof.ok ? "ACCEPTED" : "FAILED";
  if (!proof.ok) proof.failure = repair.escalationReason || "M5 live repair proof gates were not all satisfied.";
} catch (error) {
  proof.failure = error instanceof Error ? error.message : String(error);
  proof.typedReadbackRoundtripsMs = transport.roundtripsMs;
}
await writeFile(resultPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
console.log(JSON.stringify(proof, null, 2));
process.exitCode = proof.ok ? 0 : 2;