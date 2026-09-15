import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  acceptSubjectSegmentationSequenceResultV1,
  validateSubjectSegmentationSequenceRequestV1,
  type AcceptedSubjectSegmentationSequenceV1,
  type SubjectSegmentationSequenceProviderV1,
  type SubjectSegmentationSequenceRequestV1,
  type SubjectSegmentationSequenceResultV1,
} from "../../../tracking-state/src/index.js";

export const SAM31_LOCAL_SEQUENCE_PROVIDER_ID = "sam3.1.local";
export const SAM31_LOCAL_SEQUENCE_SIDECAR_SCHEMA = "editflow.segmentation.sam3.1.sequence.v1";

export interface SegmentationSequenceSourceMaterialV1 {
  readonly sourceId: string;
  readonly absolutePath: string;
  readonly contentType?: string;
  readonly evidenceIds: readonly string[];
}

export interface SegmentationSequenceSourceResolverV1 {
  resolve(request: SubjectSegmentationSequenceRequestV1): Promise<SegmentationSequenceSourceMaterialV1 | null>;
}
export interface VerifiedSegmentationSequenceFrameMaterialV1 {
  readonly frameIndex: number;
  readonly artifactId: string;
  readonly absolutePath: string;
  readonly contentType: string;
  readonly sha256: string;
  readonly evidenceIds: readonly string[];
}

export interface VerifiedSegmentationSequenceMaterialV1 {
  readonly requestId: string;
  readonly sourceId: string;
  readonly semanticId: string;
  readonly frameRate: number;
  readonly frameCount: number;
  readonly frames: readonly VerifiedSegmentationSequenceFrameMaterialV1[];
  readonly evidenceIds: readonly string[];
}

export interface Sam31SequenceSidecarInvocationV1 {
  readonly executablePath: string;
  readonly args: readonly string[];
  readonly workingDirectory: string;
  readonly timeoutMs: number;
}

export interface Sam31SequenceSidecarProcessResultV1 {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}
export interface Sam31SequenceSidecarRunnerV1 {
  run(input: Sam31SequenceSidecarInvocationV1): Promise<Sam31SequenceSidecarProcessResultV1>;
}

const appendBounded = (current: string, chunk: Buffer | string, limit = 16 * 1024 * 1024): string => {
  const next = current + String(chunk);
  if (Buffer.byteLength(next, "utf8") > limit) throw new Error("SAM31_SEQUENCE_SIDECAR_OUTPUT_LIMIT_EXCEEDED");
  return next;
};

export class NodeSam31SequenceSidecarRunnerV1 implements Sam31SequenceSidecarRunnerV1 {
  async run(input: Sam31SequenceSidecarInvocationV1): Promise<Sam31SequenceSidecarProcessResultV1> {
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

export interface Sam31LocalSegmentationSequenceProviderConfigV1 {
  readonly executablePath: string;
  readonly scriptPath: string;
  readonly workingDirectory: string;
  readonly artifactDirectory: string;
  readonly sourceResolver: SegmentationSequenceSourceResolverV1;
  readonly checkpointPath?: string | null;
  readonly timeoutMs?: number;
  readonly confidenceThreshold?: number;
}

export class Sam31SegmentationSequenceProviderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "Sam31SegmentationSequenceProviderError";
    this.code = code;
  }
}
const absolute = (value: string): boolean => path.isAbsolute(value) || path.win32.isAbsolute(value);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
const providerError = (code: string, detail: string): never => {
  throw new Sam31SegmentationSequenceProviderError(code, detail);
};
const assertAbsolute = (name: string, value: string): void => {
  if (!nonEmpty(value) || !absolute(value)) throw new TypeError(`${name} must be a non-empty absolute path.`);
};
const artifactPathInside = (artifactDirectory: string, artifactPath: string): boolean => {
  const root = path.resolve(artifactDirectory);
  const candidate = path.resolve(artifactPath);
  const relative = path.relative(root, candidate);
  return relative.length > 0 && relative !== ".."
    && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const sha256File = async (filePath: string): Promise<string> => await new Promise((resolve, reject) => {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  stream.on("error", reject);
  stream.on("data", (chunk) => hash.update(chunk));
  stream.on("end", () => resolve(hash.digest("hex")));
});

interface ParsedSequenceResultV1 {
  readonly accepted: AcceptedSubjectSegmentationSequenceV1;
  readonly artifactPaths: readonly string[];
}
const parseCompletedSequenceResult = (
  raw: string,
  request: SubjectSegmentationSequenceRequestV1,
  source: SegmentationSequenceSourceMaterialV1,
): ParsedSequenceResultV1 => {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim()); }
  catch { return providerError("MALFORMED_SEQUENCE_SIDECAR_JSON", "SAM 3.1 sequence sidecar returned malformed JSON."); }
  const root = record(parsed);
  if (!root) return providerError("MALFORMED_SEQUENCE_SIDECAR_RESULT", "SAM 3.1 sequence sidecar returned a non-object result.");
  if (root["status"] !== "COMPLETED") {
    const code = nonEmpty(root["code"]) ? root["code"] : "SEQUENCE_SEGMENTATION_REFUSED";
    const detail = nonEmpty(root["detail"]) ? root["detail"] : "SAM 3.1 sequence sidecar refused segmentation.";
    return providerError(code, detail);
  }
  const candidate = record(root["result"]);
  if (!candidate) return providerError("MISSING_SEQUENCE_SEGMENTATION_RESULT", "SAM 3.1 sequence sidecar did not return a segmentation result.");
  const accepted = acceptSubjectSegmentationSequenceResultV1(request, candidate as unknown as SubjectSegmentationSequenceResultV1);
  if (!accepted) return providerError("INVALID_SEQUENCE_SEGMENTATION_RESULT", "SAM 3.1 sequence result failed EditFlow temporal correlation/validation.");
  if (accepted.providerId !== SAM31_LOCAL_SEQUENCE_PROVIDER_ID) return providerError("PROVIDER_ID_MISMATCH", "SAM 3.1 sequence result provider identity did not match the configured adapter.");
  for (const evidenceId of source.evidenceIds) {
    if (!accepted.evidenceIds.includes(evidenceId)) return providerError("SOURCE_PROVENANCE_MISSING", "SAM 3.1 sequence result omitted required source-resolution evidence.");
  }
  if (!Array.isArray(root["artifactFrames"]) || root["artifactFrames"].length !== request.frameCount) {
    return providerError("ARTIFACT_FRAME_COUNT_MISMATCH", "SAM 3.1 sequence sidecar artifact frame count did not match the accepted result.");
  }
  const artifactPaths: string[] = [];
  for (let index = 0; index < root["artifactFrames"].length; index += 1) {
    const frame = record(root["artifactFrames"][index]);
    if (!frame || frame["frameIndex"] !== index) {
      return providerError("ARTIFACT_FRAME_INDEX_MISMATCH", "SAM 3.1 sequence sidecar artifact frames were not contiguous and ordered.");
    }
    const artifactPath = frame["artifactPath"];
    if (!nonEmpty(artifactPath) || !absolute(artifactPath)) {
      return providerError("ARTIFACT_PATH_MISSING", "SAM 3.1 sequence sidecar returned a missing or non-absolute artifact path.");
    }
    artifactPaths.push(artifactPath);
  }
  return { accepted, artifactPaths };
};

