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
  type ObservedProjectState,
} from "../../../packages/core-contracts/src/index.js";
import { AE_ADAPTER_ROUTE_ID_V11 } from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";
import { AE_COMPOSITE_ROUTE_ID_V13 } from "../../../packages/adapters/ae-cep/src/protocol-v1_3.js";
import type {
  AeAdapterRequestV11,
  AeAdapterResponseV11,
} from "../../../packages/adapters/ae-cep/src/protocol-v1_1.js";
import { capabilityForCommandV11 } from "../../../packages/adapters/ae-cep/src/v1_1.js";
import {
  buildRotoBrushReadbackRequestV26,
} from "../../../packages/adapters/ae-cep/src/m5-roto-brush-readback.js";
import {
  GuardedRotoBrushSeedControllerV1,
} from "../../../packages/adapters/ae-cep/src/m5-roto-brush-seed-controller.js";
import {
  GuardedRotoBrushPropagationControllerV1,
} from "../../../packages/adapters/ae-cep/src/m5-roto-brush-propagation-controller.js";
import {
  GuardedRotoBrushExportControllerV1,
} from "../../../packages/adapters/ae-cep/src/m5-roto-brush-export-controller.js";
import {
  EditGptRotoBrushSeedVisualDriverV1,
} from "../../../packages/adapters/ae-cep/src/m5-editgpt-roto-brush-seed-visual-driver.js";
import {
  EditGptRotoBrushPropagationVisualDriverV1,
} from "../../../packages/adapters/ae-cep/src/m5-editgpt-roto-brush-propagation-visual-driver.js";
import type {
  AeRotoBrushReadbackV26,
  AeRotoBrushRequestV26,
  AeRotoBrushResponseV26,
} from "../../../packages/adapters/ae-cep/src/protocol-v2_6.js";
import type {
  CurrentAeCepTransactionalTransportV1,
} from "../../../packages/adapters/ae-cep/src/current-transactional-host.js";
import {
  loadTrustedM5RotoBrushRuntimeEvidenceV1,
} from "./m5-roto-brush-runtime-evidence.js";
import type {
  PracticeM6CurrentAeTransactionV1,
  PracticeM6SubjectIsolationRouteV1,
  PracticeM6VerifiedSubjectIsolationV1,
} from "./practice-m6-current-ae-runtime.js";
import type {
  PracticeM6LocalMediaAnalyzerV1,
} from "./practice-m6-media.js";
import {
  PracticeSubjectIsolationBackendFailureV1,
} from "./practice-m6-subject-isolation-router.js";
export const PRACTICE_M6_ROTO_BRUSH_SUBJECT_ISOLATION_ROUTE_ID_V1 =
  "practice-m6.roto-brush-track-matte.v1" as const;

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const stableToken = (...parts: readonly string[]): string =>
  createHash("sha256").update(parts.join("\n"), "utf8").digest("hex").slice(0, 18);

const sleep = async (ms: number): Promise<void> =>
  await new Promise<void>((resolve) => setTimeout(resolve, ms));

const subjectFrameForWindow = (
  input: Parameters<PracticeM6SubjectIsolationRouteV1["prepare"]>[0],
) => {
  const candidates = input.window.evidence.frames.filter((frame) =>
    frame.timeMs >= input.startMs - 0.5
    && frame.timeMs <= input.endMs + 0.5
    && frame.subjectSemanticId === input.referenceSemanticId
    && frame.subjectBoundingBox !== undefined
    && frame.subjectTrackState !== "LOST"
    && frame.subjectTrackState !== "UNOBSERVED");
  if (candidates.length === 0) return null;
  return [...candidates].sort((left, right) => {
    const leftScore = (left.subjectTrackState === "OBSERVED" ? 2 : 0)
      + (left.subjectIdentityConfidence ?? 0)
      + (left.subjectVisibility ?? 0)
      - Math.abs(left.timeMs - input.window.anchorMs)
        / Math.max(1, input.window.endMs - input.window.startMs);
    const rightScore = (right.subjectTrackState === "OBSERVED" ? 2 : 0)
      + (right.subjectIdentityConfidence ?? 0)
      + (right.subjectVisibility ?? 0)
      - Math.abs(right.timeMs - input.window.anchorMs)
        / Math.max(1, input.window.endMs - input.window.startMs);
    return rightScore - leftScore;
  })[0] ?? null;
};
const sourceTimeForReference = (
  input: Parameters<PracticeM6SubjectIsolationRouteV1["prepare"]>[0],
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
    throw new Error("PRACTICE_ROTO_REFERENCE_SHOT_MISSING:" + input.shotId);
  }
  const delta = referenceTimeMs - shot.referenceStartMs;
  return input.sourceMatch.direction === "FORWARD"
    ? input.sourceMatch.sourceStartMs + delta * input.sourceMatch.playbackRate
    : input.sourceMatch.sourceEndMs - delta * input.sourceMatch.playbackRate;
};
interface LiveTargetV1 {
  readonly compHostId: number;
  readonly layerHostId: number;
  readonly compName: string;
  readonly layerName: string;
  readonly projectHostRevision: number | null;
}

const exactTargetFromProject = (
  project: AeProjectSnapshot,
  compStableId: string,
  layerStableId: string,
  projectHostRevision: number | null,
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
    projectHostRevision,
  };
};

