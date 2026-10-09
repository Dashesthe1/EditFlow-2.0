import { CHATGPT_EDITORIAL_AUTHORITY_V1, CHATGPT_PRACTICE_NOTEBOOK_CONTRACT_V1, ChatgptEditorialDecisionFileV1, practiceNotebookViewV1, validateChatgptSourceImportsV1 } from "../../../packages/practice-homework/src/chatgpt-editorial-authority.js";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";

import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { ProductionSupervisionV1, redactWorkerCredentialsV1 } from "./production-supervision.js";
import { ProductionUserControlsV1, PRODUCTION_USER_CONTROL_CONTRACT_V1, type ProductionUserControlReceiptV1 } from "./production-user-controls.js";

import { EditTypeRegistryFileV1, GptOrchestrationStoreV1, ProCreationPreparationEngineV1, hasVerifiedPracticeSourceIdentityV1, ChatgptFootageBrowserV1, defaultPracticeAnalysisCacheDirectoryV1, type GptAppendEventInputV1, type GptCapabilityGapV1, type GptLearnedSkillV1, type GptLearningOutcomeV1, type GptLearningStageV1, type GptOrchestrationAssignmentV1, type GptOrchestrationModeV1, type GptResearchSourceV1, type GptSkillCausalModelV1, type GptSkillMachineUseSignatureV1, PracticeProductionCoordinatorFileV1, PracticeProductionCoordinatorV1, PracticeProductionWorkerV1, PRACTICE_PRODUCTION_JOB_KINDS_V1, type PracticeProductionJobV1, practiceTelemetrySpanV1, type PracticeLearningAllocationResultV1, type PracticeMasteryScopeV1, type PracticeMediaInputV1, type PracticePreflightCheckpointV1, type PracticeSceneMatchV1, type PracticeRunRoleV1, validatePracticeWorkingMediaMatchesV1, type PracticeSessionResultV1, type ProCreationPreparationResultV1, validatePracticeSceneMatchesV1 } from "../../../packages/practice-homework/src/index.js";

import { ClipResearchStoreV1, CLIP_RESEARCH_CONTRACT_V1 } from "../../../packages/practice-homework/src/clip-research.js";
import { PRIMARY_PRODUCTION_WORKFLOW_V1, PRIMARY_WORKFLOW_ROUTING_V1, PRODUCTION_WORKFLOW_CONTRACT_V1, emptyProductionWorkflowV1, parseProductionWorkflowPlanV1, validateWorkflowJobV1, validateMethodApplicationV1 } from "../../../packages/practice-homework/src/production-workflow.js";
import { STUDIED_PRODUCTION_METHODS_V1 } from "../../../packages/practice-homework/src/studied-methods.js";
import { AeCepAdapterClientV11, AeFilesystemPolicyV11 } from "../../../packages/adapters/ae-cep/src/v1_1.js";
import { productionJobScopeV1 } from "../../../packages/adapters/ae-cep/src/production-job-scope.js";
import { LoopbackCepBroker } from "./loopback-cep.js";
import { CurrentAeTransactionRuntimeV1, type CurrentAeStabilizationRuntimeV1 } from "./current-ae-transaction-runtime.js";
import { PRIMARY_EDIT_PRODUCTION_SYSTEM_V1, RETIRED_EDIT_EXECUTION_PATHS_V1, retiredEditExecutionResponseV1 } from "./production-authority.js";
import { computeProjectFingerprint } from "../../../packages/fingerprints/src/index.js";
import { toAeStructuralFingerprintInput } from "../../../packages/ae-object-model/src/index.js";
import { assignmentViewV1, productionJobsViewV1, productionSnapshotViewV1, projectStateSummaryV1 } from "./direct-editing-views.js";
import { parseVisualReviewV1, validateVisualComparisonTimesV1, visualMutationDimensionsV1 } from "../../../packages/practice-homework/src/visual-continuity.js";
import { LocalFastRuntimeV1, validateRoutineBatchV1 } from "./local-fast-runtime.js";
import { SourceMatchServiceV1, SOURCE_MATCH_CONTRACT_V1 } from "./source-match-service.js";
import { SourceMatchAssemblyV1, SOURCE_ASSEMBLY_CONTRACT_V1 } from "./source-match-assembly.js";

import { ChatgptAeRenderDriverV1 } from "./chatgpt-ae-render-driver.js";

import { runPracticeScratchSearchV1, validatePracticeScratchSearchV1 } from "./practice-scratch-search.js";


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
  readonly buildId?: string;
  readonly aeWriterAvailable?: () => boolean;
  /** Explicitly disabled only by isolated acceptance labs. */
  readonly productionSupervision?: boolean;
  readonly stabilization?: CurrentAeStabilizationRuntimeV1;
}

export const CHATGPT_FOOTAGE_SELECTION_CONTRACT_V1 = {
  authority: "CHATGPT_DIRECT",
  availableSelectionMethods: ["CHATGPT_DIRECT"],
  onlySelectionMethod: true,
  endpoint: "/v1/product/gpt/assignments/{id}/footage-selection",
  actions: ["BROWSE", "NOTE", "DEFINE_REFERENCE", "SELECT", "BROWSE_RENDER"],
  instruction: "GET returns ChatGPT-defined reference shots (initially empty), supplied raw media and prior GPT decisions, never ranked candidates. BROWSE takes mediaId, timesMs (1–48 explicit timestamps), width (160–1920), claimedBy. Open the returned contactSheetPath and frame paths to inspect the actual pixels. DEFINE_REFERENCE takes claimedBy, authority:CHATGPT_DIRECT, durationMs, rationale and continuous ordered shots [{shotId,order,referenceStartMs,referenceEndMs,observation,inspections:[{evidenceId,timeMs}]}]. BROWSE_RENDER takes retained renderJobId, timesMs and claimedBy. SELECT takes claimedBy, selections and search. Each selection: shotId, sourceId, sourceStartMs, sourceEndMs, direction, playbackRate, confidence, rationale, anchors (at least three comparisons spanning the shot). Anchor: referenceTimeMs, sourceTimeMs, referenceEvidenceId, sourceEvidenceId, observation. search: internetStatus CONSULTED with sources [{url,query,finding}], or UNAVAILABLE with reason, plus strategies. Use internet scene/dialogue/script/chapter clues first, chronological overview sheets, time-range narrowing, surrounding context, dense boundary/gesture comparisons and exact frames. Internet clues are hypotheses; directly inspected provided raw pixels decide every shot. Selection and working-clip preparation never mutate AE. Research effects separately using Tutorial Drive, Adobe, then web. Resume the same assignment; no machine-ranking fallback.",
} as const;

export type PracticePanelRunStateV1 =
  | "WAITING_FOR_GPT"
  | "RUNNING"
  | "CANCEL_REQUESTED"
  | "CANCELLED"
  | "COMPLETED"
  | "FAILED";

export interface PracticeHumanReviewV1 {
  readonly schema: "editflow.practice-human-review.v1";
  readonly sessionId: string;
  readonly editTypeId: string;
  readonly sceneFidelity: number;
  readonly timingPacing: number;
  readonly effectsTransitions: number;
  readonly visualFinish: number;
  readonly overall: number;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly evidenceRefs: readonly string[];
}

export interface PracticePanelRunSnapshotV1 {
  readonly sessionId: string;
  readonly assignmentId: string;
  readonly mode: GptOrchestrationModeV1;
  readonly practiceRole: PracticeRunRoleV1 | null;
  readonly editTypeId: string;
  readonly state: PracticePanelRunStateV1;
  readonly stage: GptLearningStageV1 | null;
  readonly preflight?: PracticePreflightCheckpointV1;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly finishPath: string | null;
  readonly videoPaths: readonly string[];
  readonly audioPaths: readonly string[];
  readonly result: PracticeSessionResultV1 | null;
  readonly allocation: PracticeLearningAllocationResultV1 | null;
  readonly masteryScope: PracticeMasteryScopeV1 | null;
  readonly masteryProofRef: string | null;
  readonly masteryReasons: readonly string[];
  readonly finalRenderRef: string | null;
  readonly humanReview: PracticeHumanReviewV1 | null;
  readonly finalSummary: string | null;
  readonly error: string | null;
}

export interface PracticeConnectionPreflightCheckV1 {
  readonly id: "PRODUCT_SERVICE" | "CEP_BROKER" | "CEP_PANEL" | "AFTER_EFFECTS_READBACK";
  readonly ready: boolean;
  readonly detail: string;
}

export interface PracticeConnectionPreflightV1 {
  readonly schema: "editflow.connection-preflight.v1";
  readonly status: "READY" | "BLOCKED";
  readonly checkedAt: string;
  readonly repairPolicy: "GPT_AUTO_REPAIR_THEN_RESUME";
  readonly checks: readonly PracticeConnectionPreflightCheckV1[];
}

interface PracticeRunBody {
  readonly editTypeId: string;
  readonly editTypeTitle?: string;
  readonly practiceRole: PracticeRunRoleV1 | null;
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
  const body = redactWorkerCredentialsV1(value);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
};

const requestBodies = new WeakMap<IncomingMessage, Record<string, unknown>>();
const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const cached = requestBodies.get(req);
  if (cached) return cached;
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
  requestBodies.set(req, parsed as Record<string, unknown>);
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

const requiredCausalModel = (
  body: Record<string, unknown>,
  name: string,
): GptSkillCausalModelV1 => {
  const record = optionalRecord(body, name);
  if (record === undefined) throw new HttpError(400, name + " is required.");
  return {
    triggerConditions: stringArray(record, "triggerConditions", true),
    invariants: stringArray(record, "invariants", true),
    adaptationAxes: stringArray(record, "adaptationAxes", true),
    failureSignals: stringArray(record, "failureSignals", true),
    repairStrategies: stringArray(record, "repairStrategies", true),
    transferCriteria: stringArray(record, "transferCriteria", true),
  };
};

