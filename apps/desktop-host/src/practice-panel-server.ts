import { randomUUID, timingSafeEqual } from "node:crypto";
import { stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import {
  EditTypeRegistryFileV1,
  GptOrchestrationStoreV1,
  ProCreationPreparationEngineV1,
  type GptCapabilityGapV1,
  type GptLearnedSkillV1,
  type GptLearningOutcomeV1,
  type GptLearningStageV1,
  type GptOrchestrationAssignmentV1,
  type GptOrchestrationModeV1,
  type GptResearchSourceV1,
  type PracticeLearningAllocationResultV1,
  type PracticeMediaInputV1,
  type PracticeSessionResultV1,
  type ProCreationPreparationResultV1,
} from "../../../packages/practice-homework/src/index.js";
import {
  AeCepAdapterClientV11,
  AeFilesystemPolicyV11,
} from "../../../packages/adapters/ae-cep/src/v1_1.js";
import { LoopbackCepBroker } from "./loopback-cep.js";
import { CurrentAeTransactionRuntimeV1 } from "./current-ae-transaction-runtime.js";
import { LocalFastRuntimeV1 } from "./local-fast-runtime.js";

export interface PracticePanelServerConfigV1 {
  readonly port: number;
  readonly token: string;
  readonly repositoryRoot: string;
  readonly artifactDir: string;
  readonly learningMemoryFilePath: string;
  readonly editTypeRegistryFilePath: string;
  readonly gptOrchestrationFilePath?: string;
  readonly broker: LoopbackCepBroker;
  readonly ffmpegPath?: string;
  readonly renderTimeoutMs?: number;
}

export type PracticePanelRunStateV1 =
  | "WAITING_FOR_GPT"
  | "RUNNING"
  | "CANCEL_REQUESTED"
  | "CANCELLED"
  | "COMPLETED"
  | "FAILED";

export interface PracticePanelRunSnapshotV1 {
  readonly sessionId: string;
  readonly assignmentId: string;
  readonly mode: GptOrchestrationModeV1;
  readonly editTypeId: string;
  readonly state: PracticePanelRunStateV1;
  readonly stage: GptLearningStageV1 | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly finishPath: string | null;
  readonly videoPaths: readonly string[];
  readonly audioPaths: readonly string[];
  readonly result: PracticeSessionResultV1 | null;
  readonly allocation: PracticeLearningAllocationResultV1 | null;
  readonly finalRenderRef: string | null;
  readonly finalSummary: string | null;
  readonly error: string | null;
}

interface PracticeRunBody {
  readonly editTypeId: string;
  readonly editTypeTitle?: string;
  readonly finishPath: string;
  readonly videoPaths: readonly string[];
  readonly audioPaths?: readonly string[];
  readonly minimumSimilarity?: number;
  readonly stretchSimilarity?: number;
  readonly maxAttempts?: number;
  readonly exactSceneConfidence?: number;
  readonly minimumAudioConfidence?: number;
}

interface ProCreationBody {
  readonly editTypeId: string;
  readonly videoPaths: readonly string[];
  readonly audioPaths?: readonly string[];
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const jsonResponse = (res: ServerResponse, status: number, value: unknown): void => {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
};

const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 1_000_000) throw new HttpError(413, "REQUEST_BODY_TOO_LARGE");
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const parsed = text.length === 0 ? {} : JSON.parse(text) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "JSON object body required.");
  }
  return parsed as Record<string, unknown>;
};

const secureTokenEqual = (expected: string, actual: string): boolean => {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(actual, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
};

const header = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? "" : value ?? "";

const requiredString = (body: Record<string, unknown>, name: string): string => {
  const value = body[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, name + " is required.");
  }
  return value.trim();
};

const optionalString = (body: Record<string, unknown>, name: string): string | undefined => {
  const value = body[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, name + " must be a non-empty string.");
  }
  return value.trim();
};

const stringArray = (
  body: Record<string, unknown>,
  name: string,
  required: boolean,
): readonly string[] => {
  const value = body[name];
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new HttpError(400, name + " must be an array of non-empty paths.");
  }
  if (required && value.length === 0) {
    throw new HttpError(400, name + " must contain at least one path.");
  }
  return value.map((item) => item.trim());
};

