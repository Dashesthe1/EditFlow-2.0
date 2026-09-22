import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  EditTypeBehaviorEvidenceV1,
  EditTypeKnowledgeSnapshotV1,
  EditTypeProfileV1,
  PracticeEpisodeV1,
} from "./contracts.js";

const normalizeChoice = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

const uniqueStrings = (values: readonly string[]): readonly string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const evidenceId = (material: unknown): string =>
  "edit-type-evidence:" + createHash("sha256")
    .update(JSON.stringify(material))
    .digest("hex")
    .slice(0, 24);

const behaviorEvidenceForEpisode = (
  episode: PracticeEpisodeV1,
): readonly EditTypeBehaviorEvidenceV1[] => {
  const output: EditTypeBehaviorEvidenceV1[] = [];
  for (const attempt of episode.attempts) {
    const isBest = episode.bestAttempt?.attempt === attempt.attempt;
    const outcome = attempt.report.passed
      ? "MASTERED_SUPPORT"
      : (!episode.mastered && isBest ? "HUMAN_REVIEW" : "FAILED_ATTEMPT");
    const traces = attempt.decisionTraces.length > 0
      ? attempt.decisionTraces
      : [{
        decisionId: "attempt:" + String(attempt.attempt),
        cueIds: [] as readonly string[],
        constructionIds: [] as readonly string[],
        rationaleCodes: [] as readonly string[],
        semanticPatches: [] as const,
      }];
    for (const trace of traces) {
      const material = {
        sessionId: episode.sessionId,
        attempt: attempt.attempt,
        decisionId: trace.decisionId,
        outcome,
      };
      output.push({
        evidenceId: evidenceId(material),
        sessionId: episode.sessionId,
        attempt: attempt.attempt,
        outcome,
        cueIds: uniqueStrings(trace.cueIds),
        constructionIds: uniqueStrings(trace.constructionIds),
        rationaleCodes: uniqueStrings(trace.rationaleCodes),
        semanticPatches: structuredClone(trace.semanticPatches ?? []),
        overallSimilarity: attempt.report.overallSimilarity,
        definingEffectCoverage: attempt.report.definingEffectCoverage,
        elapsedMs: attempt.elapsedMs,
      });
    }
  }
  return output;
};
export interface CreateEditTypeInputV1 {
  readonly editTypeId: string;
  readonly title: string;
  readonly choiceWords?: readonly string[];
  readonly description?: string;
}

export class EditTypeRegistryV1 {
  readonly #profiles = new Map<string, EditTypeProfileV1>();

  create(input: CreateEditTypeInputV1): EditTypeProfileV1 {
    const editTypeId = input.editTypeId.trim();
    const title = input.title.trim();
    if (editTypeId.length === 0 || title.length === 0) {
      throw new TypeError("Edit Type id and title are required.");
    }
    if (this.#profiles.has(editTypeId)) {
      throw new TypeError("Edit Type id already exists: " + editTypeId);
    }
    const profile: EditTypeProfileV1 = {
      schema: "editflow.edit-type-profile.v1",
      editTypeId,
      title,
      choiceWords: uniqueStrings(input.choiceWords ?? []),
      ...(input.description === undefined ? {} : { description: input.description.trim() }),
      revision: 1,
      sessionIds: [],
      masteredSessionIds: [],
      behaviorEvidence: [],
    };
    this.#assertChoicesAvailable(profile);
    this.#profiles.set(editTypeId, profile);
    return structuredClone(profile);
  }
  register(profile: EditTypeProfileV1): void {
    if (profile.schema !== "editflow.edit-type-profile.v1") {
      throw new TypeError("Unsupported Edit Type profile schema.");
    }
    const normalized: EditTypeProfileV1 = {
      ...profile,
      behaviorEvidence: profile.behaviorEvidence.map((item) => ({
        ...item,
        semanticPatches: structuredClone(item.semanticPatches ?? []),
      })),
    };
    this.#assertChoicesAvailable(normalized, normalized.editTypeId);
    this.#profiles.set(normalized.editTypeId, structuredClone(normalized));
  }

