

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";
import { PracticePanelServerV1 } from "../.tmp/runtime/apps/desktop-host/src/practice-panel-server.js";
import { RETIRED_EDIT_EXECUTION_PATHS_V1, retiredEditExecutionResponseV1 } from "../.tmp/runtime/apps/desktop-host/src/production-authority.js";
import { resolvePracticeStatePathsV1 } from "../.tmp/runtime/apps/desktop-host/src/practice-state-paths.js";
import { getMcpServerStatus } from "../.tmp/runtime/apps/mcp-server/src/index.js";
import { ErrorMemoryStore } from "../.tmp/runtime/packages/error-triage/src/index.js";

process.env.EDITFLOW_EDIT_DECISION_AUTHORITY = "CHATGPT_DIRECT";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const configPath = path.join(process.env.APPDATA ?? "", "Adobe", "CEP", "extensions", "com.editflow2.bridge", "client", "runtime-config.js");
const rawConfig = await readFile(configPath, "utf8");
const match = rawConfig.match(/Object\.freeze\((\{.*\})\);?\s*$/s);
if (!match) throw new Error("Unable to parse installed CEP runtime config.");
const config = JSON.parse(match[1]);

const broker = new LoopbackCepBroker({
  port: config.port,
  token: config.token,
  commandTimeoutMs: 30_000,
  commandLeaseMs: 1_000,
  expectedExtensionId: config.extensionId,
  supportedProtocolVersions: config.supportedProtocolVersions,
});
await broker.start();
const panel = await broker.waitForPanel(15_000);
const activePanel = broker.panelSession ?? panel;
const stabilizationProtocolAvailable =
  Array.isArray(activePanel?.supportedProtocolVersions)
  && activePanel.supportedProtocolVersions.includes("2.3.0");
const localAppData = process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? repoRoot, "AppData", "Local");
const errorMemoryPath = path.join(localAppData, "EditFlow2", "error-memory.json");
const errorMemory = new ErrorMemoryStore(errorMemoryPath);

const practiceStatePaths = resolvePracticeStatePathsV1();
const runtimeId = "RESUMABLE_PREFLIGHT_V1";
const buildId = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
const canonicalRuntimePath = path.join(localAppData, "EditFlow2", "current-runtime.json");
const practiceArtifactDir = path.resolve(
  process.env.EDITFLOW_PRACTICE_ARTIFACT_DIR
    ?? path.join(localAppData, "EditFlow2", "practice-artifacts"),
);
const practicePanel = new PracticePanelServerV1({
  port: 0,
  token: config.token,
  repositoryRoot: repoRoot,
  buildId,
  artifactDir: practiceArtifactDir,
  learningMemoryFilePath: practiceStatePaths.learningMemoryFilePath,
  editTypeRegistryFilePath: practiceStatePaths.editTypeRegistryFilePath,
  gptOrchestrationFilePath: path.join(practiceStatePaths.stateDir, "gpt-orchestration.json"),
  broker,
  ...(process.env.EDITFLOW_FFMPEG_PATH ? { ffmpegPath: process.env.EDITFLOW_FFMPEG_PATH } : {}),
  renderTimeoutMs: Number(process.env.EDITFLOW_PRACTICE_TIMEOUT_MS ?? 180_000),
  stabilization: { protocolV23Available: stabilizationProtocolAvailable, visualDriver: null },
});
await practicePanel.start();

await practicePanel.observeCurrentAe();

const readJson = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
};

const sendJson = (res, status, value) => {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
};

const failureContext = (req, requestPath) => ({
  process: { pid: process.pid, execPath: process.execPath },
  request: { method: req.method ?? null, path: requestPath },
  afterEffects: { hostRevision: practicePanel.controlStatus().hostRevision, projectId: "practice-gpt-controller" },
  cep: {
    connected: Boolean(broker.panelSession ?? panel),
    sessionId: (broker.panelSession ?? panel)?.sessionId ?? null,
    protocolVersion: (broker.panelSession ?? panel)?.protocolVersion ?? null,
    extensionVersion: (broker.panelSession ?? panel)?.extensionVersion ?? null,
  },
});

const triageFailure = async (error, req, requestPath) => {
  const errorText = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack ?? null : null;
  const triage = await errorMemory.diagnose(errorText);
  return { error: errorText, stack, context: failureContext(req, requestPath), triage };
};

const proxyPracticeRequest = (req, res) => new Promise((resolve, reject) => {
  const headers = { ...req.headers, host: `127.0.0.1:${practicePanel.port}` };
  const upstream = httpRequest({
    host: "127.0.0.1",
    port: practicePanel.port,
    path: req.url ?? "/",
    method: req.method ?? "GET",
    headers,
  }, (upstreamResponse) => {
    res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(res);
    upstreamResponse.on("end", resolve);
  });
  upstream.on("error", reject);
  req.pipe(upstream);
});

