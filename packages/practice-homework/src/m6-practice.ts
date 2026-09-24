import type {
  ConstructionGraphV1,
  DenseEffectEvidenceV1,
  DenseEffectSequenceV1,
  DenseEffectWindowV1,
  FidelityComparisonV1,
  M6ProductionRequestV1,
  M6ProductionResultV1,
  SemanticPatchV1,
  TransitionDnaV1,
} from "../../visual-effects-intelligence/src/index.js";
import {
  VisualEffectsBrainV1,
  alignDenseEffectSequencesV1,
  applySemanticPatchesV1,
  buildConstructionGraphV1,
  classifyEffectFamilyV1,
  compareSemanticVisualFidelityV1,
  decomposeUnknownEffectV1,
  deriveEffectAnatomyV1,
  detectDenseEffectWindowsV1,
  synthesizeUnknownEffectV1,
} from "../../visual-effects-intelligence/src/index.js";

import type {
  EditTypeKnowledgeSnapshotV1,
  PracticeAttemptV1,
  PracticeAudioMatchV1,
  PracticeContentBaselineV1,
  PracticeDecisionTraceV1,
  PracticeObjectAwareProofV1,
  PracticeObjectMotionRelationV1,
  PracticeHomeworkAdaptersV1,
  PracticeReconstructionOutputV1,
  PracticeReferenceAnalysisV1,
  PracticeReferenceAnatomyV1,
  PracticeReferenceEffectWindowV1,
  PracticeSceneMatchV1,
  PracticeSemanticPatchV1,
  PracticeSimilarityReportV1,
} from "./contracts.js";
import { buildPracticeReferenceAnatomyV1 } from "./reference-anatomy.js";
import {
  practiceSubjectMaskTruthVerifiedV1,
  summarizePracticeSubjectIdentityV1,
} from "./subject-identity.js";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export const practiceProactiveSubjectRelativeIsolationRequiredV1 = (
  referenceWindow: PracticeReferenceEffectWindowV1 | undefined,
  track: PracticeReferenceAnatomyV1["subjectMotionTracks"][number] | undefined,
): boolean => {
  const cue = referenceWindow?.objectCue;
  if (cue === undefined || cue.objectAware !== true) return false;
  if (track === undefined || !track.usableForReconstruction) return false;
  if (cue.subjectIdentityContinuityVerified === false) return false;
  return cue.relation !== "CO_MOVING"
    || cue.subjectSeparationPeak >= 0.12
    || (cue.validatedMaskCoveragePeak ?? 0) >= 0.05
    || cue.occlusionPeak >= 0.18
    || cue.subjectBackgroundDivergencePeak >= 0.08;
};

export interface PracticeSubjectRelativeEffectAnchorV1 {
  readonly trackId: string;
  readonly semanticId: string;
  readonly timeMs: number;
  readonly phase: number;
  readonly magnitude: number;
  readonly direction: Readonly<{ x: number; y: number }>;
  readonly evidenceRefs: readonly string[];
}

export const practiceSubjectRelativeEffectAnchorV1 = (input: {
  readonly referenceWindow: PracticeReferenceEffectWindowV1 | undefined;
  readonly track: PracticeReferenceAnatomyV1["subjectMotionTracks"][number] | undefined;
  readonly startMs: number;
  readonly endMs: number;
}): PracticeSubjectRelativeEffectAnchorV1 | null => {
  if (!practiceProactiveSubjectRelativeIsolationRequiredV1(
    input.referenceWindow,
    input.track,
  )) return null;
  const track = input.track;
  if (track === undefined) return null;
  if (!Number.isFinite(input.startMs) || !Number.isFinite(input.endMs)
    || input.endMs <= input.startMs) return null;
  const targetAnchorMs = input.referenceWindow?.anchorMs
    ?? ((input.startMs + input.endMs) / 2);
  const candidates = track.samples
    .filter((sample) =>
      Number.isFinite(sample.timeMs)
      && sample.timeMs >= input.startMs - 0.5
      && sample.timeMs <= input.endMs + 0.5
      && Number.isFinite(sample.relativeMotion.x)
      && Number.isFinite(sample.relativeMotion.y)
      && sample.identityConfidence >= 0.5)
    .map((sample) => ({
      sample,
      magnitude: Math.hypot(sample.relativeMotion.x, sample.relativeMotion.y),
    }))
    .filter((candidate) => candidate.magnitude >= 0.02)
    .sort((left, right) =>
      right.magnitude - left.magnitude
      || Math.abs(left.sample.timeMs - targetAnchorMs)
        - Math.abs(right.sample.timeMs - targetAnchorMs)
      || right.sample.identityConfidence - left.sample.identityConfidence);
  const peak = candidates[0];
  if (peak === undefined) return null;
  const phase = clamp01(
    (peak.sample.timeMs - input.startMs) / (input.endMs - input.startMs),
  );
  return {
    trackId: track.trackId,
    semanticId: track.semanticId,
    timeMs: peak.sample.timeMs,
    phase,
    magnitude: peak.magnitude,
    direction: peak.sample.relativeMotion,
    evidenceRefs: [...new Set([
      ...track.evidenceRefs,
      ...peak.sample.evidenceRefs,
      "practice-subject-relative-effect-anchor:" + track.trackId,
      "practice-subject-relative-effect-anchor-ms:" + peak.sample.timeMs.toFixed(3),
    ])],
  };
};

export interface PracticeContentStructureEvaluationV1 {
  readonly sceneIdentity: number;
  readonly temporalAlignment: number;
  readonly cutTiming: number;
  readonly framing: number;
  readonly motion: number;
  readonly colorFinish: number;
  readonly pixelStructure: number;
  readonly wrongSceneCount: number;
  readonly unmatchedSceneCount: number;
  readonly temporalBehaviorProof?: Readonly<{
    sourceTemporalAlignment: number;
    requiredRewindShotIds: readonly string[];
    verifiedRewindShotIds: readonly string[];
    passed: boolean;
    reasons: readonly string[];
    evidenceRefs: readonly string[];
  }>;
  readonly evidenceRefs: readonly string[];
}

