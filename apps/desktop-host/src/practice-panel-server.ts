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
import { ProductionSupervisionV1, redactWorkerCredentialsV1 } from "./production-supervision.js";
import { ProductionUserControlsV1, PRODUCTION_USER_CONTROL_CONTRACT_V1, type ProductionUserControlReceiptV1 } from "./production-user-controls.js";

import {
  EditTypeRegistryFileV1,
  GptOrchestrationStoreV1,
  ProCreationPreparationEngineV1,
  attestPracticeSkillUseV1,
  compileGptTutorialResearchSourceV1,
  buildPracticeMasteryRecordV1,
  hasVerifiedPracticeSourceIdentityV1,
  LocalPracticeMediaMatcherV1,
  defaultPracticeAnalysisCacheDirectoryV1,
  practicePerceptualSetOverlapsV1,
  practicePerceptualSignatureMatchesV1,
  type GptAppendEventInputV1,
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
  PracticeProductionCoordinatorFileV1,
  PracticeProductionCoordinatorV1,
  PracticeProductionWorkerV1,
  PRACTICE_PRODUCTION_JOB_KINDS_V1,
  type PracticeProductionJobV1,
  practiceTelemetrySpanV1,
  type PracticeHeldOutBenchmarkCaseV1,
  type PracticeLearningAllocationResultV1,
  type PracticeMasteryRecordV1,
  type PracticeMasteryScopeV1,
  type PracticeMediaInputV1,
  type PracticePreflightCheckpointV1,
  type PracticeSceneMatchV1,
  type PracticeRunRoleV1,
  validatePracticeWorkingMediaMatchesV1,
  type PracticeSessionResultV1,
  type PracticeSkillUseAttestationV1,
  type ProCreationPreparationResultV1,
  validatePracticeSceneMatchesV1,
} from "../../../packages/practice-homework/src/index.js";
import type { TutorialDeepAnalysisPacketV1 } from "../../../packages/tutorial-learning/src/index.js";
import { ClipResearchStoreV1, CLIP_RESEARCH_CONTRACT_V1 } from "../../../packages/practice-homework/src/clip-research.js";
import {
  AeCepAdapterClientV11,
  AeFilesystemPolicyV11,
} from "../../../packages/adapters/ae-cep/src/v1_1.js";
import { productionJobScopeV1 } from "../../../packages/adapters/ae-cep/src/production-job-scope.js";
import { LoopbackCepBroker } from "./loopback-cep.js";
import { CurrentAeTransactionRuntimeV1, type CurrentAeStabilizationRuntimeV1 } from "./current-ae-transaction-runtime.js";
import { PRIMARY_EDIT_PRODUCTION_SYSTEM_V1, RETIRED_EDIT_EXECUTION_PATHS_V1, retiredEditExecutionResponseV1 } from "./production-authority.js";
import { LocalFastRuntimeV1 } from "./local-fast-runtime.js";
import { createPracticeM6CurrentAeAssemblyV1 } from "./practice-training-runtime.js";
import { PracticeM6AeRenderDriverCurrentV1 } from "./practice-m6-ae-render-driver.js";
import { PracticeM6LocalMediaAnalyzerV1 } from "./practice-m6-media.js";
import { runPracticeScratchSearchV1, validatePracticeScratchSearchV1 } from "./practice-scratch-search.js";
import { recordPracticeHeldOutCertificationV1 } from "./practice-held-out-certification.js";
import {
  recertifyPracticeRobustManifestV1,
  type PracticeRobustRecertificationReportV1,
} from "./practice-robust-recertification.js";
import { PracticeMasteryVerifierV1 } from "./practice-mastery-verifier.js";

export interface PracticePanelServerConfigV1 {
  readonly port: number;
  readonly token: string;
  readonly repositoryRoot: string;
  readonly artifactDir: string;
  readonly learningMemoryFilePath: string;
  readonly editTypeRegistryFilePath: string;
  readonly gptOrchestrationFilePath?: string;
  readonly retainedTruthManifestPath?: string;
  readonly broker: LoopbackCepBroker;
  readonly ffmpegPath?: string;
  readonly renderTimeoutMs?: number;
  readonly buildId?: string;
  readonly aeWriterAvailable?: () => boolean;
  /** Explicitly disabled only by isolated acceptance labs. */
  readonly productionSupervision?: boolean;
  readonly stabilization?: CurrentAeStabilizationRuntimeV1;
}

export const CHATGPT_FOOTAGE_SELECTION_CONTRACT_V1 = {
  authority: "CHATGPT_DIRECT",
  availableSelectionMethods: ["CHATGPT_DIRECT"],
  onlySelectionMethod: true,
  endpoint: "/v1/product/gpt/assignments/{id}/footage-selection",
  actions: ["BROWSE", "NOTE", "SELECT"],
  instruction: "GET returns reference shot boundaries, supplied raw media and prior GPT decisions, never ranked candidates. BROWSE takes mediaId, timesMs (1–48 explicit timestamps), width (160–1920), claimedBy. Open the returned contactSheetPath and frame paths to inspect the actual pixels. SELECT takes claimedBy, selections and search. Each selection: shotId, sourceId, sourceStartMs, sourceEndMs, direction, confidence, rationale, anchors (at least three comparisons spanning the shot). Anchor: referenceTimeMs, sourceTimeMs, referenceEvidenceId, sourceEvidenceId, observation. search: internetStatus CONSULTED with sources [{url,query,finding}], or UNAVAILABLE with reason, plus strategies. Use internet scene/dialogue/script/chapter clues first, chronological overview sheets, time-range narrowing, surrounding context, dense boundary/gesture comparisons and exact frames. Internet clues are hypotheses; directly inspected provided raw pixels decide every shot. Selection and working-clip preparation never mutate AE. Research effects separately using Tutorial Drive, Adobe, then web. Resume the same assignment; no machine-ranking fallback.",
} as const;

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
  readonly preflight?: PracticePreflightCheckpointV1;
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

export interface PracticeConnectionPreflightCheckV1 {
  readonly id: "PRODUCT_SERVICE" | "CEP_BROKER" | "CEP_PANEL" | "AFTER_EFFECTS_READBACK";
  readonly ready: boolean;
  readonly detail: string;
}

