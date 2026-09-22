import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  EditTypeKnowledgeSnapshotV1,
  GptAssignmentCompletionV1,
  GptAssignmentStatusV1,
  GptLearningEventV1,
  GptLearningOutcomeV1,
  GptLearningStageV1,
  GptOrchestrationAssignmentV1,
  GptOrchestrationModeV1,
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
    return parsed as GptOrchestrationStorePayloadV1;
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
    "- Check cancellation state between meaningful operations and stop safely when cancellation is requested.",
    "",
    "Learning trace contract:",
    "Record meaningful OBSERVATION -> INTERPRETATION -> HYPOTHESIS -> PLAN -> AE_ACTION -> RENDER -> COMPARISON -> DIAGNOSIS -> CORRECTION -> RESULT -> LESSON events.",
    "A lesson should capture transferable reasons, not only literal parameter values.",
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
    readonly evidenceRefs?: readonly string[];
  }): Promise<GptLearningEventV1> {
    const summary = nonEmpty(input.summary, "summary");
    return await this.#mutate((payload) => {
      const assignment = payload.assignments.find((item) => item.assignmentId === input.assignmentId);
      if (assignment === undefined) throw new TypeError("Unknown GPT assignment: " + input.assignmentId);
      if (!["RUNNING", "CANCEL_REQUESTED"].includes(assignment.status)) {
        throw new TypeError("GPT learning events require a running assignment.");
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
