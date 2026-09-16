import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { GuardedRotoBrushSeedControllerV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-roto-brush-seed-controller.js";
import { EditGptRotoBrushSeedVisualDriverV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-editgpt-roto-brush-seed-visual-driver.js";
import { GuardedRotoBrushExportControllerV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m5-roto-brush-export-controller.js";

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
const dispatchScript = required("--dispatch-script");
const pythonPath = required("--python");
const toolSelectScript = required("--tool-select-script");
const seedVisualScript = required("--seed-visual-script");
const visualWorkdir = required("--visual-workdir");
const evidenceDir = required("--evidence-dir");
const timeoutMs = Number(arg("--timeout-ms") ?? "20000");
const requestPath = path.join(os.tmpdir(), "EditFlow2-m5-roto-brush-export-request.json");
const responsePath = path.join(os.tmpdir(), "EditFlow2-m5-roto-brush-export-response.json");
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
    body: JSON.stringify({ scriptPath: dispatchScript }),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok || payload?.ok !== true) {
    throw new Error(`Warm CEP proof script dispatch failed: ${payload?.error ?? text ?? response.status}`);
  }
};
class FixedAeExportTransport {
  constructor() { this.roundtrips = []; }
  async #dispatch(request) {
    await rm(responsePath, { force: true });
    await writeFile(requestPath, `${JSON.stringify(request)}\n`, "utf8");
    const started = performance.now();
    await invokeAeScript();
    const response = await waitJson(responsePath, timeoutMs);
    const elapsedMs = Number((performance.now() - started).toFixed(3));
    this.roundtrips.push({ protocolVersion: request.protocolVersion, command: request.command, elapsedMs });
    if (response.__transportError) throw new Error(`M5 export AE dispatch failed: ${response.__transportError}`);
    if (response.protocolVersion !== request.protocolVersion || response.requestId !== request.requestId
      || response.operationId !== request.operationId || response.command !== request.command) {
      throw new Error("M5 export AE dispatch correlation mismatch.");
    }
    return response;
  }
  async dispatch(request) { return await this.#dispatch(request); }
  async dispatchRoto(request) { return await this.#dispatch(request); }
  async dispatchHost(request) { return await this.#dispatch(request); }
}

await mkdir(path.dirname(resultPath), { recursive: true });
const bootstrapEvidenceDir = path.join(evidenceDir, "foreground-bootstrap");
await mkdir(bootstrapEvidenceDir, { recursive: true });
const fixture = JSON.parse((await readFile(fixturePath, "utf8")).replace(/^\uFEFF/, ""));
if (fixture.ok !== true || !Number.isInteger(fixture.compHostId) || !Number.isInteger(fixture.layerHostId)) {
  throw new Error("M5 Roto Brush fixture metadata is invalid.");
}
const transport = new FixedAeExportTransport();
const seedController = new GuardedRotoBrushSeedControllerV1(transport, new EditGptRotoBrushSeedVisualDriverV1({
  executablePath: pythonPath,
  scriptPath: seedVisualScript,
  workingDirectory: visualWorkdir,
  afterFxPath,
  toolSelectScriptPath: toolSelectScript,
  evidenceDirectory: bootstrapEvidenceDir,
  timeoutMs: 120000,
}));
const exportController = new GuardedRotoBrushExportControllerV1(transport);
const proof = {
  proofId: "M5_ROTO_BRUSH_TRACK_MATTE_EXPORT_REAL_AE_V1",
  ok: false,
  status: "FAILED",
  contract: "STABLE_TRACK_MATTE_LAYER_EXPORT",
  fixture: {
    compHostId: fixture.compHostId,
    layerHostId: fixture.layerHostId,
    compName: fixture.compName,
    layerName: fixture.layerName,
    atTime: fixture.atTime,
  },
  bootstrap: null,
  export: null,
  typedDispatchRoundtrips: [],
  speed: { maxAeActionGapMs: null, exportMutationRoundtripMs: null, withinThreeSecondCeiling: false, subSecondAll: false },
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
      pointsNormalized: [{ x: 0.47, y: 0.35 }, { x: 0.50, y: 0.46 }, { x: 0.53, y: 0.57 }],
      radiusNormalized: 0.04,
    },
    evidenceIds: ["M5:ROTO:EXPORT:BOOTSTRAP_FOREGROUND:001"],
  });
  proof.bootstrap = bootstrap;
  if (bootstrap.route !== "LOCAL" || bootstrap.finalEffectMatchCount !== 1) {
    throw new Error(bootstrap.escalationReason || "Export proof foreground bootstrap failed.");
  }

  const exported = await exportController.run({
    compHostId: fixture.compHostId,
    layerHostId: fixture.layerHostId,
    expectedCompName: fixture.compName,
    expectedLayerName: fixture.layerName,
    export: { kind: "TRACK_MATTE", stableId: "M5_ROTO_TRACK_MATTE_001" },
    evidenceIds: ["M5:ROTO:EXPORT:TRACK_MATTE:001"],
  });
  proof.export = exported;
  proof.typedDispatchRoundtrips = transport.roundtrips;
  const exportMutation = transport.roundtrips.find((item) => item.command === "layer.duplicate")?.elapsedMs ?? null;
  const actionGaps = [...bootstrap.aeActionToActionLatenciesMs];
  const measured = [...actionGaps, ...(exportMutation === null ? [] : [exportMutation])];
  proof.speed = {
    maxAeActionGapMs: actionGaps.length ? Math.max(...actionGaps) : null,
    exportMutationRoundtripMs: exportMutation,
    withinThreeSecondCeiling: measured.length > 0 && measured.every((value) => value <= 3000),
    subSecondAll: measured.length > 0 && measured.every((value) => value < 1000),
  };
  proof.ok = exported.route === "LOCAL"
    && exported.exportKind === "TRACK_MATTE"
    && exported.exportStableId === "M5_ROTO_TRACK_MATTE_001"
    && exported.structuralOutputVerified === true
    && exported.nativeRotoOutputVerified === true
    && exported.baselineEffectFingerprint === exported.outputEffectFingerprint
    && Number.isInteger(exported.outputLayerHostId)
    && proof.speed.withinThreeSecondCeiling;
  proof.status = proof.ok ? "ACCEPTED" : "FAILED";
  if (!proof.ok) proof.failure = exported.escalationReason || "M5 TRACK_MATTE export proof gates were not all satisfied.";
} catch (error) {
  proof.failure = error instanceof Error ? error.message : String(error);
  proof.typedDispatchRoundtrips = transport.roundtrips;
}
await writeFile(resultPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
console.log(JSON.stringify(proof, null, 2));
process.exitCode = proof.ok ? 0 : 2;
