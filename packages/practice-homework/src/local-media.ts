import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  PracticeAudioMatchV1,
  PracticeHomeworkAdaptersV1,
  PracticeMediaInputV1,
  PracticeReferenceAnalysisV1,
  PracticeSceneMatchV1,
  PracticeSourceIndexV1,
} from "./contracts.js";

interface PythonRuntimeV1 {
  readonly executable: string;
  readonly prefixArgs: readonly string[];
}

export const defaultPracticeAnalysisCacheDirectoryV1 = (): string => path.resolve(
  process.env.LOCALAPPDATA?.trim() || os.homedir(),
  "EditFlow2",
  "practice-analysis-cache",
);

export interface LocalPracticeMediaMatcherConfigV1 {
  readonly artifactDir: string;
  readonly analysisCacheDir?: string;
  readonly scriptPath: string;
  readonly python?: PythonRuntimeV1;
  readonly ffmpegPath?: string;
  readonly correctionProfilePath?: string;
  readonly correctionCaseId?: string;
  readonly cutThreshold?: number;
  readonly minimumShotMs?: number;
  readonly sampleStepMs?: number;
  readonly coarseCandidateLimit?: number;
  readonly analysisProxyFps?: number;
  readonly analysisTimeoutMs?: number;
  readonly materializeWorkingMedia?: boolean;
  readonly workingMediaHandleMs?: number;
  readonly workingMediaMergeGapMs?: number;
}

interface ReferenceArtifactV1 {
  readonly schema: "editflow.practice-reference-analysis.v1";
  readonly referenceId: string;
  readonly sourcePath: string;
  readonly styleFingerprint: string;
  readonly perceptualSignature?: string;
  readonly video: {
    readonly fps: number;
    readonly frameCount: number;
    readonly width: number;
    readonly height: number;
    readonly durationMs: number;
    readonly sourceDurationMs?: number;
  };
  readonly shots: readonly {
    readonly shotId: string;
    readonly order: number;
    readonly referenceStartMs: number;
    readonly referenceEndMs: number;
    readonly evidenceRefs: readonly string[];
  }[];
  readonly excludedRanges?: readonly {
    readonly kind: "STATIC_LOW_INFORMATION_TAIL";
    readonly referenceStartMs: number;
    readonly referenceEndMs: number;
    readonly confidence: number;
    readonly evidenceRefs: readonly string[];
  }[];
  readonly evidenceRefs: readonly string[];
}

interface SourceArtifactV1 {
  readonly schema: "editflow.practice-source-index.v1";
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly sourceSha256: string;
  readonly perceptualSignature?: string;
  readonly evidenceRefs: readonly string[];
}

interface MatchArtifactV1 {
  readonly schema: "editflow.practice-scene-matches.v1";
  readonly matches: readonly PracticeSceneMatchV1[];
  readonly evidenceRefs: readonly string[];
}

interface AudioMatchArtifactV1 {
  readonly schema: "editflow.practice-audio-match.v1";
  readonly match: PracticeAudioMatchV1 | null;
  readonly evidenceRefs: readonly string[];
}

