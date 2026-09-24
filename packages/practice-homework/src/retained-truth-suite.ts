import type {
  PracticeRetainedShotTruthV1,
  PracticeRetainedTruthCaseReportV1,
  PracticeRetainedTruthDifficultyV1,
  PracticeRetainedTruthSuiteCaseInputV1,
  PracticeRetainedTruthSuiteModeV1,
  PracticeRetainedTruthSuitePolicyV1,
  PracticeRetainedTruthSuiteReportV1,
  PracticeRetainedTruthTuningFocusV1,
  PracticeRetainedTruthTuningPlanItemV1,
  PracticeRetainedTruthTuningSubsystemV1,
  PracticeSceneMatchV1,
  PracticeSceneTruthDiagnosticKindV1,
  PracticeSceneTruthDiagnosticV1,
} from "./contracts.js";

const SHA256 = /^[a-f0-9]{64}$/i;

const DIFFICULTY_KINDS = [
  "FAST_CUTS",
  "NEAR_DUPLICATE_SOURCES",
  "REVERSE_OR_REWIND",
  "LOW_INFORMATION",
  "STRONG_CAMERA_MOTION",
  "OCCLUSION",
  "IDENTITY_AMBIGUITY",
  "HEAVY_EFFECT_OBSCURATION",
  "REPEATED_SCENERY",
] as const satisfies readonly PracticeRetainedTruthDifficultyV1[];
const DIAGNOSTIC_KINDS = [
  "MISSING_MATCH",
  "UNEXPECTED_MATCH",
  "DUPLICATE_MATCH",
  "WRONG_SOURCE",
  "SOURCE_RANGE_MISMATCH",
  "DIRECTION_MISMATCH",
  "HIGH_CONFIDENCE_FALSE_MATCH",
  "AMBIGUOUS_FALSE_MATCH",
] as const satisfies readonly PracticeSceneTruthDiagnosticKindV1[];

const PRIMARY_DIAGNOSTICS = new Set<PracticeSceneTruthDiagnosticKindV1>([
  "MISSING_MATCH",
  "UNEXPECTED_MATCH",
  "DUPLICATE_MATCH",
  "WRONG_SOURCE",
  "SOURCE_RANGE_MISMATCH",
  "DIRECTION_MISMATCH",
]);

const TUNING_SUBSYSTEM_BY_DIAGNOSTIC = new Map<
PracticeSceneTruthDiagnosticKindV1,
PracticeRetainedTruthTuningSubsystemV1
>([
  ["MISSING_MATCH", "MATCH_COVERAGE"],
  ["UNEXPECTED_MATCH", "OUTPUT_DEDUPLICATION"],
  ["DUPLICATE_MATCH", "OUTPUT_DEDUPLICATION"],
  ["WRONG_SOURCE", "SOURCE_IDENTITY_RETRIEVAL"],
  ["SOURCE_RANGE_MISMATCH", "SOURCE_TIMING_RETRIEVAL"],
  ["DIRECTION_MISMATCH", "TEMPORAL_DIRECTION"],
  ["HIGH_CONFIDENCE_FALSE_MATCH", "CONFIDENCE_CALIBRATION"],
  ["AMBIGUOUS_FALSE_MATCH", "CONFIDENCE_CALIBRATION"],
]);

const TUNING_ACTION_BY_SUBSYSTEM = new Map<
PracticeRetainedTruthTuningSubsystemV1,
string
>([
  ["MATCH_COVERAGE",
    "Expand rescue retrieval only for truth shots with no retained match while preserving the exact-scene geometry gate."],
  ["OUTPUT_DEDUPLICATION",
    "Enforce one retained output per Finish shot and suppress colliding hypotheses before certification."],
  ["SOURCE_IDENTITY_RETRIEVAL",
    "Re-rank source candidates against retained identity collisions before relaxing any similarity threshold."],
  ["SOURCE_TIMING_RETRIEVAL",
    "Retune source-time trajectory and boundary alignment using the retained truth ranges that missed tolerance."],
  ["TEMPORAL_DIRECTION",
    "Require retained trajectory evidence to distinguish forward, reverse, and forward-then-rewind before selection."],
  ["CONFIDENCE_CALIBRATION",
    "Down-calibrate scene confidence for retained false matches, especially high-confidence errors and small runner-up margins."],
]);

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const uniqueNonEmpty = (values: readonly string[]): readonly string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const validSha256 = (value: string): boolean => SHA256.test(value.trim());
const normalizedSha256 = (value: string): string => value.trim().toLowerCase();

