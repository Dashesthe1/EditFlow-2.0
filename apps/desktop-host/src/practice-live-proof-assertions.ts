export interface PracticeLiveReloadProofV1 {
  readonly episodeRestored: boolean;
  readonly editTypeRestored: boolean;
  readonly allocationRestored: boolean;
  readonly editTypeContainsSession: boolean;
  readonly learningMemoryUnchanged: boolean;
}

export interface PracticeLiveAssertionV1 {
  readonly passed: boolean;
  readonly reasons: readonly string[];
}

export const evaluatePracticeLivePersistenceV1 = (
  practiceRole: "LEARNING" | "HELD_OUT_CERTIFICATION",
  proof: PracticeLiveReloadProofV1,
): PracticeLiveAssertionV1 => {
  const reasons: string[] = [];
  if (!proof.editTypeRestored) {
    reasons.push("Edit Type did not survive the live Practice reload.");
  }
  if (practiceRole === "LEARNING") {
    if (!proof.episodeRestored) {
      reasons.push("Learning episode did not survive the live Practice reload.");
    }
  } else {
    if (proof.episodeRestored) {
      reasons.push("Held-out certification leaked an episode into Practice learning memory.");
    }
    if (proof.allocationRestored || proof.editTypeContainsSession) {
      reasons.push("Held-out certification leaked allocation/session evidence into the Edit Type.");
    }
    if (!proof.learningMemoryUnchanged) {
      reasons.push("Held-out certification changed the Practice learning-memory snapshot.");
    }
  }
  return { passed: reasons.length === 0, reasons };
};

export interface PracticeIsolationEvidenceRequirementV1 {
  readonly evidenceRefs: readonly string[];
  readonly expectedBackend?: string | null;
  readonly expectedFallbackAfter?: string | null;
}

export interface PracticeIsolationEvidenceAssertionV1
extends PracticeLiveAssertionV1 {
  readonly observedBackends: readonly string[];
  readonly observedFallbacks: readonly string[];
  readonly observedRejectedBackends: readonly string[];
  readonly observedRejectionCodes: readonly string[];
}

const suffixes = (
  evidenceRefs: readonly string[],
  prefix: string,
): readonly string[] => [...new Set(evidenceRefs
  .filter((value) => value.startsWith(prefix))
  .map((value) => value.slice(prefix.length))
  .filter((value) => value.length > 0))];
export const evaluatePracticeIsolationEvidenceV1 = (
  input: PracticeIsolationEvidenceRequirementV1,
): PracticeIsolationEvidenceAssertionV1 => {
  const backendPrefix = "practice-subject-isolation-backend:";
  const fallbackPrefix = "practice-subject-isolation-fallback-after:";
  const rejectedPrefix = "practice-subject-isolation-rejected-backend:";
  const rejectionCodePrefix = "practice-subject-isolation-rejection-code:";
  const observedBackends = suffixes(input.evidenceRefs, backendPrefix);
  const observedFallbacks = suffixes(input.evidenceRefs, fallbackPrefix);
  const observedRejectedBackends = suffixes(input.evidenceRefs, rejectedPrefix);
  const observedRejectionCodes = suffixes(input.evidenceRefs, rejectionCodePrefix);
  const reasons: string[] = [];
  const expectedBackend = input.expectedBackend?.trim() ?? "";
  const expectedFallbackAfter = input.expectedFallbackAfter?.trim() ?? "";
  const hasExact = (value: string): boolean => input.evidenceRefs.includes(value);
  const hasPrefix = (prefix: string): boolean =>
    input.evidenceRefs.some((value) => value.startsWith(prefix));
  if (expectedBackend.length > 0 && !observedBackends.includes(expectedBackend)) {
    reasons.push("Expected subject-isolation backend was not proven: " + expectedBackend + ".");
  }
  if (expectedFallbackAfter.length > 0) {
    if (!observedFallbacks.includes(expectedFallbackAfter)) {
      reasons.push(
        "Expected subject-isolation fallback was not proven after: "
        + expectedFallbackAfter + ".",
      );
    }
    if (!observedRejectedBackends.includes(expectedFallbackAfter)) {
      reasons.push(
        "Fallback backend rejection was not retained for: " + expectedFallbackAfter + ".",
      );
    }
    if (!observedRejectionCodes.some((value) =>
      value.startsWith(expectedFallbackAfter + ":"))) {
      reasons.push(
        "Fallback backend rejection code was not retained for: "
        + expectedFallbackAfter + ".",
      );
    }
  }
  if (expectedBackend === "ROTO_BRUSH_TRACK_MATTE") {
    const exactEvidence = [
      "practice-subject-cross-source-identity:true",
      "practice-subject-mask-source:ROTO_BRUSH",
      "practice-roto-working-layer-cleaned:true",
    ] as const;
    for (const value of exactEvidence) {
      if (!hasExact(value)) {
        reasons.push("Roto Brush certification is missing committed proof: " + value + ".");
      }
    }
    const prefixEvidence = [
      "practice-subject-isolation-route:practice-m6.roto-brush-track-matte.",
      "practice-roto-export-host-id:",
      "practice-roto-final-matte:",
      "practice-roto-applied-undo-entries:",
    ] as const;
    for (const prefix of prefixEvidence) {
      if (!hasPrefix(prefix)) {
        reasons.push("Roto Brush certification is missing committed evidence prefix: " + prefix);
      }
    }
  }
  return {
    passed: reasons.length === 0,
    reasons,
    observedBackends,
    observedFallbacks,
    observedRejectedBackends,
    observedRejectionCodes,
  };
};