const v11InspectRequest = (suffix: string): AeAdapterRequestV11 => ({
  protocolVersion: "1.1.0",
  requestId: "PRACTICE_ROTO_INSPECT_" + suffix,
  transactionId: "PRACTICE_ROTO_INSPECT_" + suffix,
  operationId: "PRACTICE_ROTO_INSPECT_" + suffix,
  capabilityId: capabilityForCommandV11("project.inspect"),
  command: "project.inspect",
  expectedProjectRevision: null,
  expectedProjectFingerprint: null,
  expectedHostProjectRevision: null,
  payload: {},
  readbackProfile: "PRACTICE_ROTO_TARGET_BINDING",
});
const inspectTarget = async (
  transport: CurrentAeCepTransactionalTransportV1,
  compStableId: string,
  layerStableId: string,
  suffix: string,
): Promise<LiveTargetV1> => {
  const response: AeAdapterResponseV11 = await transport.dispatch(
    v11InspectRequest(suffix),
  );
  if (response.outcome !== "NO_OP" || response.projectSnapshot === null) {
    throw new Error("PRACTICE_ROTO_PROJECT_INSPECT_FAILED:" + suffix);
  }
  const target = exactTargetFromProject(
    response.projectSnapshot,
    compStableId,
    layerStableId,
    response.hostProjectRevision,
  );
  if (target === null) {
    throw new Error(
      "PRACTICE_ROTO_EXACT_TARGET_NOT_FOUND:"
      + compStableId + ":" + layerStableId,
    );
  }
  return target;
};

interface PlannedMutationV1 {
  readonly protocolVersion: "1.1.0" | "1.3.0";
  readonly capabilityId: string;
  readonly command: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly riskClass: "R1_REVERSIBLE" | "R2_STRUCTURAL";
}

const routeFor = (protocolVersion: PlannedMutationV1["protocolVersion"]): string =>
  protocolVersion === "1.3.0" ? AE_COMPOSITE_ROUTE_ID_V13 : AE_ADAPTER_ROUTE_ID_V11;
const compileMutationPlan = (
  identity: string,
  observed: ObservedProjectState,
  operations: readonly PlannedMutationV1[],
  evidenceRefs: readonly string[],
): ExecutionPlan => {
  if (operations.length === 0) {
    throw new TypeError("Practice Roto mutation plan requires operations.");
  }
  const rollbackBoundaryId = asRollbackBoundaryId(identity + ":rollback");
  const compiled: ExecutionPlanOperation[] = operations.map((operation, index) => ({
    operationId: asOperationId(
      identity + ":op:" + String(index + 1).padStart(2, "0"),
    ),
    capabilityId: asCapabilityId(operation.capabilityId),
    routeId: asRouteId(routeFor(operation.protocolVersion)),
    dependsOn: index === 0
      ? []
      : [asOperationId(identity + ":op:" + String(index).padStart(2, "0"))],
    idempotency: "CHECK_THEN_APPLY",
    riskClass: operation.riskClass,
    input: {
      command: operation.command,
      payload: operation.payload,
      readbackProfile: "PRACTICE_ROTO_SUBJECT_ISOLATION",
    },
    rollbackBoundaryId,
  }));
  const last = compiled.at(-1)!;
  return {
    planId: asPlanId(identity),
    planRevision: 1,
    projectRevision: observed.projectRevision,
    projectFingerprint: observed.projectFingerprint,
    environmentFingerprint: observed.environmentFingerprint,
    creativeObjective:
      "Create or clean proof-owned Roto Brush subject-isolation layers without mutating unrelated user state.",
    recipeRefs: [...new Set(evidenceRefs)],
    requiredCapabilities: [...new Set(
      operations.map((operation) => operation.capabilityId),
    )].map(asCapabilityId),
    bindings: [],
    operations: compiled,
    checkpoints: [{
      checkpointId: identity + ":structural",
      afterOperationIds: [last.operationId],
      kind: "STRUCTURAL",
      profile: "PRACTICE_ROTO_SUBJECT_ISOLATION",
    }],
    invariants: { structural: [], visual: [] },
    rollbackBoundaries: [{
      id: rollbackBoundaryId,
      strategy: "RESTORE_SNAPSHOT",
      notes: "Practice Roto structural mutation is atomic and retry-owned.",
    }],
  };
};
const executeMutationPlan = async (
  transaction: PracticeM6CurrentAeTransactionV1,
  identity: string,
  operations: readonly PlannedMutationV1[],
  evidenceRefs: readonly string[],
): Promise<number> => {
  const observed = await transaction.observe();
  const plan = compileMutationPlan(identity, observed, operations, evidenceRefs);
  const result = plan.operations.length <= transaction.maxOperations
    ? await transaction.execute(plan)
    : await transaction.executeCorrection(plan);
  if (result.state !== "COMMITTED") {
    throw new Error(
      "PRACTICE_ROTO_TRANSACTION_" + result.state
      + ":" + identity
      + (result.error === undefined ? "" : ":" + result.error),
    );
  }
  return result.appliedOperations;
};

