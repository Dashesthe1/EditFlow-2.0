import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validatePracticeSceneMatchesV1 } from "./source-integrity.js";

import type { PracticeMediaInputV1, PracticeReferenceAnalysisV1, PracticeSceneMatchV1, PracticeSourceIndexV1 } from "./contracts.js";

interface PythonRuntimeV1 {
  readonly executable: string;
  readonly prefixArgs: readonly string[];
}

export const defaultPracticeAnalysisCacheDirectoryV1 = (): string => path.resolve(
  process.env.LOCALAPPDATA?.trim() || os.homedir(),
  "EditFlow2",
  "practice-analysis-cache",
);

export interface ChatgptFootageBrowserConfigV1 {
  readonly chatgptSelectionsPath?: string;
  readonly chatgptInspectionDir?: string;
  readonly artifactDir: string;
  readonly signal?: AbortSignal;
  readonly analysisCacheDir?: string;
  readonly scriptPath: string;
  readonly python?: PythonRuntimeV1;
  readonly ffmpegPath?: string;
  readonly analysisTimeoutMs?: number;
  readonly materializeWorkingMedia?: boolean;
  readonly workingMediaHandleMs?: number;
  readonly workingMediaMergeGapMs?: number;
}

interface SourceArtifactV1 {
  readonly schema: "editflow.practice-source-index.v1";
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly sourceSha256: string;
  readonly video?: { readonly durationMs: number; readonly fps: number };
  readonly perceptualSignature?: string;
  readonly evidenceRefs: readonly string[];
}

interface WorkingRangeV1 {
  readonly matchIndex: number;
  readonly startMs: number;
  readonly endMs: number;
}

interface WorkingPacketV1 {
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly sourceSha256: string;
  startMs: number;
  endMs: number;
  readonly matchIndexes: number[];
}

const matchSourceBounds = (
  match: PracticeSceneMatchV1,
): Readonly<{ startMs: number; endMs: number }> => {
  const values = [
    match.sourceStartMs,
    match.sourceEndMs,
    ...(match.trajectory ?? []).map((point) => point.sourceTimeMs),
    ...(match.rewind === undefined
      ? []
      : [match.rewind.sourceStartMs, match.rewind.sourceEndMs]),
  ].filter(Number.isFinite);
  return {
    startMs: Math.min(...values),
    endMs: Math.max(...values),
  };
};

export const validatePracticeWorkingMediaMatchesV1 = (
  matches: readonly PracticeSceneMatchV1[],
): readonly string[] => {
  const reasons: string[] = [];
  if (matches.length === 0) {
    return ["Practice requires at least one materialized matched source clip before AE work."];
  }
  for (const match of matches) {
    const working = match.workingMedia;
    if (working === undefined) {
      reasons.push(
        "Practice match " + match.shotId
        + " has no bounded working-media clip; full raw source import is forbidden.",
      );
      continue;
    }
    if (working.schema !== "editflow.practice-working-media.v1") {
      reasons.push("Practice working media schema is invalid for " + match.shotId + ".");
    }
    if (working.originalSourceId !== match.sourceId) {
      reasons.push("Practice working media source identity drifted for " + match.shotId + ".");
    }
    if (working.workingSourceId.trim().length === 0 || working.sourcePath.trim().length === 0) {
      reasons.push("Practice working media identity/path is empty for " + match.shotId + ".");
    }
    if (!Number.isFinite(working.originalStartMs)
      || !Number.isFinite(working.originalEndMs)
      || working.originalEndMs <= working.originalStartMs) {
      reasons.push("Practice working media has invalid source bounds for " + match.shotId + ".");
      continue;
    }
    const bounds = matchSourceBounds(match);
    if (bounds.startMs < working.originalStartMs - 1
      || bounds.endMs > working.originalEndMs + 1) {
      reasons.push(
        "Practice working media does not contain the full matched/retimed source range for "
        + match.shotId + ".",
      );
    }
    if (!Number.isFinite(working.handleBeforeMs)
      || !Number.isFinite(working.handleAfterMs)
      || working.handleBeforeMs < 0
      || working.handleAfterMs < 0) {
      reasons.push("Practice working media handles are invalid for " + match.shotId + ".");
    }
    if (match.sourcePath !== undefined
      && path.resolve(working.sourcePath) === path.resolve(match.sourcePath)) {
      reasons.push(
        "Practice working media for " + match.shotId
        + " still points at the original full source; a bounded clip is required.",
      );
    }
  }
  return [...new Set(reasons)];
};

const ffmpegSeconds = (valueMs: number): string =>
  (Math.max(0, valueMs) / 1000).toFixed(6);

const defaultPython = (): PythonRuntimeV1 =>
  process.platform === "win32"
    ? { executable: "py", prefixArgs: ["-3.12"] }
    : { executable: "python3", prefixArgs: [] };

export const resolvePracticeLocalMediaPathV1 = (uri: string): string => {
  if (uri.startsWith("file:")) return fileURLToPath(uri);
  if (path.isAbsolute(uri)) return path.resolve(uri);
  if (path.win32.isAbsolute(uri)) return path.win32.normalize(uri);
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(uri)) {
    throw new TypeError("ChatGPT footage browser accepts only local file media.");
  }
  return path.resolve(uri);
};

const mediaPath = resolvePracticeLocalMediaPathV1;

const safeStem = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "media";

const jsonFile = async <T>(filePathValue: string): Promise<T> =>
  JSON.parse(await readFile(filePathValue, "utf8")) as T;

const sha256Text = (parts: readonly string[]): string =>
  createHash("sha256").update(parts.join("\n"), "utf8").digest("hex");

const fileExists = async (filePathValue: string): Promise<boolean> => {
  try {
    const value = await stat(filePathValue);
    return value.isFile() && value.size > 0;
  } catch {
    return false;
  }
};

