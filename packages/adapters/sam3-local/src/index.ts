import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  acceptSubjectSegmentationResultV1,
  validateSubjectSegmentationRequestV1,
  type AcceptedSubjectSegmentationV1,
  type SubjectSegmentationProviderV1,
  type SubjectSegmentationRequestV1,
  type SubjectSegmentationResultV1,
} from "../../../tracking-state/src/index.js";

export const SAM31_LOCAL_PROVIDER_ID = "sam3.1.local";
export const SAM31_LOCAL_SIDECAR_SCHEMA = "editflow.segmentation.sam3.1.v1";

export interface SegmentationSourceMaterialV1 {
  readonly sourceId: string;
  readonly absolutePath: string;
  readonly contentType?: string;
  readonly evidenceIds: readonly string[];
}

export interface SegmentationSourceResolverV1 {
  resolve(request: SubjectSegmentationRequestV1): Promise<SegmentationSourceMaterialV1 | null>;
}

export interface VerifiedSegmentationArtifactMaterialV1 {
  readonly artifactId: string;
  readonly absolutePath: string;
  readonly contentType: string;
  readonly sha256: string;
  readonly requestId: string;
  readonly sourceId: string;
  readonly semanticId: string;
  readonly evidenceIds: readonly string[];
}

export interface Sam31SidecarInvocationV1 {
  readonly executablePath: string;
  readonly args: readonly string[];
  readonly workingDirectory: string;
  readonly timeoutMs: number;
}

export interface Sam31SidecarProcessResultV1 {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface Sam31SidecarRunnerV1 {
  run(input: Sam31SidecarInvocationV1): Promise<Sam31SidecarProcessResultV1>;
}

const absolute = (value: string): boolean => path.isAbsolute(value) || path.win32.isAbsolute(value);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
const appendBounded = (current: string, chunk: Buffer | string, limit = 1024 * 1024): string => {
  const next = current + String(chunk);
  if (Buffer.byteLength(next, "utf8") > limit) throw new Error("SAM31_SIDECAR_OUTPUT_LIMIT_EXCEEDED");
  return next;
};

const artifactPathInside = (artifactDirectory: string, artifactPath: string): boolean => {
  const root = path.resolve(artifactDirectory);
  const candidate = path.resolve(artifactPath);
  const relative = path.relative(root, candidate);
  return relative.length > 0
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
};

const sha256File = async (filePath: string): Promise<string> => await new Promise((resolve, reject) => {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  stream.on("error", reject);
  stream.on("data", (chunk) => hash.update(chunk));
  stream.on("end", () => resolve(hash.digest("hex")));
});

export class NodeSam31SidecarRunnerV1 implements Sam31SidecarRunnerV1 {
  async run(input: Sam31SidecarInvocationV1): Promise<Sam31SidecarProcessResultV1> {
    return await new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      const child = spawn(input.executablePath, [...input.args], {
        cwd: input.workingDirectory,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill();
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, input.timeoutMs);
      child.stdout.on("data", (chunk) => { try { stdout = appendBounded(stdout, chunk); } catch (error) { fail(error); } });
      child.stderr.on("data", (chunk) => { try { stderr = appendBounded(stderr, chunk); } catch (error) { fail(error); } });
      child.once("error", fail);
      child.once("close", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: code, signal, stdout, stderr, timedOut });
      });
    });
  }
}

export interface Sam31LocalSegmentationProviderConfigV1 {
  readonly executablePath: string;
  readonly scriptPath: string;
  readonly workingDirectory: string;
  readonly artifactDirectory: string;
  readonly sourceResolver: SegmentationSourceResolverV1;
  readonly checkpointPath?: string | null;
  readonly timeoutMs?: number;
  readonly confidenceThreshold?: number;
}

export class Sam31SegmentationProviderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "Sam31SegmentationProviderError";
    this.code = code;
  }
}

const providerError = (code: string, detail: string): never => {
  throw new Sam31SegmentationProviderError(code, detail);
};

const assertAbsolute = (name: string, value: string): void => {
  if (!nonEmpty(value) || !absolute(value)) throw new TypeError(`${name} must be a non-empty absolute path.`);
};

interface ParsedSam31CompletedResultV1 {
  readonly accepted: AcceptedSubjectSegmentationV1;
  readonly artifactPath: string;
}