const foregroundStrokeForBox = (
  box: readonly [number, number, number, number],
) => {
  const [x, y, width, height] = box;
  const centerX = Math.max(0, Math.min(1, x + width * 0.5));
  const top = Math.max(0, Math.min(1, y + height * 0.34));
  const middle = Math.max(0, Math.min(1, y + height * 0.5));
  const bottom = Math.max(0, Math.min(1, y + height * 0.66));
  const radius = Math.max(0.015, Math.min(0.08, Math.min(width, height) * 0.08));
  return {
    role: "FOREGROUND" as const,
    pointsNormalized: [
      { x: centerX, y: top },
      { x: centerX, y: middle },
      { x: centerX, y: bottom },
    ],
    radiusNormalized: radius,
  };
};

export interface PracticeRotoTargetPrepareRequestV1 {
  readonly requestId: string;
  readonly target: LiveTargetV1;
  readonly atTimeSeconds: number;
}

export interface PracticeRotoTargetPrepareResultV1 {
  readonly atTimeSeconds: number;
  readonly evidenceRefs: readonly string[];
}

export interface PracticeRotoTargetPreparerV1 {
  prepare(
    request: PracticeRotoTargetPrepareRequestV1,
  ): Promise<PracticeRotoTargetPrepareResultV1>;
}

interface TargetPrepareArtifactV1 {
  readonly schema: "editflow.practice-roto-target-prepare.v1";
  readonly requestId: string | null;
  readonly ok: boolean;
  readonly failure?: string | null;
  readonly compHostId?: number;
  readonly layerHostId?: number;
  readonly compName?: string;
  readonly layerName?: string;
  readonly frameRate?: number;
  readonly frameDuration?: number;
  readonly duration?: number;
  readonly atTime?: number;
  readonly layerSelected?: boolean;
  readonly viewerOpened?: boolean;
  readonly projectRevision?: number;
}

export interface AfterFxPracticeRotoTargetPreparerConfigV1 {
  readonly afterFxPath: string;
  readonly scriptPath: string;
  readonly timeoutMs?: number;
}

export class AfterFxPracticeRotoTargetPreparerV1
implements PracticeRotoTargetPreparerV1 {
  readonly afterFxPath: string;
  readonly scriptPath: string;
  readonly timeoutMs: number;
  readonly requestPath: string;
  readonly responsePath: string;

  constructor(config: AfterFxPracticeRotoTargetPreparerConfigV1) {
    this.afterFxPath = path.resolve(config.afterFxPath);
    this.scriptPath = path.resolve(config.scriptPath);
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.requestPath = path.join(
      os.tmpdir(),
      "EditFlow2-practice-roto-target-request.json",
    );
    this.responsePath = path.join(
      os.tmpdir(),
      "EditFlow2-practice-roto-target-response.json",
    );
    if (!existsSync(this.afterFxPath) || !existsSync(this.scriptPath)) {
      throw new TypeError("Practice Roto target preparer requires existing AfterFX and JSX paths.");
    }
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 1000 || this.timeoutMs > 60_000) {
      throw new RangeError("Practice Roto target prepare timeout must be 1-60 seconds.");
    }
  }

  async prepare(
    request: PracticeRotoTargetPrepareRequestV1,
  ): Promise<PracticeRotoTargetPrepareResultV1> {
    if (!nonEmpty(request.requestId)
      || !finite(request.atTimeSeconds)
      || request.atTimeSeconds < 0) {
      throw new TypeError("Practice Roto target prepare request is invalid.");
    }
    await rm(this.responsePath, { force: true });
    const payload = {
      schema: "editflow.practice-roto-target-prepare.v1",
      requestId: request.requestId,
      compHostId: request.target.compHostId,
      layerHostId: request.target.layerHostId,
      expectedCompName: request.target.compName,
      expectedLayerName: request.target.layerName,
      atTime: request.atTimeSeconds,
    };
    await writeFile(
      this.requestPath,
      JSON.stringify(payload) + "\n",
      "utf8",
    );
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
      throw new Error("PRACTICE_ROTO_TARGET_PREPARE_TIMEOUT");
    }
    if (artifact.schema !== "editflow.practice-roto-target-prepare.v1"
      || artifact.requestId !== request.requestId
      || artifact.ok !== true
      || artifact.compHostId !== request.target.compHostId
      || artifact.layerHostId !== request.target.layerHostId
      || artifact.compName !== request.target.compName
      || artifact.layerName !== request.target.layerName
      || artifact.layerSelected !== true
      || artifact.viewerOpened !== true
      || !finite(artifact.frameDuration)
      || artifact.frameDuration <= 0
      || !finite(artifact.atTime)) {
      throw new Error(
        "PRACTICE_ROTO_TARGET_PREPARE_REJECTED:"
        + String(artifact.failure ?? "correlation mismatch"),
      );
    }
    if (Math.abs(artifact.atTime - request.atTimeSeconds)
      > Math.max(0.002, artifact.frameDuration * 0.60)) {
      throw new Error("PRACTICE_ROTO_TARGET_PREPARE_TIME_MISMATCH");
    }
    return {
      atTimeSeconds: artifact.atTime,
      evidenceRefs: [
        "practice-roto-target-prepare:" + request.requestId,
        "practice-roto-target-time:" + artifact.atTime.toFixed(6),
        "practice-roto-target-project-revision:"
          + String(artifact.projectRevision ?? "unknown"),
      ],
    };
  }
}