const terminateProcessTree = (child: ChildProcess): void => {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    const killer = execFile(
      "taskkill",
      ["/PID", String(pid), "/T", "/F"],
      { windowsHide: true },
    );
    killer.once("error", () => {
      try {
        child.kill("SIGKILL");
      } catch {
        // The process may already have exited.
      }
    });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // The process may already have exited.
    }
  }
};

const appendBoundedProcessOutput = (
  current: string,
  chunk: Buffer | string,
  limitBytes = 8 * 1024 * 1024,
): string => {
  const next = current + String(chunk);
  if (Buffer.byteLength(next, "utf8") <= limitBytes) return next;
  return next.slice(Math.max(0, next.length - Math.floor(limitBytes / 2)));
};

export class ChatgptFootageBrowserV1 {
  static readonly artifactTasks = new Map<string, Promise<void>>();
  readonly config: Required<Omit<ChatgptFootageBrowserConfigV1, "signal" | "ffmpegPath" | "python">> & {
    readonly signal?: AbortSignal;
    readonly ffmpegPath: string | null;
    readonly python: PythonRuntimeV1;
  };

  readonly #referenceArtifactPathById = new Map<string, string>();
  readonly #referenceMediaPathById = new Map<string, string>();
  readonly #videoSourceArtifactsByIndexId = new Map<string, readonly string[]>();
  #scriptDigest: Promise<string> | null = null;
  #ffmpegExecutable: Promise<string> | null = null;

  constructor(config: ChatgptFootageBrowserConfigV1) {
    const legacy = config as unknown as Record<string, unknown>;
    if (legacy.shotSelectionAuthority !== undefined && legacy.shotSelectionAuthority !== "CHATGPT_DIRECT") throw new TypeError("Unsupported footage selection authority; only ChatGPT direct browsing remains.");
    this.config = {
      chatgptSelectionsPath: path.resolve(config.chatgptSelectionsPath ?? path.join(config.artifactDir, "chatgpt-selections.json")),
      chatgptInspectionDir: path.resolve(config.chatgptInspectionDir ?? path.join(config.artifactDir, "footage-inspections")),
      artifactDir: path.resolve(config.artifactDir),
      ...(config.signal === undefined ? {} : { signal: config.signal }),
      analysisCacheDir: path.resolve(
        config.analysisCacheDir ?? path.join(config.artifactDir, "analysis-cache"),
      ),
      scriptPath: path.resolve(config.scriptPath),
      python: config.python ?? defaultPython(),
      ffmpegPath: config.ffmpegPath?.trim() || null,
      analysisTimeoutMs: config.analysisTimeoutMs ?? 60 * 60 * 1000,
      materializeWorkingMedia: config.materializeWorkingMedia ?? false,
      workingMediaHandleMs: Math.max(0, config.workingMediaHandleMs ?? 2_500),
      workingMediaMergeGapMs: Math.max(0, config.workingMediaMergeGapMs ?? 1_000),
    };
  }