const parseCompletedResult = (
  raw: string,
  request: SubjectSegmentationRequestV1,
  source: SegmentationSourceMaterialV1,
): ParsedSam31CompletedResultV1 => {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim()); }
  catch { return providerError("MALFORMED_SIDECAR_JSON", "SAM 3.1 sidecar returned malformed JSON."); }
  const root = record(parsed);
  if (!root) return providerError("MALFORMED_SIDECAR_RESULT", "SAM 3.1 sidecar returned a non-object result.");
  if (root["status"] !== "COMPLETED") {
    const code = nonEmpty(root["code"]) ? root["code"] : "SEGMENTATION_REFUSED";
    const detail = nonEmpty(root["detail"]) ? root["detail"] : "SAM 3.1 sidecar refused segmentation.";
    return providerError(code, detail);
  }
  const candidate = record(root["result"]);
  if (!candidate) return providerError("MISSING_SEGMENTATION_RESULT", "SAM 3.1 sidecar did not return a segmentation result.");
  const accepted = acceptSubjectSegmentationResultV1(request, candidate as unknown as SubjectSegmentationResultV1);
  if (!accepted) return providerError("INVALID_SEGMENTATION_RESULT", "SAM 3.1 result failed EditFlow segmentation correlation/validation.");
  if (accepted.providerId !== SAM31_LOCAL_PROVIDER_ID) return providerError("PROVIDER_ID_MISMATCH", "SAM 3.1 result provider identity did not match the configured adapter.");
  for (const evidenceId of source.evidenceIds) {
    if (!accepted.evidenceIds.includes(evidenceId)) return providerError("SOURCE_PROVENANCE_MISSING", "SAM 3.1 result omitted required source-resolution evidence.");
  }
  const artifactPath = root["artifactPath"];
  if (!nonEmpty(artifactPath) || !absolute(artifactPath)) {
    return providerError("ARTIFACT_PATH_MISSING", "SAM 3.1 sidecar did not return an absolute materialized artifact path.");
  }
  return { accepted, artifactPath };
};

export class Sam31LocalSegmentationProviderV1 implements SubjectSegmentationProviderV1 {
  readonly providerId = SAM31_LOCAL_PROVIDER_ID;
  readonly config: Required<Omit<Sam31LocalSegmentationProviderConfigV1, "checkpointPath" | "timeoutMs" | "confidenceThreshold">> & {
    readonly checkpointPath: string | null;
    readonly timeoutMs: number;
    readonly confidenceThreshold: number;
  };
  readonly runner: Sam31SidecarRunnerV1;
  readonly #verifiedArtifacts = new Map<string, VerifiedSegmentationArtifactMaterialV1>();

