import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  ExecutionPlan,
  ExecutionPlanOperation,
  ObservedProjectState,
} from "../../../packages/core-contracts/src/index.js";
import {
  asCapabilityId,
  asOperationId,
  asPlanId,
  asRollbackBoundaryId,
  asRouteId,
} from "../../../packages/core-contracts/src/index.js";
import { AE_ADAPTER_ROUTE_ID_V11 } from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";
import { AE_COMPOSITE_ROUTE_ID_V13 } from "../../../packages/adapters/ae-cep/src/protocol-v1_3.js";
import { AE_MEDIA_SEQUENCE_ROUTE_ID_V25 } from "../../../packages/adapters/ae-cep/src/protocol-v2_5.js";
import {
  buildSegmentationSequenceMatteMaterializationPlanV1,
  type SegmentationSequenceMatteMaterializationPlanV1,
} from "../../../packages/adapters/ae-cep/src/m4-segmentation-sequence-materialization.js";
import {
  Sam31LocalSegmentationSequenceProviderV1,
  type SegmentationSequenceSourceMaterialV1,
  type SegmentationSequenceSourceResolverV1,
  type VerifiedSegmentationSequenceMaterialV1,
} from "../../../packages/adapters/sam3-local/src/sequence.js";
import {
  acceptSubjectSegmentationSequenceResultV1,
  type SubjectSegmentationSequenceRequestV1,
  type SubjectSegmentationSequenceResultV1,
} from "../../../packages/tracking-state/src/index.js";
import type { PracticeAeBaselinePlanV1 } from "../../../packages/practice-homework/src/ae-baseline.js";
import type {
  PracticeReferenceAnalysisV1,
  PracticeSceneMatchV1,
} from "../../../packages/practice-homework/src/contracts.js";
import type { DenseEffectWindowV1 } from "../../../packages/visual-effects-intelligence/src/index.js";
import {
  loadTrustedM4SegmentationRuntimeEvidenceV1,
} from "./m4-segmentation-runtime-evidence.js";
import type {
  PracticeM6CurrentAeTransactionV1,
  PracticeM6SubjectIsolationRouteV1,
  PracticeM6VerifiedSubjectIsolationV1,
} from "./practice-m6-current-ae-runtime.js";
import type {
  PracticeCrossSourceSubjectBindingV1,
  PracticeM6LocalMediaAnalyzerV1,
} from "./practice-m6-media.js";

export const PRACTICE_M6_SAM31_SUBJECT_ISOLATION_ROUTE_ID_V1 =
  "practice-m6.sam31-sequence-matte.v1" as const;

interface PracticeSequenceProviderV1 {
  segmentSequence(
    request: SubjectSegmentationSequenceRequestV1,
  ): Promise<SubjectSegmentationSequenceResultV1>;
  resolveSequence(requestId: string): VerifiedSegmentationSequenceMaterialV1 | null;
}

export interface PracticeSubjectIsolationRuntimeGateV1 {
  verify(): Promise<readonly string[]>;
}
const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const record = (value: unknown): Readonly<Record<string, unknown>> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const stableIdFrom = (...parts: readonly string[]): string =>
  createHash("sha256").update(parts.join("\n"), "utf8").digest("hex").slice(0, 18);

const sha256File = async (filePath: string): Promise<string> =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

const layerStableId = (payload: Readonly<Record<string, unknown>>): string | null => {
  const layer = record(payload["layer"]);
  return layer !== null && nonEmpty(layer["stableId"]) ? layer["stableId"] : null;
};

const routeForProtocol = (
  protocolVersion: "1.1.0" | "1.3.0" | "2.5.0",
): string => protocolVersion === "2.5.0"
  ? AE_MEDIA_SEQUENCE_ROUTE_ID_V25
  : protocolVersion === "1.3.0"
    ? AE_COMPOSITE_ROUTE_ID_V13
    : AE_ADAPTER_ROUTE_ID_V11;