const exactRotoReadback = (
  readback: AeRotoBrushReadbackV26 | null,
  target: LiveTargetV1,
  expectedTime: number,
): boolean =>
  readback !== null
  && readback.comp.hostId === target.compHostId
  && readback.layer.hostId === target.layerHostId
  && readback.comp.name === target.compName
  && readback.layer.name === target.layerName
  && Math.abs(readback.comp.time - expectedTime)
    <= Math.max(0.002, readback.comp.frameDuration * 0.60);

const verifyPreparedTarget = async (
  transport: CurrentAeCepTransactionalTransportV1,
  target: LiveTargetV1,
  expectedTime: number,
  suffix: string,
): Promise<AeRotoBrushReadbackV26> => {
  const request = buildRotoBrushReadbackRequestV26({
    requestId: "PRACTICE_ROTO_PREPARED_" + suffix,
    transactionId: "PRACTICE_ROTO_PREPARED_" + suffix,
    operationId: "PRACTICE_ROTO_PREPARED_" + suffix,
    payload: {
      comp: { hostId: target.compHostId },
      layer: { hostId: target.layerHostId },
    },
    readbackProfile: "PRACTICE_ROTO_PREPARED_TARGET",
  });
  const response: AeRotoBrushResponseV26 = await transport.dispatch(request);
  if (response.outcome !== "NO_OP"
    || !exactRotoReadback(response.readback, target, expectedTime)) {
    throw new Error("PRACTICE_ROTO_PREPARED_TARGET_READBACK_REJECTED:" + suffix);
  }
  return response.readback!;
};

type SeedControllerV1 = Pick<GuardedRotoBrushSeedControllerV1, "run">;
type PropagationControllerV1 = Pick<GuardedRotoBrushPropagationControllerV1, "run">;
type ExportControllerV1 = Pick<GuardedRotoBrushExportControllerV1, "run">;

export interface PracticeRotoRuntimeGateV1 {
  verify(): Promise<readonly string[]>;
}

export interface PracticeM6RotoBrushSubjectIsolationConfigV1 {
  readonly transaction: PracticeM6CurrentAeTransactionV1;
  readonly media: PracticeM6LocalMediaAnalyzerV1;
  readonly transport: CurrentAeCepTransactionalTransportV1;
  readonly targetPreparer: PracticeRotoTargetPreparerV1;
  readonly seedController: SeedControllerV1;
  readonly propagationController: PropagationControllerV1;
  readonly exportController: ExportControllerV1;
  readonly runtimeGate: PracticeRotoRuntimeGateV1;
}

const hasTimeRemap = (
  input: Parameters<PracticeM6SubjectIsolationRouteV1["prepare"]>[0],
): boolean => input.baselinePlan.operations.some((operation) => {
  if (operation.command !== "layer.time_remap.enable") return false;
  const payload = operation.payload as Readonly<Record<string, unknown>>;
  const layer = payload["layer"];
  return layer !== null
    && typeof layer === "object"
    && !Array.isArray(layer)
    && (layer as Readonly<Record<string, unknown>>)["stableId"] === input.layerId;
});

const clampFrameIndex = (
  seconds: number,
  frameDuration: number,
  maxFrameIndex: number,
  mode: "FLOOR" | "ROUND" | "CEIL_MINUS_ONE",
): number => {
  const raw = seconds / frameDuration;
  const value = mode === "FLOOR"
    ? Math.floor(raw + 1e-7)
    : mode === "CEIL_MINUS_ONE"
      ? Math.ceil(raw - 1e-7) - 1
      : Math.round(raw);
  return Math.max(0, Math.min(maxFrameIndex, value));
};