const evidenceFor = (
  truth: PracticeRetainedShotTruthV1,
  match: PracticeSceneMatchV1 | null,
  observationEvidence: readonly string[],
): readonly string[] => uniqueNonEmpty([
  ...truth.truthEvidenceRefs,
  ...(match?.evidenceRefs ?? []),
  ...observationEvidence,
]);

const coverageFraction = (
  durationMs: number,
  shots: readonly PracticeRetainedShotTruthV1[],
): number => {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || shots.length === 0) return 0;
  const ranges = shots
    .map((shot) => [
      Math.max(0, Math.min(durationMs, shot.referenceStartMs)),
      Math.max(0, Math.min(durationMs, shot.referenceEndMs)),
    ] as const)
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let covered = 0;
  let currentStart = -1;
  let currentEnd = -1;
  for (const [start, end] of ranges) {
    if (currentStart < 0) {
      currentStart = start;
      currentEnd = end;
      continue;
    }
    if (start <= currentEnd) {
      currentEnd = Math.max(currentEnd, end);
      continue;
    }
    covered += currentEnd - currentStart;
    currentStart = start;
    currentEnd = end;
  }
  if (currentStart >= 0) covered += currentEnd - currentStart;
  return clamp01(covered / durationMs);
};

export const DEFAULT_PRACTICE_RETAINED_TRUTH_SUITE_POLICY_V1:
PracticeRetainedTruthSuitePolicyV1 = {
  minimumCases: 20,
  maximumCases: 30,
  minimumTruthCoverage: 0.98,
  minimumDifficultyKinds: 4,
  sourceRangeToleranceMs: 250,
  highConfidenceFalseMatchThreshold: 0.85,
  ambiguousFalseMatchMarginThreshold: 0.08,
};

const resolvedPolicy = (
  value: Partial<PracticeRetainedTruthSuitePolicyV1> | undefined,
): PracticeRetainedTruthSuitePolicyV1 => {
  const minimumCases = Math.max(
    DEFAULT_PRACTICE_RETAINED_TRUTH_SUITE_POLICY_V1.minimumCases,
    Math.floor(value?.minimumCases
      ?? DEFAULT_PRACTICE_RETAINED_TRUTH_SUITE_POLICY_V1.minimumCases),
  );
  return {
    minimumCases,
    maximumCases: Math.max(
      minimumCases,
      DEFAULT_PRACTICE_RETAINED_TRUTH_SUITE_POLICY_V1.maximumCases,
      Math.floor(value?.maximumCases
        ?? DEFAULT_PRACTICE_RETAINED_TRUTH_SUITE_POLICY_V1.maximumCases),
    ),
    minimumTruthCoverage: Math.max(
      DEFAULT_PRACTICE_RETAINED_TRUTH_SUITE_POLICY_V1.minimumTruthCoverage,
      Math.min(1, value?.minimumTruthCoverage
        ?? DEFAULT_PRACTICE_RETAINED_TRUTH_SUITE_POLICY_V1.minimumTruthCoverage),
    ),
    minimumDifficultyKinds: Math.max(
      DEFAULT_PRACTICE_RETAINED_TRUTH_SUITE_POLICY_V1.minimumDifficultyKinds,
      Math.min(
        DIFFICULTY_KINDS.length,
        Math.floor(value?.minimumDifficultyKinds
          ?? DEFAULT_PRACTICE_RETAINED_TRUTH_SUITE_POLICY_V1.minimumDifficultyKinds),
      ),
    ),
    sourceRangeToleranceMs: Math.max(
      0,
      value?.sourceRangeToleranceMs
        ?? DEFAULT_PRACTICE_RETAINED_TRUTH_SUITE_POLICY_V1.sourceRangeToleranceMs,
    ),
    highConfidenceFalseMatchThreshold: Math.max(
      0,
      Math.min(
        1,
        value?.highConfidenceFalseMatchThreshold
          ?? DEFAULT_PRACTICE_RETAINED_TRUTH_SUITE_POLICY_V1.highConfidenceFalseMatchThreshold,
      ),
    ),
    ambiguousFalseMatchMarginThreshold: Math.max(
      0,
      value?.ambiguousFalseMatchMarginThreshold
        ?? DEFAULT_PRACTICE_RETAINED_TRUTH_SUITE_POLICY_V1.ambiguousFalseMatchMarginThreshold,
    ),
  };
};