  constructor(config: Sam31LocalSegmentationProviderConfigV1, runner: Sam31SidecarRunnerV1 = new NodeSam31SidecarRunnerV1()) {
    assertAbsolute("executablePath", config.executablePath);
    assertAbsolute("scriptPath", config.scriptPath);
    assertAbsolute("workingDirectory", config.workingDirectory);
    assertAbsolute("artifactDirectory", config.artifactDirectory);
    if (config.checkpointPath) assertAbsolute("checkpointPath", config.checkpointPath);
    const timeoutMs = config.timeoutMs ?? 180000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) throw new RangeError("timeoutMs must be between 1000 and 600000 milliseconds.");
    const confidenceThreshold = config.confidenceThreshold ?? 0.5;
    if (!Number.isFinite(confidenceThreshold) || confidenceThreshold <= 0 || confidenceThreshold >= 1) throw new RangeError("confidenceThreshold must be between 0 and 1.");
    this.config = { ...config, checkpointPath: config.checkpointPath ?? null, timeoutMs, confidenceThreshold };
    this.runner = runner;
  }

  resolveArtifact(artifactId: string): VerifiedSegmentationArtifactMaterialV1 | null {
    if (!nonEmpty(artifactId)) return null;
    return this.#verifiedArtifacts.get(artifactId) ?? null;
  }

  async segment(request: SubjectSegmentationRequestV1): Promise<SubjectSegmentationResultV1> {
    if (!validateSubjectSegmentationRequestV1(request)) return providerError("INVALID_SEGMENTATION_REQUEST", "SAM 3.1 provider received an invalid segmentation request.");
    if ((request.prompt?.positivePoints?.length ?? 0) > 0 || (request.prompt?.negativePoints?.length ?? 0) > 0) {
      return providerError("POINT_PROMPTS_UNSUPPORTED", "This SAM 3.1 provider tranche supports exact text and normalized box prompts; point-prompt execution is not yet registered.");
    }
    if (request.prompt?.previousArtifactId !== undefined) {
      return providerError("TEMPORAL_REFINEMENT_UNSUPPORTED", "This image-only SAM 3.1 provider does not yet consume prior mask artifacts for temporal refinement; previousArtifactId is refused rather than treated as advisory evidence.");
    }
    if (!request.entityClass && !request.prompt?.boundingBox) {
      return providerError("SUBJECT_PROMPT_REQUIRED", "SAM 3.1 requires an explicit entityClass text prompt or a normalized subject bounding box.");
    }
    const source = await this.config.sourceResolver.resolve(request);
    if (!source || source.sourceId !== request.sourceId || !nonEmpty(source.absolutePath) || !absolute(source.absolutePath)) {
      return providerError("SOURCE_RESOLUTION_FAILED", "Segmentation source identity could not be resolved to an exact absolute local resource.");
    }
    const sourceEvidence = [...new Set(source.evidenceIds.filter(nonEmpty))];
    if (sourceEvidence.length === 0) return providerError("SOURCE_PROVENANCE_MISSING", "Resolved segmentation source has no retained provenance evidence.");
    const normalizedSource: SegmentationSourceMaterialV1 = { ...source, evidenceIds: sourceEvidence };
    const payload = JSON.stringify({
      schema: SAM31_LOCAL_SIDECAR_SCHEMA,
      request,
      source: normalizedSource,
      artifactDirectory: this.config.artifactDirectory,
      checkpointPath: this.config.checkpointPath,
      confidenceThreshold: this.config.confidenceThreshold,
    });
    let processResult: Sam31SidecarProcessResultV1;
    try {
      processResult = await this.runner.run({
        executablePath: this.config.executablePath,
        args: [this.config.scriptPath, "--request-json", payload],
        workingDirectory: this.config.workingDirectory,
        timeoutMs: this.config.timeoutMs,
      });
    } catch (error) {
      return providerError("SIDECAR_LAUNCH_FAILED", `SAM 3.1 sidecar failed to launch: ${String(error)}`);
    }
    if (processResult.timedOut) return providerError("SIDECAR_TIMEOUT", "SAM 3.1 sidecar timed out.");
    if (processResult.exitCode !== 0) {
      return providerError("SIDECAR_PROCESS_FAILED", processResult.stderr.trim() || processResult.stdout.trim() || `SAM 3.1 sidecar exited with code ${String(processResult.exitCode)}.`);
    }

    const parsed = parseCompletedResult(processResult.stdout, request, normalizedSource);
    if (!artifactPathInside(this.config.artifactDirectory, parsed.artifactPath)) {
      return providerError("ARTIFACT_PATH_ESCAPE", "SAM 3.1 materialized artifact escaped the configured artifact directory.");
    }
    let artifactStats;
    try { artifactStats = await stat(parsed.artifactPath); }
    catch { return providerError("ARTIFACT_NOT_FOUND", "SAM 3.1 materialized artifact does not exist at the returned path."); }
    if (!artifactStats.isFile()) return providerError("ARTIFACT_NOT_FILE", "SAM 3.1 materialized artifact path is not a file.");
    const expectedSha256 = parsed.accepted.mask.artifact.sha256;
    if (!expectedSha256) return providerError("ARTIFACT_SHA256_REQUIRED", "SAM 3.1 local artifacts require exact SHA-256 integrity evidence.");
    const actualSha256 = await sha256File(parsed.artifactPath);
    if (actualSha256 !== expectedSha256) return providerError("ARTIFACT_SHA256_MISMATCH", "SAM 3.1 materialized artifact bytes do not match the accepted result digest.");

    this.#verifiedArtifacts.set(parsed.accepted.mask.artifact.artifactId, {
      artifactId: parsed.accepted.mask.artifact.artifactId,
      absolutePath: parsed.artifactPath,
      contentType: parsed.accepted.mask.artifact.contentType,
      sha256: actualSha256,
      requestId: parsed.accepted.requestId,
      sourceId: parsed.accepted.sourceId,
      semanticId: parsed.accepted.semanticId,
      evidenceIds: parsed.accepted.evidenceIds,
    });
    return parsed.accepted;
  }
}

export * from "./sequence.js";
