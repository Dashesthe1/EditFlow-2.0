import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AeProjectSnapshot } from "../../../packages/ae-object-model/src/index.js";
import {
  asCapabilityId,
  asOperationId,
  asPlanId,
  asRollbackBoundaryId,
  asRouteId,
  type ExecutionPlan,
  type ExecutionPlanOperation,
} from "../../../packages/core-contracts/src/index.js";
import { AE_ADAPTER_ROUTE_ID_V11 } from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";
import {
  AE_MASK_ROUTE_ID_V12,
  capabilityForMaskCommandV12,
  type AeMaskCommandV12,
  type AeMaskShapeV12,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_2.js";
import { AE_COMPOSITE_ROUTE_ID_V13 } from "../../../packages/adapters/ae-cep/src/protocol-v1_3.js";
import type {
  AeAdapterRequestV11,
  AeAdapterResponseV11,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";
import { capabilityForCommandV11 } from "../../../packages/adapters/ae-cep/src/v1_1.js";
import {
  GuardedMaskTrackingControllerV1,
  type MaskTrackingRunV1,
} from "../../../packages/adapters/ae-cep/src/m4-mask-tracking.js";
import { EditGptMaskVisualDriverV1 } from "../../../packages/adapters/ae-cep/src/m4-editgpt-mask-visual-driver.js";
import type { CurrentAeCepTransactionalTransportV1 } from "../../../packages/adapters/ae-cep/src/current-transactional-host.js";
import type {
  PracticeM6CurrentAeTransactionV1,
  PracticeM6SubjectIsolationRouteV1,
  PracticeM6VerifiedSubjectIsolationV1,
} from "./practice-m6-current-ae-runtime.js";
import type { PracticeM6LocalMediaAnalyzerV1 } from "./practice-m6-media.js";
import { PracticeSubjectIsolationBackendFailureV1 } from "./practice-m6-subject-isolation-router.js";

export const PRACTICE_M6_TRACKED_MASK_SUBJECT_ISOLATION_ROUTE_ID_V1 =
  "practice-m6.ae-tracked-mask.v1" as const;

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const sleep = async (ms: number): Promise<void> =>
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
const stableToken = (...parts: readonly string[]): string =>
  createHash("sha256").update(parts.join("\n"), "utf8").digest("hex").slice(0, 18);

type PrepareInputV1 = Parameters<PracticeM6SubjectIsolationRouteV1["prepare"]>[0];

const hasTimeRemap = (input: PrepareInputV1): boolean =>
  input.baselinePlan.operations.some((operation) => {
    if (operation.command !== "layer.time_remap.enable") return false;
    const payload = operation.payload as Readonly<Record<string, unknown>>;
    const layer = payload["layer"];
    return layer !== null
      && typeof layer === "object"
      && !Array.isArray(layer)
      && (layer as Readonly<Record<string, unknown>>)["stableId"] === input.layerId;
  });

const earliestSubjectFrame = (input: PrepareInputV1) => {
  const frames = input.window.evidence.frames.filter((frame) =>
    frame.timeMs >= input.startMs - 0.5
    && frame.timeMs <= input.endMs + 0.5
    && frame.subjectSemanticId === input.referenceSemanticId
    && frame.subjectBoundingBox !== undefined
    && frame.subjectTrackState !== "LOST"
    && frame.subjectTrackState !== "UNOBSERVED");
  if (frames.length === 0) return null;
  return [...frames].sort((left, right) => {
    if (left.timeMs !== right.timeMs) return left.timeMs - right.timeMs;
    const leftScore = (left.subjectTrackState === "OBSERVED" ? 1 : 0)
      + (left.subjectIdentityConfidence ?? 0);
    const rightScore = (right.subjectTrackState === "OBSERVED" ? 1 : 0)
      + (right.subjectIdentityConfidence ?? 0);
    return rightScore - leftScore;
  })[0] ?? null;
};

const sourceTimeForReference = (
  input: PrepareInputV1,
  referenceTimeMs: number,
): number => {
  const trajectory = [...(input.sourceMatch.trajectory ?? [])]
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
  const shot = input.reference.shots.find(
    (candidate) => candidate.shotId === input.sourceMatch.shotId,
  );
  if (shot === undefined) {
    throw new Error("PRACTICE_TRACKED_MASK_REFERENCE_SHOT_MISSING:" + input.shotId);
  }
  return input.sourceMatch.sourceStartMs
    + (referenceTimeMs - shot.referenceStartMs) * input.sourceMatch.playbackRate;
};

const maskShapeForBox = (
  box: readonly [number, number, number, number],
  sourceWidth: number,
  sourceHeight: number,
): AeMaskShapeV12 => {
  const [rawX, rawY, rawWidth, rawHeight] = box;
  if (![rawX, rawY, rawWidth, rawHeight, sourceWidth, sourceHeight].every(Number.isFinite)
    || rawWidth <= 0 || rawHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("PRACTICE_TRACKED_MASK_INVALID_SOURCE_BOX");
  }
  const x1 = Math.max(0, Math.min(1, rawX));
  const y1 = Math.max(0, Math.min(1, rawY));
  const x2 = Math.max(0, Math.min(1, rawX + rawWidth));
  const y2 = Math.max(0, Math.min(1, rawY + rawHeight));
  if (x2 - x1 < 0.01 || y2 - y1 < 0.01) {
    throw new Error("PRACTICE_TRACKED_MASK_SOURCE_BOX_TOO_SMALL");
  }
  const vertices = [
    [x1 * sourceWidth, y1 * sourceHeight],
    [x2 * sourceWidth, y1 * sourceHeight],
    [x2 * sourceWidth, y2 * sourceHeight],
    [x1 * sourceWidth, y2 * sourceHeight],
  ] as const;
  const zero = [[0, 0], [0, 0], [0, 0], [0, 0]] as const;
  return { closed: true, vertices, inTangents: zero, outTangents: zero };
};

interface LiveTargetV1 {
  readonly compHostId: number;
  readonly layerHostId: number;
  readonly compName: string;
  readonly layerName: string;
}

const exactTargetFromProject = (
  project: AeProjectSnapshot,
  compStableId: string,
  layerStableId: string,
): LiveTargetV1 | null => {
  const comp = project.items.find((item) =>
    item.kind === "COMPOSITION" && item.stableId === compStableId);
  const layer = comp?.composition?.layers.find(
    (candidate) => candidate.stableId === layerStableId);
  if (!comp || !layer
    || !Number.isInteger(comp.hostId) || Number(comp.hostId) <= 0
    || !Number.isInteger(layer.hostId) || Number(layer.hostId) <= 0
    || !nonEmpty(comp.name) || !nonEmpty(layer.name)) {
    return null;
  }
  return {
    compHostId: Number(comp.hostId),
    layerHostId: Number(layer.hostId),
    compName: comp.name,
    layerName: layer.name,
  };
};

const inspectRequest = (suffix: string): AeAdapterRequestV11 => ({
  protocolVersion: "1.1.0",
  requestId: "PRACTICE_TRACKED_MASK_INSPECT_" + suffix,
  transactionId: "PRACTICE_TRACKED_MASK_INSPECT_" + suffix,
  operationId: "PRACTICE_TRACKED_MASK_INSPECT_" + suffix,
  capabilityId: capabilityForCommandV11("project.inspect"),
  command: "project.inspect",
  expectedProjectRevision: null,
  expectedProjectFingerprint: null,
  expectedHostProjectRevision: null,
  payload: {},
  readbackProfile: "PRACTICE_TRACKED_MASK_TARGET_BINDING",
});

const inspectTarget = async (
  transport: CurrentAeCepTransactionalTransportV1,
  compStableId: string,
  layerStableId: string,
  suffix: string,
): Promise<LiveTargetV1> => {
  const response: AeAdapterResponseV11 = await transport.dispatch(inspectRequest(suffix));
  if (response.outcome !== "NO_OP" || response.projectSnapshot === null) {
    throw new Error("PRACTICE_TRACKED_MASK_PROJECT_INSPECT_FAILED:" + suffix);
  }
  const target = exactTargetFromProject(
    response.projectSnapshot,
    compStableId,
    layerStableId,
  );
  if (target === null) {
    throw new Error(
      "PRACTICE_TRACKED_MASK_EXACT_TARGET_NOT_FOUND:"
      + compStableId + ":" + layerStableId,
    );
  }
  return target;
};

type OwnedMaskCommandV1 = Extract<AeMaskCommandV12, "mask.create" | "mask.remove">;

const executeMaskMutation = async (
  transaction: PracticeM6CurrentAeTransactionV1,
  identity: string,
  command: OwnedMaskCommandV1,
  payload: Readonly<Record<string, unknown>>,
  riskClass: "R2_STRUCTURAL" | "R3_DESTRUCTIVE",
  evidenceRefs: readonly string[],
): Promise<number> => {
  const observed = await transaction.observe();
  const rollbackBoundaryId = asRollbackBoundaryId(identity + ":rollback");
  const operation: ExecutionPlanOperation = {
    operationId: asOperationId(identity + ":op:01"),
    capabilityId: asCapabilityId(capabilityForMaskCommandV12(command)),
    routeId: asRouteId(AE_MASK_ROUTE_ID_V12),
    dependsOn: [],
    idempotency: "CHECK_THEN_APPLY",
    riskClass,
    input: {
      command,
      payload,
      readbackProfile: "PRACTICE_TRACKED_MASK_SUBJECT_ISOLATION",
    },
    rollbackBoundaryId,
  };
  const plan: ExecutionPlan = {
    planId: asPlanId(identity),
    planRevision: 1,
    projectRevision: observed.projectRevision,
    projectFingerprint: observed.projectFingerprint,
    environmentFingerprint: observed.environmentFingerprint,
    creativeObjective: "Mutate only the Practice-owned native tracked subject mask.",
    recipeRefs: [...new Set(evidenceRefs)],
    requiredCapabilities: [operation.capabilityId],
    bindings: [],
    operations: [operation],
    checkpoints: [{
      checkpointId: identity + ":structural",
      afterOperationIds: [operation.operationId],
      kind: "STRUCTURAL",
      profile: "PRACTICE_TRACKED_MASK_SUBJECT_ISOLATION",
    }],
    invariants: { structural: [], visual: [] },
    rollbackBoundaries: [{
      id: rollbackBoundaryId,
      strategy: "RESTORE_SNAPSHOT",
      notes: "Tracked-mask mutation is Practice-owned and retry-bounded.",
    }],
  };
  const result = transaction.maxOperations >= 1
    ? await transaction.execute(plan)
    : await transaction.executeCorrection(plan);
  if (result.state !== "COMMITTED") {
    throw new Error(
      "PRACTICE_TRACKED_MASK_TRANSACTION_" + result.state
      + ":" + identity
      + (result.error === undefined ? "" : ":" + result.error),
    );
  }
  return result.appliedOperations;
};

export interface PracticeTrackedMaskTargetPrepareRequestV1 {
  readonly requestId: string;
  readonly target: LiveTargetV1;
  readonly maskStableId: string;
  readonly expectedMaskName: string;
  readonly atTimeSeconds: number;
}

export interface PracticeTrackedMaskTargetPrepareResultV1 {
  readonly atTimeSeconds: number;
  readonly frameDuration: number;
  readonly duration: number;
  readonly evidenceRefs: readonly string[];
}

export interface PracticeTrackedMaskTargetPreparerV1 {
  prepare(
    request: PracticeTrackedMaskTargetPrepareRequestV1,
  ): Promise<PracticeTrackedMaskTargetPrepareResultV1>;
}

interface TargetPrepareArtifactV1 {
  readonly schema: "editflow.practice-tracked-mask-target-prepare.v1";
  readonly requestId: string | null;
  readonly ok: boolean;
  readonly failure?: string | null;
  readonly compHostId?: number;
  readonly layerHostId?: number;
  readonly compName?: string;
  readonly layerName?: string;
  readonly maskStableId?: string;
  readonly maskName?: string;
  readonly frameDuration?: number;
  readonly duration?: number;
  readonly atTime?: number;
  readonly layerSelected?: boolean;
  readonly pathSelected?: boolean;
  readonly viewerOpened?: boolean;
  readonly projectRevision?: number;
}

export class AfterFxPracticeTrackedMaskTargetPreparerV1
implements PracticeTrackedMaskTargetPreparerV1 {
  readonly afterFxPath: string;
  readonly scriptPath: string;
  readonly timeoutMs: number;
  readonly requestPath: string;
  readonly responsePath: string;

  constructor(config: {
    readonly afterFxPath: string;
    readonly scriptPath: string;
    readonly timeoutMs?: number;
  }) {
    this.afterFxPath = path.resolve(config.afterFxPath);
    this.scriptPath = path.resolve(config.scriptPath);
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.requestPath = path.join(
      os.tmpdir(),
      "EditFlow2-practice-tracked-mask-target-request.json",
    );
    this.responsePath = path.join(
      os.tmpdir(),
      "EditFlow2-practice-tracked-mask-target-response.json",
    );
    if (!existsSync(this.afterFxPath) || !existsSync(this.scriptPath)) {
      throw new TypeError("Tracked-mask target preparer requires existing AfterFX and JSX paths.");
    }
  }

  async prepare(
    request: PracticeTrackedMaskTargetPrepareRequestV1,
  ): Promise<PracticeTrackedMaskTargetPrepareResultV1> {
    await rm(this.responsePath, { force: true });
    await writeFile(this.requestPath, JSON.stringify({
      schema: "editflow.practice-tracked-mask-target-prepare.v1",
      requestId: request.requestId,
      compHostId: request.target.compHostId,
      layerHostId: request.target.layerHostId,
      expectedCompName: request.target.compName,
      expectedLayerName: request.target.layerName,
      maskStableId: request.maskStableId,
      expectedMaskName: request.expectedMaskName,
      atTime: request.atTimeSeconds,
    }) + "\n", "utf8");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        this.afterFxPath,
        ["-r", this.scriptPath],
        { stdio: "ignore", windowsHide: false, detached: false },
      );
      let settled = false;
      child.once("error", (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      setTimeout(() => {
        if (!settled) {
          settled = true;
          child.unref();
          resolve();
        }
      }, 50);
    });
    const deadline = Date.now() + this.timeoutMs;
    let artifact: TargetPrepareArtifactV1 | null = null;
    while (Date.now() < deadline) {
      try {
        artifact = JSON.parse(
          (await readFile(this.responsePath, "utf8")).replace(/^\uFEFF/, ""),
        ) as TargetPrepareArtifactV1;
        break;
      } catch {
        await sleep(25);
      }
    }
    if (artifact === null) {
      throw new Error("PRACTICE_TRACKED_MASK_TARGET_PREPARE_TIMEOUT");
    }
    if (artifact.schema !== "editflow.practice-tracked-mask-target-prepare.v1"
      || artifact.requestId !== request.requestId
      || artifact.ok !== true
      || artifact.compHostId !== request.target.compHostId
      || artifact.layerHostId !== request.target.layerHostId
      || artifact.compName !== request.target.compName
      || artifact.layerName !== request.target.layerName
      || artifact.maskStableId !== request.maskStableId
      || artifact.maskName !== request.expectedMaskName
      || artifact.layerSelected !== true
      || artifact.pathSelected !== true
      || artifact.viewerOpened !== true
      || !finite(artifact.frameDuration)
      || artifact.frameDuration <= 0
      || !finite(artifact.duration)
      || artifact.duration <= 0
      || !finite(artifact.atTime)) {
      throw new Error(
        "PRACTICE_TRACKED_MASK_TARGET_PREPARE_REJECTED:"
        + String(artifact.failure ?? "correlation mismatch"),
      );
    }
    if (Math.abs(artifact.atTime - request.atTimeSeconds)
      > Math.max(0.002, artifact.frameDuration * 0.60)) {
      throw new Error("PRACTICE_TRACKED_MASK_TARGET_PREPARE_TIME_MISMATCH");
    }
    return {
      atTimeSeconds: artifact.atTime,
      frameDuration: artifact.frameDuration,
      duration: artifact.duration,
      evidenceRefs: [
        "practice-tracked-mask-target-prepare:" + request.requestId,
        "practice-tracked-mask-target-time:" + artifact.atTime.toFixed(6),
        "practice-tracked-mask-target-project-revision:"
          + String(artifact.projectRevision ?? "unknown"),
      ],
    };
  }
}

type TrackerControllerV1 = Pick<GuardedMaskTrackingControllerV1, "run">;

export interface PracticeTrackedMaskTrackerFactoryV1 {
  create(input: {
    readonly analysisWindowSeconds: number;
    readonly evidenceId: string;
  }): TrackerControllerV1;
}

export interface PracticeTrackedMaskRuntimeGateV1 {
  verify(): Promise<readonly string[]>;
}

export interface PracticeM6TrackedMaskSubjectIsolationConfigV1 {
  readonly transaction: PracticeM6CurrentAeTransactionV1;
  readonly media: PracticeM6LocalMediaAnalyzerV1;
  readonly transport: CurrentAeCepTransactionalTransportV1;
  readonly targetPreparer: PracticeTrackedMaskTargetPreparerV1;
  readonly trackerFactory: PracticeTrackedMaskTrackerFactoryV1;
  readonly runtimeGate: PracticeTrackedMaskRuntimeGateV1;
  readonly maxAnalysisWindowSeconds?: number;
}

export class PracticeM6TrackedMaskSubjectIsolationRouteV1
implements PracticeM6SubjectIsolationRouteV1 {
  readonly transaction: PracticeM6CurrentAeTransactionV1;
  readonly media: PracticeM6LocalMediaAnalyzerV1;
  readonly transport: CurrentAeCepTransactionalTransportV1;
  readonly targetPreparer: PracticeTrackedMaskTargetPreparerV1;
  readonly trackerFactory: PracticeTrackedMaskTrackerFactoryV1;
  readonly runtimeGate: PracticeTrackedMaskRuntimeGateV1;
  readonly maxAnalysisWindowSeconds: number;

  constructor(config: PracticeM6TrackedMaskSubjectIsolationConfigV1) {
    this.transaction = config.transaction;
    this.media = config.media;
    this.transport = config.transport;
    this.targetPreparer = config.targetPreparer;
    this.trackerFactory = config.trackerFactory;
    this.runtimeGate = config.runtimeGate;
    this.maxAnalysisWindowSeconds = config.maxAnalysisWindowSeconds ?? 6;
    if (!Number.isFinite(this.maxAnalysisWindowSeconds)
      || this.maxAnalysisWindowSeconds < 1
      || this.maxAnalysisWindowSeconds > 6) {
      throw new RangeError("Tracked-mask analysis must stay inside the retained 1-6 second proof.");
    }
  }

  async #cleanup(
    input: PrepareInputV1,
    maskStableId: string,
    token: string,
  ): Promise<number> {
    return await executeMaskMutation(
      this.transaction,
      "practice-tracked-mask-cleanup:" + token,
      "mask.remove",
      {
        comp: { stableId: input.compStableId },
        layer: { stableId: input.layerId },
        mask: { stableId: maskStableId },
      },
      "R3_DESTRUCTIVE",
      ["practice-tracked-mask-cleanup-owned-only:" + maskStableId],
    );
  }

  async prepare(input: PrepareInputV1): Promise<PracticeM6VerifiedSubjectIsolationV1> {
    const runtimeEvidence = await this.runtimeGate.verify();
    if (runtimeEvidence.length === 0) {
      throw new Error("PRACTICE_TRACKED_MASK_RUNTIME_PROOF_MISSING");
    }
    if (input.sourceMatch.direction !== "FORWARD") {
      throw new Error("PRACTICE_TRACKED_MASK_REVERSE_SOURCE_UNSUPPORTED:" + input.shotId);
    }
    if (hasTimeRemap(input)) {
      throw new Error("PRACTICE_TRACKED_MASK_TIME_REMAP_UNSUPPORTED:" + input.shotId);
    }
    if (!nonEmpty(input.reference.sourcePath) || !nonEmpty(input.sourceMatch.sourcePath)) {
      throw new Error("PRACTICE_TRACKED_MASK_LOCAL_MEDIA_REQUIRED:" + input.shotId);
    }
    const windowDurationMs = input.endMs - input.startMs;
    if (!Number.isFinite(windowDurationMs) || windowDurationMs <= 0
      || windowDurationMs > this.maxAnalysisWindowSeconds * 1000 + 0.5) {
      throw new Error("PRACTICE_TRACKED_MASK_WINDOW_EXCEEDS_PROVEN_ANALYSIS");
    }

    const subjectFrame = earliestSubjectFrame(input);
    if (subjectFrame === null || subjectFrame.subjectBoundingBox === undefined) {
      throw new Error("PRACTICE_TRACKED_MASK_REFERENCE_SUBJECT_BOX_MISSING:" + input.shotId);
    }
    const frameIntervalMs = Math.max(1, input.window.evidence.summary.frameIntervalMs);
    if (subjectFrame.timeMs > input.startMs + Math.max(50, frameIntervalMs * 1.5)) {
      throw new Error("PRACTICE_TRACKED_MASK_FORWARD_SEED_TOO_LATE:" + input.shotId);
    }

    const sourceAnchorMs = sourceTimeForReference(input, subjectFrame.timeMs);
    const binding = await this.media.bindCrossSourceSubject({
      referenceVideoPath: input.reference.sourcePath,
      sourceVideoPath: input.sourceMatch.sourcePath,
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
        "PRACTICE_TRACKED_MASK_CROSS_SOURCE_BINDING_REJECTED:"
        + (binding.reason ?? "UNVERIFIED"),
      );
    }

    const token = stableToken(
      input.sessionId,
      String(input.attempt),
      input.window.windowId,
      input.shotId,
      binding.sourceSemanticId,
    );
    const maskStableId = "PRACTICE_TRACKED_MASK_" + token.toUpperCase();
    const maskName = "EditFlow Practice Subject " + token.slice(0, 6);
    const evidence: string[] = [
      ...runtimeEvidence,
      ...binding.evidenceRefs,
      "practice-tracked-mask-id:" + maskStableId,
      "practice-tracked-mask-source-semantic:" + binding.sourceSemanticId,
    ];
    const target = await inspectTarget(
      this.transport,
      input.compStableId,
      input.layerId,
      token,
    );
    const shape = maskShapeForBox(
      binding.sourceSubjectBox,
      binding.sourceVideo.width,
      binding.sourceVideo.height,
    );

    let created = false;
    let committed = false;
    let createUndoEntries = 0;
    let trackingUndoEntries = 0;
    try {
      const createOperations = await executeMaskMutation(
        this.transaction,
        "practice-tracked-mask-create:" + token,
        "mask.create",
        {
          comp: { stableId: input.compStableId },
          layer: { stableId: input.layerId },
          stableId: maskStableId,
          name: maskName,
          shape,
          properties: {
            mode: "ADD",
            inverted: false,
            opacity: 100,
            feather: [0, 0],
            expansion: 0,
          },
        },
        "R2_STRUCTURAL",
        evidence,
      );
      if (createOperations !== 1) {
        throw new Error("PRACTICE_TRACKED_MASK_CREATE_OPERATION_COUNT_MISMATCH");
      }
      created = true;
      createUndoEntries = createOperations;
      evidence.push("practice-tracked-mask-create-undo-entry:1");

      const prepared = await this.targetPreparer.prepare({
        requestId: "PRACTICE_TRACKED_MASK_PREPARE_" + token,
        target,
        maskStableId,
        expectedMaskName: maskName,
        atTimeSeconds: subjectFrame.timeMs / 1000,
      });
      evidence.push(...prepared.evidenceRefs);
      const targetEndSeconds = input.endMs / 1000;
      if (targetEndSeconds > prepared.duration + prepared.frameDuration * 0.1) {
        throw new Error("PRACTICE_TRACKED_MASK_TARGET_WINDOW_OUT_OF_BOUNDS");
      }
      const analysisWindowSeconds = Math.max(
        1,
        Math.min(
          this.maxAnalysisWindowSeconds,
          windowDurationMs / 1000 + Math.max(0.15, prepared.frameDuration * 2),
        ),
      );
      const tracker = this.trackerFactory.create({
        analysisWindowSeconds,
        evidenceId: token,
      });
      const tracked = await tracker.run({
        compHostId: target.compHostId,
        layerHostId: target.layerHostId,
        maskStableId,
        expectedCompName: target.compName,
        expectedLayerName: target.layerName,
        direction: "FORWARD",
      });
      if (tracked.visualEvidenceId !== null) {
        trackingUndoEntries = 1;
      }
      if (tracked.route !== "LOCAL"
        || tracked.finalPathKeyCount <= tracked.baselinePathKeyCount
        || tracked.visualEvidenceId === null
        || tracked.finalLastKeyTime === null) {
        throw new Error(
          "PRACTICE_TRACKED_MASK_NATIVE_TRACKING_REJECTED:"
          + String(tracked.escalationReason ?? "UNVERIFIED"),
        );
      }
      const coverageTolerance = Math.max(0.04, prepared.frameDuration * 1.5);
      if (tracked.finalLastKeyTime + coverageTolerance < targetEndSeconds) {
        throw new Error("PRACTICE_TRACKED_MASK_COVERAGE_INCOMPLETE");
      }

      const totalAppliedOperations = createUndoEntries + trackingUndoEntries;
      evidence.push(
        "practice-tracked-mask-visual:" + tracked.visualEvidenceId,
        "practice-tracked-mask-path-keys:"
          + tracked.baselinePathKeyCount + "->" + tracked.finalPathKeyCount,
        "practice-tracked-mask-last-key:" + tracked.finalLastKeyTime.toFixed(6),
        "practice-tracked-mask-native-track-undo-entry:1",
        "practice-tracked-mask-applied-undo-entries:" + totalAppliedOperations,
      );
      committed = true;
      return {
        verified: true,
        routeId: PRACTICE_M6_TRACKED_MASK_SUBJECT_ISOLATION_ROUTE_ID_V1,
        referenceSemanticId: input.referenceSemanticId,
        sourceSemanticId: binding.sourceSemanticId,
        crossSourceIdentityVerified: true,
        targetBindingVerified: true,
        targetShotId: input.shotId,
        targetCompStableId: input.compStableId,
        targetLayerStableId: input.layerId,
        maskSource: "AE_TRACKED_MASK",
        appliedOperations: totalAppliedOperations,
        evidenceRefs: [...new Set(evidence)],
      };
    } catch (error) {
      if (created && !committed) {
        try {
          const cleanupUndoEntries = await this.#cleanup(
            input,
            maskStableId,
            token,
          );
          const failedUndoEntries = createUndoEntries
            + trackingUndoEntries
            + cleanupUndoEntries;
          throw new PracticeSubjectIsolationBackendFailureV1(
            "PRACTICE_TRACKED_MASK_BACKEND_REJECTED:" + String(error),
            failedUndoEntries,
            [
              ...evidence,
              "practice-tracked-mask-cleanup-confirmed:true",
              "practice-tracked-mask-failed-undo-entries:"
                + String(failedUndoEntries),
            ],
            true,
          );
        } catch (cleanupError) {
          if (cleanupError instanceof PracticeSubjectIsolationBackendFailureV1) {
            throw cleanupError;
          }
          throw new PracticeSubjectIsolationBackendFailureV1(
            "PRACTICE_TRACKED_MASK_FAILURE_WITH_CLEANUP_FAILURE:"
            + String(error) + ":cleanup=" + String(cleanupError),
            createUndoEntries + trackingUndoEntries,
            [
              ...evidence,
              "practice-tracked-mask-cleanup-confirmed:false",
            ],
            false,
          );
        }
      }
      throw error;
    }
  }
}

