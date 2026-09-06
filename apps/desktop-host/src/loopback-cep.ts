import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import {
  AE_ADAPTER_PROTOCOL_VERSION_V11,
  type AeAdapterRequestV11,
  type AeAdapterResponseV11,
  type AeAdapterTransportV11,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";

export interface LoopbackCepBrokerOptions {
  readonly port: number;
  readonly token: string;
  readonly commandTimeoutMs?: number;
  readonly commandLeaseMs?: number;
  readonly expectedExtensionId?: string;
}

export interface LoopbackCepPanelSession {
  readonly sessionId: string;
  readonly protocolVersion: string;
  readonly extensionId: string;
  readonly extensionVersion: string;
  readonly registeredAt: string;
  readonly lastSeenAt: string;
}

interface PendingCommand {
  readonly request: AeAdapterRequestV11;
  readonly resolve: (response: AeAdapterResponseV11) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
  leasedAt: number | null;
  leasedSessionId: string | null;
}

const jsonResponse = (res: ServerResponse, status: number, value: unknown): void => {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
};

const emptyResponse = (res: ServerResponse, status: number): void => {
  res.statusCode = status;
  res.end();
};

const readJson = async (req: IncomingMessage, maxBytes = 1_000_000): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("REQUEST_BODY_TOO_LARGE");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length === 0 ? {} : JSON.parse(text) as unknown;
};

