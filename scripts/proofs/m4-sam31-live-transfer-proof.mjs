import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SAM31_LOCAL_SEQUENCE_PROVIDER_ID,
  SAM31_LOCAL_SEQUENCE_SIDECAR_SCHEMA,
  Sam31LocalSegmentationSequenceProviderV1,
} from "../../.tmp/runtime/packages/adapters/sam3-local/src/index.js";

export const M4_SAM31_LIVE_PROOF_CONFIG_SCHEMA = "editflow.m4.sam31-live-transfer-proof.config.v1";
export const M4_SAM31_LIVE_PROOF_SCHEMA = "editflow.m4.sam31-live-transfer-proof.v1";
export const M4_SEGMENTATION_RUNTIME_EVIDENCE_SCHEMA = "editflow.m4.segmentation-runtime-evidence.v1";
const MODEL_EVIDENCE = "SAM31_MODEL:facebook/sam3.1";
const CHECKPOINT_EVIDENCE = "SAM31_CHECKPOINT:LOCAL_EXPLICIT";
const TEMPORAL_EVIDENCE = "SAM31_TEMPORAL:VIDEO_SESSION_PROPAGATION";
const LOWER_SHA256 = /^[0-9a-f]{64}$/;
const EVIDENCE_ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{2,127}$/;

const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
const absolute = (value) => nonEmpty(value) && (path.isAbsolute(value) || path.win32.isAbsolute(value));
const finite01 = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const safeName = (value) => value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
const sha256Bytes = (value) => createHash("sha256").update(value).digest("hex");
const sha256File = async (filePath) => await new Promise((resolve, reject) => {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  stream.on("error", reject);
  stream.on("data", (chunk) => hash.update(chunk));
  stream.on("end", () => resolve(hash.digest("hex")));
});
const requireFile = async (name, filePath) => {
  if (!absolute(filePath)) throw new TypeError(`${name} must be an absolute path.`);
  let info;
  try { info = await stat(filePath); }
  catch { throw new Error(`${name} does not exist: ${filePath}`); }
  if (!info.isFile()) throw new Error(`${name} must identify a file: ${filePath}`);
};
const requireDirectory = async (name, directoryPath) => {
  if (!absolute(directoryPath)) throw new TypeError(`${name} must be an absolute path.`);
  let info;
  try { info = await stat(directoryPath); }
  catch { throw new Error(`${name} does not exist: ${directoryPath}`); }
  if (!info.isDirectory()) throw new Error(`${name} must identify a directory: ${directoryPath}`);
};
const validBox = (box) => Array.isArray(box) && box.length === 4 && box.every(finite01)
  && box[2] > 0 && box[3] > 0 && box[0] + box[2] <= 1 + Number.EPSILON
  && box[1] + box[3] <= 1 + Number.EPSILON;
const validPoints = (points) => points === undefined || (Array.isArray(points)
  && points.every((point) => point && typeof point === "object" && finite01(point.x) && finite01(point.y)));
const validateFixtureShape = (fixture, index) => {
  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) throw new TypeError(`fixtures[${index}] must be an object.`);
  for (const key of ["fixtureId", "sourceId", "semanticId"]) {
    if (!nonEmpty(fixture[key])) throw new TypeError(`fixtures[${index}].${key} must be non-empty.`);
  }
  if (!absolute(fixture.sourcePath)) throw new TypeError(`fixtures[${index}].sourcePath must be absolute.`);
  if (fixture.entityClass !== undefined && !nonEmpty(fixture.entityClass)) throw new TypeError(`fixtures[${index}].entityClass must be non-empty.`);
  if (!Number.isInteger(fixture.startFrameIndex) || fixture.startFrameIndex < 0) throw new TypeError(`fixtures[${index}].startFrameIndex must be a non-negative integer.`);
  if (typeof fixture.frameRate !== "number" || !Number.isFinite(fixture.frameRate) || fixture.frameRate <= 0 || fixture.frameRate > 240) throw new TypeError(`fixtures[${index}].frameRate must be in (0, 240].`);
  if (!Number.isInteger(fixture.frameCount) || fixture.frameCount < 2 || fixture.frameCount > 120) throw new TypeError(`fixtures[${index}].frameCount must be between 2 and 120.`);
  if (!Number.isInteger(fixture.promptFrameIndex) || fixture.promptFrameIndex < 0 || fixture.promptFrameIndex >= fixture.frameCount) throw new TypeError(`fixtures[${index}].promptFrameIndex is outside the requested sequence.`);
  if (fixture.boundingBox !== undefined && !validBox(fixture.boundingBox)) throw new TypeError(`fixtures[${index}].boundingBox is invalid.`);
  if (!validPoints(fixture.positivePoints) || !validPoints(fixture.negativePoints)) throw new TypeError(`fixtures[${index}] contains invalid point prompts.`);
  if (!fixture.entityClass && !fixture.boundingBox && !(fixture.positivePoints?.length > 0)) throw new TypeError(`fixtures[${index}] needs entityClass, boundingBox, or a positive point.`);
};

