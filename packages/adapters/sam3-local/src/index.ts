import { spawn } from "node:child_process";
import path from "node:path";

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
  readonly previousArtifact?: {
    readonly artifactId: string;
    readonly absolutePath: string;
    readonly evidenceIds: readonly string[];
  };
}

export interface SegmentationSourceResolverV1 {
  resolve(request: SubjectSegmentationRequestV1): Promise<SegmentationSourceMaterialV1 | null>;
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

export class NodeSam31SidecarRunnerV1 implements Sam31SidecarRunnerV1 {
  async run(input: Sam31SidecarInvocationV1): Promise<Sam31SidecarProcessResultV1> {
    return await new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const child = spawn(input.executablePath, [...input.args], {
        cwd: input.workingDirectory,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, input.timeoutMs);
      child.stdout.on("data", (chunk) => { try { stdout = appendBounded(stdout, chunk); } catch (error) { clearTimeout(timer); child.kill(); reject(error); } });
      child.stderr.on("data", (chunk) => { try { stderr = appendBounded(stderr, chunk); } catch (error) { clearTimeout(timer); child.kill(); reject(error); } });
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (code, signal) => { clearTimeout(timer); resolve({ exitCode: code, signal, stdout, stderr, timedOut }); });
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
const parseCompletedResult = (
  raw: string,
  request: SubjectSegmentationRequestV1,
  source: SegmentationSourceMaterialV1,
): AcceptedSubjectSegmentationV1 => {
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
  return accepted;
};
export class Sam31LocalSegmentationProviderV1 implements SubjectSegmentationProviderV1 {
  readonly providerId = SAM31_LOCAL_PROVIDER_ID;
  readonly config: Required<Omit<Sam31LocalSegmentationProviderConfigV1, "checkpointPath" | "timeoutMs" | "confidenceThreshold">> & {
    readonly checkpointPath: string | null;
    readonly timeoutMs: number;
    readonly confidenceThreshold: number;
  };
  readonly runner: Sam31SidecarRunnerV1;

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
  async segment(request: SubjectSegmentationRequestV1): Promise<SubjectSegmentationResultV1> {
    if (!validateSubjectSegmentationRequestV1(request)) return providerError("INVALID_SEGMENTATION_REQUEST", "SAM 3.1 provider received an invalid segmentation request.");
    if ((request.prompt?.positivePoints?.length ?? 0) > 0 || (request.prompt?.negativePoints?.length ?? 0) > 0) {
      return providerError("POINT_PROMPTS_UNSUPPORTED", "This SAM 3.1 provider tranche supports exact text and normalized box prompts; point-prompt execution is not yet registered.");
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
    const priorId = request.prompt?.previousArtifactId;
    if (priorId !== undefined) {
      const prior = source.previousArtifact;
      if (!prior || prior.artifactId !== priorId || !nonEmpty(prior.absolutePath) || !absolute(prior.absolutePath)) {
        return providerError("PREVIOUS_ARTIFACT_RESOLUTION_FAILED", "Requested temporal refinement artifact could not be resolved exactly.");
      }
      if (prior.evidenceIds.filter(nonEmpty).length === 0) return providerError("PREVIOUS_ARTIFACT_PROVENANCE_MISSING", "Resolved prior segmentation artifact has no provenance evidence.");
    }
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
    return parseCompletedResult(processResult.stdout, request, normalizedSource);
  }
}

export * from "./capability.js";