  #assertChoicesAvailable(profile: EditTypeProfileV1, ignoreId?: string): void {
    const choices = new Set([
      normalizeChoice(profile.editTypeId),
      normalizeChoice(profile.title),
      ...profile.choiceWords.map(normalizeChoice),
    ]);
    for (const existing of this.#profiles.values()) {
      if (existing.editTypeId === ignoreId) continue;
      const existingChoices = [
        existing.editTypeId,
        existing.title,
        ...existing.choiceWords,
      ].map(normalizeChoice);
      if (existingChoices.some((choice) => choices.has(choice))) {
        throw new TypeError("Edit Type title/choice word conflicts with an existing profile.");
      }
    }
  }

  has(editTypeId: string): boolean {
    return this.#profiles.has(editTypeId);
  }

  get(editTypeId: string): EditTypeProfileV1 | null {
    const profile = this.#profiles.get(editTypeId);
    return profile === undefined ? null : structuredClone(profile);
  }
  resolve(choice: string): EditTypeProfileV1 | null {
    const normalized = normalizeChoice(choice);
    for (const profile of this.#profiles.values()) {
      const choices = [
        profile.editTypeId,
        profile.title,
        ...profile.choiceWords,
      ].map(normalizeChoice);
      if (choices.includes(normalized)) return structuredClone(profile);
    }
    return null;
  }

  list(): readonly EditTypeProfileV1[] {
    return [...this.#profiles.values()]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((profile) => structuredClone(profile));
  }

  allocateEpisode(
    episode: PracticeEpisodeV1,
    editTypeId: string,
  ): EditTypeProfileV1 {
    const profile = this.#profiles.get(editTypeId);
    if (profile === undefined) {
      throw new TypeError("Unknown Edit Type: " + editTypeId);
    }
    const retainedEvidence = profile.behaviorEvidence
      .filter((item) => item.sessionId !== episode.sessionId);
    const behaviorEvidence = [
      ...retainedEvidence,
      ...behaviorEvidenceForEpisode(episode),
    ];
    const sessionIds = uniqueStrings([...profile.sessionIds, episode.sessionId]);
    const masteredSessionIds = episode.mastered
      ? uniqueStrings([...profile.masteredSessionIds, episode.sessionId])
      : profile.masteredSessionIds.filter((id) => id !== episode.sessionId);
    const updated: EditTypeProfileV1 = {
      ...profile,
      revision: profile.revision + 1,
      sessionIds,
      masteredSessionIds,
      behaviorEvidence,
    };
    this.#profiles.set(editTypeId, updated);
    return structuredClone(updated);
  }

  knowledge(editTypeId: string): EditTypeKnowledgeSnapshotV1 | null {
    const profile = this.#profiles.get(editTypeId);
    if (profile === undefined) return null;
    const success = profile.behaviorEvidence
      .filter((item) => item.outcome === "MASTERED_SUPPORT")
      .flatMap((item) => item.constructionIds);
    const failed = profile.behaviorEvidence
      .filter((item) => item.outcome !== "MASTERED_SUPPORT")
      .flatMap((item) => item.constructionIds);
    const successfulSemanticPatches = profile.behaviorEvidence
      .filter((item) => item.outcome === "MASTERED_SUPPORT")
      .flatMap((item) => item.semanticPatches);
    const failedSemanticPatches = profile.behaviorEvidence
      .filter((item) => item.outcome !== "MASTERED_SUPPORT")
      .flatMap((item) => item.semanticPatches);
    return {
      editTypeId: profile.editTypeId,
      title: profile.title,
      revision: profile.revision,
      masteredSessionCount: profile.masteredSessionIds.length,
      totalSessionCount: profile.sessionIds.length,
      successfulConstructionIds: uniqueStrings(success),
      failedConstructionIds: uniqueStrings(failed),
      successfulSemanticPatches: structuredClone(successfulSemanticPatches),
      failedSemanticPatches: structuredClone(failedSemanticPatches),
      behaviorEvidence: structuredClone(profile.behaviorEvidence),
    };
  }
}
interface EditTypeRegistryFilePayloadV1 {
  readonly schema: "editflow.edit-type-registry.v1";
  readonly profiles: readonly EditTypeProfileV1[];
}

const readRegistryFile = async (
  filePath: string,
): Promise<EditTypeRegistryFilePayloadV1> => {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<EditTypeRegistryFilePayloadV1>;
    if (parsed.schema !== "editflow.edit-type-registry.v1" || !Array.isArray(parsed.profiles)) {
      throw new TypeError("Edit Type registry file has an unsupported schema.");
    }
    return parsed as EditTypeRegistryFilePayloadV1;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { schema: "editflow.edit-type-registry.v1", profiles: [] };
    }
    throw error;
  }
};

export class EditTypeRegistryFileV1 {
  readonly filePath: string;
  #sequence = 0;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }
  async load(): Promise<EditTypeRegistryV1> {
    const payload = await readRegistryFile(this.filePath);
    const registry = new EditTypeRegistryV1();
    for (const profile of payload.profiles) registry.register(profile);
    return registry;
  }

  async save(registry: EditTypeRegistryV1): Promise<void> {
    const payload: EditTypeRegistryFilePayloadV1 = {
      schema: "editflow.edit-type-registry.v1",
      profiles: registry.list(),
    };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    this.#sequence += 1;
    const temporaryPath = this.filePath + ".tmp-" + String(process.pid) + "-" + String(this.#sequence);
    await writeFile(temporaryPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
    await rename(temporaryPath, this.filePath);
  }
}