export class PracticeM6RotoBrushSubjectIsolationRouteV1
implements PracticeM6SubjectIsolationRouteV1 {
  readonly transaction: PracticeM6CurrentAeTransactionV1;
  readonly media: PracticeM6LocalMediaAnalyzerV1;
  readonly transport: CurrentAeCepTransactionalTransportV1;
  readonly targetPreparer: PracticeRotoTargetPreparerV1;
  readonly seedController: SeedControllerV1;
  readonly propagationController: PropagationControllerV1;
  readonly exportController: ExportControllerV1;
  readonly runtimeGate: PracticeRotoRuntimeGateV1;

  constructor(config: PracticeM6RotoBrushSubjectIsolationConfigV1) {
    this.transaction = config.transaction;
    this.media = config.media;
    this.transport = config.transport;
    this.targetPreparer = config.targetPreparer;
    this.seedController = config.seedController;
    this.propagationController = config.propagationController;
    this.exportController = config.exportController;
    this.runtimeGate = config.runtimeGate;
  }

  async #cleanupOwnedLayers(
    input: Parameters<PracticeM6SubjectIsolationRouteV1["prepare"]>[0],
    stableIds: readonly string[],
    identity: string,
  ): Promise<number> {
    const response: AeAdapterResponseV11 = await this.transport.dispatch(
      v11InspectRequest("CLEANUP_" + identity),
    );
    if (response.outcome !== "NO_OP" || response.projectSnapshot === null) {
      throw new Error("PRACTICE_ROTO_CLEANUP_INSPECT_FAILED");
    }
    const comp = response.projectSnapshot.items.find((item) =>
      item.kind === "COMPOSITION" && item.stableId === input.compStableId);
    const existing = stableIds.filter((stableId) =>
      comp?.composition?.layers.some((layer) => layer.stableId === stableId));
    if (existing.length === 0) return 0;
    const operations: PlannedMutationV1[] = existing.map((stableId) => ({
      protocolVersion: "1.1.0",
      capabilityId: "ae.layer.remove",
      command: "layer.remove",
      payload: {
        comp: { stableId: input.compStableId },
        layer: { stableId },
      },
      riskClass: "R2_STRUCTURAL",
    }));
    return await executeMutationPlan(
      this.transaction,
      "practice-roto-cleanup:" + identity,
      operations,
      ["practice-roto-cleanup-owned-only"],
    );
  }

  async prepare(
    input: Parameters<PracticeM6SubjectIsolationRouteV1["prepare"]>[0],
  ): Promise<PracticeM6VerifiedSubjectIsolationV1> {
    const runtimeEvidence = await this.runtimeGate.verify();
    if (runtimeEvidence.length === 0) {
      throw new Error("PRACTICE_ROTO_RUNTIME_PROOF_MISSING");
    }
    if (input.sourceMatch.direction !== "FORWARD") {
      throw new Error("PRACTICE_ROTO_REVERSE_SOURCE_UNSUPPORTED:" + input.shotId);
    }
    if (hasTimeRemap(input)) {
      throw new Error("PRACTICE_ROTO_TIME_REMAP_UNSUPPORTED:" + input.shotId);
    }
    if (!nonEmpty(input.reference.sourcePath) || !nonEmpty(input.sourceMatch.sourcePath)) {
      throw new Error("PRACTICE_ROTO_LOCAL_MEDIA_REQUIRED:" + input.shotId);
    }
    const subjectFrame = subjectFrameForWindow(input);
    if (subjectFrame === null || subjectFrame.subjectBoundingBox === undefined) {
      throw new Error("PRACTICE_ROTO_REFERENCE_SUBJECT_BOX_MISSING:" + input.shotId);
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
        "PRACTICE_ROTO_CROSS_SOURCE_BINDING_REJECTED:"
        + input.shotId + ":" + (binding.reason ?? "UNVERIFIED"),
      );
    }

    const token = stableToken(
      input.sessionId,
      String(input.attempt),
      input.window.windowId,
      input.shotId,
      binding.sourceSemanticId,
    );
    const workingLayerStableId =
      "PRACTICE_ROTO_WORK_" + token.toUpperCase();
    const matteLayerStableId =
      "PRACTICE_ROTO_MATTE_" + token.toUpperCase();
    let finalCommitted = false;
    let workingCreatedOperations = 0;
    let seedUndoEntries = 0;
    let exportUndoEntries = 0;
    let finalOperations = 0;
    const evidence: string[] = [
      ...runtimeEvidence,
      ...binding.evidenceRefs,
      "practice-roto-working-layer:" + workingLayerStableId,
      "practice-roto-matte-layer:" + matteLayerStableId,
    ];

    try {
      const originalTarget = await inspectTarget(
        this.transport,
        input.compStableId,
        input.layerId,
        "ORIGINAL_" + token,
      );
      workingCreatedOperations = await executeMutationPlan(
        this.transaction,
        "practice-roto-create-work:" + token,
        [{
          protocolVersion: "1.1.0",
          capabilityId: "ae.layer.duplicate",
          command: "layer.duplicate",
          payload: {
            comp: { stableId: input.compStableId },
            layer: { stableId: input.layerId },
            stableId: workingLayerStableId,
          },
          riskClass: "R2_STRUCTURAL",
        }],
        evidence,
      );
      if (workingCreatedOperations !== 1) {
        throw new Error("PRACTICE_ROTO_WORKING_DUPLICATE_COUNT_MISMATCH");
      }
      const workingTarget = await inspectTarget(
        this.transport,
        input.compStableId,
        workingLayerStableId,
        "WORKING_" + token,
      );
      if (workingTarget.compHostId !== originalTarget.compHostId) {
        throw new Error("PRACTICE_ROTO_WORKING_DUPLICATE_COMP_DRIFT");
      }

      const requestedAnchorSeconds = subjectFrame.timeMs / 1000;
      const prepared = await this.targetPreparer.prepare({
        requestId: "PRACTICE_ROTO_PREPARE_" + token,
        target: workingTarget,
        atTimeSeconds: requestedAnchorSeconds,
      });
      evidence.push(...prepared.evidenceRefs);
      const preparedReadback = await verifyPreparedTarget(
        this.transport,
        workingTarget,
        prepared.atTimeSeconds,
        "BEFORE_SEED_" + token,
      );
      evidence.push(
        "practice-roto-prepared-readback:"
        + preparedReadback.comp.time.toFixed(6),
      );
      const frameDuration = preparedReadback.comp.frameDuration;
      const maxFrameIndex = Math.max(
        0,
        Math.floor(
          (preparedReadback.comp.duration - frameDuration) / frameDuration + 1e-7,
        ),
      );
      const startFrameIndex = clampFrameIndex(
        input.startMs / 1000,
        frameDuration,
        maxFrameIndex,
        "FLOOR",
      );
      const anchorFrameIndex = clampFrameIndex(
        prepared.atTimeSeconds,
        frameDuration,
        maxFrameIndex,
        "ROUND",
      );
      const endFrameIndex = clampFrameIndex(
        input.endMs / 1000,
        frameDuration,
        maxFrameIndex,
        "CEIL_MINUS_ONE",
      );
      if (anchorFrameIndex < startFrameIndex || anchorFrameIndex > endFrameIndex) {
        throw new Error("PRACTICE_ROTO_ANCHOR_OUTSIDE_EFFECT_WINDOW");
      }
      const backwardSteps = anchorFrameIndex - startFrameIndex;
      const forwardSteps = endFrameIndex - anchorFrameIndex;
      if (backwardSteps > 12 || forwardSteps > 12) {
        throw new Error(
          "PRACTICE_ROTO_WINDOW_EXCEEDS_PROVEN_PROPAGATION:"
          + String(backwardSteps) + ":" + String(forwardSteps),
        );
      }
      const anchorTime = anchorFrameIndex * frameDuration;
      const startTime = startFrameIndex * frameDuration;
      const endTime = endFrameIndex * frameDuration;
      evidence.push(
        "practice-roto-frame-window:"
        + startFrameIndex + ":" + anchorFrameIndex + ":" + endFrameIndex,
      );

      const seed = await this.seedController.run({
        operation: "SEED_FOREGROUND",
        compHostId: workingTarget.compHostId,
        layerHostId: workingTarget.layerHostId,
        expectedCompName: workingTarget.compName,
        expectedLayerName: workingTarget.layerName,
        atTime: anchorTime,
        stroke: foregroundStrokeForBox(binding.sourceSubjectBox),
        evidenceIds: [
          ...evidence,
          "practice-roto-seed-subject:" + binding.sourceSemanticId,
        ],
      });
      if (seed.route !== "LOCAL" || seed.finalEffectMatchCount !== 1) {
        throw new Error(
          "PRACTICE_ROTO_SEED_REJECTED:"
          + String(seed.escalationReason ?? "UNVERIFIED"),
        );
      }
      seedUndoEntries = 1;
      if (seed.visualEvidenceId !== null) {
        evidence.push("practice-roto-seed-visual:" + seed.visualEvidenceId);
      }
      evidence.push(
        "practice-roto-seed-session:" + String(seed.finalSessionRevision),
        "practice-roto-seed-undo-entry:1",
      );

      if (backwardSteps > 0) {
        const reset = await this.targetPreparer.prepare({
          requestId: "PRACTICE_ROTO_BACKWARD_PREP_" + token,
          target: workingTarget,
          atTimeSeconds: anchorTime,
        });
        evidence.push(...reset.evidenceRefs);
        await verifyPreparedTarget(
          this.transport,
          workingTarget,
          anchorTime,
          "BACKWARD_" + token,
        );
        const backward = await this.propagationController.run({
          operation: "PROPAGATE_BACKWARD",
          compHostId: workingTarget.compHostId,
          layerHostId: workingTarget.layerHostId,
          expectedCompName: workingTarget.compName,
          expectedLayerName: workingTarget.layerName,
          range: { startTime, endTime: anchorTime },
          evidenceIds: [...evidence, "practice-roto-propagation:backward"],
        });
        if (backward.route !== "LOCAL"
          || backward.expectedFrameSteps !== backwardSteps) {
          throw new Error(
            "PRACTICE_ROTO_BACKWARD_REJECTED:"
            + String(backward.escalationReason ?? "UNVERIFIED"),
          );
        }
        evidence.push(
          "practice-roto-propagation-backward:" + String(backwardSteps),
        );
      }

      if (forwardSteps > 0) {
        const reset = await this.targetPreparer.prepare({
          requestId: "PRACTICE_ROTO_FORWARD_PREP_" + token,
          target: workingTarget,
          atTimeSeconds: anchorTime,
        });
        evidence.push(...reset.evidenceRefs);
        await verifyPreparedTarget(
          this.transport,
          workingTarget,
          anchorTime,
          "FORWARD_" + token,
        );
        const forward = await this.propagationController.run({
          operation: "PROPAGATE_FORWARD",
          compHostId: workingTarget.compHostId,
          layerHostId: workingTarget.layerHostId,
          expectedCompName: workingTarget.compName,
          expectedLayerName: workingTarget.layerName,
          range: { startTime: anchorTime, endTime },
          evidenceIds: [...evidence, "practice-roto-propagation:forward"],
        });
        if (forward.route !== "LOCAL"
          || forward.expectedFrameSteps !== forwardSteps) {
          throw new Error(
            "PRACTICE_ROTO_FORWARD_REJECTED:"
            + String(forward.escalationReason ?? "UNVERIFIED"),
          );
        }
        evidence.push(
          "practice-roto-propagation-forward:" + String(forwardSteps),
        );
      }

      const exported = await this.exportController.run({
        compHostId: workingTarget.compHostId,
        layerHostId: workingTarget.layerHostId,
        expectedCompName: workingTarget.compName,
        expectedLayerName: workingTarget.layerName,
        export: {
          kind: "TRACK_MATTE",
          stableId: matteLayerStableId,
        },
        evidenceIds: [
          ...evidence,
          "practice-roto-export-kind:TRACK_MATTE",
        ],
      });
      if (exported.route !== "LOCAL"
        || !exported.structuralOutputVerified
        || !exported.nativeRotoOutputVerified
        || exported.outputLayerHostId === null) {
        throw new Error(
          "PRACTICE_ROTO_EXPORT_REJECTED:"
          + String(exported.escalationReason ?? "UNVERIFIED"),
        );
      }
      exportUndoEntries = 1;
      evidence.push(
        "practice-roto-export-host-id:" + String(exported.outputLayerHostId),
        "practice-roto-export-undo-entry:1",
      );

      finalOperations = await executeMutationPlan(
        this.transaction,
        "practice-roto-bind-matte:" + token,
        [
          {
            protocolVersion: "1.3.0",
            capabilityId: "ae.layer.track_matte.set",
            command: "layer.set_track_matte",
            payload: {
              comp: { stableId: input.compStableId },
              layer: { stableId: input.layerId },
              matteLayer: { stableId: matteLayerStableId },
              trackMatteType: "ALPHA",
            },
            riskClass: "R1_REVERSIBLE",
          },
          {
            protocolVersion: "1.1.0",
            capabilityId: "ae.layer.remove",
            command: "layer.remove",
            payload: {
              comp: { stableId: input.compStableId },
              layer: { stableId: workingLayerStableId },
            },
            riskClass: "R2_STRUCTURAL",
          },
        ],
        evidence,
      );
      if (finalOperations !== 2) {
        throw new Error("PRACTICE_ROTO_FINAL_OPERATION_COUNT_MISMATCH");
      }
      const totalAppliedOperations =
        workingCreatedOperations + seedUndoEntries + exportUndoEntries + finalOperations;
      if (totalAppliedOperations !== 5) {
        throw new Error("PRACTICE_ROTO_UNDO_ACCOUNTING_MISMATCH");
      }
      finalCommitted = true;
      return {
        verified: true,
        routeId: PRACTICE_M6_ROTO_BRUSH_SUBJECT_ISOLATION_ROUTE_ID_V1,
        referenceSemanticId: input.referenceSemanticId,
        sourceSemanticId: binding.sourceSemanticId,
        crossSourceIdentityVerified: true,
        targetBindingVerified: true,
        targetShotId: input.shotId,
        targetCompStableId: input.compStableId,
        targetLayerStableId: input.layerId,
        maskSource: "ROTO_BRUSH",
        appliedOperations: totalAppliedOperations,
        evidenceRefs: [
          ...new Set([
            ...evidence,
            "practice-roto-working-layer-cleaned:true",
            "practice-roto-final-matte:" + matteLayerStableId,
            "practice-roto-applied-undo-entries:"
              + String(totalAppliedOperations),
          ]),
        ],
      };
    } catch (error) {
      if (!finalCommitted) {
        try {
          const cleanupOperations = await this.#cleanupOwnedLayers(
            input,
            [matteLayerStableId, workingLayerStableId],
            token,
          );
          const failedUndoEntries = workingCreatedOperations
            + seedUndoEntries
            + exportUndoEntries
            + finalOperations
            + cleanupOperations;
          throw new PracticeSubjectIsolationBackendFailureV1(
            "PRACTICE_ROTO_BACKEND_REJECTED:" + String(error),
            failedUndoEntries,
            [
              ...evidence,
              "practice-roto-cleanup-confirmed:true",
              "practice-roto-failed-undo-entries:" + String(failedUndoEntries),
            ],
            true,
          );
        } catch (cleanupError) {
          if (cleanupError instanceof PracticeSubjectIsolationBackendFailureV1) {
            throw cleanupError;
          }
          throw new PracticeSubjectIsolationBackendFailureV1(
            "PRACTICE_ROTO_FAILURE_WITH_CLEANUP_FAILURE:"
            + String(error) + ":cleanup=" + String(cleanupError),
            workingCreatedOperations
              + seedUndoEntries
              + exportUndoEntries
              + finalOperations,
            [
              ...evidence,
              "practice-roto-cleanup-confirmed:false",
            ],
            false,
          );
        }
      }
      throw error;
    }
  }
}