const secureTokenEqual = (expected: string, actual: string): boolean => {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(actual, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
};

const asSingleHeader = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? "" : value ?? "";

const nowIso = (): string => new Date().toISOString();
const RENDER_CAPTURE_TIMEOUT_FLOOR_MS = 180_000;

export class LoopbackCepBroker implements AeAdapterTransportV11 {
  readonly options: Required<LoopbackCepBrokerOptions>;
  #server: Server | null = null;
  #port = 0;
  #session: LoopbackCepPanelSession | null = null;
  #pending = new Map<string, PendingCommand>();
  #queue: string[] = [];

  constructor(options: LoopbackCepBrokerOptions) {
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
      throw new TypeError("Loopback CEP broker port must be an integer from 0 through 65535.");
    }
    if (typeof options.token !== "string" || options.token.length < 32) {
      throw new TypeError("Loopback CEP broker token must contain at least 32 characters.");
    }
    this.options = {
      port: options.port,
      token: options.token,
      commandTimeoutMs: options.commandTimeoutMs ?? 30_000,
      commandLeaseMs: options.commandLeaseMs ?? 3_000,
      expectedExtensionId: options.expectedExtensionId ?? "com.editflow2.bridge.panel",
    };
  }

  get port(): number { return this.#port; }
  get panelSession(): LoopbackCepPanelSession | null {
    return this.#session === null ? null : structuredClone(this.#session);
  }
  get isStarted(): boolean { return this.#server !== null; }

  async start(): Promise<number> {
    if (this.#server !== null) return this.#port;
    const server = createServer((req, res) => { void this.#handle(req, res); });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.options.port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address() as AddressInfo | null;
    if (address === null || address.address !== "127.0.0.1") {
      server.close();
      throw new Error("Loopback CEP broker failed to bind exclusively to 127.0.0.1.");
    }
    this.#server = server;
    this.#port = address.port;
    return this.#port;
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    this.#session = null;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("CEP_BROKER_STOPPED"));
    }
    this.#pending.clear();
    this.#queue = [];
    if (server !== null) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    this.#port = 0;
  }

  async waitForPanel(timeoutMs = 60_000): Promise<LoopbackCepPanelSession> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.#session !== null) return structuredClone(this.#session);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("CEP_PANEL_REGISTRATION_TIMEOUT");
  }

  async dispatch(request: AeAdapterRequestV11): Promise<AeAdapterResponseV11> {
    if (this.#server === null) throw new Error("CEP_BROKER_NOT_STARTED");
    if (request.protocolVersion !== AE_ADAPTER_PROTOCOL_VERSION_V11) {
      throw new Error("CEP_BROKER_PROTOCOL_MISMATCH");
    }
    if (this.#pending.has(request.requestId)) {
      throw new Error(`CEP_DUPLICATE_REQUEST_ID: ${request.requestId}`);
    }

    const commandTimeoutMs = request.command === "render.capture"
      ? Math.max(this.options.commandTimeoutMs, RENDER_CAPTURE_TIMEOUT_FLOOR_MS)
      : this.options.commandTimeoutMs;

    return await new Promise<AeAdapterResponseV11>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(request.requestId);
        this.#queue = this.#queue.filter((id) => id !== request.requestId);
        reject(new Error(`CEP_COMMAND_TIMEOUT: ${request.command} ${request.requestId}`));
      }, commandTimeoutMs);
      this.#pending.set(request.requestId, {
        request: structuredClone(request),
        resolve,
        reject,
        timeout,
        leasedAt: null,
        leasedSessionId: null,
      });
      this.#queue.push(request.requestId);
    });
  }

  #setCors(res: ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-EditFlow-Token");
    res.setHeader("Cache-Control", "no-store");
  }

  #authorized(req: IncomingMessage): boolean {
    const provided = asSingleHeader(req.headers["x-editflow-token"]);
    return provided.length > 0 && secureTokenEqual(this.options.token, provided);
  }

  #validateSession(sessionId: string | null): LoopbackCepPanelSession | null {
    if (sessionId === null || this.#session === null || this.#session.sessionId !== sessionId) return null;
    return this.#session;
  }

  #touchSession(): void {
    if (this.#session === null) return;
    this.#session = { ...this.#session, lastSeenAt: nowIso() };
  }

  #nextLeasable(): PendingCommand | null {
    const now = Date.now();
    for (const requestId of this.#queue) {
      const pending = this.#pending.get(requestId);
      if (pending === undefined) continue;
      if (pending.leasedAt === null || now - pending.leasedAt >= this.options.commandLeaseMs) return pending;
    }
    return null;
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.#setCors(res);
    if (req.method === "OPTIONS") {
      emptyResponse(res, 204);
      return;
    }
    if (!this.#authorized(req)) {
      jsonResponse(res, 401, { error: "UNAUTHORIZED" });
      return;
    }

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (req.method === "POST" && url.pathname === "/v1/register") {
        const body = await readJson(req) as Record<string, unknown>;
        if (body["protocolVersion"] !== AE_ADAPTER_PROTOCOL_VERSION_V11) {
          jsonResponse(res, 409, { error: "PROTOCOL_VERSION_MISMATCH" });
          return;
        }
        if (body["extensionId"] !== this.options.expectedExtensionId) {
          jsonResponse(res, 403, { error: "EXTENSION_ID_MISMATCH" });
          return;
        }
        if (typeof body["extensionVersion"] !== "string" || body["extensionVersion"].length === 0) {
          jsonResponse(res, 400, { error: "EXTENSION_VERSION_REQUIRED" });
          return;
        }
        const timestamp = nowIso();
        this.#session = {
          sessionId: randomUUID(),
          protocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
          extensionId: body["extensionId"],
          extensionVersion: body["extensionVersion"],
          registeredAt: timestamp,
          lastSeenAt: timestamp,
        };
        for (const pending of this.#pending.values()) {
          pending.leasedAt = null;
          pending.leasedSessionId = null;
        }
        jsonResponse(res, 200, {
          sessionId: this.#session.sessionId,
          protocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/next") {
        const session = this.#validateSession(url.searchParams.get("sessionId"));
        if (session === null) {
          jsonResponse(res, 409, { error: "CEP_SESSION_INVALID" });
          return;
        }
        this.#touchSession();
        const pending = this.#nextLeasable();
        if (pending === null) {
          emptyResponse(res, 204);
          return;
        }
        pending.leasedAt = Date.now();
        pending.leasedSessionId = session.sessionId;
        jsonResponse(res, 200, pending.request);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/response") {
        const body = await readJson(req) as Record<string, unknown>;
        const sessionId = typeof body["sessionId"] === "string" ? body["sessionId"] : null;
        if (this.#validateSession(sessionId) === null) {
          jsonResponse(res, 409, { error: "CEP_SESSION_INVALID" });
          return;
        }
        this.#touchSession();
        const response = body["response"] as AeAdapterResponseV11 | undefined;
        if (response === undefined || response === null || typeof response !== "object") {
          jsonResponse(res, 400, { error: "CEP_RESPONSE_REQUIRED" });
          return;
        }
        const pending = this.#pending.get(response.requestId);
        if (pending === undefined) {
          jsonResponse(res, 404, { error: "CEP_REQUEST_NOT_PENDING" });
          return;
        }
        if (
          response.protocolVersion !== AE_ADAPTER_PROTOCOL_VERSION_V11
          || response.operationId !== pending.request.operationId
          || response.transactionId !== pending.request.transactionId
          || response.capabilityId !== pending.request.capabilityId
          || response.command !== pending.request.command
        ) {
          jsonResponse(res, 409, { error: "CEP_RESPONSE_CORRELATION_MISMATCH" });
          return;
        }
        clearTimeout(pending.timeout);
        this.#pending.delete(response.requestId);
        this.#queue = this.#queue.filter((id) => id !== response.requestId);
        pending.resolve(structuredClone(response));
        jsonResponse(res, 200, { accepted: true });
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/status") {
        jsonResponse(res, 200, {
          protocolVersion: AE_ADAPTER_PROTOCOL_VERSION_V11,
          panelConnected: this.#session !== null,
          pendingCommands: this.#pending.size,
          session: this.#session,
        });
        return;
      }

      jsonResponse(res, 404, { error: "NOT_FOUND" });
    } catch (error) {
      jsonResponse(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
