
import { parsePracticeWorkedExampleV1 } from "./chatgpt-editorial-authority.js";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { EditTypeBehaviorEvidenceV1, EditTypeGptLearningSummaryV1, EditTypeKnowledgeScopeV1, EditTypeKnowledgeSnapshotV1, EditTypeProfileV1, GptCapabilityGapV1, GptLearningEventV1, GptOrchestrationModeV1, PracticeMasteryRecordV1 } from "./contracts.js";


const normalizeChoice = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

const uniqueStrings = (values: readonly string[]): readonly string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const emptyGptLearning = (): EditTypeGptLearningSummaryV1 => ({
  workedExamples: [],
  chatgptReviews: [],
  practiceSessionIds: [],
  proCreationSessionIds: [],
  masteredPracticeSessionIds: [],
  masteryRecords: [],
  heldOutCases: [],
  heldOutBenchmarks: [],
  retainedTruthSuiteReports: [],
  eventCount: 0,
  successLessons: [],
  failureAvoidanceLessons: [],
  developmentPatterns: [],
  capabilityGaps: [],
  learnedSkills: [],
});

const normalizedGptLearning = (
  value: EditTypeGptLearningSummaryV1 | undefined,
): EditTypeGptLearningSummaryV1 => value === undefined
  ? emptyGptLearning()
  : {
    workedExamples: structuredClone(value.workedExamples ?? []),
    chatgptReviews: structuredClone(value.chatgptReviews ?? []),
    practiceSessionIds: uniqueStrings(value.practiceSessionIds),
    proCreationSessionIds: uniqueStrings(value.proCreationSessionIds),
    masteredPracticeSessionIds: uniqueStrings(value.masteredPracticeSessionIds),
    masteryRecords: (value.masteryRecords ?? []).map((record) => ({
      ...structuredClone(record),
      effectFamilyIds: uniqueStrings(record.effectFamilyIds ?? []),
      ...(record.subjectIdentityMemories === undefined ? {} : {
        subjectIdentityMemories: record.subjectIdentityMemories.map((memory) => ({
          ...structuredClone(memory),
          sourceMediaSha256: uniqueStrings(memory.sourceMediaSha256 ?? []),
          maskSources: [...new Set(memory.maskSources ?? [])],
          evidenceRefs: uniqueStrings(memory.evidenceRefs ?? []),
        })),
      }),
    })),
    heldOutCases: (value.heldOutCases ?? []).map((item) => ({
      ...structuredClone(item),
      effectFamilyIds: uniqueStrings(item.effectFamilyIds ?? []),
      appliedSkillIds: uniqueStrings(item.appliedSkillIds ?? []),
      verifiedSkillUseIds: uniqueStrings(item.verifiedSkillUseIds ?? []),
      skillUseAttestations: (item.skillUseAttestations ?? []).map((attestation) => ({
        ...structuredClone(attestation),
        matchedConstructionIds: uniqueStrings(attestation.matchedConstructionIds ?? []),
        evidenceRefs: uniqueStrings(attestation.evidenceRefs ?? []),
        reasons: uniqueStrings(attestation.reasons ?? []),
      })),
      reasons: uniqueStrings(item.reasons ?? []),
      evidenceRefs: uniqueStrings(item.evidenceRefs ?? []),
    })),
    heldOutBenchmarks: (value.heldOutBenchmarks ?? []).map((report) => ({
      ...structuredClone(report),
      requiredLearnedSkillIds: uniqueStrings(report.requiredLearnedSkillIds ?? []),
      verifiedLearnedSkillIds: uniqueStrings(report.verifiedLearnedSkillIds ?? []),
      missingLearnedSkillIds: uniqueStrings(report.missingLearnedSkillIds ?? []),
      learnedSkillCoverageVerified: report.learnedSkillCoverageVerified === true,
      heldOutProofVerified: report.heldOutProofVerified === true,
      retainedTruthSuiteAuthorityVerified: report.retainedTruthSuiteAuthorityVerified === true,
      retainedTruthSuiteEvaluatedAt:
        typeof report.retainedTruthSuiteEvaluatedAt === "string"
          ? report.retainedTruthSuiteEvaluatedAt
          : null,
      retainedTruthSuiteEvidenceRefs: uniqueStrings(report.retainedTruthSuiteEvidenceRefs ?? []),
    })),
    retainedTruthSuiteReports: (value.retainedTruthSuiteReports ?? []).map((report) => ({
      ...structuredClone(report),
      reasons: uniqueStrings(report.reasons ?? []),
      evidenceRefs: uniqueStrings(report.evidenceRefs ?? []),
      cases: (report.cases ?? []).map((item) => ({
        ...structuredClone(item),
        reasons: uniqueStrings(item.reasons ?? []),
        evidenceRefs: uniqueStrings(item.evidenceRefs ?? []),
      })),
    })),
    eventCount: Math.max(0, Math.floor(value.eventCount)),
    successLessons: uniqueStrings(value.successLessons),
    failureAvoidanceLessons: uniqueStrings(value.failureAvoidanceLessons),
    developmentPatterns: uniqueStrings(value.developmentPatterns),
    capabilityGaps: (value.capabilityGaps ?? []).map((gap) => ({
      ...structuredClone(gap),
      missingCapabilityIds: uniqueStrings(gap.missingCapabilityIds ?? []),
      evidenceRefs: uniqueStrings(gap.evidenceRefs ?? []),
    })),
    learnedSkills: (value.learnedSkills ?? []).map((skill) => ({
      ...structuredClone(skill),
      capabilityIds: uniqueStrings(skill.capabilityIds ?? []),
      evidenceRefs: uniqueStrings(skill.evidenceRefs ?? []),
      provenSessionIds: uniqueStrings(skill.provenSessionIds ?? []),
      ...(skill.causalModel === undefined ? {} : {
        causalModel: {
          triggerConditions: uniqueStrings(skill.causalModel.triggerConditions ?? []),
          invariants: uniqueStrings(skill.causalModel.invariants ?? []),
          adaptationAxes: uniqueStrings(skill.causalModel.adaptationAxes ?? []),
          failureSignals: uniqueStrings(skill.causalModel.failureSignals ?? []),
          repairStrategies: uniqueStrings(skill.causalModel.repairStrategies ?? []),
          transferCriteria: uniqueStrings(skill.causalModel.transferCriteria ?? []),
        },
      }),
      ...(skill.machineUseSignature === undefined ? {} : {
        machineUseSignature: {
          schema: "editflow.gpt-skill-machine-use-signature.v1" as const,
          invariantRules: (skill.machineUseSignature.invariantRules ?? []).map((rule) => ({
            invariant: rule.invariant.trim(),
            evidence: (rule.evidence ?? []).map((predicate) => ({
              source: predicate.source,
              match: predicate.match,
              value: predicate.value.trim(),
            })),
          })),
        },
      }),
      researchSources: structuredClone(skill.researchSources ?? []),
    })),
    ...(value.lastUpdatedAt === undefined ? {} : { lastUpdatedAt: value.lastUpdatedAt }),
  };