  async #scriptSha256(): Promise<string> {
    this.#scriptDigest ??= Promise.all([readFile(this.config.scriptPath)])
      .then((buffers) => { const hash = createHash("sha256"); for (const bytes of buffers) hash.update(bytes); return hash.digest("hex"); });
    return this.#scriptDigest;
  }

  async #ensureArtifact(file: string, produce: () => Promise<void>): Promise<void> {
    let task = ChatgptFootageBrowserV1.artifactTasks.get(file);
    if (!task) {
      task = Promise.resolve().then(async () => { if (!await fileExists(file)) await produce(); });
      ChatgptFootageBrowserV1.artifactTasks.set(file, task);
    }
    try { await task; }
    finally { if (ChatgptFootageBrowserV1.artifactTasks.get(file) === task) ChatgptFootageBrowserV1.artifactTasks.delete(file); }
  }

  async #mediaCacheKey(
    input: PracticeMediaInputV1,
    settings: readonly string[],
  ): Promise<string> {
    const localPath = mediaPath(input.uri);
    const metadata = await stat(localPath);
    if (!metadata.isFile()) {
      throw new TypeError("Practice media is not a file: " + localPath);
    }
    return sha256Text([
      await this.#scriptSha256(),
      localPath,
      String(metadata.size),
      String(metadata.mtimeMs),
      ...settings,
    ]).slice(0, 24);
  }

  async #run(args: readonly string[]): Promise<void> {
    if (!["metadata", "browse"].includes(args[0] ?? "")) throw new TypeError("Only explicit footage browsing and metadata commands are available.");
    const invocation = [...this.config.python.prefixArgs, this.config.scriptPath, ...args,
      ...(this.config.ffmpegPath && !args.includes("--ffmpeg") ? ["--ffmpeg", this.config.ffmpegPath] : [])];
    await new Promise<void>((resolve, reject) => {
      let timedOut = false;
      let stderr = "";
      const child = spawn(this.config.python.executable, invocation, {
        windowsHide: true, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"],
      });
      const abort = (): void => terminateProcessTree(child);
      this.config.signal?.addEventListener("abort", abort, { once: true });
      if (this.config.signal?.aborted) abort();
      const timer = setTimeout(() => { timedOut = true; terminateProcessTree(child); }, this.config.analysisTimeoutMs);
      child.stderr.on("data", (chunk: Buffer | string) => { stderr = appendBoundedProcessOutput(stderr, chunk); });
      child.once("error", error => { clearTimeout(timer); this.config.signal?.removeEventListener("abort", abort); reject(error); });
      child.once("close", code => {
        clearTimeout(timer); this.config.signal?.removeEventListener("abort", abort);
        if (this.config.signal?.aborted) reject(this.config.signal.reason ?? new Error("Footage browsing cancelled."));
        else if (timedOut) reject(new Error("Footage browsing timed out; process tree terminated."));
        else if (code !== 0) reject(new Error("Footage browsing failed: " + stderr.trim()));
        else resolve();
      });
    });
  }

  async #resolveFfmpeg(): Promise<string> {
    if (this.config.ffmpegPath !== null) return this.config.ffmpegPath;
    const environmentPath = process.env.EDITFLOW_FFMPEG_PATH?.trim();
    if (environmentPath) {
      const metadata = await stat(environmentPath).catch(() => null);
      if (metadata?.isFile()) return path.resolve(environmentPath);
    }
    this.#ffmpegExecutable ??= new Promise<string>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      const child = spawn(
        this.config.python.executable,
        [
          ...this.config.python.prefixArgs,
          "-c",
          "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())",
        ],
        {
          windowsHide: true,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr = appendBoundedProcessOutput(stderr, chunk);
      });
      child.once("error", reject);
      child.once("close", async (code) => {
        const candidate = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "";
        if (code !== 0 || candidate.length === 0) {
          reject(new Error(
            "Practice working-media materialization could not resolve FFmpeg"
            + (stderr.trim().length === 0 ? "." : ": " + stderr.trim()),
          ));
          return;
        }
        const metadata = await stat(candidate).catch(() => null);
        if (metadata?.isFile() !== true) {
          reject(new Error("Resolved Practice FFmpeg executable does not exist: " + candidate));
          return;
        }
        resolve(path.resolve(candidate));
      });
    });
    return await this.#ffmpegExecutable;
  }

  async #probeWorkingMediaEncoding(
    sourcePath: string,
  ): Promise<Readonly<{
    profileId: string;
    args: readonly string[];
    sourceDescriptor: string;
  }>> {
    const executable = await this.#resolveFfmpeg();
    const descriptor = await new Promise<string>((resolve, reject) => {
      let stderr = "";
      const child = spawn(executable, [
        "-hide_banner",
        "-loglevel", "info",
        "-i", sourcePath,
        "-map", "0:v:0",
        "-frames:v", "1",
        "-f", "null",
        "-",
      ], {
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "ignore", "pipe"],
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr = appendBoundedProcessOutput(stderr, chunk);
      });
      child.once("error", reject);
      child.once("close", (code) => {
        if (code !== 0) {
          reject(new Error(
            "Practice working-media source probe failed"
            + (stderr.trim().length === 0 ? "." : ": " + stderr.trim()),
          ));
          return;
        }
        const videoLine = stderr.split(/\r?\n/)
          .find((line) => /Stream #.*Video:/.test(line))?.trim() ?? "";
        resolve(videoLine);
      });
    });
    const tenBit = /\b(?:yuv\d+p10(?:le|be)?|p010(?:le|be)?|gbrp10(?:le|be)?|gray10(?:le|be)?|Main 10)\b/i
      .test(descriptor);
    return tenBit
      ? {
        profileId: "libx265-main10-crf10",
        args: [
          "-c:v", "libx265",
          "-preset", "fast",
          "-crf", "10",
          "-pix_fmt", "yuv420p10le",
          "-tag:v", "hvc1",
        ],
        sourceDescriptor: descriptor,
      }
      : {
        profileId: "libx264-crf10",
        args: [
          "-c:v", "libx264",
          "-preset", "fast",
          "-crf", "10",
          "-pix_fmt", "yuv420p",
        ],
        sourceDescriptor: descriptor,
      };
  }

  async #runFfmpeg(args: readonly string[]): Promise<void> {
    const executable = await this.#resolveFfmpeg();
    await new Promise<void>((resolve, reject) => {
      let timedOut = false;
      let stderr = "";
      const child = spawn(executable, args, {
        windowsHide: true,
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "ignore", "pipe"],
      });
      const abort = (): void => { terminateProcessTree(child); };
      this.config.signal?.addEventListener("abort", abort, { once: true });
      if (this.config.signal?.aborted === true) abort();
      child.once("close", () => this.config.signal?.removeEventListener("abort", abort));
      const timer = setTimeout(() => {
        timedOut = true;
        terminateProcessTree(child);
      }, this.config.analysisTimeoutMs);
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr = appendBoundedProcessOutput(stderr, chunk);
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new Error(
            "Practice working-media materialization timed out after "
            + String(this.config.analysisTimeoutMs) + " ms.",
          ));
          return;
        }
        if (code !== 0) {
          const detail = stderr.trim();
          reject(new Error(
            "Practice working-media materialization failed"
            + (code === null ? "" : " with exit code " + String(code))
            + (signal === null ? "" : " (" + signal + ")")
            + (detail.length === 0 ? "." : ": " + detail),
          ));
          return;
        }
        resolve();
      });
    });
  }

  async #materializeWorkingMatches(
    matches: readonly PracticeSceneMatchV1[],
    sourceArtifacts: readonly SourceArtifactV1[],
  ): Promise<readonly PracticeSceneMatchV1[]> {
    if (matches.length === 0) return [];
    const sourceById = new Map(sourceArtifacts.map((item) => [item.sourceId, item]));
    const rangesBySource = new Map<string, WorkingRangeV1[]>();
    matches.forEach((match, matchIndex) => {
      const source = sourceById.get(match.sourceId);
      if (source === undefined) {
        throw new TypeError(
          "Practice working-media materialization cannot resolve source " + match.sourceId + ".",
        );
      }
      const bounds = matchSourceBounds(match);
      const range: WorkingRangeV1 = {
        matchIndex,
        startMs: Math.max(0, bounds.startMs - this.config.workingMediaHandleMs),
        endMs: Math.max(
          bounds.startMs + 1,
          bounds.endMs + this.config.workingMediaHandleMs,
        ),
      };
      const prior = rangesBySource.get(match.sourceId) ?? [];
      prior.push(range);
      rangesBySource.set(match.sourceId, prior);
    });

    const packets: WorkingPacketV1[] = [];
    for (const [sourceId, ranges] of rangesBySource) {
      const source = sourceById.get(sourceId);
      if (source === undefined) continue;
      const sorted = [...ranges].sort((a, b) => a.startMs - b.startMs);
      for (const range of sorted) {
        const current = packets.at(-1);
        if (current !== undefined
          && current.sourceId === sourceId
          && range.startMs <= current.endMs + this.config.workingMediaMergeGapMs) {
          current.endMs = Math.max(current.endMs, range.endMs);
          current.matchIndexes.push(range.matchIndex);
          continue;
        }
        packets.push({
          sourceId,
          sourcePath: source.sourcePath,
          sourceSha256: source.sourceSha256,
          startMs: range.startMs,
          endMs: range.endMs,
          matchIndexes: [range.matchIndex],
        });
      }
    }

    const directory = path.join(this.config.analysisCacheDir, "working-media");
    await mkdir(directory, { recursive: true });
    const enriched = matches.map((match) => ({ ...match }));
    for (const packet of packets) {
      const encoding = await this.#probeWorkingMediaEncoding(packet.sourcePath);
      const key = sha256Text([
        "editflow.practice-working-media.v1",
        packet.sourceSha256,
        String(Math.round(packet.startMs)),
        String(Math.round(packet.endMs)),
        encoding.profileId,
      ]).slice(0, 20);
      const workingSourceId = "working:" + packet.sourceId + ":" + key;
      const clipPath = path.join(
        directory,
        safeStem(packet.sourceId) + "-" + key + ".mp4",
      );
      if (!(await fileExists(clipPath))) {
        const temporaryPath = clipPath + ".tmp-" + String(process.pid) + ".mp4";
        await unlink(temporaryPath).catch(() => undefined);
        try {
          await this.#runFfmpeg([
            "-hide_banner",
            "-loglevel", "error",
            "-ss", ffmpegSeconds(packet.startMs),
            "-i", packet.sourcePath,
            "-t", ffmpegSeconds(packet.endMs - packet.startMs),
            "-map", "0:v:0",
            "-map_metadata", "0",
            "-an",
            "-sn",
            "-dn",
            ...encoding.args,
            "-movflags", "+faststart",
            "-y",
            temporaryPath,
          ]);
          await rename(temporaryPath, clipPath);
        } catch (error) {
          await unlink(temporaryPath).catch(() => undefined);
          throw error;
        }
      }
      const clipStat = await stat(clipPath);
      if (!clipStat.isFile() || clipStat.size <= 0) {
        throw new Error("Practice working-media clip is empty: " + clipPath);
      }
      const packetEvidence = [
        "practice-working-media:" + key,
        "practice-working-media-original-source:" + packet.sourceId,
        "practice-working-media-original-sha256:" + packet.sourceSha256,
        "practice-working-media-original-range-ms:"
          + packet.startMs.toFixed(3) + ":" + packet.endMs.toFixed(3),
        "practice-working-media-encoding:" + encoding.profileId,
        ...(encoding.sourceDescriptor.length === 0
          ? []
          : ["practice-working-media-source-descriptor:" + encoding.sourceDescriptor]),
        "practice-working-media-bytes:" + String(clipStat.size),
      ];
      for (const matchIndex of packet.matchIndexes) {
        const match = matches[matchIndex];
        if (match === undefined) continue;
        const bounds = matchSourceBounds(match);
        enriched[matchIndex] = {
          ...match,
          workingMedia: {
            schema: "editflow.practice-working-media.v1",
            workingSourceId,
            sourcePath: clipPath,
            originalSourceId: match.sourceId,
            originalStartMs: packet.startMs,
            originalEndMs: packet.endMs,
            handleBeforeMs: Math.max(0, bounds.startMs - packet.startMs),
            handleAfterMs: Math.max(0, packet.endMs - bounds.endMs),
            evidenceRefs: packetEvidence,
          },
          evidenceRefs: [...match.evidenceRefs, ...packetEvidence],
        };
      }
    }
    return enriched;
  }

  async readReference(finish: PracticeMediaInputV1): Promise<PracticeReferenceAnalysisV1> {
    return await this.#directReference(finish);
  }

  async #directReference(finish: PracticeMediaInputV1): Promise<PracticeReferenceAnalysisV1> {
    if (finish.mediaKind !== "VIDEO") throw new TypeError("Practice Finish must be a video.");
    const key = await this.#mediaCacheKey(finish, ["direct-reference-metadata-v1"]);
    const metadataPath = path.join(this.config.analysisCacheDir, "direct-reference-metadata", key + ".json");
    await mkdir(path.dirname(metadataPath), { recursive: true });
    await this.#ensureArtifact(metadataPath, () => this.#run(["metadata", "--video", mediaPath(finish.uri), "--source-id", finish.mediaId, "--output", metadataPath]));
    const metadata = await jsonFile<SourceArtifactV1 & { video: NonNullable<PracticeReferenceAnalysisV1["video"]> }>(metadataPath);
    if (!metadata.video || !Number.isFinite(metadata.video.durationMs) || metadata.video.durationMs <= 0) throw new TypeError("Invalid reference metadata.");
    const version = await this.#mediaCacheKey(finish, ["inspection-media-version-v1"]);
    const planPath = path.join(this.config.artifactDir, "chatgpt-reference-plan.json");
    const packet = await fileExists(planPath) ? await jsonFile<Record<string, any>>(planPath) : null;
    const plan = packet?.authority === "CHATGPT_DIRECT" && packet.mediaVersion === version ? packet : null;
    const reference: PracticeReferenceAnalysisV1 = { referenceId: finish.mediaId, sourcePath: mediaPath(finish.uri),
      styleFingerprint: sha256Text([metadata.sourceSha256, JSON.stringify(plan?.shots ?? [])]),
      ...(metadata.perceptualSignature ? { perceptualSignature: metadata.perceptualSignature } : {}),
      video: { ...metadata.video, sourceDurationMs: metadata.video.durationMs, durationMs: plan?.durationMs ?? metadata.video.durationMs },
      shots: plan?.shots ?? [],
      evidenceRefs: ["video:sha256:" + metadata.sourceSha256, "editorial-authority:CHATGPT_DIRECT",
        plan ? "chatgpt-reference-plan:" + planPath : "awaiting-chatgpt-reference-plan"] };
    const artifactPath = path.join(this.config.artifactDir, "chatgpt-reference.json");
    await mkdir(path.dirname(artifactPath), { recursive: true });
    const temp = artifactPath + ".tmp-" + randomUUID();
    await writeFile(temp, JSON.stringify({ schema: "editflow.practice-reference-analysis.v1", ...reference }) + "\n", "utf8");
    await rename(temp, artifactPath);
    this.#referenceArtifactPathById.set(finish.mediaId, artifactPath);
    this.#referenceMediaPathById.set(finish.mediaId, mediaPath(finish.uri));
    return { ...reference, evidenceRefs: [...reference.evidenceRefs, "practice-reference-artifact:" + artifactPath] };
  }

  async defineReference(finish: PracticeMediaInputV1, input: Record<string, any>): Promise<PracticeReferenceAnalysisV1> {
    const reference = await this.#directReference(finish);
    const durationMs = input.durationMs;
    if (input.authority !== "CHATGPT_DIRECT" || !input.rationale?.trim() || !Number.isFinite(durationMs)
      || durationMs <= 0 || durationMs > reference.video!.sourceDurationMs! || !Array.isArray(input.shots) || !input.shots.length) throw new TypeError("ChatGPT must explicitly define reference duration, shots and rationale.");
    const ids = new Set<string>();
    let end = 0;
    const shots: PracticeReferenceAnalysisV1["shots"][number][] = [];
    for (const shot of input.shots) {
      if (typeof shot.shotId !== "string" || !shot.shotId.trim() || ids.has(shot.shotId) || shot.order !== shots.length
        || !Number.isFinite(shot.referenceStartMs) || !Number.isFinite(shot.referenceEndMs)
        || Math.abs(shot.referenceStartMs - end) > 1 || shot.referenceEndMs <= shot.referenceStartMs || shot.referenceEndMs > durationMs
        || !shot.observation?.trim() || !Array.isArray(shot.inspections) || !shot.inspections.length) throw new TypeError("Reference shots need explicit ordered bounds, observations and issued pixel inspections with continuous coverage.");
      for (const inspection of shot.inspections) await this.#verifyInspection(finish.mediaId, finish.uri, inspection.evidenceId, inspection.timeMs);
      if (!shot.inspections.some((i: any) => i.timeMs >= shot.referenceStartMs && i.timeMs < shot.referenceEndMs)) throw new TypeError("Inspect each reference shot itself.");
      shots.push({ shotId: shot.shotId, order: shot.order, referenceStartMs: shot.referenceStartMs, referenceEndMs: shot.referenceEndMs,
        evidenceRefs: ["chatgpt-reference-observation:" + shot.observation, ...shot.inspections.map((i: any) => "footage-inspection:" + i.evidenceId)] });
      ids.add(shot.shotId); end = shot.referenceEndMs;
    }
    if (Math.abs(end - durationMs) > 1) throw new TypeError("ChatGPT reference shots must cover the chosen duration.");
    await mkdir(this.config.artifactDir, { recursive: true });
    const planPath = path.join(this.config.artifactDir, "chatgpt-reference-plan.json");
    const temp = planPath + ".tmp-" + randomUUID();
    await writeFile(temp, JSON.stringify({ authority: "CHATGPT_DIRECT", mediaVersion: await this.#mediaCacheKey(finish, ["inspection-media-version-v1"]),
      durationMs, shots, rationale: input.rationale, recordedAt: new Date().toISOString() }) + "\n", { encoding: "utf8", flush: true });
    await rename(temp, planPath);
    return await this.#directReference(finish);
  }

  async indexProvidedMedia(
    start: readonly PracticeMediaInputV1[],
  ): Promise<PracticeSourceIndexV1> {
    const directory = path.join(this.config.analysisCacheDir, "sources");
    await mkdir(directory, { recursive: true });

    const videoArtifactPaths: string[] = [];
    const sourceIds: string[] = [];
    const videoSourceIds: string[] = [];
    const audioSourceIds: string[] = [];
    const evidenceRefs: string[] = [];
    const identityParts: string[] = [];

    for (const input of start) {
      const localPath = mediaPath(input.uri);
      sourceIds.push(input.mediaId);
      if (input.mediaKind === "VIDEO") {
        const key = await this.#mediaCacheKey(input, ["direct-source-metadata-v1"]);
        const artifactPath = path.join(
          directory,
          safeStem(input.mediaId) + "-" + key + ".json",
        );
        await this.#ensureArtifact(artifactPath, async () => {
          await this.#run(["metadata", "--video", localPath, "--source-id", input.mediaId, "--output", artifactPath]);
        });
        const artifact = await jsonFile<SourceArtifactV1>(artifactPath);
        if (artifact.schema !== "editflow.practice-source-index.v1"
          || artifact.sourceId !== input.mediaId) {
          throw new TypeError("Practice source indexer returned an invalid artifact.");
        }
        videoArtifactPaths.push(artifactPath);
        videoSourceIds.push(artifact.sourceId);
        identityParts.push("video:" + input.mediaId + ":" + key);
        evidenceRefs.push(
          ...artifact.evidenceRefs,
          "practice-source-artifact:" + artifactPath,
        );
      } else {
        const key = await this.#mediaCacheKey(input, ["audio-source"]);
        const metadata = await stat(localPath);
        audioSourceIds.push(input.mediaId);
        identityParts.push("audio:" + input.mediaId + ":" + key);
        evidenceRefs.push(
          "practice-audio-source:" + input.mediaId,
          "practice-audio-source-path:" + localPath,
          "practice-audio-source-bytes:" + String(metadata.size),
        );
      }
    }

    // Raw-shot decisions bind only the video corpus. Preflight indexes video,
    // while editing/certification also indexes the raw song; that must not make
    // the same retained shot choices disappear. Audio cache keys stay separate.
    const indexIdentity = identityParts.filter((part) => part.startsWith("video:"));
    const indexId = "practice-source-set:" + sha256Text(indexIdentity).slice(0, 24);
    this.#videoSourceArtifactsByIndexId.set(indexId, videoArtifactPaths);
    return {
      indexId,
      sourceIds,
      videoSourceIds,
      audioSourceIds,
      evidenceRefs: [...new Set(evidenceRefs)],
    };
  }

  async prepareSelectedFootage(input: {
    readonly reference: PracticeReferenceAnalysisV1;
    readonly sourceIndex: PracticeSourceIndexV1;
    readonly minimumConfidence: number;
    readonly onProgress?: (matches: readonly PracticeSceneMatchV1[], stage: "SCENE_MATCHING" | "TARGETED_REFINEMENT" | "WORKING_MEDIA") => Promise<void>;
  }): Promise<readonly PracticeSceneMatchV1[]> {
    const referencePath = this.#referenceArtifactPathById.get(input.reference.referenceId);
    const sourcePaths = this.#videoSourceArtifactsByIndexId.get(input.sourceIndex.indexId);
    if (referencePath === undefined || sourcePaths === undefined) {
      throw new TypeError("Practice media artifacts are not available for this browser instance.");
    }
    if (sourcePaths.length === 0) {
      throw new TypeError("Practice scene matching requires at least one indexed video source.");
    }


      if (!(await fileExists(this.config.chatgptSelectionsPath))) return [];
      const packet = await jsonFile<{ referenceId: string; referencePlanFingerprint?: string; sourceIndexId: string; matches: PracticeSceneMatchV1[] }>(this.config.chatgptSelectionsPath);
      if (packet.referenceId !== input.reference.referenceId || packet.sourceIndexId !== input.sourceIndex.indexId
        || packet.referencePlanFingerprint !== input.reference.styleFingerprint) return [];
      const matches = packet.matches.filter((match) => match.selectionMode === "CHATGPT_DIRECT"
        && match.chatgptSelection?.authority === "CHATGPT_DIRECT");
      const artifacts = await Promise.all(sourcePaths.map((value) => jsonFile<SourceArtifactV1>(value)));
      const prepared: PracticeSceneMatchV1[] = [];
      for (const match of matches) {
        const reasons = validatePracticeSceneMatchesV1([match.shotId], [match], input.minimumConfidence);
        if (reasons.length > 0) continue;
        const source = artifacts.find((item) => item.sourceId === match.sourceId);
        const referenceMediaPath = this.#referenceMediaPathById.get(input.reference.referenceId);
        if (!source || !referenceMediaPath) throw new TypeError("Retained GPT selection is not bound to provided footage.");
        for (const anchor of match.chatgptSelection!.anchors) {
          await this.#verifyInspection(input.reference.referenceId, referenceMediaPath, anchor.referenceEvidenceId, anchor.referenceTimeMs);
          await this.#verifyInspection(source.sourceId, source.sourcePath, anchor.sourceEvidenceId, anchor.sourceTimeMs);
        }
        if (this.config.materializeWorkingMedia && (!match.workingMedia
          || !await fileExists(match.workingMedia.sourcePath)
          || validatePracticeWorkingMediaMatchesV1([match]).length > 0)) {
          prepared.push(...await this.#materializeWorkingMatches([match], artifacts));
        } else prepared.push(match);
        await input.onProgress?.(prepared, "WORKING_MEDIA");
      }
      // Keep low-confidence decisions available for correction; preflight cannot
      // admit them, but it must not erase GPT's retained search work.
      const byId = new Map(prepared.map((match) => [match.shotId, match]));
      await this.#saveChatgptPacket({ ...packet, matches: matches.map((match) => byId.get(match.shotId) ?? match) });
      return prepared;
  }

  async #saveChatgptPacket(packet: unknown): Promise<void> {
    await mkdir(path.dirname(this.config.chatgptSelectionsPath), { recursive: true });
    const temporary = this.config.chatgptSelectionsPath + ".tmp-" + String(process.pid);
    await writeFile(temporary, JSON.stringify(packet, null, 2) + "\n", { encoding: "utf8", flush: true });
    await rename(temporary, this.config.chatgptSelectionsPath);
  }

  async footageSearchState(sourceIndex: PracticeSourceIndexV1): Promise<Record<string, any>> {
    const rawMetadata = await Promise.all((this.#videoSourceArtifactsByIndexId.get(sourceIndex.indexId) ?? [])
      .map(async (file) => { const source = await jsonFile<SourceArtifactV1>(file);
        return { mediaId: source.sourceId, sourcePath: source.sourcePath, video: source.video }; }));
    const inspectionDir = this.config.chatgptInspectionDir;
    const inspections = await Promise.all((await readdir(inspectionDir).catch(() => []))
      .filter((file) => /^[a-f0-9]{24}\.json$/.test(file)).map(async (file) => {
        const receipt = await jsonFile<Record<string, any>>(path.join(inspectionDir, file));
        return { evidenceId: receipt.evidenceId, mediaId: receipt.mediaId,
          timesMs: receipt.frames.map((frame: any) => frame.timeMs), contactSheetPath: receipt.contactSheetPath };
      }));
    const notes = (await readFile(path.join(this.config.artifactDir, "footage-search-notes.jsonl"), "utf8")
      .catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return ""; throw error; }))
      .split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const selections = await fileExists(this.config.chatgptSelectionsPath)
      ? await jsonFile<Record<string, any>>(this.config.chatgptSelectionsPath) : null;
    return { rawMetadata, inspections, notes, searchHistory: selections?.searchHistory ?? [],
      retainedDecisions: selections?.sourceIndexId === sourceIndex.indexId
        ? (selections.matches ?? []).filter((match: PracticeSceneMatchV1) => match.selectionMode === "CHATGPT_DIRECT") : [] };
  }

  async #verifyInspection(mediaId: string, uri: string, evidenceId: unknown, timeMs: number): Promise<void> {
    if (typeof evidenceId !== "string" || !/^[a-f0-9]{24}$/.test(evidenceId)) throw new TypeError("Use issued frame-inspection evidence IDs.");
    const receipt = await jsonFile<Record<string, any>>(path.join(this.config.chatgptInspectionDir, evidenceId + ".json"));
    const media = { mediaId, uri, role: "START_SOURCE", mediaKind: "VIDEO" } as PracticeMediaInputV1;
    // Reference IDs can be content-derived; the receipt retains the imported media
    // ID. File/version binding is the authority when revalidating retained choices.
    if ((receipt.mediaId !== mediaId && receipt.videoPath !== mediaPath(uri))
      || receipt.mediaVersion !== await this.#mediaCacheKey(media, ["inspection-media-version-v1"])) throw new TypeError("Inspection belongs to different or changed footage.");
    const frame = receipt.frames.find((item: any) => item.timeMs === timeMs);
    if (!frame || createHash("sha256").update(await readFile(frame.path)).digest("hex") !== frame.sha256) throw new TypeError("Comparison must reference real retained pixels at the exact requested timestamp.");
  }

  async recordFootageSearchNote(media: PracticeMediaInputV1, note: Record<string, any>): Promise<void> {
    if (media.mediaKind !== "VIDEO" || !note || !Array.isArray(note.rangeMs) || note.rangeMs.length !== 2
      || !note.rangeMs.every(Number.isFinite) || note.rangeMs[0] < 0 || note.rangeMs[1] <= note.rangeMs[0]
      || !["REVIEWED_NO_MATCH", "NEEDS_DENSE_REVIEW", "MATCH_LOCATED"].includes(note.status)
      || !note.observation?.trim() || !note.strategy?.trim()) throw new TypeError("Search notes require a bounded interval, status, strategy and observation.");
    await mkdir(this.config.artifactDir, { recursive: true });
    await appendFile(path.join(this.config.artifactDir, "footage-search-notes.jsonl"), JSON.stringify({ ...note,
      mediaId: media.mediaId, mediaVersion: await this.#mediaCacheKey(media, ["inspection-media-version-v1"]),
      recordedAt: new Date().toISOString() }) + "\n", { encoding: "utf8", flush: true });
  }

  async inspectFootage(media: PracticeMediaInputV1, timesMs: readonly number[], width = 640): Promise<Record<string, any>> {
    if (media.mediaKind !== "VIDEO" || !Array.isArray(timesMs) || timesMs.length < 1 || timesMs.length > 48
      || timesMs.some((value) => !Number.isFinite(value) || value < 0)
      || !Number.isInteger(width) || width < 160 || width > 1920) throw new TypeError("Request 1–48 timestamps and width 160–1920.");
    const key = await this.#mediaCacheKey(media, ["direct-pixel-inspection-v1", JSON.stringify(timesMs), String(width)]);
    const output = path.join(this.config.chatgptInspectionDir, key + ".json");
    await mkdir(path.dirname(output), { recursive: true });
    await this.#ensureArtifact(output, async () => {
      await this.#run(["browse", "--video", mediaPath(media.uri), "--output", output,
        "--times-json", JSON.stringify(timesMs), "--width", String(width),
        "--ffmpeg", await this.#resolveFfmpeg()]);
      const packet = await jsonFile<Record<string, any>>(output);
      if (!Array.isArray(packet.frames) || packet.frames.length !== timesMs.length
        || packet.frames.some((frame: any, i: number) => frame.timeMs !== timesMs[i])) throw new TypeError("Browser must return the exact GPT-requested timestamps.");
      await writeFile(output, JSON.stringify({ ...packet, evidenceId: key, mediaId: media.mediaId,
        videoPath: mediaPath(media.uri),
        mediaVersion: await this.#mediaCacheKey(media, ["inspection-media-version-v1"]) }) + "\n", "utf8");
    });
    const packet = await jsonFile<Record<string, any>>(output);
    for (const frame of packet.frames) {
      if (!await fileExists(frame.path) || createHash("sha256").update(await readFile(frame.path)).digest("hex") !== frame.sha256) {
        throw new TypeError("Inspected pixels changed; request a new inspection.");
      }
    }
    return packet;
  }

  async verifyFootageInspection(media: PracticeMediaInputV1, evidenceId: string, timeMs: number): Promise<void> {
    await this.#verifyInspection(media.mediaId, media.uri, evidenceId, timeMs);
  }

  async selectFootage(input: {
    reference: PracticeReferenceAnalysisV1; sourceIndex: PracticeSourceIndexV1;
    finish: PracticeMediaInputV1; start: readonly PracticeMediaInputV1[];
    selections: readonly Record<string, any>[]; search: Record<string, any>;
  }): Promise<readonly PracticeSceneMatchV1[]> {
    if (!Array.isArray(input.selections) || !input.selections.length || !["CONSULTED", "UNAVAILABLE"].includes(input.search?.internetStatus)
      || !Array.isArray(input.search.strategies) || !input.search.strategies.length
      || (input.search.internetStatus === "CONSULTED" && (!Array.isArray(input.search.sources)
        || !input.search.sources.length || input.search.sources.some((s: any) => !/^https?:\/\//.test(s.url) || !s.query?.trim() || !s.finding?.trim())))
      || (input.search.internetStatus === "UNAVAILABLE" && !input.search.reason?.trim())) throw new TypeError("Retain internet research (or an actual access failure) and the search strategies used.");
    let retained: PracticeSceneMatchV1[] = [];
    let searchHistory: unknown[] = [];
    if (await fileExists(this.config.chatgptSelectionsPath)) {
      const prior = await jsonFile<{ referenceId: string; referencePlanFingerprint?: string; sourceIndexId: string; matches: PracticeSceneMatchV1[]; searchHistory?: unknown[] }>(this.config.chatgptSelectionsPath);
      if (prior.referenceId === input.reference.referenceId && prior.sourceIndexId === input.sourceIndex.indexId
        && prior.referencePlanFingerprint === input.reference.styleFingerprint) {
        retained = prior.matches; searchHistory = prior.searchHistory ?? [];
      }
    }
    const selectedIds = new Set<string>();
    for (const selection of input.selections) {
      const shot = input.reference.shots.find((item) => item.shotId === selection.shotId);
      const source = input.start.find((item) => item.role === "START_SOURCE" && item.mediaKind === "VIDEO" && item.mediaId === selection.sourceId);
      if (!shot || !source || selectedIds.has(shot.shotId)) throw new TypeError("Selection must identify a unique reference shot and provided raw video.");
      selectedIds.add(shot.shotId);
      if (![selection.sourceStartMs, selection.sourceEndMs, selection.confidence, selection.playbackRate].every(Number.isFinite)
        || selection.playbackRate <= 0
        || selection.sourceStartMs < 0 || selection.sourceEndMs <= selection.sourceStartMs
        || selection.confidence < 0 || selection.confidence > 1
        || !["FORWARD", "REVERSE"].includes(selection.direction)
        || !selection.rationale?.trim() || !Array.isArray(selection.anchors) || selection.anchors.length < 3) throw new TypeError("Exact selection needs bounds, direction, confidence, rationale and three pixel comparisons.");
      const artifacts = this.#videoSourceArtifactsByIndexId.get(input.sourceIndex.indexId) ?? [];
      const sourceArtifact = (await Promise.all(artifacts.map((value) => jsonFile<SourceArtifactV1>(value)))).find((item) => item.sourceId === source.mediaId);
      if (!sourceArtifact?.video || selection.sourceEndMs > sourceArtifact.video.durationMs) throw new TypeError("Raw selection exceeds provided footage.");
      for (const anchor of selection.anchors) {
        if (![anchor.referenceTimeMs, anchor.sourceTimeMs].every(Number.isFinite)
          || anchor.referenceTimeMs < shot.referenceStartMs || anchor.referenceTimeMs >= shot.referenceEndMs
          || anchor.sourceTimeMs < selection.sourceStartMs || anchor.sourceTimeMs >= selection.sourceEndMs
          || !anchor.observation?.trim()) throw new TypeError("Every comparison must be inside its selected shot and describe the observed match.");
        for (const [media, evidenceId, timeMs] of [[input.finish, anchor.referenceEvidenceId, anchor.referenceTimeMs],
          [source, anchor.sourceEvidenceId, anchor.sourceTimeMs]] as const) {
          await this.#verifyInspection(media.mediaId, media.uri, evidenceId, timeMs);
        }
      }
      const anchors = [...selection.anchors].sort((a, b) => a.referenceTimeMs - b.referenceTimeMs);
      if (new Set(anchors.map((a) => a.referenceTimeMs)).size < 3
        || anchors.at(-1).referenceTimeMs - anchors[0].referenceTimeMs < (shot.referenceEndMs - shot.referenceStartMs) * .5) throw new TypeError("Inspect distinct moments spanning at least half the reference shot.");
      const temporalBehavior = selection.temporalBehavior ?? selection.direction;
      if (!["FORWARD", "REVERSE", "FORWARD_THEN_REWIND", "COMPLEX"].includes(temporalBehavior)) throw new TypeError("Unknown temporal behavior.");
      if (["FORWARD", "REVERSE"].includes(temporalBehavior) && temporalBehavior !== selection.direction) throw new TypeError("Temporal behavior must agree with the selected direction.");
      if (["FORWARD", "REVERSE"].includes(temporalBehavior)) for (let i = 1; i < anchors.length; i++) {
        if ((anchors[i].sourceTimeMs - anchors[i - 1].sourceTimeMs) * (selection.direction === "FORWARD" ? 1 : -1) <= 0) throw new TypeError("Comparisons must follow the selected direction; describe a rewind/complex trajectory explicitly when observed.");
      }
      const match: PracticeSceneMatchV1 = {
        shotId: shot.shotId, sourceId: source.mediaId, sourcePath: mediaPath(source.uri),
        sourceStartMs: selection.sourceStartMs, sourceEndMs: selection.sourceEndMs, direction: selection.direction,
        playbackRate: selection.playbackRate,
        trajectory: anchors.map((anchor) => ({ referenceTimeMs: anchor.referenceTimeMs, sourceTimeMs: anchor.sourceTimeMs, similarity: selection.confidence })),
        temporalBehavior,
        // Compatibility fields express GPT's declared visual confidence. They
        // are not machine scores, ranking, or geometric measurements.
        appearanceSimilarity: selection.confidence, temporalSimilarity: selection.confidence, motionSimilarity: selection.confidence,
        confidence: selection.confidence, selectionMode: "CHATGPT_DIRECT",
        chatgptSelection: { authority: "CHATGPT_DIRECT", decisionId: "chatgpt-selection:" + sha256Text([JSON.stringify(selection)]).slice(0, 24),
          reviewedAt: new Date().toISOString(), rationale: selection.rationale, anchors },
        evidenceRefs: ["chatgpt-direct-pixel-selection", ...anchors.flatMap((a) => ["footage-inspection:" + a.referenceEvidenceId, "footage-inspection:" + a.sourceEvidenceId])],
      };
      retained = [...retained.filter((item) => item.shotId !== shot.shotId), match];
    }
    await this.#saveChatgptPacket({ schema: "editflow.chatgpt-shot-selections.v1", referenceId: input.reference.referenceId,
      referencePlanFingerprint: input.reference.styleFingerprint,
      sourceIndexId: input.sourceIndex.indexId, search: input.search,
      searchHistory: [...searchHistory, { ...input.search, recordedAt: new Date().toISOString() }], matches: retained });
    return retained;
  }
}
