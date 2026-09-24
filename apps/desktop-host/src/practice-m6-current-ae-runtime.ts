import type {
  ExecutionPlan,
  ObservedProjectState,
} from "../../../packages/core-contracts/src/index.js";
import type {
  ExecutionResult,
} from "../../../packages/executor/src/index.js";
import type { VirtualAeProjectV1 } from "../../../packages/virtual-ae/src/index.js";
import {
  buildM6MotionPeakCompilerContextV1,
  compileConstructionGraphV1,
  compileConstructionThroughNativeAeV1,
  type ConstructionGraphV1,
  type DenseEffectEvidenceV1,
  type DenseEffectWindowV1,
} from "../../../packages/visual-effects-intelligence/src/index.js";
import type {
  PracticeReferenceAnalysisV1,
  PracticeSceneMatchV1,
} from "../../../packages/practice-homework/src/contracts.js";
import type {
  PracticeAeBaselinePlanV1,
  PracticeAeBaselineBuilderV1,
} from "../../../packages/practice-homework/src/ae-baseline.js";
import type {
  PracticeContentStructureEvaluationV1,
  PracticeM6RuntimeV1,
} from "../../../packages/practice-homework/src/m6-practice.js";
import { PracticeM6LocalMediaAnalyzerV1 } from "./practice-m6-media.js";

export const PRACTICE_M6_NATIVE_CAPABILITIES_V1 = [
  "ae.layer.duplicate",
  "ae.layer.time.offset",
  "ae.layer.opacity.set",
  "ae.layer.transform.set",
  "ae.keyframe.temporal_ease.set",
  "ae.keyframe.spatial.set",
  "ae.effect.directional-blur",
  "ae.effect.displacement-map",
  "ae.effect.turbulent-displace",
  "ae.effect.echo",
  "ae.effect.exposure",
  "ae.effect.channel-shift",
  "ae.layer.blend_mode.set",
  "ae.layer.matte.set",
  "ae.layer.order.set",
  "ae.precompose.layers",
] as const;

export interface PracticeM6CurrentAeTransactionV1 {
  readonly maxOperations: number;
  observe(): Promise<ObservedProjectState>;
  execute(plan: ExecutionPlan): Promise<ExecutionResult>;
  executeCorrection(plan: ExecutionPlan): Promise<ExecutionResult>;
}

export type PracticeM6VerifiedSubjectIsolationSourceV1 =
  | "SEGMENTATION"
  | "AE_TRACKED_MASK"
  | "ROTO_BRUSH";

export interface PracticeM6VerifiedSubjectIsolationV1 {
  readonly verified: true;
  readonly routeId: string;
  readonly referenceSemanticId: string;
  readonly sourceSemanticId: string;
  readonly crossSourceIdentityVerified: true;
  readonly targetBindingVerified: true;
  readonly targetShotId: string;
  readonly targetCompStableId: string;
  readonly targetLayerStableId: string;
  readonly maskSource: PracticeM6VerifiedSubjectIsolationSourceV1;
  readonly appliedOperations: number;
  readonly evidenceRefs: readonly string[];
}

export interface PracticeM6SubjectIsolationRouteV1 {
  prepare(input: {
    readonly sessionId: string;
    readonly attempt: number;
    readonly reference: PracticeReferenceAnalysisV1;
    readonly sourceMatch: PracticeSceneMatchV1;
    readonly baselinePlan: PracticeAeBaselinePlanV1;
    readonly window: DenseEffectWindowV1;
    readonly shotId: string;
    readonly compStableId: string;
    readonly layerId: string;
    readonly startMs: number;
    readonly endMs: number;
    readonly referenceSemanticId: string;
  }): Promise<PracticeM6VerifiedSubjectIsolationV1>;
}