export interface PracticeM6RuntimeV1 {
  readonly availableCapabilities: readonly string[];
  analyzeReference(
    reference: PracticeReferenceAnalysisV1,
  ): Promise<DenseEffectEvidenceV1>;
  prepareAttempt(input: {
    readonly sessionId: string;
    readonly editTypeId: string;
    readonly editTypeKnowledge: EditTypeKnowledgeSnapshotV1;
    readonly attempt: number;
    readonly reference: PracticeReferenceAnalysisV1;
    readonly baseline: PracticeContentBaselineV1;
    readonly matches: readonly PracticeSceneMatchV1[];
    readonly subjectMotionTracks?: PracticeReferenceAnatomyV1["subjectMotionTracks"];
    readonly priorAttempts: readonly PracticeAttemptV1[];
  }): Promise<void>;
  applyWindowGraph(input: {
    readonly sessionId: string;
    readonly attempt: number;
    readonly reference: PracticeReferenceAnalysisV1;
    readonly baseline: PracticeContentBaselineV1;
    readonly window: DenseEffectWindowV1;
    readonly referenceWindow?: PracticeReferenceEffectWindowV1;
    readonly graph: ConstructionGraphV1;
  }): Promise<void>;
  renderWindowEvidence(input: {
    readonly sessionId: string;
    readonly attempt: number;
    readonly reference: PracticeReferenceAnalysisV1;
    readonly baseline: PracticeContentBaselineV1;
    readonly window: DenseEffectWindowV1;
    readonly graph: ConstructionGraphV1;
  }): Promise<DenseEffectEvidenceV1>;
  renderFullEdit(input: {
    readonly sessionId: string;
    readonly attempt: number;
    readonly reference: PracticeReferenceAnalysisV1;
    readonly baseline: PracticeContentBaselineV1;
  }): Promise<{
    readonly renderRef: string;
    readonly evidenceRefs: readonly string[];
  }>;
  analyzeRender(input: {
    readonly renderRef: string;
    readonly reference: PracticeReferenceAnalysisV1;
  }): Promise<DenseEffectEvidenceV1>;
  evaluateContentStructure(input: {
    readonly renderRef: string;
    readonly reference: PracticeReferenceAnalysisV1;
    readonly baseline: PracticeContentBaselineV1;
    readonly matches: readonly PracticeSceneMatchV1[];
  }): Promise<PracticeContentStructureEvaluationV1>;
}

export interface PracticeM6BrainV1 {
  run(request: M6ProductionRequestV1): Promise<M6ProductionResultV1>;
}

interface PracticeM6AttemptStateV1 {
  readonly sessionId: string;
  readonly attempt: number;
  readonly reference: PracticeReferenceAnalysisV1;
  readonly baseline: PracticeContentBaselineV1;
  readonly matches: readonly PracticeSceneMatchV1[];
  readonly referenceEvidence: DenseEffectEvidenceV1;
  readonly referenceSequence: DenseEffectSequenceV1;
  readonly referenceAnatomy: PracticeReferenceAnatomyV1;
  readonly windowResults: readonly M6ProductionResultV1[];
}

const dnaForEvidence = (
  evidence: DenseEffectEvidenceV1,
): TransitionDnaV1 => {
  const family = classifyEffectFamilyV1(evidence);
  return family === "UNKNOWN"
    ? decomposeUnknownEffectV1(evidence).dna
    : deriveEffectAnatomyV1(evidence, family).dna;
};

const shotForWindow = (
  reference: PracticeReferenceAnalysisV1,
  window: DenseEffectWindowV1,
): string | undefined => {
  const anchor = window.anchorMs;
  const containing = reference.shots.find((shot) =>
    anchor >= shot.referenceStartMs && anchor <= shot.referenceEndMs);
  if (containing !== undefined) return containing.shotId;
  let nearest: PracticeReferenceAnalysisV1["shots"][number] | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const shot of reference.shots) {
    const center = (shot.referenceStartMs + shot.referenceEndMs) / 2;
    const distance = Math.abs(anchor - center);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = shot;
    }
  }
  return nearest?.shotId;
};

const finalGraphId = (result: M6ProductionResultV1): string | null =>
  result.correction?.graph.graphId
  ?? result.synthesis?.selected?.graph.graphId
  ?? null;

const mean = (values: readonly number[], fallback = 0): number =>
  values.length === 0
    ? fallback
    : values.reduce((sum, value) => sum + value, 0) / values.length;

const harmonic = (a: number, b: number): number =>
  a <= 0 || b <= 0 ? 0 : (2 * a * b) / (a + b);

const unique = (values: readonly string[]): readonly string[] =>
  [...new Set(values.filter((value) => value.trim().length > 0))];

const clampRange = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const semanticPatchesForFamily = (
  knowledge: EditTypeKnowledgeSnapshotV1,
  family: ReturnType<typeof classifyEffectFamilyV1>,
): readonly PracticeSemanticPatchV1[] => {
  const marker = `M6_FAMILY_${family}`;
  const stats = new Map<string, {
    success: number;
    failure: number;
    latestSuccessful: PracticeSemanticPatchV1 | null;
  }>();
  for (const evidence of knowledge.behaviorEvidence) {
    if (!evidence.rationaleCodes.includes(marker)) continue;
    for (const patch of evidence.semanticPatches ?? []) {
      const key = `${patch.invariantId}|${patch.parameter}`;
      const current = stats.get(key) ?? {
        success: 0,
        failure: 0,
        latestSuccessful: null,
      };
      if (evidence.outcome === "MASTERED_SUPPORT") {
        current.success += 1;
        current.latestSuccessful = patch;
      } else {
        current.failure += 1;
      }
      stats.set(key, current);
    }
  }
  return [...stats.values()]
    .filter((item) => item.success > item.failure && item.latestSuccessful !== null)
    .map((item) => structuredClone(item.latestSuccessful as PracticeSemanticPatchV1));
};

const transferSemanticPatch = (
  graph: ConstructionGraphV1,
  patch: PracticeSemanticPatchV1,
): SemanticPatchV1 | null => {
  const nodeId = graph.invariantCoverage[patch.invariantId]?.[0];
  const node = graph.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (node === undefined) return null;
  const current = node.parameters[patch.parameter];
  if (typeof current !== "number" || !Number.isFinite(current)) return null;

  const delta = patch.nextValue - patch.previousValue;
  const nextValue = Math.abs(patch.previousValue) > 1e-6
    ? current * clampRange(patch.nextValue / patch.previousValue, 0.35, 2.25)
    : current + delta;
  if (!Number.isFinite(nextValue) || Math.abs(nextValue - current) < 1e-6) return null;
  return {
    patchId: `edit-type-transfer:${patch.patchId}`,
    invariantId: patch.invariantId,
    nodeId: node.nodeId,
    parameter: patch.parameter,
    previousValue: current,
    nextValue,
    rationale: `Edit Type transfer: ${patch.rationale}`,
  };
};

