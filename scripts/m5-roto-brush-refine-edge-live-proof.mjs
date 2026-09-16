import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { GuardedRotoBrushSeedControllerV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-roto-brush-seed-controller.js";
import { EditGptRotoBrushSeedVisualDriverV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-editgpt-roto-brush-seed-visual-driver.js";
import { GuardedRotoBrushRefineEdgeControllerV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-roto-brush-refine-edge-controller.js";
import { EditGptRotoBrushRefineEdgeVisualDriverV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-editgpt-roto-brush-refine-edge-visual-driver.js";

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
const refineVisualScript = required("--refine-visual-script");
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
const seedEvidenceDir = path.join(evidenceDir, "foreground-bootstrap");
const refineEvidenceDir = path.join(evidenceDir, "refine-edge");
await mkdir(seedEvidenceDir, { recursive: true });
await mkdir(refineEvidenceDir, { recursive: true });
const fixture = JSON.parse((await readFile(fixturePath, "utf8")).replace(/^\uFEFF/, ""));
if (fixture.ok !== true || !Number.isInteger(fixture.compHostId) || !Number.isInteger(fixture.layerHostId)) {
  throw new Error("M5 Roto Brush fixture metadata is invalid.");
}
const transport = new FixedAeRotoReadbackTransport();
const seedVisualDriver = new EditGptRotoBrushSeedVisualDriverV1({
  executablePath: pythonPath,
  scriptPath: seedVisualScript,
  workingDirectory: visualWorkdir,
  afterFxPath,
  toolSelectScriptPath: toolSelectScript,
  evidenceDirectory: seedEvidenceDir,
  timeoutMs: 120000,
});
const refineVisualDriver = new EditGptRotoBrushRefineEdgeVisualDriverV1({
  executablePath: pythonPath,
  scriptPath: refineVisualScript,
  workingDirectory: visualWorkdir,
  afterFxPath,
  toolSelectScriptPath: toolSelectScript,
  evidenceDirectory: refineEvidenceDir,
  timeoutMs: 120000,
});
const seedController = new GuardedRotoBrushSeedControllerV1(transport, seedVisualDriver);
const refineController = new GuardedRotoBrushRefineEdgeControllerV1(transport, refineVisualDriver);
const proof = {
  proofId: "M5_ROTO_BRUSH_REFINE_EDGE_REAL_AE_V1",
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
  bootstrap: null,
  refine: null,
  typedReadbackRoundtripsMs: [],
  speed: { maxAeActionGapMs: null, withinThreeSecondCeiling: false, subSecondAll: false },
  failure: null,
};
try {
  const bootstrap = await seedController.run({
    operation: "SEED_FOREGROUND",
    compHostId: fixture.compHostId,
    layerHostId: fixture.layerHostId,
    expectedCompName: fixture.compName,
    expectedLayerName: fixture.layerName,
    atTime: fixture.atTime,
    stroke: {
      role: "FOREGROUND",
      pointsNormalized: [{ x: 0.48, y: 0.36 }, { x: 0.50, y: 0.46 }, { x: 0.52, y: 0.56 }],
      radiusNormalized: 0.035,
    },
    evidenceIds: ["M5:ROTO:REFINE:BOOTSTRAP_FOREGROUND:001"],
  });
  proof.bootstrap = bootstrap;
  if (bootstrap.route !== "LOCAL" || bootstrap.finalEffectMatchCount !== 1) {
    throw new Error(bootstrap.escalationReason || "Refine Edge foreground bootstrap failed.");
  }
  const refine = await refineController.run({
    compHostId: fixture.compHostId,
    layerHostId: fixture.layerHostId,
    expectedCompName: fixture.compName,
    expectedLayerName: fixture.layerName,
    atTime: fixture.atTime,
    stroke: {
      role: "REFINE_EDGE",
      pointsNormalized: [{ x: 0.43, y: 0.35 }, { x: 0.44, y: 0.45 }, { x: 0.45, y: 0.55 }],
      radiusNormalized: 0.025,
    },
    evidenceIds: ["M5:ROTO:REFINE:REAL_AE:001"],
  });
  proof.refine = refine;
  proof.typedReadbackRoundtripsMs = transport.roundtripsMs;
  const allGaps = [...bootstrap.aeActionToActionLatenciesMs, ...refine.aeActionToActionLatenciesMs];
  const maxGap = allGaps.length ? Math.max(...allGaps) : null;
  proof.speed = {
    maxAeActionGapMs: maxGap,
    withinThreeSecondCeiling: allGaps.length > 0 && allGaps.every((value) => value <= 3000),
    subSecondAll: allGaps.length > 0 && allGaps.every((value) => value < 1000),
  };
  proof.ok = refine.route === "LOCAL"
    && refine.finalRefineEdgeStrokeCount > refine.baselineRefineEdgeStrokeCount
    && refine.baselineEffectFingerprint !== refine.finalEffectFingerprint
    && proof.speed.withinThreeSecondCeiling;
  proof.status = proof.ok ? "ACCEPTED" : "FAILED";
  if (!proof.ok) proof.failure = refine.escalationReason || "M5 live Refine Edge proof gates were not all satisfied.";
} catch (error) {
  proof.failure = error instanceof Error ? error.message : String(error);
  proof.typedReadbackRoundtripsMs = transport.roundtripsMs;
}
await writeFile(resultPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
console.log(JSON.stringify(proof, null, 2));
process.exitCode = proof.ok ? 0 : 2;