const subjectFrameForWindow = (
  window: DenseEffectWindowV1,
  semanticId: string,
): DenseEffectWindowV1["evidence"]["frames"][number] | null => {
  const candidates = window.evidence.frames.filter((frame) =>
    frame.subjectSemanticId === semanticId
    && frame.subjectBoundingBox !== undefined
    && frame.subjectTrackState !== "LOST"
    && frame.subjectTrackState !== "UNOBSERVED");
  if (candidates.length === 0) return null;
  return [...candidates].sort((left, right) => {
    const leftDirect = left.subjectTrackState === "OBSERVED" ? 1 : 0;
    const rightDirect = right.subjectTrackState === "OBSERVED" ? 1 : 0;
    const leftScore = leftDirect * 2
      + (left.subjectIdentityConfidence ?? 0)
      + (left.subjectVisibility ?? 0)
      - Math.abs(left.timeMs - window.anchorMs) / Math.max(1, window.endMs - window.startMs);
    const rightScore = rightDirect * 2
      + (right.subjectIdentityConfidence ?? 0)
      + (right.subjectVisibility ?? 0)
      - Math.abs(right.timeMs - window.anchorMs) / Math.max(1, window.endMs - window.startMs);
    return rightScore - leftScore;
  })[0] ?? null;
};
const referenceShot = (
  reference: PracticeReferenceAnalysisV1,
  shotId: string,
): PracticeReferenceAnalysisV1["shots"][number] => {
  const shot = reference.shots.find((candidate) => candidate.shotId === shotId);
  if (shot === undefined) {
    throw new Error("PRACTICE_SUBJECT_ISOLATION_REFERENCE_SHOT_MISSING:" + shotId);
  }
  return shot;
};

const sourceTimeForReference = (
  reference: PracticeReferenceAnalysisV1,
  match: PracticeSceneMatchV1,
  referenceTimeMs: number,
): number => {
  const trajectory = [...(match.trajectory ?? [])]
    .sort((left, right) => left.referenceTimeMs - right.referenceTimeMs);
  if (trajectory.length >= 2) {
    if (referenceTimeMs <= trajectory[0]!.referenceTimeMs) return trajectory[0]!.sourceTimeMs;
    if (referenceTimeMs >= trajectory.at(-1)!.referenceTimeMs) return trajectory.at(-1)!.sourceTimeMs;
    for (let index = 1; index < trajectory.length; index += 1) {
      const right = trajectory[index]!;
      const left = trajectory[index - 1]!;
      if (referenceTimeMs <= right.referenceTimeMs) {
        const span = right.referenceTimeMs - left.referenceTimeMs;
        const phase = span <= 0 ? 0 : (referenceTimeMs - left.referenceTimeMs) / span;
        return left.sourceTimeMs + (right.sourceTimeMs - left.sourceTimeMs) * phase;
      }
    }
  }
  const shot = referenceShot(reference, match.shotId);
  const delta = referenceTimeMs - shot.referenceStartMs;
  return match.direction === "FORWARD"
    ? match.sourceStartMs + delta * match.playbackRate
    : match.sourceEndMs - delta * match.playbackRate;
};

const timingStateForLayer = (
  baselinePlan: PracticeAeBaselinePlanV1,
  layerId: string,
): {
  readonly startTime: number;
  readonly inPoint: number;
  readonly outPoint: number;
  readonly stretch: number;
  readonly evidenceIds: readonly string[];
} => {
  const timingOperation = baselinePlan.operations.find((operation) =>
    operation.command === "layer.set_timing"
    && layerStableId(operation.payload) === layerId);
  if (timingOperation === undefined) {
    throw new Error("PRACTICE_SUBJECT_ISOLATION_LAYER_TIMING_MISSING:" + layerId);
  }
  const timing = record(timingOperation.payload["timing"]);
  const startTime = timing?.["startTime"];
  const inPoint = timing?.["inPoint"];
  const outPoint = timing?.["outPoint"];
  const stretch = timing?.["stretch"];
  if (![startTime, inPoint, outPoint, stretch].every(finite)
    || Number(stretch) <= 0 || Number(outPoint) <= Number(inPoint)) {
    throw new Error("PRACTICE_SUBJECT_ISOLATION_LAYER_TIMING_INVALID:" + layerId);
  }
  return {
    startTime: Number(startTime),
    inPoint: Number(inPoint),
    outPoint: Number(outPoint),
    stretch: Number(stretch),
    evidenceIds: [
      ...baselinePlan.evidenceRefs,
      "practice-baseline-operation:" + timingOperation.operationId,
    ],
  };
};
const assertNoTimeRemap = (
  baselinePlan: PracticeAeBaselinePlanV1,
  layerId: string,
): void => {
  const timeRemapped = baselinePlan.operations.some((operation) =>
    operation.command === "layer.time_remap.enable"
    && layerStableId(operation.payload) === layerId);
  if (timeRemapped) {
    throw new Error(
      "PRACTICE_SUBJECT_ISOLATION_TIME_REMAP_UNSUPPORTED:"
      + layerId
      + ": temporal matte synchronization currently requires direct forward layer timing.",
    );
  }
};