const diagnostic = (
  kind: PracticeSceneTruthDiagnosticKindV1,
  input: {
    readonly caseId: string;
    readonly shotId?: string;
    readonly expectedSourceId?: string;
    readonly match?: PracticeSceneMatchV1 | null;
    readonly message: string;
    readonly evidenceRefs: readonly string[];
  },
): PracticeSceneTruthDiagnosticV1 => ({
  kind,
  caseId: input.caseId,
  ...(input.shotId === undefined ? {} : { shotId: input.shotId }),
  ...(input.expectedSourceId === undefined
    ? {}
    : { expectedSourceId: input.expectedSourceId }),
  ...(input.match === undefined || input.match === null
    ? {}
    : {
      observedSourceId: input.match.sourceId,
      observedConfidence: input.match.confidence,
    }),
  message: input.message,
  evidenceRefs: uniqueNonEmpty(input.evidenceRefs),
});

const validateTruthStructure = (
  item: PracticeRetainedTruthSuiteCaseInputV1,
): readonly string[] => {
  const truth = item.truth;
  const reasons: string[] = [];
  if (truth.caseId.trim().length === 0) reasons.push("Truth case id is empty.");
  if (truth.referenceId.trim().length === 0) reasons.push("Finish reference id is empty.");
  if (!validSha256(truth.finishSha256)) reasons.push("Finish SHA-256 is missing or invalid.");
  if (!Number.isFinite(truth.referenceDurationMs) || truth.referenceDurationMs <= 0) {
    reasons.push("Finish reference duration must be positive and finite.");
  }
  const sourceHashes = uniqueNonEmpty(truth.sourceMediaSha256);
  if (sourceHashes.length === 0 || sourceHashes.some((value) => !validSha256(value))) {
    reasons.push("Source-media SHA-256 truth is missing or invalid.");
  }
  if (truth.evidenceRefs.length === 0) reasons.push("Truth case has no retained evidence refs.");
  if (truth.shots.length === 0) reasons.push("Truth case has no shot-level labels.");
  if (item.observation.caseId !== truth.caseId) {
    reasons.push("Observed case id does not match the truth case id.");
  }
  if (item.observation.evidenceRefs.length === 0) {
    reasons.push("Observed case has no retained machine evidence refs.");
  }
  const shotIds = new Set<string>();
  const orders = new Set<number>();
  const ordered = [...truth.shots].sort((left, right) =>
    left.referenceStartMs - right.referenceStartMs || left.order - right.order);
  for (let index = 0; index < ordered.length; index += 1) {
    const shot = ordered[index]!;
    if (shot.shotId.trim().length === 0 || shotIds.has(shot.shotId)) {
      reasons.push("Shot truth contains an empty or duplicate shot id.");
    }
    shotIds.add(shot.shotId);
    if (!Number.isInteger(shot.order) || shot.order < 0 || orders.has(shot.order)) {
      reasons.push("Shot truth contains an invalid or duplicate order.");
    }
    orders.add(shot.order);
    if (!Number.isFinite(shot.referenceStartMs)
      || !Number.isFinite(shot.referenceEndMs)
      || shot.referenceStartMs < 0
      || shot.referenceEndMs <= shot.referenceStartMs
      || shot.referenceEndMs > truth.referenceDurationMs) {
      reasons.push("Shot truth has invalid Finish timing: " + shot.shotId + ".");
    }
    if (!Number.isFinite(shot.expectedSourceStartMs)
      || !Number.isFinite(shot.expectedSourceEndMs)
      || shot.expectedSourceStartMs < 0
      || shot.expectedSourceEndMs <= shot.expectedSourceStartMs) {
      reasons.push("Shot truth has invalid source timing: " + shot.shotId + ".");
    }
    if (shot.expectedSourceId.trim().length === 0) {
      reasons.push("Shot truth has an empty expected source id: " + shot.shotId + ".");
    }
    if (shot.truthEvidenceRefs.length === 0) {
      reasons.push("Shot truth lacks independent evidence: " + shot.shotId + ".");
    }
    if (shot.sourceToleranceMs !== undefined
      && (!Number.isFinite(shot.sourceToleranceMs) || shot.sourceToleranceMs < 0)) {
      reasons.push("Shot truth has an invalid source tolerance: " + shot.shotId + ".");
    }
    const prior = ordered[index - 1];
    if (prior !== undefined && shot.referenceStartMs < prior.referenceEndMs) {
      reasons.push("Shot truth overlaps in Finish time: " + shot.shotId + ".");
    }
  }
  const byOrder = [...truth.shots].sort((left, right) => left.order - right.order);
  for (let index = 1; index < byOrder.length; index += 1) {
    if (byOrder[index]!.referenceStartMs < byOrder[index - 1]!.referenceStartMs) {
      reasons.push("Shot truth order disagrees with Finish timeline order.");
      break;
    }
  }
  return uniqueNonEmpty(reasons);
};