const learnedGraphForWindow = (input: {
  readonly evidence: DenseEffectEvidenceV1;
  readonly family: ReturnType<typeof classifyEffectFamilyV1>;
  readonly availableCapabilities: readonly string[];
  readonly knowledge: EditTypeKnowledgeSnapshotV1;
}): Readonly<{
  graph: ConstructionGraphV1;
  patches: readonly SemanticPatchV1[];
}> | null => {
  const stored = semanticPatchesForFamily(input.knowledge, input.family);
  if (stored.length === 0) return null;

  const base = input.family === "UNKNOWN"
    ? synthesizeUnknownEffectV1({
      evidence: input.evidence,
      availableCapabilities: input.availableCapabilities,
    }).selected?.graph ?? null
    : buildConstructionGraphV1(deriveEffectAnatomyV1(input.evidence, input.family));
  if (base === null) return null;

  const patches = stored
    .map((patch) => transferSemanticPatch(base, patch))
    .filter((patch): patch is SemanticPatchV1 => patch !== null);
  if (patches.length === 0) return null;
  return {
    graph: applySemanticPatchesV1(base, patches),
    patches,
  };
};

interface PracticeObjectWindowMetricsV1 {
  readonly frameCount: number;
  readonly evidencePersistence: number;
  readonly subjectSeparationPeak: number;
  readonly maskCoveragePeak: number;
  readonly validatedMaskCoveragePeak: number;
  readonly occlusionPeak: number;
  readonly subjectBackgroundDivergencePeak: number;
  readonly subjectMotionPeak: number;
  readonly backgroundMotionPeak: number;
  readonly subjectMotionDirection: Readonly<{ x: number; y: number }>;
  readonly backgroundMotionDirection: Readonly<{ x: number; y: number }>;
  readonly relation: PracticeObjectMotionRelationV1;
}

const objectWindowMetrics = (
  window: DenseEffectWindowV1,
): PracticeObjectWindowMetricsV1 => {
  const frames = window.evidence.frames;
  const maxScalar = (
    getter: (frame: DenseEffectEvidenceV1["frames"][number]) => number,
  ): number => Math.max(0, ...frames.map(getter));
  const peakFrame = [...frames].sort((a, b) =>
    b.subjectBackgroundDivergence - a.subjectBackgroundDivergence)[0];
  const subjectMotionPeak = maxScalar((frame) =>
    Math.hypot(frame.subjectMotion.x, frame.subjectMotion.y));
  const backgroundMotionPeak = maxScalar((frame) =>
    Math.hypot(frame.backgroundMotion.x, frame.backgroundMotion.y));
  const evidencePersistence = frames.length === 0 ? 0 : frames.filter((frame) =>
    frame.subjectSeparation >= 0.08
    || frame.maskCoverage >= 0.03
    || frame.occlusion >= 0.12
    || frame.subjectBackgroundDivergence >= 0.05).length / frames.length;
  const subjectBackgroundDivergencePeak = maxScalar(
    (frame) => frame.subjectBackgroundDivergence,
  );
  const maskCoveragePeak = maxScalar((frame) => frame.maskCoverage);
  const validatedMaskCoveragePeak = maxScalar((frame) =>
    frame.subjectMaskValidated === true ? frame.maskCoverage : 0);
  const occlusionPeak = Math.max(
    window.evidence.summary.occlusionPeak,
    maxScalar((frame) => frame.occlusion),
  );
  const relation: PracticeObjectMotionRelationV1 = occlusionPeak >= 0.65
    ? "OCCLUSION_DRIVEN"
    : validatedMaskCoveragePeak >= 0.12
      ? "MASK_DRIVEN"
      : subjectBackgroundDivergencePeak >= 0.08
        ? subjectMotionPeak >= Math.max(0.04, backgroundMotionPeak * 1.35)
          ? "SUBJECT_DOMINANT"
          : backgroundMotionPeak >= Math.max(0.04, subjectMotionPeak * 1.35)
            ? "BACKGROUND_DOMINANT"
            : "DIVERGENT"
        : "CO_MOVING";
  return {
    frameCount: frames.length,
    evidencePersistence,
    subjectSeparationPeak: window.evidence.summary.subjectSeparationPeak,
    maskCoveragePeak,
    validatedMaskCoveragePeak,
    occlusionPeak,
    subjectBackgroundDivergencePeak,
    subjectMotionPeak,
    backgroundMotionPeak,
    subjectMotionDirection: peakFrame?.subjectMotion ?? { x: 0, y: 0 },
    backgroundMotionDirection: peakFrame?.backgroundMotion ?? { x: 0, y: 0 },
    relation,
  };
};

const objectAwareRequired = (metrics: PracticeObjectWindowMetricsV1): boolean => {
  const persistenceFloor = metrics.frameCount <= 4 ? 0.25 : 0.2;
  return metrics.evidencePersistence >= persistenceFloor && (
    metrics.subjectSeparationPeak >= 0.12
    || metrics.validatedMaskCoveragePeak >= 0.05
    || metrics.occlusionPeak >= 0.18
    || metrics.subjectBackgroundDivergencePeak >= 0.08
  );
};

const relativeObjectScore = (
  referenceValue: number,
  renderValue: number,
  floor = 0.05,
): number => clamp01(
  Math.exp(-Math.abs(renderValue - referenceValue) / Math.max(referenceValue, floor)),
);

const directionObjectScore = (
  referenceValue: Readonly<{ x: number; y: number }>,
  renderValue: Readonly<{ x: number; y: number }>,
): number => {
  const referenceMagnitude = Math.hypot(referenceValue.x, referenceValue.y);
  const renderMagnitude = Math.hypot(renderValue.x, renderValue.y);
  if (referenceMagnitude < 0.02 && renderMagnitude < 0.02) return 1;
  if (referenceMagnitude < 0.02 || renderMagnitude < 0.02) return 0;
  const cosine = clampRange(
    (referenceValue.x * renderValue.x + referenceValue.y * renderValue.y)
      / (referenceMagnitude * renderMagnitude),
    -1,
    1,
  );
  return clamp01((cosine + 1) / 2);
};