export interface PracticeConnectionPreflightV1 {
  readonly schema: "editflow.connection-preflight.v1";
  readonly status: "READY" | "BLOCKED";
  readonly checkedAt: string;
  readonly repairPolicy: "GPT_AUTO_REPAIR_THEN_RESUME";
  readonly checks: readonly PracticeConnectionPreflightCheckV1[];
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
  readonly sceneMatches?: readonly PracticeSceneMatchV1[];
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
  readonly signal?: AbortSignal;
  readonly onProgress?: (stage: PracticePreflightCheckpointV1["stage"], matches?: readonly PracticeSceneMatchV1[], shotIds?: readonly string[]) => Promise<void>;
}): Promise<PracticeHeldOutMaterialFingerprintV1> => {
  input.signal?.throwIfAborted();
  await input.onProgress?.("FINGERPRINTING");
  const referenceFingerprint = await sha256FileStream(input.finishPath);
  const rawSourceHashes: string[] = [];
  for (const videoPath of input.videoPaths) {
    input.signal?.throwIfAborted();
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
    materializeWorkingMedia: true,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    analysisCacheDir: defaultPracticeAnalysisCacheDirectoryV1(),
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
  await input.onProgress?.("REFERENCE_ANALYSIS");
  const reference = await matcher.analyzeFinish(finish);
  input.signal?.throwIfAborted();
  await input.onProgress?.("SOURCE_INDEXING", undefined, reference.shots.map((shot) => shot.shotId));
  const sourceIndex = await matcher.indexStart(start);
  input.signal?.throwIfAborted();
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
  let sceneMatches: readonly PracticeSceneMatchV1[] | undefined;
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
      onProgress: async (matches, stage) => { await input.onProgress?.(stage, matches); },
    });
    sceneMatches = matches;
    const shotIds = reference.shots.map((shot) => shot.shotId);
    const reasons = validatePracticeSceneMatchesV1(
      shotIds,
      matches,
      input.exactSceneConfidence,
    );
    const byShot = new Map(matches.map((match) => [match.shotId, match]));
    const shots: PracticeSceneCompatibilityShotV1[] = shotIds.map((shotId) => {
      const match = byShot.get(shotId);
      const repeatedGeometry = match === undefined ? false : hasVerifiedPracticeSourceIdentityV1(match);
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
    ...(sceneMatches === undefined ? {} : { sceneMatches: structuredClone(sceneMatches) }),
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
  const body = redactWorkerCredentialsV1(value);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
};

const requestBodies = new WeakMap<IncomingMessage, Record<string, unknown>>();
const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const cached = requestBodies.get(req);
  if (cached) return cached;
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
  requestBodies.set(req, parsed as Record<string, unknown>);
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
  readonly #clipResearch: ClipResearchStoreV1;
  readonly #productionCoordinatorDir: string;
  readonly #coordinators = new Map<string, Promise<{ file: PracticeProductionCoordinatorFileV1; coordinator: PracticeProductionCoordinatorV1 }>>();
  readonly #productionWorker: PracticeProductionWorkerV1;
  readonly #supervision: ProductionSupervisionV1 | null;
  readonly #userControls: ProductionUserControlsV1;
  #aeWriterOwner: string | null = null;
  #childProofScope: { key: string; jobId: string; body: Record<string, any> } | null = null;
  #childProofTail: Promise<unknown> = Promise.resolve();
  readonly #masteryVerifier: PracticeMasteryVerifierV1;
  readonly #transactionRuntime: CurrentAeTransactionRuntimeV1;
  #fastRuntime: LocalFastRuntimeV1 | null = null;
  #fastRuntimePromise: Promise<LocalFastRuntimeV1> | null = null;
  #controlRequestCounter = 0;
  #startingPractice: Promise<PracticePanelRunSnapshotV1> | null = null;
  readonly #preflightJobs = new Map<string, { abort: AbortController; promise: Promise<void> }>();
  readonly #preflightErrors = new Map<string, string>();
  readonly #footageSelectionTails = new Map<string, Promise<unknown>>();

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
    this.#clipResearch = new ClipResearchStoreV1(
      path.join(path.dirname(this.#gptStore.filePath), "clip-research"),
      [process.env.USERPROFILE ?? config.repositoryRoot, config.repositoryRoot, config.artifactDir],
    );
    this.#productionCoordinatorDir = path.join(
      path.dirname(this.#gptStore.filePath),
      "production-coordinator",
    );
    this.#supervision = config.productionSupervision === false ? null : new ProductionSupervisionV1(
      path.join(path.dirname(this.#gptStore.filePath), "production-supervision"));
    this.#userControls = new ProductionUserControlsV1(path.join(path.dirname(this.#gptStore.filePath), "production-supervision"));
    this.#productionWorker = new PracticeProductionWorkerV1(
      path.join(this.#productionCoordinatorDir, "jobs.jsonl"),
      (job, signal) => this.#executeProductionJob(job, signal),
      async (id) => (await this.#gptStore.getAssignment(id))?.status === "RUNNING",
      async (id) => { const state = this.#supervision?.publicState(); return !state || state.assignmentId !== id || state.state === "ARMED"; },
    );
    this.#masteryVerifier = new PracticeMasteryVerifierV1({
      repositoryRoot: config.repositoryRoot,
      ...(config.ffmpegPath === undefined ? {} : { ffmpegPath: config.ffmpegPath }),
    });
    this.#transactionRuntime = new CurrentAeTransactionRuntimeV1(
      config.broker,
      "practice-gpt-controller",
      64,
      config.stabilization ?? null,
      96,
      new AeFilesystemPolicyV11([
        process.env.USERPROFILE ?? config.repositoryRoot,
      ]),
    );
  }

  #productionCoordinatorFile(assignment: GptOrchestrationAssignmentV1): PracticeProductionCoordinatorFileV1 {
    const key = createHash("sha256").update(assignment.sessionId, "utf8").digest("hex");
    return new PracticeProductionCoordinatorFileV1(
      path.join(this.#productionCoordinatorDir, key + ".json"),
      path.join(this.#productionCoordinatorDir, key + ".telemetry.jsonl"),
    );
  }

  async #productionCoordinator(
    assignment: GptOrchestrationAssignmentV1,
  ): Promise<{ file: PracticeProductionCoordinatorFileV1; coordinator: PracticeProductionCoordinatorV1 }> {
    let retained = this.#coordinators.get(assignment.sessionId);
    if (!retained) {
      retained = this.#loadProductionCoordinator(assignment);
      this.#coordinators.set(assignment.sessionId, retained);
      retained.catch(() => { this.#coordinators.delete(assignment.sessionId); });
    }
    const production = await retained;
    await this.#synchronizeProductionSources(assignment, production);
    return production;
  }

  async #loadProductionCoordinator(
    assignment: GptOrchestrationAssignmentV1,
  ): Promise<{ file: PracticeProductionCoordinatorFileV1; coordinator: PracticeProductionCoordinatorV1 }> {
    const file = this.#productionCoordinatorFile(assignment);
    const coordinator = await file.load() ?? new PracticeProductionCoordinatorV1(
      assignment.sessionId, (assignment.practiceSceneMatches ?? []).map((match) => match.shotId),
      assignment.preflight?.stage !== "READY",
    );
    return { file, coordinator };
  }

  async #synchronizeProductionSources(assignment: GptOrchestrationAssignmentV1,
    { file, coordinator }: { file: PracticeProductionCoordinatorFileV1; coordinator: PracticeProductionCoordinatorV1 }): Promise<void> {
    const before = JSON.stringify(coordinator.snapshot());
    if (assignment.mode === "PRO_CREATION") {
      const ledger = await this.#clipResearch.snapshot(assignment);
      coordinator.ensurePhases(Object.keys(ledger.clips));
      for (const [clipId, clip] of Object.entries(ledger.clips) as [string, Record<string, any>][]) {
        const source = assignment.start.find((item) => item.mediaId === clip.scan.sourceMediaId && item.mediaKind === "VIDEO");
        if (!source) throw new HttpError(409, "Pro Creation clip source is not a provided raw video.");
        const key = "pro-source-lock:" + createHash("sha256").update(JSON.stringify({
          sourceIdentity: await this.#sourceIdentity(source.uri), sourceRangeMs: clip.scan.sourceRangeMs,
          inspectionHash: clip.scanHash,
        })).digest("hex");
        const prior = coordinator.snapshot().phases.find((phase) => phase.phaseId === clipId)!;
        if (prior.sourceCertificateKey !== key && (prior.sourceCertificateKey || prior.sourceValidationRequired)
          && prior.sourceValidationToken === clip.scanHash) {
          if (!prior.sourceValidationRequired) coordinator.requireSourceValidation(clipId);
          continue;
        }
        coordinator.lockSource(clipId, key, ledger.updatedAt ?? assignment.createdAt, clip.scanHash);
        if (clip.plan?.status === "READY" && !clip.stale) coordinator.markResearchReady(clipId, clip.plan.planId);
      }
      if (before !== JSON.stringify(coordinator.snapshot())) await file.save(coordinator);
      return;
    }
    coordinator.ensurePhases((assignment.practiceSceneMatches ?? []).map((match) => match.shotId));
    for (const match of assignment.practiceSceneMatches ?? []) {
      const sourceStartMs = Number.isFinite(match.sourceStartMs) ? match.sourceStartMs : 0;
      const sourceEndMs = Number.isFinite(match.sourceEndMs) ? match.sourceEndMs : sourceStartMs + 1;
      const certificate = createHash("sha256").update(JSON.stringify({
        sourceId: match.sourceId, sourceStartMs, sourceEndMs, direction: match.direction,
        sourceIdentity: await this.#sourceIdentity(match.sourcePath ?? assignment.start.find((item) => item.mediaId === match.sourceId)?.uri),
        referenceIdentity: await this.#sourceIdentity(assignment.finish?.uri),
      })).digest("hex");
      const key = "source-lock:" + certificate;
      const existing = coordinator.snapshot().phases.find((phase) => phase.phaseId === match.shotId)!;
      if (existing.sourceCertificateKey === key) continue;
      const legacyKey = "source-lock:" + createHash("sha256").update(JSON.stringify({
        sourceId: match.sourceId, sourceStartMs, sourceEndMs, direction: match.direction,
        playbackRate: match.playbackRate, confidence: match.confidence,
      })).digest("hex");
      if (existing.sourceCertificateKey === legacyKey) {
        coordinator.migrateSourceCertificate(match.shotId, key, assignment.preflight?.updatedAt);
        continue;
      }
      const freshlyValidated = assignment.preflight?.stage === "READY"
        && Date.parse(assignment.preflight.updatedAt) > Date.parse(existing.sourceValidatedAt ?? assignment.createdAt);
      if ((existing.sourceCertificateKey || existing.sourceValidationRequired) && !freshlyValidated) {
        if (!existing.sourceValidationRequired) coordinator.requireSourceValidation(match.shotId);
        continue;
      }
      if (assignment.preflight?.stage === "READY") coordinator.lockSource(match.shotId, key, assignment.preflight.updatedAt);
    }
    if (before !== JSON.stringify(coordinator.snapshot())) await file.save(coordinator);
  }

  async #sourceIdentity(value?: string): Promise<unknown> {
    if (!value) return null;
    try { const metadata = await stat(value); return { path: path.resolve(value), size: metadata.size, mtimeMs: metadata.mtimeMs }; }
    catch { return { path: path.resolve(value), missing: true }; }
  }

  #reserveAeWriter(owner: string): () => void {
    if (owner.startsWith("production-job:") && this.config.aeWriterAvailable?.() === false) throw new HttpError(423, "AE_MUTATION_LEASE_HELD");
    if (this.#aeWriterOwner !== null) throw new HttpError(423, "AE_WRITER_BUSY: " + this.#aeWriterOwner);
    this.#aeWriterOwner = owner;
    return () => { if (this.#aeWriterOwner === owner) this.#aeWriterOwner = null; };
  }

  async #executeProductionJob(job: PracticeProductionJobV1, signal: AbortSignal): Promise<{ result: unknown; reviewRequired?: boolean }> {
    let assignment = await this.#gptStore.getAssignment(job.assignmentId);
    if (!assignment || assignment.status !== "RUNNING" || assignment.sessionId !== this.#activeRunId) throw new HttpError(409, "Assignment no longer accepts production work.");
    await this.assertPracticeReconstructionReady();
    const body = structuredClone(job.payload) as Record<string, any>;
    if (job.kind === "REFERENCE_ANALYSIS") {
      if (!assignment.finish || !Number.isFinite(body.startMs) || !Number.isFinite(body.endMs)
        || body.startMs < 0 || body.endMs <= body.startMs || body.endMs - body.startMs > 2000) throw new TypeError("Reference preparation requires a bounded two-second window.");
      const startedAtMs = Date.now();
      const media = new PracticeM6LocalMediaAnalyzerV1({ repositoryRoot: this.config.repositoryRoot, artifactDir: assignment.artifactDir });
      const result = await media.analyzeVideo({ videoPath: assignment.finish.uri, sourceId: job.jobId,
        sourceKind: "REFERENCE", startMs: body.startMs, endMs: body.endMs });
      const production = await this.#productionCoordinator(assignment);
      await production.file.appendTelemetry(practiceTelemetrySpanV1({ spanId: job.jobId,
        sessionId: assignment.sessionId, category: "MEDIA_ANALYSIS", stage: "RESEARCH",
        startedAtMs, endedAtMs: Date.now() }));
      return { result };
    }
    const owner = body.researchContext?.claimedBy;
    if (typeof owner !== "string") throw new TypeError("Queued production requires an authorized researchContext.");
    // The queue owns accepted decisions across GPT handoffs. It revalidates all
    // research/media evidence but does not reclaim a retired chat's lease.
    const admission = await this.assertClipResearchReady(body, job.kind === "BUILD_BASELINE", true);
    signal.throwIfAborted();
    const production = await this.#productionCoordinator(assignment);
    const strategy = production.coordinator.strategyDirective();
    if (strategy.action === "ESCALATE_STRATEGY") return { result: { strategy, nextAction: production.coordinator.nextAction() }, reviewRequired: true };
    const output = await this.#withProductionOperation({ body: job.kind === "BUILD_BASELINE" ? { ...body, globalOperation: true } : body,
      category: job.kind === "SCRATCH_SEARCH" || job.kind === "LOCAL_RENDER" ? "RENDER" : "AE_MUTATION",
      stage: job.kind === "BUILD_BASELINE" ? "WHOLE_EDIT_COVERAGE" : job.kind === "SCRATCH_SEARCH" || job.kind === "LOCAL_RENDER" ? "LOCAL_PROOF" : "AE_CONSTRUCTION",
      operation: job.jobId, markConstructed: ["AE_TRANSACTION", "AE_CORRECTION", "AE_GOAL", "AE_BATCH"].includes(job.kind),
      run: async () => {
        if (job.kind === "AE_TRANSACTION" || job.kind === "AE_CORRECTION") {
          const result = job.kind === "AE_TRANSACTION" ? await this.#transactionRuntime.execute(body.plan ?? body)
            : await this.#transactionRuntime.executeCorrection(body.plan ?? body);
          if (result.state !== "COMMITTED") throw new Error("Queued AE transaction failed: " + result.state);
          return { result };
        }
        if (job.kind === "AE_GOAL" || job.kind === "AE_BATCH") {
          const runtime = await this.#ensureFastRuntime();
          const result = job.kind === "AE_GOAL" ? await runtime.runGoal(body.goal, body.transactionId ?? job.jobId)
            : await runtime.runRoutineBatch(body.intents, body.transactionId ?? job.jobId);
          if (job.kind === "AE_BATCH" && result.completedActions !== body.intents.length) throw new Error("Queued AE batch stopped before every authorized action completed; reconcile actual state.");
          return { result: { ...result, state: result.escalationReason ? "REVIEW_REQUIRED" : "COMMITTED" }, reviewRequired: !!result.escalationReason };
        }
        if (job.kind === "PROOF_SCRIPT") {
          const response = await this.#dispatchWorkerProofScript(requiredString(body, "scriptPath"), job.jobId);
          // Opaque scripts always require readback review before another job proceeds.
          return { result: response, reviewRequired: true };
        }
        if (job.kind === "BUILD_BASELINE") {
          if (assignment!.mode !== "PRACTICE") throw new HttpError(400, "Practice baseline uses a Finish reference; Pro Creation constructs its editorial plan with AE_BATCH/AE_TRANSACTION.");
          const reference = JSON.parse(await readFile(await ensureFile(requiredString(body, "referenceAnalysisPath"), "reference analysis"), "utf8"));
          const audioMatch = JSON.parse(await readFile(await ensureFile(requiredString(body, "audioMatchPath"), "audio match"), "utf8"));
          // Source choices come exclusively from the current GPT selection ledger.
          // A cached machine-match path supplied by an old continuation has no authority.
          const matches = assignment!.practiceSceneMatches ?? [];
          if (!matches.length || matches.some((match) => match.selectionMode !== "CHATGPT_DIRECT")) throw new TypeError("Baseline requires retained direct ChatGPT shot selections.");
          const assembly = createPracticeM6CurrentAeAssemblyV1({ transport: this.config.broker, projectId: "practice-gpt-controller",
            repositoryRoot: this.config.repositoryRoot, artifactDir: assignment!.artifactDir,
            mediaRoots: [process.env.USERPROFILE ?? this.config.repositoryRoot],
            ...(this.config.ffmpegPath ? { ffmpegPath: this.config.ffmpegPath } : {}),
            ...(this.config.renderTimeoutMs ? { renderTimeoutMs: this.config.renderTimeoutMs } : {}) });
          const baseline = await assembly.baselineBuilder.buildContentBaseline({ reference, matches, audioMatch });
          const revision = Number(String((await this.#transactionRuntime.observe()).projectRevision).replace(/^ae-revision:/, ""));
          production.coordinator.markWholeEditCovered(Number.isFinite(revision) ? revision : null);
          await production.file.save(production.coordinator);
          return { result: { baseline, plan: assembly.baselineBuilder.plan(baseline.baselineId) } };
        }
        const driver = new PracticeM6AeRenderDriverCurrentV1({ transport: this.config.broker,
          projectId: "practice-gpt-controller", artifactDir: assignment!.artifactDir,
          ...(this.config.renderTimeoutMs === undefined ? {} : { renderTimeoutMs: this.config.renderTimeoutMs }) });
        if (job.kind === "SAVE_CHECKPOINT") {
          const client = driver.client;
          const observed = await client.observe(driver.projectId);
          const projectPath = path.join(assignment!.artifactDir, "production-checkpoint.aep");
          const result = await client.executePublic("project.save", { transactionId: job.jobId, operationId: job.jobId,
            payload: { path: projectPath }, expectedState: observed.observed });
          if (result.outcome === "FAILED" || result.outcome === "REJECTED") throw new Error("AE checkpoint save failed.");
          const { file, coordinator } = await this.#productionCoordinator(assignment!);
          coordinator.markAeCheckpoint({ projectPath, projectRevision: result.hostProjectRevision,
            activeCompId: typeof body.compStableId === "string" ? body.compStableId : null });
          await file.save(coordinator);
          return { result };
        }
        if (job.kind === "LOCAL_RENDER") {
          if (!Number.isFinite(body.startMs) || !Number.isFinite(body.endMs) || body.endMs <= body.startMs || body.startMs < 0
            || typeof body.compStableId !== "string") throw new TypeError("Local render needs a bounded time window and compStableId.");
          return { result: await driver.renderWindow({ sessionId: assignment!.sessionId, attempt: 0,
            compStableId: body.compStableId, windowId: body.clipId ?? job.jobId, startMs: body.startMs, endMs: body.endMs }), reviewRequired: true };
        }
        if (!assignment!.finish) throw new TypeError("Scratch search requires a visual reference.");
        const search = await runPracticeScratchSearchV1({ body, sessionId: assignment!.sessionId,
          referencePath: assignment!.finish.uri, renderDriver: driver,
          media: new PracticeM6LocalMediaAnalyzerV1({ repositoryRoot: this.config.repositoryRoot, artifactDir: assignment!.artifactDir }),
          signal, ...(this.config.ffmpegPath ? { ffprobePath: this.config.ffmpegPath.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1") } : {}) });
        if (search.winner) {
          production.coordinator.recordSearchResult(body.clipId, body.hypothesisKey ?? "native-parameter-search", search.winner.score);
          await production.file.save(production.coordinator);
        }
        return { result: search, reviewRequired: true };
      },
    });
    await this.recordClipResearchExecution(admission, "HTTP_COMPLETED");
    return output;
  }

  async #dispatchWorkerProofScript(value: string, operationId: string) {
    const scriptPath = path.resolve(this.config.repositoryRoot, value);
    if (path.extname(scriptPath).toLowerCase() !== ".jsx" || !["scripts/windows", "proofs/artifacts"].some((directory) => {
      const relative = path.relative(path.resolve(this.config.repositoryRoot, directory), scriptPath);
      return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    })) throw new HttpError(400, "PROOF_SCRIPT_PATH_NOT_ALLOWED");
    await readFile(scriptPath, "utf8");
    const panel = this.config.broker.panelSession;
    if (!panel) throw new Error("CEP_PANEL_NOT_CONNECTED");
    const response = await this.config.broker.dispatch({ protocolVersion: panel.protocolVersion,
      requestId: operationId, transactionId: operationId, operationId,
      capabilityId: "internal.proof.eval_file", command: "proof.eval_file", payload: { scriptPath } });
    if (response.outcome !== "APPLIED") throw new Error("Queued native proof script failed: " + response.error?.message);
    return response;
  }

  async #assignmentForProductionBody(body: Record<string, any>): Promise<GptOrchestrationAssignmentV1 | null> {
    const assignmentId = typeof body?.researchContext?.assignmentId === "string" ? body.researchContext.assignmentId : null;
    return assignmentId === null ? null : await this.#gptStore.getAssignment(assignmentId);
  }

  async #withProductionOperation<T>(input: {
    readonly body: Record<string, any>;
    readonly category: "AE_MUTATION" | "RENDER" | "COMPARISON" | "PROOF_IO" | "INFRASTRUCTURE";
    readonly stage: any;
    readonly operation: string;
    readonly markConstructed?: boolean;
    readonly run: () => Promise<T>;
  }): Promise<T> {
    const assignment = await this.#assignmentForProductionBody(input.body);
    const releaseWriter = this.#reserveAeWriter(input.operation);
    if (!assignment || assignment.status !== "RUNNING" || assignment.sessionId !== this.#activeRunId) {
      releaseWriter();
      throw new HttpError(409, "AE execution requires the active RUNNING production assignment.");
    }
    try {
    const { file, coordinator } = await this.#productionCoordinator(assignment);
    const phaseIds: string[] = Array.isArray(input.body?.researchContext?.plans)
      ? input.body.researchContext.plans
        .map((plan: any) => typeof plan?.clipId === "string" ? plan.clipId : null)
        .filter((value: string | null): value is string => value !== null)
      : [];
    const productionSnapshot = coordinator.snapshot();
    if (productionSnapshot.phases.some((phase) => phase.sourceValidationRequired)) {
      throw new HttpError(409, "SOURCE_CHANGED_REQUIRES_VALIDATION: rerun source validation before AE writes.");
    }
    const broadMutationLimit = Math.max(3, Math.ceil(productionSnapshot.phases.length * 0.25));
    if (input.category === "AE_MUTATION"
      && productionSnapshot.wholeEditCovered
      && phaseIds.length > broadMutationLimit
      && input.body["globalOperation"] !== true) {
      throw new HttpError(
        409,
        "BROAD_MUTATION_REQUIRES_GLOBAL_DECLARATION: whole-edit coverage is already established; "
          + "target only the affected clip/boundary plans, or set globalOperation=true for a genuinely global edit.",
      );
    }
    if (input.category === "AE_MUTATION") coordinator.invalidate(phaseIds.filter((id) =>
      ["CONSTRUCTED", "PROVISIONAL_PASS", "PROVEN"].includes(productionSnapshot.phases.find((phase) => phase.phaseId === id)?.state ?? "")), "PROOF");
    coordinator.setStage(input.stage, phaseIds.length === 1 ? phaseIds[0]! : null);
    coordinator.heartbeat(input.operation);
    await file.save(coordinator);
    const startedAtMs = Date.now();
    const heartbeatTimer = setInterval(() => {
      coordinator.heartbeat(input.operation);
      void file.save(coordinator).catch(() => undefined);

    }, 20_000);
    heartbeatTimer.unref?.();
    try {
      const scope = { key: randomUUID(), jobId: input.operation, body: input.body };
      this.#childProofScope = scope;
      const result = await productionJobScopeV1.run({
        EDITFLOW_WORKER_PROOF_URL: `http://127.0.0.1:${this.#port}/v1/product/production/worker-proof`,
        EDITFLOW_WORKER_PROOF_KEY: scope.key, EDITFLOW_WORKER_PRODUCT_TOKEN: this.config.token,
      }, input.run);
      const success = (result as any)?.state === "COMMITTED" || (result as any)?.result?.state === "COMMITTED"
        || (result as any)?.status === "COMPLETED" || (result as any)?.outcome === "APPLIED";
      if (input.markConstructed && success) {
        const readback = await this.#transactionRuntime.observe();
        const revision = Number(String(readback.projectRevision).replace(/^ae-revision:/, ""));
        for (const phaseId of phaseIds) {
          coordinator.markConstructed(phaseId, Number.isFinite(revision) ? revision : null);
        }
      }
      await file.appendTelemetry(practiceTelemetrySpanV1({
        spanId: randomUUID(), sessionId: assignment.sessionId, category: input.category,
        stage: input.stage, phaseId: phaseIds.length === 1 ? phaseIds[0]! : null,
        startedAtMs, endedAtMs: Date.now(), outcome: "SUCCESS", detail: input.operation,
      }));
      return result;
    } catch (error) {
      await file.appendTelemetry(practiceTelemetrySpanV1({
        spanId: randomUUID(), sessionId: assignment.sessionId, category: input.category,
        stage: input.stage, phaseId: phaseIds.length === 1 ? phaseIds[0]! : null,
        startedAtMs, endedAtMs: Date.now(), outcome: "FAILED",
        detail: input.operation + ": " + (error instanceof Error ? error.message : String(error)),
      }));
      throw error;
    } finally {
      await this.#childProofTail.catch(() => undefined);
      this.#childProofScope = null;
      clearInterval(heartbeatTimer);
      coordinator.heartbeat(null);
      await file.save(coordinator);
    }
    } finally { releaseWriter(); }
  }

  get port(): number { return this.#port; }
  get isStarted(): boolean { return this.#server !== null; }
  get activeRunId(): string | null { return this.#activeRunId; }

  async start(): Promise<number> {
    if (this.#server !== null) return this.#port;
    this.#supervision?.acquireGateway();
    await this.#gptStore.refreshActiveProductionInstructions();
    await this.#recoverRuns();
    if (this.#supervision) await this.#supervisionSnapshot();
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
    await this.#productionWorker.start();
    for (const assignment of await this.#gptStore.listAssignments({ mode: "PRACTICE", statuses: ["PENDING", "RUNNING"] })) {
      if (assignment.preflight !== undefined && assignment.preflight.stage !== "READY"
        && assignment.preflight.stage !== "BLOCKED") this.#schedulePreflight(assignment.assignmentId);
    }
    return this.#port;
  }

  async stop(): Promise<void> {
    await this.#productionWorker.stop();
    for (const job of this.#preflightJobs.values()) job.abort.abort();
    await Promise.allSettled([...this.#preflightJobs.values()].map((job) => job.promise));
    const server = this.#server;
    this.#server = null;
    if (server !== null) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    }
    this.#port = 0;
    this.#supervision?.releaseGateway();
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

  async observeCurrentAe() {
    return await (await this.#ensureFastRuntime()).refresh();
  }

  controlStatus() {
    return { primaryProductionSystem: PRIMARY_EDIT_PRODUCTION_SYSTEM_V1,
      executionMode: PRIMARY_EDIT_PRODUCTION_SYSTEM_V1,
      hostRevision: this.#fastRuntime?.session.runner.hostRevision ?? null,
      adapterBuild: this.#fastRuntime?.session.adapterBuild ?? null,
      localRuntime: this.#fastRuntime?.status() ?? null,
      currentTransactionRuntime: this.#transactionRuntime.status(),
      productionSupervisor: this.#supervision?.publicState() ?? null,
      userControls: { contract: PRODUCTION_USER_CONTROL_CONTRACT_V1, active: this.#userControls.active(), latest: this.#userControls.latest() },
      mutationLease: { held: this.#aeWriterOwner !== null, owner: this.#aeWriterOwner, expiresAt: null } };
  }

  async #connectionPreflight(): Promise<PracticeConnectionPreflightV1> {
    const checks: PracticeConnectionPreflightCheckV1[] = [{
      id: "PRODUCT_SERVICE",
      ready: this.isStarted,
      detail: this.isStarted
        ? "Practice product service is listening."
        : "Practice product service is not listening.",
    }];
    checks.push({
      id: "CEP_BROKER",
      ready: this.config.broker.isStarted,
      detail: this.config.broker.isStarted
        ? "EditFlow CEP broker is listening on 127.0.0.1:" + String(this.config.broker.port) + "."
        : "EditFlow CEP broker is not listening.",
    });
    const panel = this.config.broker.panelSession;
    checks.push({
      id: "CEP_PANEL",
      ready: panel !== null,
      detail: panel === null
        ? "After Effects CEP panel is missing or stale."
        : "After Effects CEP panel is live; protocol=" + panel.protocolVersion
          + " extension=" + panel.extensionVersion + ".",
    });

    if (this.config.broker.isStarted && panel !== null) {
      try {
        const state = await this.#transactionRuntime.observe();
        checks.push({
          id: "AFTER_EFFECTS_READBACK",
          ready: true,
          detail: "Live After Effects readback succeeded; revision=" + state.projectRevision + ".",
        });
      } catch (error) {
        checks.push({
          id: "AFTER_EFFECTS_READBACK",
          ready: false,
          detail: "Live After Effects readback failed: "
            + (error instanceof Error ? error.message : String(error)),
        });
      }
    } else {
      checks.push({
        id: "AFTER_EFFECTS_READBACK",
        ready: false,
        detail: "Live After Effects readback was not attempted because the CEP path is not ready.",
      });
    }

    return {
      schema: "editflow.connection-preflight.v1",
      status: checks.every((check) => check.ready) ? "READY" : "BLOCKED",
      checkedAt: new Date().toISOString(),
      repairPolicy: "GPT_AUTO_REPAIR_THEN_RESUME",
      checks,
    };
  }

  async #requireConnectionPreflight(): Promise<PracticeConnectionPreflightV1> {
    const preflight = await this.#connectionPreflight();
    if (preflight.status === "READY") return preflight;
    const failed = preflight.checks
      .filter((check) => !check.ready)
      .map((check) => check.id + ": " + check.detail)
      .join(" ");
    throw new HttpError(
      409,
      "CONNECTION_PREFLIGHT_BLOCKED: " + failed
        + " GPT must automatically pause assignment work, use Desktop Commander to restore the failed connection legs, "
        + "rerun the full preflight, verify READY, and then resume from the last safe checkpoint without waiting for user confirmation. No assignment was created.",
    );
  }

  #setHeaders(res: ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-EditFlow-Token, X-EditFlow-Worker-Credential");
    res.setHeader("Cache-Control", "no-store");
  }

  #authorized(req: IncomingMessage): boolean {
    const provided = header(req.headers["x-editflow-token"]);
    return provided.length > 0 && secureTokenEqual(this.config.token, provided);
  }

  async #editTypes(): Promise<EditTypeRegistryFileV1> {
    return new EditTypeRegistryFileV1(this.config.editTypeRegistryFilePath);
  }

  #retainedTruthManifestPath(): string {
    return path.resolve(
      this.config.retainedTruthManifestPath
        ?? path.join(this.config.repositoryRoot, "proofs", "practice", "retained-truth-corpus.json"),
    );
  }

  async #recertifyRobust(editTypeId: string): Promise<PracticeRobustRecertificationReportV1> {
    if (this.#activeRunId !== null) {
      throw new HttpError(409, "Cannot recertify ROBUST while an EditFlow run is active.");
    }
    const manifestPath = this.#retainedTruthManifestPath();
    let manifestStats: Awaited<ReturnType<typeof stat>>;
    try {
      manifestStats = await stat(manifestPath);
    } catch {
      throw new HttpError(
        409,
        "Retained truth corpus manifest is unavailable: " + manifestPath,
      );
    }
    if (!manifestStats.isFile()) {
      throw new HttpError(409, "Retained truth corpus manifest is not a file: " + manifestPath);
    }

    const file = await this.#editTypes();
    const registry = await file.load();
    if (registry.get(editTypeId) === null) {
      throw new HttpError(404, "Edit Type not found: " + editTypeId);
    }
    const report = await recertifyPracticeRobustManifestV1({
      registry,
      manifestPath,
      repositoryRoot: this.config.repositoryRoot,
    });
    if (report.editTypeId !== editTypeId) {
      throw new HttpError(
        409,
        "Retained truth corpus targets Edit Type " + report.editTypeId
          + ", not " + editTypeId + ".",
      );
    }
    await file.save(registry);
    return report;
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
          ...(assignment.preflight === undefined ? {} : { preflight: assignment.preflight }),
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

  async #startPractice(body: Record<string, unknown>, plannedSessionId?: string): Promise<PracticePanelRunSnapshotV1> {
    if (this.#userControls.active() && plannedSessionId !== this.#userControls.active()?.plannedSessionId) {
      throw new HttpError(409, "USER_CONTROL_ALREADY_PENDING: finish the requested lifecycle action first.");
    }
    if (this.#startingPractice !== null) return await this.#startingPractice;
    const pending = this.#createPractice(body, plannedSessionId);
    this.#startingPractice = pending;
    try { return await pending; } finally { this.#startingPractice = null; }
  }

  async #createPractice(body: Record<string, unknown>, plannedSessionId?: string): Promise<PracticePanelRunSnapshotV1> {
    if (this.#activeRunId !== null) {
      const active = this.#runs.get(this.#activeRunId);
      if (active?.mode === "PRACTICE" && (!plannedSessionId || active.sessionId === plannedSessionId)
        && !["CANCELLED", "COMPLETED", "FAILED"].includes(active.state)) {
        return await this.#syncRun(active.sessionId);
      }
      throw new HttpError(409, "EditFlow run already active: " + this.#activeRunId);
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

    const sessionId = plannedSessionId ?? "practice:" + randomUUID();
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
    const preflight: PracticePreflightCheckpointV1 = {
      stage: "PREFLIGHT_MATCHING", updatedAt: new Date().toISOString(),
      requireTransferNovelty: request.practiceRole === null && autoLifecycleStage === "TRANSFER_LEARNING",
      completedShotIds: [], unresolvedShotIds: [], reasons: [], evidenceRefs: [],
    };
    const assignment = await this.#gptStore.createAssignment({
      sessionId,
      mode: "PRACTICE",
      practiceRole,
      editTypeId: editType.editTypeId,
      finish,
      start,
      preflight,
      practiceSceneMatches: null,
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
      preflight,
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
    this.#schedulePreflight(assignment.assignmentId);
    return snapshot(run);
  }

  #schedulePreflight(assignmentId: string): void {
    if (this.#preflightJobs.has(assignmentId)) return;
    const abort = new AbortController();
    this.#preflightErrors.delete(assignmentId);
    const promise = Promise.resolve().then(() => this.#runPreflight(assignmentId, abort.signal))
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        // A locked checkpoint must not turn the background worker into an unhandled rejection.
        // Keep the last durable assignment; expose the failure for a same-assignment retry.
        const message = error instanceof Error ? error.message : String(error);
        this.#preflightErrors.set(assignmentId, message);
        console.error("Practice preflight paused: " + message);
      })
      .finally(() => this.#preflightJobs.delete(assignmentId));
    this.#preflightJobs.set(assignmentId, { abort, promise });
  }

  async #runPreflight(assignmentId: string, signal: AbortSignal): Promise<void> {
    let assignment = await this.#gptStore.getAssignment(assignmentId);
    if (assignment?.preflight === undefined || assignment.finish === null
      || !["PENDING", "RUNNING"].includes(assignment.status) || assignment.preflight.stage === "READY") return;
    let checkpoint = assignment.preflight;
    const progress = async (stage: PracticePreflightCheckpointV1["stage"], matches?: readonly PracticeSceneMatchV1[], shotIds?: readonly string[]): Promise<void> => {
      signal.throwIfAborted();
      const retained = matches ?? assignment!.practiceSceneMatches ?? [];
      checkpoint = { ...checkpoint, stage, updatedAt: new Date().toISOString(), reasons: [],
        totalShotIds: shotIds ?? checkpoint.totalShotIds ?? retained.map((match) => match.shotId),
        completedShotIds: retained.filter((match) => match.workingMedia !== undefined
          && validatePracticeSceneMatchesV1([match.shotId], [match], assignment!.practicePolicy!.exactSceneConfidence).length === 0)
          .map((match) => match.shotId),
        unresolvedShotIds: (shotIds ?? checkpoint.totalShotIds ?? retained.map((match) => match.shotId)).filter((shotId) => {
          const match = retained.find((item) => item.shotId === shotId);
          return match === undefined || match.workingMedia === undefined
            || validatePracticeSceneMatchesV1([shotId], [match], assignment!.practicePolicy!.exactSceneConfidence).length > 0;
        }),
        evidenceRefs: [...new Set(retained.flatMap((match) => match.evidenceRefs))],
      };
      assignment = await this.#gptStore.updatePreflight(assignmentId, checkpoint, matches);
    };
    try {
      // Reference and raw-source analysis can proceed while AE is temporarily disconnected.
      const preflightStartedAt = Date.now();
      const material = await fingerprintPracticeHeldOutMaterialV1({
        finishPath: assignment.finish.uri,
        videoPaths: assignment.start.filter((item) => item.mediaKind === "VIDEO").map((item) => item.uri),
        repositoryRoot: this.config.repositoryRoot, artifactDir: assignment.artifactDir,
        exactSceneConfidence: assignment.practicePolicy?.exactSceneConfidence ?? 0.95,
        ...(this.config.ffmpegPath === undefined ? {} : { ffmpegPath: this.config.ffmpegPath }),
        signal, onProgress: progress,
      });
      signal.throwIfAborted();
      if (assignment !== null) {
        const { file, coordinator } = await this.#productionCoordinator(assignment);
        coordinator.setStage("SOURCE_LOCK");
        await file.appendTelemetry(practiceTelemetrySpanV1({
          spanId: randomUUID(), sessionId: assignment.sessionId,
          category: "MEDIA_ANALYSIS", stage: "SOURCE_LOCK",
          startedAtMs: preflightStartedAt, endedAtMs: Date.now(), outcome: "SUCCESS",
          detail: "reference-decomposition-source-index-exact-scene-and-audio-preflight",
        }));
        await file.save(coordinator);
      }
      const reasons = [...validatePracticePreAeSceneCompatibilityV1({ material }),
        ...validatePracticeWorkingMediaMatchesV1(material.sceneMatches ?? [])];
      const registry = await (await this.#editTypes()).load();
      const knowledge = registry.knowledge(assignment.editTypeId);
      if (checkpoint.requireTransferNovelty) reasons.push(...validatePracticeTransferLearningMaterialV1({
        material, masteryRecords: knowledge?.gptLearning.masteryRecords ?? [],
      }));
      if (assignment.practiceRole === "HELD_OUT_CERTIFICATION") reasons.push(...validatePracticeHeldOutMaterialNoveltyV1({
        material, masteryRecords: knowledge?.gptLearning.masteryRecords ?? [],
        heldOutCases: knowledge?.gptLearning.heldOutCases ?? [],
      }));
      const connection = await this.#connectionPreflight();
      signal.throwIfAborted();
      for (const check of connection.checks.filter((item) => !item.ready)) reasons.push(check.id + ": " + check.detail);
      const unresolvedShotIds = material.sceneCompatibility?.shots.filter((shot) => !shot.exact
        || !material.sceneMatches?.find((match) => match.shotId === shot.shotId)?.workingMedia).map((shot) => shot.shotId) ?? [];
      await progress("WORKING_MEDIA", material.sceneMatches ?? []);
      checkpoint = { ...checkpoint, stage: reasons.length === 0 ? "READY" : unresolvedShotIds.length > 0 ? "AWAITING_CHATGPT_SHOTS" : "BLOCKED",
        updatedAt: new Date().toISOString(), unresolvedShotIds, reasons: [...new Set(reasons)],
        evidenceRefs: [...checkpoint.evidenceRefs, ...(material.sceneCompatibility?.evidenceRefs ?? [])],
      };
      await this.#gptStore.updatePreflight(assignmentId, checkpoint, material.sceneMatches ?? []);
    } catch (error) {
      if (signal.aborted) return; // Shutdown/cancel preserves the last durable operation for the next controller.
      await this.#gptStore.updatePreflight(assignmentId, { ...checkpoint, stage: "BLOCKED",
        updatedAt: new Date().toISOString(), reasons: [error instanceof Error ? error.message : String(error)] });
    }
  }

  async assertPracticeReconstructionReady(): Promise<void> {
    if (this.#activeRunId === null) return;
    const run = this.#runs.get(this.#activeRunId);
    if (run === undefined) throw new HttpError(409, "Active assignment is unavailable.");
    const assignment = await this.#gptStore.getAssignment(run.assignmentId);
    if (!assignment) throw new HttpError(409, "Active assignment is unavailable.");
    const matches = assignment.practiceSceneMatches ?? [];
    const shotIds = assignment.preflight?.totalShotIds ?? [];
    if (assignment.mode === "PRACTICE"
      && (assignment.preflight?.stage !== "READY" || !shotIds.length
        || !matches.length || new Set(matches.map((match) => match.shotId)).size !== matches.length
        || validatePracticeSceneMatchesV1(shotIds, matches, assignment.practicePolicy?.exactSceneConfidence ?? .95).length > 0
        || matches.some((match) => match.selectionMode !== "CHATGPT_DIRECT"
          || !hasVerifiedPracticeSourceIdentityV1(match)
          || !assignment.start.some((media) => media.mediaKind === "VIDEO"
            && media.role === "START_SOURCE" && media.mediaId === match.sourceId)))) {
      throw new HttpError(409, "Practice reconstruction is locked until preflight is READY; resume the retained assignment.");
    }
  }

  async assertClipResearchReady(body: Record<string, any>, allClips = false, queuedExecution = false): Promise<Record<string, any> | null> {
    if (this.#activeRunId === null) return null;
    const run = this.#runs.get(this.#activeRunId);
    if (run === undefined) throw new HttpError(409, "Active assignment is unavailable.");
    const assignment = await this.#gptStore.getAssignment(run.assignmentId);
    if (assignment === null) throw new HttpError(409, "Active assignment is unavailable.");
    try {
      const admitted = await this.#clipResearch.admit(assignment, body, queuedExecution);
      if (allClips && assignment.mode === "PRACTICE") {
        const declared = new Set(admitted.plans.map((plan: Record<string, any>) => plan.clipId));
        if ((assignment.practiceSceneMatches ?? []).some((match) => !declared.has(match.shotId))) {
          throw new TypeError("CLIP_RESEARCH_REQUIRED: Baseline assembly needs plans for all affected clips.");
        }
      }
      await this.#clipResearch.audit(assignment, admitted, "ADMITTED");
      return { ...admitted, assignment };
    } catch (error) { throw new HttpError(409, error instanceof Error ? error.message : String(error)); }
  }

  async recordClipResearchExecution(admission: Record<string, any> | null, outcome: string): Promise<void> {
    if (admission !== null) await this.#clipResearch.audit(admission.assignment, admission, outcome);
  }

  async #resumeHandshake(): Promise<Record<string, unknown>> {
    const active = this.#activeRunId === null ? null : this.#runs.get(this.#activeRunId);
    const assignment = active === null || active === undefined ? null : await this.#gptStore.getAssignment(active.assignmentId);
    const events = assignment === null ? [] : await this.#gptStore.eventsForSession(assignment.sessionId);
    const preflight = assignment?.preflight ?? null;
    const clipResearch = assignment === null ? null : await this.#clipResearch.snapshot(assignment);
    let production = null;
    if (assignment !== null) {
      const { file, coordinator } = await this.#productionCoordinator(assignment);
      for (const [clipId, clip] of Object.entries((clipResearch?.clips ?? {}) as Record<string, any>)) {
        if (clip?.plan?.status !== "READY") continue;
        const phase = coordinator.snapshot().phases.find((item) => item.phaseId === clipId);
        if (phase?.researchKey === clip.plan.planId) continue;
        coordinator.markResearchReady(clipId, clip.plan.planId);
      }
      await file.save(coordinator);
      production = coordinator.snapshot();
    }
    const nextOperation = assignment === null ? "START_PRACTICE"
      : assignment.status === "CANCEL_REQUESTED" ? "ACKNOWLEDGE_CANCELLATION"
      : preflight?.stage === "AWAITING_CHATGPT_SHOTS" ? "CHATGPT_INSPECT_AND_SELECT_RAW_SHOTS"
      : preflight !== null && preflight.stage !== "READY" ? "RESUME_PREFLIGHT"
      : "RESUME_GPT_EDITING_FROM_CHECKPOINT";
    return {
      schema: "editflow.practice-resume.v1", runtimeId: "RESUMABLE_PREFLIGHT_V1",
      buildId: this.config.buildId ?? null, panel: this.config.broker.panelSession,
      aeConnection: this.config.broker.panelSession === null ? "DISCONNECTED" : "CEP_CONNECTED",
      repositoryRoot: this.config.repositoryRoot, statePath: this.#gptStore.filePath,
      panelConnected: this.config.broker.panelSession !== null,
      assignment, preflight, checkpoint: events.at(-1) ?? null, nextOperation,
      clipResearch: assignment === null ? null : this.#clipResearch.publicView(await this.#clipResearch.snapshot(assignment)),
      production,
      workerRunning: assignment !== null && (
        this.#preflightJobs.has(assignment.assignmentId)
        || this.#productionWorker.list(assignment.assignmentId).some((job) => job.status === "RUNNING")
        || production?.inFlightOperation != null && Date.now() - Date.parse(production.workerHeartbeatAt ?? "") < 60_000
      ),
      productionJobs: assignment === null ? [] : this.#productionWorker.list(assignment.assignmentId),
      footageSelection: CHATGPT_FOOTAGE_SELECTION_CONTRACT_V1,
      workerError: assignment === null ? null : this.#preflightErrors.get(assignment.assignmentId) ?? null,
      userControls: { contract: PRODUCTION_USER_CONTROL_CONTRACT_V1, active: this.#userControls.active(), latest: this.#userControls.latest() },
      controllerRoute: "DESKTOP_COMMANDER_LOCAL_PRODUCT_API",
      resumeRequired: assignment !== null,
    };
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
      ...(assignment.preflight === undefined ? {} : { preflight: assignment.preflight }),
      state,
      stage: latestEvent?.stage ?? run.stage,
      completedAt: assignment.completedAt,
      finalRenderRef: assignment.finalRenderRef,
      finalSummary: assignment.finalSummary,
      error: this.#preflightErrors.get(assignment.assignmentId) ?? assignment.error,
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

  #parseLearningEvent(
    assignmentId: string,
    body: Record<string, unknown>,
  ): GptAppendEventInputV1 {
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
    return {
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
    };
  }

  async #recordLearningEvents(
    assignmentId: string,
    bodies: readonly Record<string, unknown>[],
  ): Promise<GptOrchestrationAssignmentV1> {
    const inputs = bodies.map((body) => this.#parseLearningEvent(assignmentId, body));
    const events = await this.#gptStore.appendEvents(inputs);
    const assignment = await this.#gptStore.getAssignment(assignmentId);
    if (assignment === null) throw new HttpError(404, "GPT assignment not found.");
    if (assignment.practiceRole !== "HELD_OUT_CERTIFICATION") {
      const file = await this.#editTypes();
      const registry = await file.load();
      for (const event of events) registry.recordGptLearningEvent(event);
      await file.save(registry);
    }
    return assignment;
  }

  async #recordLearningEvent(
    assignmentId: string,
    body: Record<string, unknown>,
  ): Promise<GptOrchestrationAssignmentV1> {
    return await this.#recordLearningEvents(assignmentId, [body]);
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
    this.#preflightJobs.get(run.assignmentId)?.abort.abort();
    await this.#productionWorker.cancel(run.assignmentId);
    return await this.#syncRun(sessionId);
  }

  async #startProCreation(
    body: Record<string, unknown>,
  ): Promise<PracticePanelRunSnapshotV1> {
    if (this.#userControls.active()) throw new HttpError(409, "USER_CONTROL_ALREADY_PENDING");
    if (this.#activeRunId !== null) {
      throw new HttpError(409, "EditFlow run already active: " + this.#activeRunId);
    }
    await this.#requireConnectionPreflight();
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

  async #requestUserControl(body: Record<string, any>): Promise<Record<string, any>> {
    if (!this.#supervision) throw new HttpError(409, "PRODUCTION_SUPERVISION_REQUIRED");
    if (body.action === "STATUS") {
      const receipt = body.requestId ? this.#userControls.get(requiredString(body, "requestId")) : this.#userControls.latest();
      if (body.requestId && !receipt) throw new HttpError(404, "USER_CONTROL_NOT_FOUND");
      return { receipt, contract: PRODUCTION_USER_CONTROL_CONTRACT_V1 };
    }
    if (body.userRequested !== true) throw new HttpError(400, "EXPLICIT_USER_REQUEST_REQUIRED");
    const requestId = requiredString(body, "requestId");
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(requestId)) throw new HttpError(400, "INVALID_USER_CONTROL_REQUEST_ID");
    return await this.#userControls.exclusive(async () => {
      if (body.action === "RETRY") {
        const prior = this.#userControls.get(requestId);
        if (!prior || prior.status !== "BLOCKED") throw new HttpError(409, "USER_CONTROL_NOT_BLOCKED");
        return { receipt: this.#userControls.update(requestId, { status: "PENDING", error: null }) };
      }
      const action = requiredString(body, "action") as ProductionUserControlReceiptV1["action"];
      if (!["START_PRACTICE", "RESTART_PRACTICE", "REPLACE_CHAT", "CANCEL"].includes(action)) throw new HttpError(400, "UNKNOWN_USER_CONTROL_ACTION");
      const expectedAssignmentId = action === "START_PRACTICE" ? null : requiredString(body, "expectedAssignmentId");
      const inputFields = ["editTypeId", "editTypeTitle", "finishPath", "videoPaths", "audioPaths", "practiceRole", "minimumSimilarity", "exactSceneConfidence", "minimumAudioConfidence"];
      const supplied = body.input ?? body;
      const requestedInput = action === "START_PRACTICE" ? Object.fromEntries(inputFields.filter(k => supplied[k] !== undefined).map(k => [k, supplied[k]])) : null;
      const fingerprint = this.#userControls.fingerprint({ action, expectedAssignmentId, input: requestedInput });
      const prior = this.#userControls.get(requestId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new HttpError(409, "REQUEST_ID_REUSED_WITH_DIFFERENT_INTENT");
        return { receipt: prior };
      }
      if (this.#userControls.active()) throw new HttpError(409, "USER_CONTROL_ALREADY_PENDING");
      const assignments = await this.#gptStore.listAssignments();
      const source = assignments.find(a => a.assignmentId === expectedAssignmentId);
      const unfinished = assignments.find(a => ["PENDING", "RUNNING", "CANCEL_REQUESTED"].includes(a.status));
      if (unfinished && unfinished.assignmentId !== expectedAssignmentId) throw new HttpError(409, "ANOTHER_ASSIGNMENT_IS_ACTIVE");
      if (expectedAssignmentId && !source) throw new HttpError(404, "GPT_ASSIGNMENT_NOT_FOUND");
      if (action === "REPLACE_CHAT" && (!source || !["PENDING", "RUNNING", "FAILED"].includes(source.status))) {
        throw new HttpError(409, "REPLACE_CHAT_REQUIRES_UNFINISHED_ASSIGNMENT: choose RESTART_PRACTICE for a fresh attempt.");
      }
      let input: Record<string, unknown> | null = requestedInput;
      if (action === "RESTART_PRACTICE") {
        if (source?.mode !== "PRACTICE" || !source.finish) throw new HttpError(409, "RESTART_REQUIRES_PRACTICE_ASSIGNMENT");
        input = { editTypeId: source.editTypeId, practiceRole: source.practiceRole,
          finishPath: source.finish.uri, videoPaths: source.start.filter(m => m.mediaKind === "VIDEO").map(m => m.uri),
          audioPaths: source.start.filter(m => m.mediaKind === "AUDIO").map(m => m.uri), ...source.practicePolicy };
      }
      // Validate chosen media before stopping the existing assignment.
      if (input) await this.#parsePractice(input);
      const now = new Date().toISOString();
      const receipt = this.#userControls.submit({ requestId, action, fingerprint, status: "PENDING", step: "QUEUED",
        expectedAssignmentId, previousAssignmentId: expectedAssignmentId, assignmentId: action === "REPLACE_CHAT" ? expectedAssignmentId : null,
        sessionId: action === "REPLACE_CHAT" ? source!.sessionId : null,
        plannedSessionId: input ? "practice:" + randomUUID() : null, input, generation: null, tabId: null,
        createdAt: now, updatedAt: now, deliveredAt: null, completedAt: null, error: null });
      return { receipt, contract: PRODUCTION_USER_CONTROL_CONTRACT_V1 };
    });
  }

  async #finalizeCancellation(assignmentId: string): Promise<PracticePanelRunSnapshotV1> {
    const authority = this.#supervision!.publicState();
    if (authority.assignmentId === assignmentId && authority.state === "ARMED") throw new HttpError(409, "WORKER_MUST_BE_REVOKED_FIRST");
    if (this.#aeWriterOwner || this.#productionWorker.list(assignmentId).some(j => j.status === "RUNNING") || this.#preflightJobs.has(assignmentId)) {
      throw new HttpError(409, "CANCELLATION_DRAIN_PENDING");
    }
    const assignment = await this.#gptStore.getAssignment(assignmentId);
    if (!assignment) throw new HttpError(404, "GPT_ASSIGNMENT_NOT_FOUND");
    if (!["CANCEL_REQUESTED", "CANCELLED"].includes(assignment.status)) throw new HttpError(409, "ASSIGNMENT_NOT_CANCELLING");
    if (assignment.status === "CANCEL_REQUESTED") await this.#gptStore.acknowledgeCancelled(assignmentId, "Supervisor verified revoked worker and drained production before completing user cancellation.");
    return await this.#syncRun(assignment.sessionId);
  }

  async #advanceUserControl(body: Record<string, any>): Promise<Record<string, any>> {
    return await this.#userControls.exclusive(async () => {
      const id = requiredString(body, "requestId");
      let receipt = this.#userControls.get(id);
      if (!receipt) throw new HttpError(404, "USER_CONTROL_NOT_FOUND");
      if (receipt.status !== "PENDING") return { receipt };
      if (body.action === "CONTROL_BEGIN" && receipt.step === "QUEUED") {
        const authority = this.#supervision!.publicState();
        if (authority.state !== "IDLE" && authority.assignmentId !== receipt.expectedAssignmentId) throw new HttpError(409, "USER_CONTROL_ASSIGNMENT_CHANGED");
        if (authority.assignmentId && authority.state !== "IDLE") {
          await this.#supervision!.revoke(authority.assignmentId, authority.generation, "explicit_user_" + receipt.action.toLowerCase());
          const old = await this.#gptStore.getAssignment(authority.assignmentId);
          if (old?.controllerLease) await this.#gptStore.releaseController(old.assignmentId, old.controllerLease.owner);
        }
        if (["RESTART_PRACTICE", "CANCEL"].includes(receipt.action)) {
          const old = await this.#gptStore.getAssignment(receipt.expectedAssignmentId!);
          if (old && !["CANCELLED", "COMPLETED", "FAILED"].includes(old.status)) await this.#cancelRun(old.sessionId);
        }
        receipt = this.#userControls.update(id, { step: "STOPPING" });
      } else if (body.action === "CONTROL_PREPARE" && ["STOPPING", "DRAINING", "PREPARING"].includes(receipt.step)) {
        this.#userControls.update(id, { step: "DRAINING" });
        const old = receipt.expectedAssignmentId ? await this.#gptStore.getAssignment(receipt.expectedAssignmentId) : null;
        if (this.#aeWriterOwner || (old && (this.#productionWorker.list(old.assignmentId).some(j => j.status === "RUNNING") || this.#preflightJobs.has(old.assignmentId)))) return { receipt: this.#userControls.get(id) };
        if (old?.status === "CANCEL_REQUESTED") await this.#finalizeCancellation(old.assignmentId);
        if (receipt.action === "CANCEL") return { receipt: this.#userControls.update(id, { status: "COMPLETED", step: "DONE", completedAt: new Date().toISOString() }) };
        receipt = this.#userControls.update(id, { step: "PREPARING" });
        try {
          let target = old;
          if (receipt.input) {
            // The session ID is persisted before creation; crash recovery cannot create a second assignment.
            target = (await this.#gptStore.listAssignments()).find(a => a.sessionId === receipt!.plannedSessionId) ?? null;
            if (!target) {
              await this.#requireConnectionPreflight();
              const run = await this.#startPractice(receipt.input, receipt.plannedSessionId!);
              target = await this.#gptStore.getAssignment(run.assignmentId);
            }
          } else if (target?.status === "FAILED") {
            target = await this.#gptStore.resumeFailedProduction(target.assignmentId);
            this.#activeRunId = target.sessionId; await this.#syncRun(target.sessionId);
          }
          if (!target || ["COMPLETED", "CANCELLED", "CANCEL_REQUESTED"].includes(target.status)) throw new HttpError(409, "USER_CONTROL_TARGET_NOT_RUNNABLE");
          await this.#supervision!.bind(target);
          receipt = this.#userControls.update(id, { assignmentId: target.assignmentId, sessionId: target.sessionId, step: "LAUNCHING", error: null });
        } catch (error) {
          receipt = this.#userControls.update(id, { status: "BLOCKED", error: error instanceof Error ? error.message : String(error) });
        }
      } else if (body.action === "CONTROL_DELIVERED") {
        if (!["LAUNCHING", "VERIFYING"].includes(receipt.step)) throw new HttpError(409, "USER_CONTROL_NOT_LAUNCHING");
        if (!Number.isInteger(body.tabId)) throw new HttpError(400, "INVALID_WORKER_TAB_ID");
        const a = this.#supervision!.publicState();
        if (a.assignmentId !== receipt.assignmentId || a.launchId !== receipt.requestId || a.state !== "ARMED") throw new HttpError(409, "STALE_USER_CONTROL_DELIVERY");
        receipt = this.#userControls.update(id, { step: "VERIFYING", generation: a.generation, tabId: Number(body.tabId), deliveredAt: new Date().toISOString() });
      } else if (body.action === "CONTROL_FAILED" && receipt.step === "VERIFYING") {
        receipt = this.#userControls.update(id, { status: "FAILED", error: requiredString(body, "error") });
      }
      return { receipt };
    });
  }

  async #supervisionSnapshot(): Promise<Record<string, any>> {
    const assignments = await this.#gptStore.listAssignments();
    const authority = this.#supervision!.publicState();
    const active = assignments.find((a) => a.assignmentId === authority.assignmentId && !["COMPLETED", "CANCELLED"].includes(a.status))
      ?? assignments.find((a) => a.sessionId === this.#activeRunId)
      ?? assignments.find((a) => ["PENDING", "RUNNING", "CANCEL_REQUESTED"].includes(a.status)) ?? null;
    await this.#supervision!.bind(active && !["COMPLETED", "CANCELLED"].includes(active.status) ? active : null);
    const request = this.#userControls.active(), currentAuthority = this.#supervision!.publicState();
    if (request?.status === "PENDING" && request.step === "VERIFYING" && request.assignmentId === active?.assignmentId
      && request.generation === currentAuthority.generation && currentAuthority.state === "ARMED"
      && active.status === "RUNNING" && active.controllerLease?.owner.startsWith(`ef-worker:${request.generation}:`)) {
      this.#userControls.update(request.requestId, { status: "COMPLETED", step: "DONE", completedAt: new Date().toISOString(), error: null });
    }
    const production = active ? (await this.#productionCoordinator(active)).coordinator.snapshot() : null;
    const jobs = active ? this.#productionWorker.list(active.assignmentId) : [];
    return { authority: this.#supervision!.publicState(), assignment: active ? { assignmentId: active.assignmentId,
      sessionId: active.sessionId, mode: active.mode, status: active.status, preflight: active.preflight ?? null,
      cancelRequestedAt: active.cancelRequestedAt, artifactDir: active.artifactDir } : null,
      production, jobs: jobs.map((job) => ({ jobId: job.jobId, kind: job.kind, status: job.status,
        updatedAt: job.updatedAt, createdAt: job.createdAt, startedAt: job.startedAt,
        heartbeatAt: job.heartbeatAt, error: job.error, operationSignature: job.requestKey })),
      writerOwner: this.#aeWriterOwner, hostRevision: this.controlStatus().hostRevision,
      preflightRunning: active ? this.#preflightJobs.has(active.assignmentId) : false,
      userControl: this.#userControls.active(), latestUserControl: this.#userControls.latest(),
      panelLastSeenAt: this.config.broker.panelSession?.lastSeenAt ?? null };
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (this.#supervision && this.#authorized(req) && url.pathname === "/v1/product/production/supervision") {
        if (req.headers["x-editflow-supervisor-key"] !== this.#supervision.key) throw new HttpError(403, "SUPERVISOR_KEY_REQUIRED");
        if (req.method === "GET") { jsonResponse(res, 200, await this.#supervisionSnapshot()); return; }
        if (req.method === "POST") {
          const body = await readJson(req);
          if (typeof body.action === "string" && ["CONTROL_BEGIN", "CONTROL_PREPARE", "CONTROL_DELIVERED", "CONTROL_FAILED"].includes(body.action)) {
            jsonResponse(res, 200, await this.#advanceUserControl(body)); return;
          }
          const state = this.#supervision.publicState();
          const id = requiredString(body, "assignmentId");
          if (id !== state.assignmentId) throw new HttpError(409, "SUPERVISOR_ASSIGNMENT_MISMATCH");
          let credential: string | undefined;
          if (body.action === "ISSUE") {
            credential = await this.#supervision.issue(id, requiredString(body, "launchId"));
            const assignment = await this.#gptStore.getAssignment(id);
            if (assignment?.controllerLease && assignment.controllerLease.owner !== credential) {
              await this.#gptStore.releaseController(id, assignment.controllerLease.owner);
            }
          }
          else if (body.action === "REVOKE" || body.action === "PAUSE") {
            await this.#supervision.revoke(id, Number(body.generation), requiredString(body, "reason"), body.action === "PAUSE");
            const assignment = await this.#gptStore.getAssignment(id);
            if (assignment?.controllerLease) await this.#gptStore.releaseController(id, assignment.controllerLease.owner);
          } else if (body.action === "INTERRUPT") {
            await this.#productionWorker.interrupt(id, requiredString(body, "reason"));
          } else if (body.action === "RECOVER_FAILED") {
            const resumed = await this.#gptStore.resumeFailedProduction(id);
            this.#activeRunId = resumed.sessionId;
            await this.#syncRun(resumed.sessionId);
          } else if (body.action === "FINALIZE_CANCEL") {
            jsonResponse(res, 200, { run: await this.#finalizeCancellation(id) }); return;
          } else if (body.action === "RESUME") await this.#supervision.resume(id);
          else throw new HttpError(400, "UNKNOWN_SUPERVISOR_ACTION");
          // This private response is the only route that returns the credential.
          const payload = JSON.stringify({ ok: true, authority: this.#supervision.publicState(), credential });
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(payload); return;
        }
      }
      const match = /^\/v1\/product\/gpt\/assignments\/([^/]+)\//.exec(url.pathname);
      if (this.#supervision && this.#authorized(req) && req.method === "POST" && match) {
        await this.#supervisionSnapshot();
        const body = await readJson(req) as Record<string, any>;
        const credential = req.headers["x-editflow-worker-credential"] ?? body.claimedBy ?? body.payload?.researchContext?.claimedBy;
        if (typeof credential === "string") {
          body.claimedBy = credential;
          if (body.payload?.researchContext) body.payload.researchContext.claimedBy = credential;
        }
        // Serialize revoke against the entire admission/write, including slow validations.
        await this.#supervision.authorized(decodeURIComponent(match[1]!), credential, { path: url.pathname, body }, async () => {
          await this.#handleAuthorized(req, res); return res.statusCode;
        }); return;
      }
      await this.#handleAuthorized(req, res);
    } catch (error) {
      this.#setHeaders(res);
      jsonResponse(res, typeof (error as any).status === "number" ? (error as any).status : 500,
        { error: error instanceof Error ? error.message : String(error) });
    }
  }

  async #handleAuthorized(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
      if (RETIRED_EDIT_EXECUTION_PATHS_V1.has(url.pathname)) {
        jsonResponse(res, 410, retiredEditExecutionResponseV1());
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/product/production/worker-proof") {
        const scope = this.#childProofScope;
        const key = req.headers["x-editflow-worker-key"];
        if (!scope || this.#aeWriterOwner !== scope.jobId || typeof key !== "string" || key !== scope.key) {
          throw new HttpError(409, "WORKER_JOB_SCOPE_REQUIRED: native capability helpers execute only inside the current durable writer job.");
        }
        const body = await readJson(req);
        const operation = this.#childProofTail.catch(() => undefined).then(async () => {
          if (this.#childProofScope !== scope) throw new HttpError(409, "Worker job scope expired.");
          await this.assertClipResearchReady(scope.body, false, true);
          return await this.#dispatchWorkerProofScript(requiredString(body, "scriptPath"), scope.jobId + ":child:" + randomUUID());
        });
        this.#childProofTail = operation;
        jsonResponse(res, 200, { ok: true, response: await operation, productionJobId: scope.jobId });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/product/gpt/clip-research-contract") {
        jsonResponse(res, 200, CLIP_RESEARCH_CONTRACT_V1);
        return;
      }
      const clipResearchMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)\/clip-research$/.exec(url.pathname);
      const footageMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)\/footage-selection$/.exec(url.pathname);
      if ((req.method === "GET" || req.method === "POST") && footageMatch !== null) {
        const id = decodeURIComponent(footageMatch[1] ?? "");
        const assignment = await this.#gptStore.getAssignment(id);
        if (!assignment) throw new HttpError(404, "GPT assignment not found.");
        const matcher = new LocalPracticeMediaMatcherV1({ artifactDir: path.join(assignment.artifactDir, "media"),
          analysisCacheDir: defaultPracticeAnalysisCacheDirectoryV1(), materializeWorkingMedia: true,
          scriptPath: path.join(this.config.repositoryRoot, "scripts", "practice", "practice-media-match.py"),
          ...(this.config.ffmpegPath ? { ffmpegPath: this.config.ffmpegPath } : {}) });
        if (req.method === "GET") {
          const reference = assignment.finish ? await matcher.analyzeFinish(assignment.finish) : null;
          const sourceIndex = await matcher.indexStart(assignment.start);
          jsonResponse(res, 200, { contract: CHATGPT_FOOTAGE_SELECTION_CONTRACT_V1, reference, sourceIndex,
            searchState: await matcher.footageSearchState(sourceIndex),
            referenceMedia: assignment.finish, rawMedia: assignment.start.filter((media) => media.mediaKind === "VIDEO"),
            selections: (assignment.practiceSceneMatches ?? []).filter((match) => match.selectionMode === "CHATGPT_DIRECT"),
            legacyCandidatesDiscarded: true });
          return;
        }
        const body = await readJson(req) as Record<string, any>;
        const lease = assignment.controllerLease;
        if (assignment.status !== "RUNNING" || assignment.sessionId !== this.#activeRunId
          || !lease || lease.owner !== body.claimedBy || Date.parse(lease.expiresAt) <= Date.now()) throw new HttpError(409, "Direct footage work requires the current live controller.");
        const operation = (this.#footageSelectionTails.get(id) ?? Promise.resolve()).catch(() => undefined).then(async () => {
          if (body.action === "BROWSE") {
            const media = [...assignment.start, ...(assignment.finish ? [assignment.finish] : [])].find((item) => item.mediaId === body.mediaId);
            if (!media) throw new HttpError(400, "Only provided raw footage and the visual reference can be browsed.");
            return { inspection: await matcher.inspectFootage(media, body.timesMs, body.width ?? 640) };
          }
          if (body.action === "NOTE") {
            const media = assignment.start.find((item) => item.mediaId === body.mediaId);
            if (!media) throw new HttpError(400, "Search notes must identify provided raw footage.");
            await matcher.recordFootageSearchNote(media, body.note);
            return { recorded: true };
          }
          if (body.action !== "SELECT" || !assignment.finish) throw new HttpError(400, "SELECT requires a Practice reference; Pro Creation browses raw footage and records its designed ranges in clip research.");
          const preflight = this.#preflightJobs.get(id);
          if (preflight) { preflight.abort.abort(); await preflight.promise; }
          const reference = await matcher.analyzeFinish(assignment.finish);
          const sourceIndex = await matcher.indexStart(assignment.start);
          const selections = await matcher.selectFootage({ reference, sourceIndex, finish: assignment.finish, start: assignment.start,
            selections: body.selections, search: body.search });
          await this.#gptStore.updatePreflight(id, { ...assignment.preflight!, stage: "WORKING_MEDIA",
            requireTransferNovelty: assignment.preflight?.requireTransferNovelty ?? false,
            completedShotIds: [], unresolvedShotIds: reference.shots.map((shot) => shot.shotId),
            updatedAt: new Date().toISOString(), reasons: [], evidenceRefs: [] }, selections);
          // Decoding selected working ranges may outlive a connector request. Keep
          // the selection receipt durable and let resumable preflight prepare them.
          this.#schedulePreflight(id);
          const updated = await this.#gptStore.getAssignment(id);
          return { selections: updated?.practiceSceneMatches, preflight: updated?.preflight,
            nextAction: "Poll the same assignment preflight; do not resubmit accepted selections.",
            contract: CHATGPT_FOOTAGE_SELECTION_CONTRACT_V1 };
        });
        this.#footageSelectionTails.set(id, operation);
        try { jsonResponse(res, 201, await operation); }
        finally { if (this.#footageSelectionTails.get(id) === operation) this.#footageSelectionTails.delete(id); }
        return;
      }
      if ((req.method === "GET" || req.method === "POST") && clipResearchMatch !== null) {
        const id = decodeURIComponent(clipResearchMatch[1] ?? "");
        const assignment = await this.#gptStore.getAssignment(id);
        if (assignment === null) throw new HttpError(404, "GPT assignment not found.");
        let ledger;
        if (req.method === "POST") {
          const events = await this.#gptStore.eventsForSession(assignment.sessionId);
          const compiledSources = events.filter((event) => event.stage === "RESEARCH").flatMap((event) => event.researchSources ?? []);
          const body = await readJson(req);
          try { ledger = await this.#clipResearch.record(assignment, body, compiledSources); }
          catch (error) { throw new HttpError(409, error instanceof Error ? error.message : String(error)); }
          if (body["action"] === "PLAN" && typeof body["clipId"] === "string") {
            const plan = ledger.clips?.[body["clipId"]]?.plan;
            if (plan?.status === "READY") {
              const { file, coordinator } = await this.#productionCoordinator(assignment);
              coordinator.markResearchReady(body["clipId"], plan.planId);
              await file.save(coordinator);
            }
          }
        } else ledger = await this.#clipResearch.snapshot(assignment);
        jsonResponse(res, req.method === "POST" ? 201 : 200, { clipResearch: this.#clipResearch.publicView(ledger, url.searchParams.get("includeAuditHistory") === "true") });
        return;
      }
      const productionMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)\/production$/.exec(url.pathname);
      const jobMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)\/production-jobs$/.exec(url.pathname);
      if ((req.method === "GET" || req.method === "POST") && jobMatch !== null) {
        const id = decodeURIComponent(jobMatch[1] ?? "");
        const assignment = await this.#gptStore.getAssignment(id);
        if (!assignment) throw new HttpError(404, "GPT assignment not found.");
        if (req.method === "POST") {
          const body = await readJson(req) as Record<string, any>;
          if (body.action === "RESOLVE") {
            const lease = assignment.controllerLease;
            if (!lease || lease.owner !== body.claimedBy || Date.parse(lease.expiresAt) <= Date.now()) throw new HttpError(409, "Production review requires the current controller.");
            const job = this.#productionWorker.list(id).find((item) => item.jobId === body.jobId);
            if (!job) throw new HttpError(404, "Production job not found.");
            if (typeof body.reviewEvidenceRef !== "string" || !body.reviewEvidenceRef.trim()) throw new HttpError(400, "Review/reconciliation requires retained evidence.");
            await this.#productionWorker.resolve(job.jobId, { ...body.result, reviewEvidenceRef: body.reviewEvidenceRef });
          } else {
            if (!PRACTICE_PRODUCTION_JOB_KINDS_V1.includes(body.kind)) throw new HttpError(400, "Unknown production job kind.");
            if (body.payload?.researchContext?.assignmentId !== id) throw new HttpError(400, "Job researchContext must identify the same assignment.");
            if (assignment.status !== "RUNNING" || this.#activeRunId !== assignment.sessionId) throw new HttpError(409, "Only the retained active RUNNING assignment accepts production jobs.");
            if (body.kind === "REFERENCE_ANALYSIS" && assignment.mode !== "PRACTICE") throw new HttpError(400, "Pro Creation has no Finish answer key; use raw-media analysis and designed render review.");
            if (body.kind === "BUILD_BASELINE" && assignment.mode !== "PRACTICE") throw new HttpError(400, "Practice baseline requires a Finish reference; use AE_BATCH or AE_TRANSACTION for Pro Creation.");
            if (body.kind === "SCRATCH_SEARCH" && assignment.mode !== "PRACTICE") throw new HttpError(400, "Reference-scored scratch search is a Practice capability; Pro Creation uses rendered candidate review.");
            await this.assertPracticeReconstructionReady();
            await this.assertClipResearchReady(body.payload, body.kind === "BUILD_BASELINE");
            if (body.kind === "SCRATCH_SEARCH") validatePracticeScratchSearchV1(body.payload);
            const job = await this.#productionWorker.enqueue({ assignmentId: id, kind: body.kind, payload: body.payload,
              dependencyIds: stringArray(body, "dependencyIds", false) });
            void this.#productionWorker.runOnce().catch(() => undefined);
            jsonResponse(res, 202, { job, primarySystem: PRIMARY_EDIT_PRODUCTION_SYSTEM_V1 });
            return;
          }
        }
        const requestedJobId = url.searchParams.get("jobId");
        const jobs = this.#productionWorker.list(id);
        const job = requestedJobId ? jobs.find((item) => item.jobId === requestedJobId) : undefined;
        if (requestedJobId && !job) throw new HttpError(404, "Production job not found for this assignment.");
        jsonResponse(res, 200, requestedJobId ? { job, primarySystem: PRIMARY_EDIT_PRODUCTION_SYSTEM_V1 } : { jobs, writerOwner: this.#aeWriterOwner, primarySystem: PRIMARY_EDIT_PRODUCTION_SYSTEM_V1 });
        return;
      }
      if ((req.method === "GET" || req.method === "POST") && productionMatch !== null) {
        const id = decodeURIComponent(productionMatch[1] ?? "");
        const assignment = await this.#gptStore.getAssignment(id);
        if (assignment === null) throw new HttpError(404, "GPT assignment not found.");
        const { file, coordinator } = await this.#productionCoordinator(assignment);
        if (req.method === "POST") {
          const body = await readJson(req);
          const lease = assignment.controllerLease;
          if (assignment.status !== "RUNNING" || !lease || lease.owner !== body.claimedBy || Date.parse(lease.expiresAt) <= Date.now()) {
            throw new HttpError(409, "Production state updates require the current live controller.");
          }
          const action = requiredString(body, "action");
          if (action === "HEARTBEAT") {
            coordinator.heartbeat(optionalString(body, "operation") ?? null);
          } else if (action === "STAGE") {
            coordinator.setStage(
              requiredString(body, "stage") as any,
              optionalString(body, "phaseId") ?? null,
            );
          } else if (action === "STRATEGY_CHANGE") {
            coordinator.acknowledgeStrategyChange(requiredString(body, "strategyKey"));
          } else if (action === "RESEARCH_READY") {
            coordinator.markResearchReady(requiredString(body, "phaseId"), requiredString(body, "researchKey"));
          } else if (action === "WHOLE_EDIT_COVERED") {
            const revision = Number(body["constructionRevision"]);
            coordinator.markWholeEditCovered(Number.isFinite(revision) ? revision : null);
          } else if (action === "CONSTRUCTED") {
            const revision = Number(body["constructionRevision"]);
            coordinator.markConstructed(requiredString(body, "phaseId"), Number.isFinite(revision) ? revision : null);
          } else if (action === "AE_CHECKPOINT") {
            const revision = Number(body["projectRevision"]);
            coordinator.markAeCheckpoint({
              projectId: optionalString(body, "projectId") ?? null,
              projectRevision: Number.isFinite(revision) ? revision : null,
              environmentFingerprint: optionalString(body, "environmentFingerprint") ?? null,
              activeCompId: optionalString(body, "activeCompId") ?? null,
              projectPath: optionalString(body, "projectPath") ?? null,
            });
          } else if (action === "LOCAL_PROOF") {
            const similarity = Number(body["similarity"]);
            coordinator.markLocalProof(
              requiredString(body, "phaseId"),
              body["passed"] === true,
              Number.isFinite(similarity) ? similarity : null,
              { evidenceRef: requiredString(body, "evidenceRef"), candidateKey: requiredString(body, "candidateKey") },
            );
          } else if (action === "WHOLE_EDIT_PROOF") {
            coordinator.confirmProvisionalFromWholeEdit(stringArray(body, "passingPhaseIds", false),
              { evidenceRef: requiredString(body, "evidenceRef"), candidateKey: requiredString(body, "candidateKey"), passed: body["passed"] === true });
          } else if (action === "INVALIDATE") {
            coordinator.invalidate(
              stringArray(body, "phaseIds", true),
              requiredString(body, "target") as any,
            );
          } else if (action === "RESIDUALS") {
            const residuals = body["residuals"];
            if (!Array.isArray(residuals)) throw new HttpError(400, "residuals must be an array.");
            coordinator.updateResiduals(residuals as any);
          } else if (action === "TELEMETRY") {
            const startedAtMs = Number(body["startedAtMs"]);
            const endedAtMs = Number(body["endedAtMs"]);
            if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
              throw new HttpError(400, "Telemetry requires finite startedAtMs and endedAtMs.");
            }
            await file.appendTelemetry(practiceTelemetrySpanV1({
              spanId: optionalString(body, "spanId") ?? randomUUID(),
              sessionId: assignment.sessionId,
              category: requiredString(body, "category") as any,
              stage: requiredString(body, "stage") as any,
              phaseId: optionalString(body, "phaseId") ?? null,
              startedAtMs,
              endedAtMs,
              outcome: (optionalString(body, "outcome") ?? "SUCCESS") as any,
              detail: optionalString(body, "detail") ?? null,
            }));
          } else {
            throw new HttpError(400, "Unknown production coordinator action: " + action);
          }
          await file.save(coordinator);
        }
        jsonResponse(res, 200, {
          production: coordinator.snapshot(),
          nextAction: coordinator.nextAction(),
          parallelReadOnlyWork: coordinator.parallelReadOnlyWork(),
          budget: coordinator.budgetStatus(),
          strategy: coordinator.strategyDirective(),
          liveness: coordinator.liveness({}),
          telemetry: await file.telemetrySummary(Date.parse(coordinator.snapshot().createdAt)),
        });
        return;
      }
      if (url.pathname === "/v1/product/production/user-controls" && ["GET", "POST"].includes(req.method ?? "")) {
        const result = await this.#requestUserControl(req.method === "POST" ? await readJson(req) : { action: "STATUS", requestId: url.searchParams.get("requestId") });
        jsonResponse(res, 200, result); return;
      }
      if ((req.method === "GET" || req.method === "POST") && url.pathname === "/v1/product/practice/resume-or-start") {
        if (req.method === "POST") {
          const body = await readJson(req);
          if (body.action) { jsonResponse(res, 200, await this.#requestUserControl(body)); return; }
          if (this.#activeRunId === null && body["finishPath"] !== undefined) await this.#startPractice(body);
          const active = this.#activeRunId === null ? undefined : this.#runs.get(this.#activeRunId);
          if (active !== undefined) this.#schedulePreflight(active.assignmentId);
        }
        jsonResponse(res, 200, await this.#resumeHandshake());
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/product/status") {
        const latestRunId = [...this.#runs.values()]
          .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
          .at(-1)?.sessionId ?? null;
        jsonResponse(res, 200, {
          service: "READY",
          panelConnected: this.config.broker.panelSession !== null,
          gptOrchestration: "ASSIGNMENT_QUEUE_READY",
          practiceWorkflow: "ACCELERATED_REFERENCE_FIRST_V1",
          practiceStartup: "RESUMABLE_PREFLIGHT_V1",
          practiceWorkflowAuthority: "GPT_VISUAL_REVIEW_WITH_UNCHANGED_M6_FINAL_GATES",
          primaryProductionSystem: PRIMARY_EDIT_PRODUCTION_SYSTEM_V1,
          productionModes: ["PRACTICE", "PRO_CREATION"],
          directMutationRoutes: "REMOVED",
          productionJobKinds: PRACTICE_PRODUCTION_JOB_KINDS_V1,
          activeRunId: this.#activeRunId,
          latestRunId,
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/product/preflight") {
        jsonResponse(res, 200, { preflight: await this.#connectionPreflight() });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/product/control/observe") {
        jsonResponse(res, 200, {
          state: await this.#transactionRuntime.observe(),
          runtime: this.#transactionRuntime.status(),
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/product/control/fast-refresh") {
        const runtime = await this.#ensureFastRuntime();
        jsonResponse(res, 200, {
          state: await runtime.refresh(),
          runtime: runtime.status(),
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
      const robustRecertificationMatch =
        /^\/v1\/product\/edit-types\/([^/]+)\/robust-recertification$/.exec(url.pathname);
      if (req.method === "POST" && robustRecertificationMatch !== null) {
        const editTypeId = decodeURIComponent(robustRecertificationMatch[1] ?? "");
        jsonResponse(res, 200, {
          recertification: await this.#recertifyRobust(editTypeId),
        });
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
        const resumable = await this.#gptStore.listAssignments({
          statuses: ["RUNNING", "CANCEL_REQUESTED"],
        });
        const pending = resumable.length > 0
          ? []
          : await this.#gptStore.listAssignments({ statuses: ["PENDING"] });
        const assignment = resumable[0] ?? pending[0] ?? null;
        jsonResponse(res, 200, {
          assignment,
          resumeRequired: assignment !== null
            && (assignment.status === "RUNNING" || assignment.status === "CANCEL_REQUESTED"),
          clipResearch: assignment === null ? null : this.#clipResearch.publicView(await this.#clipResearch.snapshot(assignment)),
        });
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
          clipResearch: this.#clipResearch.publicView(await this.#clipResearch.snapshot(assignment), url.searchParams.get("includeAuditHistory") === "true"),
        });
        return;
      }
      const releaseMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)\/release-controller$/.exec(url.pathname);
      if (req.method === "POST" && releaseMatch !== null) {
        const body = await readJson(req);
        jsonResponse(res, 200, { assignment: await this.#gptStore.releaseController(
          decodeURIComponent(releaseMatch[1] ?? ""), requiredString(body, "claimedBy")) });
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
      const eventBatchMatch =
        /^\/v1\/product\/gpt\/assignments\/([^/]+)\/events\/batch$/.exec(url.pathname);
      if (req.method === "POST" && eventBatchMatch !== null) {
        const id = decodeURIComponent(eventBatchMatch[1] ?? "");
        const body = await readJson(req);
        const rawEvents = body["events"];
        if (!Array.isArray(rawEvents) || rawEvents.length === 0 || rawEvents.length > 64) {
          throw new HttpError(400, "events must be a non-empty array with at most 64 entries.");
        }
        if (rawEvents.some((event) => event === null
          || typeof event !== "object"
          || Array.isArray(event))) {
          throw new HttpError(400, "Each batched event must be an object.");
        }
        const assignment = await this.#recordLearningEvents(
          id,
          rawEvents as Record<string, unknown>[],
        );
        jsonResponse(res, 201, { assignment, eventCount: rawEvents.length });
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
