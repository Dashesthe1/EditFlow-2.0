import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, stat, truncate } from "node:fs/promises";
import path from "node:path";

export const PRACTICE_PRODUCTION_JOB_KINDS_V1 = ["AE_TRANSACTION", "AE_CORRECTION", "AE_GOAL", "AE_BATCH", "BUILD_BASELINE", "PROOF_SCRIPT", "SCRATCH_SEARCH", "LOCAL_RENDER", "SAVE_CHECKPOINT", "REFERENCE_ANALYSIS"] as const;
export class ProductionNoWriteErrorV1 extends Error {}

export type PracticeProductionJobKindV1 = typeof PRACTICE_PRODUCTION_JOB_KINDS_V1[number];
export interface PracticeProductionJobV1 {
  readonly jobId: string;
  readonly requestKey: string;
  readonly assignmentId: string;
  readonly kind: PracticeProductionJobKindV1;
  readonly payload: Readonly<Record<string, any>>;
  readonly dependencyIds: readonly string[];
  readonly status: "PENDING" | "RUNNING" | "SUCCEEDED" | "REJECTED" | "REVIEW_REQUIRED" | "FAILED" | "CANCELLED" | "RECONCILE_REQUIRED";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly heartbeatAt?: string;
  readonly startedAt?: string;
  readonly result?: unknown;
  readonly review?: unknown;
  readonly error?: string;
}

/** A persistent executor for already-authorized decisions. It never invents creative
 * choices or replays an ambiguous AE write after a process crash. */
