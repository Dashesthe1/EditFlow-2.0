import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  EditTypeKnowledgeSnapshotV1,
  GptAssignmentCompletionV1,
  GptAssignmentStatusV1,
  GptCapabilityGapV1,
  GptLearnedSkillV1,
  GptLearningEventV1,
  GptLearningOutcomeV1,
  GptLearningStageV1,
  GptOrchestrationAssignmentV1,
  GptOrchestrationModeV1,
  GptResearchSourceV1,
  PracticeMediaInputV1,
} from "./contracts.js";

interface GptOrchestrationStorePayloadV1 {
  readonly schema: "editflow.gpt-orchestration-store.v1";
  readonly assignments: readonly GptOrchestrationAssignmentV1[];
  readonly events: readonly GptLearningEventV1[];
}

const EMPTY_STORE: GptOrchestrationStorePayloadV1 = {
  schema: "editflow.gpt-orchestration-store.v1",
  assignments: [],
  events: [],
};

const readStore = async (filePath: string): Promise<GptOrchestrationStorePayloadV1> => {
  try {
    const parsed = JSON.parse(
      await readFile(filePath, "utf8"),
    ) as Partial<GptOrchestrationStorePayloadV1>;
    if (parsed.schema !== "editflow.gpt-orchestration-store.v1"
      || !Array.isArray(parsed.assignments)
      || !Array.isArray(parsed.events)) {
      throw new TypeError("GPT orchestration store has an unsupported schema.");
    }
    const payload = parsed as GptOrchestrationStorePayloadV1;
    return {
      ...payload,
      assignments: payload.assignments.map((assignment) => ({
        ...assignment,
        chatMessage: applyCurrentResearchPriority(assignment.chatMessage),
      })),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return structuredClone(EMPTY_STORE);
    }
    throw error;
  }
};

const nonEmpty = (value: string, name: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new TypeError(name + " must not be empty.");
  return trimmed;
};

const unique = (values: readonly string[]): readonly string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))];

export const EDITFLOW_TUTORIAL_DRIVE_ROOT_V1 =
  "https://drive.google.com/drive/folders/1eP2O7OwoCL1uP3OaA4euewUAZFU-VsL7";
export const EDITFLOW_EFFECT_TUTORIALS_FOLDER_V1 =
  "https://drive.google.com/drive/folders/183rOt8jpMghRA3Gtu-ZKxZ2NSkJF5S-G";
export const EDITFLOW_MUSIC_BEAT_TUTORIALS_FOLDER_V1 =
  "https://drive.google.com/drive/folders/19RI8JpZQvmD7R5_4Ub1E_JBodcx7MtGZ";

const LEGACY_RESEARCH_POLICY_LINE =
  "- When existing EditFlow knowledge is insufficient or the reference behavior is not understood, online research is required before accepting a fallback: inspect the live Capability Registry and installed Adobe features/plugins, then use Adobe documentation, professional tutorials, and broader web sources as needed.";

const RESEARCH_PRIORITY_LINES = [
  "- Tutorial Drive is the mandatory first research source whenever EditFlow does not know how to reproduce a visible reference behavior, is stuck on a construction, or discovers a missing fundamental skill.",
  "- Search the Tutorial Drive for the closest matching behavior or technique before consulting any external source. Primary folders: Adobe Effect Tutorials (" + EDITFLOW_EFFECT_TUTORIALS_FOLDER_V1 + ") and Adobe Effect Music + Beat Tutorials (" + EDITFLOW_MUSIC_BEAT_TUTORIALS_FOLDER_V1 + "). Root: " + EDITFLOW_TUTORIAL_DRIVE_ROOT_V1 + ".",
  "- Use the matching tutorial video or videos to learn both WHAT the effect is doing and HOW to construct it in After Effects. Extract transferable construction logic and adaptation rules rather than copying literal values.",
  "- If no sufficiently relevant Tutorial Drive match exists, record the Tutorial Drive search/query and no-match result in RESEARCH provenance before escalating.",
  "- Second priority is official Adobe documentation/resources and the installed Adobe feature/plugin surface.",
  "- Third priority is external professional tutorials and plugin/vendor documentation; broader web/internet research is last.",
] as const;