const compileMaterializationExecutionPlan = (
  materialization: SegmentationSequenceMatteMaterializationPlanV1,
  observed: ObservedProjectState,
  identity: string,
  evidenceRefs: readonly string[],
): ExecutionPlan => {
  const rollbackBoundaryId = asRollbackBoundaryId(identity + ":rollback");
  const operations: ExecutionPlanOperation[] = materialization.operations.map(
    (operation, index) => ({
      operationId: asOperationId(identity + ":op:" + String(index + 1).padStart(2, "0")),
      capabilityId: asCapabilityId(operation.capabilityId),
      routeId: asRouteId(routeForProtocol(operation.protocolVersion)),
      dependsOn: index === 0
        ? []
        : [asOperationId(identity + ":op:" + String(index).padStart(2, "0"))],
      idempotency: "CHECK_THEN_APPLY",
      riskClass: operation.command === "media.sequence.import"
        || operation.command === "layer.add_media"
        ? "R2_STRUCTURAL"
        : "R1_REVERSIBLE",
      input: {
        command: operation.command,
        payload: operation.payload,
        readbackProfile: "PRACTICE_SUBJECT_ISOLATION_STRUCTURAL",
      },
      rollbackBoundaryId,
    }),
  );
  const finalOperation = operations.at(-1);
  if (finalOperation === undefined) {
    throw new TypeError("Practice subject isolation materialization produced no operations.");
  }
  return {
    planId: asPlanId(identity),
    planRevision: 1,
    projectRevision: observed.projectRevision,
    projectFingerprint: observed.projectFingerprint,
    environmentFingerprint: observed.environmentFingerprint,
    creativeObjective:
      "Materialize the verified matched raw subject as a temporal native AE track matte.",
    recipeRefs: [
      materialization.semanticId,
      materialization.sourceId,
      ...evidenceRefs,
      ...materialization.evidenceIds,
    ],
    requiredCapabilities: [...new Set(
      materialization.operations.map((operation) => operation.capabilityId),
    )].map(asCapabilityId),
    bindings: [],
    operations,
    checkpoints: [{
      checkpointId: identity + ":structural",
      afterOperationIds: [finalOperation.operationId],
      kind: "STRUCTURAL",
      profile: "PRACTICE_SUBJECT_ISOLATION_STRUCTURAL",
    }],
    invariants: {
      structural: [{
        semanticId: materialization.semanticId,
        sourceId: materialization.sourceId,
        matteLayerStableId: materialization.matteLayerStableId,
        frameCount: materialization.frameCount,
        frameRate: materialization.frameRate,
      }],
      visual: [],
    },
    rollbackBoundaries: [{
      id: rollbackBoundaryId,
      strategy: "RESTORE_SNAPSHOT",
      notes: "Temporal subject-isolation materialization is atomic and fail-closed.",
    }],
  };
};
export interface PracticeM6SubjectIsolationRouteConfigV1 {
  readonly transaction: PracticeM6CurrentAeTransactionV1;
  readonly media: PracticeM6LocalMediaAnalyzerV1;
  readonly provider: PracticeSequenceProviderV1;
  readonly runtimeGate: PracticeSubjectIsolationRuntimeGateV1;
  readonly registerSource?: (sourceMatch: PracticeSceneMatchV1) => void;
}