const evaluateCase = (
  item: PracticeRetainedTruthSuiteCaseInputV1,
  policy: PracticeRetainedTruthSuitePolicyV1,
): PracticeRetainedTruthCaseReportV1 => {
  const truth = item.truth;
  const observation = item.observation;
  const reasons = [...validateTruthStructure(item)];
  const truthCoverage = coverageFraction(truth.referenceDurationMs, truth.shots);
  const fullLengthTruthVerified = truthCoverage >= policy.minimumTruthCoverage;
  if (!fullLengthTruthVerified) {
    reasons.push(
      "Shot truth covers less than "
        + String(Math.round(policy.minimumTruthCoverage * 100))
        + "% of the full Finish reference.",
    );
  }
  const independentTruthVerified =
    truth.truthAuthority === "INDEPENDENT_HUMAN"
    || truth.truthAuthority === "INDEPENDENT_VERIFIER";
  if (!independentTruthVerified) {
    reasons.push("Shot truth is not independently authored or verified.");
  }
  const difficultyVerified = truth.difficultyTags.length > 0
    && truth.difficultyTags.every((tag) => DIFFICULTY_KINDS.includes(tag));
  if (!difficultyVerified) {
    reasons.push("Truth case has no valid retained hard-case difficulty label.");
  }

  const diagnostics: PracticeSceneTruthDiagnosticV1[] = [];
  const byShot = new Map<string, PracticeSceneMatchV1[]>();
  for (const match of observation.matches) {
    const retained = byShot.get(match.shotId) ?? [];
    byShot.set(match.shotId, [...retained, match]);
  }
  const truthShotIds = new Set(truth.shots.map((shot) => shot.shotId));
  let matchedTruthShotCount = 0;

  for (const shot of truth.shots) {
    const matches = [...(byShot.get(shot.shotId) ?? [])]
      .sort((left, right) => right.confidence - left.confidence);
    if (matches.length === 0) {
      diagnostics.push(diagnostic("MISSING_MATCH", {
        caseId: truth.caseId,
        shotId: shot.shotId,
        expectedSourceId: shot.expectedSourceId,
        message: "No scene match was retained for this truth shot.",
        evidenceRefs: evidenceFor(shot, null, observation.evidenceRefs),
      }));
      continue;
    }
    if (matches.length > 1) {
      diagnostics.push(diagnostic("DUPLICATE_MATCH", {
        caseId: truth.caseId,
        shotId: shot.shotId,
        expectedSourceId: shot.expectedSourceId,
        match: matches[0]!,
        message: "Multiple scene matches were retained for one truth shot.",
        evidenceRefs: uniqueNonEmpty(matches.flatMap((match) => match.evidenceRefs)),
      }));
    }
    const match = matches[0]!;
    const primaryKinds: PracticeSceneTruthDiagnosticKindV1[] = [];
    const evidenceRefs = evidenceFor(shot, match, observation.evidenceRefs);
    if (match.sourceId !== shot.expectedSourceId) {
      primaryKinds.push("WRONG_SOURCE");
      diagnostics.push(diagnostic("WRONG_SOURCE", {
        caseId: truth.caseId,
        shotId: shot.shotId,
        expectedSourceId: shot.expectedSourceId,
        match,
        message: "Scene matcher selected the wrong raw source.",
        evidenceRefs,
      }));
    }
    const tolerance = shot.sourceToleranceMs ?? policy.sourceRangeToleranceMs;
    if (Math.abs(match.sourceStartMs - shot.expectedSourceStartMs) > tolerance
      || Math.abs(match.sourceEndMs - shot.expectedSourceEndMs) > tolerance) {
      primaryKinds.push("SOURCE_RANGE_MISMATCH");
      diagnostics.push(diagnostic("SOURCE_RANGE_MISMATCH", {
        caseId: truth.caseId,
        shotId: shot.shotId,
        expectedSourceId: shot.expectedSourceId,
        match,
        message: "Scene matcher selected source timing outside the retained truth tolerance.",
        evidenceRefs,
      }));
    }
    if (match.direction !== shot.expectedDirection) {
      primaryKinds.push("DIRECTION_MISMATCH");
      diagnostics.push(diagnostic("DIRECTION_MISMATCH", {
        caseId: truth.caseId,
        shotId: shot.shotId,
        expectedSourceId: shot.expectedSourceId,
        match,
        message: "Scene matcher selected the wrong playback direction.",
        evidenceRefs,
      }));
    }
    if (primaryKinds.length === 0 && matches.length === 1) {
      matchedTruthShotCount += 1;
    }
    if (primaryKinds.length > 0
      && match.confidence >= policy.highConfidenceFalseMatchThreshold) {
      diagnostics.push(diagnostic("HIGH_CONFIDENCE_FALSE_MATCH", {
        caseId: truth.caseId,
        shotId: shot.shotId,
        expectedSourceId: shot.expectedSourceId,
        match,
        message: "Incorrect scene match was emitted with high confidence.",
        evidenceRefs,
      }));
    }
    if (primaryKinds.length > 0
      && match.candidateMargin !== undefined
      && match.candidateMargin <= policy.ambiguousFalseMatchMarginThreshold) {
      diagnostics.push(diagnostic("AMBIGUOUS_FALSE_MATCH", {
        caseId: truth.caseId,
        shotId: shot.shotId,
        expectedSourceId: shot.expectedSourceId,
        match,
        message: "Incorrect scene match had a small retained candidate margin.",
        evidenceRefs,
      }));
    }
  }

  for (const match of observation.matches) {
    if (truthShotIds.has(match.shotId)) continue;
    diagnostics.push(diagnostic("UNEXPECTED_MATCH", {
      caseId: truth.caseId,
      shotId: match.shotId,
      match,
      message: "Scene matcher emitted a shot that has no independent truth label.",
      evidenceRefs: uniqueNonEmpty([...match.evidenceRefs, ...observation.evidenceRefs]),
    }));
  }

  const sceneErrorCount = diagnostics
    .filter((item) => PRIMARY_DIAGNOSTICS.has(item.kind))
    .length;
  if (sceneErrorCount > 0) {
    reasons.push("Scene truth comparison produced " + String(sceneErrorCount) + " machine errors.");
  }
  const passed = reasons.length === 0 && sceneErrorCount === 0;
  return {
    caseId: truth.caseId,
    referenceId: truth.referenceId,
    finishSha256: normalizedSha256(truth.finishSha256),
    truthCoverage,
    fullLengthTruthVerified,
    independentTruthVerified,
    difficultyVerified,
    matchedTruthShotCount,
    sceneErrorCount,
    diagnostics,
    passed,
    reasons: uniqueNonEmpty(reasons),
    evidenceRefs: uniqueNonEmpty([
      ...truth.evidenceRefs,
      ...truth.shots.flatMap((shot) => shot.truthEvidenceRefs),
      ...observation.evidenceRefs,
      ...observation.matches.flatMap((match) => match.evidenceRefs),
    ]),
  };
};

