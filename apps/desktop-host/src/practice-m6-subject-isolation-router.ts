import type {
  PracticeM6SubjectIsolationRouteV1,
  PracticeM6VerifiedSubjectIsolationV1,
} from "./practice-m6-current-ae-runtime.js";

export interface PracticeSubjectIsolationBackendV1 {
  readonly id: string;
  readonly route: PracticeM6SubjectIsolationRouteV1;
}

const nonEmpty = (value: string): boolean => value.trim().length > 0;

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
    })));
  }

  async prepare(
    input: Parameters<PracticeM6SubjectIsolationRouteV1["prepare"]>[0],
  ): Promise<PracticeM6VerifiedSubjectIsolationV1> {
    const failed: string[] = [];
    const carriedEvidence: string[] = [];
    let carriedAppliedOperations = 0;
    let lastError: unknown = null;

    for (const backend of this.backends) {
      try {
        const proof = await backend.route.prepare(input);
        return {
          ...proof,
          appliedOperations: proof.appliedOperations + carriedAppliedOperations,
          evidenceRefs: [
            ...new Set([
              ...carriedEvidence,
              ...proof.evidenceRefs,
              "practice-subject-isolation-backend:" + backend.id,
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
      "PRACTICE_SUBJECT_ISOLATION_ALL_BACKENDS_REJECTED:"
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
  if (available.length === 1) return available[0]!.route;
  return new PracticeM6SubjectIsolationRouterV1(available);
};

