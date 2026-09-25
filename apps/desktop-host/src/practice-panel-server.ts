import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import {
  EditTypeRegistryFileV1,
  GptOrchestrationStoreV1,
  ProCreationPreparationEngineV1,
  attestPracticeSkillUseV1,
  compileGptTutorialResearchSourceV1,
  buildPracticeMasteryRecordV1,
  hasRepeatedSceneGeometryV1,
  LocalPracticeMediaMatcherV1,
  practicePerceptualSetOverlapsV1,
  practicePerceptualSignatureMatchesV1,
  type GptCapabilityGapV1,
  type GptLearnedSkillV1,
  type GptLearningEventV1,
  type GptLearningOutcomeV1,
  type GptLearningStageV1,
  type GptOrchestrationAssignmentV1,
  type GptOrchestrationModeV1,
  type GptResearchSourceV1,
  type GptSkillCausalModelV1,
  type GptSkillMachineUseSignatureV1,
  PracticeLearningMemoryFileV1,
  type PracticeHeldOutBenchmarkCaseV1,
  type PracticeLearningAllocationResultV1,
  type PracticeMasteryRecordV1,
  type PracticeMasteryScopeV1,
  type PracticeMediaInputV1,
  type PracticeRunRoleV1,
  type PracticeSessionResultV1,
  type PracticeSkillUseAttestationV1,
  type ProCreationPreparationResultV1,
  validatePracticeSceneMatchesV1,
} from "../../../packages/practice-homework/src/index.js";
import type { TutorialDeepAnalysisPacketV1 } from "../../../packages/tutorial-learning/src/index.js";
import {
  AeCepAdapterClientV11,
  AeFilesystemPolicyV11,
} from "../../../packages/adapters/ae-cep/src/v1_1.js";
import { LoopbackCepBroker } from "./loopback-cep.js";
import { CurrentAeTransactionRuntimeV1 } from "./current-ae-transaction-runtime.js";
import { LocalFastRuntimeV1 } from "./local-fast-runtime.js";
import { recordPracticeHeldOutCertificationV1 } from "./practice-held-out-certification.js";
import { PracticeMasteryVerifierV1 } from "./practice-mastery-verifier.js";

export interface PracticePanelServerConfigV1 {
  readonly port: number;
  readonly token: string;
  readonly repositoryRoot: string;
  readonly artifactDir: string;
  readonly learningMemoryFilePath: string;
  readonly editTypeRegistryFilePath: string;
  readonly gptOrchestrationFilePath?: string;
  readonly broker: LoopbackCepBroker;
  readonly ffmpegPath?: string;
  readonly renderTimeoutMs?: number;
}

export type PracticePanelRunStateV1 =
  | "WAITING_FOR_GPT"
  | "RUNNING"
  | "CANCEL_REQUESTED"
  | "CANCELLED"
  | "COMPLETED"
  | "FAILED";

export interface PracticeHumanReviewV1 {
  readonly schema: "editflow.practice-human-review.v1";
  readonly sessionId: string;
  readonly editTypeId: string;
  readonly sceneFidelity: number;
  readonly timingPacing: number;
  readonly effectsTransitions: number;
  readonly visualFinish: number;
  readonly overall: number;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly evidenceRefs: readonly string[];
}

export interface PracticePanelRunSnapshotV1 {
  readonly sessionId: string;
  readonly assignmentId: string;
  readonly mode: GptOrchestrationModeV1;
  readonly practiceRole: PracticeRunRoleV1 | null;
  readonly editTypeId: string;
  readonly state: PracticePanelRunStateV1;
  readonly stage: GptLearningStageV1 | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly finishPath: string | null;
  readonly videoPaths: readonly string[];
  readonly audioPaths: readonly string[];
  readonly result: PracticeSessionResultV1 | null;
  readonly allocation: PracticeLearningAllocationResultV1 | null;
  readonly masteryScope: PracticeMasteryScopeV1 | null;
  readonly masteryProofRef: string | null;
  readonly masteryReasons: readonly string[];
  readonly finalRenderRef: string | null;
  readonly humanReview: PracticeHumanReviewV1 | null;
  readonly finalSummary: string | null;
  readonly error: string | null;
}

interface PracticeRunBody {
  readonly editTypeId: string;
  readonly editTypeTitle?: string;
  readonly practiceRole: PracticeRunRoleV1 | null;
  readonly finishPath: string;
  readonly videoPaths: readonly string[];
  readonly audioPaths?: readonly string[];
  readonly minimumSimilarity?: number;
  readonly stretchSimilarity?: number;
  readonly maxAttempts?: number;
  readonly exactSceneConfidence?: number;
  readonly minimumAudioConfidence?: number;
}

interface ProCreationBody {
  readonly editTypeId: string;
  readonly videoPaths: readonly string[];
  readonly audioPaths?: readonly string[];
}

export const resolvePracticeRunRoleV1 = (
  requestedRole: PracticeRunRoleV1 | null,
  transferVerified: boolean,
): PracticeRunRoleV1 => requestedRole
  ?? (transferVerified ? "HELD_OUT_CERTIFICATION" : "LEARNING");

export type PracticeAutoLifecycleStageV1 =
  | "REFERENCE_LEARNING"
  | "TRANSFER_LEARNING"
  | "HELD_OUT_CERTIFICATION";

export const resolvePracticeAutoLifecycleStageV1 = (
  masteryRecords: readonly PracticeMasteryRecordV1[],
): PracticeAutoLifecycleStageV1 => {
  if (masteryRecords.some((record) => record.scope === "TRANSFER_VERIFIED")) {
    return "HELD_OUT_CERTIFICATION";
  }
  return masteryRecords.length > 0 ? "TRANSFER_LEARNING" : "REFERENCE_LEARNING";
};

export interface PracticeSceneCompatibilityShotV1 {
  readonly shotId: string;
  readonly sourceId: string | null;
  readonly sourceStartMs: number | null;
  readonly sourceEndMs: number | null;
  readonly direction: "FORWARD" | "REVERSE" | null;
  readonly playbackRate: number | null;
  readonly confidence: number | null;
  readonly repeatedGeometry: boolean;
  readonly exact: boolean;
  readonly evidenceRefs: readonly string[];
}

export interface PracticeSceneCompatibilityV1 {
  readonly schema: "editflow.practice-pre-ae-scene-compatibility.v1";
  readonly referenceFingerprint: string;
  readonly sourceFingerprint: string;
  readonly proofFingerprint: string;
  readonly minimumConfidence: number;
  readonly referenceShotCount: number;
  readonly retainedMatchCount: number;
  readonly exactMatchCount: number;
  readonly shots: readonly PracticeSceneCompatibilityShotV1[];
  readonly passed: boolean;
  readonly reasons: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface PracticeHeldOutMaterialFingerprintV1 {
  readonly referenceFingerprint: string;
  readonly sourceFingerprint: string;
  readonly sourceMediaSha256: readonly string[];
  readonly referencePerceptualSignature?: string;
  readonly sourcePerceptualSignatures?: readonly string[];
  readonly duplicateStartMedia: boolean;
  readonly finishReusedAsStart?: boolean;
  readonly duplicateStartPerceptualMedia?: boolean;
  readonly sceneCompatibility?: PracticeSceneCompatibilityV1;
}

const sha256FileStream = async (filePath: string): Promise<string> =>
  await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });

const sourceSetFingerprintFromSha256V1 = (
  sourceMediaSha256: readonly string[],
): string => {
  const identities = [...new Set(sourceMediaSha256)]
    .sort()
    .map((value) => "source-video:sha256:" + value);
  return createHash("sha256").update(identities.join("\n"), "utf8").digest("hex");
};

const practiceSceneCompatibilityFingerprintV1 = (input: {
  readonly referenceFingerprint: string;
  readonly sourceFingerprint: string;
  readonly minimumConfidence: number;
  readonly shots: readonly PracticeSceneCompatibilityShotV1[];
  readonly reasons: readonly string[];
}): string => createHash("sha256")
  .update(JSON.stringify({
    schema: "editflow.practice-pre-ae-scene-compatibility.v1",
    referenceFingerprint: input.referenceFingerprint,
    sourceFingerprint: input.sourceFingerprint,
    minimumConfidence: input.minimumConfidence,
    shots: input.shots.map(({ evidenceRefs: _evidenceRefs, ...shot }) => shot),
    reasons: input.reasons,
  }), "utf8")
  .digest("hex");