export interface RetainedPracticeTrackedMaskRuntimeConfigV1 {
  readonly transaction: PracticeM6CurrentAeTransactionV1;
  readonly media: PracticeM6LocalMediaAnalyzerV1;
  readonly transport: CurrentAeCepTransactionalTransportV1;
  readonly repositoryRoot: string;
  readonly artifactDir: string;
  readonly pythonPath: string;
  readonly visualWorkingDirectory: string;
  readonly afterFxPath: string;
  readonly runtimeEvidencePath: string;
  readonly visualScriptPath?: string;
  readonly targetPrepareScriptPath?: string;
  readonly visualTimeoutMs?: number;
  readonly maxAnalysisWindowSeconds?: number;
}

const resolvedRuntimePaths = (config: RetainedPracticeTrackedMaskRuntimeConfigV1) => ({
  pythonPath: path.resolve(config.pythonPath),
  visualWorkingDirectory: path.resolve(config.visualWorkingDirectory),
  afterFxPath: path.resolve(config.afterFxPath),
  runtimeEvidencePath: path.resolve(config.runtimeEvidencePath),
  visualScriptPath: path.resolve(
    config.visualScriptPath
      ?? path.join(
        config.repositoryRoot,
        "packages",
        "adapters",
        "ae-cep",
        "runtime",
        "editgpt_mask_tracking_visual_driver.py",
      ),
  ),
  targetPrepareScriptPath: path.resolve(
    config.targetPrepareScriptPath
      ?? path.join(
        config.repositoryRoot,
        "scripts",
        "windows",
        "practice-tracked-mask-target-prepare.jsx",
      ),
  ),
});