interface AudioSourceV1 {
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly cacheKey: string;
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

export type PracticeExecutionAdaptersV1 = Pick<
  PracticeHomeworkAdaptersV1,
  "buildContentBaseline" | "reconstruct" | "evaluate" | "recordEpisode"
>;

const defaultPython = (): PythonRuntimeV1 =>
  process.platform === "win32"
    ? { executable: "py", prefixArgs: ["-3.12"] }
    : { executable: "python3", prefixArgs: [] };

export const resolvePracticeLocalMediaPathV1 = (uri: string): string => {
  if (uri.startsWith("file:")) return fileURLToPath(uri);
  if (path.isAbsolute(uri)) return path.resolve(uri);
  if (path.win32.isAbsolute(uri)) return path.win32.normalize(uri);
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(uri)) {
    throw new TypeError("Practice local media matcher accepts only local file media.");
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

export class LocalPracticeMediaMatcherV1 {
  readonly config: Required<Omit<
  LocalPracticeMediaMatcherConfigV1,
  "python" | "ffmpegPath" | "correctionProfilePath" | "correctionCaseId"
  >> & {
    readonly python: PythonRuntimeV1;
    readonly ffmpegPath: string | null;
    readonly correctionProfilePath: string | null;
    readonly correctionCaseId: string | null;
  };

  readonly #referenceArtifactPathById = new Map<string, string>();
  readonly #referenceMediaPathById = new Map<string, string>();
  readonly #videoSourceArtifactsByIndexId = new Map<string, readonly string[]>();
  readonly #audioSourcesByIndexId = new Map<string, readonly AudioSourceV1[]>();
  #scriptDigest: Promise<string> | null = null;
  #ffmpegExecutable: Promise<string> | null = null;

  constructor(config: LocalPracticeMediaMatcherConfigV1) {
    this.config = {
      artifactDir: path.resolve(config.artifactDir),
      analysisCacheDir: path.resolve(
        config.analysisCacheDir ?? path.join(config.artifactDir, "analysis-cache"),
      ),
      scriptPath: path.resolve(config.scriptPath),
      python: config.python ?? defaultPython(),
      ffmpegPath: config.ffmpegPath?.trim() || null,
      correctionProfilePath: config.correctionProfilePath?.trim()
        ? path.resolve(config.correctionProfilePath)
        : null,
      correctionCaseId: config.correctionCaseId?.trim() || null,
      cutThreshold: config.cutThreshold ?? 0.42,
      minimumShotMs: config.minimumShotMs ?? 180,
      sampleStepMs: config.sampleStepMs ?? 250,
      coarseCandidateLimit: config.coarseCandidateLimit ?? 16,
      analysisProxyFps: config.analysisProxyFps ?? 12,
      analysisTimeoutMs: config.analysisTimeoutMs ?? 60 * 60 * 1000,
      materializeWorkingMedia: config.materializeWorkingMedia ?? false,
      workingMediaHandleMs: Math.max(0, config.workingMediaHandleMs ?? 2_500),
      workingMediaMergeGapMs: Math.max(0, config.workingMediaMergeGapMs ?? 1_000),
    };
    if (this.config.correctionProfilePath !== null
      && this.config.correctionCaseId === null) {
      throw new TypeError(
        "Practice matcher correction replay requires a retained-truth case id.",
      );
    }
  }

  async #scriptSha256(): Promise<string> {
    this.#scriptDigest ??= readFile(this.config.scriptPath)
      .then((bytes) => createHash("sha256").update(bytes).digest("hex"));
    return this.#scriptDigest;
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
    const invocation = [...this.config.python.prefixArgs, this.config.scriptPath, ...args];
    await new Promise<void>((resolve, reject) => {
      let timedOut = false;
      let stderr = "";
      const child = spawn(this.config.python.executable, invocation, {
        windowsHide: true,
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "ignore", "pipe"],
      });
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
            "Practice media analysis timed out after "
            + String(this.config.analysisTimeoutMs)
            + " ms; the analyzer process tree was terminated.",
          ));
          return;
        }
        if (code !== 0) {
          const detail = stderr.trim();
          reject(new Error(
            "Practice media analysis command failed"
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

  async analyzeFinish(
    finish: PracticeMediaInputV1,
  ): Promise<PracticeReferenceAnalysisV1> {
    if (finish.mediaKind !== "VIDEO") {
      throw new TypeError("Practice Finish must be a video.");
    }
    const localPath = mediaPath(finish.uri);
    const key = await this.#mediaCacheKey(finish, [
      "reference",
      String(this.config.cutThreshold),
      String(this.config.minimumShotMs),
    ]);
    const directory = path.join(this.config.analysisCacheDir, "reference");
    await mkdir(directory, { recursive: true });
    const artifactPath = path.join(
      directory,
      safeStem(finish.mediaId) + "-" + key + ".json",
    );

    if (!(await fileExists(artifactPath))) {
      await this.#run([
        "reference",
        "--video", localPath,
        "--reference-id", finish.mediaId,
        "--output", artifactPath,
        "--cut-threshold", String(this.config.cutThreshold),
        "--minimum-shot-ms", String(this.config.minimumShotMs),
      ]);
    }