export interface PracticeM6AeRenderDriverV1 {
  prepareAttempt(input: {
    readonly sessionId: string;
    readonly attempt: number;
    readonly baselinePlan: PracticeAeBaselinePlanV1;
  }): Promise<{ readonly evidenceRefs?: readonly string[] }>;
  renderWindow(input: {
    readonly sessionId: string;
    readonly attempt: number;
    readonly compStableId: string;
    readonly windowId: string;
    readonly startMs: number;
    readonly endMs: number;
  }): Promise<{
    readonly renderPath: string;
    readonly evidenceRefs?: readonly string[];
  }>;
  renderFullEdit(input: {
    readonly sessionId: string;
    readonly attempt: number;
    readonly compStableId: string;
    readonly durationMs: number;
  }): Promise<{
    readonly renderPath: string;
    readonly evidenceRefs?: readonly string[];
  }>;
  recordAppliedOperations?(input: {
    readonly sessionId: string;
    readonly attempt: number;
    readonly count: number;
  }): void;
}

interface PreparedAttemptV1 {
  readonly reference: PracticeReferenceAnalysisV1;
  readonly matches: readonly PracticeSceneMatchV1[];
  readonly plan: PracticeAeBaselinePlanV1;
  readonly project: VirtualAeProjectV1;
  readonly shotLayerById: ReadonlyMap<string, string>;
  readonly evidenceRefs: string[];
}

const attemptKey = (sessionId: string, attempt: number): string =>
  sessionId + "::" + String(attempt);

const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const unique = (values: readonly string[]): readonly string[] =>
  [...new Set(values.filter((value) => value.trim().length > 0))];

const subjectSemanticIdsForWindow = (
  window: DenseEffectWindowV1,
): readonly string[] => unique(window.evidence.frames
  .filter((frame) =>
    frame.subjectTrackState !== "UNOBSERVED"
    && frame.subjectTrackState !== "LOST")
  .map((frame) => frame.subjectSemanticId ?? ""));

const acceptedSubjectIsolationProof = (
  proof: PracticeM6VerifiedSubjectIsolationV1,
  expected: {
    readonly referenceSemanticId: string;
    readonly shotId: string;
    readonly compStableId: string;
    readonly layerId: string;
  },
): boolean =>
  proof?.verified === true
  && proof.crossSourceIdentityVerified === true
  && proof.targetBindingVerified === true
  && proof.referenceSemanticId === expected.referenceSemanticId
  && proof.targetShotId === expected.shotId
  && proof.targetCompStableId === expected.compStableId
  && proof.targetLayerStableId === expected.layerId
  && nonEmptyString(proof.sourceSemanticId) !== null
  && nonEmptyString(proof.routeId) !== null
  && ["SEGMENTATION", "AE_TRACKED_MASK", "ROTO_BRUSH"].includes(proof.maskSource)
  && Number.isInteger(proof.appliedOperations)
  && proof.appliedOperations > 0
  && Array.isArray(proof.evidenceRefs)
  && unique(proof.evidenceRefs).length > 0;

const shotsForWindow = (
  reference: PracticeReferenceAnalysisV1,
  window: DenseEffectWindowV1,
): readonly PracticeReferenceAnalysisV1["shots"][number][] => {
  const intersecting = [...reference.shots]
    .sort((a, b) => a.order - b.order)
    .filter((shot) =>
      Math.min(window.endMs, shot.referenceEndMs)
        - Math.max(window.startMs, shot.referenceStartMs) > 0.5);
  if (intersecting.length > 0) return intersecting;
  const ordered = [...reference.shots].sort((left, right) => {
    const leftCenter = (left.referenceStartMs + left.referenceEndMs) / 2;
    const rightCenter = (right.referenceStartMs + right.referenceEndMs) / 2;
    return Math.abs(window.anchorMs - leftCenter)
      - Math.abs(window.anchorMs - rightCenter);
  });
  const nearest = ordered[0];
  if (nearest === undefined) {
    throw new TypeError("Practice M6 runtime requires at least one reference shot.");
  }
  return [nearest];
};

