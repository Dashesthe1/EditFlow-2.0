import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

import { GuardedRotoBrushSeedControllerV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-roto-brush-seed-controller.js";
import { EditGptRotoBrushSeedVisualDriverV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-editgpt-roto-brush-seed-visual-driver.js";

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
const fixturePath = required("--fixture");
const resultPath = required("--result");
const readbackScript = required("--readback-script");
const pythonPath = required("--python");
const visualScript = required("--visual-script");
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
  await new Promise((resolve, reject) => {
    const child = spawn(afterFxPath, ["-r", readbackScript], { stdio: "ignore", windowsHide: false, detached: false });
    let settled = false;
    child.once("error", (error) => { if (!settled) { settled = true; reject(error); } });
    setTimeout(() => { if (!settled) { settled = true; child.unref(); resolve(); } }, 40);
  });
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
const fixture = JSON.parse((await readFile(fixturePath, "utf8")).replace(/^\uFEFF/, ""));
if (fixture.ok !== true || !Number.isInteger(fixture.compHostId) || !Number.isInteger(fixture.layerHostId)) {
  throw new Error("M5 Roto Brush fixture metadata is invalid.");
}
const transport = new FixedAeRotoReadbackTransport();
const visualDriver = new EditGptRotoBrushSeedVisualDriverV1({
  executablePath: pythonPath,
  scriptPath: visualScript,
  workingDirectory: visualWorkdir,
  evidenceDirectory: evidenceDir,
  timeoutMs: 120000,
});
const controller = new GuardedRotoBrushSeedControllerV1(transport, visualDriver);
const proof = {
  proofId: "M5_ROTO_BRUSH_FOREGROUND_SEED_REAL_AE_V1",
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
  controller: null,
  typedReadbackRoundtripsMs: [],
  speed: { maxAeActionGapMs: null, withinThreeSecondCeiling: false, subSecondAll: false },
  failure: null,
};
try {
  const controllerResult = await controller.run({
    operation: "SEED_FOREGROUND",
    compHostId: fixture.compHostId,
    layerHostId: fixture.layerHostId,
    expectedCompName: fixture.compName,
    expectedLayerName: fixture.layerName,
    atTime: fixture.atTime,
    stroke: {
      role: "FOREGROUND",
      pointsNormalized: [
        { x: 0.48, y: 0.36 },
        { x: 0.50, y: 0.46 },
        { x: 0.52, y: 0.56 },
      ],
      radiusNormalized: 0.035,
    },
    evidenceIds: ["M5:ROTO:FOREGROUND:REAL_AE:001"],
  });
  proof.controller = controllerResult;
  proof.typedReadbackRoundtripsMs = transport.roundtripsMs;
  const gaps = Array.isArray(controllerResult.aeActionToActionLatenciesMs)
    ? controllerResult.aeActionToActionLatenciesMs : [];
  const maxGap = gaps.length ? Math.max(...gaps) : null;
  proof.speed = {
    maxAeActionGapMs: maxGap,
    withinThreeSecondCeiling: gaps.length > 0 && gaps.every((value) => value <= 3000),
    subSecondAll: gaps.length > 0 && gaps.every((value) => value < 1000),
  };
  proof.ok = controllerResult.route === "LOCAL"
    && controllerResult.finalEffectMatchCount === 1
    && controllerResult.baselineEffectFingerprint !== controllerResult.finalEffectFingerprint
    && proof.speed.withinThreeSecondCeiling;
  proof.status = proof.ok ? "ACCEPTED" : "FAILED";
  if (!proof.ok) proof.failure = controllerResult.escalationReason || "M5 live Roto Brush proof gates were not all satisfied.";
} catch (error) {
  proof.failure = error instanceof Error ? error.message : String(error);
  proof.typedReadbackRoundtripsMs = transport.roundtripsMs;
}
await writeFile(resultPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
console.log(JSON.stringify(proof, null, 2));
process.exitCode = proof.ok ? 0 : 2;
