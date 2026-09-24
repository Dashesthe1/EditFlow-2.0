import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
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

export interface LocalPracticeMediaMatcherConfigV1 {
  readonly artifactDir: string;
  readonly analysisCacheDir?: string;
  readonly scriptPath: string;
  readonly python?: PythonRuntimeV1;
  readonly ffmpegPath?: string;
  readonly cutThreshold?: number;
  readonly minimumShotMs?: number;
  readonly sampleStepMs?: number;
  readonly coarseCandidateLimit?: number;
  readonly analysisProxyFps?: number;
  readonly analysisTimeoutMs?: number;
}

interface ReferenceArtifactV1 {
  readonly schema: "editflow.practice-reference-analysis.v1";
  readonly referenceId: string;
  readonly sourcePath: string;
  readonly styleFingerprint: string;
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
  readonly config: Required<Omit<LocalPracticeMediaMatcherConfigV1, "python" | "ffmpegPath">> & {
    readonly python: PythonRuntimeV1;
    readonly ffmpegPath: string | null;
  };

  readonly #referenceArtifactPathById = new Map<string, string>();
  readonly #referenceMediaPathById = new Map<string, string>();
  readonly #videoSourceArtifactsByIndexId = new Map<string, readonly string[]>();
  readonly #audioSourcesByIndexId = new Map<string, readonly AudioSourceV1[]>();
  #scriptDigest: Promise<string> | null = null;

  constructor(config: LocalPracticeMediaMatcherConfigV1) {
    this.config = {
      artifactDir: path.resolve(config.artifactDir),
      analysisCacheDir: path.resolve(
        config.analysisCacheDir ?? path.join(config.artifactDir, "analysis-cache"),
      ),
      scriptPath: path.resolve(config.scriptPath),
      python: config.python ?? defaultPython(),
      ffmpegPath: config.ffmpegPath?.trim() || null,
      cutThreshold: config.cutThreshold ?? 0.42,
      minimumShotMs: config.minimumShotMs ?? 180,
      sampleStepMs: config.sampleStepMs ?? 250,
      coarseCandidateLimit: config.coarseCandidateLimit ?? 16,
      analysisProxyFps: config.analysisProxyFps ?? 12,
      analysisTimeoutMs: config.analysisTimeoutMs ?? 60 * 60 * 1000,
    };
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
    const directory = path.join(this.config.artifactDir, "reference");
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
    const directory = path.join(this.config.artifactDir, "sources");
    await mkdir(directory, { recursive: true });

    const videoArtifactPaths: string[] = [];
    const audioSources: AudioSourceV1[] = [];
    const sourceIds: string[] = [];
    const videoSourceIds: string[] = [];
    const audioSourceIds: string[] = [];
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

    const directory = path.join(this.config.artifactDir, "matches");
    await mkdir(directory, { recursive: true });
    const key = sha256Text([
      await this.#scriptSha256(),
      referencePath,
      ...sourcePaths,
      String(this.config.coarseCandidateLimit),
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
      await this.#run(args);
    }

    const artifact = await jsonFile<MatchArtifactV1>(outputPath);
    if (artifact.schema !== "editflow.practice-scene-matches.v1") {
      throw new TypeError("Practice scene matcher returned an invalid artifact.");
    }

    return artifact.matches.map((match) => ({
      ...match,
      evidenceRefs: [
        ...match.evidenceRefs,
        "practice-match-artifact:" + outputPath,
        "practice-required-confidence:" + input.minimumConfidence.toFixed(6),
      ],
    }));
  }

  async matchAudio(input: {
    readonly reference: PracticeReferenceAnalysisV1;
    readonly sourceIndex: PracticeSourceIndexV1;
    readonly minimumConfidence: number;
  }): Promise<PracticeAudioMatchV1 | null> {
    const referenceMedia = this.#referenceMediaPathById.get(input.reference.referenceId);
    const audioSources = this.#audioSourcesByIndexId.get(input.sourceIndex.indexId);
    if (referenceMedia === undefined || audioSources === undefined) {
      throw new TypeError("Practice audio artifacts are not available for this matcher instance.");
    }
    if (audioSources.length === 0) return null;

    const directory = path.join(this.config.artifactDir, "audio-matches");
    await mkdir(directory, { recursive: true });
    const key = sha256Text([
      await this.#scriptSha256(),
      referenceMedia,
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
