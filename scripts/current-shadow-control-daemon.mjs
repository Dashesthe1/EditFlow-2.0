import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AeCepAdapterClientV11, AeFilesystemPolicyV11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/v1_1.js";
import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";
import { LocalFastRuntimeV1 } from "../.tmp/runtime/apps/desktop-host/src/local-fast-runtime.js";
import { CurrentAeTransactionRuntimeV1 } from "../.tmp/runtime/apps/desktop-host/src/current-ae-transaction-runtime.js";
import { EditGptStabilizationVisualDriverV1 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m4-editgpt-stabilization-visual-driver.js";
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
const activePanel = broker.panelSession ?? panel;
const stabilizationProtocolAvailable =
  Array.isArray(activePanel?.supportedProtocolVersions)
  && activePanel.supportedProtocolVersions.includes("2.3.0");
const stabilizationPython = process.env.EDITGPT_PYTHON
  ?? path.join(process.env.USERPROFILE ?? repoRoot, "editgpt", ".venv", "Scripts", "python.exe");
const stabilizationScript = path.join(
  repoRoot,
  "packages",
  "adapters",
  "ae-cep",
  "runtime",
  "editgpt_stabilization_visual_driver.py",
);
const stabilizationVisualDriver =
  stabilizationProtocolAvailable
  && existsSync(stabilizationPython)
  && existsSync(stabilizationScript)
    ? new EditGptStabilizationVisualDriverV1({
        executablePath: stabilizationPython,
        scriptPath: stabilizationScript,
        workingDirectory: repoRoot,
        evidenceDirectory: path.join(repoRoot, ".tmp", "current-shadow", "stabilization-visual"),
        timeoutMs: 120_000,
        analysisWindowSeconds: 5,
      })
    : null;
const currentTransactionRuntime = new CurrentAeTransactionRuntimeV1(
  broker,
  "shadow-current-project",
  64,
  {
    protocolV23Available: stabilizationProtocolAvailable,
    visualDriver: stabilizationVisualDriver,
  },
);
const localAppData = process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? repoRoot, "AppData", "Local");
const errorMemoryPath = path.join(localAppData, "EditFlow2", "error-memory.json");
const errorMemory = new ErrorMemoryStore(errorMemoryPath);

const MUTATION_LEASE_HEADER = "x-editflow-mutation-lease";
const DEFAULT_MUTATION_LEASE_TTL_MS = 120_000;
const MAX_MUTATION_LEASE_TTL_MS = 180_000;
const LEASE_GUARDED_MUTATION_PATHS = new Set([
  "/proof-script",
  "/run-transaction",
  "/run-correction-transaction",
  "/run",
  "/run-batch",
]);
let mutationLease = null;
const activeMutationLease = () => {
  if (mutationLease !== null && mutationLease.expiresAt <= Date.now()) mutationLease = null;
  return mutationLease;
};
const mutationLeaseStatus = () => {
  const lease = activeMutationLease();
  return lease === null
    ? { held: false }
    : { held: true, owner: lease.owner, expiresAt: lease.expiresAt };
};
const requestMutationLeaseToken = (req) => {
  const raw = req.headers[MUTATION_LEASE_HEADER];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
};
const admitLeasedMutation = (req, res) => {
  const lease = activeMutationLease();
  if (lease === null || requestMutationLeaseToken(req) === lease.token) return true;
  sendJson(res, 423, {
    ok: false,
    error: "MUTATION_LEASE_HELD",
    lease: { owner: lease.owner, expiresAt: lease.expiresAt },
  });
  return false;
};

const proofScriptRoot = path.resolve(repoRoot, "scripts", "windows");
const resolveProofScript = async (value) => {
  if (typeof value !== "string" || value.length === 0) throw new Error("PROOF_SCRIPT_PATH_REQUIRED");
  const candidate = path.resolve(value);
  const relative = path.relative(proofScriptRoot, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative) || path.extname(candidate).toLowerCase() !== ".jsx") {
    throw new Error("PROOF_SCRIPT_PATH_NOT_ALLOWED");
  }
  await readFile(candidate, "utf8");
  return candidate;
};

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
  currentTransactionRuntime: currentTransactionRuntime.status(),
  mutationLease: mutationLeaseStatus(),
  panel: broker.panelSession ?? panel,
  controlPlane: getMcpServerStatus(),
  errorTriage: { enabled: true, mode: "LOCAL_MEMORY_THEN_BOUNDED_LOOKUP", onlineLookupBudgetMs: 10_000 },
});

