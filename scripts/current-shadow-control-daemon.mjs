import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AeCepAdapterClientV11, AeFilesystemPolicyV11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/v1_1.js";
import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";
import { createDesktopAeSessionV11 } from "../.tmp/runtime/apps/desktop-host/src/v1_1.js";
import { getMcpServerStatus } from "../.tmp/runtime/apps/mcp-server/src/index.js";

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
const session = await createDesktopAeSessionV11(client, "shadow-current-project");

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

const statusPayload = () => ({
  ok: true,
  service: "EditFlow Current Shadow Control",
  repoRoot,  executionMode: session.executionMode,
  adapterBuild: session.adapterBuild,
  hostRevision: session.runner.hostRevision,
  panel,
  controlPlane: getMcpServerStatus(),
});

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
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
    if (req.method === "POST" && url.pathname === "/run") {
      const body = await readJson(req);
      const transactionId = typeof body.transactionId === "string" && body.transactionId ? body.transactionId : `shadow-fast-${Date.now()}`;
      const result = await session.runner.run(body.goal, transactionId);
      sendJson(res, 200, { ...result, status: statusPayload() });
      return;
    }    sendJson(res, 404, { error: "NOT_FOUND" });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
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