    const artifact = await jsonFile<ReferenceArtifactV1>(artifactPath);
    if (artifact.schema !== "editflow.practice-reference-analysis.v1"
      || artifact.referenceId !== finish.mediaId
      || artifact.shots.length === 0) {
      throw new TypeError("Practice reference analyzer returned an invalid artifact.");
    }
    this.#referenceArtifactPathById.set(artifact.referenceId, artifactPath);
    this.#referenceMediaPathById.set(artifact.referenceId, localPath);
    return {
      referenceId: artifact.referenceId,
      sourcePath: artifact.sourcePath,
      styleFingerprint: artifact.styleFingerprint,
      ...(artifact.perceptualSignature === undefined
        ? {}
        : { perceptualSignature: artifact.perceptualSignature }),
      video: artifact.video,
      shots: artifact.shots.map((shot) => ({
        shotId: shot.shotId,
        order: shot.order,
        referenceStartMs: shot.referenceStartMs,
        referenceEndMs: shot.referenceEndMs,
        evidenceRefs: shot.evidenceRefs,
      })),
      ...(artifact.excludedRanges === undefined
        ? {}
        : {
          excludedRanges: artifact.excludedRanges.map((range) => ({
            kind: range.kind,
            referenceStartMs: range.referenceStartMs,
            referenceEndMs: range.referenceEndMs,
            confidence: range.confidence,
            evidenceRefs: range.evidenceRefs,
          })),
        }),
      evidenceRefs: [
        ...artifact.evidenceRefs,
        "practice-reference-artifact:" + artifactPath,
      ],
    };
  }

  async indexStart(
    start: readonly PracticeMediaInputV1[],
  ): Promise<PracticeSourceIndexV1> {
    const directory = path.join(this.config.analysisCacheDir, "sources");
    await mkdir(directory, { recursive: true });

    const videoArtifactPaths: string[] = [];
    const audioSources: AudioSourceV1[] = [];
    const sourceIds: string[] = [];
    const videoSourceIds: string[] = [];
    const audioSourceIds: string[] = [];
    const videoPerceptualSignatures: string[] = [];
    const evidenceRefs: string[] = [];
    const identityParts: string[] = [];

    for (const input of start) {
      const localPath = mediaPath(input.uri);
      sourceIds.push(input.mediaId);
      if (input.mediaKind === "VIDEO") {
        const key = await this.#mediaCacheKey(input, [
          "source-index",
          String(this.config.sampleStepMs),
          String(this.config.analysisProxyFps),
          this.config.ffmpegPath ?? "ffmpeg:auto",
        ]);
        const artifactPath = path.join(
          directory,
          safeStem(input.mediaId) + "-" + key + ".json",
        );
        if (!(await fileExists(artifactPath))) {
          await this.#run([
            "index",
            "--video", localPath,
            "--source-id", input.mediaId,
            "--output", artifactPath,
            "--sample-step-ms", String(this.config.sampleStepMs),
            "--analysis-fps", String(this.config.analysisProxyFps),
            "--proxy-dir", path.join(this.config.analysisCacheDir, "proxies"),
            ...(this.config.ffmpegPath === null
              ? []
              : ["--ffmpeg", this.config.ffmpegPath]),
          ]);
        }
        const artifact = await jsonFile<SourceArtifactV1>(artifactPath);
        if (artifact.schema !== "editflow.practice-source-index.v1"
          || artifact.sourceId !== input.mediaId) {
          throw new TypeError("Practice source indexer returned an invalid artifact.");
        }
        videoArtifactPaths.push(artifactPath);
        videoSourceIds.push(artifact.sourceId);
        if (artifact.perceptualSignature !== undefined) {
          videoPerceptualSignatures.push(artifact.perceptualSignature);
        }
        identityParts.push("video:" + artifactPath);
        evidenceRefs.push(
          ...artifact.evidenceRefs,
          "practice-source-artifact:" + artifactPath,
        );
      } else {
        const key = await this.#mediaCacheKey(input, ["audio-source"]);
        const metadata = await stat(localPath);
        audioSources.push({
          sourceId: input.mediaId,
          sourcePath: localPath,
          cacheKey: key,
        });
        audioSourceIds.push(input.mediaId);
        identityParts.push("audio:" + input.mediaId + ":" + key);
        evidenceRefs.push(
          "practice-audio-source:" + input.mediaId,
          "practice-audio-source-path:" + localPath,
          "practice-audio-source-bytes:" + String(metadata.size),
        );
      }
    }

    const indexId = "practice-source-set:" + sha256Text(identityParts).slice(0, 24);
    this.#videoSourceArtifactsByIndexId.set(indexId, videoArtifactPaths);
    this.#audioSourcesByIndexId.set(indexId, audioSources);
    return {
      indexId,
      sourceIds,
      videoSourceIds,
      audioSourceIds,
      ...(videoPerceptualSignatures.length === 0
        ? {}
        : { videoPerceptualSignatures: [...new Set(videoPerceptualSignatures)].sort() }),
      evidenceRefs: [...new Set(evidenceRefs)],
    };
  }

  async matchScenes(input: {
    readonly reference: PracticeReferenceAnalysisV1;
    readonly sourceIndex: PracticeSourceIndexV1;
    readonly minimumConfidence: number;
  }): Promise<readonly PracticeSceneMatchV1[]> {
    const referencePath = this.#referenceArtifactPathById.get(input.reference.referenceId);
    const sourcePaths = this.#videoSourceArtifactsByIndexId.get(input.sourceIndex.indexId);
    if (referencePath === undefined || sourcePaths === undefined) {
      throw new TypeError("Practice media artifacts are not available for this matcher instance.");
    }
    if (sourcePaths.length === 0) {
      throw new TypeError("Practice scene matching requires at least one indexed video source.");
    }

    const directory = path.join(this.config.analysisCacheDir, "matches");
    await mkdir(directory, { recursive: true });
    const correctionProfileDigest = this.config.correctionProfilePath === null
      ? "correction:none"
      : createHash("sha256")
        .update(await readFile(this.config.correctionProfilePath))
        .digest("hex");
    const key = sha256Text([
      await this.#scriptSha256(),
      referencePath,
      ...sourcePaths,
      String(this.config.coarseCandidateLimit),
      correctionProfileDigest,
      this.config.correctionCaseId ?? "correction-case:none",
    ]).slice(0, 24);
    const outputPath = path.join(
      directory,
      safeStem(input.reference.referenceId) + "-" + key + ".json",
    );

    if (!(await fileExists(outputPath))) {
      const args = [
        "match",
        "--reference-json", referencePath,
        "--output", outputPath,
        "--coarse-limit", String(this.config.coarseCandidateLimit),
      ];
      for (const sourcePathValue of sourcePaths) {
        args.push("--source-index-json", sourcePathValue);
      }
      if (this.config.correctionProfilePath !== null) {
        args.push("--correction-profile", this.config.correctionProfilePath);
        args.push("--correction-case-id", this.config.correctionCaseId!);
      }
      await this.#run(args);
    }

    const artifact = await jsonFile<MatchArtifactV1>(outputPath);
    if (artifact.schema !== "editflow.practice-scene-matches.v1") {
      throw new TypeError("Practice scene matcher returned an invalid artifact.");
    }

    const matches = artifact.matches.map((match) => ({
      ...match,
      evidenceRefs: [
        ...match.evidenceRefs,
        ...artifact.evidenceRefs,
        "practice-match-artifact:" + outputPath,
        "practice-required-confidence:" + input.minimumConfidence.toFixed(6),
      ],
    }));
    if (!this.config.materializeWorkingMedia
      || matches.some((match) => match.confidence < input.minimumConfidence)) {
      return matches;
    }
    const sourceArtifacts = await Promise.all(
      sourcePaths.map((sourcePathValue) => jsonFile<SourceArtifactV1>(sourcePathValue)),
    );
    return await this.#materializeWorkingMatches(matches, sourceArtifacts);
  }

  async matchAudio(input: {
    readonly reference: PracticeReferenceAnalysisV1;
    readonly sourceIndex: PracticeSourceIndexV1;
    readonly minimumConfidence: number;
  }): Promise<PracticeAudioMatchV1 | null> {
    const referenceMedia = this.#referenceMediaPathById.get(input.reference.referenceId);
    const referenceArtifact = this.#referenceArtifactPathById.get(input.reference.referenceId);
    const audioSources = this.#audioSourcesByIndexId.get(input.sourceIndex.indexId);
    if (referenceMedia === undefined || referenceArtifact === undefined || audioSources === undefined) {
      throw new TypeError("Practice audio artifacts are not available for this matcher instance.");
    }
    if (audioSources.length === 0) return null;

    const directory = path.join(this.config.analysisCacheDir, "audio-matches");
    await mkdir(directory, { recursive: true });
    const key = sha256Text([
      await this.#scriptSha256(),
      referenceArtifact,
      ...audioSources.map((item) => item.sourceId + ":" + item.cacheKey),
      this.config.ffmpegPath ?? "ffmpeg:auto",
    ]).slice(0, 24);
    const outputPath = path.join(
      directory,
      safeStem(input.reference.referenceId) + "-" + key + ".json",
    );

    if (!(await fileExists(outputPath))) {
      const args = [
        "audio-match",
        "--reference-media", referenceMedia,
        "--reference-id", input.reference.referenceId,
        "--output", outputPath,
      ];
      if (this.config.ffmpegPath !== null) {
        args.push("--ffmpeg", this.config.ffmpegPath);
      }
      for (const source of audioSources) {
        args.push("--source-audio", source.sourceId + "|||" + source.sourcePath);
      }
      await this.#run(args);
    }

    const artifact = await jsonFile<AudioMatchArtifactV1>(outputPath);
    if (artifact.schema !== "editflow.practice-audio-match.v1") {
      throw new TypeError("Practice audio matcher returned an invalid artifact.");
    }
    if (artifact.match === null) return null;
    return {
      ...artifact.match,
      evidenceRefs: [
        ...artifact.match.evidenceRefs,
        ...artifact.evidenceRefs,
        "practice-audio-match-artifact:" + outputPath,
        "practice-required-audio-confidence:" + input.minimumConfidence.toFixed(6),
      ],
    };
  }
}

export const composePracticeHomeworkAdaptersV1 = (
  media: LocalPracticeMediaMatcherV1,
  execution: PracticeExecutionAdaptersV1,
): PracticeHomeworkAdaptersV1 => ({
  analyzeFinish: (finish) => media.analyzeFinish(finish),
  indexStart: (start) => media.indexStart(start),
  matchScenes: (input) => media.matchScenes(input),
  matchAudio: (input) => media.matchAudio(input),
  buildContentBaseline: (input) => execution.buildContentBaseline(input),
  reconstruct: (input) => execution.reconstruct(input),
  evaluate: (input) => execution.evaluate(input),
  ...(execution.recordEpisode === undefined
    ? {}
    : { recordEpisode: (episode) => execution.recordEpisode?.(episode) ?? Promise.resolve() }),
});