export class Sam31LocalSegmentationSequenceProviderV1 implements SubjectSegmentationSequenceProviderV1 {
  readonly providerId = SAM31_LOCAL_SEQUENCE_PROVIDER_ID;
  readonly config: Required<Omit<Sam31LocalSegmentationSequenceProviderConfigV1, "checkpointPath" | "timeoutMs" | "confidenceThreshold">> & {
    readonly checkpointPath: string | null;
    readonly timeoutMs: number;
    readonly confidenceThreshold: number;
  };
  readonly runner: Sam31SequenceSidecarRunnerV1;
  readonly #verifiedSequences = new Map<string, VerifiedSegmentationSequenceMaterialV1>();

  constructor(
    config: Sam31LocalSegmentationSequenceProviderConfigV1,
    runner: Sam31SequenceSidecarRunnerV1 = new NodeSam31SequenceSidecarRunnerV1(),
  ) {
    assertAbsolute("executablePath", config.executablePath);
    assertAbsolute("scriptPath", config.scriptPath);
    assertAbsolute("workingDirectory", config.workingDirectory);
    assertAbsolute("artifactDirectory", config.artifactDirectory);
    if (config.checkpointPath) assertAbsolute("checkpointPath", config.checkpointPath);
    const timeoutMs = config.timeoutMs ?? 600000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 1800000) {
      throw new RangeError("timeoutMs must be between 1000 and 1800000 milliseconds.");
    }
    const confidenceThreshold = config.confidenceThreshold ?? 0.5;
    if (!Number.isFinite(confidenceThreshold) || confidenceThreshold <= 0 || confidenceThreshold >= 1) {
      throw new RangeError("confidenceThreshold must be between 0 and 1.");
    }
    this.config = { ...config, checkpointPath: config.checkpointPath ?? null, timeoutMs, confidenceThreshold };
    this.runner = runner;
  }

  resolveSequence(requestId: string): VerifiedSegmentationSequenceMaterialV1 | null {
    if (!nonEmpty(requestId)) return null;
    return this.#verifiedSequences.get(requestId) ?? null;
  }

  async segmentSequence(request: SubjectSegmentationSequenceRequestV1): Promise<SubjectSegmentationSequenceResultV1> {
    if (!validateSubjectSegmentationSequenceRequestV1(request)) {
      return providerError("INVALID_SEGMENTATION_SEQUENCE_REQUEST", "SAM 3.1 temporal provider received an invalid segmentation sequence request.");
    }
    if (request.prompt?.previousArtifactId !== undefined) {
      return providerError("TEMPORAL_ARTIFACT_REFINEMENT_UNSUPPORTED", "SAM 3.1 temporal provider does not bind previousArtifactId into the native video session yet.");
    }
    const hasPositivePoint = (request.prompt?.positivePoints?.length ?? 0) > 0;
    if (!request.entityClass && !request.prompt?.boundingBox) {
      if (hasPositivePoint) {
        return providerError("POINT_ONLY_TEMPORAL_PROMPT_UNSUPPORTED", "SAM 3.1 multiplex temporal propagation requires a semantic text or normalized box seed; points may disambiguate that semantic result but are not a validated fresh temporal seed path.");
      }
      return providerError("SUBJECT_PROMPT_REQUIRED", "SAM 3.1 temporal segmentation requires semantic text or a normalized subject box.");
    }
    const source = await this.config.sourceResolver.resolve(request);
    if (!source || source.sourceId !== request.sourceId || !nonEmpty(source.absolutePath) || !absolute(source.absolutePath)) {
      return providerError("SOURCE_RESOLUTION_FAILED", "Temporal segmentation source identity could not be resolved to an exact absolute local resource.");
    }
    const sourceEvidence = [...new Set(source.evidenceIds.filter(nonEmpty))];
    if (sourceEvidence.length === 0) return providerError("SOURCE_PROVENANCE_MISSING", "Resolved temporal segmentation source has no retained provenance evidence.");
    const normalizedSource: SegmentationSequenceSourceMaterialV1 = { ...source, evidenceIds: sourceEvidence };
    const payload = JSON.stringify({
      schema: SAM31_LOCAL_SEQUENCE_SIDECAR_SCHEMA,
      request,
      source: normalizedSource,
      artifactDirectory: this.config.artifactDirectory,
      checkpointPath: this.config.checkpointPath,
      confidenceThreshold: this.config.confidenceThreshold,
    });

    let processResult: Sam31SequenceSidecarProcessResultV1;
    try {
      processResult = await this.runner.run({
        executablePath: this.config.executablePath,
        args: [this.config.scriptPath, "--request-json", payload],
        workingDirectory: this.config.workingDirectory,
        timeoutMs: this.config.timeoutMs,
      });
    } catch (error) {
      return providerError("SIDECAR_LAUNCH_FAILED", `SAM 3.1 temporal sidecar failed to launch: ${String(error)}`);
    }
    if (processResult.timedOut) return providerError("SIDECAR_TIMEOUT", "SAM 3.1 temporal sidecar timed out.");
    if (processResult.exitCode !== 0) {
      return providerError(
        "SIDECAR_PROCESS_FAILED",
        processResult.stderr.trim() || processResult.stdout.trim() || `SAM 3.1 temporal sidecar exited with code ${String(processResult.exitCode)}.`,
      );
    }

    const parsed = parseCompletedSequenceResult(processResult.stdout, request, normalizedSource);
    const verifiedFrames: VerifiedSegmentationSequenceFrameMaterialV1[] = [];
    const seenPaths = new Set<string>();
    for (let index = 0; index < parsed.artifactPaths.length; index += 1) {
      const artifactPath = parsed.artifactPaths[index]!;
      const acceptedFrame = parsed.accepted.frames[index]!;
      if (!artifactPathInside(this.config.artifactDirectory, artifactPath)) {
        return providerError("ARTIFACT_PATH_ESCAPE", "SAM 3.1 temporal artifact escaped the configured artifact directory.");
      }
      const normalizedPath = path.resolve(artifactPath).toLowerCase();
      if (seenPaths.has(normalizedPath)) return providerError("ARTIFACT_PATH_DUPLICATE", "SAM 3.1 temporal result reused one file for multiple frames.");
      seenPaths.add(normalizedPath);
      let artifactStats;
      try { artifactStats = await stat(artifactPath); }
      catch { return providerError("ARTIFACT_NOT_FOUND", `SAM 3.1 temporal artifact ${index} does not exist at the returned path.`); }
      if (!artifactStats.isFile()) return providerError("ARTIFACT_NOT_FILE", `SAM 3.1 temporal artifact ${index} is not a file.`);
      const expectedSha256 = acceptedFrame.mask.artifact.sha256;
      if (!expectedSha256) return providerError("ARTIFACT_SHA256_REQUIRED", `SAM 3.1 temporal artifact ${index} is missing exact SHA-256 evidence.`);
      const actualSha256 = await sha256File(artifactPath);
      if (actualSha256 !== expectedSha256) return providerError("ARTIFACT_SHA256_MISMATCH", `SAM 3.1 temporal artifact ${index} bytes do not match the accepted result digest.`);
      verifiedFrames.push({
        frameIndex: index,
        artifactId: acceptedFrame.mask.artifact.artifactId,
        absolutePath: artifactPath,
        contentType: acceptedFrame.mask.artifact.contentType,
        sha256: actualSha256,
        evidenceIds: acceptedFrame.evidenceIds,
      });
    }

    const verified: VerifiedSegmentationSequenceMaterialV1 = {
      requestId: parsed.accepted.requestId,
      sourceId: parsed.accepted.sourceId,
      semanticId: parsed.accepted.semanticId,
      frameRate: parsed.accepted.frameRate,
      frameCount: parsed.accepted.frameCount,
      frames: verifiedFrames,
      evidenceIds: parsed.accepted.evidenceIds,
    };
    this.#verifiedSequences.set(parsed.accepted.requestId, verified);
    return parsed.accepted;
  }
}