export const fingerprintPracticeHeldOutMaterialV1 = async (input: {
  readonly finishPath: string;
  readonly videoPaths: readonly string[];
  readonly repositoryRoot?: string;
  readonly artifactDir?: string;
  readonly ffmpegPath?: string;
  readonly exactSceneConfidence?: number;
}): Promise<PracticeHeldOutMaterialFingerprintV1> => {
  const referenceFingerprint = await sha256FileStream(input.finishPath);
  const rawSourceHashes: string[] = [];
  for (const videoPath of input.videoPaths) {
    rawSourceHashes.push(await sha256FileStream(videoPath));
  }
  const sourceMediaSha256 = [...new Set(rawSourceHashes)].sort();
  if (sourceMediaSha256.length === 0) {
    throw new TypeError("Held-out certification requires at least one Start video.");
  }

  const base: PracticeHeldOutMaterialFingerprintV1 = {
    referenceFingerprint,
    sourceFingerprint: sourceSetFingerprintFromSha256V1(sourceMediaSha256),
    sourceMediaSha256,
    duplicateStartMedia: sourceMediaSha256.length !== rawSourceHashes.length,
    finishReusedAsStart: sourceMediaSha256.includes(referenceFingerprint),
  };
  if (input.exactSceneConfidence !== undefined && base.finishReusedAsStart === true) {
    return base;
  }
  if (input.repositoryRoot === undefined && input.artifactDir === undefined) return base;
  if (input.repositoryRoot === undefined || input.artifactDir === undefined) {
    throw new TypeError(
      "Practice perceptual preflight requires repositoryRoot and artifactDir together.",
    );
  }

  const matcher = new LocalPracticeMediaMatcherV1({
    artifactDir: path.join(input.artifactDir, "media"),
    analysisCacheDir: path.join(
      input.repositoryRoot,
      "proofs",
      "artifacts",
      "practice-media-cache",
    ),
    scriptPath: path.join(
      input.repositoryRoot,
      "scripts",
      "practice",
      "practice-media-match.py",
    ),
    ...(input.ffmpegPath === undefined ? {} : { ffmpegPath: input.ffmpegPath }),
  });
  const finish: PracticeMediaInputV1 = {
    mediaId: mediaId("finish", input.finishPath, 0),
    role: "FINISH_REFERENCE",
    mediaKind: "VIDEO",
    uri: input.finishPath,
  };
  const start = input.videoPaths.map((uri, index): PracticeMediaInputV1 => ({
    mediaId: mediaId("video", uri, index),
    role: "START_SOURCE",
    mediaKind: "VIDEO",
    uri,
  }));
  const reference = await matcher.analyzeFinish(finish);
  const sourceIndex = await matcher.indexStart(start);
  const referencePerceptualSignature = reference.perceptualSignature;
  const sourcePerceptualSignatures = sourceIndex.videoPerceptualSignatures ?? [];
  if (referencePerceptualSignature === undefined
    || sourcePerceptualSignatures.length === 0) {
    throw new TypeError(
      "Practice perceptual preflight could not derive Finish/Start signatures.",
    );
  }
  const duplicateStartPerceptualMedia =
    sourcePerceptualSignatures.length !== input.videoPaths.length
    || sourcePerceptualSignatures.some((value, index) =>
      sourcePerceptualSignatures.slice(index + 1).some((other) =>
        practicePerceptualSignatureMatchesV1(value, other)));

  let sceneCompatibility: PracticeSceneCompatibilityV1 | undefined;
  if (input.exactSceneConfidence !== undefined) {
    if (!Number.isFinite(input.exactSceneConfidence)
      || input.exactSceneConfidence < 0
      || input.exactSceneConfidence > 1) {
      throw new TypeError("Practice exact-scene confidence must be between 0 and 1.");
    }
    const matches = await matcher.matchScenes({
      reference,
      sourceIndex,
      minimumConfidence: input.exactSceneConfidence,
    });
    const shotIds = reference.shots.map((shot) => shot.shotId);
    const reasons = validatePracticeSceneMatchesV1(
      shotIds,
      matches,
      input.exactSceneConfidence,
    );
    const byShot = new Map(matches.map((match) => [match.shotId, match]));
    const shots: PracticeSceneCompatibilityShotV1[] = shotIds.map((shotId) => {
      const match = byShot.get(shotId);
      const repeatedGeometry = match === undefined ? false : hasRepeatedSceneGeometryV1(match);
      const exact = match !== undefined
        && match.confidence >= input.exactSceneConfidence!
        && repeatedGeometry
        && match.sourceEndMs > match.sourceStartMs
        && Number.isFinite(match.playbackRate)
        && match.playbackRate > 0;
      return {
        shotId,
        sourceId: match?.sourceId ?? null,
        sourceStartMs: match?.sourceStartMs ?? null,
        sourceEndMs: match?.sourceEndMs ?? null,
        direction: match?.direction ?? null,
        playbackRate: match?.playbackRate ?? null,
        confidence: match?.confidence ?? null,
        repeatedGeometry,
        exact,
        evidenceRefs: match?.evidenceRefs ?? [],
      };
    });
    const exactMatchCount = shots.filter((shot) => shot.exact).length;
    const proofFingerprint = practiceSceneCompatibilityFingerprintV1({
      referenceFingerprint: base.referenceFingerprint,
      sourceFingerprint: base.sourceFingerprint,
      minimumConfidence: input.exactSceneConfidence,
      shots,
      reasons,
    });
    const proofDirectory = path.join(input.artifactDir, "preflight");
    await mkdir(proofDirectory, { recursive: true });
    const proofPath = path.join(
      proofDirectory,
      "scene-compatibility-" + proofFingerprint.slice(0, 24) + ".json",
    );
    sceneCompatibility = {
      schema: "editflow.practice-pre-ae-scene-compatibility.v1",
      referenceFingerprint: base.referenceFingerprint,
      sourceFingerprint: base.sourceFingerprint,
      proofFingerprint,
      minimumConfidence: input.exactSceneConfidence,
      referenceShotCount: shotIds.length,
      retainedMatchCount: matches.length,
      exactMatchCount,
      shots,
      passed: reasons.length === 0,
      reasons,
      evidenceRefs: ["practice-pre-ae-scene-compatibility:" + proofPath],
    };
    await writeFile(
      proofPath,
      JSON.stringify(sceneCompatibility, null, 2) + "\n",
      "utf8",
    );
  }

  return {
    ...base,
    referencePerceptualSignature,
    sourcePerceptualSignatures,
    duplicateStartPerceptualMedia,
    ...(sceneCompatibility === undefined ? {} : { sceneCompatibility }),
  };
};

export const validatePracticePreAeSceneCompatibilityV1 = (input: {
  readonly material: PracticeHeldOutMaterialFingerprintV1;
}): readonly string[] => {
  if (input.material.finishReusedAsStart === true) {
    return [
      "Practice Start reuses the Finish reference media bytes; raw-source proof requires independent Start footage.",
    ];
  }
  const compatibility = input.material.sceneCompatibility;
  if (compatibility === undefined) {
    return ["Practice pre-AE exact-scene compatibility proof is missing."];
  }
  const reasons = [...compatibility.reasons];
  if (compatibility.schema !== "editflow.practice-pre-ae-scene-compatibility.v1") {
    reasons.push("Practice pre-AE scene-compatibility proof schema is invalid.");
  }
  if (compatibility.referenceFingerprint !== input.material.referenceFingerprint) {
    reasons.push("Practice pre-AE scene proof is not bound to the current Finish media.");
  }
  if (compatibility.sourceFingerprint !== input.material.sourceFingerprint) {
    reasons.push("Practice pre-AE scene proof is not bound to the current Start media.");
  }
  const expectedFingerprint = practiceSceneCompatibilityFingerprintV1({
    referenceFingerprint: compatibility.referenceFingerprint,
    sourceFingerprint: compatibility.sourceFingerprint,
    minimumConfidence: compatibility.minimumConfidence,
    shots: compatibility.shots,
    reasons: compatibility.reasons,
  });
  if (compatibility.proofFingerprint !== expectedFingerprint) {
    reasons.push("Practice pre-AE scene-compatibility proof fingerprint is invalid.");
  }
  if (compatibility.evidenceRefs.length === 0) {
    reasons.push("Practice pre-AE scene-compatibility proof has no retained evidence artifact.");
  }
  if (compatibility.referenceShotCount <= 0) {
    reasons.push("Practice Finish contains no retained reference shots for exact-scene proof.");
  }
  if (compatibility.shots.length !== compatibility.referenceShotCount
    || new Set(compatibility.shots.map((shot) => shot.shotId)).size !== compatibility.shots.length) {
    reasons.push("Practice pre-AE scene proof must contain one unique row per Finish shot.");
  }
  const recomputedExactCount = compatibility.shots.filter((shot) => {
    const exact = shot.sourceId !== null
      && shot.confidence !== null
      && shot.confidence >= compatibility.minimumConfidence
      && shot.repeatedGeometry
      && shot.sourceStartMs !== null
      && shot.sourceEndMs !== null
      && shot.sourceEndMs > shot.sourceStartMs
      && shot.playbackRate !== null
      && Number.isFinite(shot.playbackRate)
      && shot.playbackRate > 0;
    if (exact !== shot.exact) {
      reasons.push(
        "Practice pre-AE scene proof exactness is inconsistent for " + shot.shotId + ".",
      );
    }
    return exact;
  }).length;
  if (recomputedExactCount !== compatibility.exactMatchCount) {
    reasons.push("Practice pre-AE exact-scene count does not match retained shot evidence.");
  }
  if (compatibility.retainedMatchCount !== compatibility.referenceShotCount) {
    reasons.push("Practice Start must retain exactly one scene match per Finish shot before AE work.");
  }
  if (compatibility.exactMatchCount !== compatibility.referenceShotCount) {
    reasons.push("Practice Start does not exactly cover every retained Finish shot before AE work.");
  }
  if (!compatibility.passed && reasons.length === 0) {
    reasons.push("Practice pre-AE exact-scene compatibility proof failed.");
  }
  return [...new Set(reasons)];
};

export const validatePracticeTransferLearningMaterialV1 = (input: {
  readonly material: PracticeHeldOutMaterialFingerprintV1;
  readonly masteryRecords: readonly PracticeMasteryRecordV1[];
}): readonly string[] => {
  const reasons: string[] = [];
  const currentSources = new Set(input.material.sourceMediaSha256);
  if (input.material.duplicateStartMedia) {
    reasons.push("Transfer learning Start inputs contain duplicate media bytes.");
  }
  if (input.material.duplicateStartPerceptualMedia) {
    reasons.push("Transfer learning Start inputs contain perceptually duplicate video content.");
  }
  const comparableRecords = input.masteryRecords.filter((record) =>
    (record.sourceMediaSha256 ?? []).length > 0);
  if (input.masteryRecords.length > 0 && comparableRecords.length === 0) {
    reasons.push(
      "Retained Practice mastery lacks Start SHA-256 identities required for material transfer.",
    );
  }
  const sourceOverlap = (values: readonly string[] | undefined): boolean =>
    (values ?? []).some((value) => currentSources.has(value));
  for (const record of input.masteryRecords) {
    if (record.referenceFingerprint === input.material.referenceFingerprint
      || practicePerceptualSignatureMatchesV1(
        record.referencePerceptualSignature,
        input.material.referencePerceptualSignature,
      )) {
      reasons.push("Transfer learning must use a different Finish reference.");
    }
    if (record.sourceFingerprint === input.material.sourceFingerprint
      || sourceOverlap(record.sourceMediaSha256)
      || practicePerceptualSetOverlapsV1(
        record.sourcePerceptualSignatures,
        input.material.sourcePerceptualSignatures,
      )) {
      reasons.push("Transfer learning must use different Start video content.");
    }
  }
  return [...new Set(reasons)];
};