export const comparePracticeObjectAwareWindowsV1 = (
  reference: DenseEffectSequenceV1,
  render: DenseEffectSequenceV1,
): PracticeObjectAwareProofV1 => {
  const alignment = alignDenseEffectSequencesV1(reference, render);
  const pairByReference = new Map(
    alignment.pairs.map((pair) => [pair.referenceIndex, pair] as const),
  );
  const windows: PracticeObjectAwareProofV1["windows"][number][] = [];
  const reasons: string[] = [];
  const evidenceRefs: string[] = [];
  let matchedWindowCount = 0;
  let passedWindowCount = 0;

  reference.windows.forEach((referenceWindow, referenceIndex) => {
    const referenceMetrics = objectWindowMetrics(referenceWindow);
    if (!objectAwareRequired(referenceMetrics)) return;
    const referenceSubjectIdentity = summarizePracticeSubjectIdentityV1(
      referenceWindow.evidence.frames,
    );
    const pair = pairByReference.get(referenceIndex);
    const effectFamilyId = classifyEffectFamilyV1(referenceWindow.evidence);
    const maskTruthRequired = referenceMetrics.relation === "MASK_DRIVEN"
      || effectFamilyId === "SUBJECT_ISOLATED_TRANSITION"
      || effectFamilyId === "MASK_REVEAL";
    if (pair === undefined) {
      const reason = "Object-aware reference window "
        + referenceWindow.windowId + " has no aligned rendered window.";
      reasons.push(reason);
      windows.push({
        referenceWindowId: referenceWindow.windowId,
        renderWindowId: null,
        effectFamilyId,
        relation: referenceMetrics.relation,
        relationMatched: false,
        subjectIdentityRequired: true,
        subjectIdentityVerified: false,
        maskTruthRequired,
        maskTruthVerified: false,
        referenceSubjectIdentity,
        renderSubjectIdentity: null,
        score: 0,
        passed: false,
        reasons: unique([reason, ...referenceSubjectIdentity.reasons]),
        evidenceRefs: unique([
          ...referenceWindow.evidence.evidenceRefs,
          ...referenceSubjectIdentity.evidenceRefs,
        ]),
      });
      evidenceRefs.push(...referenceWindow.evidence.evidenceRefs);
      return;
    }

    const renderWindow = render.windows[pair.renderIndex];
    if (renderWindow === undefined) return;
    matchedWindowCount += 1;
    const renderMetrics = objectWindowMetrics(renderWindow);
    const renderSubjectIdentity = summarizePracticeSubjectIdentityV1(
      renderWindow.evidence.frames,
    );
    const minimumRenderIdentityCoverage = Math.max(
      0.45,
      referenceSubjectIdentity.identityCoverage - 0.2,
    );
    const lowMotionIdentityMatched = referenceSubjectIdentity.lowMotionFrameCount === 0
      || (renderSubjectIdentity.continuityVerified
        && renderSubjectIdentity.identityCoverage >= minimumRenderIdentityCoverage);
    const occlusionIdentityMatched = referenceSubjectIdentity.occlusionFrameCount === 0
      || (renderSubjectIdentity.continuityVerified
        && renderSubjectIdentity.identityCoverage >= minimumRenderIdentityCoverage);
    const subjectIdentityVerified = referenceSubjectIdentity.continuityVerified
      && renderSubjectIdentity.continuityVerified
      && renderSubjectIdentity.identityCoverage >= minimumRenderIdentityCoverage
      && lowMotionIdentityMatched
      && occlusionIdentityMatched;
    const maskTruthVerified = !maskTruthRequired
      || (
        practiceSubjectMaskTruthVerifiedV1(referenceSubjectIdentity)
        && practiceSubjectMaskTruthVerifiedV1(renderSubjectIdentity)
      );
    const subjectIdentityScore = subjectIdentityVerified
      ? mean([
        relativeObjectScore(
          referenceSubjectIdentity.identityCoverage,
          renderSubjectIdentity.identityCoverage,
          0.45,
        ),
        relativeObjectScore(
          referenceSubjectIdentity.meanIdentityConfidence,
          renderSubjectIdentity.meanIdentityConfidence,
          0.35,
        ),
      ], 1)
      : 0;
    const metricScores: Array<Readonly<{ label: string; score: number }>> = [{
      label: "subject identity continuity",
      score: subjectIdentityScore,
    }, {
      label: "object evidence persistence",
      score: relativeObjectScore(
        referenceMetrics.evidencePersistence,
        renderMetrics.evidencePersistence,
        0.2,
      ),
    }];
    if (referenceMetrics.subjectSeparationPeak >= 0.12) {
      metricScores.push({
        label: "subject separation",
        score: relativeObjectScore(
          referenceMetrics.subjectSeparationPeak,
          renderMetrics.subjectSeparationPeak,
          0.12,
        ),
      });
    }
    if (referenceMetrics.validatedMaskCoveragePeak >= 0.05) {
      metricScores.push({
        label: "validated mask coverage",
        score: relativeObjectScore(
          referenceMetrics.validatedMaskCoveragePeak,
          renderMetrics.validatedMaskCoveragePeak,
          0.05,
        ),
      });
    }
    if (referenceMetrics.occlusionPeak >= 0.18) {
      metricScores.push({
        label: "occlusion",
        score: relativeObjectScore(
          referenceMetrics.occlusionPeak,
          renderMetrics.occlusionPeak,
          0.18,
        ),
      });
    }
    if (referenceMetrics.subjectBackgroundDivergencePeak >= 0.08) {
      metricScores.push({
        label: "subject/background divergence",
        score: relativeObjectScore(
          referenceMetrics.subjectBackgroundDivergencePeak,
          renderMetrics.subjectBackgroundDivergencePeak,
          0.08,
        ),
      });
      if (referenceMetrics.subjectMotionPeak >= 0.04) {
        metricScores.push({
          label: "subject motion",
          score: relativeObjectScore(
            referenceMetrics.subjectMotionPeak,
            renderMetrics.subjectMotionPeak,
            0.04,
          ),
        });
        metricScores.push({
          label: "subject motion direction",
          score: directionObjectScore(
            referenceMetrics.subjectMotionDirection,
            renderMetrics.subjectMotionDirection,
          ),
        });
      }
      if (referenceMetrics.backgroundMotionPeak >= 0.04) {
        metricScores.push({
          label: "background motion",
          score: relativeObjectScore(
            referenceMetrics.backgroundMotionPeak,
            renderMetrics.backgroundMotionPeak,
            0.04,
          ),
        });
        metricScores.push({
          label: "background motion direction",
          score: directionObjectScore(
            referenceMetrics.backgroundMotionDirection,
            renderMetrics.backgroundMotionDirection,
          ),
        });
      }
    }
    const relationMatched = referenceMetrics.relation === renderMetrics.relation;
    const score = clamp01(mean([
      ...metricScores.map((item) => item.score),
      relationMatched ? 1 : 0,
    ], relationMatched ? 1 : 0));
    const failedMetrics = metricScores.filter((item) => item.score < 0.72);
    const windowReasons = [
      ...(relationMatched
        ? []
        : ["Object relation changed from " + referenceMetrics.relation
          + " to " + renderMetrics.relation + "."]),
      ...(!referenceSubjectIdentity.continuityVerified
        ? referenceSubjectIdentity.reasons.map((reason) => "Reference: " + reason)
        : []),
      ...(!renderSubjectIdentity.continuityVerified
        ? renderSubjectIdentity.reasons.map((reason) => "Render: " + reason)
        : []),
      ...(referenceSubjectIdentity.lowMotionFrameCount > 0 && !lowMotionIdentityMatched
        ? ["The rendered subject identity did not survive the reference low-motion interval."]
        : []),
      ...(referenceSubjectIdentity.occlusionFrameCount > 0 && !occlusionIdentityMatched
        ? ["The rendered subject identity did not survive the reference occlusion interval."]
        : []),
      ...(maskTruthRequired && !maskTruthVerified
        ? ["Validated segmentation/tracked-mask/Roto Brush truth is required for this isolation window."]
        : []),
      ...failedMetrics.map((item) =>
        "Object-aware " + item.label + " fidelity is below the proof floor."),
    ];
    const passed = relationMatched
      && subjectIdentityVerified
      && maskTruthVerified
      && failedMetrics.length === 0
      && score >= 0.8;
    if (passed) passedWindowCount += 1;
    reasons.push(...windowReasons.map((reason) =>
      referenceWindow.windowId + ": " + reason));
    const windowEvidence = unique([
      ...referenceWindow.evidence.evidenceRefs,
      ...renderWindow.evidence.evidenceRefs,
      ...referenceSubjectIdentity.evidenceRefs,
      ...renderSubjectIdentity.evidenceRefs,
      "practice-subject-reference-continuity:"
        + String(referenceSubjectIdentity.continuityVerified),
      "practice-subject-render-continuity:"
        + String(renderSubjectIdentity.continuityVerified),
      "practice-subject-identity-score:" + subjectIdentityScore.toFixed(6),
      "practice-subject-mask-truth-required:" + String(maskTruthRequired),
      "practice-subject-mask-truth-verified:" + String(maskTruthVerified),
      "practice-object-reference-relation:" + referenceMetrics.relation,
      "practice-object-render-relation:" + renderMetrics.relation,
      "practice-object-window-score:" + score.toFixed(6),
      "practice-object-reference-persistence:"
        + referenceMetrics.evidencePersistence.toFixed(6),
      "practice-object-render-persistence:"
        + renderMetrics.evidencePersistence.toFixed(6),
    ]);
    evidenceRefs.push(...windowEvidence);
    windows.push({
      referenceWindowId: referenceWindow.windowId,
      renderWindowId: renderWindow.windowId,
      effectFamilyId,
      relation: referenceMetrics.relation,
      relationMatched,
      subjectIdentityRequired: true,
      subjectIdentityVerified,
      maskTruthRequired,
      maskTruthVerified,
      referenceSubjectIdentity,
      renderSubjectIdentity,
      score,
      passed,
      reasons: windowReasons,
      evidenceRefs: windowEvidence,
    });
  });

  const referenceWindowCount = windows.length;
  const required = referenceWindowCount > 0;
  const overallScore = required ? mean(windows.map((item) => item.score), 0) : 1;
  const verified = required
    && matchedWindowCount === referenceWindowCount
    && passedWindowCount === referenceWindowCount
    && overallScore >= 0.8;
  if (required && !verified && reasons.length === 0) {
    reasons.push("Object-aware reference behavior did not satisfy the retained proof gate.");
  }
  return {
    schema: "editflow.practice-object-aware-proof.v1",
    required,
    referenceWindowCount,
    matchedWindowCount,
    passedWindowCount,
    overallScore,
    verified,
    windows,
    reasons: unique(reasons),
    evidenceRefs: unique(evidenceRefs),
  };
};

