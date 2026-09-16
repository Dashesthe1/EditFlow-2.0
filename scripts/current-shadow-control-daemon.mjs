import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AeCepAdapterClientV11, AeFilesystemPolicyV11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/v1_1.js";
import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";
import { LocalFastRuntimeV1 } from "../.tmp/runtime/apps/desktop-host/src/local-fast-runtime.js";
import { getMcpServerStatus } from "../.tmp/runtime/apps/mcp-server/src/index.js";
import { ErrorMemoryStore } from "../.tmp/runtime/packages/error-triage/src/index.js";

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
let requestCounter = 0;
const client = new AeCepAdapterClientV11(
  broker,
  () => `shadow-current-${++requestCounter}`,
  new AeFilesystemPolicyV11([process.env.USERPROFILE ?? repoRoot]),
);
const runtime = await LocalFastRuntimeV1.create(client, {
  projectId: "shadow-current-project",
  maxBatchActions: 64,
  totalBudgetMs: 30_000,
  actionBudgetMs: 1_000,
  leaseTtlMs: 120_000,
});
const session = runtime.session;
const localAppData = process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? repoRoot, "AppData", "Local");
const errorMemoryPath = path.join(localAppData, "EditFlow2", "error-memory.json");
const errorMemory = new ErrorMemoryStore(errorMemoryPath);

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
  afterEffects: { hostRevision: session.runner.hostRevision, projectId: "shadow-current-project" },
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

const statusPayload = () => ({
  ok: true,
  service: "EditFlow Current Shadow Control",
  repoRoot,  executionMode: session.executionMode,
  adapterBuild: session.adapterBuild,
  hostRevision: session.runner.hostRevision,
  localRuntime: runtime.status(),
  panel,
  controlPlane: getMcpServerStatus(),
  errorTriage: { enabled: true, mode: "LOCAL_MEMORY_THEN_BOUNDED_LOOKUP", onlineLookupBudgetMs: 10_000 },
});

const server = createServer(async (req, res) => {
  const requestPath = req.url ?? "/";
  try {
    const url = new URL(requestPath, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/healthz") {
      sendJson(res, 200, statusPayload());
      return;
    }
    if (req.method === "GET" && url.pathname === "/status") {
      sendJson(res, 200, statusPayload());
      return;
    }
    if (req.method === "GET" && url.pathname === "/state") {
      const state = await session.runner.refresh();
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
    if (req.method === "POST" && url.pathname === "/run") {
      const body = await readJson(req);
      const transactionId = typeof body.transactionId === "string" && body.transactionId ? body.transactionId : `shadow-fast-${Date.now()}`;
      const result = await runtime.runGoal(body.goal, transactionId);
      sendJson(res, 200, { ...result, status: statusPayload() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/run-batch") {
      const body = await readJson(req);
      const transactionId = typeof body.transactionId === "string" && body.transactionId ? body.transactionId : `shadow-batch-${Date.now()}`;
      const result = await runtime.runRoutineBatch(body.intents, transactionId);
      sendJson(res, 200, { ...result, status: statusPayload() });
      return;
    }
    sendJson(res, 404, { error: "NOT_FOUND" });
  } catch (error) {
    try {
      sendJson(res, 500, await triageFailure(error, req, requestPath));
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

server.listen(32146, "127.0.0.1", () => {
  console.log(JSON.stringify({ event: "CURRENT_SHADOW_CONTROL_READY", port: 32146, ...statusPayload() }));
});

const shutdown = async () => {
  await new Promise((resolve) => server.close(() => resolve()));
  await broker.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