export const retainedPracticeTrackedMaskRuntimePresentV1 = (
  config: RetainedPracticeTrackedMaskRuntimeConfigV1,
): boolean => Object.values(resolvedRuntimePaths(config)).every((item) => existsSync(item));

interface RetainedMaskProofV1 {
  readonly status?: string;
  readonly proofScope?: string;
  readonly nativeMaskPathTruth?: {
    readonly pathGrowthObserved?: boolean;
    readonly finalPathKeyCount?: number;
    readonly lastKeyTimeSeconds?: number;
  };
}

const loadRetainedProof = async (filePath: string): Promise<RetainedMaskProofV1> => {
  const proof = JSON.parse(
    (await readFile(filePath, "utf8")).replace(/^\uFEFF/, ""),
  ) as RetainedMaskProofV1;
  if (proof.status !== "PASS_FORWARD_MASK_TRACKING_NATIVE_READBACK"
    || proof.proofScope !== "M4_MASK_TRACKING_FORWARD_GUARDED_VISUAL"
    || proof.nativeMaskPathTruth?.pathGrowthObserved !== true
    || !Number.isInteger(proof.nativeMaskPathTruth.finalPathKeyCount)
    || Number(proof.nativeMaskPathTruth.finalPathKeyCount) <= 0
    || !finite(proof.nativeMaskPathTruth.lastKeyTimeSeconds)
    || Number(proof.nativeMaskPathTruth.lastKeyTimeSeconds) < 5.9) {
    throw new Error("PRACTICE_TRACKED_MASK_RUNTIME_EVIDENCE_UNTRUSTED");
  }
  return proof;
};