const applyCurrentResearchPriority = (message: string): string => {
  if (message.includes(RESEARCH_PRIORITY_LINES[0])) return message;
  if (!message.includes(LEGACY_RESEARCH_POLICY_LINE)) return message;
  return message.replace(
    LEGACY_RESEARCH_POLICY_LINE,
    RESEARCH_PRIORITY_LINES.join("\n"),
  );
};

const isTutorialDriveResearchSource = (source: GptResearchSourceV1 | undefined): boolean =>
  source?.kind === "TUTORIAL_DRIVE"
  && typeof source.uri === "string"
  && source.uri.trim().length > 0;

const mediaLine = (input: PracticeMediaInputV1): string =>
  "- " + input.mediaKind + " " + input.mediaId + ": " + input.uri;

export const buildGptOrchestrationChatMessageV1 = (input: {
  readonly sessionId: string;
  readonly mode: GptOrchestrationModeV1;
  readonly editTypeId: string;
  readonly finish: PracticeMediaInputV1 | null;
  readonly start: readonly PracticeMediaInputV1[];
  readonly artifactDir: string;
  readonly knowledge: EditTypeKnowledgeSnapshotV1 | null;
}): string => {
  const learned = input.knowledge;
  const successLessons = learned?.gptLearning.successLessons ?? [];
  const failureLessons = learned?.gptLearning.failureAvoidanceLessons ?? [];
  const patterns = learned?.gptLearning.developmentPatterns ?? [];
  const learnedSkills = learned?.gptLearning.learnedSkills ?? [];
  const openGaps = (learned?.gptLearning.capabilityGaps ?? [])
    .filter((gap) => gap.status !== "RESOLVED");
  const skillLines = learnedSkills.slice(-12).map((skill) =>
    skill.skillId + " [" + skill.maturity + "] " + skill.title + ": " + skill.constructionPattern
  );
  const gapLines = openGaps.slice(-12).map((gap) =>
    gap.gapId + " [" + gap.kind + "/" + gap.status + "] " + gap.requestedBehavior
  );
  const modeInstruction = input.mode === "PRACTICE"
    ? [
      "This is supervised Practice. The Finish video is the answer key.",
      "Study the Finish, find the matching raw material, and reconstruct it from scratch in After Effects.",
      "Continue render -> compare -> diagnose -> correct cycles until the reference is replicated to the accepted proof gate.",
      "Record the full learning trajectory, including failed hypotheses and why they failed, under the selected Edit Type.",
    ]
    : [
      "This is Pro Creation. There is no Finish answer key.",
      "Create a new professional edit from the Start media by applying the selected Edit Type's successful Practice development patterns.",
      "Use successful lessons as guidance and actively avoid failures retained from Practice.",
      "The result must be original to the supplied footage while following the learned professional visual language.",
    ];
  return [
    "EDITFLOW 2.0 GPT ORCHESTRATION ASSIGNMENT",
    "Session: " + input.sessionId,
    "Mode: " + input.mode,
    "Edit Type: " + input.editTypeId,
    "",
    ...modeInstruction,
    "",
    "Control architecture:",
    "- GPT is the orchestrator, creative reasoner, and learner.",
    "- EditFlow Brain is supporting editing knowledge and capability intelligence, not a replacement for GPT reasoning.",
    "- EditFlow visual analysis is GPT's eyes.",
    "- EditFlow's typed After Effects controls are GPT's primary editing hands.",
    "- Desktop Commander is the system-level hand for files, processes, recovery, and environment operations.",
    "- All editorial cutting, retiming, remodeling, effects, transitions, compositing, and final construction must exist in After Effects.",
    "- Never replace an unfamiliar reference behavior with a weaker known effect. Reverse-engineer it and synthesize a construction when capabilities permit.",
    "- If a fundamental skill is missing, distinguish a RECIPE_SKILL gap from an EXECUTION_CAPABILITY gap instead of degrading the reference.",
    ...RESEARCH_PRIORITY_LINES,
    "- Preserve research provenance (source, URI when available, and the specific technique learned) in the Practice trace. Research is for discovery; rendered/readback evidence is still required for proof.",
    "- Treat a short replay of recently shown source frames backward as TEMPORAL_REWIND / REVERSE_PLAYBACK. Do not confuse it with animation-parameter recovery, transition recoil, or a failed construction. Measure the source-time trajectory, rewind span, speed, and exit behavior, then reproduce the actual backward replay.",
    "- If existing primitives can express the behavior, synthesize and prove a new reusable skill. If an execution capability is genuinely absent, implement/prove the missing EditFlow route when development access permits; otherwise mark the exact gap BLOCKED.",
    "- Research is hypothesis evidence, not proof. Resume the edit only after AE construction/readback/render evidence supports the new skill or capability.",
    "- Check cancellation state between meaningful operations and stop safely when cancellation is requested.",
    "",
    "Learning trace contract:",
    "Normal loop: OBSERVATION -> INTERPRETATION -> HYPOTHESIS -> PLAN -> AE_ACTION -> RENDER -> COMPARISON -> DIAGNOSIS -> CORRECTION -> RESULT -> LESSON.",
    "When a missing fundamental skill/capability is discovered, insert CAPABILITY_GAP -> RESEARCH -> CAPABILITY_IMPLEMENTATION -> CAPABILITY_PROOF -> SKILL_COMMIT, then return to the normal AE/render/compare loop.",
    "A lesson or committed skill should capture transferable reasons and adaptation rules, not only literal parameter values.",
    "",
    "Start media:",
    ...input.start.map(mediaLine),
    ...(input.finish === null ? [] : ["", "Finish reference:", mediaLine(input.finish)]),
    "",
    "Artifact directory: " + input.artifactDir,
    "",
    "Retained Edit Type knowledge:",
    "Successful lessons: " + (successLessons.length === 0 ? "(none yet)" : successLessons.join(" | ")),
    "Failures to avoid: " + (failureLessons.length === 0 ? "(none yet)" : failureLessons.join(" | ")),
    "Development patterns: " + (patterns.length === 0 ? "(none yet)" : patterns.join(" | ")),
    "Learned skills: " + (skillLines.length === 0 ? "(none yet)" : skillLines.join(" | ")),
    "Open/blocked capability gaps: " + (gapLines.length === 0 ? "(none)" : gapLines.join(" | ")),
  ].join("\n");
};