const optionalNumber = (
  body: Record<string, unknown>,
  name: string,
  minimum: number,
  maximum: number,
  integer = false,
): number | undefined => {
  const value = body[name];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)
    || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    throw new HttpError(400, name + " is outside its accepted range.");
  }
  return value;
};

const optionalRecord = (
  body: Record<string, unknown>,
  name: string,
): Record<string, unknown> | undefined => {
  const value = body[name];
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, name + " must be a JSON object.");
  }
  return value as Record<string, unknown>;
};

const requiredEnum = <T extends string>(
  body: Record<string, unknown>,
  name: string,
  allowed: readonly T[],
): T => {
  const value = requiredString(body, name);
  if (!allowed.includes(value as T)) {
    throw new HttpError(400, name + " has an unsupported value.");
  }
  return value as T;
};

const optionalResearchSources = (
  body: Record<string, unknown>,
  name: string,
): readonly GptResearchSourceV1[] | undefined => {
  const value = body[name];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new HttpError(400, name + " must be an array.");
  return value.map((source, index) => {
    if (source === null || typeof source !== "object" || Array.isArray(source)) {
      throw new HttpError(400, name + "[" + String(index) + "] must be an object.");
    }
    const record = source as Record<string, unknown>;
    return {
      sourceId: requiredString(record, "sourceId"),
      kind: requiredEnum(record, "kind", [
        "ADOBE_DOCUMENTATION", "INSTALLED_ADOBE_FEATURE", "PLUGIN_DOCUMENTATION",
        "PROFESSIONAL_TUTORIAL", "WEB", "INTERNAL_EVIDENCE",
      ] as const),
      title: requiredString(record, "title"),
      ...(optionalString(record, "uri") === undefined ? {} : { uri: optionalString(record, "uri")! }),
      ...(optionalString(record, "notes") === undefined ? {} : { notes: optionalString(record, "notes")! }),
    };
  });
};

const optionalCapabilityGap = (
  body: Record<string, unknown>,
  name: string,
): GptCapabilityGapV1 | undefined => {
  const record = optionalRecord(body, name);
  if (record === undefined) return undefined;
  const kind = requiredEnum(record, "kind", ["RECIPE_SKILL", "EXECUTION_CAPABILITY"] as const);
  const missingCapabilityIds = stringArray(record, "missingCapabilityIds", false);
  if (kind === "EXECUTION_CAPABILITY" && missingCapabilityIds.length === 0) {
    throw new HttpError(400, name + ".missingCapabilityIds is required for EXECUTION_CAPABILITY.");
  }
  const resolutionSkillId = optionalString(record, "resolutionSkillId");
  return {
    gapId: requiredString(record, "gapId"),
    kind,
    requestedBehavior: requiredString(record, "requestedBehavior"),
    missingCapabilityIds,
    status: requiredEnum(record, "status", ["OPEN", "RESOLVED", "BLOCKED"] as const),
    ...(resolutionSkillId === undefined ? {} : { resolutionSkillId }),
    evidenceRefs: stringArray(record, "evidenceRefs", false),
  };
};

const optionalLearnedSkill = (
  body: Record<string, unknown>,
  name: string,
): GptLearnedSkillV1 | undefined => {
  const record = optionalRecord(body, name);
  if (record === undefined) return undefined;
  const adaptationNotes = optionalString(record, "adaptationNotes");
  return {
    skillId: requiredString(record, "skillId"),
    title: requiredString(record, "title"),
    requestedBehavior: requiredString(record, "requestedBehavior"),
    maturity: requiredEnum(record, "maturity", [
      "HYPOTHESIS", "RECONSTRUCTED", "AE_PROVEN", "TRANSFER_VERIFIED",
    ] as const),
    constructionPattern: requiredString(record, "constructionPattern"),
    capabilityIds: stringArray(record, "capabilityIds", false),
    ...(adaptationNotes === undefined ? {} : { adaptationNotes }),
    researchSources: optionalResearchSources(record, "researchSources") ?? [],
    evidenceRefs: stringArray(record, "evidenceRefs", false),
    learnedAt: optionalString(record, "learnedAt") ?? new Date().toISOString(),
  };
};