const fileSha256 = async (filePath: string): Promise<string> =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

export const createRetainedPracticeTrackedMaskSubjectIsolationRouteV1 = (
  config: RetainedPracticeTrackedMaskRuntimeConfigV1,
): PracticeM6TrackedMaskSubjectIsolationRouteV1 | null => {
  if (!retainedPracticeTrackedMaskRuntimePresentV1(config)) return null;
  const paths = resolvedRuntimePaths(config);
  const maxAnalysisWindowSeconds = config.maxAnalysisWindowSeconds ?? 6;
  if (!Number.isFinite(maxAnalysisWindowSeconds)
    || maxAnalysisWindowSeconds < 1
    || maxAnalysisWindowSeconds > 6) {
    throw new RangeError("Tracked-mask retained runtime authorizes only 1-6 second analysis.");
  }
  const targetPreparer = new AfterFxPracticeTrackedMaskTargetPreparerV1({
    afterFxPath: paths.afterFxPath,
    scriptPath: paths.targetPrepareScriptPath,
  });
  const trackerFactory: PracticeTrackedMaskTrackerFactoryV1 = {
    create: ({ analysisWindowSeconds, evidenceId }) => {
      const driver = new EditGptMaskVisualDriverV1({
        executablePath: paths.pythonPath,
        scriptPath: paths.visualScriptPath,
        workingDirectory: paths.visualWorkingDirectory,
        evidenceDirectory: path.join(path.resolve(config.artifactDir), evidenceId),
        timeoutMs: config.visualTimeoutMs ?? 120_000,
        analysisWindowSeconds,
      });
      return new GuardedMaskTrackingControllerV1(config.transport, driver);
    },
  };
  let runtimeProof: Promise<readonly string[]> | null = null;
  const runtimeGate: PracticeTrackedMaskRuntimeGateV1 = {
    verify: async () => {
      runtimeProof ??= (async (): Promise<readonly string[]> => {
        const retained = await loadRetainedProof(paths.runtimeEvidencePath);
        const [proofDigest, driverDigest, prepareDigest] = await Promise.all([
          fileSha256(paths.runtimeEvidencePath),
          fileSha256(paths.visualScriptPath),
          fileSha256(paths.targetPrepareScriptPath),
        ]);
        return [
          "m4-mask-tracking-proof:" + String(retained.proofScope),
          "m4-mask-tracking-proof-file:sha256:" + proofDigest,
          "practice-tracked-mask-visual-driver:sha256:" + driverDigest,
          "practice-tracked-mask-target-prepare:sha256:" + prepareDigest,
          "practice-tracked-mask-proven-max-seconds:"
            + maxAnalysisWindowSeconds.toFixed(3),
        ];
      })();
      return await runtimeProof;
    },
  };
  return new PracticeM6TrackedMaskSubjectIsolationRouteV1({
    transaction: config.transaction,
    media: config.media,
    transport: config.transport,
    targetPreparer,
    trackerFactory,
    runtimeGate,
    maxAnalysisWindowSeconds,
  });
};
