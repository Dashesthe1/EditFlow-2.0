import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  AeCepAdapterClientV11,
  AeFilesystemPolicyV11,
} from "../../../packages/adapters/ae-cep/src/v1_1.js";
import type {
  AeAdapterTransportV11,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";
import type {
  PracticeAeBaselinePlanV1,
} from "../../../packages/practice-homework/src/ae-baseline.js";
import type {
  PracticeM6AeRenderDriverV1,
} from "./practice-m6-current-ae-runtime.js";

interface RenderCompletionV1 {
  readonly schemaVersion: 1;
  readonly jobId: string;
  readonly status: "DONE" | "FAILED";
  readonly ok: boolean;
  readonly outputPath: string;
  readonly error: string | null;
  readonly queueItemRemoved: boolean;
}

interface PracticeAttemptBaselineV1 {
  readonly projectFingerprint: string;
  readonly itemCount: number;
  readonly compStableId: string;
}

export interface PracticeM6AeRenderDriverConfigV1 {
  readonly transport: AeAdapterTransportV11;
  readonly projectId: string;
  readonly artifactDir: string;
  readonly renderTimeoutMs?: number;
  readonly restoreUndoLimit?: number;
}

const sleep = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

const safeStem = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64)
  || "practice";

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;

const fileExistsNonEmpty = async (filePath: string): Promise<boolean> => {
  try {
    const metadata = await stat(filePath);
    return metadata.isFile() && metadata.size > 0;
  } catch {
    return false;
  }
};

const parseCompletion = (value: unknown): RenderCompletionV1 => {
  const candidate = asRecord(value);
  if (candidate === null || candidate["schemaVersion"] !== 1) {
    throw new TypeError("Practice render completion marker has an invalid schema.");
  }
  const status = candidate["status"];
  if (status !== "DONE" && status !== "FAILED") {
    throw new TypeError("Practice render completion marker has an invalid status.");
  }
  if (
    typeof candidate["jobId"] !== "string"
    || typeof candidate["ok"] !== "boolean"
    || typeof candidate["outputPath"] !== "string"
    || typeof candidate["queueItemRemoved"] !== "boolean"
    || (candidate["error"] !== null && typeof candidate["error"] !== "string")
  ) {
    throw new TypeError("Practice render completion marker is incomplete.");
  }
  return candidate as unknown as RenderCompletionV1;
};

