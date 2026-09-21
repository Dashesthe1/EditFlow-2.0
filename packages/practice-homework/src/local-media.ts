import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type {
  PracticeHomeworkAdaptersV1,
  PracticeMediaInputV1,
  PracticeReferenceAnalysisV1,
  PracticeSceneMatchV1,
  PracticeSourceIndexV1,
} from "./contracts.js";

const execFileAsync = promisify(execFile);

interface PythonRuntimeV1 {
  readonly executable: string;
  readonly prefixArgs: readonly string[];
}

export interface LocalPracticeMediaMatcherConfigV1 {
  readonly artifactDir: string;
  readonly scriptPath: string;
  readonly python?: PythonRuntimeV1;
  readonly cutThreshold?: number;
  readonly minimumShotMs?: number;
  readonly sampleStepMs?: number;
  readonly coarseCandidateLimit?: number;
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
  };
  readonly shots: readonly {
    readonly shotId: string;
    readonly order: number;
    readonly referenceStartMs: number;
    readonly referenceEndMs: number;
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

export type PracticeExecutionAdaptersV1 = Pick<
  PracticeHomeworkAdaptersV1,
  "buildContentBaseline" | "reconstruct" | "evaluate" | "recordEpisode"
>;

const defaultPython = (): PythonRuntimeV1 =>
  process.platform === "win32"
    ? { executable: "py", prefixArgs: ["-3.12"] }
    : { executable: "python3", prefixArgs: [] };

const mediaPath = (uri: string): string => {
  if (uri.startsWith("file:")) {
    return fileURLToPath(uri);
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(uri)) {
    throw new TypeError("Practice local media matcher accepts only local file media.");
  }
  return path.resolve(uri);
};

const safeStem = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "media";

const jsonFile = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await readFile(filePath, "utf8")) as T;

const sha256Text = (parts: readonly string[]): string =>
  createHash("sha256").update(parts.join("\n"), "utf8").digest("hex");

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    const value = await stat(filePath);
    return value.isFile() && value.size > 0;
  } catch {
    return false;
  }
};

export class LocalPracticeMediaMatcherV1 {
  readonly config: Required<Omit<LocalPracticeMediaMatcherConfigV1, "python">> & {
    readonly python: PythonRuntimeV1;
  };

  readonly #referencePathById = new Map<string, string>();
  readonly #sourcePathsByIndexId = new Map<string, readonly string[]>();
  #scriptDigest: Promise<string> | null = null;

  constructor(config: LocalPracticeMediaMatcherConfigV1) {
    this.config = {
      artifactDir: path.resolve(config.artifactDir),
      scriptPath: path.resolve(config.scriptPath),
      python: config.python ?? defaultPython(),
      cutThreshold: config.cutThreshold ?? 0.42,
      minimumShotMs: config.minimumShotMs ?? 180,
      sampleStepMs: config.sampleStepMs ?? 750,
      coarseCandidateLimit: config.coarseCandidateLimit ?? 16,
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
      throw new TypeError(`Practice media is not a file: ${localPath}`);
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
    await execFileAsync(this.config.python.executable, invocation, {
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
  }

  async analyzeFinish(
    finish: PracticeMediaInputV1,
  ): Promise<PracticeReferenceAnalysisV1> {
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
      `${safeStem(finish.mediaId)}-${key}.json`,
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
    this.#referencePathById.set(artifact.referenceId, artifactPath);
    return {
      referenceId: artifact.referenceId,
      styleFingerprint: artifact.styleFingerprint,
      video: artifact.video,
      shots: artifact.shots.map((shot) => ({
        shotId: shot.shotId,
        order: shot.order,
        referenceStartMs: shot.referenceStartMs,
        referenceEndMs: shot.referenceEndMs,
        evidenceRefs: shot.evidenceRefs,
      })),
      evidenceRefs: [
        ...artifact.evidenceRefs,
        `practice-reference-artifact:${artifactPath}`,
      ],
    };
  }

  async indexStart(
    start: readonly PracticeMediaInputV1[],
  ): Promise<PracticeSourceIndexV1> {
    const directory = path.join(this.config.artifactDir, "sources");
    await mkdir(directory, { recursive: true });
    const artifactPaths: string[] = [];
    const sourceIds: string[] = [];
    const evidenceRefs: string[] = [];

    for (const input of start) {
      const localPath = mediaPath(input.uri);
      const key = await this.#mediaCacheKey(input, [
        "source-index",
        String(this.config.sampleStepMs),
      ]);
      const artifactPath = path.join(
        directory,
        `${safeStem(input.mediaId)}-${key}.json`,
      );
      if (!(await fileExists(artifactPath))) {
        await this.#run([
          "index",
          "--video", localPath,
          "--source-id", input.mediaId,
          "--output", artifactPath,
          "--sample-step-ms", String(this.config.sampleStepMs),
        ]);
      }
      const artifact = await jsonFile<SourceArtifactV1>(artifactPath);
      if (artifact.schema !== "editflow.practice-source-index.v1"
        || artifact.sourceId !== input.mediaId) {
        throw new TypeError("Practice source indexer returned an invalid artifact.");
      }
      artifactPaths.push(artifactPath);
      sourceIds.push(artifact.sourceId);
      evidenceRefs.push(
        ...artifact.evidenceRefs,
        `practice-source-artifact:${artifactPath}`,
      );
    }

    const indexId = `practice-source-set:${sha256Text(artifactPaths).slice(0, 24)}`;
    this.#sourcePathsByIndexId.set(indexId, artifactPaths);
    return {
      indexId,
      sourceIds,
      evidenceRefs: [...new Set(evidenceRefs)],
    };
  }

  async matchScenes(input: {
    readonly reference: PracticeReferenceAnalysisV1;
    readonly sourceIndex: PracticeSourceIndexV1;
    readonly minimumConfidence: number;
  }): Promise<readonly PracticeSceneMatchV1[]> {
    const referencePath = this.#referencePathById.get(input.reference.referenceId);
    const sourcePaths = this.#sourcePathsByIndexId.get(input.sourceIndex.indexId);
    if (referencePath === undefined || sourcePaths === undefined) {
      throw new TypeError("Practice media artifacts are not available for this matcher instance.");
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
      `${safeStem(input.reference.referenceId)}-${key}.json`,
    );

    if (!(await fileExists(outputPath))) {
      const args = [
        "match",
        "--reference-json", referencePath,
        "--output", outputPath,
        "--coarse-limit", String(this.config.coarseCandidateLimit),
      ];
      for (const sourcePath of sourcePaths) {
        args.push("--source-index-json", sourcePath);
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
        `practice-match-artifact:${outputPath}`,
        `practice-required-confidence:${input.minimumConfidence.toFixed(6)}`,
      ],
    }));
  }
}

export const composePracticeHomeworkAdaptersV1 = (
  media: LocalPracticeMediaMatcherV1,
  execution: PracticeExecutionAdaptersV1,
): PracticeHomeworkAdaptersV1 => ({
  analyzeFinish: (finish) => media.analyzeFinish(finish),
  indexStart: (start) => media.indexStart(start),
  matchScenes: (input) => media.matchScenes(input),
  buildContentBaseline: (input) => execution.buildContentBaseline(input),
  reconstruct: (input) => execution.reconstruct(input),
  evaluate: (input) => execution.evaluate(input),
  ...(execution.recordEpisode === undefined
    ? {}
    : { recordEpisode: (episode) => execution.recordEpisode?.(episode) ?? Promise.resolve() }),
});