const ensureFile = async (filePath: string, label: string): Promise<string> => {
  const resolved = path.resolve(filePath);
  let metadata;
  try {
    metadata = await stat(resolved);
  } catch {
    throw new HttpError(400, label + " does not exist: " + resolved);
  }
  if (!metadata.isFile() || metadata.size <= 0) {
    throw new HttpError(400, label + " must be a non-empty file: " + resolved);
  }
  return resolved;
};

const mediaId = (kind: "video" | "audio" | "finish", filePath: string, index: number): string => {
  const stem = path.basename(filePath, path.extname(filePath))
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "media";
  return kind + ":" + String(index + 1) + ":" + stem;
};

const mediaInputs = (
  videoPaths: readonly string[],
  audioPaths: readonly string[],
): readonly PracticeMediaInputV1[] => [
  ...videoPaths.map((uri, index) => ({
    mediaId: mediaId("video", uri, index),
    role: "START_SOURCE" as const,
    mediaKind: "VIDEO" as const,
    uri,
  })),
  ...audioPaths.map((uri, index) => ({
    mediaId: mediaId("audio", uri, index),
    role: "START_SOURCE" as const,
    mediaKind: "AUDIO" as const,
    uri,
  })),
];

const snapshot = (run: PracticePanelRunSnapshotV1): PracticePanelRunSnapshotV1 =>
  structuredClone(run);

export class PracticePanelServerV1 {
  readonly config: PracticePanelServerConfigV1;
  #server: Server | null = null;
  #port = 0;
  #activeRunId: string | null = null;
  readonly #runs = new Map<string, PracticePanelRunSnapshotV1>();
  readonly #gptStore: GptOrchestrationStoreV1;
  readonly #transactionRuntime: CurrentAeTransactionRuntimeV1;
  #fastRuntime: LocalFastRuntimeV1 | null = null;
  #fastRuntimePromise: Promise<LocalFastRuntimeV1> | null = null;
  #controlRequestCounter = 0;