export const validateLiveProofConfig = async (config) => {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new TypeError("proof config must be an object.");
  if (config.schema !== M4_SAM31_LIVE_PROOF_CONFIG_SCHEMA) throw new TypeError("proof config schema mismatch.");
  if (!EVIDENCE_ID.test(config.evidenceId ?? "")) throw new TypeError("evidenceId is invalid.");
  for (const key of ["pythonPath", "sidecarPath", "workingDirectory", "artifactDirectory", "checkpointPath", "samSourceDirectory", "proofOutputPath", "runtimeEvidencePath"]) {
    if (!absolute(config[key])) throw new TypeError(`${key} must be an absolute path.`);
  }
  await requireFile("pythonPath", config.pythonPath);
  await requireFile("sidecarPath", config.sidecarPath);
  await requireFile("checkpointPath", config.checkpointPath);
  await requireDirectory("workingDirectory", config.workingDirectory);
  await requireDirectory("samSourceDirectory", config.samSourceDirectory);
  if (!Array.isArray(config.fixtures) || config.fixtures.length < 2) throw new TypeError("At least two fixtures are required.");
  config.fixtures.forEach(validateFixtureShape);
  const fixtureIds = new Set(config.fixtures.map((fixture) => fixture.fixtureId));
  const sourceIds = new Set(config.fixtures.map((fixture) => fixture.sourceId));
  const sourcePaths = new Set(config.fixtures.map((fixture) => path.resolve(fixture.sourcePath).toLowerCase()));
  if (fixtureIds.size !== config.fixtures.length) throw new TypeError("fixtureId values must be unique.");
  if (sourceIds.size !== config.fixtures.length) throw new TypeError("sourceId values must be unique.");
  if (sourcePaths.size !== config.fixtures.length) throw new TypeError("sourcePath values must identify distinct files.");
  for (let index = 0; index < config.fixtures.length; index += 1) {
    await requireFile(`fixtures[${index}].sourcePath`, config.fixtures[index].sourcePath);
  }
  const timeoutMs = config.timeoutMs ?? 900000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 1800000) throw new RangeError("timeoutMs must be between 1000 and 1800000.");
  const confidenceThreshold = config.confidenceThreshold ?? 0.5;
  if (!Number.isFinite(confidenceThreshold) || confidenceThreshold <= 0 || confidenceThreshold >= 1) throw new RangeError("confidenceThreshold must be between 0 and 1.");
  if (path.resolve(config.proofOutputPath).toLowerCase() === path.resolve(config.runtimeEvidencePath).toLowerCase()) throw new TypeError("proofOutputPath and runtimeEvidencePath must differ.");
  return { ...config, timeoutMs, confidenceThreshold };
};
const buildPrompt = (fixture) => {
  const prompt = {};
  if (fixture.boundingBox !== undefined) prompt.boundingBox = fixture.boundingBox;
  if (fixture.positivePoints !== undefined) prompt.positivePoints = fixture.positivePoints;
  if (fixture.negativePoints !== undefined) prompt.negativePoints = fixture.negativePoints;
  return Object.keys(prompt).length > 0 ? prompt : undefined;
};
const buildRequest = (fixture, sourceSha256) => ({
  requestId: `M4_SAM31_LIVE_${safeName(fixture.fixtureId)}_${sourceSha256.slice(0, 12)}`,
  sourceId: fixture.sourceId,
  semanticId: fixture.semanticId,
  ...(fixture.entityClass ? { entityClass: fixture.entityClass } : {}),
  startTimestampMs: fixture.startFrameIndex * 1000 / fixture.frameRate,
  startFrameIndex: fixture.startFrameIndex,
  frameRate: fixture.frameRate,
  frameCount: fixture.frameCount,
  promptFrameIndex: fixture.promptFrameIndex,
  ...(buildPrompt(fixture) ? { prompt: buildPrompt(fixture) } : {}),
  preferredEncoding: "ALPHA",
});
const requiredRuntimeEvidence = (result) => {
  const ids = new Set(result.evidenceIds ?? []);
  return result.providerId === SAM31_LOCAL_SEQUENCE_PROVIDER_ID
    && nonEmpty(result.providerVersion) && result.providerVersion.startsWith("sam3.1:")
    && ids.has(MODEL_EVIDENCE) && ids.has(CHECKPOINT_EVIDENCE) && ids.has(TEMPORAL_EVIDENCE);
};
const defaultProviderFactory = ({ config, sourceMaterial, artifactDirectory }) => new Sam31LocalSegmentationSequenceProviderV1({
  executablePath: config.pythonPath,
  scriptPath: config.sidecarPath,
  workingDirectory: config.workingDirectory,
  artifactDirectory,
  checkpointPath: config.checkpointPath,
  timeoutMs: config.timeoutMs,
  confidenceThreshold: config.confidenceThreshold,
  sourceResolver: {
    resolve: async (request) => request.sourceId === sourceMaterial.sourceId ? sourceMaterial : null,
  },
});
const defaultSamCommitResolver = (directory) => execFileSync("git", ["-C", directory, "rev-parse", "HEAD"], {
  encoding: "utf8",
  windowsHide: true,
}).trim();