export const validatePracticeHeldOutMaterialNoveltyV1 = (input: {
  readonly material: PracticeHeldOutMaterialFingerprintV1;
  readonly masteryRecords: readonly PracticeMasteryRecordV1[];
  readonly heldOutCases: readonly PracticeHeldOutBenchmarkCaseV1[];
}): readonly string[] => {
  const reasons: string[] = [];
  const currentSources = new Set(input.material.sourceMediaSha256);
  if (input.material.duplicateStartMedia) {
    reasons.push("Held-out Start inputs contain duplicate media bytes.");
  }
  if (input.material.duplicateStartPerceptualMedia) {
    reasons.push("Held-out Start inputs contain perceptually duplicate video content.");
  }
  const sourceOverlap = (values: readonly string[] | undefined): boolean =>
    (values ?? []).some((value) => currentSources.has(value));

  for (const record of input.masteryRecords) {
    if (record.referenceFingerprint === input.material.referenceFingerprint
      || practicePerceptualSignatureMatchesV1(
        record.referencePerceptualSignature,
        input.material.referencePerceptualSignature,
      )) {
      reasons.push("Finish reference reuses retained Practice training media.");
    }
    if (record.sourceFingerprint === input.material.sourceFingerprint
      || sourceOverlap(record.sourceMediaSha256)
      || practicePerceptualSetOverlapsV1(
        record.sourcePerceptualSignatures,
        input.material.sourcePerceptualSignatures,
      )) {
      reasons.push("Start source reuses retained Practice training media.");
    }
  }
  for (const heldOutCase of input.heldOutCases) {
    if (heldOutCase.referenceFingerprint === input.material.referenceFingerprint
      || practicePerceptualSignatureMatchesV1(
        heldOutCase.referencePerceptualSignature,
        input.material.referencePerceptualSignature,
      )) {
      reasons.push("Finish reference reuses prior held-out certification media.");
    }
    if (heldOutCase.sourceFingerprint === input.material.sourceFingerprint
      || sourceOverlap(heldOutCase.sourceMediaSha256)
      || practicePerceptualSetOverlapsV1(
        heldOutCase.sourcePerceptualSignatures,
        input.material.sourcePerceptualSignatures,
      )) {
      reasons.push("Start source reuses prior held-out certification media.");
    }
  }
  return [...new Set(reasons)];
};

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const jsonResponse = (res: ServerResponse, status: number, value: unknown): void => {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
};

const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 1_000_000) throw new HttpError(413, "REQUEST_BODY_TOO_LARGE");
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const parsed = text.length === 0 ? {} : JSON.parse(text) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "JSON object body required.");
  }
  return parsed as Record<string, unknown>;
};

const secureTokenEqual = (expected: string, actual: string): boolean => {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(actual, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
};

const header = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? "" : value ?? "";

const requiredString = (body: Record<string, unknown>, name: string): string => {
  const value = body[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, name + " is required.");
  }
  return value.trim();
};

const optionalString = (body: Record<string, unknown>, name: string): string | undefined => {
  const value = body[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, name + " must be a non-empty string.");
  }
  return value.trim();
};

const stringArray = (
  body: Record<string, unknown>,
  name: string,
  required: boolean,
): readonly string[] => {
  const value = body[name];
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new HttpError(400, name + " must be an array of non-empty paths.");
  }
  if (required && value.length === 0) {
    throw new HttpError(400, name + " must contain at least one path.");
  }
  return value.map((item) => item.trim());
};

const optionalNumber = (
  body: Record<string, unknown>,
  name: string,
  minimum: number,
  maximum: number,
  integer = false,
): number | undefined => {
  const value = body[name];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)
    || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    throw new HttpError(400, name + " is outside its accepted range.");
  }
  return value;
};

const optionalRecord = (
  body: Record<string, unknown>,
  name: string,
): Record<string, unknown> | undefined => {
  const value = body[name];
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, name + " must be a JSON object.");
  }
  return value as Record<string, unknown>;
};

const requiredEnum = <T extends string>(
  body: Record<string, unknown>,
  name: string,
  allowed: readonly T[],
): T => {
  const value = requiredString(body, name);
  if (!allowed.includes(value as T)) {
    throw new HttpError(400, name + " has an unsupported value.");
  }
  return value as T;
};

const requiredCausalModel = (
  body: Record<string, unknown>,
  name: string,
): GptSkillCausalModelV1 => {
  const record = optionalRecord(body, name);
  if (record === undefined) throw new HttpError(400, name + " is required.");
  return {
    triggerConditions: stringArray(record, "triggerConditions", true),
    invariants: stringArray(record, "invariants", true),
    adaptationAxes: stringArray(record, "adaptationAxes", true),
    failureSignals: stringArray(record, "failureSignals", true),
    repairStrategies: stringArray(record, "repairStrategies", true),
    transferCriteria: stringArray(record, "transferCriteria", true),
  };
};

const optionalMachineUseSignature = (
  body: Record<string, unknown>,
  name: string,
): GptSkillMachineUseSignatureV1 | undefined => {
  const record = optionalRecord(body, name);
  if (record === undefined) return undefined;
  const rawRules = record["invariantRules"];
  if (!Array.isArray(rawRules) || rawRules.length === 0) {
    throw new HttpError(400, name + ".invariantRules must contain at least one rule.");
  }
  return {
    schema: requiredEnum(
      record,
      "schema",
      ["editflow.gpt-skill-machine-use-signature.v1"] as const,
    ),
    invariantRules: rawRules.map((rule, ruleIndex) => {
      if (rule === null || typeof rule !== "object" || Array.isArray(rule)) {
        throw new HttpError(
          400,
          name + ".invariantRules[" + String(ruleIndex) + "] must be an object.",
        );
      }
      const ruleRecord = rule as Record<string, unknown>;
      const rawEvidence = ruleRecord["evidence"];
      if (!Array.isArray(rawEvidence) || rawEvidence.length === 0) {
        throw new HttpError(
          400,
          name + ".invariantRules[" + String(ruleIndex) + "].evidence must not be empty.",
        );
      }
      return {
        invariant: requiredString(ruleRecord, "invariant"),
        evidence: rawEvidence.map((predicate, predicateIndex) => {
          if (predicate === null || typeof predicate !== "object" || Array.isArray(predicate)) {
            throw new HttpError(
              400,
              name + ".invariantRules[" + String(ruleIndex) + "].evidence["
                + String(predicateIndex) + "] must be an object.",
            );
          }
          const predicateRecord = predicate as Record<string, unknown>;
          return {
            source: requiredEnum(predicateRecord, "source", [
              "CUE_ID",
              "RATIONALE_CODE",
              "CONSTRUCTION_ID",
              "EVIDENCE_REF",
              "PROOF_EFFECT_FAMILY",
              "PROOF_OBJECT_AWARE",
            ] as const),
            match: requiredEnum(predicateRecord, "match", ["EXACT", "PREFIX"] as const),
            value: requiredString(predicateRecord, "value"),
          };
        }),
      };
    }),
  };
};

const optionalResearchSources = (
  body: Record<string, unknown>,
  name: string,
): readonly GptResearchSourceV1[] | undefined => {
  const value = body[name];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new HttpError(400, name + " must be an array.");
  return value.map((source, index) => {
    if (source === null || typeof source !== "object" || Array.isArray(source)) {
      throw new HttpError(400, name + "[" + String(index) + "] must be an object.");
    }
    const record = source as Record<string, unknown>;
    const technique = optionalRecord(record, "tutorialTechnique");
    const compilation = optionalRecord(record, "tutorialCompilation");
    if (compilation !== undefined && compilation["compilerVersion"] !== 1) {
      throw new HttpError(400, "tutorialCompilation.compilerVersion must be 1.");
    }
    return {
      sourceId: requiredString(record, "sourceId"),
      kind: requiredEnum(record, "kind", [
        "TUTORIAL_DRIVE", "ADOBE_DOCUMENTATION", "INSTALLED_ADOBE_FEATURE",
        "PLUGIN_DOCUMENTATION", "PROFESSIONAL_TUTORIAL", "WEB", "INTERNAL_EVIDENCE",
      ] as const),
      title: requiredString(record, "title"),
      ...(optionalString(record, "uri") === undefined ? {} : { uri: optionalString(record, "uri")! }),
      ...(optionalString(record, "notes") === undefined ? {} : { notes: optionalString(record, "notes")! }),
      ...(technique === undefined ? {} : {
        tutorialTechnique: {
          what: requiredString(technique, "what"),
          whenWhy: requiredString(technique, "whenWhy"),
          how: requiredString(technique, "how"),
          access: requiredString(technique, "access"),
          proof: requiredString(technique, "proof"),
          transfer: requiredString(technique, "transfer"),
        },
      }),
      ...(compilation === undefined ? {} : {
        tutorialCompilation: {
          schema: requiredEnum(
            compilation,
            "schema",
            ["editflow.gpt-tutorial-causal-compilation.v1"] as const,
          ),
          compilerVersion: 1 as const,
          targetSkillId: requiredString(compilation, "targetSkillId"),
          tutorialId: requiredString(compilation, "tutorialId"),
          tutorialSkillId: requiredString(compilation, "tutorialSkillId"),
          sourceRef: requiredString(compilation, "sourceRef"),
          analysisFingerprint: requiredString(compilation, "analysisFingerprint"),
          constructionPattern: requiredString(compilation, "constructionPattern"),
          capabilityIds: stringArray(compilation, "capabilityIds", false),
          adaptationNotes: requiredString(compilation, "adaptationNotes"),
          causalModel: requiredCausalModel(compilation, "causalModel"),
          evidenceRefs: stringArray(compilation, "evidenceRefs", true),
        },
      }),
    };
  });
};

