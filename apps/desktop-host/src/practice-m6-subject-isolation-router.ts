import type {
  PracticeM6SubjectIsolationRouteV1,
  PracticeM6VerifiedSubjectIsolationV1,
} from "./practice-m6-current-ae-runtime.js";

export interface PracticeSubjectIsolationBackendV1 {
  readonly id: string;
  readonly route: PracticeM6SubjectIsolationRouteV1;
}

const nonEmpty = (value: string): boolean => value.trim().length > 0;

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
    let lastError: unknown = null;
    for (const backend of this.backends) {
      try {
        const proof = await backend.route.prepare(input);
        return {
          ...proof,
          evidenceRefs: [
            ...new Set([
              ...proof.evidenceRefs,
              "practice-subject-isolation-backend:" + backend.id,
              ...failed.map((id) =>
                "practice-subject-isolation-fallback-after:" + id),
            ]),
          ],
        };
      } catch (error) {
        failed.push(backend.id);
        lastError = error;
      }
    }
    throw new Error(
      "PRACTICE_SUBJECT_ISOLATION_ALL_BACKENDS_REJECTED:"
      + failed.join(",")
      + ":last=" + String(lastError),
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