const upsertCapabilityGap = (
  values: readonly GptCapabilityGapV1[],
  gap: GptCapabilityGapV1,
): readonly GptCapabilityGapV1[] => {
  const normalized = structuredClone(gap);
  const index = values.findIndex((value) => value.gapId === gap.gapId);
  if (index < 0) return [...values, normalized];
  return values.map((value, offset) => offset === index ? normalized : value);
};

const upsertMasteryRecord = (
  values: readonly PracticeMasteryRecordV1[],
  record: PracticeMasteryRecordV1,
): readonly PracticeMasteryRecordV1[] => {
  const normalized = structuredClone(record);
  const index = values.findIndex((value) => value.sessionId === record.sessionId);
  if (index < 0) return [...values, normalized];
  return values.map((value, offset) => offset === index ? normalized : value);
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
      gptLearning: emptyGptLearning(),
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
      gptLearning: normalizedGptLearning(profile.gptLearning),
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

  beginGptLearningSession(
    editTypeId: string,
    sessionId: string,
    mode: GptOrchestrationModeV1,
  ): EditTypeProfileV1 {
    const profile = this.#profiles.get(editTypeId);
    if (profile === undefined) throw new TypeError("Unknown Edit Type: " + editTypeId);
    const learning = normalizedGptLearning(profile.gptLearning);
    const nextLearning: EditTypeGptLearningSummaryV1 = mode === "PRACTICE"
      ? {
        ...learning,
        practiceSessionIds: uniqueStrings([...learning.practiceSessionIds, sessionId]),
        lastUpdatedAt: new Date().toISOString(),
      }
      : {
        ...learning,
        proCreationSessionIds: uniqueStrings([...learning.proCreationSessionIds, sessionId]),
        lastUpdatedAt: new Date().toISOString(),
      };
    const updated: EditTypeProfileV1 = {
      ...profile,
      revision: profile.revision + 1,
      sessionIds: mode === "PRACTICE"
        ? uniqueStrings([...profile.sessionIds, sessionId])
        : profile.sessionIds,
      gptLearning: nextLearning,
    };
    this.#profiles.set(editTypeId, updated);
    return structuredClone(updated);
  }

  recordPracticeWorkedExample(editTypeId: string, sessionId: string, input: Record<string, any>): EditTypeProfileV1 {
    const profile = this.#profiles.get(editTypeId);
    if (!profile) throw new TypeError("Unknown Edit Type: " + editTypeId);
    const example = parsePracticeWorkedExampleV1(editTypeId, sessionId, input);
    const learning = normalizedGptLearning(profile.gptLearning);
    const examples = learning.workedExamples ?? [];
    const prior = examples.find(e => e.lessonId === example.lessonId);
    const content = (e: typeof example) => { const { recordedAt: _time, ...rest } = e; return JSON.stringify(rest); };
    if (prior) {
      if (content(prior) !== content(example)) throw new TypeError("Lesson IDs are immutable; create a new lesson and supersede the old one.");
      return structuredClone(profile);
    }
    if (example.supersedesLessonIds.some(id => !examples.some(e => e.lessonId === id))) throw new TypeError("Only retained examples from this preset can be superseded.");
    const updated = { ...profile, revision: profile.revision + 1,
      gptLearning: { ...learning, workedExamples: [...examples, example], lastUpdatedAt: example.recordedAt } };
    this.#profiles.set(editTypeId, updated);
    return structuredClone(updated);
  }

  recordChatgptReview(editTypeId: string, review: NonNullable<EditTypeGptLearningSummaryV1["chatgptReviews"]>[number]): void {
    const profile = this.#profiles.get(editTypeId);
    if (!profile) throw new TypeError("Unknown Edit Type: " + editTypeId);
    const learning = normalizedGptLearning(profile.gptLearning);
    if (!(learning.workedExamples ?? []).some(e => e.sessionId === review.sessionId && e.outcome !== "UNVERIFIED")) throw new TypeError("Save this Practice session's reviewed worked/failed examples before completion.");
    const reviews = learning.chatgptReviews ?? [];
    const prior = reviews.find(r => r.sessionId === review.sessionId && r.renderSha256 === review.renderSha256 && r.verdict === review.verdict);
    if (prior) return;
    this.#profiles.set(editTypeId, { ...profile, revision: profile.revision + 1,
      masteredSessionIds: review.verdict === "PASS" ? uniqueStrings([...profile.masteredSessionIds, review.sessionId]) : profile.masteredSessionIds,
      gptLearning: { ...learning, chatgptReviews: [...reviews, structuredClone(review)],
        masteredPracticeSessionIds: review.verdict === "PASS" ? uniqueStrings([...learning.masteredPracticeSessionIds, review.sessionId]) : learning.masteredPracticeSessionIds,
        lastUpdatedAt: review.reviewedAt } });
  }

  recordGptLearningEvent(event: GptLearningEventV1): EditTypeProfileV1 {
    if (event.stage === "SKILL_COMMIT" || event.learnedSkill) throw new TypeError("Machine skill promotion removed; use directly reviewed worked examples.");
    const profile = this.#profiles.get(event.editTypeId);
    if (profile === undefined) throw new TypeError("Unknown Edit Type: " + event.editTypeId);
    const learning = normalizedGptLearning(profile.gptLearning);
    const successLesson = event.reusableLesson?.trim() ?? "";
    const failureLesson = event.avoidRepeat?.trim()
      || ((event.outcome === "FAILURE" || event.outcome === "REGRESSED")
        ? event.reusableLesson?.trim() ?? ""
        : "");
    const developmentPattern = event.developmentPattern?.trim() ?? "";
    const updated: EditTypeProfileV1 = {
      ...profile,
      revision: profile.revision + 1,
      gptLearning: {
        ...learning,
        eventCount: learning.eventCount + 1,
        successLessons: event.outcome === "SUCCESS" || event.outcome === "IMPROVED"
          ? uniqueStrings([...learning.successLessons, successLesson])
          : learning.successLessons,
        failureAvoidanceLessons: failureLesson.length > 0
          ? uniqueStrings([...learning.failureAvoidanceLessons, failureLesson])
          : learning.failureAvoidanceLessons,
        developmentPatterns: developmentPattern.length > 0
          ? uniqueStrings([...learning.developmentPatterns, developmentPattern])
          : learning.developmentPatterns,
        capabilityGaps: event.capabilityGap === undefined
          ? learning.capabilityGaps
          : upsertCapabilityGap(learning.capabilityGaps, event.capabilityGap),
        learnedSkills: learning.learnedSkills,
        lastUpdatedAt: event.createdAt,
      },
    };
    this.#profiles.set(event.editTypeId, updated);
    return structuredClone(updated);
  }

  #knowledgeSnapshot(
    profile: EditTypeProfileV1,
    behaviorEvidence: readonly EditTypeBehaviorEvidenceV1[],
    gptLearning: EditTypeGptLearningSummaryV1,
    knowledgeScope: EditTypeKnowledgeScopeV1,
  ): EditTypeKnowledgeSnapshotV1 {
    const success = behaviorEvidence
      .filter((item) => item.outcome === "MASTERED_SUPPORT")
      .flatMap((item) => item.constructionIds);
    const failed = behaviorEvidence
      .filter((item) => item.outcome !== "MASTERED_SUPPORT")
      .flatMap((item) => item.constructionIds);
    const successfulSemanticPatches = behaviorEvidence
      .filter((item) => item.outcome === "MASTERED_SUPPORT")
      .flatMap((item) => item.semanticPatches);
    const failedSemanticPatches = behaviorEvidence
      .filter((item) => item.outcome !== "MASTERED_SUPPORT")
      .flatMap((item) => item.semanticPatches);
    const allLearning = normalizedGptLearning(profile.gptLearning);
    return {
      editTypeId: profile.editTypeId,
      title: profile.title,
      revision: profile.revision,
      knowledgeScope,
      masteredSessionCount: knowledgeScope === "TRANSFER_VERIFIED_ONLY"
        ? gptLearning.masteryRecords.length
        : profile.masteredSessionIds.length,
      referenceVerifiedPracticeSessionCount: allLearning.masteryRecords.length,
      transferVerifiedPracticeSessionCount: allLearning.masteryRecords
        .filter((record) => record.scope === "TRANSFER_VERIFIED").length,
      totalSessionCount: profile.sessionIds.length,
      successfulConstructionIds: uniqueStrings(success),
      failedConstructionIds: uniqueStrings(failed),
      successfulSemanticPatches: structuredClone(successfulSemanticPatches),
      failedSemanticPatches: structuredClone(failedSemanticPatches),
      behaviorEvidence: structuredClone(behaviorEvidence),
      gptLearning: structuredClone(gptLearning),
    };
  }

  knowledge(editTypeId: string): EditTypeKnowledgeSnapshotV1 | null {
    const profile = this.#profiles.get(editTypeId);
    if (profile === undefined) return null;
    return this.#knowledgeSnapshot(
      profile,
      profile.behaviorEvidence,
      normalizedGptLearning(profile.gptLearning),
      "ALL_RETAINED",
    );
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
  static readonly mutations = new Map<string, Promise<unknown>>();
  static sequence = 0;
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

  async update<T>(mutate: (registry: EditTypeRegistryV1) => T | Promise<T>): Promise<T> {
    const operation = (EditTypeRegistryFileV1.mutations.get(this.filePath) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const registry = await this.load(); const result = await mutate(registry); await this.save(registry); return result;
    });
    EditTypeRegistryFileV1.mutations.set(this.filePath, operation);
    try { return await operation; }
    finally { if (EditTypeRegistryFileV1.mutations.get(this.filePath) === operation) EditTypeRegistryFileV1.mutations.delete(this.filePath); }
  }

  async save(registry: EditTypeRegistryV1): Promise<void> {
    const payload: EditTypeRegistryFilePayloadV1 = {
      schema: "editflow.edit-type-registry.v1",
      profiles: registry.list(),
    };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = this.filePath + ".tmp-" + String(process.pid) + "-" + String(++EditTypeRegistryFileV1.sequence);
    await writeFile(temporaryPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
    try {
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (process.platform !== "win32" || (code !== "EPERM" && code !== "EACCES")) throw error;
      await copyFile(temporaryPath, this.filePath);
      await unlink(temporaryPath);
    }
  }
}