const shotLayerMap = (
  reference: PracticeReferenceAnalysisV1,
  plan: PracticeAeBaselinePlanV1,
): ReadonlyMap<string, string> => {
  const layerIds = plan.operations
    .filter((operation) => operation.command === "layer.add_media")
    .map((operation) => nonEmptyString(operation.payload["stableId"]))
    .filter((value): value is string =>
      value !== null && value.startsWith("PRACTICE_SHOT_"));
  const shots = [...reference.shots].sort((a, b) => a.order - b.order);
  if (layerIds.length !== shots.length) {
    throw new TypeError(
      "Practice M6 baseline shot-layer topology does not match the reference shot count.",
    );
  }
  return new Map(shots.map((shot, index) => [shot.shotId, layerIds[index]!]));
};

const virtualProjectForBaseline = (
  reference: PracticeReferenceAnalysisV1,
  plan: PracticeAeBaselinePlanV1,
  matches: readonly PracticeSceneMatchV1[],
  layers: ReadonlyMap<string, string>,
): VirtualAeProjectV1 => {
  if (reference.video === undefined) {
    throw new TypeError("Practice M6 native compilation requires reference video metadata.");
  }
  const matchByShot = new Map(matches.map((match) => [match.shotId, match]));
  return {
    schema: "editflow.virtual-ae.project.v1",
    activeCompId: plan.compStableId,
    compositions: [{
      compId: plan.compStableId,
      name: "Practice M6 - " + reference.referenceId,
      width: reference.video.width,
      height: reference.video.height,
      durationMs: reference.video.durationMs,
      frameRate: reference.video.fps,
      layers: [...reference.shots]
        .sort((a, b) => a.order - b.order)
        .map((shot) => {
          const layerId = layers.get(shot.shotId);
          const match = matchByShot.get(shot.shotId);
          if (layerId === undefined || match === undefined) {
            throw new TypeError(
              "Practice M6 virtual project is missing a retained source match for "
                + shot.shotId + ".",
            );
          }
          return {
            layerId,
            name: "Practice shot " + String(shot.order + 1),
            kind: "FOOTAGE" as const,
            sourceRef: match.sourceId,
            inMs: shot.referenceStartMs,
            outMs: shot.referenceEndMs,
            properties: [],
            effects: [],
            masks: [],
          };
        }),
    }],
  };
};

export class PracticeM6CurrentAeRuntimeV1 implements PracticeM6RuntimeV1 {
  readonly transaction: PracticeM6CurrentAeTransactionV1;
  readonly baselineBuilder: PracticeAeBaselineBuilderV1;
  readonly media: PracticeM6LocalMediaAnalyzerV1;
  readonly renderDriver: PracticeM6AeRenderDriverV1;
  readonly subjectIsolationRoute: PracticeM6SubjectIsolationRouteV1 | null;
  readonly availableCapabilities: readonly string[];

  readonly #prepared = new Map<string, PreparedAttemptV1>();
  #applyCounter = 0;

  constructor(input: {
    readonly transaction: PracticeM6CurrentAeTransactionV1;
    readonly baselineBuilder: PracticeAeBaselineBuilderV1;
    readonly media: PracticeM6LocalMediaAnalyzerV1;
    readonly renderDriver: PracticeM6AeRenderDriverV1;
    readonly subjectIsolationRoute?: PracticeM6SubjectIsolationRouteV1 | null;
    readonly availableCapabilities?: readonly string[];
  }) {
    this.transaction = input.transaction;
    this.baselineBuilder = input.baselineBuilder;
    this.media = input.media;
    this.renderDriver = input.renderDriver;
    this.subjectIsolationRoute = input.subjectIsolationRoute ?? null;
    const declaredCapabilities = input.availableCapabilities
      ?? PRACTICE_M6_NATIVE_CAPABILITIES_V1;
    this.availableCapabilities = unique([
      ...declaredCapabilities,
      ...(this.subjectIsolationRoute === null ? [] : ["ae.subject.isolate"]),
    ]);
    if (this.availableCapabilities.length === 0) {
      throw new TypeError("Practice M6 runtime requires at least one available capability.");
    }
  }