export interface RetainedPracticeRotoBrushRuntimeConfigV1 {
  readonly transaction: PracticeM6CurrentAeTransactionV1;
  readonly media: PracticeM6LocalMediaAnalyzerV1;
  readonly transport: CurrentAeCepTransactionalTransportV1;
  readonly repositoryRoot: string;
  readonly artifactDir: string;
  readonly pythonPath: string;
  readonly visualWorkingDirectory: string;
  readonly afterFxPath: string;
  readonly runtimeEvidencePath: string;
  readonly runtimeEvidenceSha256Path?: string;
  readonly seedVisualScriptPath?: string;
  readonly propagationVisualScriptPath?: string;
  readonly toolSelectScriptPath?: string;
  readonly targetPrepareScriptPath?: string;
  readonly visualTimeoutMs?: number;
}

const resolvedRotoRuntimePaths = (
  config: RetainedPracticeRotoBrushRuntimeConfigV1,
) => {
  const repositoryRoot = path.resolve(config.repositoryRoot);
  return {
    repositoryRoot,
    pythonPath: path.resolve(config.pythonPath),
    visualWorkingDirectory: path.resolve(config.visualWorkingDirectory),
    afterFxPath: path.resolve(config.afterFxPath),
    runtimeEvidencePath: path.resolve(config.runtimeEvidencePath),
    runtimeEvidenceSha256Path: path.resolve(
      config.runtimeEvidenceSha256Path
        ?? config.runtimeEvidencePath + ".sha256",
    ),
    seedVisualScriptPath: path.resolve(
      config.seedVisualScriptPath
        ?? path.join(
          repositoryRoot,
          "packages",
          "adapters",
          "ae-cep",
          "runtime",
          "editgpt_roto_brush_seed_visual_driver.py",
        ),
    ),
    propagationVisualScriptPath: path.resolve(
      config.propagationVisualScriptPath
        ?? path.join(
          repositoryRoot,
          "packages",
          "adapters",
          "ae-cep",
          "runtime",
          "editgpt_roto_brush_propagation_visual_driver.py",
        ),
    ),
    toolSelectScriptPath: path.resolve(
      config.toolSelectScriptPath
        ?? path.join(
          repositoryRoot,
          "scripts",
          "windows",
          "m5-roto-brush-tool-select.jsx",
        ),
    ),
    targetPrepareScriptPath: path.resolve(
      config.targetPrepareScriptPath
        ?? path.join(
          repositoryRoot,
          "scripts",
          "windows",
          "practice-roto-brush-target-prepare.jsx",
        ),
    ),
  };
};

