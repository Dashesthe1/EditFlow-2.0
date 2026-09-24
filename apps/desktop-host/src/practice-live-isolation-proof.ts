import type { PracticeSessionResultV1 } from "../../../packages/practice-homework/src/contracts.js";

export interface PracticeLiveIsolationProofRequirementsV1 {
  readonly required: boolean;
  readonly requiredBackendIds: readonly string[];
  readonly requiredFallbackAfterIds: readonly string[];
}

export interface PracticeLiveIsolationTargetProofV1 {
  readonly routeId: string;
  readonly referenceSemanticId: string;
  readonly sourceSemanticId: string;
  readonly targetBindingVerified: boolean;
  readonly targetShotId: string;
  readonly targetCompStableId: string;
  readonly targetLayerStableId: string;
  readonly maskSource: string;
  readonly complete: boolean;
}

export interface PracticeLiveIsolationProofAssessmentV1 {
  readonly schema: "editflow.practice-live-isolation-proof.v1";
  readonly required: boolean;
  readonly verified: boolean;
  readonly backendIds: readonly string[];
  readonly fallbackAfterBackendIds: readonly string[];
  readonly targets: readonly PracticeLiveIsolationTargetProofV1[];
  readonly reasons: readonly string[];
  readonly evidenceRefs: readonly string[];
}
const unique = (values: readonly string[]): readonly string[] =>
  [...new Set(values.filter((value) => value.trim().length > 0))];

const valueAfter = (value: string, prefix: string): string | null =>
  value.startsWith(prefix) && value.slice(prefix.length).trim().length > 0
    ? value.slice(prefix.length)
    : null;

const isolationEvidence = (result: PracticeSessionResultV1): readonly string[] =>
  unique([
    ...result.evidenceRefs,
    ...result.attempts.flatMap((attempt) => attempt.evidenceRefs),
  ].filter((value) =>
    value.startsWith("practice-subject-")));

const parseTargets = (
  evidenceRefs: readonly string[],
): readonly PracticeLiveIsolationTargetProofV1[] => {
  const targets: PracticeLiveIsolationTargetProofV1[] = [];
  let current: Record<string, string | boolean> | null = null;
  const finish = (): void => {
    if (current === null) return;
    const routeId = String(current["routeId"] ?? "");
    const referenceSemanticId = String(current["referenceSemanticId"] ?? "");
    const sourceSemanticId = String(current["sourceSemanticId"] ?? "");
    const targetShotId = String(current["targetShotId"] ?? "");
    const targetCompStableId = String(current["targetCompStableId"] ?? "");
    const targetLayerStableId = String(current["targetLayerStableId"] ?? "");
    const maskSource = String(current["maskSource"] ?? "");
    const targetBindingVerified = current["targetBindingVerified"] === true;
    targets.push({
      routeId,
      referenceSemanticId,
      sourceSemanticId,
      targetBindingVerified,
      targetShotId,
      targetCompStableId,
      targetLayerStableId,
      maskSource,
      complete: routeId.length > 0
        && referenceSemanticId.length > 0
        && sourceSemanticId.length > 0
        && targetBindingVerified
        && targetShotId.length > 0
        && targetCompStableId.length > 0
        && targetLayerStableId.length > 0
        && ["SEGMENTATION", "ROTO_BRUSH", "AE_TRACKED_MASK"].includes(maskSource),
    });
    current = null;
  };

  for (const evidence of evidenceRefs) {
    const routeId = valueAfter(evidence, "practice-subject-isolation-route:");
    if (routeId !== null) {
      finish();
      current = { routeId };
      continue;
    }
    if (current === null) continue;
    const referenceId = valueAfter(evidence, "practice-subject-reference-id:");
    const sourceId = valueAfter(evidence, "practice-subject-source-id:");
    const shotId = valueAfter(evidence, "practice-subject-target-shot:");
    const compId = valueAfter(evidence, "practice-subject-target-comp:");
    const layerId = valueAfter(evidence, "practice-subject-target-layer:");
    const maskSource = valueAfter(evidence, "practice-subject-mask-source:");
    if (referenceId !== null) current["referenceSemanticId"] = referenceId;
    if (sourceId !== null) current["sourceSemanticId"] = sourceId;
    if (evidence === "practice-subject-target-binding:true") {
      current["targetBindingVerified"] = true;
    }
    if (shotId !== null) current["targetShotId"] = shotId;
    if (compId !== null) current["targetCompStableId"] = compId;
    if (layerId !== null) current["targetLayerStableId"] = layerId;
    if (maskSource !== null) current["maskSource"] = maskSource;
  }
  finish();
  return targets;
};

export const evaluatePracticeLiveIsolationProofV1 = (
  result: PracticeSessionResultV1,
  requirements: PracticeLiveIsolationProofRequirementsV1,
): PracticeLiveIsolationProofAssessmentV1 => {
  const evidenceRefs = isolationEvidence(result);
  const backendIds = unique(evidenceRefs
    .map((item) => valueAfter(item, "practice-subject-isolation-backend:") ?? ""));
  const fallbackAfterBackendIds = unique(evidenceRefs
    .map((item) => valueAfter(
      item,
      "practice-subject-isolation-fallback-after:",
    ) ?? ""));
  const targets = parseTargets(evidenceRefs);
  const reasons: string[] = [];

  if (requirements.required && targets.length === 0) {
    reasons.push("No verified subject-isolation target proof was retained.");
  }
  const incompleteTargets = targets.filter((target) => !target.complete);
  if (requirements.required && incompleteTargets.length > 0) {
    reasons.push(
      "One or more subject-isolation proofs omitted exact shot/comp/layer target identity.",
    );
  }
  for (const backendId of requirements.requiredBackendIds) {
    if (!backendIds.includes(backendId)) {
      reasons.push("Required isolation backend was not proven: " + backendId + ".");
    }
  }
  for (const backendId of requirements.requiredFallbackAfterIds) {
    if (!fallbackAfterBackendIds.includes(backendId)) {
      reasons.push("Required isolation fallback was not observed after: " + backendId + ".");
    }
  }

  const isRequired = requirements.required
    || requirements.requiredBackendIds.length > 0
    || requirements.requiredFallbackAfterIds.length > 0;
  return {
    schema: "editflow.practice-live-isolation-proof.v1",
    required: isRequired,
    verified: !isRequired || reasons.length === 0,
    backendIds,
    fallbackAfterBackendIds,
    targets,
    reasons,
    evidenceRefs,
  };
};