export class PracticeProductionWorkerV1 {
  readonly #jobs = new Map<string, PracticeProductionJobV1>();
  readonly #path: string;
  readonly #waiters = new Map<string, Set<() => void>>();
  #loaded = false;
  #loading: Promise<void> | null = null;
  #tail: Promise<void> = Promise.resolve();
  #tick: Promise<void> | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  readonly #aborts = new Map<string, AbortController>();
  readonly #enqueueTails = new Map<string, Promise<PracticeProductionJobV1>>();
  constructor(filePath: string, readonly executor: (
    job: PracticeProductionJobV1, signal: AbortSignal,
  ) => Promise<{ readonly result: unknown; readonly reviewRequired?: boolean }>,
  readonly assignmentActive: (id: string) => Promise<boolean>,
  readonly assignmentRunnable: (id: string) => Promise<boolean> = async () => true) { this.#path = path.resolve(filePath); }

  async load(): Promise<void> {
    if (this.#loaded) return;
    if (!this.#loading) this.#loading = this.#load();
    try { await this.#loading; } finally { this.#loading = null; }
  }

  async #load(): Promise<void> {
    let raw = "";
    try { raw = await readFile(this.#path, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const lines = raw.split("\n");
    for (let index = 0; index < lines.length; index++) {
      if (!lines[index]?.trim()) continue;
      try {
        const job = JSON.parse(lines[index]!) as PracticeProductionJobV1;
        this.#jobs.set(job.jobId, job);
      } catch (error) {
        // Only an unflushed final append may be ignored. Corruption in history fails closed.
        if (index !== lines.length - 1) throw error;
        const retained = lines.slice(0, index).join("\n") + (index > 0 ? "\n" : "");
        await truncate(this.#path, Buffer.byteLength(retained, "utf8"));
      }
    }
    this.#loaded = true;
    for (const job of this.#jobs.values()) {
      if (job.status === "RUNNING") await this.#put({ ...job, status: "RECONCILE_REQUIRED",
        error: "Worker restarted during an AE operation; reconcile readback/artifacts before continuing." });
      if (job.status === "REVIEW_REQUIRED" && job.kind === "LOCAL_RENDER"
        && typeof (job.result as any)?.renderPath === "string") {
        // A completed preview is output to inspect, not a permission gate.
        // This never supplies a visual PASS or promotes a learned method.
        const artifact = await stat((job.result as any).renderPath).catch(() => null);
        if (artifact?.isFile() && artifact.size > 0) await this.#put({ ...job, status: "SUCCEEDED",
          review: { kind: "PREVIEW_EXECUTION_COMPLETED", visualAcceptance: false } });
      }
    }
  }

  async #put(job: PracticeProductionJobV1): Promise<void> {
    const next = { ...job, updatedAt: new Date().toISOString() };
    const pending = this.#tail.catch(() => undefined).then(async () => {
      if (this.#jobs.get(job.jobId)?.status === "RECONCILE_REQUIRED" && job.status !== "SUCCEEDED" && job.status !== "CANCELLED" && job.status !== "RECONCILE_REQUIRED") return;
      if (job.status === "RUNNING" && job.heartbeatAt && job.startedAt === this.#jobs.get(job.jobId)?.startedAt && this.#jobs.get(job.jobId)?.status !== "RUNNING" && this.#jobs.has(job.jobId)) return;
      await mkdir(path.dirname(this.#path), { recursive: true });
      await appendFile(this.#path, JSON.stringify(next) + "\n", { encoding: "utf8", flush: true });
      this.#jobs.set(next.jobId, next);
      for (const notify of this.#waiters.get(next.jobId) ?? []) notify();
    });
    this.#tail = pending;
    await pending;
  }

  list(assignmentId?: string): readonly PracticeProductionJobV1[] {
    return [...this.#jobs.values()].filter((job) => assignmentId === undefined || job.assignmentId === assignmentId)
      .map((job) => structuredClone(job));
  }

  async waitForUpdate(jobId: string, updatedAt: string, waitMs: number): Promise<void> {
    const current = this.#jobs.get(jobId);
    if (!current || current.updatedAt !== updatedAt || !["PENDING", "RUNNING"].includes(current.status)) return;
    await new Promise<void>(resolve => {
      const waiters = this.#waiters.get(jobId) ?? new Set<() => void>();
      const finish = () => { clearTimeout(timer); waiters.delete(finish); if (!waiters.size) this.#waiters.delete(jobId); resolve(); };
      const timer = setTimeout(finish, Math.max(0, Math.min(2000, waitMs))); timer.unref?.();
      waiters.add(finish); this.#waiters.set(jobId, waiters);
    });
  }

  async enqueue(input: Omit<PracticeProductionJobV1, "jobId" | "status" | "createdAt" | "updatedAt" | "result" | "error" | "requestKey">): Promise<PracticeProductionJobV1> {
    await this.load();
    const requestKey = createHash("sha256").update(JSON.stringify(input).replace(/ef-worker:\d+:[a-f0-9]{64}/g, "WORKER_AUTHORITY")).digest("hex");
    const pending = this.#enqueueTails.get(requestKey);
    if (pending) return await pending;
    const operation = this.#enqueue(input, requestKey);
    this.#enqueueTails.set(requestKey, operation);
    try { return await operation; } finally { this.#enqueueTails.delete(requestKey); }
  }

  async #enqueue(input: Omit<PracticeProductionJobV1, "jobId" | "status" | "createdAt" | "updatedAt" | "result" | "error" | "requestKey">, requestKey: string): Promise<PracticeProductionJobV1> {
    const prior = this.list().find((job) => job.requestKey === requestKey);
    if (prior) return prior;
    for (const id of input.dependencyIds) {
      if (!this.#jobs.has(id) || this.#jobs.get(id)!.assignmentId !== input.assignmentId) throw new TypeError("Unknown production job dependency: " + id);
    }
    const now = new Date().toISOString();
    const job: PracticeProductionJobV1 = { ...input, jobId: "production-job:" + randomUUID(), requestKey,
      status: "PENDING", createdAt: now, updatedAt: now };
    await this.#put(job);
    return job;
  }

  async resolve(jobId: string, result: unknown): Promise<void> {
    const job = this.#jobs.get(jobId);
    if (!job || !["REVIEW_REQUIRED", "RECONCILE_REQUIRED", "FAILED"].includes(job.status)) throw new TypeError("Job is not waiting for review/reconciliation.");
    // The reviewer cannot replace the worker's issued artifact identity.
    await this.#put({ ...job, status: "SUCCEEDED", review: result });
  }

  async interrupt(assignmentId: string, reason: string): Promise<void> {
    for (const job of this.list(assignmentId)) {
      if (job.status === "RUNNING") {
        this.#aborts.get(job.jobId)?.abort();
        await this.#put({ ...job, status: "RECONCILE_REQUIRED", error: reason });
      }
    }
  }

  async cancel(assignmentId: string): Promise<void> {
    for (const job of this.#jobs.values()) {
      if (job.assignmentId === assignmentId && ["PENDING", "REVIEW_REQUIRED", "RECONCILE_REQUIRED"].includes(job.status)) {
        await this.#put({ ...job, status: "CANCELLED" });
      }
    }
    for (const job of this.list(assignmentId)) this.#aborts.get(job.jobId)?.abort();
  }

  async runOnce(): Promise<void> {
    if (this.#tick !== null) return await this.#tick;
    const tick = async (): Promise<void> => {
      await this.load();
      const ready = this.list().filter((candidate) => candidate.status === "PENDING"
        && !this.list(candidate.assignmentId).some((other) => ["REVIEW_REQUIRED", "RECONCILE_REQUIRED", "FAILED"].includes(other.status))
        && candidate.dependencyIds.every((id) => this.#jobs.get(id)?.status === "SUCCEEDED"));
      const writer = ready.find((job) => job.kind !== "REFERENCE_ANALYSIS");
      const readers = ready.filter((job) => job.kind === "REFERENCE_ANALYSIS").slice(0, 3);
      await Promise.all([...readers, ...(writer ? [writer] : [])].map((job) => this.#execute(job)));
    };
    this.#tick = tick();
    try { await this.#tick; } finally { this.#tick = null; }
  }

  async #execute(job: PracticeProductionJobV1): Promise<void> {
    if (!await this.assignmentActive(job.assignmentId)) { await this.cancel(job.assignmentId); return; }
    if (!await this.assignmentRunnable(job.assignmentId)) return;
    const abort = new AbortController();
    this.#aborts.set(job.jobId, abort);
    await this.#put({ ...job, status: "RUNNING", startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() });
    const heartbeat = setInterval(() => {
      const current = this.#jobs.get(job.jobId);
      if (current?.status === "RUNNING") void this.#put({ ...current, heartbeatAt: new Date().toISOString() }).catch(() => undefined);
    }, 5000);
    heartbeat.unref?.();
    const cancellationPoll = setInterval(() => {
      void this.assignmentActive(job.assignmentId).then((active) => { if (!active) abort.abort(); }).catch(() => undefined);
    }, 1000);
    cancellationPoll.unref?.();
    try {
      const output = await this.executor(job, abort.signal);
      if (this.#jobs.get(job.jobId)?.status === "RECONCILE_REQUIRED") return;
      await this.#put({ ...job, result: output.result,
        status: abort.signal.aborted ? "CANCELLED" : output.reviewRequired ? "REVIEW_REQUIRED" : "SUCCEEDED" });
    } catch (error) {
      const code = (error as { status?: number }).status;
      if (this.#jobs.get(job.jobId)?.status === "RECONCILE_REQUIRED") return;
      await this.#put({ ...job,
        status: abort.signal.aborted ? "CANCELLED" : code === 423 ? "PENDING" : error instanceof ProductionNoWriteErrorV1 ? "REJECTED" : "FAILED",
        error: error instanceof Error ? error.message : String(error) });
    } finally { clearInterval(heartbeat); clearInterval(cancellationPoll); this.#aborts.delete(job.jobId); }
  }

  async start(): Promise<void> {
    await this.load();
    if (this.#timer) return;
    this.#timer = setInterval(() => { void this.runOnce().catch(() => undefined); }, 1000);
    this.#timer.unref?.();
  }
  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    for (const abort of this.#aborts.values()) abort.abort();
    await this.#tick;
  }
}
