import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PNG } from "pngjs";

import {
  analyzeDenseEffectEvidenceV1,
  type DenseEffectEvidenceV1,
} from "../../../packages/visual-effects-intelligence/src/index.js";
import type {
  PracticeReferenceAnalysisV1,
  PracticeSceneMatchV1,
} from "../../../packages/practice-homework/src/contracts.js";
import type {
  PracticeContentStructureEvaluationV1,
} from "../../../packages/practice-homework/src/m6-practice.js";

const execFileAsync = promisify(execFile);

export interface PracticeM6PythonRuntimeV1 {
  readonly executable: string;
  readonly prefixArgs: readonly string[];
}

export interface PracticeM6LocalMediaConfigV1 {
  readonly repositoryRoot: string;
  readonly artifactDir: string;
  readonly python?: PracticeM6PythonRuntimeV1;
  readonly denseProbeScriptPath?: string;
  readonly practiceMediaScriptPath?: string;
  readonly denseEvidenceSourcePath?: string;
  readonly analysisLongestEdge?: number;
  readonly cutThreshold?: number;
}

interface DenseProbeV1 {
  readonly schema: "editflow.dense-video-probe.v1";
  readonly sourceId: string;
  readonly sourceKind: "REFERENCE" | "RENDER";
  readonly sourceVideoSha256: string;
  readonly video: {
    readonly fps: number;
  };
  readonly analysis: {
    readonly algorithmId: string;
    readonly analyzerFingerprint: string;
    readonly longestEdge: number;
  };
  readonly frames: readonly {
    readonly timeMs: number;
    readonly pngPath: string;
    readonly semantic?: Readonly<Record<string, unknown>>;
  }[];
}

interface PracticeContentStructureArtifactV1 {
  readonly schema: "editflow.practice-content-structure-evaluation.v1";
  readonly breakdown: {
    readonly sceneIdentity: number;
    readonly temporalAlignment: number;
    readonly cutTiming: number;
    readonly framing: number;
    readonly motion: number;
    readonly colorFinish: number;
    readonly pixelStructure: number;
  };
  readonly wrongSceneCount: number;
  readonly unmatchedSceneCount: number;
  readonly evidenceRefs: readonly string[];
}

const defaultPython = (): PracticeM6PythonRuntimeV1 =>
  process.platform === "win32"
    ? { executable: "py", prefixArgs: ["-3.12"] }
    : { executable: "python3", prefixArgs: [] };

const sha256Bytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const sha256File = async (filePath: string): Promise<string> =>
  sha256Bytes(await readFile(filePath));

const safeStem = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 54)
  || "media";

const finite01 = (value: number, label: string): number => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(label + " must be finite and normalized to [0, 1].");
  }
  return value;
};

const fileExists = async (value: string): Promise<boolean> => {
  try {
    const metadata = await stat(value);
    return metadata.isFile() && metadata.size > 0;
  } catch {
    return false;
  }
};

const referenceArtifactPath = (reference: PracticeReferenceAnalysisV1): string | null => {
  const ref = reference.evidenceRefs.find((item) =>
    item.startsWith("practice-reference-artifact:"));
  return ref === undefined
    ? null
    : ref.slice("practice-reference-artifact:".length);
};

export class PracticeM6LocalMediaAnalyzerV1 {
  readonly repositoryRoot: string;
  readonly artifactDir: string;
  readonly python: PracticeM6PythonRuntimeV1;
  readonly denseProbeScriptPath: string;
  readonly practiceMediaScriptPath: string;
  readonly denseEvidenceSourcePath: string;
  readonly analysisLongestEdge: number;
  readonly cutThreshold: number;

  constructor(config: PracticeM6LocalMediaConfigV1) {
    this.repositoryRoot = path.resolve(config.repositoryRoot);
    this.artifactDir = path.resolve(config.artifactDir);
    this.python = config.python ?? defaultPython();
    this.denseProbeScriptPath = path.resolve(
      config.denseProbeScriptPath
        ?? path.join(this.repositoryRoot, "scripts", "proofs", "m6-dense-video-probe.py"),
    );
    this.practiceMediaScriptPath = path.resolve(
      config.practiceMediaScriptPath
        ?? path.join(this.repositoryRoot, "scripts", "practice", "practice-media-match.py"),
    );
    this.denseEvidenceSourcePath = path.resolve(
      config.denseEvidenceSourcePath
        ?? path.join(
          this.repositoryRoot,
          "packages",
          "visual-effects-intelligence",
          "src",
          "dense-evidence.ts",
        ),
    );
    this.analysisLongestEdge = config.analysisLongestEdge ?? 360;
    this.cutThreshold = config.cutThreshold ?? 0.42;
    if (!Number.isInteger(this.analysisLongestEdge)
      || this.analysisLongestEdge < 160
      || this.analysisLongestEdge > 1080) {
      throw new TypeError("Practice M6 analysisLongestEdge must be an integer from 160 through 1080.");
    }
    if (!Number.isFinite(this.cutThreshold)
      || this.cutThreshold < 0.1
      || this.cutThreshold > 0.95) {
      throw new TypeError("Practice M6 cutThreshold must be in [0.1, 0.95].");
    }
  }