const verifyResolvedSequence = async (verified, hashFile = sha256File) => {
  if (!verified || !Array.isArray(verified.frames) || verified.frames.length !== verified.frameCount) {
    throw new Error("VERIFIED_SEQUENCE_MISSING");
  }
  const frames = [];
  for (const frame of verified.frames) {
    const actualSha256 = await hashFile(frame.absolutePath);
    if (!LOWER_SHA256.test(frame.sha256) || actualSha256 !== frame.sha256) throw new Error("VERIFIED_FRAME_DIGEST_MISMATCH");
    frames.push({ frameIndex: frame.frameIndex, artifactId: frame.artifactId, sha256: actualSha256 });
  }
  return frames;
};
export const runSam31LiveTransferProof = async (inputConfig, dependencies = {}) => {
  const config = await validateLiveProofConfig(inputConfig);
  const hashFile = dependencies.hashFile ?? sha256File;
  const providerFactory = dependencies.providerFactory ?? defaultProviderFactory;
  const resolveSamCommit = dependencies.samCommitResolver ?? defaultSamCommitResolver;
  const now = dependencies.now ?? (() => new Date());
  await mkdir(config.artifactDirectory, { recursive: true });
  await mkdir(path.dirname(config.proofOutputPath), { recursive: true });
  await mkdir(path.dirname(config.runtimeEvidencePath), { recursive: true });

  const checkpointSha256 = await hashFile(config.checkpointPath);
  if (!LOWER_SHA256.test(checkpointSha256)) throw new Error("CHECKPOINT_DIGEST_INVALID");
  const samSourceCommit = resolveSamCommit(config.samSourceDirectory);
  if (!nonEmpty(samSourceCommit)) throw new Error("SAM_SOURCE_COMMIT_UNAVAILABLE");
  const fixtureInputs = [];
  for (const fixture of config.fixtures) {
    fixtureInputs.push({ fixture, sourceSha256: await hashFile(fixture.sourcePath) });
  }
  if (new Set(fixtureInputs.map((item) => item.sourceSha256)).size !== fixtureInputs.length) {
    throw new Error("MATERIALLY_DIFFERENT_SOURCE_BYTES_REQUIRED");
  }
  const fixtureSummaries = [];

  for (const { fixture, sourceSha256 } of fixtureInputs) {
    const request = buildRequest(fixture, sourceSha256);
    const artifactDirectory = path.join(config.artifactDirectory, safeName(fixture.fixtureId));
    await mkdir(artifactDirectory, { recursive: true });
    const sourceMaterial = {
      sourceId: fixture.sourceId,
      absolutePath: fixture.sourcePath,
      contentType: fixture.contentType ?? "video/mp4",
      evidenceIds: [`SOURCE_FIXTURE:${fixture.fixtureId}`, `SOURCE_SHA256:${sourceSha256}`],
    };
    const provider = providerFactory({ config, fixture, request, sourceMaterial, artifactDirectory });
    const result = await provider.segmentSequence(request);
    if (result.requestId !== request.requestId || result.sourceId !== request.sourceId
      || result.semanticId !== request.semanticId || result.frameCount !== request.frameCount) {
      throw new Error(`EXACT_CORRELATION_FAILED:${fixture.fixtureId}`);
    }
    if (!requiredRuntimeEvidence(result)) throw new Error(`HIDDEN_FALLBACK_OR_PROVENANCE_MISSING:${fixture.fixtureId}`);
    const verified = provider.resolveSequence(request.requestId);
    if (!verified || verified.requestId !== request.requestId || verified.sourceId !== request.sourceId
      || verified.semanticId !== request.semanticId || verified.frameCount !== request.frameCount) {
      throw new Error(`VERIFIED_SEQUENCE_CORRELATION_FAILED:${fixture.fixtureId}`);
    }
    const frames = await verifyResolvedSequence(verified, hashFile);
    const maskSequenceManifest = frames.map((frame) => ({ frameIndex: frame.frameIndex, sha256: frame.sha256 }));
    const sequenceSha256 = sha256Bytes(Buffer.from(JSON.stringify(maskSequenceManifest), "utf8"));
    fixtureSummaries.push({
      fixtureId: fixture.fixtureId,
      sourceId: fixture.sourceId,
      semanticId: fixture.semanticId,
      sourcePath: fixture.sourcePath,
      sourceSha256,
      request,
      providerId: result.providerId,
      providerVersion: result.providerVersion,
      evidenceIds: result.evidenceIds,
      frames,
      sequenceSha256,
    });
  }



  if (new Set(fixtureSummaries.map((item) => item.sequenceSha256)).size < 2) {
    throw new Error("MATERIALLY_DIFFERENT_SEQUENCE_OUTPUT_REQUIRED");
  }
  const resultManifest = fixtureSummaries.map((item) => ({
    fixtureId: item.fixtureId,
    sourceId: item.sourceId,
    semanticId: item.semanticId,
    sourceSha256: item.sourceSha256,
    providerVersion: item.providerVersion,
    frameSha256: item.frames.map((frame) => frame.sha256),
    sequenceSha256: item.sequenceSha256,
  }));
  const resultSha256 = sha256Bytes(Buffer.from(JSON.stringify(resultManifest), "utf8"));
  const generatedAt = now().toISOString();
  const proof = {
    schema: M4_SAM31_LIVE_PROOF_SCHEMA,
    generatedAt,
    classification: "LIVE_ACCEPTANCE",
    evidenceId: config.evidenceId,
    providerId: SAM31_LOCAL_SEQUENCE_PROVIDER_ID,
    sidecarSchema: SAM31_LOCAL_SEQUENCE_SIDECAR_SCHEMA,
    modelFamily: "sam3.1",
    samSource: { directory: config.samSourceDirectory, commit: samSourceCommit },
    checkpoint: { path: config.checkpointPath, sha256: checkpointSha256 },
    resultSha256,
    sourceFixtureCount: fixtureSummaries.length,
    fixtures: fixtureSummaries,
    gates: {
      liveInferenceAccepted: true,
      exactCorrelationAccepted: true,
      perFrameSha256Accepted: true,
      materiallyDifferentTransferAccepted: true,
      noHiddenFallbackAccepted: true,
    },
    afterEffects: {
      controlActionsIssued: 0,
      projectMutationRequested: false,
      note: "This proof harness has no After Effects control dependency or mutation path.",
    },
  };

  const runtimeEvidence = {
    schema: M4_SEGMENTATION_RUNTIME_EVIDENCE_SCHEMA,
    providerId: SAM31_LOCAL_SEQUENCE_PROVIDER_ID,
    sidecarSchema: SAM31_LOCAL_SEQUENCE_SIDECAR_SCHEMA,
    modelFamily: "sam3.1",
    evidenceId: config.evidenceId,
    checkpointSha256,
    resultSha256,
    sourceFixtureCount: fixtureSummaries.length,
    liveInferenceAccepted: true,
    exactCorrelationAccepted: true,
    perFrameSha256Accepted: true,
    materiallyDifferentTransferAccepted: true,
    noHiddenFallbackAccepted: true,
  };
  const proofBytes = Buffer.from(`${JSON.stringify(proof, null, 2)}\n`, "utf8");
  const evidenceBytes = Buffer.from(JSON.stringify(runtimeEvidence), "utf8");
  const evidenceFileSha256 = sha256Bytes(evidenceBytes);
  await writeFile(config.proofOutputPath, proofBytes);
  await writeFile(config.runtimeEvidencePath, evidenceBytes);
  await writeFile(`${config.runtimeEvidencePath}.sha256`, `${evidenceFileSha256}\n`, "utf8");
  return {
    proofOutputPath: config.proofOutputPath,
    proofSha256: sha256Bytes(proofBytes),
    runtimeEvidencePath: config.runtimeEvidencePath,
    runtimeEvidenceSha256Path: `${config.runtimeEvidencePath}.sha256`,
    runtimeEvidenceFileSha256: evidenceFileSha256,
    checkpointSha256,
    resultSha256,
    sourceFixtureCount: fixtureSummaries.length,
  };
};
const parseArgs = (argv) => {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--config") {
      result.configPath = argv[index + 1];
      index += 1;
    } else if (token === "--help" || token === "-h") {
      result.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return result;
};
const usage = () => "Usage: node scripts/proofs/m4-sam31-live-transfer-proof.mjs --config <absolute-config.json>";

const main = async () => {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) { console.log(usage()); return 0; }
    if (!absolute(args.configPath)) throw new TypeError("--config must be an absolute path.");
    const config = JSON.parse(await readFile(args.configPath, "utf8"));
    const result = await runSam31LiveTransferProof(config);
    console.log(JSON.stringify({ status: "COMPLETED", ...result }));
    return 0;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.log(JSON.stringify({ status: "REFUSED", code: "M4_SAM31_LIVE_PROOF_REFUSED", detail }));
    return 1;
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main();
}