const waitForCompletion = async (
  completionPath: string,
  expectedJobId: string,
  timeoutMs: number,
): Promise<RenderCompletionV1> => {
  const deadline = Date.now() + timeoutMs;
  let lastError = "completion marker unavailable";
  while (Date.now() < deadline) {
    try {
      const completion = parseCompletion(
        JSON.parse(await readFile(completionPath, "utf8")) as unknown,
      );
      if (completion.jobId === expectedJobId) return completion;
      lastError = "stale completion marker " + completion.jobId;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(125);
  }
  throw new Error(
    "PRACTICE_RENDER_COMPLETION_TIMEOUT: " + expectedJobId + " (" + lastError + ")",
  );
};

export class PracticeM6AeRenderDriverCurrentV1
implements PracticeM6AeRenderDriverV1 {
  readonly client: AeCepAdapterClientV11;
  readonly projectId: string;
  readonly artifactDir: string;
  readonly renderTimeoutMs: number;
  readonly restoreUndoLimit: number;

  readonly #baselineBySession = new Map<string, PracticeAttemptBaselineV1>();
  readonly #appliedOperationsBySession = new Map<string, number>();
  readonly #finalizedAttemptBySession = new Map<string, {
    readonly projectFingerprint: string;
    readonly itemCount: number;
    readonly operationCount: number;
  }>();
  #operationCounter = 0;

  constructor(config: PracticeM6AeRenderDriverConfigV1) {
    this.projectId = config.projectId;
    this.artifactDir = path.resolve(config.artifactDir);
    this.renderTimeoutMs = config.renderTimeoutMs ?? 60_000;
    this.restoreUndoLimit = config.restoreUndoLimit ?? 384;
    if (!Number.isInteger(this.restoreUndoLimit) || this.restoreUndoLimit < 1) {
      throw new TypeError("Practice render restoreUndoLimit must be a positive integer.");
    }
    if (!Number.isFinite(this.renderTimeoutMs) || this.renderTimeoutMs < 1_000) {
      throw new TypeError("Practice render timeout must be at least 1000ms.");
    }
    this.client = new AeCepAdapterClientV11(
      config.transport,
      () => "practice-m6-render-" + String(++this.#operationCounter),
      new AeFilesystemPolicyV11([this.artifactDir]),
    );
  }

  async #restoreBaseline(
    sessionId: string,
    baseline: PracticeAttemptBaselineV1,
  ): Promise<number> {
    const undoCount = this.#appliedOperationsBySession.get(sessionId) ?? 0;
    if (undoCount > this.restoreUndoLimit) {
      throw new Error(
        "PRACTICE_ATTEMPT_BASELINE_RESTORE_LIMIT: exact Practice mutation count exceeds the restore budget.",
      );
    }
    let current = await this.client.observe(this.projectId);
    if (undoCount > 0) {
      const finalized = this.#finalizedAttemptBySession.get(sessionId);
      if (finalized === undefined
        || finalized.operationCount !== undoCount
        || finalized.projectFingerprint !== current.observed.projectFingerprint
        || finalized.itemCount !== current.project.itemCount) {
        throw new Error(
          "PRACTICE_ATTEMPT_BASELINE_DRIFT: the completed Practice attempt no longer matches the current AE project; unrelated edits will not be undone.",
        );
      }
    }
    for (let index = 0; index < undoCount; index += 1) {
      const response = await this.client.undoLast({
        transactionId: "practice-m6:restore:" + sessionId,
        operationId: "practice-m6:restore:" + String(++this.#operationCounter),
        expectedState: current.observed,
      });
      if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
        throw new Error(
          "PRACTICE_ATTEMPT_BASELINE_RESTORE_FAILED: "
            + (response.error?.code ?? response.outcome),
        );
      }
      current = await this.client.observe(this.projectId);
    }
    if (
      current.observed.projectFingerprint !== baseline.projectFingerprint
      || current.project.itemCount !== baseline.itemCount
    ) {
      throw new Error(
        "PRACTICE_ATTEMPT_BASELINE_DRIFT: exact EditFlow-owned undo did not restore the Practice baseline; unrelated project drift will not be undone.",
      );
    }
    this.#appliedOperationsBySession.set(sessionId, 0);
    this.#finalizedAttemptBySession.delete(sessionId);
    return undoCount;
  }

  async prepareAttempt(input: {
    readonly sessionId: string;
    readonly attempt: number;
    readonly baselinePlan: PracticeAeBaselinePlanV1;
  }): Promise<{ readonly evidenceRefs?: readonly string[] }> {
    const existing = this.#baselineBySession.get(input.sessionId);
    let undoCount = 0;
    if (existing === undefined) {
      const observed = await this.client.observe(this.projectId);
      if (!observed.project.items.some((item) =>
        item.stableId === input.baselinePlan.compStableId)) {
        throw new Error(
          "PRACTICE_BASELINE_COMP_MISSING: " + input.baselinePlan.compStableId,
        );
      }
      this.#baselineBySession.set(input.sessionId, {
        projectFingerprint: observed.observed.projectFingerprint,
        itemCount: observed.project.itemCount,
        compStableId: input.baselinePlan.compStableId,
      });
      this.#appliedOperationsBySession.set(input.sessionId, 0);
      this.#finalizedAttemptBySession.delete(input.sessionId);
    } else {
      if (existing.compStableId !== input.baselinePlan.compStableId) {
        throw new Error(
          "PRACTICE_SESSION_BASELINE_CHANGED: a Practice session cannot switch baseline comps.",
        );
      }
      undoCount = await this.#restoreBaseline(input.sessionId, existing);
    }
    return {
      evidenceRefs: [
        "practice-attempt-baseline:" + input.baselinePlan.baselineId,
        "practice-attempt-number:" + String(input.attempt),
        "practice-attempt-restore-undo-count:" + String(undoCount),
        ...(input.baselinePlan.audioMatchId === null
          ? ["practice-attempt-audio:none"]
          : ["practice-attempt-audio-preserved:" + input.baselinePlan.audioMatchId]),
      ],
    };
  }

  recordAppliedOperations(input: {
    readonly sessionId: string;
    readonly attempt: number;
    readonly count: number;
  }): void {
    if (!Number.isInteger(input.count) || input.count < 0) {
      throw new TypeError("Practice applied-operation count must be a non-negative integer.");
    }
    if (!this.#baselineBySession.has(input.sessionId)) {
      throw new Error(
        "PRACTICE_APPLIED_OPERATION_WITHOUT_BASELINE: prepareAttempt must run first.",
      );
    }
    const previous = this.#appliedOperationsBySession.get(input.sessionId) ?? 0;
    this.#appliedOperationsBySession.set(input.sessionId, previous + input.count);
  }

  async finalizeAttempt(sessionId: string): Promise<void> {
    if (!this.#baselineBySession.has(sessionId)) {
      throw new Error("PRACTICE_ATTEMPT_FINALIZE_WITHOUT_BASELINE");
    }
    const observed = await this.client.observe(this.projectId);
    this.#finalizedAttemptBySession.set(sessionId, {
      projectFingerprint: observed.observed.projectFingerprint,
      itemCount: observed.project.itemCount,
      operationCount: this.#appliedOperationsBySession.get(sessionId) ?? 0,
    });
  }

  async #render(input: {
    readonly sessionId: string;
    readonly attempt: number;
    readonly compStableId: string;
    readonly suffix: string;
    readonly startMs: number;
    readonly durationMs: number;
  }): Promise<{ readonly renderPath: string; readonly evidenceRefs: readonly string[] }> {
    if (input.durationMs <= 0 || !Number.isFinite(input.durationMs)) {
      throw new TypeError("Practice render duration must be finite and positive.");
    }
    await mkdir(this.artifactDir, { recursive: true });
    const renderPath = path.join(
      this.artifactDir,
      safeStem(input.sessionId)
        + "-attempt-" + String(input.attempt).padStart(3, "0")
        + "-" + safeStem(input.suffix) + ".avi",
    );
    const observed = await this.client.observe(this.projectId);
    const response = await this.client.executePublic("render.capture", {
      transactionId: "practice-m6:render:" + input.sessionId,
      operationId: "practice-m6:render:" + String(++this.#operationCounter),
      payload: {
        comp: { stableId: input.compStableId },
        outputPath: renderPath,
        timeSpanStart: input.startMs / 1000,
        timeSpanDuration: input.durationMs / 1000,
      },
      expectedState: observed.observed,
      readbackProfile: "PRACTICE_M6_RENDER_V1",
    });
    if (response.outcome === "FAILED" || response.outcome === "REJECTED") {
      throw new Error(
        "PRACTICE_RENDER_SCHEDULE_FAILED: "
          + (response.error?.code ?? response.outcome),
      );
    }
    const readback = asRecord(response.readback);
    const jobId = readback?.["jobId"];
    const completionPath = readback?.["completionPath"];
    if (typeof jobId !== "string" || typeof completionPath !== "string") {
      throw new Error("PRACTICE_RENDER_COMPLETION_CONTRACT_MISSING");
    }
    const completion = await waitForCompletion(
      completionPath,
      jobId,
      this.renderTimeoutMs,
    );
    if (
      !completion.ok
      || completion.status !== "DONE"
      || !completion.queueItemRemoved
      || !(await fileExistsNonEmpty(completion.outputPath))
    ) {
      throw new Error(
        "PRACTICE_RENDER_FAILED: " + (completion.error ?? completion.status),
      );
    }
    return {
      renderPath: completion.outputPath,
      evidenceRefs: [
        "practice-render-job:" + jobId,
        "practice-render-completion:" + completionPath,
        "practice-render-output:" + completion.outputPath,
      ],
    };
  }

  async renderWindow(input: {
    readonly sessionId: string;
    readonly attempt: number;
    readonly compStableId: string;
    readonly windowId: string;
    readonly startMs: number;
    readonly endMs: number;
  }): Promise<{ readonly renderPath: string; readonly evidenceRefs?: readonly string[] }> {
    return await this.#render({
      sessionId: input.sessionId,
      attempt: input.attempt,
      compStableId: input.compStableId,
      suffix: input.windowId,
      startMs: input.startMs,
      durationMs: input.endMs - input.startMs,
    });
  }

  async renderFullEdit(input: {
    readonly sessionId: string;
    readonly attempt: number;
    readonly compStableId: string;
    readonly durationMs: number;
  }): Promise<{ readonly renderPath: string; readonly evidenceRefs?: readonly string[] }> {
    const rendered = await this.#render({
      sessionId: input.sessionId,
      attempt: input.attempt,
      compStableId: input.compStableId,
      suffix: "full",
      startMs: 0,
      durationMs: input.durationMs,
    });
    await this.finalizeAttempt(input.sessionId);
    return rendered;
  }
}