const optionalCapabilityGap = (
  body: Record<string, unknown>,
  name: string,
): GptCapabilityGapV1 | undefined => {
  const record = optionalRecord(body, name);
  if (record === undefined) return undefined;
  const kind = requiredEnum(record, "kind", ["RECIPE_SKILL", "EXECUTION_CAPABILITY"] as const);
  const missingCapabilityIds = stringArray(record, "missingCapabilityIds", false);
  if (kind === "EXECUTION_CAPABILITY" && missingCapabilityIds.length === 0) {
    throw new HttpError(400, name + ".missingCapabilityIds is required for EXECUTION_CAPABILITY.");
  }
  const resolutionSkillId = optionalString(record, "resolutionSkillId");
  return {
    gapId: requiredString(record, "gapId"),
    kind,
    requestedBehavior: requiredString(record, "requestedBehavior"),
    missingCapabilityIds,
    status: requiredEnum(record, "status", ["OPEN", "RESOLVED", "BLOCKED"] as const),
    ...(resolutionSkillId === undefined ? {} : { resolutionSkillId }),
    evidenceRefs: stringArray(record, "evidenceRefs", false),
  };
};

const optionalLearnedSkill = (
  body: Record<string, unknown>,
  name: string,
): GptLearnedSkillV1 | undefined => {
  const record = optionalRecord(body, name);
  if (record === undefined) return undefined;
  const adaptationNotes = optionalString(record, "adaptationNotes");
  const causalModel = optionalRecord(record, "causalModel");
  const machineUseSignature = optionalMachineUseSignature(record, "machineUseSignature");
  return {
    skillId: requiredString(record, "skillId"),
    title: requiredString(record, "title"),
    requestedBehavior: requiredString(record, "requestedBehavior"),
    maturity: requiredEnum(record, "maturity", [
      "HYPOTHESIS", "RECONSTRUCTED", "AE_PROVEN", "TRANSFER_VERIFIED",
    ] as const),
    constructionPattern: requiredString(record, "constructionPattern"),
    capabilityIds: stringArray(record, "capabilityIds", false),
    ...(adaptationNotes === undefined ? {} : { adaptationNotes }),
    ...(causalModel === undefined ? {} : {
      causalModel: {
        triggerConditions: stringArray(causalModel, "triggerConditions", true),
        invariants: stringArray(causalModel, "invariants", true),
        adaptationAxes: stringArray(causalModel, "adaptationAxes", true),
        failureSignals: stringArray(causalModel, "failureSignals", true),
        repairStrategies: stringArray(causalModel, "repairStrategies", true),
        transferCriteria: stringArray(causalModel, "transferCriteria", true),
      },
    }),
    ...(machineUseSignature === undefined ? {} : { machineUseSignature }),
    researchSources: optionalResearchSources(record, "researchSources") ?? [],
    evidenceRefs: stringArray(record, "evidenceRefs", false),
    learnedAt: optionalString(record, "learnedAt") ?? new Date().toISOString(),
  };
};

const ensureFile = async (filePath: string, label: string): Promise<string> => {
  const resolved = path.resolve(filePath);
  let metadata;
  try {
    metadata = await stat(resolved);
  } catch {
    throw new HttpError(400, label + " does not exist: " + resolved);
  }
  if (!metadata.isFile() || metadata.size <= 0) {
    throw new HttpError(400, label + " must be a non-empty file: " + resolved);
  }
  return resolved;
};

const mediaId = (kind: "video" | "audio" | "finish", filePath: string, index: number): string => {
  const stem = path.basename(filePath, path.extname(filePath))
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "media";
  return kind + ":" + String(index + 1) + ":" + stem;
};

const mediaInputs = (
  videoPaths: readonly string[],
  audioPaths: readonly string[],
): readonly PracticeMediaInputV1[] => [
  ...videoPaths.map((uri, index) => ({
    mediaId: mediaId("video", uri, index),
    role: "START_SOURCE" as const,
    mediaKind: "VIDEO" as const,
    uri,
  })),
  ...audioPaths.map((uri, index) => ({
    mediaId: mediaId("audio", uri, index),
    role: "START_SOURCE" as const,
    mediaKind: "AUDIO" as const,
    uri,
  })),
];

const snapshot = (run: PracticePanelRunSnapshotV1): PracticePanelRunSnapshotV1 =>
  structuredClone(run);

const assignmentRunState = (
  status: GptOrchestrationAssignmentV1["status"],
): PracticePanelRunStateV1 => status === "PENDING"
  ? "WAITING_FOR_GPT"
  : status === "CANCEL_REQUESTED"
    ? "CANCEL_REQUESTED"
    : status === "CANCELLED"
      ? "CANCELLED"
      : status === "COMPLETED"
        ? "COMPLETED"
        : status === "FAILED"
          ? "FAILED"
          : "RUNNING";

const practiceLearningTraceReasons = (
  events: readonly GptLearningEventV1[],
  practiceRole: PracticeRunRoleV1 = "LEARNING",
): readonly string[] => {
  const reasons: string[] = [];
  const requiredStages: readonly GptLearningStageV1[] = practiceRole === "HELD_OUT_CERTIFICATION"
    ? ["RENDER", "COMPARISON", "RESULT"]
    : ["RENDER", "COMPARISON", "RESULT", "LESSON"];
  for (const stage of requiredStages) {
    if (!events.some((event) => event.stage === stage)) {
      reasons.push("Practice mastery requires a retained " + stage + " learning event.");
    }
  }
  const latestGapById = new Map<string, GptCapabilityGapV1>();
  for (const event of events) {
    if (event.capabilityGap !== undefined) {
      latestGapById.set(event.capabilityGap.gapId, event.capabilityGap);
    }
  }
  for (const gap of latestGapById.values()) {
    if (practiceRole === "HELD_OUT_CERTIFICATION") {
      reasons.push("Held-out certification encountered a capability gap: " + gap.gapId + ".");
    } else if (gap.status !== "RESOLVED") {
      reasons.push("Unresolved Practice capability gap blocks mastery: " + gap.gapId + ".");
    }
  }
  return [...new Set(reasons)];
};

export class PracticePanelServerV1 {
  readonly config: PracticePanelServerConfigV1;
  #server: Server | null = null;
  #port = 0;
  #activeRunId: string | null = null;
  readonly #runs = new Map<string, PracticePanelRunSnapshotV1>();
  readonly #gptStore: GptOrchestrationStoreV1;
  readonly #masteryVerifier: PracticeMasteryVerifierV1;
  readonly #transactionRuntime: CurrentAeTransactionRuntimeV1;
  #fastRuntime: LocalFastRuntimeV1 | null = null;
  #fastRuntimePromise: Promise<LocalFastRuntimeV1> | null = null;
  #controlRequestCounter = 0;