export const comparePracticeM6AlignedWindowsV1 = (
  reference: DenseEffectSequenceV1,
  render: DenseEffectSequenceV1,
): Readonly<{
  comparisons: readonly FidelityComparisonV1[];
  definingCoverage: number;
  effectFidelity: number;
  transitionFidelity: number;
  objectAwareProof: PracticeObjectAwareProofV1;
  diagnoses: readonly string[];
  evidenceRefs: readonly string[];
}> => {
  const alignment = alignDenseEffectSequencesV1(reference, render);
  const objectAwareProof = comparePracticeObjectAwareWindowsV1(reference, render);
  const comparisons: FidelityComparisonV1[] = [];
  const diagnoses: string[] = [];
  let definingPassed = 0;
  let definingTotal = 0;

  for (const pair of alignment.pairs) {
    const referenceWindow = reference.windows[pair.referenceIndex];
    const renderWindow = render.windows[pair.renderIndex];
    if (referenceWindow === undefined || renderWindow === undefined) continue;
    const dna = dnaForEvidence(referenceWindow.evidence);
    const comparison = compareSemanticVisualFidelityV1({
      reference: referenceWindow.evidence,
      render: renderWindow.evidence,
      dna,
      alignment: "SEMANTIC",
    });
    comparisons.push(comparison);
    diagnoses.push(...comparison.diagnoses);
    for (const metric of comparison.metrics.filter((item) => item.defining)) {
      definingTotal += 1;
      if (metric.passed) definingPassed += 1;
    }
  }

  const referenceRecall = reference.windows.length === 0
    ? 0
    : alignment.pairs.length / reference.windows.length;
  const renderPrecision = render.windows.length === 0
    ? 0
    : alignment.pairs.length / render.windows.length;
  const sequenceCoverage = harmonic(referenceRecall, renderPrecision);
  const semanticSequenceScore = alignment.pairs.length === 0
    ? 0
    : clamp01(1 - mean(alignment.pairs.map((pair) => pair.semanticCost)));
  const rawDefiningCoverage = definingTotal === 0
    ? 0 : definingPassed / definingTotal;

  if (alignment.unmatchedReferenceWindowIds.length > 0) {
    diagnoses.push(
      `Unmatched reference effect windows: ${alignment.unmatchedReferenceWindowIds.join(", ")}.`,
    );
  }
  if (alignment.unmatchedRenderWindowIds.length > 0) {
    diagnoses.push(
      `Unexpected rendered effect windows: ${alignment.unmatchedRenderWindowIds.join(", ")}.`,
    );
  }

  return {
    comparisons,
    definingCoverage: clamp01(rawDefiningCoverage * referenceRecall),
    effectFidelity: clamp01(mean(
      comparisons.map((comparison) => comparison.weightedFidelity),
      0,
    ) * referenceRecall),
    transitionFidelity: clamp01(sequenceCoverage * semanticSequenceScore),
    objectAwareProof,
    diagnoses: unique([
      ...diagnoses,
      ...(objectAwareProof.required && !objectAwareProof.verified
        ? objectAwareProof.reasons
        : []),
    ]),
    evidenceRefs: unique([
      ...reference.evidenceRefs,
      ...render.evidenceRefs,
      ...objectAwareProof.evidenceRefs,
      ...comparisons.flatMap((comparison) => [
        `m6-reference-evidence:${comparison.referenceEvidenceKey}`,
        `m6-render-evidence:${comparison.renderEvidenceKey}`,
      ]),
    ]),
  };
};