const diagnosticShotKey = (item: PracticeSceneTruthDiagnosticV1): string =>
  item.caseId + "::" + (item.shotId ?? "<case>");

const buildTuningFocus = (
  cases: readonly PracticeRetainedTruthSuiteCaseInputV1[],
  reports: readonly PracticeRetainedTruthCaseReportV1[],
): readonly PracticeRetainedTruthTuningFocusV1[] => {
  const difficultyByCase = new Map(cases.map((item) => [
    item.truth.caseId,
    item.truth.difficultyTags,
  ] as const));
  const diagnostics = reports.flatMap((report) => report.diagnostics);
  const highConfidenceKeys = new Set(
    diagnostics
      .filter((item) => item.kind === "HIGH_CONFIDENCE_FALSE_MATCH")
      .map(diagnosticShotKey),
  );
  const ambiguousKeys = new Set(
    diagnostics
      .filter((item) => item.kind === "AMBIGUOUS_FALSE_MATCH")
      .map(diagnosticShotKey),
  );

  return DIAGNOSTIC_KINDS
    .map((kind): PracticeRetainedTruthTuningFocusV1 | null => {
      const clustered = diagnostics.filter((item) => item.kind === kind);
      if (clustered.length === 0) return null;
      const subsystem = TUNING_SUBSYSTEM_BY_DIAGNOSTIC.get(kind);
      if (subsystem === undefined) {
        throw new TypeError("Missing retained-truth tuning subsystem for " + kind + ".");
      }
      const difficultyKinds = DIFFICULTY_KINDS.filter((difficulty) =>
        clustered.some((item) =>
          difficultyByCase.get(item.caseId)?.includes(difficulty) ?? false));
      return {
        kind,
        subsystem,
        count: clustered.length,
        caseCount: new Set(clustered.map((item) => item.caseId)).size,
        difficultyKinds,
        highConfidenceFalseMatchCount: clustered
          .filter((item) => highConfidenceKeys.has(diagnosticShotKey(item))).length,
        ambiguousFalseMatchCount: clustered
          .filter((item) => ambiguousKeys.has(diagnosticShotKey(item))).length,
      };
    })
    .filter((item): item is PracticeRetainedTruthTuningFocusV1 => item !== null)
    .sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind));
};

