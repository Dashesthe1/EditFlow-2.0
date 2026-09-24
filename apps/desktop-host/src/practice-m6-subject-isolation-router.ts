import type {
  PracticeM6SubjectIsolationRouteV1,
  PracticeM6VerifiedSubjectIsolationV1,
} from "./practice-m6-current-ae-runtime.js";

export interface PracticeSubjectIsolationBackendV1 {
  readonly id: string;
  readonly route: PracticeM6SubjectIsolationRouteV1;
  /**
   * Optional explicit mask-source identity. Built-in Practice backend IDs are
   * mapped automatically so existing assembly code remains compatible.
   */
  readonly maskSource?: PracticeM6VerifiedSubjectIsolationV1["maskSource"];
}

const nonEmpty = (value: string): boolean => value.trim().length > 0;

const BUILT_IN_MASK_SOURCE_BY_BACKEND_ID: Readonly<
  Record<string, PracticeM6VerifiedSubjectIsolationV1["maskSource"]>
> = Object.freeze({
  SAM31_TEMPORAL_MATTE: "SEGMENTATION",
  ROTO_BRUSH_TRACK_MATTE: "ROTO_BRUSH",
  AE_TRACKED_MASK: "AE_TRACKED_MASK",
});

const maskSourceForBackend = (
  backend: PracticeSubjectIsolationBackendV1,
): PracticeM6VerifiedSubjectIsolationV1["maskSource"] | null =>
  backend.maskSource
  ?? BUILT_IN_MASK_SOURCE_BY_BACKEND_ID[backend.id]
  ?? null;

export class PracticeSubjectIsolationBackendFailureV1 extends Error {
  readonly appliedOperations: number;
  readonly evidenceRefs: readonly string[];
  readonly fallbackSafe: boolean;

  constructor(
    message: string,
    appliedOperations = 0,
    evidenceRefs: readonly string[] = [],
    fallbackSafe = true,
  ) {
    super(message);
    this.name = "PracticeSubjectIsolationBackendFailureV1";
    if (!Number.isInteger(appliedOperations) || appliedOperations < 0) {
      throw new RangeError(
        "Practice subject-isolation failure appliedOperations must be a non-negative integer.",
      );
    }
    this.appliedOperations = appliedOperations;
    this.evidenceRefs = Object.freeze([
      ...new Set(
        evidenceRefs.filter((value) => typeof value === "string" && value.trim().length > 0),
      ),
    ]);
    this.fallbackSafe = fallbackSafe === true;
  }
}

const carriedFailure = (
  error: unknown,
): PracticeSubjectIsolationBackendFailureV1 | null =>
  error instanceof PracticeSubjectIsolationBackendFailureV1 ? error : null;

const backendFailureCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.split(":", 1)[0]?.trim() ?? "";
  return /^[A-Z0-9_]+$/.test(code)
    ? code
    : "UNCLASSIFIED_BACKEND_REJECTION";
};

const retainedIdentityEvidence = (
  input: Parameters<PracticeM6SubjectIsolationRouteV1["prepare"]>[0],
): readonly string[] => {
  const retained = input.retainedSubjectIdentity;
  if (retained === undefined) return [];
  return [
    "practice-subject-isolation-retained-memory:" + retained.memoryId,
    ...retained.maskSources.map((source) =>
      "practice-subject-isolation-retained-mask-source:" + source),
    "practice-subject-isolation-retained-source-semantic:" + retained.sourceSemanticId,
  ];
};

const retainedEligibleBackends = (
  input: Parameters<PracticeM6SubjectIsolationRouteV1["prepare"]>[0],
  backends: readonly PracticeSubjectIsolationBackendV1[],
): readonly PracticeSubjectIsolationBackendV1[] => {
  const retained = input.retainedSubjectIdentity;
  if (retained === undefined) return backends;

  if (retained.referenceSemanticId !== input.referenceSemanticId
    || retained.sourceSemanticId.trim().length === 0
    || retained.sourceId !== input.sourceMatch.sourceId
    || retained.shotId !== input.shotId) {
    throw new PracticeSubjectIsolationBackendFailureV1(
      "PRACTICE_SUBJECT_ISOLATION_RETAINED_IDENTITY_MISMATCH:"
        + retained.memoryId,
      0,
      retainedIdentityEvidence(input),
    );
  }

  const retainedSources = new Set(retained.maskSources);
  if (retainedSources.size === 0) {
    throw new PracticeSubjectIsolationBackendFailureV1(
      "PRACTICE_SUBJECT_ISOLATION_RETAINED_SOURCE_MISSING:"
        + retained.memoryId,
      0,
      retainedIdentityEvidence(input),
    );
  }

  const eligible = backends.filter((backend) => {
    const maskSource = maskSourceForBackend(backend);
    return maskSource !== null && retainedSources.has(maskSource);
  });
  if (eligible.length === 0) {
    throw new PracticeSubjectIsolationBackendFailureV1(
      "PRACTICE_SUBJECT_ISOLATION_RETAINED_SOURCE_UNAVAILABLE:"
        + [...retainedSources].join(","),
      0,
      retainedIdentityEvidence(input),
    );
  }
  return eligible;
};

