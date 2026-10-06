import { randomBytes, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, closeSync, rmSync } from "node:fs";
import path from "node:path";

export class WorkerAuthorityError extends Error {
  readonly status = 409;
}
export class WorkerAssignmentError extends Error {
  readonly status = 400;
}
export interface ProductionWorkerAuthority {
  assignmentId: string | null;
  sessionId: string | null;
  mode: string | null;
  generation: number;
  credential: string | null;
  state: "IDLE" | "ARMED" | "HANDOFF" | "PAUSED";
  issuedAt: number;
  lastActivityAt: number;
  activitySeq: number;
  reason: string | null;
  launchId: string | null;
  recent: { at: number; signature: string; outcome: string }[];
}

/** Gateway-owned authority. Browser state is never an ownership or health input. */
export class ProductionSupervisionV1 {
  readonly key: string;
  readonly filePath: string;
  #state: ProductionWorkerAuthority;
  #tail: Promise<unknown> = Promise.resolve();
  #gatewayLock: string | null = null;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.filePath = path.join(directory, "authority.json");
    const keyPath = path.join(directory, "supervisor.key");
    if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
    this.key = readFileSync(keyPath, "utf8").trim();
    this.#state = existsSync(this.filePath) ? JSON.parse(readFileSync(this.filePath, "utf8")) : {
      assignmentId: null, sessionId: null, mode: null, generation: 0, credential: null,
      state: "IDLE", issuedAt: 0, lastActivityAt: 0, activitySeq: 0, reason: null, launchId: null, recent: [],
    };
    if (!Number.isSafeInteger(this.#state.generation) || !Array.isArray(this.#state.recent)) throw new Error("CORRUPT_WORKER_AUTHORITY");
  }
  acquireGateway(): void {
    const lock = path.join(path.dirname(this.filePath), "gateway.lock");
    if (existsSync(lock)) {
      const pid = Number(JSON.parse(readFileSync(lock, "utf8")).pid);
      if (!Number.isInteger(pid) || pid <= 0) throw new Error("CORRUPT_GATEWAY_LOCK");
      let alive = true;
      try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false; }
      if (alive) throw new Error("PRODUCTION_GATEWAY_ALREADY_RUNNING");
      rmSync(lock);
    }
    const handle = openSync(lock, "wx", 0o600);
    try { writeFileSync(handle, JSON.stringify({ pid: process.pid }), { flush: true }); } finally { closeSync(handle); }
    this.#gatewayLock = lock;
    if (existsSync(this.filePath)) this.#state = JSON.parse(readFileSync(this.filePath, "utf8"));
  }
  releaseGateway(): void {
    if (this.#gatewayLock) rmSync(this.#gatewayLock, { force: true });
    this.#gatewayLock = null;
  }
  #save(): void {
    writeFileSync(this.filePath + ".tmp", JSON.stringify(this.#state, null, 2), { mode: 0o600, flush: true });
    renameSync(this.filePath + ".tmp", this.filePath);
  }
  publicState(): Omit<ProductionWorkerAuthority, "credential"> {
    const { credential: _credential, ...state } = this.#state;
    return structuredClone(state);
  }
  async exclusive<T>(operation: () => T | Promise<T>): Promise<T> {
    const task = this.#tail.catch(() => undefined).then(operation);
    this.#tail = task;
    return await task;
  }
  async bind(assignment: { assignmentId: string; sessionId: string; mode: string } | null): Promise<void> {
    await this.exclusive(() => {
      if (!assignment) {
        if (this.#state.state !== "IDLE") { this.#state = { ...this.#state, credential: null, state: "IDLE", reason: "terminal" }; this.#save(); }
        return;
      }
      if (this.#state.assignmentId === assignment.assignmentId && this.#state.state !== "IDLE") return;
      this.#state = { ...this.#state, assignmentId: assignment.assignmentId, sessionId: assignment.sessionId, mode: assignment.mode, credential: null, state: "HANDOFF", issuedAt: Date.now(),
        reason: "production_started", launchId: null, lastActivityAt: 0, recent: [] };
      this.#save();
    });
  }
  async issue(assignmentId: string, launchId: string): Promise<string> {
    return await this.exclusive(() => {
      if (this.#state.assignmentId !== assignmentId || this.#state.state === "IDLE" || this.#state.state === "PAUSED") throw new WorkerAuthorityError("ASSIGNMENT_NOT_ARMED");
      if (this.#state.launchId === launchId && this.#state.credential) return this.#state.credential;
      if (this.#state.credential) throw new WorkerAuthorityError("ACTIVE_WORKER_MUST_BE_REVOKED_FIRST");
      const generation = this.#state.generation + 1;
      const credential = `ef-worker:${generation}:${randomBytes(32).toString("hex")}`;
      this.#state = { ...this.#state, generation, credential, state: "ARMED", issuedAt: Date.now(),
        lastActivityAt: 0, launchId, reason: null, recent: [] };
      this.#save();
      return credential;
    });
  }
  async revoke(assignmentId: string, generation: number, reason: string, pause = false): Promise<void> {
    await this.exclusive(() => {
      if (this.#state.assignmentId !== assignmentId || this.#state.generation !== generation) throw new WorkerAuthorityError("STALE_SUPERVISOR_COMMAND");
      this.#state = { ...this.#state, credential: null, state: pause ? "PAUSED" : "HANDOFF", reason };
      this.#save();
    });
  }
  async resume(assignmentId: string): Promise<void> {
    await this.exclusive(() => {
      if (this.#state.assignmentId !== assignmentId || this.#state.state !== "PAUSED") throw new WorkerAuthorityError("ASSIGNMENT_NOT_PAUSED");
      this.#state = { ...this.#state, state: "HANDOFF", reason: "user_resumed", launchId: null }; this.#save();
    });
  }
  async authorized<T>(assignmentId: string, credential: unknown, signatureInput: unknown, operation: () => Promise<T>): Promise<T> {
    return await this.exclusive(async () => {
      // Authenticate the active generation first; invalid/revoked credentials remain fenced.
      if (this.#state.state !== "ARMED" || !credential || credential !== this.#state.credential) {
        throw new WorkerAuthorityError("STALE_WORKER: use only the worker credential supplied in your supervisor continuation prompt.");
      }
      // A typo by the authenticated current worker is a rejected request, not revocation.
      // Never redirect or dispatch it, renew its controller lease, or record progress.
      if (this.#state.assignmentId !== assignmentId) {
        throw new WorkerAssignmentError("ASSIGNMENT_ID_MISMATCH: no write occurred; use the exact assignment ID from your continuation prompt, reconcile retained reads, and correct the request only while this worker remains current.");
      }
      const signature = createHash("sha256").update(JSON.stringify(signatureInput, (key, value) => ["claimedBy", "transactionId", "operationId", "jobId"].includes(key) ? undefined : value).replace(/ef-worker:\d+:[a-f0-9]{64}/g, "worker")).digest("hex");
      let outcome = "SUCCESS";
      try { const result = await operation(); if (typeof result === "number" && result >= 400) outcome = "FAILED"; return result; }
      catch (error) { outcome = "FAILED"; throw error; }
      finally {
        this.#state.lastActivityAt = Date.now(); this.#state.activitySeq++;
        const input = signatureInput as { path?: string; body?: Record<string, any> };
        if (!input.path?.endsWith("/claim") && input.body?.action !== "HEARTBEAT") {
          this.#state.recent = [...this.#state.recent, { at: Date.now(), signature, outcome }].slice(-80);
        }
        this.#save();
      }
    });
  }
}

export function redactWorkerCredentialsV1(value: unknown): string {
  return JSON.stringify(value).replace(/ef-worker:(\d+):[a-f0-9]{64}/g, "ef-worker:$1:REDACTED");
}