const buildTuningPlan = (
  cases: readonly PracticeRetainedTruthSuiteCaseInputV1[],
  reports: readonly PracticeRetainedTruthCaseReportV1[],
): readonly PracticeRetainedTruthTuningPlanItemV1[] => {
  const difficultyByCase = new Map(cases.map((item) => [
    item.truth.caseId,
    item.truth.difficultyTags,
  ] as const));
  const diagnostics = reports.flatMap((report) => report.diagnostics);
  const highConfidenceKeys = new Set(
    diagnostics
      .filter((item) => item.kind === "HIGH_CONFIDENCE_FALSE_MATCH")
      .map(diagnosticShotKey),
  );
  const ambiguousKeys = new Set(
    diagnostics
      .filter((item) => item.kind === "AMBIGUOUS_FALSE_MATCH")
      .map(diagnosticShotKey),
  );
  const bySubsystem = new Map<
  PracticeRetainedTruthTuningSubsystemV1,
  PracticeSceneTruthDiagnosticV1[]
  >();
  for (const item of diagnostics) {
    const subsystem = TUNING_SUBSYSTEM_BY_DIAGNOSTIC.get(item.kind);
    if (subsystem === undefined) {
      throw new TypeError("Missing retained-truth tuning subsystem for " + item.kind + ".");
    }
    bySubsystem.set(subsystem, [...(bySubsystem.get(subsystem) ?? []), item]);
  }

  return [...bySubsystem.entries()]
    .map(([subsystem, clustered]): PracticeRetainedTruthTuningPlanItemV1 => {
      const caseIds = [...new Set(clustered.map((item) => item.caseId))].sort();
      const action = TUNING_ACTION_BY_SUBSYSTEM.get(subsystem);
      if (action === undefined) {
        throw new TypeError("Missing retained-truth tuning action for " + subsystem + ".");
      }
      return {
        subsystem,
        diagnosticKinds: DIAGNOSTIC_KINDS.filter((kind) =>
          clustered.some((item) => item.kind === kind)),
        count: clustered.length,
        caseCount: caseIds.length,
        difficultyKinds: DIFFICULTY_KINDS.filter((difficulty) =>
          caseIds.some((caseId) =>
            difficultyByCase.get(caseId)?.includes(difficulty) ?? false)),
        highConfidenceFalseMatchCount: new Set(
          clustered
            .filter((item) => highConfidenceKeys.has(diagnosticShotKey(item)))
            .map(diagnosticShotKey),
        ).size,
        ambiguousFalseMatchCount: new Set(
          clustered
            .filter((item) => ambiguousKeys.has(diagnosticShotKey(item)))
            .map(diagnosticShotKey),
        ).size,
        caseIds,
        evidenceRefs: uniqueNonEmpty(clustered.flatMap((item) => item.evidenceRefs)),
        recommendedAction: action,
      };
    })
    .sort((left, right) =>
      right.highConfidenceFalseMatchCount - left.highConfidenceFalseMatchCount
      || right.caseCount - left.caseCount
      || right.count - left.count
      || left.subsystem.localeCompare(right.subsystem));
};