  async analyzeReference(
    reference: PracticeReferenceAnalysisV1,
  ): Promise<DenseEffectEvidenceV1> {
    if (reference.sourcePath === undefined || reference.video === undefined) {
      throw new TypeError(
        "Practice M6 reference analysis requires a local Finish path and video metadata.",
      );
    }
    return await this.media.analyzeVideo({
      videoPath: reference.sourcePath,
      sourceId: reference.referenceId,
      sourceKind: "REFERENCE",
      startMs: 0,
      endMs: reference.video.durationMs,
    });
  }

  async prepareAttempt(
    input: Parameters<PracticeM6RuntimeV1["prepareAttempt"]>[0],
  ): Promise<void> {
    const plan = this.baselineBuilder.plan(input.baseline.baselineId);
    if (plan === null) {
      throw new TypeError(
        "Practice M6 runtime cannot resolve baseline plan " + input.baseline.baselineId + ".",
      );
    }
    if (plan.referenceId !== input.reference.referenceId) {
      throw new TypeError("Practice M6 baseline/reference identity mismatch.");
    }
    const shotLayers = shotLayerMap(input.reference, plan);
    const project = virtualProjectForBaseline(
      input.reference,
      plan,
      input.matches,
      shotLayers,
    );
    const prepared = await this.renderDriver.prepareAttempt({
      sessionId: input.sessionId,
      attempt: input.attempt,
      baselinePlan: plan,
    });
    this.#prepared.set(attemptKey(input.sessionId, input.attempt), {
      reference: input.reference,
      matches: input.matches,
      plan,
      project,
      shotLayerById: shotLayers,
      evidenceRefs: [...(prepared.evidenceRefs ?? [])],
    });
  }

  #requirePrepared(
    sessionId: string,
    attempt: number,
  ): PreparedAttemptV1 {
    const prepared = this.#prepared.get(attemptKey(sessionId, attempt));
    if (prepared === undefined) {
      throw new TypeError(
        "Practice M6 attempt must be prepared before native construction or rendering.",
      );
    }
    return prepared;
  }

  async applyWindowGraph(
    input: Parameters<PracticeM6RuntimeV1["applyWindowGraph"]>[0],
  ): Promise<void> {
    const prepared = this.#requirePrepared(input.sessionId, input.attempt);
    const requiresSubjectIsolation = input.graph.nodes.some((node) =>
      node.kind === "SUBJECT_ISOLATION");
    const referenceSubjectIds = requiresSubjectIsolation
      ? subjectSemanticIdsForWindow(input.window)
      : [];
    if (requiresSubjectIsolation && referenceSubjectIds.length !== 1) {
      throw new Error(
        "PRACTICE_M6_SUBJECT_IDENTITY_UNVERIFIED: subject isolation requires exactly "
          + "one persistent reference semantic identity; found "
          + String(referenceSubjectIds.length) + ".",
      );
    }
    if (requiresSubjectIsolation && this.subjectIsolationRoute === null) {
      throw new Error(
        "PRACTICE_M6_SUBJECT_ISOLATION_ROUTE_UNVERIFIED: the construction graph "
          + "requires subject isolation, but no validated segmentation/tracked-mask/"
          + "Roto Brush route is registered.",
      );
    }
    const compilation = compileConstructionGraphV1(
      input.graph,
      this.availableCapabilities,
    );
    if (compilation.recipe === null || !compilation.definingCoverageComplete) {
      throw new Error(
        "PRACTICE_M6_NATIVE_COMPILE_BLOCKED: "
          + compilation.capabilityGaps.join(", "),
      );
    }
    const shots = shotsForWindow(input.reference, input.window);
    let committedTargets = 0;
    for (const shot of shots) {
      const layerId = prepared.shotLayerById.get(shot.shotId);
      if (layerId === undefined) {
        throw new TypeError(
          "Practice M6 could not bind effect window to baseline shot layer "
            + shot.shotId + ".",
        );
      }

      let targetStartMs = Math.max(input.window.startMs, shot.referenceStartMs);
      let targetEndMs = Math.min(input.window.endMs, shot.referenceEndMs);
      if (targetEndMs <= targetStartMs) {
        const frameMs = Math.max(1, input.window.evidence.summary.frameIntervalMs);
        const spanMs = Math.min(
          shot.referenceEndMs - shot.referenceStartMs,
          Math.max(frameMs * 2, 2),
        );
        targetStartMs = Math.max(
          shot.referenceStartMs,
          Math.min(input.window.anchorMs - spanMs / 2, shot.referenceEndMs - spanMs),
        );
        targetEndMs = Math.min(shot.referenceEndMs, targetStartMs + spanMs);
      }
      if (targetEndMs <= targetStartMs) continue;

      if (requiresSubjectIsolation) {
        const route = this.subjectIsolationRoute;
        const referenceSemanticId = referenceSubjectIds[0];
        const sourceMatch = prepared.matches.find((match) => match.shotId === shot.shotId);
        if (route === null || referenceSemanticId === undefined || sourceMatch === undefined) {
          throw new Error(
            "PRACTICE_M6_SUBJECT_ISOLATION_BINDING_MISSING:" + shot.shotId,
          );
        }
        const isolation = await route.prepare({
          sessionId: input.sessionId,
          attempt: input.attempt,
          reference: input.reference,
          sourceMatch,
          baselinePlan: prepared.plan,
          window: input.window,
          shotId: shot.shotId,
          compStableId: prepared.plan.compStableId,
          layerId,
          startMs: targetStartMs,
          endMs: targetEndMs,
          referenceSemanticId,
        });
        if (!acceptedSubjectIsolationProof(isolation, {
          referenceSemanticId,
          shotId: shot.shotId,
          compStableId: prepared.plan.compStableId,
          layerId,
        })) {
          throw new Error(
            "PRACTICE_M6_SUBJECT_ISOLATION_PROOF_REJECTED:" + shot.shotId,
          );
        }
        this.renderDriver.recordAppliedOperations?.({
          sessionId: input.sessionId,
          attempt: input.attempt,
          count: isolation.appliedOperations,
        });
        prepared.evidenceRefs.push(
          ...isolation.evidenceRefs,
          "practice-subject-isolation-route:" + isolation.routeId,
          "practice-subject-reference-id:" + isolation.referenceSemanticId,
          "practice-subject-source-id:" + isolation.sourceSemanticId,
          "practice-subject-cross-source-identity:true",
          "practice-subject-target-binding:true",
          "practice-subject-target-shot:" + isolation.targetShotId,
          "practice-subject-target-comp:" + isolation.targetCompStableId,
          "practice-subject-target-layer:" + isolation.targetLayerStableId,
          "practice-subject-mask-source:" + isolation.maskSource,
        );
      }

      const context = buildM6MotionPeakCompilerContextV1({
        reference: input.window.evidence,
        compId: prepared.plan.compStableId,
        targetRangeMs: {
          startMs: targetStartMs,
          endMs: targetEndMs,
        },
        roleBindings: [{ role: "hero", layerIds: [layerId] }],
      });
      const observed = await this.transaction.observe();
      const native = compileConstructionThroughNativeAeV1(
        compilation,
        prepared.project,
        context,
        {
          planId: [
            "practice-m6",
            input.sessionId,
            String(input.attempt),
            input.window.windowId,
            shot.shotId,
            String(++this.#applyCounter),
          ].join(":"),
          observedState: observed,
          curveBindingMode: "LIVE_ADAPTIVE",
          creativeObjective:
            "Reconstruct the defining visual behavior of this Practice reference window "
              + "over the measured overlap with " + shot.shotId + ".",
          recipeRefs: [
            input.graph.graphId,
            prepared.plan.baselineId,
            input.window.windowId,
            shot.shotId,
          ],
        },
      );
      if (!native.compiled || native.plan === null) {
        throw new Error(
          "PRACTICE_M6_NATIVE_LOWERING_FAILED:" + shot.shotId + ": "
            + native.issues.join(", "),
        );
      }
      const result = native.plan.operations.length <= this.transaction.maxOperations
        ? await this.transaction.execute(native.plan)
        : await this.transaction.executeCorrection(native.plan);
      if (result.state !== "COMMITTED") {
        throw new Error(
          "PRACTICE_M6_NATIVE_TRANSACTION_" + result.state
            + ":" + shot.shotId
            + ": recovered=" + String(result.recovered)
            + (result.error === undefined ? "" : "; cause=" + result.error),
        );
      }
      committedTargets += 1;
      this.renderDriver.recordAppliedOperations?.({
        sessionId: input.sessionId,
        attempt: input.attempt,
        count: result.appliedOperations,
      });
      prepared.evidenceRefs.push(
        "practice-m6-native-plan:" + String(native.plan.planId),
        "practice-m6-native-transaction:" + String(result.transactionId) + ":" + result.state,
        "practice-m6-native-applied:" + String(result.appliedOperations),
        "practice-m6-window:" + input.window.windowId,
        "practice-m6-target-shot:" + shot.shotId,
        "practice-m6-window-overlap:" + shot.shotId + ":"
          + targetStartMs.toFixed(3) + "-" + targetEndMs.toFixed(3),
      );
    }
    if (committedTargets === 0) {
      throw new TypeError(
        "Practice M6 effect window did not overlap any reconstructable reference shot.",
      );
    }
  }

  async renderWindowEvidence(
    input: Parameters<PracticeM6RuntimeV1["renderWindowEvidence"]>[0],
  ): Promise<DenseEffectEvidenceV1> {
    const prepared = this.#requirePrepared(input.sessionId, input.attempt);
    const rendered = await this.renderDriver.renderWindow({
      sessionId: input.sessionId,
      attempt: input.attempt,
      compStableId: prepared.plan.compStableId,
      windowId: input.window.windowId,
      startMs: input.window.startMs,
      endMs: input.window.endMs,
    });
    prepared.evidenceRefs.push(...(rendered.evidenceRefs ?? []));
    return await this.media.analyzeVideo({
      videoPath: rendered.renderPath,
      sourceId: [
        "practice-render-window",
        input.sessionId,
        String(input.attempt),
        input.window.windowId,
      ].join(":"),
      sourceKind: "RENDER",
      startMs: 0,
      endMs: input.window.endMs - input.window.startMs,
    });
  }

  async renderFullEdit(
    input: Parameters<PracticeM6RuntimeV1["renderFullEdit"]>[0],
  ): Promise<{ readonly renderRef: string; readonly evidenceRefs: readonly string[] }> {
    const prepared = this.#requirePrepared(input.sessionId, input.attempt);
    const rendered = await this.renderDriver.renderFullEdit({
      sessionId: input.sessionId,
      attempt: input.attempt,
      compStableId: prepared.plan.compStableId,
      durationMs: prepared.plan.durationMs,
    });
    return {
      renderRef: rendered.renderPath,
      evidenceRefs: unique([
        ...prepared.evidenceRefs,
        ...(rendered.evidenceRefs ?? []),
        "practice-m6-full-render:" + rendered.renderPath,
      ]),
    };
  }

  async analyzeRender(
    input: Parameters<PracticeM6RuntimeV1["analyzeRender"]>[0],
  ): Promise<DenseEffectEvidenceV1> {
    if (input.reference.video === undefined) {
      throw new TypeError("Practice M6 render analysis requires reference video metadata.");
    }
    return await this.media.analyzeVideo({
      videoPath: input.renderRef,
      sourceId: "practice-render:" + input.reference.referenceId,
      sourceKind: "RENDER",
      startMs: 0,
      endMs: input.reference.video.durationMs,
    });
  }

  async evaluateContentStructure(
    input: Parameters<PracticeM6RuntimeV1["evaluateContentStructure"]>[0],
  ): Promise<PracticeContentStructureEvaluationV1> {
    return await this.media.compareContentStructure({
      reference: input.reference,
      renderPath: input.renderRef,
      matches: input.matches,
    });
  }
}