  async #runPython(scriptPath: string, args: readonly string[]): Promise<void> {
    await execFileAsync(
      this.python.executable,
      [...this.python.prefixArgs, scriptPath, ...args],
      {
        cwd: this.repositoryRoot,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
  }

  async #denseCacheKey(input: {
    readonly videoPath: string;
    readonly startMs: number;
    readonly endMs: number;
  }): Promise<string> {
    const videoPath = path.resolve(input.videoPath);
    const metadata = await stat(videoPath);
    const material = JSON.stringify({
      videoPath,
      size: metadata.size,
      mtimeMs: metadata.mtimeMs,
      startMs: input.startMs,
      endMs: input.endMs,
      analysisLongestEdge: this.analysisLongestEdge,
      probeScriptSha256: await sha256File(this.denseProbeScriptPath),
      denseEvidenceSourceSha256: await sha256File(this.denseEvidenceSourcePath),
    });
    return createHash("sha256").update(material, "utf8").digest("hex").slice(0, 24);
  }

  async analyzeVideo(input: {
    readonly videoPath: string;
    readonly sourceId: string;
    readonly sourceKind: "REFERENCE" | "RENDER";
    readonly startMs: number;
    readonly endMs: number;
  }): Promise<DenseEffectEvidenceV1> {
    if (!Number.isFinite(input.startMs)
      || !Number.isFinite(input.endMs)
      || input.startMs < 0
      || input.endMs <= input.startMs) {
      throw new TypeError("Practice M6 dense analysis requires a finite positive time range.");
    }
    const videoPath = path.resolve(input.videoPath);
    if (!(await fileExists(videoPath))) {
      throw new TypeError("Practice M6 dense analysis video does not exist: " + videoPath);
    }
    const directory = path.join(this.artifactDir, "dense-evidence");
    await mkdir(directory, { recursive: true });
    const key = await this.#denseCacheKey({
      videoPath,
      startMs: input.startMs,
      endMs: input.endMs,
    });
    const stem = safeStem(input.sourceId) + "-" + key;
    const probePath = path.join(directory, stem + "-probe.json");
    const evidencePath = path.join(directory, stem + "-evidence.json");

    if (await fileExists(evidencePath)) {
      const cached = JSON.parse(await readFile(evidencePath, "utf8")) as DenseEffectEvidenceV1;
      if (cached.schema === "editflow.dense-effect-evidence.v1"
        && cached.sourceId === input.sourceId
        && cached.sourceKind === input.sourceKind) {
        return cached;
      }
    }

    await this.#runPython(this.denseProbeScriptPath, [
      "--video", videoPath,
      "--start", String(input.startMs / 1000),
      "--end", String(input.endMs / 1000),
      "--output", probePath,
      "--source-id", input.sourceId,
      "--source-kind", input.sourceKind,
      "--analysis-size", String(this.analysisLongestEdge),
    ]);

    const probeBytes = await readFile(probePath);
    const probe = JSON.parse(probeBytes.toString("utf8")) as DenseProbeV1;
    if (probe.schema !== "editflow.dense-video-probe.v1"
      || probe.sourceId !== input.sourceId
      || probe.sourceKind !== input.sourceKind
      || probe.frames.length < 3) {
      throw new TypeError("Practice M6 dense video probe returned invalid correlated evidence.");
    }

    const denseEvidenceSourceSha256 = await sha256File(this.denseEvidenceSourcePath);
    const measurementDescriptor = {
      probeAlgorithmId: probe.analysis.algorithmId,
      probeAnalyzerFingerprint: probe.analysis.analyzerFingerprint,
      analysisLongestEdge: probe.analysis.longestEdge,
      denseEvidenceSourceSha256,
      runtimeAlgorithmId: "editflow.practice-m6-local-media.v1",
    };
    const analyzerFingerprint = createHash("sha256")
      .update(JSON.stringify(measurementDescriptor), "utf8")
      .digest("hex");

    const frames = [];
    for (const frame of probe.frames) {
      const png = PNG.sync.read(await readFile(frame.pngPath));
      frames.push({
        timeMs: frame.timeMs,
        width: png.width,
        height: png.height,
        rgba: Uint8Array.from(png.data),
        ...(frame.semantic === undefined ? {} : { semantic: frame.semantic }),
      });
    }

    const evidence = analyzeDenseEffectEvidenceV1({
      sourceId: input.sourceId,
      sourceKind: input.sourceKind,
      frames,
      settings: {
        expectedFps: probe.video.fps,
        requireEveryFrame: true,
        recoveryEnergyRatio: 0.25,
      },
      analyzerFingerprint,
      evidenceRefs: [
        "video:sha256:" + probe.sourceVideoSha256,
        "probe-json:sha256:" + sha256Bytes(probeBytes),
        "probe-algorithm:" + probe.analysis.algorithmId,
        "probe-analyzer:sha256:" + probe.analysis.analyzerFingerprint,
        "measurement-system:sha256:" + analyzerFingerprint,
        "algorithm:opencv-farneback-dual-affine-motion-comp-edge-autocorrelation",
      ],
    });
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
    return evidence;
  }

  async compareContentStructure(input: {
    readonly reference: PracticeReferenceAnalysisV1;
    readonly renderPath: string;
    readonly matches: readonly PracticeSceneMatchV1[];
  }): Promise<PracticeContentStructureEvaluationV1> {
    const referencePath = input.reference.sourcePath;
    const artifactPath = referenceArtifactPath(input.reference);
    if (referencePath === undefined || referencePath.trim().length === 0) {
      throw new TypeError("Practice content comparison requires the local Finish source path.");
    }
    if (artifactPath === null || !(await fileExists(artifactPath))) {
      throw new TypeError("Practice content comparison requires the retained reference analysis artifact.");
    }
    const renderPath = path.resolve(input.renderPath);
    if (!(await fileExists(renderPath))) {
      throw new TypeError("Practice content comparison render does not exist: " + renderPath);
    }

    const directory = path.join(this.artifactDir, "content-comparison");
    await mkdir(directory, { recursive: true });
    const renderDigest = (await sha256File(renderPath)).slice(0, 20);
    const outputPath = path.join(
      directory,
      safeStem(input.reference.referenceId) + "-" + renderDigest + ".json",
    );
    if (!(await fileExists(outputPath))) {
      await this.#runPython(this.practiceMediaScriptPath, [
        "compare-render",
        "--reference-json", artifactPath,
        "--reference-video", path.resolve(referencePath),
        "--render-video", renderPath,
        "--output", outputPath,
        "--cut-threshold", String(this.cutThreshold),
      ]);
    }

    const artifact = JSON.parse(
      await readFile(outputPath, "utf8"),
    ) as PracticeContentStructureArtifactV1;
    if (artifact.schema !== "editflow.practice-content-structure-evaluation.v1") {
      throw new TypeError("Practice content comparison returned an unsupported artifact.");
    }
    const matchedShotIds = new Set(input.matches.map((match) => match.shotId));
    const missingMatchCount = input.reference.shots.filter((shot) =>
      !matchedShotIds.has(shot.shotId)).length;
    return {
      sceneIdentity: finite01(artifact.breakdown.sceneIdentity, "sceneIdentity"),
      temporalAlignment: finite01(
        artifact.breakdown.temporalAlignment,
        "temporalAlignment",
      ),
      cutTiming: finite01(artifact.breakdown.cutTiming, "cutTiming"),
      framing: finite01(artifact.breakdown.framing, "framing"),
      motion: finite01(artifact.breakdown.motion, "motion"),
      colorFinish: finite01(artifact.breakdown.colorFinish, "colorFinish"),
      pixelStructure: finite01(artifact.breakdown.pixelStructure, "pixelStructure"),
      wrongSceneCount: Math.max(0, Math.trunc(artifact.wrongSceneCount)),
      unmatchedSceneCount: Math.max(
        missingMatchCount,
        Math.max(0, Math.trunc(artifact.unmatchedSceneCount)),
      ),
      evidenceRefs: [
        ...artifact.evidenceRefs,
        "practice-content-comparison-artifact:" + outputPath,
      ],
    };
  }
}