  constructor(config: PracticePanelServerConfigV1) {
    if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
      throw new TypeError("Practice panel port must be an integer from 0 through 65535.");
    }
    if (config.token.length < 32) {
      throw new TypeError("Practice panel token must contain at least 32 characters.");
    }
    this.config = config;
    this.#gptStore = new GptOrchestrationStoreV1(
      config.gptOrchestrationFilePath
        ?? path.join(config.artifactDir, "state", "gpt-orchestration.json"),
    );
    this.#transactionRuntime = new CurrentAeTransactionRuntimeV1(
      config.broker,
      "practice-gpt-controller",
      64,
      null,
      96,
      new AeFilesystemPolicyV11([
        process.env.USERPROFILE ?? config.repositoryRoot,
      ]),
    );
  }

  get port(): number { return this.#port; }
  get isStarted(): boolean { return this.#server !== null; }
  get activeRunId(): string | null { return this.#activeRunId; }

  async start(): Promise<number> {
    if (this.#server !== null) return this.#port;
    const server = createServer((req, res) => { void this.#handle(req, res); });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.config.port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address() as AddressInfo | null;
    if (address === null || address.address !== "127.0.0.1") {
      server.close();
      throw new Error("Practice panel server failed to bind exclusively to 127.0.0.1.");
    }
    this.#server = server;
    this.#port = address.port;
    return this.#port;
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    if (server !== null) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    }
    this.#port = 0;
  }

  async #ensureFastRuntime(): Promise<LocalFastRuntimeV1> {
    if (this.#fastRuntime !== null) return this.#fastRuntime;
    if (this.config.broker.panelSession === null) {
      throw new HttpError(409, "After Effects CEP panel is not connected.");
    }
    if (this.#fastRuntimePromise === null) {
      const policy = new AeFilesystemPolicyV11([
        process.env.USERPROFILE ?? this.config.repositoryRoot,
      ]);
      const client = new AeCepAdapterClientV11(
        this.config.broker,
        () => "practice-gpt-control-" + String(++this.#controlRequestCounter),
        policy,
      );
      this.#fastRuntimePromise = LocalFastRuntimeV1.create(client, {
        projectId: "practice-gpt-controller",
        maxBatchActions: 64,
        totalBudgetMs: 30_000,
        actionBudgetMs: 1_000,
        leaseTtlMs: 120_000,
      }).then((runtime) => {
        this.#fastRuntime = runtime;
        return runtime;
      }).catch((error) => {
        this.#fastRuntimePromise = null;
        throw error;
      });
    }
    return await this.#fastRuntimePromise;
  }

  #setHeaders(res: ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-EditFlow-Token");
    res.setHeader("Cache-Control", "no-store");
  }

  #authorized(req: IncomingMessage): boolean {
    const provided = header(req.headers["x-editflow-token"]);
    return provided.length > 0 && secureTokenEqual(this.config.token, provided);
  }

  async #editTypes(): Promise<EditTypeRegistryFileV1> {
    return new EditTypeRegistryFileV1(this.config.editTypeRegistryFilePath);
  }

  async #parsePractice(body: Record<string, unknown>): Promise<PracticeRunBody> {
    const videoPaths = await Promise.all(
      stringArray(body, "videoPaths", true)
        .map((value) => ensureFile(value, "Start video")),
    );
    const audioPaths = await Promise.all(
      stringArray(body, "audioPaths", false)
        .map((value) => ensureFile(value, "Start audio")),
    );
    const editTypeTitle = optionalString(body, "editTypeTitle");
    const minimumSimilarity = optionalNumber(body, "minimumSimilarity", 0, 1);
    const stretchSimilarity = optionalNumber(body, "stretchSimilarity", 0, 1);
    const maxAttempts = optionalNumber(body, "maxAttempts", 1, 20, true);
    const exactSceneConfidence = optionalNumber(body, "exactSceneConfidence", 0, 1);
    const minimumAudioConfidence = optionalNumber(body, "minimumAudioConfidence", 0, 1);
    return {
      editTypeId: requiredString(body, "editTypeId"),
      ...(editTypeTitle === undefined ? {} : { editTypeTitle }),
      finishPath: await ensureFile(requiredString(body, "finishPath"), "Finish reference"),
      videoPaths,
      audioPaths,
      ...(minimumSimilarity === undefined ? {} : { minimumSimilarity }),
      ...(stretchSimilarity === undefined ? {} : { stretchSimilarity }),
      ...(maxAttempts === undefined ? {} : { maxAttempts }),
      ...(exactSceneConfidence === undefined ? {} : { exactSceneConfidence }),
      ...(minimumAudioConfidence === undefined ? {} : { minimumAudioConfidence }),
    };
  }

  async #startPractice(body: Record<string, unknown>): Promise<PracticePanelRunSnapshotV1> {
    if (this.#activeRunId !== null) {
      throw new HttpError(409, "EditFlow run already active: " + this.#activeRunId);
    }
    if (this.config.broker.panelSession === null) {
      throw new HttpError(409, "After Effects CEP panel is not connected.");
    }
    const request = await this.#parsePractice(body);
    const editTypesFile = await this.#editTypes();
    const registry = await editTypesFile.load();
    let editType = registry.get(request.editTypeId);
    if (editType === null) {
      if (request.editTypeTitle === undefined) {
        throw new HttpError(400, "Unknown Edit Type: " + request.editTypeId);
      }
      editType = registry.create({
        editTypeId: request.editTypeId,
        title: request.editTypeTitle,
        choiceWords: [request.editTypeTitle],
        description: "Created from the EditFlow Practice panel.",
      });
    }

    const sessionId = "practice:" + randomUUID();
    const start = mediaInputs(request.videoPaths, request.audioPaths ?? []);
    const finish: PracticeMediaInputV1 = {
      mediaId: mediaId("finish", request.finishPath, 0),
      role: "FINISH_REFERENCE",
      mediaKind: "VIDEO",
      uri: request.finishPath,
    };
    const artifactDir = path.join(
      this.config.artifactDir,
      sessionId.replace(/[:]/g, "-"),
    );
    const assignment = await this.#gptStore.createAssignment({
      sessionId,
      mode: "PRACTICE",
      editTypeId: editType.editTypeId,
      finish,
      start,
      artifactDir,
      knowledge: registry.knowledge(editType.editTypeId),
    });
    registry.beginGptLearningSession(editType.editTypeId, sessionId, "PRACTICE");
    await editTypesFile.save(registry);

    const run: PracticePanelRunSnapshotV1 = {
      sessionId,
      assignmentId: assignment.assignmentId,
      mode: "PRACTICE",
      editTypeId: editType.editTypeId,
      state: "WAITING_FOR_GPT",
      stage: null,
      startedAt: assignment.createdAt,
      completedAt: null,
      finishPath: request.finishPath,
      videoPaths: request.videoPaths,
      audioPaths: request.audioPaths ?? [],
      result: null,
      allocation: null,
      finalRenderRef: null,
      finalSummary: null,
      error: null,
    };
    this.#activeRunId = sessionId;
    this.#runs.set(sessionId, run);
    return snapshot(run);
  }

  async #syncRun(sessionId: string): Promise<PracticePanelRunSnapshotV1> {
    const run = this.#runs.get(sessionId);
    if (run === undefined) throw new HttpError(404, "EditFlow run not found.");
    const assignment = await this.#gptStore.getAssignment(run.assignmentId);
    if (assignment === null) throw new HttpError(404, "GPT assignment not found.");
    const events = await this.#gptStore.eventsForSession(sessionId);
    const latestEvent = events.at(-1);
    const state: PracticePanelRunStateV1 = assignment.status === "PENDING"
      ? "WAITING_FOR_GPT"
      : assignment.status === "CANCEL_REQUESTED"
        ? "CANCEL_REQUESTED"
        : assignment.status === "CANCELLED"
          ? "CANCELLED"
          : assignment.status === "COMPLETED"
            ? "COMPLETED"
            : assignment.status === "FAILED"
              ? "FAILED"
              : "RUNNING";
    const updated: PracticePanelRunSnapshotV1 = {
      ...run,
      state,
      stage: latestEvent?.stage ?? run.stage,
      completedAt: assignment.completedAt,
      finalRenderRef: assignment.finalRenderRef,
      finalSummary: assignment.finalSummary,
      error: assignment.error,
    };
    this.#runs.set(sessionId, updated);
    if (["CANCELLED", "COMPLETED", "FAILED"].includes(state)
      && this.#activeRunId === sessionId) {
      this.#activeRunId = null;
    }
    return snapshot(updated);
  }

  async #claimAssignment(
    assignmentId: string,
    body: Record<string, unknown>,
  ): Promise<GptOrchestrationAssignmentV1> {
    const claimedBy = optionalString(body, "claimedBy") ?? "chatgpt";
    const assignment = await this.#gptStore.claim(assignmentId, claimedBy);
    await this.#syncRun(assignment.sessionId);
    return assignment;
  }

  async #recordLearningEvent(
    assignmentId: string,
    body: Record<string, unknown>,
  ): Promise<GptOrchestrationAssignmentV1> {
    const stage = requiredString(body, "stage") as GptLearningStageV1;
    const allowedStages: readonly GptLearningStageV1[] = [
      "OBSERVATION", "INTERPRETATION", "HYPOTHESIS", "PLAN",
      "CAPABILITY_GAP", "RESEARCH", "CAPABILITY_IMPLEMENTATION",
      "CAPABILITY_PROOF", "SKILL_COMMIT", "AE_ACTION", "RENDER",
      "COMPARISON", "DIAGNOSIS", "CORRECTION", "RESULT", "LESSON",
    ];
    if (!allowedStages.includes(stage)) throw new HttpError(400, "Invalid GPT learning stage.");
    const outcome = (optionalString(body, "outcome") ?? "NEUTRAL") as GptLearningOutcomeV1;
    const allowedOutcomes: readonly GptLearningOutcomeV1[] = [
      "NEUTRAL", "SUCCESS", "FAILURE", "IMPROVED", "REGRESSED",
    ];
    if (!allowedOutcomes.includes(outcome)) throw new HttpError(400, "Invalid GPT learning outcome.");
    const attemptValue = body["attempt"];
    const attempt = attemptValue === undefined
      ? undefined
      : optionalNumber(body, "attempt", 1, 10_000, true);
    const evidenceRefs = stringArray(body, "evidenceRefs", false);
    const detail = optionalString(body, "detail");
    const developmentPattern = optionalString(body, "developmentPattern");
    const reusableLesson = optionalString(body, "reusableLesson");
    const avoidRepeat = optionalString(body, "avoidRepeat");
    const capabilityGap = optionalCapabilityGap(body, "capabilityGap");
    const researchSources = optionalResearchSources(body, "researchSources");
    const learnedSkill = optionalLearnedSkill(body, "learnedSkill");
    if (stage === "CAPABILITY_GAP" && capabilityGap === undefined) {
      throw new HttpError(400, "CAPABILITY_GAP requires capabilityGap.");
    }
    if (stage === "RESEARCH" && (researchSources === undefined || researchSources.length === 0)) {
      throw new HttpError(400, "RESEARCH requires at least one research source.");
    }
    if (stage === "CAPABILITY_PROOF" && evidenceRefs.length === 0) {
      throw new HttpError(400, "CAPABILITY_PROOF requires evidenceRefs.");
    }
    if (stage === "SKILL_COMMIT") {
      if (learnedSkill === undefined || capabilityGap === undefined) {
        throw new HttpError(400, "SKILL_COMMIT requires learnedSkill and resolved capabilityGap.");
      }
      if (capabilityGap.status !== "RESOLVED"
        || capabilityGap.resolutionSkillId !== learnedSkill.skillId) {
        throw new HttpError(400, "SKILL_COMMIT must resolve the gap with the committed skill.");
      }
      if (!["AE_PROVEN", "TRANSFER_VERIFIED"].includes(learnedSkill.maturity)) {
        throw new HttpError(400, "SKILL_COMMIT requires AE_PROVEN or TRANSFER_VERIFIED maturity.");
      }
    }
    const event = await this.#gptStore.appendEvent({
      assignmentId,
      stage,
      outcome,
      ...(attempt === undefined ? {} : { attempt }),
      summary: requiredString(body, "summary"),
      ...(detail === undefined ? {} : { detail }),
      ...(developmentPattern === undefined ? {} : { developmentPattern }),
      ...(reusableLesson === undefined ? {} : { reusableLesson }),
      ...(avoidRepeat === undefined ? {} : { avoidRepeat }),
      ...(capabilityGap === undefined ? {} : { capabilityGap }),
      ...(researchSources === undefined ? {} : { researchSources }),
      ...(learnedSkill === undefined ? {} : { learnedSkill }),
      evidenceRefs,
    });
    const file = await this.#editTypes();
    const registry = await file.load();
    registry.recordGptLearningEvent(event);
    await file.save(registry);
    return (await this.#gptStore.getAssignment(assignmentId))!;
  }

  async #completeAssignment(
    assignmentId: string,
    body: Record<string, unknown>,
  ): Promise<PracticePanelRunSnapshotV1> {
    const success = body["success"];
    if (typeof success !== "boolean") throw new HttpError(400, "success must be boolean.");
    const finalRenderRef = optionalString(body, "finalRenderRef");
    const assignment = await this.#gptStore.complete(assignmentId, {
      success,
      finalSummary: requiredString(body, "finalSummary"),
      ...(finalRenderRef === undefined ? {} : { finalRenderRef }),
    });
    const file = await this.#editTypes();
    const registry = await file.load();
    registry.completeGptLearningSession({
      editTypeId: assignment.editTypeId,
      sessionId: assignment.sessionId,
      mode: assignment.mode,
      mastered: success && assignment.status === "COMPLETED",
    });
    await file.save(registry);
    return await this.#syncRun(assignment.sessionId);
  }

  async #failAssignment(
    assignmentId: string,
    body: Record<string, unknown>,
  ): Promise<PracticePanelRunSnapshotV1> {
    const assignment = await this.#gptStore.fail(
      assignmentId,
      requiredString(body, "error"),
    );
    return await this.#syncRun(assignment.sessionId);
  }

  async #acknowledgeCancelled(
    assignmentId: string,
    body: Record<string, unknown>,
  ): Promise<PracticePanelRunSnapshotV1> {
    const summary = optionalString(body, "summary")
      ?? "GPT stopped safely after the Practice/Pro Creation cancel request.";
    const assignment = await this.#gptStore.acknowledgeCancelled(assignmentId, summary);
    return await this.#syncRun(assignment.sessionId);
  }

  async #cancelRun(sessionId: string): Promise<PracticePanelRunSnapshotV1> {
    const run = this.#runs.get(sessionId);
    if (run === undefined) throw new HttpError(404, "EditFlow run not found.");
    await this.#gptStore.requestCancel(run.assignmentId);
    return await this.#syncRun(sessionId);
  }

  async #startProCreation(
    body: Record<string, unknown>,
  ): Promise<PracticePanelRunSnapshotV1> {
    if (this.#activeRunId !== null) {
      throw new HttpError(409, "EditFlow run already active: " + this.#activeRunId);
    }
    if (this.config.broker.panelSession === null) {
      throw new HttpError(409, "After Effects CEP panel is not connected.");
    }
    const request: ProCreationBody = {
      editTypeId: requiredString(body, "editTypeId"),
      videoPaths: await Promise.all(
        stringArray(body, "videoPaths", true)
          .map((value) => ensureFile(value, "Start video")),
      ),
      audioPaths: await Promise.all(
        stringArray(body, "audioPaths", false)
          .map((value) => ensureFile(value, "Start audio")),
      ),
    };
    const sessionId = "pro:" + randomUUID();
    const start = mediaInputs(request.videoPaths, request.audioPaths ?? []);
    const file = await this.#editTypes();
    const registry = await file.load();
    const preparation = new ProCreationPreparationEngineV1(registry).prepare({
      sessionId,
      mode: "PRO_CREATION",
      editTypeId: request.editTypeId,
      start,
    });
    if (preparation.status !== "READY" || preparation.knowledge === null) {
      throw new HttpError(409, preparation.reasons.join(" "));
    }
    const assignment = await this.#gptStore.createAssignment({
      sessionId,
      mode: "PRO_CREATION",
      editTypeId: request.editTypeId,
      finish: null,
      start,
      artifactDir: path.join(this.config.artifactDir, sessionId.replace(/[:]/g, "-")),
      knowledge: preparation.knowledge,
    });
    registry.beginGptLearningSession(request.editTypeId, sessionId, "PRO_CREATION");
    await file.save(registry);
    const run: PracticePanelRunSnapshotV1 = {
      sessionId,
      assignmentId: assignment.assignmentId,
      mode: "PRO_CREATION",
      editTypeId: request.editTypeId,
      state: "WAITING_FOR_GPT",
      stage: null,
      startedAt: assignment.createdAt,
      completedAt: null,
      finishPath: null,
      videoPaths: request.videoPaths,
      audioPaths: request.audioPaths ?? [],
      result: null,
      allocation: null,
      finalRenderRef: null,
      finalSummary: null,
      error: null,
    };
    this.#activeRunId = sessionId;
    this.#runs.set(sessionId, run);
    return snapshot(run);
  }

  async #prepareProCreation(
    body: Record<string, unknown>,
  ): Promise<ProCreationPreparationResultV1> {
    const request: ProCreationBody = {
      editTypeId: requiredString(body, "editTypeId"),
      videoPaths: await Promise.all(
        stringArray(body, "videoPaths", true)
          .map((value) => ensureFile(value, "Start video")),
      ),
      audioPaths: await Promise.all(
        stringArray(body, "audioPaths", false)
          .map((value) => ensureFile(value, "Start audio")),
      ),
    };
    const file = await this.#editTypes();
    const registry = await file.load();
    return new ProCreationPreparationEngineV1(registry).prepare({
      sessionId: "pro:" + randomUUID(),
      mode: "PRO_CREATION",
      editTypeId: request.editTypeId,
      start: mediaInputs(request.videoPaths, request.audioPaths ?? []),
    });
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.#setHeaders(res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (!this.#authorized(req)) {
      jsonResponse(res, 401, { error: "UNAUTHORIZED" });
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (req.method === "GET" && url.pathname === "/v1/product/status") {
        jsonResponse(res, 200, {
          service: "READY",
          panelConnected: this.config.broker.panelSession !== null,
          gptOrchestration: "ASSIGNMENT_QUEUE_READY",
          activeRunId: this.#activeRunId,
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/product/edit-types") {
        const file = await this.#editTypes();
        const registry = await file.load();
        jsonResponse(res, 200, { editTypes: registry.list() });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/product/edit-types") {
        if (this.#activeRunId !== null) {
          throw new HttpError(409, "Cannot change Edit Types during an active Practice run.");
        }
        const body = await readJson(req);
        const file = await this.#editTypes();
        const registry = await file.load();
        const title = requiredString(body, "title");
        const description = optionalString(body, "description");
        const profile = registry.create({
          editTypeId: requiredString(body, "editTypeId"),
          title,
          choiceWords: [title],
          ...(description === undefined ? {} : { description }),
        });
        await file.save(registry);
        jsonResponse(res, 201, { editType: profile });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/product/practice") {
        jsonResponse(res, 202, { run: await this.#startPractice(await readJson(req)) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/product/pro-creation") {
        jsonResponse(res, 202, { run: await this.#startProCreation(await readJson(req)) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/product/pro-creation/prepare") {
        const result = await this.#prepareProCreation(await readJson(req));
        jsonResponse(res, 200, { preparation: result });
        return;
      }

      const runMatch = /^\/v1\/product\/(?:runs|practice)\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && runMatch !== null) {
        const id = decodeURIComponent(runMatch[1] ?? "");
        jsonResponse(res, 200, { run: await this.#syncRun(id) });
        return;
      }
      const cancelRunMatch = /^\/v1\/product\/runs\/([^/]+)\/cancel$/.exec(url.pathname);
      if (req.method === "POST" && cancelRunMatch !== null) {
        const id = decodeURIComponent(cancelRunMatch[1] ?? "");
        jsonResponse(res, 200, { run: await this.#cancelRun(id) });
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/product/gpt/assignments") {
        const status = url.searchParams.get("status");
        const assignments = await this.#gptStore.listAssignments(
          status === null
            ? {}
            : { statuses: [status as GptOrchestrationAssignmentV1["status"]] },
        );
        jsonResponse(res, 200, { assignments });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/product/gpt/assignments/next") {
        const assignments = await this.#gptStore.listAssignments({ statuses: ["PENDING"] });
        jsonResponse(res, 200, { assignment: assignments[0] ?? null });
        return;
      }
      const assignmentGetMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && assignmentGetMatch !== null) {
        const id = decodeURIComponent(assignmentGetMatch[1] ?? "");
        const assignment = await this.#gptStore.getAssignment(id);
        if (assignment === null) throw new HttpError(404, "GPT assignment not found.");
        jsonResponse(res, 200, {
          assignment,
          events: await this.#gptStore.eventsForSession(assignment.sessionId),
        });
        return;
      }
      const claimMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)\/claim$/.exec(url.pathname);
      if (req.method === "POST" && claimMatch !== null) {
        const id = decodeURIComponent(claimMatch[1] ?? "");
        jsonResponse(res, 200, {
          assignment: await this.#claimAssignment(id, await readJson(req)),
        });
        return;
      }
      const eventMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)\/events$/.exec(url.pathname);
      if (req.method === "POST" && eventMatch !== null) {
        const id = decodeURIComponent(eventMatch[1] ?? "");
        jsonResponse(res, 201, {
          assignment: await this.#recordLearningEvent(id, await readJson(req)),
        });
        return;
      }
      const completeMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)\/complete$/.exec(url.pathname);
      if (req.method === "POST" && completeMatch !== null) {
        const id = decodeURIComponent(completeMatch[1] ?? "");
        jsonResponse(res, 200, {
          run: await this.#completeAssignment(id, await readJson(req)),
        });
        return;
      }
      const failMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)\/fail$/.exec(url.pathname);
      if (req.method === "POST" && failMatch !== null) {
        const id = decodeURIComponent(failMatch[1] ?? "");
        jsonResponse(res, 200, {
          run: await this.#failAssignment(id, await readJson(req)),
        });
        return;
      }
      const cancelledMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)\/cancelled$/.exec(url.pathname);
      if (req.method === "POST" && cancelledMatch !== null) {
        const id = decodeURIComponent(cancelledMatch[1] ?? "");
        jsonResponse(res, 200, {
          run: await this.#acknowledgeCancelled(id, await readJson(req)),
        });
        return;
      }
      jsonResponse(res, 404, { error: "NOT_FOUND" });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400;
      jsonResponse(res, status, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