const server = createServer(async (req, res) => {
  const requestPath = req.url ?? "/";
  try {
    const url = new URL(requestPath, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/mutation-lease") {
      sendJson(res, 200, { ok: true, lease: mutationLeaseStatus() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/mutation-lease/acquire") {
      const body = await readJson(req);
      const current = activeMutationLease();
      if (current !== null) {
        sendJson(res, 423, {
          ok: false,
          error: "MUTATION_LEASE_HELD",
          lease: { owner: current.owner, expiresAt: current.expiresAt },
        });
        return;
      }
      const owner = typeof body.owner === "string" && body.owner.trim().length > 0
        ? body.owner.trim()
        : "anonymous-proof";
      const requestedTtl = Number(body.ttlMs ?? DEFAULT_MUTATION_LEASE_TTL_MS);
      const ttlMs = Math.max(
        5_000,
        Math.min(MAX_MUTATION_LEASE_TTL_MS, Number.isFinite(requestedTtl) ? requestedTtl : DEFAULT_MUTATION_LEASE_TTL_MS),
      );
      mutationLease = {
        token: randomUUID(),
        owner,
        acquiredAt: Date.now(),
        expiresAt: Date.now() + ttlMs,
      };
      sendJson(res, 200, { ok: true, lease: { ...mutationLease } });
      return;
    }
    if (req.method === "POST" && url.pathname === "/mutation-lease/release") {
      const body = await readJson(req);
      const current = activeMutationLease();
      if (current === null) {
        sendJson(res, 200, { ok: true, released: false, lease: { held: false } });
        return;
      }
      const token = typeof body.token === "string" ? body.token : requestMutationLeaseToken(req);
      if (token !== current.token) {
        sendJson(res, 409, { ok: false, error: "MUTATION_LEASE_TOKEN_MISMATCH" });
        return;
      }
      mutationLease = null;
      sendJson(res, 200, { ok: true, released: true, lease: { held: false } });
      return;
    }
    if (
      req.method === "POST"
      && LEASE_GUARDED_MUTATION_PATHS.has(url.pathname)
      && !admitLeasedMutation(req, res)
    ) return;
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
    if (req.method === "POST" && url.pathname === "/proof-script") {
      const body = await readJson(req);
      const scriptPath = await resolveProofScript(body.scriptPath);
      const activePanel = broker.panelSession ?? panel;
      if (!activePanel || typeof activePanel.protocolVersion !== "string") throw new Error("CEP_PANEL_NOT_CONNECTED");
      const sequence = ++requestCounter;
      const suffix = `${Date.now()}-${sequence}`;
      const response = await broker.dispatch({
        protocolVersion: activePanel.protocolVersion,
        requestId: `shadow-proof-request-${suffix}`,
        transactionId: `shadow-proof-tx-${suffix}`,
        operationId: `shadow-proof-op-${suffix}`,
        capabilityId: "internal.proof.eval_file",
        command: "proof.eval_file",
        payload: { scriptPath },
      });
      const ok = response?.outcome === "APPLIED";
      sendJson(res, ok ? 200 : 502, { ok, scriptPath, response });
      return;
    }
    if (req.method === "POST" && url.pathname === "/run-transaction") {
      const body = await readJson(req);
      const result = await currentTransactionRuntime.execute(body.plan);
      const ok = result.state === "COMMITTED";
      sendJson(res, ok ? 200 : 409, { ok, result, status: statusPayload() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/run-correction-transaction") {
      const body = await readJson(req);
      const result = await currentTransactionRuntime.executeCorrection(body.plan);
      const ok = result.state === "COMMITTED";
      sendJson(res, ok ? 200 : 409, { ok, result, status: statusPayload() });
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