export class PracticeM6ExecutionBridgeV1
implements Pick<PracticeHomeworkAdaptersV1, "reconstruct" | "evaluate"> {
  readonly runtime: PracticeM6RuntimeV1;
  readonly brain: PracticeM6BrainV1;
  readonly #referenceCache = new Map<string, {
    readonly evidence: DenseEffectEvidenceV1;
    readonly sequence: DenseEffectSequenceV1;
  }>();
  readonly #attemptByRenderRef = new Map<string, PracticeM6AttemptStateV1>();

  constructor(
    runtime: PracticeM6RuntimeV1,
    brain: PracticeM6BrainV1 = new VisualEffectsBrainV1(),
  ) {
    this.runtime = runtime;
    this.brain = brain;
  }

  async #referenceAnalysis(
    reference: PracticeReferenceAnalysisV1,
  ): Promise<{
    readonly evidence: DenseEffectEvidenceV1;
    readonly sequence: DenseEffectSequenceV1;
  }> {
    const cached = this.#referenceCache.get(reference.referenceId);
    if (cached !== undefined) return cached;
    const evidence = await this.runtime.analyzeReference(reference);
    if (evidence.sourceKind !== "REFERENCE") {
      throw new TypeError("Practice M6 reference analysis must return REFERENCE dense evidence.");
    }
    const sequence = detectDenseEffectWindowsV1(evidence);
    const value = { evidence, sequence };
    this.#referenceCache.set(reference.referenceId, value);
    return value;
  }

  reconstruct = async (input: {
    readonly sessionId: string;
    readonly editTypeId: string;
    readonly editTypeKnowledge: EditTypeKnowledgeSnapshotV1;
    readonly attempt: number;
    readonly reference: PracticeReferenceAnalysisV1;
    readonly baseline: PracticeContentBaselineV1;
    readonly matches: readonly PracticeSceneMatchV1[];
    readonly audioMatch?: PracticeAudioMatchV1 | null;
    readonly priorAttempts: readonly PracticeAttemptV1[];
  }): Promise<PracticeReconstructionOutputV1> => {
    const analysis = await this.#referenceAnalysis(input.reference);
    const referenceAnatomy = buildPracticeReferenceAnatomyV1({
      reference: input.reference,
      referenceEvidence: analysis.evidence,
      sequence: analysis.sequence,
      matches: input.matches,
      ...(input.audioMatch?.beatGrid === undefined
        ? {}
        : { beatGrid: input.audioMatch.beatGrid }),
    });
    await this.runtime.prepareAttempt({
      ...input,
      subjectMotionTracks: referenceAnatomy.subjectMotionTracks,
    });

    const decisionTraces: PracticeDecisionTraceV1[] = [];
    const evidenceRefs: string[] = [
      ...analysis.evidence.evidenceRefs,
      ...analysis.sequence.evidenceRefs,
      ...referenceAnatomy.evidenceRefs,
    ];
    const windowResults: M6ProductionResultV1[] = [];

    for (const window of analysis.sequence.windows) {
      const family = classifyEffectFamilyV1(window.evidence);
      const windowAnatomy = referenceAnatomy.effectWindows.find((item) =>
        item.windowId === window.windowId);
      const windowSubjectMotionTracks = referenceAnatomy.subjectMotionTracks.filter((track) =>
        track.usableForReconstruction
        && (windowAnatomy?.shotIds.includes(track.shotId) ?? false));
      const proactiveSubjectRelativeTracks = windowSubjectMotionTracks.filter((track) =>
        practiceProactiveSubjectRelativeIsolationRequiredV1(windowAnatomy, track));
      const subjectRelativeEffectAnchors = proactiveSubjectRelativeTracks.flatMap((track) => {
        const startMs = Math.max(window.startMs, track.referenceStartMs);
        const endMs = Math.min(window.endMs, track.referenceEndMs);
        if (endMs <= startMs) return [];
        const anchor = practiceSubjectRelativeEffectAnchorV1({
          referenceWindow: windowAnatomy,
          track,
          startMs,
          endMs,
        });
        return anchor === null ? [] : [anchor];
      });
      const learned = learnedGraphForWindow({
        evidence: window.evidence,
        family,
        availableCapabilities: this.runtime.availableCapabilities,
        knowledge: input.editTypeKnowledge,
      });
      const result = await this.brain.run({
        requestId: `${input.sessionId}:attempt:${input.attempt}:${window.windowId}`,
        risk: "HIGH",
        ...(learned === null
          ? {}
          : {
            learnedTechniqueId: `edit-type:${input.editTypeId}:${family}`,
            learnedGraph: learned.graph,
          }),
        referenceEvidence: window.evidence,
        availableCapabilities: this.runtime.availableCapabilities,
        evidenceRefs: [
          ...window.evidence.evidenceRefs,
          `practice-session:${input.sessionId}`,
          `practice-attempt:${input.attempt}`,
          `practice-window:${window.windowId}`,
          `practice-edit-type:${input.editTypeId}`,
          `practice-edit-type-revision:${input.editTypeKnowledge.revision}`,
          ...(windowAnatomy?.anchorBeatCue?.evidenceRefs ?? []),
          ...(windowAnatomy?.transitionBeatCue?.evidenceRefs ?? []),
          ...windowSubjectMotionTracks.flatMap((track) => track.evidenceRefs),
          "practice-subject-motion-tracks-before-effect:"
            + String(windowSubjectMotionTracks.length),
          "practice-proactive-subject-relative-tracks-before-effect:"
            + String(proactiveSubjectRelativeTracks.length),
          ...proactiveSubjectRelativeTracks.flatMap((track) => [
            "practice-proactive-subject-relative-track:" + track.trackId,
            "practice-proactive-subject-relative-semantic:" + track.semanticId,
          ]),
          "practice-subject-relative-effect-anchors-before-effect:"
            + String(subjectRelativeEffectAnchors.length),
          ...subjectRelativeEffectAnchors.flatMap((anchor) => [
            ...anchor.evidenceRefs,
            "practice-subject-relative-effect-anchor-time-ms:"
              + anchor.timeMs.toFixed(3),
            "practice-subject-relative-effect-anchor-phase:"
              + anchor.phase.toFixed(6),
            "practice-subject-relative-effect-anchor-magnitude:"
              + anchor.magnitude.toFixed(6),
          ]),
          ...(learned === null
            ? []
            : [`practice-edit-type-transferred-patches:${learned.patches.length}`]),
        ],
        applyGraph: async (graph) => this.runtime.applyWindowGraph({
          sessionId: input.sessionId,
          attempt: input.attempt,
          reference: input.reference,
          baseline: input.baseline,
          window,
          ...(windowAnatomy === undefined ? {} : { referenceWindow: windowAnatomy }),
          graph,
        }),
        renderWindow: async (graph) => this.runtime.renderWindowEvidence({
          sessionId: input.sessionId,
          attempt: input.attempt,
          reference: input.reference,
          baseline: input.baseline,
          window,
          graph,
        }),
      });
      windowResults.push(result);
      evidenceRefs.push(...result.evidenceRefs);
      const graphId = finalGraphId(result);
      const shotId = shotForWindow(input.reference, window);
      decisionTraces.push({
        decisionId: `${input.sessionId}:attempt:${input.attempt}:${window.windowId}`,
        ...(shotId === undefined ? {} : { shotId }),
        cueIds: [
          `effect-window:${window.windowId}`,
          `effect-family:${family}`,
          ...(windowAnatomy === undefined ? [] : [
            `window-relation:${windowAnatomy.relation}`,
            `window-shots:${windowAnatomy.shotIds.join(",")}`,
            `temporal-behavior:${windowAnatomy.temporalCue.behavior}`,
            ...(windowAnatomy.transitionBoundaryMs === null
              ? []
              : [`transition-boundary-ms:${windowAnatomy.transitionBoundaryMs.toFixed(3)}`]),
            ...(windowAnatomy.anchorBeatCue === undefined ? [] : [
              `effect-anchor-beat:${windowAnatomy.anchorBeatCue.alignment}`,
              `effect-anchor-beat-offset-ms:${windowAnatomy.anchorBeatCue.offsetMs.toFixed(3)}`,
              `effect-anchor-beat-offset-beats:${windowAnatomy.anchorBeatCue.offsetBeats.toFixed(6)}`,
            ]),
            ...(windowAnatomy.transitionBeatCue === undefined ? [] : [
              `transition-beat:${windowAnatomy.transitionBeatCue.alignment}`,
              `transition-beat-offset-ms:${windowAnatomy.transitionBeatCue.offsetMs.toFixed(3)}`,
              `transition-beat-offset-beats:${windowAnatomy.transitionBeatCue.offsetBeats.toFixed(6)}`,
            ]),
            ...windowSubjectMotionTracks.flatMap((track) => [
              "subject-motion-track:" + track.trackId,
              "subject-motion-semantic:" + track.semanticId,
              "subject-motion-identity-coverage:" + track.identityCoverage.toFixed(6),
              "subject-relative-motion-peak:" + track.relativeMotionPeak.toFixed(6),
              "subject-relative-motion-direction:"
                + track.relativeMotionDirection.x.toFixed(6) + ","
                + track.relativeMotionDirection.y.toFixed(6),
            ]),
            ...proactiveSubjectRelativeTracks.map((track) =>
              "subject-relative-proactive-isolation:" + track.trackId),
            ...subjectRelativeEffectAnchors.flatMap((anchor) => [
              "subject-relative-effect-anchor:" + anchor.trackId,
              "subject-relative-effect-anchor-ms:" + anchor.timeMs.toFixed(3),
              "subject-relative-effect-anchor-phase:" + anchor.phase.toFixed(6),
              "subject-relative-effect-anchor-magnitude:" + anchor.magnitude.toFixed(6),
            ]),
            ...(windowAnatomy.objectCue.objectAware ? [
              "object-aware:true",
              `object-relation:${windowAnatomy.objectCue.relation}`,
              `object-divergence:${windowAnatomy.objectCue.subjectBackgroundDivergencePeak.toFixed(6)}`,
              `object-persistence:${windowAnatomy.objectCue.evidencePersistence.toFixed(6)}`,
              `subject-motion-peak:${windowAnatomy.objectCue.subjectMotionPeak.toFixed(6)}`,
              `background-motion-peak:${windowAnatomy.objectCue.backgroundMotionPeak.toFixed(6)}`,
            ] : []),
            ...(windowAnatomy.temporalCue.rewind === null
              ? []
              : [`rewind-span-ms:${windowAnatomy.temporalCue.rewind.rewindSpanMs.toFixed(3)}`]),
          ]),
        ],
        constructionIds: graphId === null ? [] : [graphId],
        rationaleCodes: [
          `M6_ROUTE_${result.route}`,
          `M6_STATUS_${result.status}`,
          `M6_FAMILY_${family}`,
          ...(windowAnatomy === undefined ? [] : [
            `REFERENCE_${windowAnatomy.relation}`,
            ...(windowAnatomy.anchorBeatCue === undefined ? [] : [
              `REFERENCE_EFFECT_ANCHOR_${windowAnatomy.anchorBeatCue.alignment}`,
            ]),
            ...(windowAnatomy.transitionBeatCue === undefined ? [] : [
              `REFERENCE_TRANSITION_${windowAnatomy.transitionBeatCue.alignment}`,
            ]),
            ...(windowSubjectMotionTracks.length === 0
              ? []
              : ["REFERENCE_SUBJECT_MOTION_TRACK_RETAINED"]),
            ...(proactiveSubjectRelativeTracks.length === 0
              ? []
              : ["REFERENCE_PROACTIVE_SUBJECT_RELATIVE_ISOLATION"]),
            ...(subjectRelativeEffectAnchors.length === 0
              ? []
              : ["REFERENCE_SUBJECT_RELATIVE_EFFECT_ANCHOR"]),
            ...(windowAnatomy.objectCue.objectAware ? [
              "REFERENCE_OBJECT_AWARE",
              `REFERENCE_OBJECT_RELATION_${windowAnatomy.objectCue.relation}`,
            ] : []),
            ...(windowAnatomy.temporalCue.rewind === null ? [] : ["REFERENCE_REWIND_MEASURED"]),
          ]),
          ...(learned === null ? [] : ["EDIT_TYPE_TRANSFER_APPLIED"]),
        ],
        semanticPatches: result.correction?.learnedPatches ?? [],
      });
    }

    const rendered = await this.runtime.renderFullEdit({
      sessionId: input.sessionId,
      attempt: input.attempt,
      reference: input.reference,
      baseline: input.baseline,
    });
    evidenceRefs.push(...rendered.evidenceRefs);
    this.#attemptByRenderRef.set(rendered.renderRef, {
      sessionId: input.sessionId,
      attempt: input.attempt,
      reference: input.reference,
      baseline: input.baseline,
      matches: input.matches,
      referenceEvidence: analysis.evidence,
      referenceSequence: analysis.sequence,
      referenceAnatomy,
      windowResults,
    });

    return {
      renderRef: rendered.renderRef,
      decisionTraces,
      evidenceRefs: unique(evidenceRefs),
    };
  };

  evaluate = async (input: {
    readonly reference: PracticeReferenceAnalysisV1;
    readonly renderRef: string;
    readonly minimumSimilarity: number;
  }): Promise<PracticeSimilarityReportV1> => {
    const attempt = this.#attemptByRenderRef.get(input.renderRef);
    if (attempt === undefined || attempt.reference.referenceId !== input.reference.referenceId) {
      throw new TypeError(
        "Practice M6 evaluation requires the reconstruction state that produced the render.",
      );
    }

    const content = await this.runtime.evaluateContentStructure({
      renderRef: input.renderRef,
      reference: input.reference,
      baseline: attempt.baseline,
      matches: attempt.matches,
    });

    let effectFidelity = 0;
    let transitionFidelity = 0;
    let definingEffectCoverage = 0;
    const reasons: string[] = [];
    const evidenceRefs: string[] = [...content.evidenceRefs];
    if (content.temporalBehaviorProof !== undefined) {
      evidenceRefs.push(...content.temporalBehaviorProof.evidenceRefs);
      if (!content.temporalBehaviorProof.passed) {
        reasons.push(...content.temporalBehaviorProof.reasons);
      }
    }

    try {
      const renderEvidence = await this.runtime.analyzeRender({
        renderRef: input.renderRef,
        reference: input.reference,
      });
      if (renderEvidence.sourceKind !== "RENDER") {
        throw new TypeError("Practice M6 render analysis must return RENDER dense evidence.");
      }
      const renderSequence = detectDenseEffectWindowsV1(renderEvidence);
      const compared = comparePracticeM6AlignedWindowsV1(
        attempt.referenceSequence,
        renderSequence,
      );
      effectFidelity = compared.effectFidelity;
      transitionFidelity = compared.transitionFidelity;
      definingEffectCoverage = compared.definingCoverage;
      reasons.push(...compared.diagnoses);
      evidenceRefs.push(...compared.evidenceRefs);
    } catch (error) {
      reasons.push(
        `M6 semantic render comparison failed closed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    for (const [index, result] of attempt.windowResults.entries()) {
      if (result.status !== "COMPLETED") {
        reasons.push(
          `Reference effect window ${index + 1} did not complete through M6: ${result.status}.`,
        );
      }
    }

    return {
      schema: "editflow.practice-similarity.v1",
      breakdown: {
        sceneIdentity: clamp01(content.sceneIdentity),
        temporalAlignment: clamp01(content.temporalAlignment),
        cutTiming: clamp01(content.cutTiming),
        framing: clamp01(content.framing),
        motion: clamp01(content.motion),
        effectFidelity,
        transitionFidelity,
        colorFinish: clamp01(content.colorFinish),
        pixelStructure: clamp01(content.pixelStructure),
      },
      definingEffectCoverage,
      wrongSceneCount: Math.max(0, Math.floor(content.wrongSceneCount)),
      unmatchedSceneCount: Math.max(0, Math.floor(content.unmatchedSceneCount)),
      overallSimilarity: 0,
      passed: false,
      reasons: unique(reasons),
      evidenceRefs: unique([
        ...attempt.referenceEvidence.evidenceRefs,
        ...attempt.referenceSequence.evidenceRefs,
        ...attempt.windowResults.flatMap((result) => result.evidenceRefs),
        ...evidenceRefs,
        `practice-target:${clamp01(input.minimumSimilarity).toFixed(6)}`,
      ]),
    };
  };
}

export const composePracticeM6ExecutionAdaptersV1 = (
  bridge: PracticeM6ExecutionBridgeV1,
  other: Pick<
    PracticeHomeworkAdaptersV1,
    "analyzeFinish" | "indexStart" | "matchScenes" | "buildContentBaseline"
  > & Partial<Pick<PracticeHomeworkAdaptersV1, "matchAudio" | "recordEpisode">>,
): PracticeHomeworkAdaptersV1 => ({
  analyzeFinish: (finish) => other.analyzeFinish(finish),
  indexStart: (start) => other.indexStart(start),
  matchScenes: (input) => other.matchScenes(input),
  ...(other.matchAudio === undefined
    ? {}
    : { matchAudio: (input) => other.matchAudio?.(input) ?? Promise.resolve(null) }),
  buildContentBaseline: (input) => other.buildContentBaseline(input),
  reconstruct: (input) => bridge.reconstruct(input),
  evaluate: (input) => bridge.evaluate(input),
  ...(other.recordEpisode === undefined
    ? {}
    : { recordEpisode: (episode) => other.recordEpisode?.(episode) ?? Promise.resolve() }),
});