export const evaluatePracticeRetainedTruthSuiteV1 = (input: {
  readonly editTypeId: string;
  readonly mode: PracticeRetainedTruthSuiteModeV1;
  readonly cases: readonly PracticeRetainedTruthSuiteCaseInputV1[];
  readonly policy?: Partial<PracticeRetainedTruthSuitePolicyV1>;
}): PracticeRetainedTruthSuiteReportV1 => {
  const policy = resolvedPolicy(input.policy);
  const reports = input.cases.map((item) => evaluateCase(item, policy));
  const reasons: string[] = [];
  if (input.editTypeId.trim().length === 0) {
    reasons.push("Retained truth suite requires an Edit Type id.");
  }
  if (input.cases.length < policy.minimumCases) {
    reasons.push("Retained truth suite has fewer than "
      + String(policy.minimumCases) + " cases.");
  }
  if (input.cases.length > policy.maximumCases) {
    reasons.push("Retained truth suite exceeds the supported "
      + String(policy.maximumCases) + "-case window.");
  }

  const caseIds = input.cases.map((item) => item.truth.caseId.trim());
  const references = input.cases.map((item) => item.truth.referenceId.trim());
  const finishSha256 = input.cases.map((item) => normalizedSha256(item.truth.finishSha256));
  const distinctCaseIdCount = new Set(caseIds).size;
  const distinctReferenceCount = new Set(references).size;
  const distinctFinishSha256Count = new Set(finishSha256).size;
  if (distinctCaseIdCount !== input.cases.length) {
    reasons.push("Retained truth suite reuses a case id.");
  }
  if (distinctReferenceCount !== input.cases.length) {
    reasons.push("Retained truth suite reuses a Finish reference id.");
  }
  if (distinctFinishSha256Count !== input.cases.length) {
    reasons.push("Retained truth suite reuses Finish byte identity (SHA-256).");
  }

  const independentTruthCaseCount = reports
    .filter((report) => report.independentTruthVerified).length;
  const fullLengthTruthCaseCount = reports
    .filter((report) => report.fullLengthTruthVerified).length;
  if (independentTruthCaseCount !== input.cases.length) {
    reasons.push("Every certification case requires independent shot-level truth.");
  }
  if (fullLengthTruthCaseCount !== input.cases.length) {
    reasons.push("Every certification case requires full-length Finish truth coverage.");
  }

  const difficultyKinds = DIFFICULTY_KINDS.filter((kind) =>
    input.cases.some((item) => item.truth.difficultyTags.includes(kind)));
  if (difficultyKinds.length < policy.minimumDifficultyKinds) {
    reasons.push("Retained truth suite spans fewer than "
      + String(policy.minimumDifficultyKinds) + " difficult-case categories.");
  }

  const passedCaseCount = reports.filter((report) => report.passed).length;
  for (const report of reports) {
    if (!report.passed) {
      reasons.push("Retained truth case failed: " + report.caseId + ".");
    }
  }
  if (input.mode === "MEASURE_ONLY") {
    reasons.push("MEASURE_ONLY suites cannot certify Practice generalization.");
  }

  const allDiagnostics = reports.flatMap((report) => report.diagnostics);
  const diagnosticCounts = DIAGNOSTIC_KINDS
    .map((kind) => ({
      kind,
      count: allDiagnostics.filter((item) => item.kind === kind).length,
    }))
    .filter((item) => item.count > 0);
  const tuningFocus = buildTuningFocus(input.cases, reports);
  const tuningPlan = buildTuningPlan(input.cases, reports);
  const sceneErrorCount = reports.reduce((sum, report) => sum + report.sceneErrorCount, 0);
  const certified = input.mode === "CERTIFICATION"
    && reasons.length === 0
    && passedCaseCount === input.cases.length
    && input.cases.length >= policy.minimumCases
    && input.cases.length <= policy.maximumCases
    && distinctCaseIdCount === input.cases.length
    && distinctReferenceCount === input.cases.length
    && distinctFinishSha256Count === input.cases.length
    && independentTruthCaseCount === input.cases.length
    && fullLengthTruthCaseCount === input.cases.length
    && difficultyKinds.length >= policy.minimumDifficultyKinds
    && sceneErrorCount === 0;

  return {
    schema: "editflow.practice-retained-truth-suite-report.v1",
    editTypeId: input.editTypeId.trim(),
    mode: input.mode,
    policy,
    caseCount: input.cases.length,
    passedCaseCount,
    distinctCaseIdCount,
    distinctReferenceCount,
    distinctFinishSha256Count,
    independentTruthCaseCount,
    fullLengthTruthCaseCount,
    difficultyKindCount: difficultyKinds.length,
    difficultyKinds,
    sceneErrorCount,
    diagnosticCounts,
    tuningFocus,
    tuningPlan,
    certified,
    reasons: uniqueNonEmpty(reasons),
    cases: reports,
    evidenceRefs: uniqueNonEmpty(reports.flatMap((report) => report.evidenceRefs)),
    evaluatedAt: new Date().toISOString(),
  };
};