const statusPayload = () => ({
  ok: true,
  service: "EditFlow Current Shadow Control",
  repoRoot, runtimeId, buildId, canonicalRuntimePath,
  ...practicePanel.controlStatus(),
  primarySystemOnly: true,
  directMutationRoutes: "REMOVED",
  clipResearchPolicy: "ON_DEMAND_METHOD_LEARNING_V1",
  editingPath: "DIRECT_EDITING_V1",
  footageSelectionAuthority: "CHATGPT_DIRECT",
  availableFootageSelectionMethods: ["CHATGPT_DIRECT"],
  rawShotCandidateRanking: "REMOVED_FROM_PRODUCTION",
  editDecisionAuthority: "CHATGPT_DIRECT",
  automaticEffectSelection: "REMOVED_FROM_PRODUCTION",
  automaticCandidateRanking: "REMOVED_FROM_PRODUCTION",
  finalReviewAuthority: "CHATGPT_DIRECT",
  localQwenUiDecisions: "REMOVED",
  panel: broker.panelSession ?? panel,
  practiceService: {
    integrated: true,
    internalPort: practicePanel.port,
    artifactDir: practiceArtifactDir,
    stateDir: practiceStatePaths.stateDir,
  },
  controlPlane: getMcpServerStatus(),
  errorTriage: { enabled: true, mode: "LOCAL_MEMORY_THEN_BOUNDED_LOOKUP", onlineLookupBudgetMs: 10_000 },
});

const server = createServer(async (req, res) => {
  const requestPath = req.url ?? "/";
  try {
    const url = new URL(requestPath, "http://127.0.0.1");
    if (RETIRED_EDIT_EXECUTION_PATHS_V1.has(url.pathname)) {
      sendJson(res, 410, retiredEditExecutionResponseV1());
      return;
    }
    if (url.pathname.startsWith("/v1/product/")) {
      await proxyPracticeRequest(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/mutation-lease") {
      sendJson(res, 200, { ok: true, lease: practicePanel.controlStatus().mutationLease });
      return;
    }
    if (req.method === "GET" && url.pathname === "/healthz") {
      sendJson(res, 200, statusPayload());
      return;
    }
    if (req.method === "GET" && url.pathname === "/status") {
      sendJson(res, 200, statusPayload());
      return;
    }
    if (req.method === "GET" && url.pathname === "/state") {
      const state = await practicePanel.observeCurrentAe();
      sendJson(res, 200, { ...statusPayload(), revision: state.hostRevision, state });
      return;
    }
    if (req.method === "GET" && url.pathname === "/error-memory") {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
      const [stats, entries] = await Promise.all([errorMemory.stats(), errorMemory.list(limit)]);
      sendJson(res, 200, { ok: true, path: errorMemoryPath, stats, entries });
      return;
    }
    if (req.method === "POST" && url.pathname === "/triage-error") {
      const body = await readJson(req);
      if (typeof body.errorText !== "string" || body.errorText.trim().length === 0) throw new Error("ERROR_TEXT_REQUIRED");
      const triage = await errorMemory.diagnose(body.errorText);
      sendJson(res, 200, { ok: true, triage, context: body.context ?? null });
      return;
    }
    if (req.method === "POST" && url.pathname === "/remember-error") {
      const body = await readJson(req);
      if (typeof body.errorText !== "string" || typeof body.resolution !== "string") throw new Error("ERROR_MEMORY_INPUT_REQUIRED");
      const entry = await errorMemory.remember({
        errorText: body.errorText,
        resolution: body.resolution,
        avoidRepeat: body.avoidRepeat,
        domain: body.domain,
        code: body.code,
        verified: body.verified,
      });
      sendJson(res, 200, { ok: true, entry });
      return;
    }
    if (req.method === "POST" && url.pathname === "/error-outcome") {
      const body = await readJson(req);
      if (typeof body.signature !== "string" || typeof body.success !== "boolean") throw new Error("ERROR_OUTCOME_INPUT_REQUIRED");
      const entry = await errorMemory.recordOutcome(body.signature, body.success);
      sendJson(res, entry ? 200 : 404, { ok: Boolean(entry), entry });
      return;
    }
    sendJson(res, 404, { error: "NOT_FOUND" });
  } catch (error) {
    try {
      sendJson(res, typeof error?.status === "number" ? error.status : 500, await triageFailure(error, req, requestPath));
    } catch (triageError) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack ?? null : null,
        context: failureContext(req, requestPath),
        triageError: triageError instanceof Error ? triageError.message : String(triageError),
      });
    }
  }
});

server.listen(32146, "127.0.0.1", async () => {
  await mkdir(path.dirname(canonicalRuntimePath), { recursive: true });
  const manifest = { schema: "editflow.current-runtime.v1", runtimeId, buildId, repositoryRoot: repoRoot,
    stateDir: practiceStatePaths.stateDir, artifactDir: practiceArtifactDir,
    productBaseUrl: "http://127.0.0.1:32146", startedAt: new Date().toISOString() };
  const temporaryManifest = canonicalRuntimePath + ".tmp-" + String(process.pid);
  await writeFile(temporaryManifest, JSON.stringify(manifest, null, 2) + "\n");
  await rename(temporaryManifest, canonicalRuntimePath);
  console.log(JSON.stringify({ event: "CURRENT_SHADOW_CONTROL_READY", port: 32146, ...statusPayload() }));
});

const shutdown = async () => {
  await new Promise((resolve) => server.close(() => resolve()));
  await practicePanel.stop().catch(() => {});
  await broker.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