const optionalMachineUseSignature = (
  body: Record<string, unknown>,
  name: string,
): GptSkillMachineUseSignatureV1 | undefined => {
  const record = optionalRecord(body, name);
  if (record === undefined) return undefined;
  const rawRules = record["invariantRules"];
  if (!Array.isArray(rawRules) || rawRules.length === 0) {
    throw new HttpError(400, name + ".invariantRules must contain at least one rule.");
  }
  return {
    schema: requiredEnum(
      record,
      "schema",
      ["editflow.gpt-skill-machine-use-signature.v1"] as const,
    ),
    invariantRules: rawRules.map((rule, ruleIndex) => {
      if (rule === null || typeof rule !== "object" || Array.isArray(rule)) {
        throw new HttpError(
          400,
          name + ".invariantRules[" + String(ruleIndex) + "] must be an object.",
        );
      }
      const ruleRecord = rule as Record<string, unknown>;
      const rawEvidence = ruleRecord["evidence"];
      if (!Array.isArray(rawEvidence) || rawEvidence.length === 0) {
        throw new HttpError(
          400,
          name + ".invariantRules[" + String(ruleIndex) + "].evidence must not be empty.",
        );
      }
      return {
        invariant: requiredString(ruleRecord, "invariant"),
        evidence: rawEvidence.map((predicate, predicateIndex) => {
          if (predicate === null || typeof predicate !== "object" || Array.isArray(predicate)) {
            throw new HttpError(
              400,
              name + ".invariantRules[" + String(ruleIndex) + "].evidence["
                + String(predicateIndex) + "] must be an object.",
            );
          }
          const predicateRecord = predicate as Record<string, unknown>;
          return {
            source: requiredEnum(predicateRecord, "source", [
              "CUE_ID",
              "RATIONALE_CODE",
              "CONSTRUCTION_ID",
              "EVIDENCE_REF",
              "PROOF_EFFECT_FAMILY",
              "PROOF_OBJECT_AWARE",
            ] as const),
            match: requiredEnum(predicateRecord, "match", ["EXACT", "PREFIX"] as const),
            value: requiredString(predicateRecord, "value"),
          };
        }),
      };
    }),
  };
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
    const technique = optionalRecord(record, "tutorialTechnique");
    if (record["tutorialCompilation"] !== undefined) throw new HttpError(410, "Machine tutorial compilation removed; retain directly analyzed source steps.");
    return {
      sourceId: requiredString(record, "sourceId"),
      kind: requiredEnum(record, "kind", [
        "TUTORIAL_DRIVE", "ADOBE_DOCUMENTATION", "INSTALLED_ADOBE_FEATURE",
        "PLUGIN_DOCUMENTATION", "PROFESSIONAL_TUTORIAL", "WEB", "INTERNAL_EVIDENCE",
      ] as const),
      title: requiredString(record, "title"),
      ...(optionalString(record, "uri") === undefined ? {} : { uri: optionalString(record, "uri")! }),
      ...(optionalString(record, "notes") === undefined ? {} : { notes: optionalString(record, "notes")! }),
      ...(technique === undefined ? {} : {
        tutorialTechnique: {
          what: requiredString(technique, "what"),
          whenWhy: requiredString(technique, "whenWhy"),
          how: requiredString(technique, "how"),
          access: requiredString(technique, "access"),
          proof: requiredString(technique, "proof"),
          transfer: requiredString(technique, "transfer"),
        },
      }),

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
  const causalModel = optionalRecord(record, "causalModel");
  const machineUseSignature = optionalMachineUseSignature(record, "machineUseSignature");
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
    ...(causalModel === undefined ? {} : {
      causalModel: {
        triggerConditions: stringArray(causalModel, "triggerConditions", true),
        invariants: stringArray(causalModel, "invariants", true),
        adaptationAxes: stringArray(causalModel, "adaptationAxes", true),
        failureSignals: stringArray(causalModel, "failureSignals", true),
        repairStrategies: stringArray(causalModel, "repairStrategies", true),
        transferCriteria: stringArray(causalModel, "transferCriteria", true),
      },
    }),
    ...(machineUseSignature === undefined ? {} : { machineUseSignature }),
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

const assignmentRunState = (
  status: GptOrchestrationAssignmentV1["status"],
): PracticePanelRunStateV1 => status === "PENDING"
  ? "WAITING_FOR_GPT"
  : status === "CANCEL_REQUESTED"
    ? "CANCEL_REQUESTED"
    : status === "CANCELLED"
      ? "CANCELLED"
      : status === "COMPLETED"
        ? "COMPLETED"
        : status === "FAILED"
          ? "FAILED"
          : "RUNNING";

export class PracticePanelServerV1 {
  readonly config: PracticePanelServerConfigV1;
  #server: Server | null = null;
  #port = 0;
  #activeRunId: string | null = null;
  readonly #runs = new Map<string, PracticePanelRunSnapshotV1>();
  readonly #gptStore: GptOrchestrationStoreV1;
  readonly #clipResearch: ClipResearchStoreV1;
  readonly #productionCoordinatorDir: string;
  readonly #coordinators = new Map<string, Promise<{ file: PracticeProductionCoordinatorFileV1; coordinator: PracticeProductionCoordinatorV1 }>>();
  readonly #productionWorker: PracticeProductionWorkerV1;
  readonly #legacyWorkflowReceiptIds = new Set<string>();
  readonly #supervision: ProductionSupervisionV1 | null;
  readonly #userControls: ProductionUserControlsV1;
  #aeWriterOwner: string | null = null;
  #childProofScope: { key: string; jobId: string; body: Record<string, any> } | null = null;
  #childProofTail: Promise<unknown> = Promise.resolve();
  readonly #transactionRuntime: CurrentAeTransactionRuntimeV1;
  #fastRuntime: LocalFastRuntimeV1 | null = null;
  #fastRuntimePromise: Promise<LocalFastRuntimeV1> | null = null;
  #controlRequestCounter = 0;
  #startingPractice: Promise<PracticePanelRunSnapshotV1> | null = null;
  readonly #preflightJobs = new Map<string, { abort: AbortController; promise: Promise<void> }>();
  readonly #preflightErrors = new Map<string, string>();
  readonly #footageSelectionTails = new Map<string, Promise<unknown>>();
  readonly #sourceMatch: SourceMatchServiceV1;
  readonly #sourceAssembly: SourceMatchAssemblyV1;

  constructor(config: PracticePanelServerConfigV1) {
    if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
      throw new TypeError("Practice panel port must be an integer from 0 through 65535.");
    }
    if (config.token.length < 32) {
      throw new TypeError("Practice panel token must contain at least 32 characters.");
    }
    this.config = config;
    const matchRoot = path.join(process.env.LOCALAPPDATA ?? path.dirname(config.artifactDir), "EditFlow2");
    this.#sourceMatch = new SourceMatchServiceV1({ repositoryRoot: config.repositoryRoot,
      artifactDir: path.join(matchRoot, "source-match-jobs"), cacheDir: path.join(matchRoot, "source-match-cache"),
      configPath: path.join(matchRoot, "source-match-config.json") });
    this.#sourceAssembly = new SourceMatchAssemblyV1(this.#sourceMatch.config, this.#sourceMatch);
    this.#gptStore = new GptOrchestrationStoreV1(
      config.gptOrchestrationFilePath
        ?? path.join(config.artifactDir, "state", "gpt-orchestration.json"),
    );
    this.#clipResearch = new ClipResearchStoreV1(
      path.join(path.dirname(this.#gptStore.filePath), "clip-research"),
      [process.env.USERPROFILE ?? config.repositoryRoot, config.repositoryRoot, config.artifactDir],
    );
    this.#productionCoordinatorDir = path.join(
      path.dirname(this.#gptStore.filePath),
      "production-coordinator",
    );
    this.#supervision = config.productionSupervision === false ? null : new ProductionSupervisionV1(
      path.join(path.dirname(this.#gptStore.filePath), "production-supervision"));
    this.#userControls = new ProductionUserControlsV1(path.join(path.dirname(this.#gptStore.filePath), "production-supervision"));
    this.#productionWorker = new PracticeProductionWorkerV1(
      path.join(this.#productionCoordinatorDir, "jobs.jsonl"),
      (job, signal) => this.#executeProductionJob(job, signal),
      async (id) => (await this.#gptStore.getAssignment(id))?.status === "RUNNING",
      async (id) => { const state = this.#supervision?.publicState(); return !state || state.assignmentId !== id || state.state === "ARMED"; },
    );
    this.#transactionRuntime = new CurrentAeTransactionRuntimeV1(
      config.broker,
      "practice-gpt-controller",
      64,
      config.stabilization ? { ...config.stabilization, visualDriver: null } : null,
      96,
      new AeFilesystemPolicyV11([
        process.env.USERPROFILE ?? config.repositoryRoot,
      ]),
    );
  }

  #productionCoordinatorFile(assignment: GptOrchestrationAssignmentV1): PracticeProductionCoordinatorFileV1 {
    const key = createHash("sha256").update(assignment.sessionId, "utf8").digest("hex");
    return new PracticeProductionCoordinatorFileV1(
      path.join(this.#productionCoordinatorDir, key + ".json"),
      path.join(this.#productionCoordinatorDir, key + ".telemetry.jsonl"),
    );
  }

  async #productionCoordinator(
    assignment: GptOrchestrationAssignmentV1,
  ): Promise<{ file: PracticeProductionCoordinatorFileV1; coordinator: PracticeProductionCoordinatorV1 }> {
    let retained = this.#coordinators.get(assignment.sessionId);
    if (!retained) {
      retained = this.#loadProductionCoordinator(assignment);
      this.#coordinators.set(assignment.sessionId, retained);
      retained.catch(() => { this.#coordinators.delete(assignment.sessionId); });
    }
    const production = await retained;
    await this.#synchronizeProductionSources(assignment, production);
    return production;
  }

  async #loadProductionCoordinator(
    assignment: GptOrchestrationAssignmentV1,
  ): Promise<{ file: PracticeProductionCoordinatorFileV1; coordinator: PracticeProductionCoordinatorV1 }> {
    const file = this.#productionCoordinatorFile(assignment);
    const coordinator = await file.load() ?? new PracticeProductionCoordinatorV1(
      assignment.sessionId, (assignment.practiceSceneMatches ?? []).map((match) => match.shotId),
      assignment.preflight?.stage !== "READY",
    );
    return { file, coordinator };
  }

  async #synchronizeProductionSources(assignment: GptOrchestrationAssignmentV1,
    { file, coordinator }: { file: PracticeProductionCoordinatorFileV1; coordinator: PracticeProductionCoordinatorV1 }): Promise<void> {
    const before = JSON.stringify(coordinator.snapshot());
    if (assignment.mode === "PRO_CREATION") {
      const ledger = await this.#clipResearch.snapshot(assignment);
      coordinator.ensurePhases(Object.keys(ledger.clips));
      for (const [clipId, clip] of Object.entries(ledger.clips) as [string, Record<string, any>][]) {
        const source = assignment.start.find((item) => item.mediaId === clip.scan.sourceMediaId && item.mediaKind === "VIDEO");
        if (!source) throw new HttpError(409, "Pro Creation clip source is not a provided raw video.");
        const key = "pro-source-lock:" + createHash("sha256").update(JSON.stringify({
          sourceIdentity: await this.#sourceIdentity(source.uri), sourceRangeMs: clip.scan.sourceRangeMs,
          inspectionHash: clip.scanHash,
        })).digest("hex");
        const prior = coordinator.snapshot().phases.find((phase) => phase.phaseId === clipId)!;
        if (prior.sourceCertificateKey !== key && (prior.sourceCertificateKey || prior.sourceValidationRequired)
          && prior.sourceValidationToken === clip.scanHash) {
          if (!prior.sourceValidationRequired) coordinator.requireSourceValidation(clipId);
          continue;
        }
        coordinator.lockSource(clipId, key, ledger.updatedAt ?? assignment.createdAt, clip.scanHash);
        if (clip.plan?.status === "READY" && !clip.stale) coordinator.markResearchReady(clipId, clip.plan.planId);
      }
      // Direct Pro work has no research ledger prerequisite. Track its supplied
      // raw identities mechanically; an actual change still needs fresh review.
      const directKey = "pro-direct-source-lock:" + createHash("sha256").update(JSON.stringify(
        await Promise.all(assignment.start.filter(item => item.mediaKind === "VIDEO").map(async item =>
          ({ mediaId: item.mediaId, identity: await this.#sourceIdentity(item.uri) }))),
      )).digest("hex");
      for (const phase of coordinator.snapshot().phases.filter(phase => !ledger.clips[phase.phaseId])) {
        if (phase.sourceCertificateKey === directKey) continue;
        if (phase.sourceCertificateKey || phase.sourceValidationRequired) {
          if (!phase.sourceValidationRequired) coordinator.requireSourceValidation(phase.phaseId);
        } else coordinator.lockSource(phase.phaseId, directKey, assignment.createdAt, "DIRECT_RAW_INPUTS");
      }
      if (before !== JSON.stringify(coordinator.snapshot())) await file.save(coordinator);
      return;
    }
    coordinator.ensurePhases([...(assignment.preflight?.totalShotIds ?? []),
      ...(assignment.practiceSceneMatches ?? []).map((match) => match.shotId)]);
    for (const match of assignment.practiceSceneMatches ?? []) {
      const sourceStartMs = Number.isFinite(match.sourceStartMs) ? match.sourceStartMs : 0;
      const sourceEndMs = Number.isFinite(match.sourceEndMs) ? match.sourceEndMs : sourceStartMs + 1;
      const certificate = createHash("sha256").update(JSON.stringify({
        sourceId: match.sourceId, sourceStartMs, sourceEndMs, direction: match.direction,
        sourceIdentity: await this.#sourceIdentity(match.sourcePath ?? assignment.start.find((item) => item.mediaId === match.sourceId)?.uri),
        referenceIdentity: await this.#sourceIdentity(assignment.finish?.uri),
      })).digest("hex");
      const key = "source-lock:" + certificate;
      const existing = coordinator.snapshot().phases.find((phase) => phase.phaseId === match.shotId)!;
      if (existing.sourceCertificateKey === key) continue;
      const legacyKey = "source-lock:" + createHash("sha256").update(JSON.stringify({
        sourceId: match.sourceId, sourceStartMs, sourceEndMs, direction: match.direction,
        playbackRate: match.playbackRate, confidence: match.confidence,
      })).digest("hex");
      if (existing.sourceCertificateKey === legacyKey) {
        coordinator.migrateSourceCertificate(match.shotId, key, assignment.preflight?.updatedAt);
        continue;
      }
      const selectedAt = match.chatgptSelection?.reviewedAt ?? assignment.createdAt;
      const selectionValidatedAt = assignment.preflight?.stage === "READY"
        && Date.parse(assignment.preflight.updatedAt) > Date.parse(selectedAt) ? assignment.preflight.updatedAt : selectedAt;
      const freshlyValidated = Date.parse(selectionValidatedAt) > Date.parse(existing.sourceValidatedAt ?? assignment.createdAt);
      if ((existing.sourceCertificateKey || existing.sourceValidationRequired) && !freshlyValidated) {
        if (!existing.sourceValidationRequired) coordinator.requireSourceValidation(match.shotId);
        continue;
      }
      coordinator.lockSource(match.shotId, key, selectionValidatedAt, match.chatgptSelection?.decisionId);
    }
    if (before !== JSON.stringify(coordinator.snapshot())) await file.save(coordinator);
  }

  async #sourceIdentity(value?: string): Promise<unknown> {
    if (!value) return null;
    try { const metadata = await stat(value); return { path: path.resolve(value), size: metadata.size, mtimeMs: metadata.mtimeMs }; }
    catch { return { path: path.resolve(value), missing: true }; }
  }

  #priorAssemblyBatch(assignmentId: string, body: Record<string, any>) {
    const binding = body.sourceAssembly;
    if (!binding || binding.batchIndex === 0) return;
    if (!this.#productionWorker.list(assignmentId).some(job => job.status === "SUCCEEDED"
      && job.payload.sourceAssembly?.assemblyId === binding.assemblyId
      && job.payload.sourceAssembly?.batchIndex === binding.batchIndex - 1)) {
      throw new HttpError(409, "PREVIOUS_ASSEMBLY_BATCH_NOT_COMMITTED");
    }
  }

  async #verifySourceAssembly(assignment: GptOrchestrationAssignmentV1, kind: string, body: Record<string, any>) {
    if (!body.sourceAssembly) return;
    if (kind !== "AE_TRANSACTION") throw new HttpError(400, "Source assembly uses the durable AE_TRANSACTION queue.");
    this.#priorAssemblyBatch(assignment.assignmentId, body);
    await this.#sourceAssembly.verifyPayload(body, {rawPaths:assignment.start.filter(m=>m.mediaKind==="VIDEO").map(m=>m.uri),
      ...(assignment.finish ? {referencePath:assignment.finish.uri} : {})});
  }

  #reserveAeWriter(owner: string): () => void {
    if (owner.startsWith("production-job:") && this.config.aeWriterAvailable?.() === false) throw new HttpError(423, "AE_MUTATION_LEASE_HELD");
    if (this.#aeWriterOwner !== null) throw new HttpError(423, "AE_WRITER_BUSY: " + this.#aeWriterOwner);
    this.#aeWriterOwner = owner;
    return () => { if (this.#aeWriterOwner === owner) this.#aeWriterOwner = null; };
  }

  async #executeProductionJob(job: PracticeProductionJobV1, signal: AbortSignal): Promise<{ result: unknown; reviewRequired?: boolean }> {
    let assignment = await this.#gptStore.getAssignment(job.assignmentId);
    if (!assignment || assignment.status !== "RUNNING" || assignment.sessionId !== this.#activeRunId) throw new HttpError(409, "Assignment no longer accepts production work.");
    const body = structuredClone(job.payload) as Record<string, any>;
    await new ChatgptEditorialDecisionFileV1(path.join(assignment.artifactDir, "editorial-decisions")).verify(assignment.assignmentId, job.kind, body);
    const production = await this.#productionCoordinator(assignment);
    validateWorkflowJobV1(production.coordinator.snapshot().workflow ?? emptyProductionWorkflowV1(), body,
      { kind: job.kind, acceptedReceipt: true, acceptedLegacyReceipt: this.#legacyWorkflowReceiptIds.has(job.jobId) });
    validateChatgptSourceImportsV1({ mode: assignment.mode, ...(assignment.finish ? {finishPath: assignment.finish.uri} : {}),
      rawVideoPaths: assignment.start.filter(m => m.mediaKind === "VIDEO").map(m => m.uri) }, body);
    await this.#verifySourceAssembly(assignment, job.kind, body);
    if (job.kind === "PROOF_SCRIPT") {
      const bytes = await readFile(path.resolve(this.config.repositoryRoot, body.scriptPath));
      if (createHash("sha256").update(bytes).digest("hex") !== body.scriptSha256) throw new TypeError("CHATGPT_REVIEWED_SCRIPT_CHANGED");
    }
    if (job.kind === "REFERENCE_ANALYSIS") {
      if (!assignment.finish || !Number.isFinite(body.startMs) || !Number.isFinite(body.endMs)
        || body.startMs < 0 || body.endMs <= body.startMs || body.endMs - body.startMs > 2000) throw new TypeError("Reference preparation requires a bounded two-second window.");
      const startedAtMs = Date.now();
      const media = new ChatgptFootageBrowserV1({ artifactDir: path.join(assignment.artifactDir, "media"),
        scriptPath: path.join(this.config.repositoryRoot, "scripts", "practice", "chatgpt-footage-browser.py"),
        ...(this.config.ffmpegPath ? { ffmpegPath: this.config.ffmpegPath } : {}) });
      if (!Array.isArray(body.timesMs) || body.timesMs.some((t: number) => t < body.startMs || t >= body.endMs)) throw new TypeError("GPT must choose exact reference timestamps inside this window.");
      const result = await media.inspectFootage(assignment.finish, body.timesMs, body.width ?? 640);
      await production.file.appendTelemetry(practiceTelemetrySpanV1({ spanId: job.jobId,
        sessionId: assignment.sessionId, category: "MEDIA_ANALYSIS", stage: "RESEARCH",
        startedAtMs, endedAtMs: Date.now() }));
      return { result };
    }
    const owner = body.researchContext?.claimedBy;
    if (typeof owner !== "string") throw new TypeError("Queued production requires an authorized researchContext.");
    // Accepted exact decisions survive handoffs; research records are advisory.
    const admission = await this.assertClipResearchReady(body, job.kind === "BUILD_BASELINE", true);
    body.researchContext.clipIds = admission?.clipIds ?? [];
    signal.throwIfAborted();
    // Timing/strategy telemetry is advisory; GPT decides whether to change its edit plan.
    const output = await this.#withProductionOperation({ body: job.kind === "BUILD_BASELINE" ? { ...body, globalOperation: true } : body,
      category: job.kind === "SCRATCH_SEARCH" || job.kind === "LOCAL_RENDER" ? "RENDER" : "AE_MUTATION",
      stage: job.kind === "BUILD_BASELINE" ? "WHOLE_EDIT_COVERAGE" : job.kind === "SCRATCH_SEARCH" || job.kind === "LOCAL_RENDER" ? "LOCAL_PROOF" : "AE_CONSTRUCTION",
      operation: job.jobId, markConstructed: ["AE_TRANSACTION", "AE_CORRECTION", "AE_GOAL", "AE_BATCH", "BUILD_BASELINE"].includes(job.kind),
      run: async () => {
        if (job.kind === "AE_TRANSACTION" || job.kind === "AE_CORRECTION") {
          const result = job.kind === "AE_TRANSACTION" ? await this.#transactionRuntime.execute(body.plan ?? body)
            : await this.#transactionRuntime.executeCorrection(body.plan ?? body);
          if (result.state !== "COMMITTED") throw new Error("Queued AE transaction failed: " + result.state);
          return { result };
        }
        if (job.kind === "AE_GOAL" || job.kind === "AE_BATCH") {
          const runtime = await this.#ensureFastRuntime();
          const result = job.kind === "AE_GOAL" ? await runtime.runGoal(body.goal, body.transactionId ?? job.jobId)
            : await runtime.runRoutineBatch(body.intents, body.transactionId ?? job.jobId);
          const incomplete = job.kind === "AE_BATCH" && result.completedActions !== body.intents.length;
          // Keep partial receipts: an interrupted batch needs actual readback, never blind replay.
          return { result: { ...result, state: incomplete || result.escalationReason ? "REVIEW_REQUIRED" : "COMMITTED" }, reviewRequired: incomplete || !!result.escalationReason };
        }
        if (job.kind === "PROOF_SCRIPT") {
          const response = await this.#dispatchWorkerProofScript(requiredString(body, "scriptPath"), job.jobId);
          // Opaque scripts always require readback review before another job proceeds.
          return { result: response, reviewRequired: true };
        }
        if (job.kind === "BUILD_BASELINE") {
          if (assignment!.mode !== "PRACTICE") throw new HttpError(400, "Practice baseline uses a Finish reference; Pro Creation constructs its editorial plan with AE_BATCH/AE_TRANSACTION.");
          const result = await this.#transactionRuntime.execute(body.plan);
          if (result.state !== "COMMITTED") throw new Error("ChatGPT baseline transaction did not commit.");
          const revision = Number(String((await this.#transactionRuntime.observe()).projectRevision).replace(/^ae-revision:/, ""));
          production.coordinator.markWholeEditCovered(Number.isFinite(revision) ? revision : null);
          await production.file.save(production.coordinator);
          return { result: { authority: "CHATGPT_DIRECT", transaction: result, plan: body.plan } };
        }
        const ffmpegPath = job.kind === "LOCAL_RENDER" && body.frameTimesMs !== undefined && !this.config.ffmpegPath
          ? await new ChatgptFootageBrowserV1({ artifactDir: path.join(assignment!.artifactDir, "media"),
            scriptPath: path.join(this.config.repositoryRoot, "scripts", "practice", "chatgpt-footage-browser.py") }).resolveFfmpegExecutable()
          : this.config.ffmpegPath;
        const driver = new ChatgptAeRenderDriverV1({ transport: this.config.broker,
          projectId: "practice-gpt-controller", artifactDir: assignment!.artifactDir, ...(ffmpegPath ? { ffmpegPath } : {}),
          ...(this.config.renderTimeoutMs === undefined ? {} : { renderTimeoutMs: this.config.renderTimeoutMs }) });
        if (job.kind === "SAVE_CHECKPOINT") {
          const client = driver.client;
          const observed = await client.observe(driver.projectId);
          const projectPath = path.join(assignment!.artifactDir, "production-checkpoint.aep");
          const result = await client.executePublic("project.save", { transactionId: job.jobId, operationId: job.jobId,
            payload: { path: projectPath }, expectedState: observed.observed });
          if (result.outcome === "FAILED" || result.outcome === "REJECTED") throw new Error("AE checkpoint save failed.");
          const { file, coordinator } = await this.#productionCoordinator(assignment!);
          coordinator.markAeCheckpoint({ projectPath, projectRevision: result.hostProjectRevision,
            activeCompId: typeof body.compStableId === "string" ? body.compStableId : null });
          await file.save(coordinator);
          return { result };
        }
        if (job.kind === "LOCAL_RENDER") {
          if (body.frameTimesMs !== undefined) return { result: await driver.renderFrames({ sessionId: assignment!.sessionId,
            compStableId: body.compStableId, timesMs: body.frameTimesMs, resolutionScale: body.resolutionScale, forceRender: body.forceRender, forceRenderReason: body.forceRenderReason }) };
          if (!Number.isFinite(body.startMs) || !Number.isFinite(body.endMs) || body.endMs <= body.startMs || body.startMs < 0
            || typeof body.compStableId !== "string") throw new TypeError("Local render needs a bounded time window and compStableId.");
          return { result: await driver.renderWindow({ sessionId: assignment!.sessionId, attempt: 0,
            compStableId: body.compStableId, windowId: body.clipId ?? job.jobId, startMs: body.startMs, endMs: body.endMs,
            resolutionScale: body.resolutionScale ?? 1, forceRender: body.forceRender, forceRenderReason: body.forceRenderReason }) };
        }
        if (!assignment!.finish) throw new TypeError("Scratch search requires a visual reference.");
        const search = await runPracticeScratchSearchV1({ body, sessionId: assignment!.sessionId,
          signal, renderDriver: driver });
        return { result: search, reviewRequired: true };
      },
    });
    await this.recordClipResearchExecution(admission, "HTTP_COMPLETED");
    return output;
  }

  async #dispatchWorkerProofScript(value: string, operationId: string) {
    const scriptPath = path.resolve(this.config.repositoryRoot, value);
    if (path.extname(scriptPath).toLowerCase() !== ".jsx" || !["scripts/windows", "proofs/artifacts"].some((directory) => {
      const relative = path.relative(path.resolve(this.config.repositoryRoot, directory), scriptPath);
      return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    })) throw new HttpError(400, "PROOF_SCRIPT_PATH_NOT_ALLOWED");
    await readFile(scriptPath, "utf8");
    const panel = this.config.broker.panelSession;
    if (!panel) throw new Error("CEP_PANEL_NOT_CONNECTED");
    const response = await this.config.broker.dispatch({ protocolVersion: panel.protocolVersion,
      requestId: operationId, transactionId: operationId, operationId,
      capabilityId: "internal.proof.eval_file", command: "proof.eval_file", payload: { scriptPath } });
    if (response.outcome !== "APPLIED") throw new Error("Queued native proof script failed: " + response.error?.message);
    return response;
  }

  async #assignmentForProductionBody(body: Record<string, any>): Promise<GptOrchestrationAssignmentV1 | null> {
    const assignmentId = typeof body?.researchContext?.assignmentId === "string" ? body.researchContext.assignmentId : null;
    return assignmentId === null ? null : await this.#gptStore.getAssignment(assignmentId);
  }

  async #withProductionOperation<T>(input: {
    readonly body: Record<string, any>;
    readonly category: "AE_MUTATION" | "RENDER" | "COMPARISON" | "PROOF_IO" | "INFRASTRUCTURE";
    readonly stage: any;
    readonly operation: string;
    readonly markConstructed?: boolean;
    readonly run: () => Promise<T>;
  }): Promise<T> {
    const assignment = await this.#assignmentForProductionBody(input.body);
    const releaseWriter = this.#reserveAeWriter(input.operation);
    if (!assignment || assignment.status !== "RUNNING" || assignment.sessionId !== this.#activeRunId) {
      releaseWriter();
      throw new HttpError(409, "AE execution requires the active RUNNING production assignment.");
    }
    try {
    const { file, coordinator } = await this.#productionCoordinator(assignment);
    const phaseIds: string[] = [...new Set<string>([
      ...(input.body?.researchContext?.clipIds ?? []),
      ...(input.body?.researchContext?.plans ?? []).map((plan: any) => plan.clipId),
    ])];
    coordinator.ensurePhases(phaseIds);
    await this.#synchronizeProductionSources(assignment, { file, coordinator });
    const productionSnapshot = coordinator.snapshot();
    if (productionSnapshot.phases.some((phase) => phase.sourceValidationRequired
      && (!phaseIds.length || phaseIds.includes(phase.phaseId)))) {
      throw new HttpError(409, "SOURCE_CHANGED_REQUIRES_VALIDATION: rerun source validation before AE writes.");
    }
    if (input.category === "AE_MUTATION") coordinator.invalidate(phaseIds.filter((id) =>
      ["CONSTRUCTED", "PROVISIONAL_PASS", "PROVEN"].includes(productionSnapshot.phases.find((phase) => phase.phaseId === id)?.state ?? "")), "PROOF");
    coordinator.setStage(input.stage, phaseIds.length === 1 ? phaseIds[0]! : null);
    coordinator.heartbeat(input.operation);
    await file.save(coordinator);
    const startedAtMs = Date.now();
    const heartbeatTimer = setInterval(() => {
      coordinator.heartbeat(input.operation);
      void file.save(coordinator).catch(() => undefined);

    }, 20_000);
    heartbeatTimer.unref?.();
    try {
      const scope = { key: randomUUID(), jobId: input.operation, body: input.body };
      this.#childProofScope = scope;
      const result = await productionJobScopeV1.run({
        EDITFLOW_WORKER_PROOF_URL: `http://127.0.0.1:${this.#port}/v1/product/production/worker-proof`,
        EDITFLOW_WORKER_PROOF_KEY: scope.key, EDITFLOW_WORKER_PRODUCT_TOKEN: this.config.token,
      }, input.run);
      const success = (result as any)?.state === "COMMITTED" || (result as any)?.result?.state === "COMMITTED"
        || (result as any)?.status === "COMPLETED" || (result as any)?.outcome === "APPLIED";
      if (input.category === "AE_MUTATION" && (!Array.isArray((result as any)?.readbacks)
        || (result as any).readbacks.some((r: any) => r.outcome !== "NO_OP"))) {
        coordinator.invalidateVisualDecisions(phaseIds, visualMutationDimensionsV1(input.body), null, input.operation);
      }
      if (input.markConstructed && success) {
        // Once committed, readback/checkpoint errors are warnings, never replayable failures.
        try {
          // One fresh observation serves phase readback, the response and checkpoint.
          const driver = new ChatgptAeRenderDriverV1({ transport: this.config.broker,
            projectId: "practice-gpt-controller", artifactDir: assignment.artifactDir });
          const observed = await driver.client.observe(driver.projectId);
          const revision = observed.hostRevision;
          const readbacks = (result as any)?.readbacks;
          if (!Array.isArray(readbacks) || readbacks.some((r: any) => r.outcome !== "NO_OP")) {
            coordinator.invalidateVisualDecisions(phaseIds, visualMutationDimensionsV1(input.body), revision, input.operation);
          }
          for (const phaseId of phaseIds) coordinator.markConstructed(phaseId, revision);
          const phases = coordinator.snapshot().phases;
          if (phases.length && phases.every(phase => phase.sourceCertificateKey
            && ["CONSTRUCTED", "PROVISIONAL_PASS", "PROVEN"].includes(phase.state))) coordinator.markWholeEditCovered(revision);
          const target = ((result as any).result ?? result);
          target.currentState = projectStateSummaryV1(observed);
          const projectPath = path.join(assignment.artifactDir, "production-checkpoint.aep");
          const saved = await driver.client.executePublicAtKnownHostRevision("project.save", {
            transactionId: input.operation + ":checkpoint", operationId: input.operation + ":checkpoint",
            payload: { path: projectPath }, expectedHostProjectRevision: observed.hostRevision,
          });
          if (saved.outcome !== "APPLIED" && saved.outcome !== "NO_OP") throw new Error("AE checkpoint save failed: " + saved.outcome);
          const savedRevision = saved.hostProjectRevision ?? observed.hostRevision;
          target.currentState.projectRevision = "ae-revision:" + savedRevision;
          const savedProject = { ...observed.project, hostRevision: savedRevision, filePath: typeof saved.readback?.["filePath"] === "string" ? saved.readback["filePath"] as string : projectPath };
          const savedFingerprint = computeProjectFingerprint(toAeStructuralFingerprintInput(savedProject));
          target.currentState.filePath = savedProject.filePath;
          target.currentState.projectFingerprint = savedFingerprint;
          this.#fastRuntime?.session.runner.acceptObservation({ ...observed, hostRevision: savedRevision,
            observed: { ...observed.observed, projectRevision: ("ae-revision:" + savedRevision) as any, projectFingerprint: savedFingerprint },
            project: savedProject });
          target.nextAction = "Choose the next edit or inspect the returned changes; no separate checkpoint or proof receipt is required.";
          coordinator.markAeCheckpoint({ projectPath, projectRevision: saved.hostProjectRevision });
          ((result as any).result ?? result).checkpoint = { saved: true, projectPath };
        } catch (error) {
          ((result as any).result ?? result).checkpoint = { saved: false, warning: error instanceof Error ? error.message : String(error) };
        }
      }
      await file.appendTelemetry(practiceTelemetrySpanV1({
        spanId: randomUUID(), sessionId: assignment.sessionId, category: input.category,
        stage: input.stage, phaseId: phaseIds.length === 1 ? phaseIds[0]! : null,
        startedAtMs, endedAtMs: Date.now(), outcome: "SUCCESS", detail: input.operation, activity: "MACHINE_WAIT", purpose: input.category === "AE_MUTATION" ? "PRODUCTION" : input.category === "RENDER" ? "REVIEW" : "PREPARATION",
      }));
      return result;
    } catch (error) {
      if (input.category === "AE_MUTATION" && !(error instanceof Error && error.constructor.name === "ProductionNoWriteErrorV1")) {
        coordinator.invalidateVisualDecisions(phaseIds, visualMutationDimensionsV1(input.body), null, input.operation);
      }
      await file.appendTelemetry(practiceTelemetrySpanV1({
        spanId: randomUUID(), sessionId: assignment.sessionId, category: input.category,
        stage: input.stage, phaseId: phaseIds.length === 1 ? phaseIds[0]! : null,
        startedAtMs, endedAtMs: Date.now(), outcome: "FAILED", activity: "MACHINE_WAIT", purpose: input.category === "AE_MUTATION" ? "PRODUCTION" : input.category === "RENDER" ? "REVIEW" : "PREPARATION",
        detail: input.operation + ": " + (error instanceof Error ? error.message : String(error)),
      }));
      throw error;
    } finally {
      await this.#childProofTail.catch(() => undefined);
      this.#childProofScope = null;
      clearInterval(heartbeatTimer);
      coordinator.heartbeat(null);
      await file.save(coordinator);
    }
    } finally { releaseWriter(); }
  }

  get port(): number { return this.#port; }
  get isStarted(): boolean { return this.#server !== null; }
  get activeRunId(): string | null { return this.#activeRunId; }

  async start(): Promise<number> {
    if (this.#server !== null) return this.#port;
    this.#supervision?.acquireGateway();
    await this.#gptStore.refreshActiveProductionInstructions();
    await this.#recoverRuns();
    await this.#productionWorker.load();
    for (const job of this.#productionWorker.list()) {
      if ((job.payload as Record<string, any>).workflowContext?.workflowId === undefined) this.#legacyWorkflowReceiptIds.add(job.jobId);
    }
    if (this.#supervision) await this.#supervisionSnapshot();
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
    await this.#productionWorker.start();
    for (const assignment of await this.#gptStore.listAssignments({ mode: "PRACTICE", statuses: ["PENDING", "RUNNING"] })) {
      if (assignment.preflight !== undefined && assignment.preflight.stage !== "READY"
        && assignment.preflight.stage !== "BLOCKED") this.#schedulePreflight(assignment.assignmentId);
    }
    return this.#port;
  }

  async stop(): Promise<void> {
    await this.#sourceAssembly.stop();
    await this.#sourceMatch.stop();
    await this.#productionWorker.stop();
    for (const job of this.#preflightJobs.values()) job.abort.abort();
    await Promise.allSettled([...this.#preflightJobs.values()].map((job) => job.promise));
    const server = this.#server;
    this.#server = null;
    if (server !== null) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    }
    this.#port = 0;
    this.#supervision?.releaseGateway();
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

  async observeCurrentAe() {
    return await (await this.#ensureFastRuntime()).refresh();
  }

  controlStatus() {
    return { ...PRIMARY_WORKFLOW_ROUTING_V1, productionWorkflow: PRODUCTION_WORKFLOW_CONTRACT_V1, editorialAuthority: CHATGPT_EDITORIAL_AUTHORITY_V1, practiceNotebook: CHATGPT_PRACTICE_NOTEBOOK_CONTRACT_V1, primaryProductionSystem: PRIMARY_EDIT_PRODUCTION_SYSTEM_V1,
      executionMode: PRIMARY_EDIT_PRODUCTION_SYSTEM_V1, sourceMatch: SOURCE_MATCH_CONTRACT_V1, sourceAssembly: SOURCE_ASSEMBLY_CONTRACT_V1,
      hostRevision: this.#fastRuntime?.session.runner.hostRevision ?? null,
      adapterBuild: this.#fastRuntime?.session.adapterBuild ?? null,
      localRuntime: this.#fastRuntime?.status() ?? null,
      currentTransactionRuntime: this.#transactionRuntime.status(),
      productionSupervisor: this.#supervision?.publicState() ?? null,
      userControls: { contract: PRODUCTION_USER_CONTROL_CONTRACT_V1, active: this.#userControls.active(), latest: this.#userControls.latest() },
      mutationLease: { held: this.#aeWriterOwner !== null, owner: this.#aeWriterOwner, expiresAt: null } };
  }

  async #connectionPreflight(): Promise<PracticeConnectionPreflightV1> {
    const checks: PracticeConnectionPreflightCheckV1[] = [{
      id: "PRODUCT_SERVICE",
      ready: this.isStarted,
      detail: this.isStarted
        ? "Practice product service is listening."
        : "Practice product service is not listening.",
    }];
    checks.push({
      id: "CEP_BROKER",
      ready: this.config.broker.isStarted,
      detail: this.config.broker.isStarted
        ? "EditFlow CEP broker is listening on 127.0.0.1:" + String(this.config.broker.port) + "."
        : "EditFlow CEP broker is not listening.",
    });
    const panel = this.config.broker.panelSession;
    checks.push({
      id: "CEP_PANEL",
      ready: panel !== null,
      detail: panel === null
        ? "After Effects CEP panel is missing or stale."
        : "After Effects CEP panel is live; protocol=" + panel.protocolVersion
          + " extension=" + panel.extensionVersion + ".",
    });

    if (this.config.broker.isStarted && panel !== null) {
      try {
        const state = await this.#transactionRuntime.observe();
        checks.push({
          id: "AFTER_EFFECTS_READBACK",
          ready: true,
          detail: "Live After Effects readback succeeded; revision=" + state.projectRevision + ".",
        });
      } catch (error) {
        checks.push({
          id: "AFTER_EFFECTS_READBACK",
          ready: false,
          detail: "Live After Effects readback failed: "
            + (error instanceof Error ? error.message : String(error)),
        });
      }
    } else {
      checks.push({
        id: "AFTER_EFFECTS_READBACK",
        ready: false,
        detail: "Live After Effects readback was not attempted because the CEP path is not ready.",
      });
    }

    return {
      schema: "editflow.connection-preflight.v1",
      status: checks.every((check) => check.ready) ? "READY" : "BLOCKED",
      checkedAt: new Date().toISOString(),
      repairPolicy: "GPT_AUTO_REPAIR_THEN_RESUME",
      checks,
    };
  }

  async #requireConnectionPreflight(): Promise<PracticeConnectionPreflightV1> {
    const preflight = await this.#connectionPreflight();
    if (preflight.status === "READY") return preflight;
    const failed = preflight.checks
      .filter((check) => !check.ready)
      .map((check) => check.id + ": " + check.detail)
      .join(" ");
    throw new HttpError(
      409,
      "CONNECTION_PREFLIGHT_BLOCKED: " + failed
        + " GPT must automatically pause assignment work, use Desktop Commander to restore the failed connection legs, "
        + "rerun the full preflight, verify READY, and then resume from the last safe checkpoint without waiting for user confirmation. No assignment was created.",
    );
  }

  #setHeaders(res: ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-EditFlow-Token, X-EditFlow-Worker-Credential");
    res.setHeader("Cache-Control", "no-store");
  }

  #authorized(req: IncomingMessage): boolean {
    const provided = header(req.headers["x-editflow-token"]);
    return provided.length > 0 && secureTokenEqual(this.config.token, provided);
  }

  async #editTypes(): Promise<EditTypeRegistryFileV1> {
    return new EditTypeRegistryFileV1(this.config.editTypeRegistryFilePath);
  }

  #humanReviewPath(sessionId: string): string {
    const safeSession = sessionId.replace(/[^a-zA-Z0-9._-]+/g, "-");
    return path.join(this.config.artifactDir, "human-reviews", safeSession + ".json");
  }

  async #loadHumanReview(sessionId: string): Promise<PracticeHumanReviewV1 | null> {
    try {
      const parsed = JSON.parse(await readFile(this.#humanReviewPath(sessionId), "utf8")) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      const review = parsed as Partial<PracticeHumanReviewV1>;
      if (review.schema !== "editflow.practice-human-review.v1"
        || review.sessionId !== sessionId) return null;
      return review as PracticeHumanReviewV1;
    } catch {
      return null;
    }
  }

  async #recoverRuns(): Promise<void> {
    const assignments = await this.#gptStore.listAssignments();
    if (assignments.length === 0) {
      this.#activeRunId = null;
      return;
    }
    const editTypes = await this.#editTypes();
    const registry = await editTypes.load();
    let active: GptOrchestrationAssignmentV1 | null = null;
    for (const assignment of assignments) {
      const existing = this.#runs.get(assignment.sessionId);
      if (existing === undefined) {
        const events = await this.#gptStore.eventsForSession(assignment.sessionId);
        const masteryRecord = registry.knowledge(assignment.editTypeId)
          ?.gptLearning.masteryRecords.find((item) => item.sessionId === assignment.sessionId);
        const startVideos = assignment.start
          .filter((item) => item.mediaKind === "VIDEO")
          .map((item) => item.uri);
        const startAudio = assignment.start
          .filter((item) => item.mediaKind === "AUDIO")
          .map((item) => item.uri);
        this.#runs.set(assignment.sessionId, {
          sessionId: assignment.sessionId,
          assignmentId: assignment.assignmentId,
          mode: assignment.mode,
          practiceRole: assignment.practiceRole,
          editTypeId: assignment.editTypeId,
          state: assignmentRunState(assignment.status),
          ...(assignment.preflight === undefined ? {} : { preflight: assignment.preflight }),
          stage: events.at(-1)?.stage ?? null,
          startedAt: assignment.startedAt ?? assignment.createdAt,
          completedAt: assignment.completedAt,
          finishPath: assignment.finish?.uri ?? null,
          videoPaths: startVideos,
          audioPaths: startAudio,
          result: null,
          allocation: null,
          masteryScope: masteryRecord?.scope ?? null,
          masteryProofRef: masteryRecord?.proofRef ?? null,
          masteryReasons: [],
          finalRenderRef: assignment.finalRenderRef,
          humanReview: await this.#loadHumanReview(assignment.sessionId),
          finalSummary: assignment.finalSummary,
          error: assignment.error,
        });
      }
      if (!["CANCELLED", "COMPLETED", "FAILED"].includes(assignment.status)) {
        active = assignment;
      }
    }
    this.#activeRunId = active?.sessionId ?? null;
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
    const practiceRoleValue = optionalString(body, "practiceRole") ?? "AUTO";
    if (practiceRoleValue !== "AUTO"
      && practiceRoleValue !== "LEARNING"
      && practiceRoleValue !== "HELD_OUT_CERTIFICATION") {
      throw new HttpError(
        400,
        "practiceRole must be AUTO, LEARNING, or HELD_OUT_CERTIFICATION.",
      );
    }
    const practiceRole = practiceRoleValue === "AUTO"
      ? null
      : practiceRoleValue as PracticeRunRoleV1;
    const minimumSimilarity = optionalNumber(body, "minimumSimilarity", 0, 1);
    const stretchSimilarity = optionalNumber(body, "stretchSimilarity", 0, 1);
    const maxAttempts = optionalNumber(body, "maxAttempts", 1, 20, true);
    const exactSceneConfidence = optionalNumber(body, "exactSceneConfidence", 0, 1);
    const minimumAudioConfidence = optionalNumber(body, "minimumAudioConfidence", 0, 1);
    return {
      editTypeId: requiredString(body, "editTypeId"),
      ...(editTypeTitle === undefined ? {} : { editTypeTitle }),
      practiceRole,
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

  async #startPractice(body: Record<string, unknown>, plannedSessionId?: string): Promise<PracticePanelRunSnapshotV1> {
    if (this.#userControls.active() && plannedSessionId !== this.#userControls.active()?.plannedSessionId) {
      throw new HttpError(409, "USER_CONTROL_ALREADY_PENDING: finish the requested lifecycle action first.");
    }
    if (this.#startingPractice !== null) return await this.#startingPractice;
    const pending = this.#createPractice(body, plannedSessionId);
    this.#startingPractice = pending;
    try { return await pending; } finally { this.#startingPractice = null; }
  }

  async #validatePracticeInput(body: Record<string, unknown>): Promise<void> {
    const request = await this.#parsePractice(body);
    const registry = await (await this.#editTypes()).load();
    if (registry.get(request.editTypeId)) return;
    if (request.editTypeTitle === undefined) {
      throw new HttpError(400, "EDIT_TYPE_NOT_FOUND: " + request.editTypeId
        + ". Choose a current preset and start a new Practice assignment in the Practice panel.");
    }
    // Validate an explicitly requested new preset without saving or restoring deleted data.
    registry.create({ editTypeId: request.editTypeId, title: request.editTypeTitle, choiceWords: [request.editTypeTitle] });
  }

  async #createPractice(body: Record<string, unknown>, plannedSessionId?: string): Promise<PracticePanelRunSnapshotV1> {
    if (this.#activeRunId !== null) {
      const active = this.#runs.get(this.#activeRunId);
      if (active?.mode === "PRACTICE" && (!plannedSessionId || active.sessionId === plannedSessionId)
        && !["CANCELLED", "COMPLETED", "FAILED"].includes(active.state)) {
        return await this.#syncRun(active.sessionId);
      }
      throw new HttpError(409, "EditFlow run already active: " + this.#activeRunId);
    }
    const request = await this.#parsePractice(body);
    const editTypesFile = await this.#editTypes();
    const registry = await editTypesFile.load();
    let editType = registry.get(request.editTypeId);
    if (editType === null) {
      if (request.editTypeTitle === undefined) {
        throw new HttpError(400, "EDIT_TYPE_NOT_FOUND: " + request.editTypeId
          + ". Choose a current preset and start a new Practice assignment in the Practice panel.");
      }
      editType = registry.create({
        editTypeId: request.editTypeId,
        title: request.editTypeTitle,
        choiceWords: [request.editTypeTitle],
        description: "Created from the EditFlow Practice panel.",
      });
    }

    const sessionId = plannedSessionId ?? "practice:" + randomUUID();
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
    const practiceRole = "LEARNING" as const;
    const knowledge = registry.knowledge(editType.editTypeId);
    const preflight: PracticePreflightCheckpointV1 = {
      stage: "PREFLIGHT_MATCHING", updatedAt: new Date().toISOString(),
      requireTransferNovelty: false,
      completedShotIds: [], unresolvedShotIds: [], reasons: [], evidenceRefs: [],
    };
    const assignment = await this.#gptStore.createAssignment({
      sessionId,
      mode: "PRACTICE",
      practiceRole,
      editTypeId: editType.editTypeId,
      finish,
      start,
      preflight,
      practiceSceneMatches: null,
      practicePolicy: {
        ...(request.minimumSimilarity === undefined
          ? {}
          : { minimumSimilarity: request.minimumSimilarity }),
        ...(request.exactSceneConfidence === undefined
          ? {}
          : { exactSceneConfidence: request.exactSceneConfidence }),
        ...(request.minimumAudioConfidence === undefined
          ? {}
          : { minimumAudioConfidence: request.minimumAudioConfidence }),
      },
      artifactDir,
      knowledge,
    });
    if (practiceRole === "LEARNING") {
      registry.beginGptLearningSession(editType.editTypeId, sessionId, "PRACTICE");
      await editTypesFile.save(registry);
    }

    const run: PracticePanelRunSnapshotV1 = {
      sessionId,
      assignmentId: assignment.assignmentId,
      mode: "PRACTICE",
      practiceRole,
      editTypeId: editType.editTypeId,
      state: "WAITING_FOR_GPT",
      preflight,
      stage: null,
      startedAt: assignment.createdAt,
      completedAt: null,
      finishPath: request.finishPath,
      videoPaths: request.videoPaths,
      audioPaths: request.audioPaths ?? [],
      result: null,
      allocation: null,
      masteryScope: null,
      masteryProofRef: null,
      masteryReasons: [],
      finalRenderRef: null,
      humanReview: null,
      finalSummary: null,
      error: null,
    };
    this.#activeRunId = sessionId;
    this.#runs.set(sessionId, run);
    this.#schedulePreflight(assignment.assignmentId);
    return snapshot(run);
  }

  #schedulePreflight(assignmentId: string): void {
    if (this.#preflightJobs.has(assignmentId)) return;
    const abort = new AbortController();
    this.#preflightErrors.delete(assignmentId);
    const promise = Promise.resolve().then(() => this.#runPreflight(assignmentId, abort.signal))
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        // A locked checkpoint must not turn the background worker into an unhandled rejection.
        // Keep the last durable assignment; expose the failure for a same-assignment retry.
        const message = error instanceof Error ? error.message : String(error);
        this.#preflightErrors.set(assignmentId, message);
        console.error("Practice preflight paused: " + message);
      })
      .finally(() => this.#preflightJobs.delete(assignmentId));
    this.#preflightJobs.set(assignmentId, { abort, promise });
  }

  async #runPreflight(assignmentId: string, signal: AbortSignal): Promise<void> {
    let assignment = await this.#gptStore.getAssignment(assignmentId);
    if (assignment?.preflight === undefined || assignment.finish === null
      || !["PENDING", "RUNNING"].includes(assignment.status) || assignment.preflight.stage === "READY") return;
    let checkpoint = assignment.preflight;
    const progress = async (stage: PracticePreflightCheckpointV1["stage"], matches?: readonly PracticeSceneMatchV1[], shotIds?: readonly string[]): Promise<void> => {
      signal.throwIfAborted();
      const retained = matches ?? assignment!.practiceSceneMatches ?? [];
      checkpoint = { ...checkpoint, stage, updatedAt: new Date().toISOString(), reasons: [],
        totalShotIds: shotIds ?? checkpoint.totalShotIds ?? retained.map((match) => match.shotId),
        completedShotIds: retained.filter((match) => match.workingMedia !== undefined
          && validatePracticeSceneMatchesV1([match.shotId], [match], assignment!.practicePolicy!.exactSceneConfidence).length === 0)
          .map((match) => match.shotId),
        unresolvedShotIds: (shotIds ?? checkpoint.totalShotIds ?? retained.map((match) => match.shotId)).filter((shotId) => {
          const match = retained.find((item) => item.shotId === shotId);
          return match === undefined || match.workingMedia === undefined
            || validatePracticeSceneMatchesV1([shotId], [match], assignment!.practicePolicy!.exactSceneConfidence).length > 0;
        }),
        evidenceRefs: [...new Set(retained.flatMap((match) => match.evidenceRefs))],
      };
      assignment = await this.#gptStore.updatePreflight(assignmentId, checkpoint, matches);
    };
    try {
      // Reference and raw-source analysis can proceed while AE is temporarily disconnected.
      const referenceAuthority = new ChatgptFootageBrowserV1({ artifactDir: path.join(assignment.artifactDir, "media"),
        analysisCacheDir: defaultPracticeAnalysisCacheDirectoryV1(),
        scriptPath: path.join(this.config.repositoryRoot, "scripts", "practice", "chatgpt-footage-browser.py") });
      const directReference = await referenceAuthority.readReference(assignment.finish);
      if (!directReference.shots.length) {
        await this.#gptStore.updatePreflight(assignmentId, { ...checkpoint, stage: "AWAITING_CHATGPT_REFERENCE", updatedAt: new Date().toISOString(),
          totalShotIds: [], completedShotIds: [], unresolvedShotIds: [], reasons: ["ChatGPT must inspect Finish and DEFINE_REFERENCE; automated cut detection and tail exclusion are retired."], evidenceRefs: directReference.evidenceRefs });
        return;
      }
      const preflightStartedAt = Date.now();
      const preparer = new ChatgptFootageBrowserV1({ artifactDir: path.join(assignment.artifactDir, "media"),
        materializeWorkingMedia: true, signal,
        analysisCacheDir: defaultPracticeAnalysisCacheDirectoryV1(),
        scriptPath: path.join(this.config.repositoryRoot, "scripts", "practice", "chatgpt-footage-browser.py"),
        ...(this.config.ffmpegPath ? { ffmpegPath: this.config.ffmpegPath } : {}) });
      const reference = await preparer.readReference(assignment.finish);
      await progress("SOURCE_INDEXING", undefined, reference.shots.map(s => s.shotId));
      const sourceIndex = await preparer.indexProvidedMedia(assignment.start);
      const choices = await preparer.prepareSelectedFootage({ reference, sourceIndex,
        minimumConfidence: assignment.practicePolicy?.exactSceneConfidence ?? .95,
        onProgress: async (matches, stage) => progress(stage, matches) });
      signal.throwIfAborted();
      const reasons = [...validatePracticeSceneMatchesV1(reference.shots.map(s => s.shotId), choices,
        assignment.practicePolicy?.exactSceneConfidence ?? .95), ...validatePracticeWorkingMediaMatchesV1(choices)];
      if (assignment !== null) {
        const { file, coordinator } = await this.#productionCoordinator(assignment);
        coordinator.setStage("SOURCE_LOCK");
        await file.appendTelemetry(practiceTelemetrySpanV1({ spanId: randomUUID(), sessionId: assignment.sessionId,
          category: "MEDIA_ANALYSIS", stage: "SOURCE_LOCK", startedAtMs: preflightStartedAt, endedAtMs: Date.now(), outcome: "SUCCESS",
          detail: "GPT-defined reference and source choices; metadata and exact selected-range preparation only" }));
        await file.save(coordinator);
      }
      const connection = await this.#connectionPreflight();
      signal.throwIfAborted();
      for (const check of connection.checks.filter((item) => !item.ready)) reasons.push(check.id + ": " + check.detail);
      const unresolvedShotIds = reference.shots.filter(shot => !choices.some(m => m.shotId === shot.shotId && m.workingMedia)).map(s => s.shotId);
      await progress("WORKING_MEDIA", choices);
      checkpoint = { ...checkpoint, stage: reasons.length === 0 ? "READY" : unresolvedShotIds.length > 0 ? "AWAITING_CHATGPT_SHOTS" : "BLOCKED",
        updatedAt: new Date().toISOString(), unresolvedShotIds, reasons: [...new Set(reasons)], evidenceRefs: checkpoint.evidenceRefs };
      await this.#gptStore.updatePreflight(assignmentId, checkpoint, choices);
    } catch (error) {
      if (signal.aborted) return; // Shutdown/cancel preserves the last durable operation for the next controller.
      await this.#gptStore.updatePreflight(assignmentId, { ...checkpoint, stage: "BLOCKED",
        updatedAt: new Date().toISOString(), reasons: [error instanceof Error ? error.message : String(error)] });
    }
  }

  async assertPracticeReconstructionReady(): Promise<void> {
    if (this.#activeRunId === null) return;
    const run = this.#runs.get(this.#activeRunId);
    if (run === undefined) throw new HttpError(409, "Active assignment is unavailable.");
    const assignment = await this.#gptStore.getAssignment(run.assignmentId);
    if (!assignment) throw new HttpError(409, "Active assignment is unavailable.");
    const matches = assignment.practiceSceneMatches ?? [];
    const shotIds = assignment.preflight?.totalShotIds ?? [];
    if (assignment.mode === "PRACTICE") {
      if (assignment.preflight?.stage !== "READY" || !shotIds.length || !matches.length) throw new HttpError(409, "Practice reconstruction is locked until ChatGPT defines reference and source choices.");
      if (!assignment.finish) throw new HttpError(409, "Practice needs its retained Finish reference.");
      const matcher = new ChatgptFootageBrowserV1({ artifactDir: path.join(assignment.artifactDir, "media"),
        scriptPath: path.join(this.config.repositoryRoot, "scripts", "practice", "chatgpt-footage-browser.py") });
      const reference = await matcher.readReference(assignment.finish);
      const sourceIndex = await matcher.indexProvidedMedia(assignment.start);
      const choices = await matcher.prepareSelectedFootage({ reference, sourceIndex, minimumConfidence: assignment.practicePolicy?.exactSceneConfidence ?? .95 });
      if (!reference.shots.length || JSON.stringify(reference.shots.map(s => s.shotId)) !== JSON.stringify(shotIds)
        || matches.some(m => !choices.some(c => c.shotId === m.shotId && c.chatgptSelection?.decisionId === m.chatgptSelection?.decisionId))) {
        throw new HttpError(409, "CHATGPT_REFERENCE_PLAN_REQUIRED: inspect and define Finish; reaffirm source choices after changed reference bounds. Retired cached cuts cannot authorize editing.");
      }
    }
    if (assignment.mode === "PRACTICE"
      && (assignment.preflight?.stage !== "READY" || !shotIds.length
        || !matches.length || new Set(matches.map((match) => match.shotId)).size !== matches.length
        || validatePracticeSceneMatchesV1(shotIds, matches, assignment.practicePolicy?.exactSceneConfidence ?? .95).length > 0
        || matches.some((match) => match.selectionMode !== "CHATGPT_DIRECT"
          || !hasVerifiedPracticeSourceIdentityV1(match)
          || !assignment.start.some((media) => media.mediaKind === "VIDEO"
            && media.role === "START_SOURCE" && media.mediaId === match.sourceId)))) {
      throw new HttpError(409, "Practice reconstruction is locked until preflight is READY; resume the retained assignment.");
    }
  }

  async assertClipResearchReady(body: Record<string, any>, allClips = false, queuedExecution = false): Promise<Record<string, any> | null> {
    if (this.#activeRunId === null) return null;
    const run = this.#runs.get(this.#activeRunId);
    if (run === undefined) throw new HttpError(409, "Active assignment is unavailable.");
    const assignment = await this.#gptStore.getAssignment(run.assignmentId);
    if (assignment === null) throw new HttpError(409, "Active assignment is unavailable.");
    try {
      const admitted = await this.#clipResearch.admit(assignment, body, queuedExecution);
      await this.#clipResearch.audit(assignment, admitted, "ADMITTED");
      return { ...admitted, assignment };
    } catch (error) { throw new HttpError(409, error instanceof Error ? error.message : String(error)); }
  }

  async recordClipResearchExecution(admission: Record<string, any> | null, outcome: string): Promise<void> {
    if (admission !== null) await this.#clipResearch.audit(admission.assignment, admission, outcome);
  }

  async #presetNotebookIndex(assignment: GptOrchestrationAssignmentV1) {
    const notebook = await this.#presetNotebook(assignment);
    return { authority: "CHATGPT_DIRECT", editTypeId: assignment.editTypeId, totalExamples: notebook.totalExamples,
      workedCount: notebook.workedCount, failedCount: notebook.failedCount,
      examples: notebook.examples.filter((example: any) => !example.superseded).map((example: any) => ({ lessonId: example.lessonId,
      title: example.title, outcome: example.outcome, recordedAt: example.recordedAt, methodAvailable: !!example.method })), detail: "INDEX",
      detailLookup: "Retrieve a GPT-chosen complete method through practice-notebook before adapting it." };
  }

  async #resumeHandshake(full = false): Promise<Record<string, unknown>> {
    const active = this.#activeRunId === null ? null : this.#runs.get(this.#activeRunId);
    const assignment = active === null || active === undefined ? null : await this.#gptStore.getAssignment(active.assignmentId);
    const events = assignment === null ? [] : await this.#gptStore.eventsForSession(assignment.sessionId);
    const preflight = assignment?.preflight ?? null;
    let production = null;
    if (assignment !== null) {
      const { file, coordinator } = await this.#productionCoordinator(assignment);
      production = coordinator.snapshot();
    }
    const nextOperation = assignment === null ? "START_PRACTICE"
      : assignment.status === "CANCEL_REQUESTED" ? "ACKNOWLEDGE_CANCELLATION"
      : (assignment.practiceSceneMatches?.length ?? 0) > 0 ? "RESUME_GPT_EDITING_FROM_CHECKPOINT"
      : preflight?.stage === "AWAITING_CHATGPT_REFERENCE" ? "CHATGPT_INSPECT_AND_DEFINE_REFERENCE"
      : preflight?.stage === "AWAITING_CHATGPT_SHOTS" ? "CHATGPT_INSPECT_AND_SELECT_RAW_SHOTS"
      : preflight !== null && preflight.stage !== "READY" ? "RESUME_PREFLIGHT"
      : "RESUME_GPT_EDITING_FROM_CHECKPOINT";
    const jobs = productionJobsViewV1(assignment ? this.#productionWorker.list(assignment.assignmentId) : [], full);
    return {
      schema: "editflow.practice-resume.v1", runtimeId: "DIRECT_EDITING_V1",
      ...PRIMARY_WORKFLOW_ROUTING_V1, productionWorkflow: PRODUCTION_WORKFLOW_CONTRACT_V1,
      buildId: this.config.buildId ?? null, panel: this.config.broker.panelSession,
      aeConnection: this.config.broker.panelSession === null ? "DISCONNECTED" : "CEP_CONNECTED",
      repositoryRoot: this.config.repositoryRoot, statePath: this.#gptStore.filePath,
      panelConnected: this.config.broker.panelSession !== null,
      assignment: assignmentViewV1(assignment, full), preflight: assignmentViewV1(assignment, full)?.preflight ?? null, checkpoint: events.at(-1) ?? null, nextOperation,
      clipResearch: full && assignment !== null ? this.#clipResearch.publicView(await this.#clipResearch.snapshot(assignment)) : { advisory: true, detailLookup: "clip-research" },
      production: productionSnapshotViewV1(production, full),
      workerRunning: assignment !== null && (
        this.#preflightJobs.has(assignment.assignmentId)
        || this.#productionWorker.list(assignment.assignmentId).some((job) => job.status === "RUNNING")
        || production?.inFlightOperation != null && Date.now() - Date.parse(production.workerHeartbeatAt ?? "") < 60_000
      ),
      productionJobs: jobs.jobs, totalJobs: jobs.totalJobs, unresolvedJobIds: jobs.unresolvedJobIds, latestWholeRenderJobId: jobs.latestWholeRenderJobId,
      historyAvailable: true,
      editorialAuthority: CHATGPT_EDITORIAL_AUTHORITY_V1,
      practiceNotebook: assignment ? (full ? await this.#presetNotebook(assignment) : await this.#presetNotebookIndex(assignment)) : null,
      footageSelection: CHATGPT_FOOTAGE_SELECTION_CONTRACT_V1,
      workerError: assignment === null ? null : this.#preflightErrors.get(assignment.assignmentId) ?? null,
      userControls: { contract: PRODUCTION_USER_CONTROL_CONTRACT_V1, active: this.#userControls.active(), latest: this.#userControls.latest() },
      controllerRoute: "DESKTOP_COMMANDER_LOCAL_PRODUCT_API",
      resumeRequired: assignment !== null,
    };
  }

  async #syncRun(sessionId: string): Promise<PracticePanelRunSnapshotV1> {
    const run = this.#runs.get(sessionId);
    if (run === undefined) throw new HttpError(404, "EditFlow run not found.");
    const assignment = await this.#gptStore.getAssignment(run.assignmentId);
    if (assignment === null) throw new HttpError(404, "GPT assignment not found.");
    const events = await this.#gptStore.eventsForSession(sessionId);
    const latestEvent = events.at(-1);
    const state = assignmentRunState(assignment.status);
    const updated: PracticePanelRunSnapshotV1 = {
      ...run,
      ...(assignment.preflight === undefined ? {} : { preflight: assignment.preflight }),
      state,
      stage: latestEvent?.stage ?? run.stage,
      completedAt: assignment.completedAt,
      finalRenderRef: assignment.finalRenderRef,
      finalSummary: assignment.finalSummary,
      error: this.#preflightErrors.get(assignment.assignmentId) ?? assignment.error,
    };
    this.#runs.set(sessionId, updated);
    if (["CANCELLED", "COMPLETED", "FAILED"].includes(state)
      && this.#activeRunId === sessionId) {
      this.#activeRunId = null;
    }
    return snapshot(updated);
  }

  async #bestAttemptRenderPath(sessionId: string): Promise<string> {
    const run = await this.#syncRun(sessionId);
    const candidate = run.finalRenderRef ?? run.result?.bestAttempt?.renderRef ?? null;
    if (candidate === null) {
      throw new HttpError(404, "Best-attempt render is not available for this run.");
    }
    return await ensureFile(candidate, "Best-attempt render");
  }

  async #openBestAttempt(sessionId: string): Promise<PracticePanelRunSnapshotV1> {
    const renderPath = await this.#bestAttemptRenderPath(sessionId);
    const command = process.platform === "win32"
      ? "explorer.exe"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
    const child = spawn(command, [renderPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return await this.#syncRun(sessionId);
  }

  async #saveHumanReview(
    sessionId: string,
    body: Record<string, unknown>,
  ): Promise<PracticeHumanReviewV1> {
    const run = await this.#syncRun(sessionId);
    if (run.state !== "COMPLETED") {
      throw new HttpError(409, "Human review is available after the run completes.");
    }
    const renderPath = await this.#bestAttemptRenderPath(sessionId);
    const score = (name: string): number => {
      const value = optionalNumber(body, name, 1, 5, false);
      if (value === undefined) throw new HttpError(400, name + " is required.");
      return value;
    };
    const review: PracticeHumanReviewV1 = {
      schema: "editflow.practice-human-review.v1",
      sessionId,
      editTypeId: run.editTypeId,
      sceneFidelity: score("sceneFidelity"),
      timingPacing: score("timingPacing"),
      effectsTransitions: score("effectsTransitions"),
      visualFinish: score("visualFinish"),
      overall: score("overall"),
      notes: optionalString(body, "notes") ?? null,
      createdAt: new Date().toISOString(),
      evidenceRefs: [
        "practice-human-review:NON_AUTHORITATIVE_V1",
        "practice-human-review-render:" + renderPath,
      ],
    };
    const reviewPath = this.#humanReviewPath(sessionId);
    await mkdir(path.dirname(reviewPath), { recursive: true });
    const temporary = reviewPath + ".tmp-" + randomUUID();
    await writeFile(temporary, JSON.stringify(review, null, 2) + "\n", "utf8");
    await rename(temporary, reviewPath);
    this.#runs.set(sessionId, { ...run, humanReview: review });
    return review;
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

  #parseLearningEvent(
    assignmentId: string,
    body: Record<string, unknown>,
  ): GptAppendEventInputV1 {
    const stage = requiredString(body, "stage") as GptLearningStageV1;
    const allowedStages: readonly GptLearningStageV1[] = [
      "OBSERVATION", "INTERPRETATION", "HYPOTHESIS", "PLAN",
      "CAPABILITY_GAP", "RESEARCH", "CAPABILITY_IMPLEMENTATION",
      "CAPABILITY_PROOF", "SKILL_COMMIT", "AE_ACTION", "RENDER",
      "COMPARISON", "DIAGNOSIS", "CORRECTION", "RESULT", "LESSON",
    ];
    if (!allowedStages.includes(stage)) throw new HttpError(400, "Invalid GPT learning stage.");
    if (stage === "SKILL_COMMIT") throw new HttpError(410, "MACHINE_SKILL_PROMOTION_RETIRED: save your directly reviewed technique and exact steps in practice-notebook.");
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
    const appliedSkillIds = stringArray(body, "appliedSkillIds", false);
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
    if (researchSources?.some(source => source.tutorialCompilation !== undefined)) throw new HttpError(410, "Tutorial compilation is retired; retain your directly analyzed technique and sources.");
    if (stage === "CAPABILITY_IMPLEMENTATION" && capabilityGap === undefined) {
      throw new HttpError(
        400,
        "CAPABILITY_IMPLEMENTATION requires the originating capabilityGap.",
      );
    }
    if (stage === "CAPABILITY_PROOF" && capabilityGap === undefined) {
      throw new HttpError(400, "CAPABILITY_PROOF requires the originating capabilityGap.");
    }
    if (stage === "CAPABILITY_PROOF" && evidenceRefs.length === 0) {
      throw new HttpError(400, "CAPABILITY_PROOF requires evidenceRefs.");
    }
    return {
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
      ...(appliedSkillIds.length === 0 ? {} : { appliedSkillIds }),
      evidenceRefs,
    };
  }

  async #recordLearningEvents(
    assignmentId: string,
    bodies: readonly Record<string, unknown>[],
  ): Promise<GptOrchestrationAssignmentV1> {
    const inputs = bodies.map((body) => this.#parseLearningEvent(assignmentId, body));
    const events = await this.#gptStore.appendEvents(inputs);
    const assignment = await this.#gptStore.getAssignment(assignmentId);
    if (assignment === null) throw new HttpError(404, "GPT assignment not found.");
    {
      const file = await this.#editTypes();
      await file.update(registry => { for (const event of events) registry.recordGptLearningEvent(event); });
    }
    return assignment;
  }

  async #recordLearningEvent(
    assignmentId: string,
    body: Record<string, unknown>,
  ): Promise<GptOrchestrationAssignmentV1> {
    return await this.#recordLearningEvents(assignmentId, [body]);
  }

  async #presetNotebook(assignment: GptOrchestrationAssignmentV1, query = "") {
    const registry = await (await this.#editTypes()).load();
    const learning = registry.knowledge(assignment.editTypeId)?.gptLearning;
    return { contract: CHATGPT_PRACTICE_NOTEBOOK_CONTRACT_V1,
      ...practiceNotebookViewV1(assignment.editTypeId, learning?.workedExamples ?? [], query),
      successLessons: learning?.successLessons ?? [], failureAvoidanceLessons: learning?.failureAvoidanceLessons ?? [],
      learnedSkills: learning?.learnedSkills ?? [], reviews: learning?.chatgptReviews ?? [] };
  }

  #renderJobMedia(assignment: GptOrchestrationAssignmentV1, jobId: string): PracticeMediaInputV1 {
    const job = this.#productionWorker.list(assignment.assignmentId).find(j => j.jobId === jobId);
    const result = job?.result as any;
    const renderPath = result?.renderPath;
    if (!job || job.kind !== "LOCAL_RENDER" || !["SUCCEEDED", "REVIEW_REQUIRED"].includes(job.status) || typeof renderPath !== "string") throw new TypeError("Use an actual retained LOCAL_RENDER job for this assignment.");
    return { mediaId: "render:" + jobId, role: "START_SOURCE", mediaKind: "VIDEO", uri: renderPath };
  }

  async #retainVisualReview(assignment: GptOrchestrationAssignmentV1, input: Record<string, any>): Promise<void> {
    const media = this.#renderJobMedia(assignment, input?.renderJobId);
    const job = this.#productionWorker.list(assignment.assignmentId).find(j => j.jobId === input.renderJobId)!;
    const revision = (job.result as any)?.sourceRevision;
    const review = parseVisualReviewV1(input, typeof revision === "number" ? revision : NaN,
      JSON.stringify([revision, job.payload.compStableId, job.payload.startMs, job.payload.endMs, job.payload.resolutionScale ?? 1]));
    const { file, coordinator } = await this.#productionCoordinator(assignment);
    const knownIds = coordinator.snapshot().phases.map(p => p.phaseId);
    const matcher = new ChatgptFootageBrowserV1({ artifactDir: path.join(assignment.artifactDir, "media"),
      scriptPath: path.join(this.config.repositoryRoot, "scripts", "practice", "chatgpt-footage-browser.py") });
    const reference = assignment.finish ? await matcher.readReference(assignment.finish) : null;
    for (const observation of review.observations) {
      if (!knownIds.includes(observation.clipId)) throw new HttpError(400, "VISUAL_REVIEW_UNKNOWN_CLIP");
      const bounds = reference?.shots.find(s => s.shotId === observation.clipId);
      if (assignment.finish && !bounds) throw new HttpError(400, "VISUAL_REVIEW_UNKNOWN_REFERENCE_SHOT");
      validateVisualComparisonTimesV1(observation, Number(job.payload.startMs), Number(job.payload.endMs), bounds);
      for (const comparison of observation.comparisons) {
        await matcher.verifyFootageInspection(media, comparison.renderEvidenceId, comparison.renderTimeMs);
        if (assignment.finish) {
          await matcher.verifyFootageInspection(assignment.finish, comparison.referenceEvidenceId!, comparison.referenceTimeMs!);
        }
      }
    }
    // Resolve only opaque writes whose retained terminal receipt precedes this render.
    // Source changes and unresolved jobs remain stale; a judgment never clears a held queue.
    for (const [key, change] of Object.entries(coordinator.snapshot().visualContinuity?.mutations ?? {})) {
      const mutation = this.#productionWorker.list(assignment.assignmentId).find(j => j.jobId === change.jobId);
      if (change.revision === null && mutation?.status === "SUCCEEDED" && Date.parse(mutation.updatedAt) <= Date.parse(job.createdAt)) {
        const split = key.lastIndexOf(":");
        coordinator.invalidateVisualDecisions([key.slice(0, split)], [key.slice(split + 1) as any], review.sourceRevision, change.jobId);
      }
    }
    coordinator.retainVisualReview(review);
    await file.save(coordinator);
  }

  async #completeAssignment(assignmentId: string, body: Record<string, any>): Promise<PracticePanelRunSnapshotV1> {
    const assignment = await this.#gptStore.getAssignment(assignmentId);
    if (!assignment || assignment.status !== "RUNNING") throw new HttpError(409, "Resume the active assignment before final review.");
    const lease = assignment.controllerLease;
    if (!lease || lease.owner !== body.claimedBy || Date.parse(lease.expiresAt) <= Date.now()) throw new HttpError(409, "Final review requires the current ChatGPT controller.");
    const production = await this.#productionCoordinator(assignment);
    const review = body.finalReview;
    if (typeof body.success !== "boolean" || review?.authority !== "CHATGPT_DIRECT" || !["PASS", "REVISE"].includes(review.verdict)
      || body.success !== (review.verdict === "PASS") || !Array.isArray(review.remainingIssues)
      || review.remainingIssues.some((x: any) => typeof x !== "string") || body.success && review.remainingIssues.length) throw new HttpError(400, "Provide a direct ChatGPT final review; unresolved issues require REVISE.");
    const jobs = this.#productionWorker.list(assignmentId);
    if (jobs.some(j => ["PENDING", "RUNNING", "REVIEW_REQUIRED", "RECONCILE_REQUIRED", "FAILED"].includes(j.status))) throw new HttpError(409, "Review/reconcile all retained jobs before completion.");
    if (assignment.mode === "PRACTICE") await this.assertPracticeReconstructionReady();
    const renderMedia = this.#renderJobMedia(assignment, requiredString(review, "renderJobId"));
    const renderJob = jobs.find(j => j.jobId === review.renderJobId)!;
    if (((renderJob.payload as Record<string, any>).resolutionScale ?? 1) !== 1) throw new HttpError(400, "Final acceptance requires a full-resolution render; construction previews remain review evidence only.");
    if (assignment.mode === "PRACTICE" && assignment.finish) {
      const reference = await new ChatgptFootageBrowserV1({ artifactDir: path.join(assignment.artifactDir, "media"),
        scriptPath: path.join(this.config.repositoryRoot, "scripts", "practice", "chatgpt-footage-browser.py") }).readReference(assignment.finish);
      const payload = renderJob.payload as Record<string, any>;
      if (payload.startMs !== 0 || Math.abs(payload.endMs - reference.video!.durationMs) > 1) throw new HttpError(400, "Final review requires a whole-edit LOCAL_RENDER covering the ChatGPT-defined duration.");
    }
    const renderRef = await ensureFile(renderMedia.uri, "Actual final render");
    const sha = createHash("sha256").update(await readFile(renderRef)).digest("hex");
    if (sha !== review.renderSha256) throw new HttpError(409, "Final render changed since ChatGPT review.");
    const renderDriver = new ChatgptAeRenderDriverV1({ transport: this.config.broker, projectId: "practice-gpt-controller", artifactDir: assignment.artifactDir });
    if (!await renderDriver.isPreviewCurrent(renderRef)) throw new HttpError(409, "FINAL_RENDER_STALE: render the current edit before final acceptance.");
    for (const field of ["shots", "timing", "audio", "framing", "effects", "transitions", "color"]) requiredString(review.checks ?? {}, field);
    if (!Array.isArray(review.comparisons) || !review.comparisons.length) throw new HttpError(400, "Retain actual render pixel comparisons for every chosen shot.");
    const matcher = new ChatgptFootageBrowserV1({ artifactDir: path.join(assignment.artifactDir, "media"),
      scriptPath: path.join(this.config.repositoryRoot, "scripts", "practice", "chatgpt-footage-browser.py") });
    const requiredIds = assignment.mode === "PRACTICE" ? (assignment.practiceSceneMatches ?? []).map(m => m.shotId)
      : production.coordinator.snapshot().phases.map(phase => phase.phaseId);
    if (requiredIds.some(id => !review.comparisons.some((c: any) => c.clipId === id))) throw new HttpError(400, "Review every retained shot/clip; do not omit failed regions.");
    const evidenceRefs: string[] = [];
    for (const comparison of review.comparisons) {
      requiredString(comparison, "observation");
      await matcher.verifyFootageInspection(renderMedia, comparison.renderEvidenceId, comparison.renderTimeMs);
      evidenceRefs.push("footage-inspection:" + comparison.renderEvidenceId);
      if (assignment.finish) {
        const shot = (assignment.practiceSceneMatches ?? []).find(m => m.shotId === comparison.clipId);
        const reference = await matcher.readReference(assignment.finish);
        const bounds = reference.shots.find(s => s.shotId === shot?.shotId);
        if (!bounds || comparison.referenceTimeMs < bounds.referenceStartMs || comparison.referenceTimeMs >= bounds.referenceEndMs
          || comparison.renderTimeMs < bounds.referenceStartMs || comparison.renderTimeMs >= bounds.referenceEndMs) throw new HttpError(400, "Review reference and rendered pixels inside the corresponding chosen shot.");
        await matcher.verifyFootageInspection(assignment.finish, comparison.referenceEvidenceId, comparison.referenceTimeMs);
        evidenceRefs.push("footage-inspection:" + comparison.referenceEvidenceId);
      }
    }
    const summary = requiredString(body, "finalSummary");
    const proofPath = path.join(assignment.artifactDir, "chatgpt-final-review.json");
    await writeFile(proofPath, JSON.stringify({ ...review, assignmentId, sessionId: assignment.sessionId, reviewedAt: new Date().toISOString() }) + "\n", { encoding: "utf8", flush: true });
    if (assignment.mode === "PRACTICE") {
      const file = await this.#editTypes();
      await file.update(registry => registry.recordChatgptReview(assignment.editTypeId, { sessionId: assignment.sessionId, verdict: review.verdict,
        renderRef, renderSha256: sha, summary, evidenceRefs, reviewedAt: new Date().toISOString() }));
    }
    await this.#gptStore.complete(assignmentId, { success: body.success, finalSummary: summary + " Direct ChatGPT final review: " + review.verdict + ".", finalRenderRef: renderRef });
    const run = this.#runs.get(assignment.sessionId);
    if (run) this.#runs.set(assignment.sessionId, { ...run, masteryProofRef: proofPath, masteryReasons: review.remainingIssues });
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
    this.#preflightJobs.get(run.assignmentId)?.abort.abort();
    await this.#productionWorker.cancel(run.assignmentId);
    return await this.#syncRun(sessionId);
  }

  async #startProCreation(
    body: Record<string, unknown>,
  ): Promise<PracticePanelRunSnapshotV1> {
    if (this.#userControls.active()) throw new HttpError(409, "USER_CONTROL_ALREADY_PENDING");
    if (this.#activeRunId !== null) {
      throw new HttpError(409, "EditFlow run already active: " + this.#activeRunId);
    }
    await this.#requireConnectionPreflight();
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
      practiceRole: null,
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
      masteryScope: null,
      masteryProofRef: null,
      masteryReasons: [],
      finalRenderRef: null,
      humanReview: null,
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

  async #dismissBlockedUserControl(receipt: ProductionUserControlReceiptV1): Promise<ProductionUserControlReceiptV1> {
    if (receipt.status !== "BLOCKED" || !["QUEUED", "PREPARING"].includes(receipt.step)
      || receipt.assignmentId || receipt.generation !== null || receipt.tabId !== null) {
      throw new HttpError(409, "USER_CONTROL_DISMISS_REQUIRES_UNCREATED_TARGET");
    }
    if (receipt.step !== "QUEUED") {
      const old = receipt.expectedAssignmentId ? await this.#gptStore.getAssignment(receipt.expectedAssignmentId) : null;
      if (this.#supervision!.publicState().state === "ARMED" || this.#aeWriterOwner
        || old && (!["CANCELLED", "COMPLETED", "FAILED"].includes(old.status)
          || this.#productionWorker.list(old.assignmentId).some(j => j.status === "RUNNING") || this.#preflightJobs.has(old.assignmentId))) {
        throw new HttpError(409, "USER_CONTROL_DISMISS_DRAIN_PENDING");
      }
    }
    return this.#userControls.update(receipt.requestId, { status: "FAILED", step: "DONE",
      error: "Dismissed by user before a replacement assignment was created. " + (receipt.error ?? ""),
      completedAt: new Date().toISOString() });
  }

  async #requestUserControl(body: Record<string, any>): Promise<Record<string, any>> {
    if (!this.#supervision) throw new HttpError(409, "PRODUCTION_SUPERVISION_REQUIRED");
    if (body.action === "STATUS") {
      const receipt = body.requestId ? this.#userControls.get(requiredString(body, "requestId")) : this.#userControls.latest();
      if (body.requestId && !receipt) throw new HttpError(404, "USER_CONTROL_NOT_FOUND");
      return { receipt, contract: PRODUCTION_USER_CONTROL_CONTRACT_V1 };
    }
    if (body.userRequested !== true) throw new HttpError(400, "EXPLICIT_USER_REQUEST_REQUIRED");
    const requestId = requiredString(body, "requestId");
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(requestId)) throw new HttpError(400, "INVALID_USER_CONTROL_REQUEST_ID");
    return await this.#userControls.exclusive(async () => {
      if (body.action === "DISMISS") {
        const prior = this.#userControls.get(requestId);
        if (!prior) throw new HttpError(404, "USER_CONTROL_NOT_FOUND");
        if (prior.status === "FAILED" && prior.step === "DONE" && prior.error?.startsWith("Dismissed by user")) return { receipt: prior };
        return { receipt: await this.#dismissBlockedUserControl(prior) };
      }
      if (body.action === "RETRY") {
        const prior = this.#userControls.get(requestId);
        if (!prior || prior.status !== "BLOCKED") throw new HttpError(409, "USER_CONTROL_NOT_BLOCKED");
        if (prior.input) await this.#validatePracticeInput(prior.input);
        return { receipt: this.#userControls.update(requestId, { status: "PENDING", error: null }) };
      }
      const action = requiredString(body, "action") as ProductionUserControlReceiptV1["action"];
      if (!["START_PRACTICE", "RESTART_PRACTICE", "REPLACE_CHAT", "CANCEL"].includes(action)) throw new HttpError(400, "UNKNOWN_USER_CONTROL_ACTION");
      const expectedAssignmentId = action === "START_PRACTICE" ? null : requiredString(body, "expectedAssignmentId");
      const inputFields = ["editTypeId", "editTypeTitle", "finishPath", "videoPaths", "audioPaths", "practiceRole", "minimumSimilarity", "exactSceneConfidence", "minimumAudioConfidence"];
      const supplied = body.input ?? body;
      const requestedInput = action === "START_PRACTICE" ? Object.fromEntries(inputFields.filter(k => supplied[k] !== undefined).map(k => [k, supplied[k]])) : null;
      const fingerprint = this.#userControls.fingerprint({ action, expectedAssignmentId, input: requestedInput });
      const prior = this.#userControls.get(requestId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new HttpError(409, "REQUEST_ID_REUSED_WITH_DIFFERENT_INTENT");
        return { receipt: prior };
      }
      const activeControl = this.#userControls.active();
      if (activeControl && !(action === "START_PRACTICE" && activeControl.status === "BLOCKED")) throw new HttpError(409, "USER_CONTROL_ALREADY_PENDING");
      const assignments = await this.#gptStore.listAssignments();
      const source = assignments.find(a => a.assignmentId === expectedAssignmentId);
      const unfinished = assignments.find(a => ["PENDING", "RUNNING", "CANCEL_REQUESTED"].includes(a.status));
      if (unfinished && unfinished.assignmentId !== expectedAssignmentId) throw new HttpError(409, "ANOTHER_ASSIGNMENT_IS_ACTIVE");
      if (expectedAssignmentId && !source) throw new HttpError(404, "GPT_ASSIGNMENT_NOT_FOUND");
      if (action === "REPLACE_CHAT" && (!source || !["PENDING", "RUNNING", "FAILED"].includes(source.status))) {
        throw new HttpError(409, "REPLACE_CHAT_REQUIRES_UNFINISHED_ASSIGNMENT: choose RESTART_PRACTICE for a fresh attempt.");
      }
      let input: Record<string, unknown> | null = requestedInput;
      if (action === "RESTART_PRACTICE") {
        if (source?.mode !== "PRACTICE" || !source.finish) throw new HttpError(409, "RESTART_REQUIRES_PRACTICE_ASSIGNMENT");
        input = { editTypeId: source.editTypeId, practiceRole: source.practiceRole,
          finishPath: source.finish.uri, videoPaths: source.start.filter(m => m.mediaKind === "VIDEO").map(m => m.uri),
          audioPaths: source.start.filter(m => m.mediaKind === "AUDIO").map(m => m.uri), ...source.practicePolicy };
      }
      // Validate the preset and media before stopping or superseding anything.
      if (input) await this.#validatePracticeInput(input);
      if (activeControl) await this.#dismissBlockedUserControl(activeControl);
      const now = new Date().toISOString();
      const receipt = this.#userControls.submit({ requestId, action, fingerprint, status: "PENDING", step: "QUEUED",
        expectedAssignmentId, previousAssignmentId: expectedAssignmentId, assignmentId: action === "REPLACE_CHAT" ? expectedAssignmentId : null,
        sessionId: action === "REPLACE_CHAT" ? source!.sessionId : null,
        plannedSessionId: input ? "practice:" + randomUUID() : null, input, generation: null, tabId: null,
        createdAt: now, updatedAt: now, deliveredAt: null, completedAt: null, error: null });
      return { receipt, contract: PRODUCTION_USER_CONTROL_CONTRACT_V1 };
    });
  }

  async #finalizeCancellation(assignmentId: string): Promise<PracticePanelRunSnapshotV1> {
    const authority = this.#supervision!.publicState();
    if (authority.assignmentId === assignmentId && authority.state === "ARMED") throw new HttpError(409, "WORKER_MUST_BE_REVOKED_FIRST");
    if (this.#aeWriterOwner || this.#productionWorker.list(assignmentId).some(j => j.status === "RUNNING") || this.#preflightJobs.has(assignmentId)) {
      throw new HttpError(409, "CANCELLATION_DRAIN_PENDING");
    }
    const assignment = await this.#gptStore.getAssignment(assignmentId);
    if (!assignment) throw new HttpError(404, "GPT_ASSIGNMENT_NOT_FOUND");
    if (!["CANCEL_REQUESTED", "CANCELLED"].includes(assignment.status)) throw new HttpError(409, "ASSIGNMENT_NOT_CANCELLING");
    if (assignment.status === "CANCEL_REQUESTED") await this.#gptStore.acknowledgeCancelled(assignmentId, "Supervisor verified revoked worker and drained production before completing user cancellation.");
    return await this.#syncRun(assignment.sessionId);
  }

  async #advanceUserControl(body: Record<string, any>): Promise<Record<string, any>> {
    return await this.#userControls.exclusive(async () => {
      const id = requiredString(body, "requestId");
      let receipt = this.#userControls.get(id);
      if (!receipt) throw new HttpError(404, "USER_CONTROL_NOT_FOUND");
      if (receipt.status !== "PENDING") return { receipt };
      if (body.action === "CONTROL_BEGIN" && receipt.step === "QUEUED") {
        // Inputs may have been deleted after submission. Preserve the old worker in that case.
        try { if (receipt.input) await this.#validatePracticeInput(receipt.input); }
        catch (error) {
          return { receipt: this.#userControls.update(id, { status: "BLOCKED", error: error instanceof Error ? error.message : String(error) }) };
        }
        const authority = this.#supervision!.publicState();
        if (authority.state !== "IDLE" && authority.assignmentId !== receipt.expectedAssignmentId) throw new HttpError(409, "USER_CONTROL_ASSIGNMENT_CHANGED");
        if (authority.assignmentId && authority.state !== "IDLE") {
          await this.#supervision!.revoke(authority.assignmentId, authority.generation, "explicit_user_" + receipt.action.toLowerCase());
          const old = await this.#gptStore.getAssignment(authority.assignmentId);
          if (old?.controllerLease) await this.#gptStore.releaseController(old.assignmentId, old.controllerLease.owner);
        }
        if (["RESTART_PRACTICE", "CANCEL"].includes(receipt.action)) {
          const old = await this.#gptStore.getAssignment(receipt.expectedAssignmentId!);
          if (old && !["CANCELLED", "COMPLETED", "FAILED"].includes(old.status)) await this.#cancelRun(old.sessionId);
        }
        receipt = this.#userControls.update(id, { step: "STOPPING" });
      } else if (body.action === "CONTROL_PREPARE" && ["STOPPING", "DRAINING", "PREPARING"].includes(receipt.step)) {
        this.#userControls.update(id, { step: "DRAINING" });
        const old = receipt.expectedAssignmentId ? await this.#gptStore.getAssignment(receipt.expectedAssignmentId) : null;
        if (this.#aeWriterOwner || (old && (this.#productionWorker.list(old.assignmentId).some(j => j.status === "RUNNING") || this.#preflightJobs.has(old.assignmentId)))) return { receipt: this.#userControls.get(id) };
        if (old?.status === "CANCEL_REQUESTED") await this.#finalizeCancellation(old.assignmentId);
        if (receipt.action === "CANCEL") return { receipt: this.#userControls.update(id, { status: "COMPLETED", step: "DONE", completedAt: new Date().toISOString() }) };
        receipt = this.#userControls.update(id, { step: "PREPARING" });
        try {
          let target = old;
          if (receipt.input) {
            // The session ID is persisted before creation; crash recovery cannot create a second assignment.
            target = (await this.#gptStore.listAssignments()).find(a => a.sessionId === receipt!.plannedSessionId) ?? null;
            if (!target) {
              await this.#requireConnectionPreflight();
              const run = await this.#startPractice(receipt.input, receipt.plannedSessionId!);
              target = await this.#gptStore.getAssignment(run.assignmentId);
            }
          } else if (target?.status === "FAILED") {
            target = await this.#gptStore.resumeFailedProduction(target.assignmentId);
            this.#activeRunId = target.sessionId; await this.#syncRun(target.sessionId);
          }
          if (!target || ["COMPLETED", "CANCELLED", "CANCEL_REQUESTED"].includes(target.status)) throw new HttpError(409, "USER_CONTROL_TARGET_NOT_RUNNABLE");
          await this.#supervision!.bind(target);
          receipt = this.#userControls.update(id, { assignmentId: target.assignmentId, sessionId: target.sessionId, step: "LAUNCHING", error: null });
        } catch (error) {
          receipt = this.#userControls.update(id, { status: "BLOCKED", error: error instanceof Error ? error.message : String(error) });
        }
      } else if (body.action === "CONTROL_DELIVERED") {
        if (!["LAUNCHING", "VERIFYING"].includes(receipt.step)) throw new HttpError(409, "USER_CONTROL_NOT_LAUNCHING");
        if (!Number.isInteger(body.tabId)) throw new HttpError(400, "INVALID_WORKER_TAB_ID");
        const a = this.#supervision!.publicState();
        if (a.assignmentId !== receipt.assignmentId || a.launchId !== receipt.requestId || a.state !== "ARMED") throw new HttpError(409, "STALE_USER_CONTROL_DELIVERY");
        receipt = this.#userControls.update(id, { step: "VERIFYING", generation: a.generation, tabId: Number(body.tabId), deliveredAt: new Date().toISOString() });
      } else if (body.action === "CONTROL_FAILED" && receipt.step === "VERIFYING") {
        receipt = this.#userControls.update(id, { status: "FAILED", error: requiredString(body, "error") });
      }
      return { receipt };
    });
  }

  async #supervisionSnapshot(): Promise<Record<string, any>> {
    const assignments = await this.#gptStore.listAssignments();
    const authority = this.#supervision!.publicState();
    const active = assignments.find((a) => a.assignmentId === authority.assignmentId && !["COMPLETED", "CANCELLED"].includes(a.status))
      ?? assignments.find((a) => a.sessionId === this.#activeRunId)
      ?? assignments.find((a) => ["PENDING", "RUNNING", "CANCEL_REQUESTED"].includes(a.status)) ?? null;
    await this.#supervision!.bind(active && !["COMPLETED", "CANCELLED"].includes(active.status) ? active : null);
    const request = this.#userControls.active(), currentAuthority = this.#supervision!.publicState();
    if (request?.status === "PENDING" && request.step === "VERIFYING" && request.assignmentId === active?.assignmentId
      && request.generation === currentAuthority.generation && currentAuthority.state === "ARMED"
      && active.status === "RUNNING" && active.controllerLease?.owner.startsWith(`ef-worker:${request.generation}:`)) {
      this.#userControls.update(request.requestId, { status: "COMPLETED", step: "DONE", completedAt: new Date().toISOString(), error: null });
    }
    const production = active ? (await this.#productionCoordinator(active)).coordinator.snapshot() : null;
    const jobs = active ? this.#productionWorker.list(active.assignmentId) : [];
    return { ...PRIMARY_WORKFLOW_ROUTING_V1, productionWorkflow: PRODUCTION_WORKFLOW_CONTRACT_V1, authority: this.#supervision!.publicState(), assignment: active ? { assignmentId: active.assignmentId,
      sessionId: active.sessionId, mode: active.mode, status: active.status, preflight: active.preflight ?? null,
      cancelRequestedAt: active.cancelRequestedAt, artifactDir: active.artifactDir } : null,
      production: productionSnapshotViewV1(production), jobs: jobs.map((job) => ({ jobId: job.jobId, kind: job.kind, status: job.status,
        updatedAt: job.updatedAt, createdAt: job.createdAt, startedAt: job.startedAt,
        heartbeatAt: job.heartbeatAt, error: job.error, operationSignature: job.requestKey })),
      writerOwner: this.#aeWriterOwner, hostRevision: this.controlStatus().hostRevision,
      preflightRunning: active ? this.#preflightJobs.has(active.assignmentId) : false,
      userControl: this.#userControls.active(), latestUserControl: this.#userControls.latest(),
      panelLastSeenAt: this.config.broker.panelSession?.lastSeenAt ?? null };
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (this.#supervision && this.#authorized(req) && url.pathname === "/v1/product/production/supervision") {
        if (req.headers["x-editflow-supervisor-key"] !== this.#supervision.key) throw new HttpError(403, "SUPERVISOR_KEY_REQUIRED");
        if (req.method === "GET") { jsonResponse(res, 200, await this.#supervisionSnapshot()); return; }
        if (req.method === "POST") {
          const body = await readJson(req);
          if (typeof body.action === "string" && ["CONTROL_BEGIN", "CONTROL_PREPARE", "CONTROL_DELIVERED", "CONTROL_FAILED"].includes(body.action)) {
            jsonResponse(res, 200, await this.#advanceUserControl(body)); return;
          }
          const state = this.#supervision.publicState();
          const id = requiredString(body, "assignmentId");
          if (id !== state.assignmentId) throw new HttpError(409, "SUPERVISOR_ASSIGNMENT_MISMATCH");
          let credential: string | undefined;
          if (body.action === "ISSUE") {
            credential = await this.#supervision.issue(id, requiredString(body, "launchId"));
            const assignment = await this.#gptStore.getAssignment(id);
            if (assignment?.controllerLease && assignment.controllerLease.owner !== credential) {
              await this.#gptStore.releaseController(id, assignment.controllerLease.owner);
            }
          }
          else if (body.action === "REVOKE" || body.action === "PAUSE") {
            await this.#supervision.revoke(id, Number(body.generation), requiredString(body, "reason"), body.action === "PAUSE");
            const assignment = await this.#gptStore.getAssignment(id);
            if (assignment?.controllerLease) await this.#gptStore.releaseController(id, assignment.controllerLease.owner);
          } else if (body.action === "INTERRUPT") {
            await this.#productionWorker.interrupt(id, requiredString(body, "reason"));
          } else if (body.action === "RECOVER_FAILED") {
            const resumed = await this.#gptStore.resumeFailedProduction(id);
            this.#activeRunId = resumed.sessionId;
            await this.#syncRun(resumed.sessionId);
          } else if (body.action === "FINALIZE_CANCEL") {
            jsonResponse(res, 200, { run: await this.#finalizeCancellation(id) }); return;
          } else if (body.action === "RESUME") await this.#supervision.resume(id);
          else throw new HttpError(400, "UNKNOWN_SUPERVISOR_ACTION");
          // This private response is the only route that returns the credential.
          const payload = JSON.stringify({ ok: true, authority: this.#supervision.publicState(), credential });
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(payload); return;
        }
      }
      const match = /^\/v1\/product\/gpt\/assignments\/([^/]+)\//.exec(url.pathname);
      if (this.#supervision && this.#authorized(req) && req.method === "POST" && match) {
        await this.#supervisionSnapshot();
        const body = await readJson(req) as Record<string, any>;
        const credential = req.headers["x-editflow-worker-credential"] ?? body.claimedBy ?? body.payload?.researchContext?.claimedBy;
        if (typeof credential === "string") {
          body.claimedBy = credential;
          if (body.payload?.researchContext) body.payload.researchContext.claimedBy = credential;
        }
        // Serialize revoke against the entire admission/write, including slow validations.
        const assignmentId = decodeURIComponent(match[1]!);
        await this.#supervision.authorized(assignmentId, credential, { path: url.pathname, body }, async () => {
          // Generation authorization, renewal and dispatch share the revoke lock.
          // Generation authorization is the ownership check. Establish a missing
          // claim for this issued worker inside admission; never steal another lease.
          if (!url.pathname.endsWith("/claim") && typeof credential === "string") {
            const current = await this.#gptStore.getAssignment(assignmentId);
            if (current && ["RUNNING", "CANCEL_REQUESTED"].includes(current.status)
              && current.claimedBy === credential && current.controllerLease?.owner === credential) {
              await this.#gptStore.renewController(assignmentId, credential);
            } else if (current && ["PENDING", "RUNNING"].includes(current.status)
              && !current.controllerLease) {
              await this.#gptStore.claim(assignmentId, credential);
              await this.#syncRun(current.sessionId);
            }
          }
          await this.#handleAuthorized(req, res); return res.statusCode;
        }); return;
      }
      await this.#handleAuthorized(req, res);
    } catch (error) {
      this.#setHeaders(res);
      jsonResponse(res, typeof (error as any).status === "number" ? (error as any).status : 500,
        { error: error instanceof Error ? error.message : String(error) });
    }
  }

  async #handleAuthorized(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
      if (RETIRED_EDIT_EXECUTION_PATHS_V1.has(url.pathname)) {
        jsonResponse(res, 410, retiredEditExecutionResponseV1());
        return;
      }
      if (url.pathname === "/v1/product/source-match") {
        if (req.method === "GET") {
          const assemblyId = url.searchParams.get("assemblyId");
          jsonResponse(res, 200, assemblyId ? await this.#sourceAssembly.status(assemblyId) : await this.#sourceMatch.status(url.searchParams.get("jobId") ?? undefined)); return;
        }
        if (req.method === "POST") {
          const body = await readJson(req);
          if (body.action === "PREPARE_ASSEMBLY") { jsonResponse(res, 202, await this.#sourceAssembly.prepare(body)); return; }
          if (body.action === "ASSEMBLY_PLAN") {
            const assignment = await this.#gptStore.getAssignment(requiredString(body, "assignmentId"));
            if (!assignment) throw new HttpError(404, "GPT assignment not found.");
            this.#priorAssemblyBatch(assignment.assignmentId, {sourceAssembly:{assemblyId:body.assemblyId,batchIndex:body.batchIndex ?? 0}});
            const result = await this.#sourceAssembly.plan(requiredString(body,"assemblyId"), Number(body.batchIndex ?? 0),
              await this.#transactionRuntime.observe(), {rawPaths:assignment.start.filter(m=>m.mediaKind==="VIDEO").map(m=>m.uri),
                ...(assignment.finish ? {referencePath:assignment.finish.uri} : {})});
            jsonResponse(res, 200, result); return;
          }
          if (body.action === "CANCEL") { jsonResponse(res, 200, await this.#sourceMatch.cancel(requiredString(body, "jobId"))); return; }
          if (body.action !== "SUBMIT") throw new HttpError(400, "Use SUBMIT, CANCEL, PREPARE_ASSEMBLY or ASSEMBLY_PLAN");
          jsonResponse(res, 202, await this.#sourceMatch.submit(body)); return;
        }
        throw new HttpError(405, "Use GET or POST");
      }
      if (req.method === "POST" && url.pathname === "/v1/product/production/worker-proof") {
        const scope = this.#childProofScope;
        const key = req.headers["x-editflow-worker-key"];
        if (!scope || this.#aeWriterOwner !== scope.jobId || typeof key !== "string" || key !== scope.key) {
          throw new HttpError(409, "WORKER_JOB_SCOPE_REQUIRED: native capability helpers execute only inside the current durable writer job.");
        }
        const body = await readJson(req);
        const operation = this.#childProofTail.catch(() => undefined).then(async () => {
          if (this.#childProofScope !== scope) throw new HttpError(409, "Worker job scope expired.");
          await this.assertClipResearchReady(scope.body, false, true);
          return await this.#dispatchWorkerProofScript(requiredString(body, "scriptPath"), scope.jobId + ":child:" + randomUUID());
        });
        this.#childProofTail = operation;
        jsonResponse(res, 200, { ok: true, response: await operation, productionJobId: scope.jobId });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/product/gpt/clip-research-contract") {
        jsonResponse(res, 200, CLIP_RESEARCH_CONTRACT_V1);
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/product/gpt/production-workflow-contract") {
        jsonResponse(res, 200, { ...PRODUCTION_WORKFLOW_CONTRACT_V1, studiedMethods: STUDIED_PRODUCTION_METHODS_V1 }); return;
      }
      const notebookMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)\/practice-notebook$/.exec(url.pathname);
      if (["GET", "POST"].includes(req.method ?? "") && notebookMatch) {
        const id = decodeURIComponent(notebookMatch[1]!); const assignment = await this.#gptStore.getAssignment(id);
        if (!assignment) throw new HttpError(404, "GPT assignment not found.");
        if (req.method === "POST") {
          const body = await readJson(req) as Record<string, any>; const lease = assignment.controllerLease;
          if (assignment.mode !== "PRACTICE" || assignment.status !== "RUNNING" || !lease || lease.owner !== body.claimedBy || Date.parse(lease.expiresAt) <= Date.now()) throw new HttpError(409, "Preset learning writes require the current Practice controller.");
          const lesson = body.lesson; if (!lesson || typeof lesson !== "object") throw new HttpError(400, "Provide a complete worked example under lesson.");
          if (lesson.editTypeId !== undefined && lesson.editTypeId !== assignment.editTypeId) throw new HttpError(400, "Do not write learning into another edit preset.");
          if (lesson.outcome !== "UNVERIFIED") {
            const evidence = body.reviewEvidence;
            const failed = this.#productionWorker.list(id).find(j => j.jobId === evidence?.failedJobId && j.status === "FAILED");
            if (lesson.outcome === "FAILED" && failed) {
              lesson.evidenceRefs = [...new Set([...(lesson.evidenceRefs ?? []), "production-job:" + failed.jobId])];
            } else {
              const render = this.#renderJobMedia(assignment, evidence?.renderJobId);
              if (!Array.isArray(evidence?.inspections) || !evidence.inspections.length) throw new HttpError(400, "A reviewed lesson needs issued render inspections, or a retained failed job for an execution failure.");
              const matcher = new ChatgptFootageBrowserV1({ artifactDir: path.join(assignment.artifactDir, "media"), scriptPath: path.join(this.config.repositoryRoot, "scripts", "practice", "chatgpt-footage-browser.py") });
              for (const inspection of evidence.inspections) await matcher.verifyFootageInspection(render, inspection.evidenceId, inspection.timeMs);
              lesson.evidenceRefs = [...new Set([...(lesson.evidenceRefs ?? []), "production-job:" + evidence.renderJobId,
                ...evidence.inspections.map((i: any) => "footage-inspection:" + i.evidenceId)])];
            }
          }
          const file = await this.#editTypes();
          await file.update(registry => registry.recordPracticeWorkedExample(assignment.editTypeId, assignment.sessionId, lesson));
        }
        jsonResponse(res, 200, { practiceNotebook: await this.#presetNotebook(assignment, url.searchParams.get("q") ?? "") }); return;
      }
      const clipResearchMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)\/clip-research$/.exec(url.pathname);
      const footageMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)\/footage-selection$/.exec(url.pathname);
      if ((req.method === "GET" || req.method === "POST") && footageMatch !== null) {
        const id = decodeURIComponent(footageMatch[1] ?? "");
        const assignment = await this.#gptStore.getAssignment(id);
        if (!assignment) throw new HttpError(404, "GPT assignment not found.");
        const matcher = new ChatgptFootageBrowserV1({ artifactDir: path.join(assignment.artifactDir, "media"),
          analysisCacheDir: defaultPracticeAnalysisCacheDirectoryV1(), materializeWorkingMedia: true,
          scriptPath: path.join(this.config.repositoryRoot, "scripts", "practice", "chatgpt-footage-browser.py"),
          ...(this.config.ffmpegPath ? { ffmpegPath: this.config.ffmpegPath } : {}) });
        if (req.method === "GET") {
          const reference = assignment.finish ? await matcher.readReference(assignment.finish) : null;
          const sourceIndex = await matcher.indexProvidedMedia(assignment.start);
          jsonResponse(res, 200, { contract: CHATGPT_FOOTAGE_SELECTION_CONTRACT_V1, reference, sourceIndex,
            searchState: await matcher.footageSearchState(sourceIndex),
            referenceMedia: assignment.finish, rawMedia: assignment.start.filter((media) => media.mediaKind === "VIDEO"),
            selections: (assignment.practiceSceneMatches ?? []).filter((match) => match.selectionMode === "CHATGPT_DIRECT"),
            legacyCandidatesDiscarded: true });
          return;
        }
        const body = await readJson(req) as Record<string, any>;
        const lease = assignment.controllerLease;
        if (assignment.status !== "RUNNING" || assignment.sessionId !== this.#activeRunId
          || !lease || lease.owner !== body.claimedBy || Date.parse(lease.expiresAt) <= Date.now()) throw new HttpError(409, "Direct footage work requires the current live controller.");
        const operation = (this.#footageSelectionTails.get(id) ?? Promise.resolve()).catch(() => undefined).then(async () => {
          if (body.action === "BROWSE") {
            const media = [...assignment.start, ...(assignment.finish ? [assignment.finish] : [])].find((item) => item.mediaId === body.mediaId);
            if (!media) throw new HttpError(400, "Only provided raw footage and the visual reference can be browsed.");
            return { inspection: await matcher.inspectFootage(media, body.timesMs, body.width ?? 640) };
          }
          if (body.action === "NOTE") {
            const media = assignment.start.find((item) => item.mediaId === body.mediaId);
            if (!media) throw new HttpError(400, "Search notes must identify provided raw footage.");
            await matcher.recordFootageSearchNote(media, body.note);
            return { recorded: true };
          }
          if (body.action === "BROWSE_RENDER") {
            const renderJobId = requiredString(body, "renderJobId"), job = this.#productionWorker.list(assignment.assignmentId).find(j => j.jobId === renderJobId);
            return { compositionTimeOriginMs: job?.payload.startMs ?? 0, timeConvention: "timesMs are local rendered-file times; add compositionTimeOriginMs for reference comparison.",
              inspection: await matcher.inspectFootage(this.#renderJobMedia(assignment, renderJobId), body.timesMs, body.width ?? 640) };
          }
          if (body.action === "DEFINE_REFERENCE" && assignment.finish) {
            const preflight = this.#preflightJobs.get(id);
            if (preflight) { preflight.abort.abort(); await preflight.promise; }
            const previousReference = await matcher.readReference(assignment.finish);
            const reference = await matcher.defineReference(assignment.finish, body);
            const retained = previousReference.styleFingerprint === reference.styleFingerprint ? assignment.practiceSceneMatches ?? [] : [];
            await this.#gptStore.updatePreflight(id, { stage: "AWAITING_CHATGPT_SHOTS", requireTransferNovelty: assignment.preflight?.requireTransferNovelty ?? false,
              updatedAt: new Date().toISOString(), totalShotIds: reference.shots.map(s => s.shotId), completedShotIds: [], unresolvedShotIds: reference.shots.map(s => s.shotId), reasons: [], evidenceRefs: reference.evidenceRefs }, retained);
            this.#schedulePreflight(id);
            return { reference, authority: CHATGPT_EDITORIAL_AUTHORITY_V1 };
          }
          if (body.action !== "SELECT" || !assignment.finish) throw new HttpError(400, "SELECT requires a Practice reference; Pro Creation browses raw footage and records its designed ranges in clip research.");
          const preflight = this.#preflightJobs.get(id);
          if (preflight) { preflight.abort.abort(); await preflight.promise; }
          const reference = await matcher.readReference(assignment.finish);
          const sourceIndex = await matcher.indexProvidedMedia(assignment.start);
          const selections = await matcher.selectFootage({ reference, sourceIndex, finish: assignment.finish, start: assignment.start,
            selections: body.selections, search: body.search });
          await this.#gptStore.updatePreflight(id, { ...assignment.preflight!, stage: "WORKING_MEDIA",
            requireTransferNovelty: assignment.preflight?.requireTransferNovelty ?? false,
            completedShotIds: [], unresolvedShotIds: reference.shots.map((shot) => shot.shotId),
            updatedAt: new Date().toISOString(), reasons: [], evidenceRefs: [] }, selections);
          // Decoding selected working ranges may outlive a connector request. Keep
          // the selection receipt durable and let resumable preflight prepare them.
          this.#schedulePreflight(id);
          const updated = await this.#gptStore.getAssignment(id);
          return { selections: updated?.practiceSceneMatches, preflight: updated?.preflight,
            nextAction: "Poll the same assignment preflight; do not resubmit accepted selections.",
            contract: CHATGPT_FOOTAGE_SELECTION_CONTRACT_V1 };
        });
        this.#footageSelectionTails.set(id, operation);
        try { jsonResponse(res, 201, await operation); }
        finally { if (this.#footageSelectionTails.get(id) === operation) this.#footageSelectionTails.delete(id); }
        return;
      }
      if ((req.method === "GET" || req.method === "POST") && clipResearchMatch !== null) {
        const id = decodeURIComponent(clipResearchMatch[1] ?? "");
        const assignment = await this.#gptStore.getAssignment(id);
        if (assignment === null) throw new HttpError(404, "GPT assignment not found.");
        let ledger;
        if (req.method === "POST") {
          const body = await readJson(req);
          try { ledger = await this.#clipResearch.record(assignment, body); }
          catch (error) { throw new HttpError(409, error instanceof Error ? error.message : String(error)); }
          if (body["action"] === "PLAN" && typeof body["clipId"] === "string") {
            const plan = ledger.clips?.[body["clipId"]]?.plan;
            if (plan?.status === "READY") {
              const { file, coordinator } = await this.#productionCoordinator(assignment);
              coordinator.markResearchReady(body["clipId"], plan.planId);
              await file.save(coordinator);
            }
          }
        } else ledger = await this.#clipResearch.snapshot(assignment);
        jsonResponse(res, req.method === "POST" ? 201 : 200, { clipResearch: this.#clipResearch.publicView(ledger, url.searchParams.get("includeAuditHistory") === "true") });
        return;
      }
      const productionMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)\/production$/.exec(url.pathname);
      const jobMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)\/production-jobs$/.exec(url.pathname);
      if ((req.method === "GET" || req.method === "POST") && jobMatch !== null) {
        const id = decodeURIComponent(jobMatch[1] ?? "");
        const assignment = await this.#gptStore.getAssignment(id);
        if (!assignment) throw new HttpError(404, "GPT assignment not found.");
        if (req.method === "POST") {
          const body = await readJson(req) as Record<string, any>;
          if (body.action === "RESOLVE") {
            const lease = assignment.controllerLease;
            if (!lease || lease.owner !== body.claimedBy || Date.parse(lease.expiresAt) <= Date.now()) throw new HttpError(409, "Production review requires the current controller.");
            const job = this.#productionWorker.list(id).find((item) => item.jobId === body.jobId);
            if (!job) throw new HttpError(404, "Production job not found.");
            if (typeof body.reviewEvidenceRef !== "string" || !body.reviewEvidenceRef.trim()) throw new HttpError(400, "Review/reconciliation requires retained evidence.");
            await this.#productionWorker.resolve(job.jobId, { ...body.result, reviewEvidenceRef: body.reviewEvidenceRef });
          } else {
            if (!PRACTICE_PRODUCTION_JOB_KINDS_V1.includes(body.kind)) throw new HttpError(400, "Unknown production job kind.");
            if (body.payload?.researchContext?.assignmentId !== id) throw new HttpError(400, "Job researchContext must identify the same assignment.");
            if (assignment.status !== "RUNNING" || this.#activeRunId !== assignment.sessionId) throw new HttpError(409, "Only the retained active RUNNING assignment accepts production jobs.");
            if (body.kind === "REFERENCE_ANALYSIS" && assignment.mode !== "PRACTICE") throw new HttpError(400, "Pro Creation has no Finish answer key; use raw-media analysis and designed render review.");
            if (body.kind === "BUILD_BASELINE" && assignment.mode !== "PRACTICE") throw new HttpError(400, "Practice baseline requires a Finish reference; use AE_BATCH or AE_TRANSACTION for Pro Creation.");
            if (body.kind === "SCRATCH_SEARCH" && assignment.mode !== "PRACTICE") throw new HttpError(400, "Reference candidate rendering is a Practice capability; Pro Creation uses designed render review.");
            const production = await this.#productionCoordinator(assignment);
            try { validateWorkflowJobV1(production.coordinator.snapshot().workflow ?? emptyProductionWorkflowV1(), body.payload, { kind: body.kind }); }
            catch (error) { throw new HttpError(409, (error as Error).message); }
            if (body.kind !== "REFERENCE_ANALYSIS") {
              const admitted = await this.assertClipResearchReady(body.payload, body.kind === "BUILD_BASELINE");
              production.coordinator.ensurePhases(admitted?.clipIds ?? []);
              await this.#synchronizeProductionSources(assignment, production);
              if (production.coordinator.snapshot().phases.some(phase => phase.sourceValidationRequired
                && (!admitted?.clipIds.length || admitted.clipIds.includes(phase.phaseId)))) {
                throw new HttpError(409, "SOURCE_CHANGED_REQUIRES_VALIDATION: inspect the changed raw identity before mutation.");
              }
            }
            validateChatgptSourceImportsV1({ mode: assignment.mode, ...(assignment.finish ? {finishPath: assignment.finish.uri} : {}),
              rawVideoPaths: assignment.start.filter(m => m.mediaKind === "VIDEO").map(m => m.uri) }, body.payload);
            await this.#verifySourceAssembly(assignment, body.kind, body.payload);
            let decision;
            try { decision = await new ChatgptEditorialDecisionFileV1(path.join(assignment.artifactDir, "editorial-decisions")).retain(id, body.kind, body.payload); }
            catch (error) { throw new HttpError(400, error instanceof Error ? error.message : String(error)); }
            if (body.payload.methodApplications !== undefined) {
              const notebook = await this.#presetNotebook(assignment);
              validateMethodApplicationV1(notebook.examples, body.payload.methodApplications);
              for (const application of body.payload.methodApplications) {
                if (application.adaptedMethod.sourceBindings.some((source: any) => !assignment.start.some(m => m.mediaId === source.mediaId && m.mediaKind === "VIDEO"))) throw new HttpError(400, "Adapted methods may bind only assignment-provided raw footage.");
              }
            }
            if (body.kind === "AE_BATCH") { try { validateRoutineBatchV1(body.payload.intents); } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : String(error)); } }
            if (body.kind === "LOCAL_RENDER" && ![1, .25, .125].includes(body.payload.resolutionScale ?? 1)) throw new HttpError(400, "Choose render resolutionScale 1, 0.25 or 0.125 explicitly.");
            // Carry the previous pass judgment with the next edit; never a new admission gate.
            if (body.payload.visualReview !== undefined) await this.#retainVisualReview(assignment, body.payload.visualReview);
            body.payload.editorialDecision = decision;
            if (body.kind === "SCRATCH_SEARCH") validatePracticeScratchSearchV1(body.payload);
            const job = await this.#productionWorker.enqueue({ assignmentId: id, kind: body.kind, payload: body.payload,
              dependencyIds: stringArray(body, "dependencyIds", false) });
            void this.#productionWorker.runOnce().catch(() => undefined);
            jsonResponse(res, 202, { job, ...PRIMARY_WORKFLOW_ROUTING_V1, primarySystem: PRIMARY_EDIT_PRODUCTION_SYSTEM_V1 });
            return;
          }
        }
        const requestedJobId = url.searchParams.get("jobId");
        if (requestedJobId && Number(url.searchParams.get("waitMs")) > 0) {
          const current = this.#productionWorker.list(id).find(job => job.jobId === requestedJobId);
          if (current) await this.#productionWorker.waitForUpdate(requestedJobId, url.searchParams.get("after") ?? current.updatedAt, Number(url.searchParams.get("waitMs")));
        }
        const jobs = this.#productionWorker.list(id);
        const job = requestedJobId ? jobs.find((item) => item.jobId === requestedJobId) : undefined;
        if (requestedJobId && !job) throw new HttpError(404, "Production job not found for this assignment.");
        jsonResponse(res, 200, requestedJobId ? { job, primarySystem: PRIMARY_EDIT_PRODUCTION_SYSTEM_V1 } : { ...productionJobsViewV1(jobs, url.searchParams.get("includeHistory") === "true"), writerOwner: this.#aeWriterOwner, primarySystem: PRIMARY_EDIT_PRODUCTION_SYSTEM_V1 });
        return;
      }
      if ((req.method === "GET" || req.method === "POST") && productionMatch !== null) {
        const id = decodeURIComponent(productionMatch[1] ?? "");
        const assignment = await this.#gptStore.getAssignment(id);
        if (assignment === null) throw new HttpError(404, "GPT assignment not found.");
        const { file, coordinator } = await this.#productionCoordinator(assignment);
        if (req.method === "POST") {
          const body = await readJson(req);
          const lease = assignment.controllerLease;
          if (assignment.status !== "RUNNING" || !lease || lease.owner !== body.claimedBy || Date.parse(lease.expiresAt) <= Date.now()) {
            throw new HttpError(409, "CONTROLLER_LEASE_INVALID: Production state updates require this worker's current claim and unexpired controller lease.");
          }
          const action = requiredString(body, "action");
          if (action === "VISUAL_REVIEW") {
            await this.#retainVisualReview(assignment, body["review"] as Record<string, any>);
          } else if (action === "WORKFLOW_PLAN") {
            const plan = parseProductionWorkflowPlanV1(body["plan"] as Record<string, any>);
            for (const source of plan.sources) {
              if (!assignment.start.some(m => m.mediaId === source.mediaId && m.mediaKind === "VIDEO")) throw new HttpError(400, "Workflow sources must be provided raw footage.");
              if (assignment.mode === "PRACTICE" && !(assignment.practiceSceneMatches ?? []).some(m => m.shotId === source.clipId && m.sourceId === source.mediaId
                && m.sourceStartMs === source.startMs && m.sourceEndMs === source.endMs && m.selectionMode === "CHATGPT_DIRECT")) throw new HttpError(400, "Retain exact direct ChatGPT source selections before workflow planning.");
            }
            if (!assignment.start.some(m => m.mediaId === plan.audio.mediaId)) throw new HttpError(400, "Workflow audio must be an assignment-provided raw input.");
            coordinator.retainWorkflowPlan(plan);
          } else if (action === "WORKFLOW_REVIEW") {
            const review = body["review"] as Record<string, any>;
            const media = this.#renderJobMedia(assignment, review?.renderJobId);
            const matcher = new ChatgptFootageBrowserV1({ artifactDir: path.join(assignment.artifactDir, "media"), scriptPath: path.join(this.config.repositoryRoot, "scripts", "practice", "chatgpt-footage-browser.py") });
            if (!Array.isArray(review?.inspections) || !review.inspections.length) throw new HttpError(400, "Workflow review requires issued render inspections and playback observations.");
            for (const inspection of review.inspections) await matcher.verifyFootageInspection(media, inspection.evidenceId, inspection.timeMs);
            if (!this.#productionWorker.list(id).some(j => (j.payload as any).editorialDecision?.decisionId === review.constructionDecisionId)) throw new HttpError(400, "Review must reference a retained construction decision.");
            coordinator.retainWorkflowReview(review);
          } else if (action === "WORKFLOW_MILESTONE") {
            coordinator.retainWorkflowMilestone(body["milestone"] as Record<string, any>);
          } else if (action === "HEARTBEAT") {
            coordinator.heartbeat(body["operation"] === null ? null : optionalString(body, "operation") ?? null);
          } else if (action === "STAGE") {
            coordinator.setStage(
              requiredString(body, "stage") as any,
              optionalString(body, "phaseId") ?? null,
            );

          } else if (action === "RESEARCH_READY") {
            coordinator.markResearchReady(requiredString(body, "phaseId"), requiredString(body, "researchKey"));
          } else if (action === "WHOLE_EDIT_COVERED") {
            const revision = Number(body["constructionRevision"]);
            coordinator.markWholeEditCovered(Number.isFinite(revision) ? revision : null);
          } else if (action === "CONSTRUCTED") {
            const revision = Number(body["constructionRevision"]);
            coordinator.markConstructed(requiredString(body, "phaseId"), Number.isFinite(revision) ? revision : null);
          } else if (action === "AE_CHECKPOINT") {
            const revision = Number(body["projectRevision"]);
            coordinator.markAeCheckpoint({
              projectId: optionalString(body, "projectId") ?? null,
              projectRevision: Number.isFinite(revision) ? revision : null,
              environmentFingerprint: optionalString(body, "environmentFingerprint") ?? null,
              activeCompId: optionalString(body, "activeCompId") ?? null,
              projectPath: optionalString(body, "projectPath") ?? null,
            });
          } else if (action === "LOCAL_PROOF") {
            const similarity = Number(body["similarity"]);
            coordinator.markLocalProof(
              requiredString(body, "phaseId"),
              body["passed"] === true,
              Number.isFinite(similarity) ? similarity : null,
              { evidenceRef: requiredString(body, "evidenceRef"), candidateKey: requiredString(body, "candidateKey") },
            );
          } else if (action === "WHOLE_EDIT_PROOF") {
            coordinator.confirmProvisionalFromWholeEdit(stringArray(body, "passingPhaseIds", false),
              { evidenceRef: requiredString(body, "evidenceRef"), candidateKey: requiredString(body, "candidateKey"), passed: body["passed"] === true });
          } else if (action === "INVALIDATE") {
            coordinator.invalidate(
              stringArray(body, "phaseIds", true),
              requiredString(body, "target") as any,
            );
          } else if (action === "RESIDUALS") {
            const residuals = body["residuals"];
            if (!Array.isArray(residuals)) throw new HttpError(400, "residuals must be an array.");
            coordinator.updateResiduals(residuals as any);
          } else if (action === "TELEMETRY") {
            const startedAtMs = Number(body["startedAtMs"]);
            const endedAtMs = Number(body["endedAtMs"]);
            if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
              throw new HttpError(400, "Telemetry requires finite startedAtMs and endedAtMs.");
            }
            await file.appendTelemetry(practiceTelemetrySpanV1({
              spanId: optionalString(body, "spanId") ?? randomUUID(),
              sessionId: assignment.sessionId,
              category: requiredString(body, "category") as any,
              stage: requiredString(body, "stage") as any,
              phaseId: optionalString(body, "phaseId") ?? null,
              startedAtMs,
              endedAtMs,
              outcome: (optionalString(body, "outcome") ?? "SUCCESS") as any,
              detail: optionalString(body, "detail") ?? null,
              ...(body["activity"] === undefined ? {} : { activity: body["activity"] as any }),
              ...(body["purpose"] === undefined ? {} : { purpose: body["purpose"] as any }),
            }));
          } else {
            throw new HttpError(400, "Unknown production coordinator action: " + action);
          }
          await file.save(coordinator);
        }
        jsonResponse(res, 200, {
          production: productionSnapshotViewV1(coordinator.snapshot(), url.searchParams.get("includeHistory") === "true"),
          ...PRIMARY_WORKFLOW_ROUTING_V1,
          workflowContract: req.method === "POST" || url.searchParams.get("includeHistory") === "true" ? PRODUCTION_WORKFLOW_CONTRACT_V1 : { executionPath: PRODUCTION_WORKFLOW_CONTRACT_V1.executionPath, authority: "CHATGPT_DIRECT", historyAvailable: true },
          nextAction: { kind: "CHATGPT_DECIDES", instruction: this.#supervision?.publicState().state === "PAUSED" ? "Explicit user pause; no editing or recovery action is required." : "Choose the next edit or meaningful visual review from retained work." },
          residualObservations: coordinator.snapshot().residuals,
          liveness: this.#supervision?.publicState().state === "PAUSED" || ["COMPLETED", "CANCELLED"].includes(assignment.status)
            ? { stalled: false, reason: this.#supervision?.publicState().state === "PAUSED" ? "explicit_user_pause" : "assignment_finished", actionRequired: false }
            : { ...coordinator.liveness({}), actionRequired: false, diagnosticOnly: true },
          historyAvailable: true,
          telemetry: await file.telemetrySummary(Date.parse(coordinator.snapshot().createdAt)),
        });
        return;
      }
      if (url.pathname === "/v1/product/production/user-controls" && ["GET", "POST"].includes(req.method ?? "")) {
        const result = await this.#requestUserControl(req.method === "POST" ? await readJson(req) : { action: "STATUS", requestId: url.searchParams.get("requestId") });
        jsonResponse(res, 200, result); return;
      }
      if ((req.method === "GET" || req.method === "POST") && url.pathname === "/v1/product/practice/resume-or-start") {
        if (req.method === "POST") {
          const body = await readJson(req);
          if (body.action) { jsonResponse(res, 200, await this.#requestUserControl(body)); return; }
          if (this.#activeRunId === null && body["finishPath"] !== undefined) await this.#startPractice(body);
          const active = this.#activeRunId === null ? undefined : this.#runs.get(this.#activeRunId);
          if (active !== undefined) this.#schedulePreflight(active.assignmentId);
        }
        jsonResponse(res, 200, await this.#resumeHandshake());
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/product/status") {
        const latestRunId = [...this.#runs.values()]
          .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
          .at(-1)?.sessionId ?? null;
        jsonResponse(res, 200, {
          service: "READY",
          panelConnected: this.config.broker.panelSession !== null,
          gptOrchestration: "ASSIGNMENT_QUEUE_READY",
          ...PRIMARY_WORKFLOW_ROUTING_V1,
          practiceWorkflow: PRIMARY_PRODUCTION_WORKFLOW_V1,
          proCreationWorkflow: PRIMARY_PRODUCTION_WORKFLOW_V1,
          practiceStartup: "DIRECT_EDITING_V1",
          practiceWorkflowAuthority: "CHATGPT_DIRECT_EDITORIAL_AUTHORITY_V1",
          primaryProductionSystem: PRIMARY_EDIT_PRODUCTION_SYSTEM_V1,
          productionModes: ["PRACTICE", "PRO_CREATION"],
          directMutationRoutes: "REMOVED",
          productionJobKinds: PRACTICE_PRODUCTION_JOB_KINDS_V1,
          activeRunId: this.#activeRunId,
          latestRunId,
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/product/preflight") {
        jsonResponse(res, 200, { preflight: await this.#connectionPreflight() });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/product/control/observe") {
        jsonResponse(res, 200, {
          state: await this.#transactionRuntime.observe(),
          runtime: this.#transactionRuntime.status(),
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/product/control/fast-refresh") {
        const runtime = await this.#ensureFastRuntime();
        jsonResponse(res, 200, {
          state: await runtime.refresh(),
          runtime: runtime.status(),
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/product/edit-types") {
        const file = await this.#editTypes();
        const registry = await file.load();
        jsonResponse(res, 200, {
          editTypes: registry.list().map((profile) => ({
            ...profile,
            knowledge: registry.knowledge(profile.editTypeId),
          })),
        });
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
      const openRenderMatch = /^\/v1\/product\/runs\/([^/]+)\/open-best-attempt$/.exec(url.pathname);
      if (req.method === "POST" && openRenderMatch !== null) {
        const id = decodeURIComponent(openRenderMatch[1] ?? "");
        jsonResponse(res, 200, { run: await this.#openBestAttempt(id) });
        return;
      }
      const humanReviewMatch = /^\/v1\/product\/runs\/([^/]+)\/human-review$/.exec(url.pathname);
      if (req.method === "POST" && humanReviewMatch !== null) {
        const id = decodeURIComponent(humanReviewMatch[1] ?? "");
        jsonResponse(res, 201, {
          review: await this.#saveHumanReview(id, await readJson(req)),
        });
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
        const resumable = await this.#gptStore.listAssignments({
          statuses: ["RUNNING", "CANCEL_REQUESTED"],
        });
        const pending = resumable.length > 0
          ? []
          : await this.#gptStore.listAssignments({ statuses: ["PENDING"] });
        const assignment = resumable[0] ?? pending[0] ?? null;
        jsonResponse(res, 200, {
          assignment: assignmentViewV1(assignment, url.searchParams.get("includeHistory") === "true"), ...PRIMARY_WORKFLOW_ROUTING_V1, productionWorkflow: PRODUCTION_WORKFLOW_CONTRACT_V1, editorialAuthority: CHATGPT_EDITORIAL_AUTHORITY_V1,
          practiceNotebook: assignment ? await this.#presetNotebookIndex(assignment) : null,
          resumeRequired: assignment !== null
            && (assignment.status === "RUNNING" || assignment.status === "CANCEL_REQUESTED"),
          clipResearch: { advisory: true, detailLookup: "clip-research" },
        });
        return;
      }
      const assignmentGetMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && assignmentGetMatch !== null) {
        const id = decodeURIComponent(assignmentGetMatch[1] ?? "");
        const assignment = await this.#gptStore.getAssignment(id);
        if (assignment === null) throw new HttpError(404, "GPT assignment not found.");
        jsonResponse(res, 200, {
          assignment: assignmentViewV1(assignment, url.searchParams.get("includeHistory") === "true"),
          ...PRIMARY_WORKFLOW_ROUTING_V1, productionWorkflow: PRODUCTION_WORKFLOW_CONTRACT_V1,
          editorialAuthority: CHATGPT_EDITORIAL_AUTHORITY_V1, practiceNotebook: url.searchParams.get("includeHistory") === "true" ? await this.#presetNotebook(assignment) : await this.#presetNotebookIndex(assignment),
          events: url.searchParams.get("includeHistory") === "true" ? await this.#gptStore.eventsForSession(assignment.sessionId) : [],
          clipResearch: url.searchParams.get("includeHistory") === "true" ? this.#clipResearch.publicView(await this.#clipResearch.snapshot(assignment), url.searchParams.get("includeAuditHistory") === "true") : { advisory: true, detailLookup: "clip-research" },
        });
        return;
      }
      const releaseMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)\/release-controller$/.exec(url.pathname);
      if (req.method === "POST" && releaseMatch !== null) {
        const body = await readJson(req);
        jsonResponse(res, 200, { assignment: await this.#gptStore.releaseController(
          decodeURIComponent(releaseMatch[1] ?? ""), requiredString(body, "claimedBy")) });
        return;
      }
      const claimMatch = /^\/v1\/product\/gpt\/assignments\/([^/]+)\/claim$/.exec(url.pathname);
      if (req.method === "POST" && claimMatch !== null) {
        const id = decodeURIComponent(claimMatch[1] ?? "");
        const assignment = await this.#claimAssignment(id, await readJson(req));
        const resume = await this.#resumeHandshake();
        let aeState: unknown = null, aeStateError: string | null = null;
        if (!this.config.broker.panelSession) aeStateError = "CEP_PANEL_NOT_CONNECTED";
        else {
          try { aeState = await this.#transactionRuntime.observe(); }
          catch (error) { aeStateError = error instanceof Error ? error.message : String(error); }
        }
        jsonResponse(res, 200, {
          assignment: assignmentViewV1(assignment), resume: { ...resume, assignment: { assignmentId: assignment.assignmentId, sessionId: assignment.sessionId, status: assignment.status } }, aeState, aeStateError,
          startup: "ONE_CALL_RESUME_V1",
          nextAction: "Inspect retained work, then enqueue exact AE operations. Research and workflow records are optional supporting memory.",
        });
        return;
      }
      const tutorialCompilationMatch =
        /^\/v1\/product\/gpt\/assignments\/([^/]+)\/tutorial-compilations$/.exec(url.pathname);
      if (req.method === "POST" && tutorialCompilationMatch !== null) {
        throw new HttpError(410, "MACHINE_TUTORIAL_COMPILATION_RETIRED: ChatGPT must directly review the tutorial and record authority:CHATGPT_DIRECT method steps via clip-research SOURCE, then retain reviewed worked examples in practice-notebook.");
      }
      const eventBatchMatch =
        /^\/v1\/product\/gpt\/assignments\/([^/]+)\/events\/batch$/.exec(url.pathname);
      if (req.method === "POST" && eventBatchMatch !== null) {
        const id = decodeURIComponent(eventBatchMatch[1] ?? "");
        const body = await readJson(req);
        const rawEvents = body["events"];
        if (!Array.isArray(rawEvents) || rawEvents.length === 0 || rawEvents.length > 64) {
          throw new HttpError(400, "events must be a non-empty array with at most 64 entries.");
        }
        if (rawEvents.some((event) => event === null
          || typeof event !== "object"
          || Array.isArray(event))) {
          throw new HttpError(400, "Each batched event must be an object.");
        }
        const assignment = await this.#recordLearningEvents(
          id,
          rawEvents as Record<string, unknown>[],
        );
        jsonResponse(res, 201, { assignment, eventCount: rawEvents.length });
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