export class GptOrchestrationStoreV1 {
  readonly filePath: string;
  #tail: Promise<void> = Promise.resolve();
  #sequence = 0;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  async #write(payload: GptOrchestrationStorePayloadV1): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    this.#sequence += 1;
    const temporary = this.filePath + ".tmp-" + String(process.pid) + "-" + String(this.#sequence);
    await writeFile(temporary, JSON.stringify(payload, null, 2) + "\n", "utf8");
    await rename(temporary, this.filePath);
  }

  async #mutate<T>(
    operation: (payload: GptOrchestrationStorePayloadV1) =>
      Promise<readonly [GptOrchestrationStorePayloadV1, T]> |
      readonly [GptOrchestrationStorePayloadV1, T],
  ): Promise<T> {
    let output!: T;
    const pending = this.#tail.then(async () => {
      const current = await readStore(this.filePath);
      const [next, value] = await operation(current);
      await this.#write(next);
      output = value;
    });
    this.#tail = pending.catch(() => undefined);
    await pending;
    return output;
  }

  async createAssignment(input: {
    readonly sessionId: string;
    readonly mode: GptOrchestrationModeV1;
    readonly editTypeId: string;
    readonly finish: PracticeMediaInputV1 | null;
    readonly start: readonly PracticeMediaInputV1[];
    readonly artifactDir: string;
    readonly knowledge: EditTypeKnowledgeSnapshotV1 | null;
  }): Promise<GptOrchestrationAssignmentV1> {
    const sessionId = nonEmpty(input.sessionId, "sessionId");
    const editTypeId = nonEmpty(input.editTypeId, "editTypeId");
    if (input.start.length === 0) throw new TypeError("GPT assignment requires Start media.");
    if (input.mode === "PRACTICE" && input.finish === null) {
      throw new TypeError("GPT Practice assignment requires a Finish reference.");
    }
    const assignmentId = "gpt-assignment:" + randomUUID();
    const artifactDir = path.resolve(input.artifactDir);
    const assignment: GptOrchestrationAssignmentV1 = {
      schema: "editflow.gpt-orchestration-assignment.v1",
      assignmentId,
      sessionId,
      mode: input.mode,
      editTypeId,
      status: "PENDING",
      finish: input.finish === null ? null : structuredClone(input.finish),
      start: structuredClone(input.start),
      artifactDir,
      chatMessage: buildGptOrchestrationChatMessageV1({
        sessionId,
        mode: input.mode,
        editTypeId,
        finish: input.finish,
        start: input.start,
        artifactDir,
        knowledge: input.knowledge,
      }),
      createdAt: new Date().toISOString(),
      claimedAt: null,
      claimedBy: null,
      startedAt: null,
      completedAt: null,
      cancelRequestedAt: null,
      finalRenderRef: null,
      finalSummary: null,
      error: null,
    };
    return await this.#mutate((payload) => {
      if (payload.assignments.some((item) => item.sessionId === sessionId)) {
        throw new TypeError("GPT assignment already exists for session " + sessionId + ".");
      }
      return [{
        ...payload,
        assignments: [...payload.assignments, assignment],
      }, structuredClone(assignment)] as const;
    });
  }

  async getAssignment(assignmentId: string): Promise<GptOrchestrationAssignmentV1 | null> {
    const payload = await readStore(this.filePath);
    const assignment = payload.assignments.find((item) => item.assignmentId === assignmentId);
    return assignment === undefined ? null : structuredClone(assignment);
  }

  async getBySession(sessionId: string): Promise<GptOrchestrationAssignmentV1 | null> {
    const payload = await readStore(this.filePath);
    const assignment = payload.assignments.find((item) => item.sessionId === sessionId);
    return assignment === undefined ? null : structuredClone(assignment);
  }

  async listAssignments(input: {
    readonly statuses?: readonly GptAssignmentStatusV1[];
    readonly mode?: GptOrchestrationModeV1;
  } = {}): Promise<readonly GptOrchestrationAssignmentV1[]> {
    const payload = await readStore(this.filePath);
    const statusSet = input.statuses === undefined ? null : new Set(input.statuses);
    return payload.assignments
      .filter((item) => statusSet === null || statusSet.has(item.status))
      .filter((item) => input.mode === undefined || item.mode === input.mode)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((item) => structuredClone(item));
  }

  async claim(assignmentId: string, claimedBy: string): Promise<GptOrchestrationAssignmentV1> {
    const controller = nonEmpty(claimedBy, "claimedBy");
    return await this.#updateAssignment(assignmentId, (assignment) => {
      if (assignment.status !== "PENDING") {
        throw new TypeError("GPT assignment is not pending: " + assignment.status);
      }
      const now = new Date().toISOString();
      return {
        ...assignment,
        status: "RUNNING",
        claimedAt: now,
        claimedBy: controller,
        startedAt: now,
      };
    });
  }

  async requestCancel(assignmentId: string): Promise<GptOrchestrationAssignmentV1> {
    return await this.#updateAssignment(assignmentId, (assignment) => {
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(assignment.status)) return assignment;
      const now = new Date().toISOString();
      if (assignment.status === "PENDING") {
        return {
          ...assignment,
          status: "CANCELLED",
          cancelRequestedAt: now,
          completedAt: now,
          finalSummary: "Cancelled before GPT claimed the assignment.",
        };
      }
      return {
        ...assignment,
        status: "CANCEL_REQUESTED",
        cancelRequestedAt: assignment.cancelRequestedAt ?? now,
      };
    });
  }

  async acknowledgeCancelled(
    assignmentId: string,
    summary = "GPT stopped safely after cancellation was requested.",
  ): Promise<GptOrchestrationAssignmentV1> {
    return await this.#updateAssignment(assignmentId, (assignment) => {
      if (assignment.status !== "CANCEL_REQUESTED" && assignment.status !== "CANCELLED") {
        throw new TypeError("GPT assignment has no active cancellation request.");
      }
      return {
        ...assignment,
        status: "CANCELLED",
        completedAt: assignment.completedAt ?? new Date().toISOString(),
        finalSummary: summary.trim() || "Cancelled.",
      };
    });
  }

  async appendEvent(input: {
    readonly assignmentId: string;
    readonly stage: GptLearningStageV1;
    readonly outcome?: GptLearningOutcomeV1;
    readonly attempt?: number;
    readonly summary: string;
    readonly detail?: string;
    readonly developmentPattern?: string;
    readonly reusableLesson?: string;
    readonly avoidRepeat?: string;
    readonly capabilityGap?: GptCapabilityGapV1;
    readonly researchSources?: readonly GptResearchSourceV1[];
    readonly learnedSkill?: GptLearnedSkillV1;
    readonly evidenceRefs?: readonly string[];
  }): Promise<GptLearningEventV1> {
    const summary = nonEmpty(input.summary, "summary");
    return await this.#mutate((payload) => {
      const assignment = payload.assignments.find((item) => item.assignmentId === input.assignmentId);
      if (assignment === undefined) throw new TypeError("Unknown GPT assignment: " + input.assignmentId);
      if (!["RUNNING", "CANCEL_REQUESTED"].includes(assignment.status)) {
        throw new TypeError("GPT learning events require a running assignment.");
      }
      const sessionEvents = payload.events.filter((event) => event.sessionId === assignment.sessionId);
      if (input.stage === "CAPABILITY_GAP" && input.capabilityGap === undefined) {
        throw new TypeError("CAPABILITY_GAP requires capabilityGap.");
      }
      if (input.stage === "RESEARCH") {
        if (input.researchSources === undefined || input.researchSources.length === 0) {
          throw new TypeError("RESEARCH requires researchSources.");
        }
        if (!isTutorialDriveResearchSource(input.researchSources[0])) {
          throw new TypeError(
            "RESEARCH must begin with Tutorial Drive provenance with a URI before Adobe or broader web sources.",
          );
        }
      }
      if (input.stage === "CAPABILITY_PROOF") {
        if (unique(input.evidenceRefs ?? []).length === 0) {
          throw new TypeError("CAPABILITY_PROOF requires retained evidenceRefs.");
        }
        const priorResearch = sessionEvents.filter((event) => event.stage === "RESEARCH")
          .flatMap((event) => event.researchSources ?? []);
        const priorImplementation = sessionEvents.some((event) =>
          event.stage === "CAPABILITY_IMPLEMENTATION" && event.outcome !== "FAILURE");
        if (!priorResearch.some(isTutorialDriveResearchSource)) {
          throw new TypeError("CAPABILITY_PROOF requires prior Tutorial Drive research provenance.");
        }
        if (!priorImplementation) {
          throw new TypeError("CAPABILITY_PROOF requires a prior CAPABILITY_IMPLEMENTATION event.");
        }
      }
      if (input.stage === "SKILL_COMMIT") {
        const gap = input.capabilityGap;
        const skill = input.learnedSkill;
        if (gap === undefined || skill === undefined) {
          throw new TypeError("SKILL_COMMIT requires learnedSkill and resolved capabilityGap.");
        }
        if (gap.status !== "RESOLVED" || gap.resolutionSkillId !== skill.skillId) {
          throw new TypeError("SKILL_COMMIT must resolve the gap with the committed skill.");
        }
        if (!["AE_PROVEN", "TRANSFER_VERIFIED"].includes(skill.maturity)) {
          throw new TypeError("SKILL_COMMIT requires AE_PROVEN or TRANSFER_VERIFIED maturity.");
        }
        const gapWasOpened = sessionEvents.some((event) =>
          event.stage === "CAPABILITY_GAP" && event.capabilityGap?.gapId === gap.gapId);
        const research = sessionEvents.filter((event) => event.stage === "RESEARCH")
          .flatMap((event) => event.researchSources ?? []);
        const proofSucceeded = sessionEvents.some((event) =>
          event.stage === "CAPABILITY_PROOF"
          && event.outcome === "SUCCESS"
          && event.evidenceRefs.length > 0);
        if (!gapWasOpened) throw new TypeError("SKILL_COMMIT requires a prior CAPABILITY_GAP event.");
        if (!research.some(isTutorialDriveResearchSource)) {
          throw new TypeError("SKILL_COMMIT requires prior Tutorial Drive research provenance.");
        }
        if (!proofSucceeded) {
          throw new TypeError("SKILL_COMMIT requires a successful prior CAPABILITY_PROOF event.");
        }
      }
      const event: GptLearningEventV1 = {
        schema: "editflow.gpt-learning-event.v1",
        eventId: "gpt-learning-event:" + randomUUID(),
        sessionId: assignment.sessionId,
        editTypeId: assignment.editTypeId,
        mode: assignment.mode,
        ...(input.attempt === undefined ? {} : { attempt: Math.max(1, Math.floor(input.attempt)) }),
        stage: input.stage,
        outcome: input.outcome ?? "NEUTRAL",
        summary,
        ...(input.detail === undefined ? {} : { detail: input.detail.trim() }),
        ...(input.developmentPattern === undefined
          ? {}
          : { developmentPattern: input.developmentPattern.trim() }),
        ...(input.reusableLesson === undefined
          ? {}
          : { reusableLesson: input.reusableLesson.trim() }),
        ...(input.avoidRepeat === undefined ? {} : { avoidRepeat: input.avoidRepeat.trim() }),
        ...(input.capabilityGap === undefined
          ? {}
          : { capabilityGap: structuredClone(input.capabilityGap) }),
        ...(input.researchSources === undefined
          ? {}
          : { researchSources: structuredClone(input.researchSources) }),
        ...(input.learnedSkill === undefined
          ? {}
          : { learnedSkill: structuredClone(input.learnedSkill) }),
        evidenceRefs: unique(input.evidenceRefs ?? []),
        createdAt: new Date().toISOString(),
      };
      return [{
        ...payload,
        events: [...payload.events, event],
      }, structuredClone(event)] as const;
    });
  }

  async eventsForSession(sessionId: string): Promise<readonly GptLearningEventV1[]> {
    const payload = await readStore(this.filePath);
    return payload.events
      .filter((event) => event.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((event) => structuredClone(event));
  }

  async complete(
    assignmentId: string,
    completion: GptAssignmentCompletionV1,
  ): Promise<GptOrchestrationAssignmentV1> {
    const summary = nonEmpty(completion.finalSummary, "finalSummary");
    return await this.#updateAssignment(assignmentId, (assignment) => {
      if (!["RUNNING", "CANCEL_REQUESTED"].includes(assignment.status)) {
        throw new TypeError("GPT assignment is not running.");
      }
      if (assignment.status === "CANCEL_REQUESTED") {
        return {
          ...assignment,
          status: "CANCELLED",
          completedAt: new Date().toISOString(),
          finalSummary: summary,
        };
      }
      return {
        ...assignment,
        status: completion.success ? "COMPLETED" : "FAILED",
        completedAt: new Date().toISOString(),
        finalRenderRef: completion.finalRenderRef?.trim() || null,
        finalSummary: summary,
        error: completion.success ? null : summary,
      };
    });
  }

  async fail(assignmentId: string, error: string): Promise<GptOrchestrationAssignmentV1> {
    const message = nonEmpty(error, "error");
    return await this.#updateAssignment(assignmentId, (assignment) => ({
      ...assignment,
      status: assignment.status === "CANCEL_REQUESTED" ? "CANCELLED" : "FAILED",
      completedAt: new Date().toISOString(),
      error: assignment.status === "CANCEL_REQUESTED" ? null : message,
      finalSummary: message,
    }));
  }

  async #updateAssignment(
    assignmentId: string,
    update: (assignment: GptOrchestrationAssignmentV1) => GptOrchestrationAssignmentV1,
  ): Promise<GptOrchestrationAssignmentV1> {
    return await this.#mutate((payload) => {
      const index = payload.assignments.findIndex((item) => item.assignmentId === assignmentId);
      if (index < 0) throw new TypeError("Unknown GPT assignment: " + assignmentId);
      const next = [...payload.assignments];
      const updated = update(next[index]!);
      next[index] = updated;
      return [{ ...payload, assignments: next }, structuredClone(updated)] as const;
    });
  }
}