  constructor(config: PracticePanelServerConfigV1) {
    if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
      throw new TypeError("Practice panel port must be an integer from 0 through 65535.");
    }
    if (config.token.length < 32) {
      throw new TypeError("Practice panel token must contain at least 32 characters.");
    }
    this.config = config;
    this.#gptStore = new GptOrchestrationStoreV1(
      config.gptOrchestrationFilePath
        ?? path.join(config.artifactDir, "state", "gpt-orchestration.json"),
    );
    this.#masteryVerifier = new PracticeMasteryVerifierV1({
      repositoryRoot: config.repositoryRoot,
      ...(config.ffmpegPath === undefined ? {} : { ffmpegPath: config.ffmpegPath }),
    });
    this.#transactionRuntime = new CurrentAeTransactionRuntimeV1(
      config.broker,
      "practice-gpt-controller",
      64,
      null,
      96,
      new AeFilesystemPolicyV11([
        process.env.USERPROFILE ?? config.repositoryRoot,
      ]),
    );
  }

  get port(): number { return this.#port; }
  get isStarted(): boolean { return this.#server !== null; }
  get activeRunId(): string | null { return this.#activeRunId; }

  async start(): Promise<number> {
    if (this.#server !== null) return this.#port;
    await this.#recoverRuns();
    const server = createServer((req, res) => { void this.#handle(req, res); });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.config.port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address() as AddressInfo | null;
    if (address === null || address.address !== "127.0.0.1") {
      server.close();
      throw new Error("Practice panel server failed to bind exclusively to 127.0.0.1.");
    }
    this.#server = server;
    this.#port = address.port;
    return this.#port;
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    if (server !== null) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    }
    this.#port = 0;
  }

  async #ensureFastRuntime(): Promise<LocalFastRuntimeV1> {
    if (this.#fastRuntime !== null) return this.#fastRuntime;
    if (this.config.broker.panelSession === null) {
      throw new HttpError(409, "After Effects CEP panel is not connected.");
    }
    if (this.#fastRuntimePromise === null) {
      const policy = new AeFilesystemPolicyV11([
        process.env.USERPROFILE ?? this.config.repositoryRoot,
      ]);
      const client = new AeCepAdapterClientV11(
        this.config.broker,
        () => "practice-gpt-control-" + String(++this.#controlRequestCounter),
        policy,
      );
      this.#fastRuntimePromise = LocalFastRuntimeV1.create(client, {
        projectId: "practice-gpt-controller",
        maxBatchActions: 64,
        totalBudgetMs: 30_000,
        actionBudgetMs: 1_000,
        leaseTtlMs: 120_000,
      }).then((runtime) => {
        this.#fastRuntime = runtime;
        return runtime;
      }).catch((error) => {
        this.#fastRuntimePromise = null;
        throw error;
      });
    }
    return await this.#fastRuntimePromise;
  }

  #setHeaders(res: ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-EditFlow-Token");
    res.setHeader("Cache-Control", "no-store");
  }

  #authorized(req: IncomingMessage): boolean {
    const provided = header(req.headers["x-editflow-token"]);
    return provided.length > 0 && secureTokenEqual(this.config.token, provided);
  }

  async #editTypes(): Promise<EditTypeRegistryFileV1> {
    return new EditTypeRegistryFileV1(this.config.editTypeRegistryFilePath);
  }

  #humanReviewPath(sessionId: string): string {
    const safeSession = sessionId.replace(/[^a-zA-Z0-9._-]+/g, "-");
    return path.join(this.config.artifactDir, "human-reviews", safeSession + ".json");
  }

  async #loadHumanReview(sessionId: string): Promise<PracticeHumanReviewV1 | null> {
    try {
      const parsed = JSON.parse(await readFile(this.#humanReviewPath(sessionId), "utf8")) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      const review = parsed as Partial<PracticeHumanReviewV1>;
      if (review.schema !== "editflow.practice-human-review.v1"
        || review.sessionId !== sessionId) return null;
      return review as PracticeHumanReviewV1;
    } catch {
      return null;
    }
  }

  async #recoverRuns(): Promise<void> {
    const assignments = await this.#gptStore.listAssignments();
    if (assignments.length === 0) {
      this.#activeRunId = null;
      return;
    }
    const editTypes = await this.#editTypes();
    const registry = await editTypes.load();
    let active: GptOrchestrationAssignmentV1 | null = null;
    for (const assignment of assignments) {
      const existing = this.#runs.get(assignment.sessionId);
      if (existing === undefined) {
        const events = await this.#gptStore.eventsForSession(assignment.sessionId);
        const masteryRecord = registry.knowledge(assignment.editTypeId)
          ?.gptLearning.masteryRecords.find((item) => item.sessionId === assignment.sessionId);
        const startVideos = assignment.start
          .filter((item) => item.mediaKind === "VIDEO")
          .map((item) => item.uri);
        const startAudio = assignment.start
          .filter((item) => item.mediaKind === "AUDIO")
          .map((item) => item.uri);
        this.#runs.set(assignment.sessionId, {
          sessionId: assignment.sessionId,
          assignmentId: assignment.assignmentId,
          mode: assignment.mode,
          practiceRole: assignment.practiceRole,
          editTypeId: assignment.editTypeId,
          state: assignmentRunState(assignment.status),
          stage: events.at(-1)?.stage ?? null,
          startedAt: assignment.startedAt ?? assignment.createdAt,
          completedAt: assignment.completedAt,
          finishPath: assignment.finish?.uri ?? null,
          videoPaths: startVideos,
          audioPaths: startAudio,
          result: null,
          allocation: null,
          masteryScope: masteryRecord?.scope ?? null,
          masteryProofRef: masteryRecord?.proofRef ?? null,
          masteryReasons: [],
          finalRenderRef: assignment.finalRenderRef,
          humanReview: await this.#loadHumanReview(assignment.sessionId),
          finalSummary: assignment.finalSummary,
          error: assignment.error,
        });
      }
      if (!["CANCELLED", "COMPLETED", "FAILED"].includes(assignment.status)) {
        active = assignment;
      }
    }
    this.#activeRunId = active?.sessionId ?? null;
  }

  async #parsePractice(body: Record<string, unknown>): Promise<PracticeRunBody> {
    const videoPaths = await Promise.all(
      stringArray(body, "videoPaths", true)
        .map((value) => ensureFile(value, "Start video")),
    );
    const audioPaths = await Promise.all(
      stringArray(body, "audioPaths", false)
        .map((value) => ensureFile(value, "Start audio")),
    );
    const editTypeTitle = optionalString(body, "editTypeTitle");
    const practiceRoleValue = optionalString(body, "practiceRole") ?? "AUTO";
    if (practiceRoleValue !== "AUTO"
      && practiceRoleValue !== "LEARNING"
      && practiceRoleValue !== "HELD_OUT_CERTIFICATION") {
      throw new HttpError(
        400,
        "practiceRole must be AUTO, LEARNING, or HELD_OUT_CERTIFICATION.",
      );
    }
    const practiceRole = practiceRoleValue === "AUTO"
      ? null
      : practiceRoleValue as PracticeRunRoleV1;
    const minimumSimilarity = optionalNumber(body, "minimumSimilarity", 0, 1);
    const stretchSimilarity = optionalNumber(body, "stretchSimilarity", 0, 1);
    const maxAttempts = optionalNumber(body, "maxAttempts", 1, 20, true);
    const exactSceneConfidence = optionalNumber(body, "exactSceneConfidence", 0, 1);
    const minimumAudioConfidence = optionalNumber(body, "minimumAudioConfidence", 0, 1);
    return {
      editTypeId: requiredString(body, "editTypeId"),
      ...(editTypeTitle === undefined ? {} : { editTypeTitle }),
      practiceRole,
      finishPath: await ensureFile(requiredString(body, "finishPath"), "Finish reference"),
      videoPaths,
      audioPaths,
      ...(minimumSimilarity === undefined ? {} : { minimumSimilarity }),
      ...(stretchSimilarity === undefined ? {} : { stretchSimilarity }),
      ...(maxAttempts === undefined ? {} : { maxAttempts }),
      ...(exactSceneConfidence === undefined ? {} : { exactSceneConfidence }),
      ...(minimumAudioConfidence === undefined ? {} : { minimumAudioConfidence }),
    };
  }

  async #startPractice(body: Record<string, unknown>): Promise<PracticePanelRunSnapshotV1> {
    if (this.#activeRunId !== null) {
      throw new HttpError(409, "EditFlow run already active: " + this.#activeRunId);
    }
    if (this.config.broker.panelSession === null) {
      throw new HttpError(409, "After Effects CEP panel is not connected.");
    }
    const request = await this.#parsePractice(body);
    const editTypesFile = await this.#editTypes();
    const registry = await editTypesFile.load();
    let editType = registry.get(request.editTypeId);
    if (editType === null) {
      if (request.practiceRole === "HELD_OUT_CERTIFICATION") {
        throw new HttpError(409, "Held-out certification requires an existing transfer-verified Edit Type.");
      }
      if (request.editTypeTitle === undefined) {
        throw new HttpError(400, "Unknown Edit Type: " + request.editTypeId);
      }
      editType = registry.create({
        editTypeId: request.editTypeId,
        title: request.editTypeTitle,
        choiceWords: [request.editTypeTitle],
        description: "Created from the EditFlow Practice panel.",
      });
    }

    const sessionId = "practice:" + randomUUID();
    const start = mediaInputs(request.videoPaths, request.audioPaths ?? []);
    const finish: PracticeMediaInputV1 = {
      mediaId: mediaId("finish", request.finishPath, 0),
      role: "FINISH_REFERENCE",
      mediaKind: "VIDEO",
      uri: request.finishPath,
    };
    const artifactDir = path.join(
      this.config.artifactDir,
      sessionId.replace(/[:]/g, "-"),
    );
    const retainedKnowledge = registry.knowledge(editType.editTypeId);
    const transferableKnowledge = registry.transferableKnowledge(editType.editTypeId);
    const autoLifecycleStage = resolvePracticeAutoLifecycleStageV1(
      retainedKnowledge?.gptLearning.masteryRecords ?? [],
    );
    const practiceRole = resolvePracticeRunRoleV1(
      request.practiceRole,
      transferableKnowledge !== null,
    );
    const knowledge = practiceRole === "HELD_OUT_CERTIFICATION"
      ? transferableKnowledge
      : retainedKnowledge;
    if (practiceRole === "HELD_OUT_CERTIFICATION" && knowledge === null) {
      throw new HttpError(
        409,
        "Held-out certification requires TRANSFER_VERIFIED Practice knowledge before benchmark cases can start.",
      );
    }
    const exactSceneConfidence = request.exactSceneConfidence ?? 0.95;
    const material = await fingerprintPracticeHeldOutMaterialV1({
      finishPath: request.finishPath,
      videoPaths: request.videoPaths,
      repositoryRoot: this.config.repositoryRoot,
      artifactDir,
      exactSceneConfidence,
      ...(this.config.ffmpegPath === undefined
        ? {}
        : { ffmpegPath: this.config.ffmpegPath }),
    });
    const compatibilityReasons = validatePracticePreAeSceneCompatibilityV1({ material });
    if (compatibilityReasons.length > 0) {
      throw new HttpError(
        409,
        "Practice Start footage does not exactly cover the retained Finish scenes; AE work was not started. "
          + compatibilityReasons.join(" "),
      );
    }
    if (request.practiceRole === null && autoLifecycleStage === "TRANSFER_LEARNING") {
      const noveltyReasons = validatePracticeTransferLearningMaterialV1({
        material,
        masteryRecords: retainedKnowledge?.gptLearning.masteryRecords ?? [],
      });
      if (noveltyReasons.length > 0) {
        throw new HttpError(
          409,
          "Practice AUTO transfer learning requires materially different Finish/Start media. "
            + noveltyReasons.join(" "),
        );
      }
    }
    if (practiceRole === "HELD_OUT_CERTIFICATION") {
      if (retainedKnowledge === null) {
        throw new HttpError(409, "Held-out certification lost its retained Edit Type knowledge.");
      }
      const noveltyReasons = validatePracticeHeldOutMaterialNoveltyV1({
        material,
        masteryRecords: retainedKnowledge.gptLearning.masteryRecords,
        heldOutCases: retainedKnowledge.gptLearning.heldOutCases,
      });
      if (noveltyReasons.length > 0) {
        throw new HttpError(
          409,
          "Held-out certification requires genuinely unseen Finish/Start media. "
            + noveltyReasons.join(" "),
        );
      }
    }
    const assignment = await this.#gptStore.createAssignment({
      sessionId,
      mode: "PRACTICE",
      practiceRole,
      editTypeId: editType.editTypeId,
      finish,
      start,
      practicePolicy: {
        ...(request.minimumSimilarity === undefined
          ? {}
          : { minimumSimilarity: request.minimumSimilarity }),
        ...(request.exactSceneConfidence === undefined
          ? {}
          : { exactSceneConfidence: request.exactSceneConfidence }),
        ...(request.minimumAudioConfidence === undefined
          ? {}
          : { minimumAudioConfidence: request.minimumAudioConfidence }),
      },
      artifactDir,
      knowledge,
    });
    if (practiceRole === "LEARNING") {
      registry.beginGptLearningSession(editType.editTypeId, sessionId, "PRACTICE");
      await editTypesFile.save(registry);
    }

    const run: PracticePanelRunSnapshotV1 = {
      sessionId,
      assignmentId: assignment.assignmentId,
      mode: "PRACTICE",
      practiceRole,
      editTypeId: editType.editTypeId,
      state: "WAITING_FOR_GPT",
      stage: null,
      startedAt: assignment.createdAt,
      completedAt: null,
      finishPath: request.finishPath,
      videoPaths: request.videoPaths,
      audioPaths: request.audioPaths ?? [],
      result: null,
      allocation: null,
      masteryScope: null,
      masteryProofRef: null,
      masteryReasons: [],
      finalRenderRef: null,
      humanReview: null,
      finalSummary: null,
      error: null,
    };
    this.#activeRunId = sessionId;
    this.#runs.set(sessionId, run);
    return snapshot(run);
  }

  async #syncRun(sessionId: string): Promise<PracticePanelRunSnapshotV1> {
    const run = this.#runs.get(sessionId);
    if (run === undefined) throw new HttpError(404, "EditFlow run not found.");
    const assignment = await this.#gptStore.getAssignment(run.assignmentId);
    if (assignment === null) throw new HttpError(404, "GPT assignment not found.");
    const events = await this.#gptStore.eventsForSession(sessionId);
    const latestEvent = events.at(-1);
    const state = assignmentRunState(assignment.status);
    const updated: PracticePanelRunSnapshotV1 = {
      ...run,
      state,
      stage: latestEvent?.stage ?? run.stage,
      completedAt: assignment.completedAt,
      finalRenderRef: assignment.finalRenderRef,
      finalSummary: assignment.finalSummary,
      error: assignment.error,
    };
    this.#runs.set(sessionId, updated);
    if (["CANCELLED", "COMPLETED", "FAILED"].includes(state)
      && this.#activeRunId === sessionId) {
      this.#activeRunId = null;
    }
    return snapshot(updated);
  }

  async #bestAttemptRenderPath(sessionId: string): Promise<string> {
    const run = await this.#syncRun(sessionId);
    const candidate = run.finalRenderRef ?? run.result?.bestAttempt?.renderRef ?? null;
    if (candidate === null) {
      throw new HttpError(404, "Best-attempt render is not available for this run.");
    }
    return await ensureFile(candidate, "Best-attempt render");
  }

  async #openBestAttempt(sessionId: string): Promise<PracticePanelRunSnapshotV1> {
    const renderPath = await this.#bestAttemptRenderPath(sessionId);
    const command = process.platform === "win32"
      ? "explorer.exe"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
    const child = spawn(command, [renderPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return await this.#syncRun(sessionId);
  }

  async #saveHumanReview(
    sessionId: string,
    body: Record<string, unknown>,
  ): Promise<PracticeHumanReviewV1> {
    const run = await this.#syncRun(sessionId);
    if (run.state !== "COMPLETED") {
      throw new HttpError(409, "Human review is available after the run completes.");
    }
    const renderPath = await this.#bestAttemptRenderPath(sessionId);
    const score = (name: string): number => {
      const value = optionalNumber(body, name, 1, 5, false);
      if (value === undefined) throw new HttpError(400, name + " is required.");
      return value;
    };
    const review: PracticeHumanReviewV1 = {
      schema: "editflow.practice-human-review.v1",
      sessionId,
      editTypeId: run.editTypeId,
      sceneFidelity: score("sceneFidelity"),
      timingPacing: score("timingPacing"),
      effectsTransitions: score("effectsTransitions"),
      visualFinish: score("visualFinish"),
      overall: score("overall"),
      notes: optionalString(body, "notes") ?? null,
      createdAt: new Date().toISOString(),
      evidenceRefs: [
        "practice-human-review:NON_AUTHORITATIVE_V1",
        "practice-human-review-render:" + renderPath,
      ],
    };
    const reviewPath = this.#humanReviewPath(sessionId);
    await mkdir(path.dirname(reviewPath), { recursive: true });
    const temporary = reviewPath + ".tmp-" + randomUUID();
    await writeFile(temporary, JSON.stringify(review, null, 2) + "\n", "utf8");
    await rename(temporary, reviewPath);
    this.#runs.set(sessionId, { ...run, humanReview: review });
    return review;
  }

  async #claimAssignment(
    assignmentId: string,
    body: Record<string, unknown>,
  ): Promise<GptOrchestrationAssignmentV1> {
    const claimedBy = optionalString(body, "claimedBy") ?? "chatgpt";
    const assignment = await this.#gptStore.claim(assignmentId, claimedBy);
    await this.#syncRun(assignment.sessionId);
    return assignment;
  }

  async #compileTutorialResearch(
    assignmentId: string,
    body: Record<string, unknown>,
  ): Promise<{
    readonly assignment: GptOrchestrationAssignmentV1;
    readonly researchSource: GptResearchSourceV1;
  }> {
    const tutorialAnalysis = optionalRecord(body, "tutorialAnalysis");
    if (tutorialAnalysis === undefined) {
      throw new HttpError(400, "tutorialAnalysis is required.");
    }
    let researchSource: GptResearchSourceV1;
    try {
      researchSource = compileGptTutorialResearchSourceV1({
        packet: tutorialAnalysis as unknown as TutorialDeepAnalysisPacketV1,
        tutorialSkillId: requiredString(body, "tutorialSkillId"),
        targetSkillId: requiredString(body, "targetSkillId"),
        tutorialDriveUri: requiredString(body, "tutorialDriveUri"),
        ...(optionalString(body, "sourceId") === undefined
          ? {}
          : { sourceId: optionalString(body, "sourceId")! }),
        ...(optionalString(body, "notes") === undefined
          ? {}
          : { notes: optionalString(body, "notes")! }),
      });
    } catch (error) {
      throw new HttpError(
        400,
        "Tutorial causal compilation failed: "
          + (error instanceof Error ? error.message : String(error)),
      );
    }
    const additionalResearchSources =
      optionalResearchSources(body, "additionalResearchSources") ?? [];
    const event = await this.#gptStore.appendEvent({
      assignmentId,
      stage: "RESEARCH",
      outcome: "SUCCESS",
      summary: optionalString(body, "summary")
        ?? "Compiled deep Tutorial Drive analysis into deterministic causal skill semantics.",
      researchSources: [researchSource, ...additionalResearchSources],
      evidenceRefs: researchSource.tutorialCompilation?.evidenceRefs ?? [],
    });
    const assignment = await this.#gptStore.getAssignment(assignmentId);
    if (assignment === null) throw new HttpError(404, "GPT assignment not found.");
    if (assignment.practiceRole !== "HELD_OUT_CERTIFICATION") {
      const file = await this.#editTypes();
      const registry = await file.load();
      registry.recordGptLearningEvent(event);
      await file.save(registry);
    }
    return { assignment, researchSource };
  }

  async #recordLearningEvent(
    assignmentId: string,
    body: Record<string, unknown>,
  ): Promise<GptOrchestrationAssignmentV1> {
    const stage = requiredString(body, "stage") as GptLearningStageV1;
    const allowedStages: readonly GptLearningStageV1[] = [
      "OBSERVATION", "INTERPRETATION", "HYPOTHESIS", "PLAN",
      "CAPABILITY_GAP", "RESEARCH", "CAPABILITY_IMPLEMENTATION",
      "CAPABILITY_PROOF", "SKILL_COMMIT", "AE_ACTION", "RENDER",
      "COMPARISON", "DIAGNOSIS", "CORRECTION", "RESULT", "LESSON",
    ];
    if (!allowedStages.includes(stage)) throw new HttpError(400, "Invalid GPT learning stage.");
    const outcome = (optionalString(body, "outcome") ?? "NEUTRAL") as GptLearningOutcomeV1;
    const allowedOutcomes: readonly GptLearningOutcomeV1[] = [
      "NEUTRAL", "SUCCESS", "FAILURE", "IMPROVED", "REGRESSED",
    ];
    if (!allowedOutcomes.includes(outcome)) throw new HttpError(400, "Invalid GPT learning outcome.");
    const attemptValue = body["attempt"];
    const attempt = attemptValue === undefined
      ? undefined
      : optionalNumber(body, "attempt", 1, 10_000, true);
    const evidenceRefs = stringArray(body, "evidenceRefs", false);
    const appliedSkillIds = stringArray(body, "appliedSkillIds", false);
    const detail = optionalString(body, "detail");
    const developmentPattern = optionalString(body, "developmentPattern");
    const reusableLesson = optionalString(body, "reusableLesson");
    const avoidRepeat = optionalString(body, "avoidRepeat");
    const capabilityGap = optionalCapabilityGap(body, "capabilityGap");
    const researchSources = optionalResearchSources(body, "researchSources");
    const learnedSkill = optionalLearnedSkill(body, "learnedSkill");
    if (stage === "CAPABILITY_GAP" && capabilityGap === undefined) {
      throw new HttpError(400, "CAPABILITY_GAP requires capabilityGap.");
    }
    if (stage === "RESEARCH" && (researchSources === undefined || researchSources.length === 0)) {
      throw new HttpError(400, "RESEARCH requires at least one research source.");
    }
    if (stage === "RESEARCH"
      && researchSources?.some((source) => source.tutorialCompilation !== undefined)) {
      throw new HttpError(
        400,
        "Compiler-backed Tutorial Drive research must use the tutorial-compilations endpoint.",
      );
    }
    if (stage === "CAPABILITY_IMPLEMENTATION" && capabilityGap === undefined) {
      throw new HttpError(
        400,
        "CAPABILITY_IMPLEMENTATION requires the originating capabilityGap.",
      );
    }
    if (stage === "CAPABILITY_PROOF" && capabilityGap === undefined) {
      throw new HttpError(400, "CAPABILITY_PROOF requires the originating capabilityGap.");
    }
    if (stage === "CAPABILITY_PROOF" && evidenceRefs.length === 0) {
      throw new HttpError(400, "CAPABILITY_PROOF requires evidenceRefs.");
    }
    if (stage === "SKILL_COMMIT") {
      if (learnedSkill === undefined || capabilityGap === undefined) {
        throw new HttpError(400, "SKILL_COMMIT requires learnedSkill and resolved capabilityGap.");
      }
      if (capabilityGap.status !== "RESOLVED"
        || capabilityGap.resolutionSkillId !== learnedSkill.skillId) {
        throw new HttpError(400, "SKILL_COMMIT must resolve the gap with the committed skill.");
      }
      if (learnedSkill.maturity !== "AE_PROVEN") {
        throw new HttpError(
          400,
          "SKILL_COMMIT requires AE_PROVEN maturity. TRANSFER_VERIFIED is assigned only after machine-verified transfer Practice completion.",
        );
      }
    }
    const event = await this.#gptStore.appendEvent({
      assignmentId,
      stage,
      outcome,
      ...(attempt === undefined ? {} : { attempt }),
      summary: requiredString(body, "summary"),
      ...(detail === undefined ? {} : { detail }),
      ...(developmentPattern === undefined ? {} : { developmentPattern }),
      ...(reusableLesson === undefined ? {} : { reusableLesson }),
      ...(avoidRepeat === undefined ? {} : { avoidRepeat }),
      ...(capabilityGap === undefined ? {} : { capabilityGap }),
      ...(researchSources === undefined ? {} : { researchSources }),
      ...(learnedSkill === undefined ? {} : { learnedSkill }),
      ...(appliedSkillIds.length === 0 ? {} : { appliedSkillIds }),
      evidenceRefs,
    });
    const assignment = await this.#gptStore.getAssignment(assignmentId);
    if (assignment === null) throw new HttpError(404, "GPT assignment not found.");
    if (assignment.practiceRole !== "HELD_OUT_CERTIFICATION") {
      const file = await this.#editTypes();
      const registry = await file.load();
      registry.recordGptLearningEvent(event);
      await file.save(registry);
    }
    return assignment;
  }

  async #completeAssignment(
    assignmentId: string,
    body: Record<string, unknown>,
  ): Promise<PracticePanelRunSnapshotV1> {
    const success = body["success"];
    if (typeof success !== "boolean") throw new HttpError(400, "success must be boolean.");
    const requestedSummary = requiredString(body, "finalSummary");
    const requestedRenderRef = optionalString(body, "finalRenderRef");
    const pending = await this.#gptStore.getAssignment(assignmentId);
    if (pending === null) throw new HttpError(404, "GPT assignment not found.");

    const file = await this.#editTypes();
    const registry = await file.load();
    const sessionEvents = await this.#gptStore.eventsForSession(pending.sessionId);
    let masteryRecord: PracticeMasteryRecordV1 | undefined;
    let transferSkillUseAttestations: readonly PracticeSkillUseAttestationV1[] = [];
    let masteryScope: PracticeMasteryScopeV1 | null = null;
    let masteryProofRef: string | null = null;
    let masteryReasons: readonly string[] = [];
    let heldOutCasePassed: boolean | null = null;
    let heldOutProofVerified: boolean | null = null;
    let retainedTruthAuthorityVerified: boolean | null = null;
    let heldOutBenchmarkRobust: boolean | null = null;
    let heldOutBenchmarkCaseCount = 0;
    let finalRenderRef = requestedRenderRef;

    if (pending.mode === "PRACTICE" && pending.status === "RUNNING") {
      const practiceRole = pending.practiceRole ?? "LEARNING";
      if (requestedRenderRef === undefined) {
        masteryReasons = [
          practiceRole === "HELD_OUT_CERTIFICATION"
            ? "Held-out certification requires a final render reference."
            : "Practice mastery requires a final render reference.",
        ];
        if (practiceRole === "HELD_OUT_CERTIFICATION") {
          heldOutCasePassed = false;
          heldOutBenchmarkCaseCount = registry.knowledge(pending.editTypeId)
            ?.gptLearning.heldOutCases.length ?? 0;
        }
      } else {
        try {
          const verification = await this.#masteryVerifier.verify({
            assignment: pending,
            finalRenderRef: requestedRenderRef,
            ...(pending.practicePolicy === null ? {} : {
              minimumSimilarity: pending.practicePolicy.minimumSimilarity,
              exactSceneConfidence: pending.practicePolicy.exactSceneConfidence,
              minimumAudioConfidence: pending.practicePolicy.minimumAudioConfidence,
            }),
          });
          masteryProofRef = verification.proofRef;
          finalRenderRef = verification.proof.finalRenderRef;
          const traceReasons = practiceLearningTraceReasons(sessionEvents, practiceRole);
          masteryReasons = [...new Set([
            ...verification.proof.report.reasons,
            ...traceReasons,
          ])];

          if (practiceRole === "HELD_OUT_CERTIFICATION") {
            const appliedSkillIds = [...new Set(sessionEvents
              .filter((event) => event.outcome === "SUCCESS" || event.outcome === "IMPROVED")
              .flatMap((event) => event.appliedSkillIds ?? []))];
            const learningMemoryFile = new PracticeLearningMemoryFileV1(
              this.config.learningMemoryFilePath,
            );
            const retainedEpisodes = await learningMemoryFile.snapshot();
            const retainedEpisode = retainedEpisodes.find(
              (episode) => episode.sessionId === pending.sessionId,
            );
            const certifiedAttempt = retainedEpisode?.attempts.find(
              (attempt) => attempt.renderRef === verification.proof.finalRenderRef,
            ) ?? null;
            const certification = recordPracticeHeldOutCertificationV1({
              registry,
              editTypeId: pending.editTypeId,
              sessionId: pending.sessionId,
              proof: verification.proof,
              proofRef: verification.proofRef,
              appliedSkillIds,
              attempt: certifiedAttempt,
              repositoryRoot: this.config.repositoryRoot,
              traceReasons,
            });
            heldOutCasePassed = certification.heldOutCase.passed;
            heldOutProofVerified = certification.benchmark.heldOutProofVerified;
            retainedTruthAuthorityVerified = certification.benchmark.retainedTruthSuiteAuthorityVerified;
            heldOutBenchmarkRobust = certification.benchmark.robust;
            heldOutBenchmarkCaseCount = certification.benchmark.caseCount;
            masteryReasons = [...new Set([
              ...certification.heldOutCase.reasons,
              ...certification.benchmark.reasons,
            ])];
          } else if (verification.proof.report.passed && traceReasons.length === 0) {
            const priorRecords = registry.knowledge(pending.editTypeId)
              ?.gptLearning.masteryRecords ?? [];
            const learningMemoryFile = new PracticeLearningMemoryFileV1(
              this.config.learningMemoryFilePath,
            );
            const retainedEpisodes = await learningMemoryFile.snapshot();
            const retainedEpisode = retainedEpisodes.find(
              (episode) => episode.sessionId === pending.sessionId,
            );
            const masteredAttempt = retainedEpisode?.attempts.find(
              (attempt) => attempt.renderRef === verification.proof.finalRenderRef,
            ) ?? null;
            masteryRecord = buildPracticeMasteryRecordV1({
              sessionId: pending.sessionId,
              priorRecords,
              proof: verification.proof,
              proofRef: verification.proofRef,
              attempt: masteredAttempt,
            });
            if (masteryRecord.scope === "TRANSFER_VERIFIED") {
              const transferCandidates = (
                registry.knowledge(pending.editTypeId)?.gptLearning.learnedSkills ?? []
              ).filter((skill) =>
                skill.maturity === "AE_PROVEN" || skill.maturity === "TRANSFER_VERIFIED");
              transferSkillUseAttestations = attestPracticeSkillUseV1({
                skills: transferCandidates,
                attempt: masteredAttempt,
                proof: verification.proof,
                acceptedMaturities: ["AE_PROVEN", "TRANSFER_VERIFIED"],
              });
            }
            masteryScope = masteryRecord.scope;
            masteryReasons = [];
          }
        } catch (error) {
          if ((pending.practiceRole ?? "LEARNING") === "HELD_OUT_CERTIFICATION") {
            heldOutCasePassed = false;
          }
          masteryReasons = [
            "Practice mastery verification failed closed: "
              + (error instanceof Error ? error.message : String(error)),
          ];
        }
      }
    }

    const practiceCompletionPassed = pending.mode !== "PRACTICE"
      ? success
      : (pending.practiceRole ?? "LEARNING") === "HELD_OUT_CERTIFICATION"
        ? heldOutCasePassed === true
        : masteryRecord !== undefined;
    const summary = pending.mode !== "PRACTICE"
      ? requestedSummary
      : (pending.practiceRole ?? "LEARNING") === "HELD_OUT_CERTIFICATION"
        ? requestedSummary
          + " Held-out certification case: "
          + (heldOutCasePassed === true ? "PASS" : "FAIL")
          + ". Benchmark: "
          + String(heldOutBenchmarkCaseCount)
          + " retained case(s); held-out generalization "
          + (heldOutProofVerified === true ? "VERIFIED" : "PENDING")
          + "; retained truth authority "
          + (retainedTruthAuthorityVerified === true ? "CERTIFIED" : "PENDING")
          + "; overall "
          + (heldOutBenchmarkRobust === true ? "ROBUST." : "not yet ROBUST.")
          + (masteryReasons.length === 0 ? "" : " " + masteryReasons.join(" "))
        : masteryRecord === undefined
          ? requestedSummary + " Practice proof gate: HUMAN_REVIEW_REQUIRED. "
            + masteryReasons.join(" ")
          : requestedSummary + " Practice proof gate: " + masteryRecord.scope + ".";
    const assignment = await this.#gptStore.complete(assignmentId, {
      success: practiceCompletionPassed,
      finalSummary: summary,
      ...(finalRenderRef === undefined ? {} : { finalRenderRef }),
    });
    if (assignment.practiceRole !== "HELD_OUT_CERTIFICATION") {
      registry.completeGptLearningSession({
        editTypeId: assignment.editTypeId,
        sessionId: assignment.sessionId,
        mode: assignment.mode,
        mastered: assignment.status === "COMPLETED" && masteryRecord !== undefined,
        ...(masteryRecord === undefined ? {} : { masteryRecord }),
        ...(transferSkillUseAttestations.length === 0
          ? {}
          : { transferSkillUseAttestations }),
      });
    }
    await file.save(registry);

    const run = this.#runs.get(assignment.sessionId);
    if (run !== undefined) {
      this.#runs.set(assignment.sessionId, {
        ...run,
        masteryScope,
        masteryProofRef,
        masteryReasons,
      });
    }
    return await this.#syncRun(assignment.sessionId);
  }

  async #failAssignment(
    assignmentId: string,
    body: Record<string, unknown>,
  ): Promise<PracticePanelRunSnapshotV1> {
    const assignment = await this.#gptStore.fail(
      assignmentId,
      requiredString(body, "error"),
    );
    return await this.#syncRun(assignment.sessionId);
  }

  async #acknowledgeCancelled(
    assignmentId: string,
    body: Record<string, unknown>,
  ): Promise<PracticePanelRunSnapshotV1> {
    const summary = optionalString(body, "summary")
      ?? "GPT stopped safely after the Practice/Pro Creation cancel request.";
    const assignment = await this.#gptStore.acknowledgeCancelled(assignmentId, summary);
    return await this.#syncRun(assignment.sessionId);
  }

  async #cancelRun(sessionId: string): Promise<PracticePanelRunSnapshotV1> {
    const run = this.#runs.get(sessionId);
    if (run === undefined) throw new HttpError(404, "EditFlow run not found.");
    await this.#gptStore.requestCancel(run.assignmentId);
    return await this.#syncRun(sessionId);
  }

  async #startProCreation(
    body: Record<string, unknown>,
  ): Promise<PracticePanelRunSnapshotV1> {
    if (this.#activeRunId !== null) {
      throw new HttpError(409, "EditFlow run already active: " + this.#activeRunId);
    }
    if (this.config.broker.panelSession === null) {
      throw new HttpError(409, "After Effects CEP panel is not connected.");
    }
    const request: ProCreationBody = {
      editTypeId: requiredString(body, "editTypeId"),
      videoPaths: await Promise.all(
        stringArray(body, "videoPaths", true)
          .map((value) => ensureFile(value, "Start video")),
      ),
      audioPaths: await Promise.all(
        stringArray(body, "audioPaths", false)
          .map((value) => ensureFile(value, "Start audio")),
      ),
    };
    const sessionId = "pro:" + randomUUID();
    const start = mediaInputs(request.videoPaths, request.audioPaths ?? []);
    const file = await this.#editTypes();
    const registry = await file.load();
    const preparation = new ProCreationPreparationEngineV1(registry).prepare({
      sessionId,
      mode: "PRO_CREATION",
      editTypeId: request.editTypeId,
      start,
    });
    if (preparation.status !== "READY" || preparation.knowledge === null) {
      throw new HttpError(409, preparation.reasons.join(" "));
    }
    const assignment = await this.#gptStore.createAssignment({
      sessionId,
      mode: "PRO_CREATION",
      editTypeId: request.editTypeId,
      finish: null,
      start,
      artifactDir: path.join(this.config.artifactDir, sessionId.replace(/[:]/g, "-")),
      knowledge: preparation.knowledge,
    });
    registry.beginGptLearningSession(request.editTypeId, sessionId, "PRO_CREATION");
    await file.save(registry);
    const run: PracticePanelRunSnapshotV1 = {
      sessionId,
      assignmentId: assignment.assignmentId,
      mode: "PRO_CREATION",
      practiceRole: null,
      editTypeId: request.editTypeId,
      state: "WAITING_FOR_GPT",
      stage: null,
      startedAt: assignment.createdAt,
      completedAt: null,
      finishPath: null,
      videoPaths: request.videoPaths,
      audioPaths: request.audioPaths ?? [],
      result: null,
      allocation: null,
      masteryScope: null,
      masteryProofRef: null,
      masteryReasons: [],
      finalRenderRef: null,
      humanReview: null,
      finalSummary: null,
      error: null,
    };
    this.#activeRunId = sessionId;
    this.#runs.set(sessionId, run);
    return snapshot(run);
  }

  async #prepareProCreation(
    body: Record<string, unknown>,
  ): Promise<ProCreationPreparationResultV1> {
    const request: ProCreationBody = {
      editTypeId: requiredString(body, "editTypeId"),
      videoPaths: await Promise.all(
        stringArray(body, "videoPaths", true)
          .map((value) => ensureFile(value, "Start video")),
      ),
      audioPaths: await Promise.all(
        stringArray(body, "audioPaths", false)
          .map((value) => ensureFile(value, "Start audio")),
      ),
    };
    const file = await this.#editTypes();
    const registry = await file.load();
    return new ProCreationPreparationEngineV1(registry).prepare({
      sessionId: "pro:" + randomUUID(),
      mode: "PRO_CREATION",
      editTypeId: request.editTypeId,
      start: mediaInputs(request.videoPaths, request.audioPaths ?? []),
    });
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.#setHeaders(res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (!this.#authorized(req)) {
      jsonResponse(res, 401, { error: "UNAUTHORIZED" });
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (req.method === "GET" && url.pathname === "/v1/product/status") {
        const latestRunId = [...this.#runs.values()]
          .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
          .at(-1)?.sessionId ?? null;
        jsonResponse(res, 200, {
          service: "READY",
          panelConnected: this.config.broker.panelSession !== null,
          gptOrchestration: "ASSIGNMENT_QUEUE_READY",
          activeRunId: this.#activeRunId,
          latestRunId,
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/product/edit-types") {
        const file = await this.#editTypes();
        const registry = await file.load();
        jsonResponse(res, 200, {
          editTypes: registry.list().map((profile) => ({
            ...profile,
            knowledge: registry.knowledge(profile.editTypeId),
          })),
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/product/edit-types") {
        if (this.#activeRunId !== null) {
          throw new HttpError(409, "Cannot change Edit Types during an active Practice run.");
        }
        const body = await readJson(req);
        const file = await this.#editTypes();
        const registry = await file.load();
        const title = requiredString(body, "title");
        const description = optionalString(body, "description");
        const profile = registry.create({
          editTypeId: requiredString(body, "editTypeId"),
          title,
          choiceWords: [title],
          ...(description === undefined ? {} : { description }),
        });
        await file.save(registry);
        jsonResponse(res, 201, { editType: profile });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/product/practice") {
        jsonResponse(res, 202, { run: await this.#startPractice(await readJson(req)) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/product/pro-creation") {
        jsonResponse(res, 202, { run: await this.#startProCreation(await readJson(req)) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/product/pro-creation/prepare") {
        const result = await this.#prepareProCreation(await readJson(req));
        jsonResponse(res, 200, { preparation: result });
        return;
      }

      const runMatch = /^\/v1\/product\/(?:runs|practice)\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && runMatch !== null) {
        const id = decodeURIComponent(runMatch[1] ?? "");
        jsonResponse(res, 200, { run: await this.#syncRun(id) });
        return;
      }
      const cancelRunMatch = /^\/v1\/product\/runs\/([^/]+)\/cancel$/.exec(url.pathname);
      if (req.method === "POST" && cancelRunMatch !== null) {
        const id = decodeURIComponent(cancelRunMatch[1] ?? "");
        jsonResponse(res, 200, { run: await this.#cancelRun(id) });
        return;
      }
      const openRenderMatch = /^\/v1\/product\/runs\/([^/]+)\/open-best-attempt$/.exec(url.pathname);
      if (req.method === "POST" && openRenderMatch !== null) {
        const id = decodeURIComponent(openRenderMatch[1] ?? "");
        jsonResponse(res, 200, { run: await this.#openBestAttempt(id) });
        return;
      }
      const humanReviewMatch = /^\/v1\/product\/runs\/([^/]+)\/human-review$/.exec(url.pathname);
      if (req.method === "POST" && humanReviewMatch !== null) {
        const id = decodeURIComponent(humanReviewMatch[1] ?? "");
        jsonResponse(res, 201, {
          review: await this.#saveHumanReview(id, await readJson(req)),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/product/gpt/assignments") {
        const status = url.searchParams.get("status");
        const assignments = await this.#gptStore.listAssignments(
          status === null
            ? {}
            : { statuses: [status as GptOrchestrationAssignmentV1["status"]] },
        );
        jsonResponse(res, 200, { assignments });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/product/gpt/assignments/next") {
        const assignments = await this.#gptStore.listAssignments({ statuses: ["PENDING"] });
        jsonResponse(res, 200, { assignment: assignments[0] ?? null });
        return;
      }
      const assignmentGetMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && assignmentGetMatch !== null) {
        const id = decodeURIComponent(assignmentGetMatch[1] ?? "");
        const assignment = await this.#gptStore.getAssignment(id);
        if (assignment === null) throw new HttpError(404, "GPT assignment not found.");
        jsonResponse(res, 200, {
          assignment,
          events: await this.#gptStore.eventsForSession(assignment.sessionId),
        });
        return;
      }
      const claimMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)\/claim$/.exec(url.pathname);
      if (req.method === "POST" && claimMatch !== null) {
        const id = decodeURIComponent(claimMatch[1] ?? "");
        jsonResponse(res, 200, {
          assignment: await this.#claimAssignment(id, await readJson(req)),
        });
        return;
      }
      const tutorialCompilationMatch =
        /^\/v1\/product\/gpt\/assignments\/([^/]+)\/tutorial-compilations$/.exec(url.pathname);
      if (req.method === "POST" && tutorialCompilationMatch !== null) {
        const id = decodeURIComponent(tutorialCompilationMatch[1] ?? "");
        jsonResponse(
          res,
          201,
          await this.#compileTutorialResearch(id, await readJson(req)),
        );
        return;
      }
      const eventMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)\/events$/.exec(url.pathname);
      if (req.method === "POST" && eventMatch !== null) {
        const id = decodeURIComponent(eventMatch[1] ?? "");
        jsonResponse(res, 201, {
          assignment: await this.#recordLearningEvent(id, await readJson(req)),
        });
        return;
      }
      const completeMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)\/complete$/.exec(url.pathname);
      if (req.method === "POST" && completeMatch !== null) {
        const id = decodeURIComponent(completeMatch[1] ?? "");
        jsonResponse(res, 200, {
          run: await this.#completeAssignment(id, await readJson(req)),
        });
        return;
      }
      const failMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)\/fail$/.exec(url.pathname);
      if (req.method === "POST" && failMatch !== null) {
        const id = decodeURIComponent(failMatch[1] ?? "");
        jsonResponse(res, 200, {
          run: await this.#failAssignment(id, await readJson(req)),
        });
        return;
      }
      const cancelledMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)\/cancelled$/.exec(url.pathname);
      if (req.method === "POST" && cancelledMatch !== null) {
        const id = decodeURIComponent(cancelledMatch[1] ?? "");
        jsonResponse(res, 200, {
          run: await this.#acknowledgeCancelled(id, await readJson(req)),
        });
        return;
      }
      jsonResponse(res, 404, { error: "NOT_FOUND" });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400;
      jsonResponse(res, status, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