export const retainedPracticeRotoBrushRuntimePresentV1 = (
  config: RetainedPracticeRotoBrushRuntimeConfigV1,
): boolean => {
  const paths = resolvedRotoRuntimePaths(config);
  return [
    paths.pythonPath,
    paths.visualWorkingDirectory,
    paths.afterFxPath,
    paths.runtimeEvidencePath,
    paths.runtimeEvidenceSha256Path,
    paths.seedVisualScriptPath,
    paths.propagationVisualScriptPath,
    paths.toolSelectScriptPath,
    paths.targetPrepareScriptPath,
  ].every((item) => existsSync(item));
};

const fileSha256 = async (filePath: string): Promise<string> =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

export const createRetainedPracticeRotoBrushSubjectIsolationRouteV1 = (
  config: RetainedPracticeRotoBrushRuntimeConfigV1,
): PracticeM6RotoBrushSubjectIsolationRouteV1 | null => {
  if (!retainedPracticeRotoBrushRuntimePresentV1(config)) return null;
  const paths = resolvedRotoRuntimePaths(config);
  const evidenceRoot = path.resolve(config.artifactDir);
  const seedDriver = new EditGptRotoBrushSeedVisualDriverV1({
    executablePath: paths.pythonPath,
    scriptPath: paths.seedVisualScriptPath,
    workingDirectory: paths.visualWorkingDirectory,
    afterFxPath: paths.afterFxPath,
    toolSelectScriptPath: paths.toolSelectScriptPath,
    evidenceDirectory: path.join(evidenceRoot, "seed"),
    timeoutMs: config.visualTimeoutMs ?? 120_000,
  });
  const propagationDriver = new EditGptRotoBrushPropagationVisualDriverV1({
    executablePath: paths.pythonPath,
    scriptPath: paths.propagationVisualScriptPath,
    workingDirectory: paths.visualWorkingDirectory,
    evidenceDirectory: path.join(evidenceRoot, "propagation"),
    timeoutMs: config.visualTimeoutMs ?? 120_000,
  });
  const seedController = new GuardedRotoBrushSeedControllerV1(
    config.transport,
    seedDriver,
  );
  const propagationController = new GuardedRotoBrushPropagationControllerV1(
    config.transport,
    propagationDriver,
  );
  const exportController = new GuardedRotoBrushExportControllerV1({
    dispatchRoto: async (request) => await config.transport.dispatch(request),
    dispatchHost: async (request) => await config.transport.dispatch(request),
  });
  const targetPreparer = new AfterFxPracticeRotoTargetPreparerV1({
    afterFxPath: paths.afterFxPath,
    scriptPath: paths.targetPrepareScriptPath,
  });
  let runtimeProof: Promise<readonly string[]> | null = null;
  const runtimeGate: PracticeRotoRuntimeGateV1 = {
    verify: async () => {
      runtimeProof ??= (async (): Promise<readonly string[]> => {
        const trusted = await loadTrustedM5RotoBrushRuntimeEvidenceV1({
          evidencePath: paths.runtimeEvidencePath,
          sha256Path: paths.runtimeEvidenceSha256Path,
        });
        if (trusted === null) {
          throw new Error("PRACTICE_ROTO_RUNTIME_EVIDENCE_UNTRUSTED");
        }
        const [
          seedDigest,
          propagationDigest,
          toolDigest,
          prepareDigest,
        ] = await Promise.all([
          fileSha256(paths.seedVisualScriptPath),
          fileSha256(paths.propagationVisualScriptPath),
          fileSha256(paths.toolSelectScriptPath),
          fileSha256(paths.targetPrepareScriptPath),
        ]);
        return [
          "m5-roto-runtime-evidence:" + trusted.evidence.evidenceId,
          "m5-roto-runtime-evidence-file:sha256:"
            + trusted.evidenceFileSha256,
          "practice-roto-seed-driver:sha256:" + seedDigest,
          "practice-roto-propagation-driver:sha256:" + propagationDigest,
          "practice-roto-tool-select:sha256:" + toolDigest,
          "practice-roto-target-prepare:sha256:" + prepareDigest,
        ];
      })();
      return await runtimeProof;
    },
  };
  return new PracticeM6RotoBrushSubjectIsolationRouteV1({
    transaction: config.transaction,
    media: config.media,
    transport: config.transport,
    targetPreparer,
    seedController,
    propagationController,
    exportController,
    runtimeGate,
  });
};