const assertProofProvenance = (
  input: Parameters<PracticeM6SubjectIsolationRouteV1["prepare"]>[0],
  backend: PracticeSubjectIsolationBackendV1,
  proof: PracticeM6VerifiedSubjectIsolationV1,
): void => {
  const declaredSource = maskSourceForBackend(backend);
  if (declaredSource !== null && proof.maskSource !== declaredSource) {
    throw new PracticeSubjectIsolationBackendFailureV1(
      "PRACTICE_SUBJECT_ISOLATION_BACKEND_SOURCE_MISMATCH:"
        + backend.id + ":expected=" + declaredSource + ":actual=" + proof.maskSource,
    );
  }

  const retained = input.retainedSubjectIdentity;
  if (retained === undefined) return;
  if (!retained.maskSources.includes(proof.maskSource)) {
    throw new PracticeSubjectIsolationBackendFailureV1(
      "PRACTICE_SUBJECT_ISOLATION_RETAINED_SOURCE_DRIFT:"
        + backend.id + ":" + proof.maskSource,
    );
  }
  if (proof.referenceSemanticId !== retained.referenceSemanticId
    || proof.sourceSemanticId !== retained.sourceSemanticId) {
    throw new PracticeSubjectIsolationBackendFailureV1(
      "PRACTICE_SUBJECT_ISOLATION_RETAINED_SEMANTIC_MISMATCH:"
        + backend.id
        + ":expected=" + retained.sourceSemanticId
        + ":actual=" + proof.sourceSemanticId,
    );
  }
};

export class PracticeM6SubjectIsolationRouterV1
implements PracticeM6SubjectIsolationRouteV1 {
  readonly backends: readonly PracticeSubjectIsolationBackendV1[];

  constructor(backends: readonly PracticeSubjectIsolationBackendV1[]) {
    if (!Array.isArray(backends) || backends.length === 0
      || backends.some((backend) =>
        !backend || !nonEmpty(backend.id) || !backend.route)) {
      throw new TypeError(
        "Practice subject-isolation router requires at least one named backend.",
      );
    }
    const ids = backends.map((backend) => backend.id.trim());
    if (new Set(ids).size !== ids.length) {
      throw new TypeError("Practice subject-isolation backend IDs must be unique.");
    }
    this.backends = Object.freeze(backends.map((backend) => Object.freeze({
      id: backend.id.trim(),
      route: backend.route,
      ...(backend.maskSource === undefined
        ? {}
        : { maskSource: backend.maskSource }),
    })));
  }

  async prepare(
    input: Parameters<PracticeM6SubjectIsolationRouteV1["prepare"]>[0],
  ): Promise<PracticeM6VerifiedSubjectIsolationV1> {
    const failed: string[] = [];
    const carriedEvidence: string[] = [...retainedIdentityEvidence(input)];
    let carriedAppliedOperations = 0;
    let lastError: unknown = null;
    const candidates = retainedEligibleBackends(input, this.backends);
    const retained = input.retainedSubjectIdentity;

    for (const backend of candidates) {
      try {
        const proof = await backend.route.prepare(input);
        assertProofProvenance(input, backend, proof);
        return {
          ...proof,
          appliedOperations: proof.appliedOperations + carriedAppliedOperations,
          evidenceRefs: [
            ...new Set([
              ...carriedEvidence,
              ...proof.evidenceRefs,
              "practice-subject-isolation-backend:" + backend.id,
              ...(retained === undefined
                ? []
                : [
                    "practice-subject-isolation-retained-provenance-honored:true",
                    "practice-subject-isolation-retained-route:" + backend.id,
                  ]),
              ...failed.map((id) =>
                "practice-subject-isolation-fallback-after:" + id),
              ...(carriedAppliedOperations === 0
                ? []
                : [
                    "practice-subject-isolation-carried-undo-entries:"
                    + String(carriedAppliedOperations),
                  ]),
            ]),
          ],
        };
      } catch (error) {
        failed.push(backend.id);
        lastError = error;
        carriedEvidence.push(
          "practice-subject-isolation-rejected-backend:" + backend.id,
          "practice-subject-isolation-rejection-code:"
            + backend.id + ":" + backendFailureCode(error),
        );
        const failure = carriedFailure(error);
        if (failure !== null) {
          carriedAppliedOperations += failure.appliedOperations;
          carriedEvidence.push(
            ...failure.evidenceRefs,
            "practice-subject-isolation-failed-backend-undo-entries:"
              + backend.id + ":" + String(failure.appliedOperations),
          );
          if (!failure.fallbackSafe) {
            throw new PracticeSubjectIsolationBackendFailureV1(
              "PRACTICE_SUBJECT_ISOLATION_UNSAFE_BACKEND_FAILURE:"
                + backend.id + ":" + failure.message,
              carriedAppliedOperations,
              carriedEvidence,
              false,
            );
          }
        }
      }
    }

    throw new PracticeSubjectIsolationBackendFailureV1(
      (retained === undefined
        ? "PRACTICE_SUBJECT_ISOLATION_ALL_BACKENDS_REJECTED:"
        : "PRACTICE_SUBJECT_ISOLATION_RETAINED_BACKENDS_REJECTED:")
      + failed.join(",")
      + ":last=" + String(lastError),
      carriedAppliedOperations,
      [
        ...carriedEvidence,
        ...failed.map((id) => "practice-subject-isolation-rejected-backend:" + id),
      ],
    );
  }
}

export const createPracticeM6SubjectIsolationRouterV1 = (
  backends: readonly (
    | PracticeSubjectIsolationBackendV1
    | null
    | undefined
  )[],
): PracticeM6SubjectIsolationRouteV1 | null => {
  const available = backends.filter(
    (backend): backend is PracticeSubjectIsolationBackendV1 =>
      backend !== null && backend !== undefined,
  );
  if (available.length === 0) return null;
  // Always retain the router boundary, even for one available backend, so
  // retained identity provenance cannot be bypassed by environment topology.
  return new PracticeM6SubjectIsolationRouterV1(available);
};