export class PracticeM6SegmentationSubjectIsolationRouteV1
implements PracticeM6SubjectIsolationRouteV1 {
  readonly transaction: PracticeM6CurrentAeTransactionV1;
  readonly media: PracticeM6LocalMediaAnalyzerV1;
  readonly provider: PracticeSequenceProviderV1;
  readonly runtimeGate: PracticeSubjectIsolationRuntimeGateV1;
  readonly registerSource: ((sourceMatch: PracticeSceneMatchV1) => void) | null;

  constructor(config: PracticeM6SubjectIsolationRouteConfigV1) {
    this.transaction = config.transaction;
    this.media = config.media;
    this.provider = config.provider;
    this.runtimeGate = config.runtimeGate;
    this.registerSource = config.registerSource ?? null;
  }

  async prepare(
    input: Parameters<PracticeM6SubjectIsolationRouteV1["prepare"]>[0],
  ): Promise<PracticeM6VerifiedSubjectIsolationV1> {
    const runtimeEvidenceRefs = await this.runtimeGate.verify();
    if (runtimeEvidenceRefs.length === 0) {
      throw new Error("PRACTICE_SUBJECT_ISOLATION_RUNTIME_PROOF_MISSING");
    }
    if (input.sourceMatch.direction !== "FORWARD") {
      throw new Error("PRACTICE_SUBJECT_ISOLATION_REVERSE_SOURCE_UNSUPPORTED:" + input.shotId);
    }
    assertNoTimeRemap(input.baselinePlan, input.layerId);
    const referencePath = input.reference.sourcePath;
    const sourcePath = input.sourceMatch.sourcePath;
    if (!nonEmpty(referencePath) || !nonEmpty(sourcePath)) {
      throw new Error("PRACTICE_SUBJECT_ISOLATION_LOCAL_MEDIA_REQUIRED:" + input.shotId);
    }
    this.registerSource?.(input.sourceMatch);
    const subjectFrame = subjectFrameForWindow(input.window, input.referenceSemanticId);
    if (subjectFrame === null || subjectFrame.subjectBoundingBox === undefined) {
      throw new Error("PRACTICE_SUBJECT_ISOLATION_REFERENCE_BOX_MISSING:" + input.shotId);
    }
    const sourceAnchorMs = sourceTimeForReference(
      input.reference,
      input.sourceMatch,
      subjectFrame.timeMs,
    );
    const binding = await this.media.bindCrossSourceSubject({
      referenceVideoPath: referencePath,
      sourceVideoPath: sourcePath,
      referenceTimeMs: subjectFrame.timeMs,
      sourceTimeMs: sourceAnchorMs,
      referenceSubjectBox: subjectFrame.subjectBoundingBox,
      referenceSemanticId: input.referenceSemanticId,
      sourceId: input.sourceMatch.sourceId,
      shotId: input.shotId,
    });
    if (!binding.verified || binding.sourceSemanticId === null
      || binding.sourceSubjectBox === null) {
      throw new Error(
        "PRACTICE_SUBJECT_ISOLATION_CROSS_SOURCE_BINDING_REJECTED:"
        + input.shotId + ":" + (binding.reason ?? "UNVERIFIED"),
      );
    }
    const sourceStartMs = sourceTimeForReference(
      input.reference,
      input.sourceMatch,
      input.startMs,
    );
    const sourceEndMs = sourceTimeForReference(
      input.reference,
      input.sourceMatch,
      input.endMs,
    );
    const fps = binding.sourceVideo.fps;
    if (!finite(sourceStartMs) || !finite(sourceEndMs) || sourceEndMs <= sourceStartMs
      || !finite(fps) || fps <= 0) {
      throw new Error("PRACTICE_SUBJECT_ISOLATION_SOURCE_RANGE_INVALID:" + input.shotId);
    }
    const startFrameIndex = Math.max(
      0,
      Math.round(sourceStartMs * fps / 1000),
    );
    const startTimestampMs = startFrameIndex * 1000 / fps;
    const endFrameExclusive = Math.min(
      binding.sourceVideo.frameCount,
      Math.max(
        startFrameIndex + 1,
        Math.ceil(sourceEndMs * fps / 1000),
      ),
    );
    const frameCount = endFrameExclusive - startFrameIndex;
    if (frameCount <= 0) {
      throw new Error("PRACTICE_SUBJECT_ISOLATION_EMPTY_SEQUENCE:" + input.shotId);
    }
    const sourcePromptFrame = Math.round(sourceAnchorMs * fps / 1000);
    const promptFrameIndex = Math.min(
      frameCount - 1,
      Math.max(0, sourcePromptFrame - startFrameIndex),
    );
    const requestToken = stableIdFrom(
      input.sessionId,
      String(input.attempt),
      input.window.windowId,
      input.shotId,
      binding.sourceSemanticId,
      String(startFrameIndex),
      String(frameCount),
    );
    const request: SubjectSegmentationSequenceRequestV1 = {
      requestId: "practice-sam31:" + requestToken,
      sourceId: input.sourceMatch.sourceId,
      semanticId: binding.sourceSemanticId,
      startTimestampMs,
      startFrameIndex,
      frameRate: fps,
      frameCount,
      promptFrameIndex,
      prompt: { boundingBox: binding.sourceSubjectBox },
      preferredEncoding: "ALPHA",
    };
    const result = await this.provider.segmentSequence(request);
    const accepted = acceptSubjectSegmentationSequenceResultV1(request, result);
    if (accepted === null) {
      throw new Error("PRACTICE_SUBJECT_ISOLATION_SEGMENTATION_REJECTED:" + input.shotId);
    }
    const material = this.provider.resolveSequence(request.requestId);
    if (material === null || material.sourceId !== request.sourceId
      || material.semanticId !== request.semanticId
      || material.frameCount !== request.frameCount) {
      throw new Error("PRACTICE_SUBJECT_ISOLATION_SEGMENTATION_MATERIAL_MISSING:" + input.shotId);
    }
    const targetTiming = timingStateForLayer(input.baselinePlan, input.layerId);
    const importItemStableId = "PRACTICE_MATTE_MEDIA_" + requestToken.toUpperCase();
    const matteLayerStableId = "PRACTICE_MATTE_LAYER_" + requestToken.toUpperCase();
    const materialization = buildSegmentationSequenceMatteMaterializationPlanV1({
      segmentation: accepted,
      artifactSequence: material,
      sourceFrame: {
        width: binding.sourceVideo.width,
        height: binding.sourceVideo.height,
        pixelAspect: 1,
        evidenceIds: binding.evidenceRefs,
      },
      comp: { stableId: input.compStableId },
      targetLayer: { stableId: input.layerId },
      targetState: {
        stableId: input.layerId,
        threeDLayer: false,
        transform: {
          anchorPoint: [
            binding.sourceVideo.width / 2,
            binding.sourceVideo.height / 2,
          ],
          position: [
            (input.reference.video?.width ?? binding.sourceVideo.width) / 2,
            (input.reference.video?.height ?? binding.sourceVideo.height) / 2,
          ],
          scale: [100, 100],
          rotation: 0,
        },
        timing: {
          startTime: targetTiming.startTime,
          inPoint: targetTiming.inPoint,
          outPoint: targetTiming.outPoint,
          stretch: targetTiming.stretch,
        },
        evidenceIds: targetTiming.evidenceIds,
      },
      importItemStableId,
      matteLayerStableId,
      channel: "ALPHA",
    });
    if (materialization === null) {
      throw new Error("PRACTICE_SUBJECT_ISOLATION_MATERIALIZATION_PLAN_REJECTED:" + input.shotId);
    }
    const observed = await this.transaction.observe();
    const executionIdentity = [
      "practice-subject-isolation",
      input.sessionId,
      String(input.attempt),
      input.window.windowId,
      input.shotId,
      requestToken,
    ].join(":");
    const executionPlan = compileMaterializationExecutionPlan(
      materialization,
      observed,
      executionIdentity,
      [
        ...runtimeEvidenceRefs,
        ...binding.evidenceRefs,
        ...accepted.evidenceIds,
        ...material.evidenceIds,
      ],
    );
    const transactionResult = executionPlan.operations.length <= this.transaction.maxOperations
      ? await this.transaction.execute(executionPlan)
      : await this.transaction.executeCorrection(executionPlan);
    if (transactionResult.state !== "COMMITTED") {
      throw new Error(
        "PRACTICE_SUBJECT_ISOLATION_AE_TRANSACTION_"
        + transactionResult.state
        + ":" + input.shotId,
      );
    }
    return {
      verified: true,
      routeId: PRACTICE_M6_SAM31_SUBJECT_ISOLATION_ROUTE_ID_V1,
      referenceSemanticId: input.referenceSemanticId,
      sourceSemanticId: binding.sourceSemanticId,
      crossSourceIdentityVerified: true,
      maskSource: "SEGMENTATION",
      evidenceRefs: [
        ...new Set([
          ...runtimeEvidenceRefs,
          ...binding.evidenceRefs,
          ...accepted.evidenceIds,
          ...material.evidenceIds,
          ...materialization.evidenceIds,
          "practice-subject-isolation-request:" + request.requestId,
          "practice-subject-isolation-frame-count:" + String(frameCount),
          "practice-subject-isolation-transaction:"
            + String(transactionResult.transactionId) + ":" + transactionResult.state,
        ]),
      ],
    };
  }
}
class PracticeSam31SourceResolverV1
implements SegmentationSequenceSourceResolverV1 {
  readonly #sources = new Map<string, SegmentationSequenceSourceMaterialV1>();

  register(source: SegmentationSequenceSourceMaterialV1): void {
    this.#sources.set(source.sourceId, {
      ...source,
      evidenceIds: [...new Set(source.evidenceIds.filter(nonEmpty))],
    });
  }

  async resolve(
    request: SubjectSegmentationSequenceRequestV1,
  ): Promise<SegmentationSequenceSourceMaterialV1 | null> {
    return this.#sources.get(request.sourceId) ?? null;
  }
}

