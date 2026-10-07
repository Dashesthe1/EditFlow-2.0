import { mkdir, readFile, stat, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";

import { AeCepAdapterClientV11, AeFilesystemPolicyV11 } from "../../../packages/adapters/ae-cep/src/v1_1.js";
import type { AeAdapterTransportV11 } from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";



interface RenderCompletionV1 {
  readonly schemaVersion: 1;
  readonly jobId: string;
  readonly status: "DONE" | "FAILED";
  readonly ok: boolean;
  readonly outputPath: string;
  readonly error: string | null;
  readonly queueItemRemoved: boolean;
}

export interface ChatgptAeRenderDriverConfigV1 {
  readonly transport: AeAdapterTransportV11;
  readonly projectId: string;
  readonly artifactDir: string;
  readonly renderTimeoutMs?: number;
  readonly ffmpegPath?: string;
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

export class ChatgptAeRenderDriverV1
 {
  readonly client: AeCepAdapterClientV11;
  readonly projectId: string;
  readonly artifactDir: string;
  readonly renderTimeoutMs: number;
  readonly ffmpegPath: string;
  #operationCounter = 0;

  constructor(config: ChatgptAeRenderDriverConfigV1) {
    this.projectId = config.projectId;
    this.artifactDir = path.resolve(config.artifactDir);
    this.renderTimeoutMs = config.renderTimeoutMs ?? 60_000;
    this.ffmpegPath = config.ffmpegPath ?? "ffmpeg";
    if (!Number.isFinite(this.renderTimeoutMs) || this.renderTimeoutMs < 1_000) {
      throw new TypeError("Practice render timeout must be at least 1000ms.");
    }
    this.client = new AeCepAdapterClientV11(
      config.transport,
      () => "practice-m6-render-" + String(++this.#operationCounter),
      new AeFilesystemPolicyV11([this.artifactDir]),
    );
  }

  async #render(input: {
    readonly sessionId: string;
    readonly attempt: number;
    readonly compStableId: string;
    readonly suffix: string;
    readonly startMs: number;
    readonly durationMs: number;
    readonly scratchCandidate?: Readonly<Record<string, unknown>>;
    readonly resolutionFactor?: number;
    readonly observedState?: Awaited<ReturnType<AeCepAdapterClientV11["observe"]>>;
  }): Promise<{ readonly renderPath: string; readonly evidenceRefs: readonly string[] }> {
    if (input.durationMs <= 0 || !Number.isFinite(input.durationMs)) {
      throw new TypeError("Practice render duration must be finite and positive.");
    }
    await mkdir(this.artifactDir, { recursive: true });
    const renderPath = path.join(
      this.artifactDir,
      safeStem(input.sessionId)
        + "-attempt-" + String(input.attempt).padStart(3, "0")
        + "-" + safeStem(input.suffix) + "-" + randomUUID().slice(0, 8) + ".avi",
    );
    const observed = input.observedState ?? await this.client.observe(this.projectId);
    const response = await this.client.executePublicAtKnownHostRevision("render.capture", {
      transactionId: "practice-m6:render:" + input.sessionId,
      operationId: "practice-m6:render:" + String(++this.#operationCounter),
      payload: {
        comp: { stableId: input.compStableId },
        outputPath: renderPath,
        timeSpanStart: input.startMs / 1000,
        timeSpanDuration: input.durationMs / 1000,
        ...(input.scratchCandidate === undefined ? {} : { scratchCandidate: input.scratchCandidate,
          resolutionFactor: input.resolutionFactor ?? 1 }),
      },
      expectedHostProjectRevision: observed.hostRevision,
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
    readonly resolutionScale?: number;
    readonly forceRender?: boolean;
    readonly forceRenderReason?: string;
  }): Promise<{ readonly renderPath: string; readonly evidenceRefs?: readonly string[]; readonly reused?: boolean; readonly sourceRevision?: number; readonly cacheWarning?: string; readonly compositionTimeOriginMs?: number }> {
    const scale = input.resolutionScale ?? 1;
    if (![1, .25, .125].includes(scale)) throw new TypeError("Unsupported local preview resolution scale.");
    const observed = await this.client.observe(this.projectId);
    const indexPath = path.join(this.artifactDir, "preview-cache-v1.json");
    let index: any = await readFile(indexPath, "utf8").then(JSON.parse).catch(() => null);
    if (!index || index.validAtRevision !== observed.hostRevision || index.environment !== observed.observed.environmentFingerprint
      || index.fingerprint !== observed.observed.projectFingerprint) index = { schema: 1, epoch: observed.hostRevision, entries: {} };
    const key = createHash("sha256").update(JSON.stringify([input.sessionId, input.compStableId, input.startMs, input.endMs, scale, index.epoch])).digest("hex");
    const retained = index.entries[key];
    // An unqualified force flag must not bypass a healthy cache.
    const force = input.forceRender === true && typeof input.forceRenderReason === "string" && input.forceRenderReason.trim().length > 0;
    if (!force && retained) {
      const metadata = await stat(retained.renderPath).catch(() => null);
      if (metadata?.isFile() && metadata.size === retained.size && metadata.mtimeMs === retained.mtimeMs && metadata.size > 0) {
        return { renderPath: retained.renderPath, evidenceRefs: retained.evidenceRefs, reused: true, sourceRevision: index.epoch, compositionTimeOriginMs: input.startMs };
      }
    }
    const result = await this.#render({
      sessionId: input.sessionId, attempt: input.attempt, compStableId: input.compStableId,
      suffix: input.windowId, startMs: input.startMs, durationMs: input.endMs - input.startMs,
      observedState: observed,
      ...(scale === 1 ? {} : { scratchCandidate: { candidateId: "preview-" + input.windowId, patches: [] }, resolutionFactor: Math.round(1 / scale) }),
    });
    // The sole production writer is held through completion. Rendering may advance
    // AE's revision while adding/removing its temporary queue item or preview comp.
    try {
    const after = await this.client.observe(this.projectId);
    const metadata = await stat(result.renderPath);
    index.validAtRevision = after.hostRevision;
    index.environment = after.observed.environmentFingerprint;
    index.fingerprint = after.observed.projectFingerprint;
    index.entries[key] = { ...result, size: metadata.size, mtimeMs: metadata.mtimeMs };
    const temporary = indexPath + "." + randomUUID() + ".tmp";
    await writeFile(temporary, JSON.stringify(index)); await rename(temporary, indexPath);
    return { ...result, reused: false, sourceRevision: index.epoch, compositionTimeOriginMs: input.startMs };
    } catch (error) { return { ...result, reused: false, sourceRevision: index.epoch, compositionTimeOriginMs: input.startMs, cacheWarning: error instanceof Error ? error.message : String(error) }; }
  }

  /** Mechanical currency/integrity check; never visual acceptance. */
  async isPreviewCurrent(renderPath: string): Promise<boolean> {
    const observed = await this.client.observe(this.projectId);
    const index = await readFile(path.join(this.artifactDir, "preview-cache-v1.json"), "utf8").then(JSON.parse).catch(() => null);
    if (!index || index.validAtRevision !== observed.hostRevision || index.fingerprint !== observed.observed.projectFingerprint
      || index.environment !== observed.observed.environmentFingerprint) return false;
    const retained = Object.values(index.entries ?? {}).find((e: any) => e.renderPath === renderPath) as any;
    const metadata = retained ? await stat(renderPath).catch(() => null) : null;
    return !!metadata?.isFile() && metadata.size > 0 && metadata.size === retained.size && metadata.mtimeMs === retained.mtimeMs;
  }

  async renderFrames(input: { readonly sessionId: string; readonly compStableId: string; readonly timesMs: readonly number[];
    readonly resolutionScale?: number; readonly forceRender?: boolean; readonly forceRenderReason?: string }) {
    if (!Array.isArray(input.timesMs) || !input.timesMs.length || input.timesMs.length > 12
      || input.timesMs.some(t => !Number.isFinite(t) || t < 0)) throw new TypeError("Choose 1–12 exact frame timestamps.");
    const observed = await this.client.observe(this.projectId);
    const comp = observed.project.items.find(item => item.stableId === input.compStableId)?.composition;
    if (!comp || input.timesMs.some(t => t >= comp.duration * 1000)) throw new TypeError("Frame timestamps must be inside the chosen comp.");
    const frames = [];
    for (const timeMs of input.timesMs) {
      const rendered = await this.renderWindow({ sessionId: input.sessionId, attempt: 0, compStableId: input.compStableId,
        windowId: "frame-" + timeMs, startMs: timeMs, endMs: Math.min(comp.duration * 1000, timeMs + 1000 / comp.frameRate),
        ...(input.resolutionScale === undefined ? {} : { resolutionScale: input.resolutionScale }), ...(input.forceRender === undefined ? {} : { forceRender: input.forceRender }),
        ...(input.forceRenderReason === undefined ? {} : { forceRenderReason: input.forceRenderReason }) });
      const framePath = rendered.renderPath + ".png";
      if (!rendered.reused || !await fileExistsNonEmpty(framePath)) await new Promise<void>((resolve, reject) => {
        const child = spawn(this.ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", rendered.renderPath, "-frames:v", "1", "-y", framePath], { windowsHide: true });
        const timeout = setTimeout(() => { child.kill(); reject(new Error("Preview frame extraction timed out")); }, 15000);
        let error = ""; child.stderr.on("data", chunk => { error += String(chunk).slice(-2000); });
        child.on("error", failure => { clearTimeout(timeout); reject(failure); }); child.on("close", code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error("Preview frame extraction failed: " + error)); });
      });
      frames.push({ timeMs, framePath, ...rendered });
    }
    return { frames, visualAcceptance: false };
  }

  async renderSearchCandidate(input: {
    readonly sessionId: string;
    readonly compStableId: string;
    readonly candidateId: string;
    readonly patches: readonly Readonly<Record<string, unknown>>[];
    readonly startMs: number;
    readonly endMs: number;
    readonly resolutionScale: number;
  }): Promise<{ readonly renderPath: string; readonly evidenceRefs: readonly string[] }> {
    if (![1, 0.25, 0.125].includes(input.resolutionScale)) throw new TypeError("Unsupported scratch resolution scale.");
    return await this.#render({ sessionId: input.sessionId, attempt: 0, compStableId: input.compStableId,
      suffix: "scratch-" + input.candidateId, startMs: input.startMs, durationMs: input.endMs - input.startMs,
      resolutionFactor: Math.round(1 / input.resolutionScale),
      scratchCandidate: { candidateId: input.candidateId, patches: input.patches },
    });
  }
}