export interface RetainedSam31PracticeSubjectIsolationConfigV1 {
  readonly transaction: PracticeM6CurrentAeTransactionV1;
  readonly media: PracticeM6LocalMediaAnalyzerV1;
  readonly repositoryRoot: string;
  readonly artifactDir: string;
  readonly pythonPath: string;
  readonly workingDirectory: string;
  readonly checkpointPath: string;
  readonly runtimeEvidencePath: string;
  readonly runtimeEvidenceSha256Path?: string;
  readonly timeoutMs?: number;
  readonly confidenceThreshold?: number;
}

export const retainedSam31PracticeRuntimePresentV1 = (
  config: RetainedSam31PracticeSubjectIsolationConfigV1,
): boolean => [
  config.pythonPath,
  config.workingDirectory,
  config.checkpointPath,
  config.runtimeEvidencePath,
  config.runtimeEvidenceSha256Path ?? config.runtimeEvidencePath + ".sha256",
  path.join(
    path.resolve(config.repositoryRoot),
    "packages",
    "adapters",
    "sam3-local",
    "runtime",
    "sam31_segmentation_sequence_provider.py",
  ),
].every((item) => existsSync(item));

export const createRetainedSam31PracticeSubjectIsolationRouteV1 = (
  config: RetainedSam31PracticeSubjectIsolationConfigV1,
): PracticeM6SegmentationSubjectIsolationRouteV1 | null => {
  if (!retainedSam31PracticeRuntimePresentV1(config)) return null;
  const repositoryRoot = path.resolve(config.repositoryRoot);
  const artifactDirectory = path.join(
    path.resolve(config.artifactDir),
    "sam31-sequences",
  );
  const sourceResolver = new PracticeSam31SourceResolverV1();
  const provider = new Sam31LocalSegmentationSequenceProviderV1({
    executablePath: path.resolve(config.pythonPath),
    scriptPath: path.join(
      repositoryRoot,
      "packages",
      "adapters",
      "sam3-local",
      "runtime",
      "sam31_segmentation_sequence_provider.py",
    ),
    workingDirectory: path.resolve(config.workingDirectory),
    artifactDirectory,
    sourceResolver,
    checkpointPath: path.resolve(config.checkpointPath),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.confidenceThreshold === undefined
      ? {}
      : { confidenceThreshold: config.confidenceThreshold }),
  });
  let runtimeProof: Promise<readonly string[]> | null = null;
  const runtimeGate: PracticeSubjectIsolationRuntimeGateV1 = {
    verify: async () => {
      runtimeProof ??= (async (): Promise<readonly string[]> => {
        const trusted = await loadTrustedM4SegmentationRuntimeEvidenceV1({
          evidencePath: path.resolve(config.runtimeEvidencePath),
          ...(config.runtimeEvidenceSha256Path === undefined
            ? {}
            : { sha256Path: path.resolve(config.runtimeEvidenceSha256Path) }),
        });
        if (trusted === null) {
          throw new Error("PRACTICE_SUBJECT_ISOLATION_RUNTIME_EVIDENCE_UNTRUSTED");
        }
        const checkpointDigest = await sha256File(path.resolve(config.checkpointPath));
        if (checkpointDigest !== trusted.evidence.checkpointSha256) {
          throw new Error("PRACTICE_SUBJECT_ISOLATION_CHECKPOINT_DIGEST_MISMATCH");
        }
        return [
          "m4-segmentation-runtime-evidence:" + trusted.evidence.evidenceId,
          "m4-segmentation-runtime-evidence-file:sha256:" + trusted.evidenceFileSha256,
          "sam31-checkpoint:sha256:" + checkpointDigest,
        ];
      })();
      return await runtimeProof;
    },
  };
  return new PracticeM6SegmentationSubjectIsolationRouteV1({
    transaction: config.transaction,
    media: config.media,
    provider,
    runtimeGate,
    registerSource: (sourceMatch) => {
      if (!nonEmpty(sourceMatch.sourcePath)) {
        throw new Error(
          "PRACTICE_SUBJECT_ISOLATION_SOURCE_PATH_MISSING:" + sourceMatch.shotId,
        );
      }
      const absolutePath = path.resolve(sourceMatch.sourcePath);
      sourceResolver.register({
        sourceId: sourceMatch.sourceId,
        absolutePath,
        evidenceIds: [
          ...sourceMatch.evidenceRefs,
          "practice-subject-isolation-source-path:" + absolutePath,
        ],
      });
    },
  });
};
