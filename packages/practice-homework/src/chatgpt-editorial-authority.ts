import { assertExplicitEditorialPayloadV1 } from "../../adapters/ae-cep/src/explicit-editorial-payload.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseProductionMethodV1, type ProductionMethodV1 } from "./production-workflow.js";

/** Measurements and native tracking are tools; they cannot nominate an edit. */
export const CHATGPT_EDITORIAL_AUTHORITY_V1 = {
  schema: "editflow.chatgpt-editorial-authority.v1",
  authority: "CHATGPT_DIRECT",
  scope: ["REFERENCE_SHOTS", "CONTENT_DURATION", "RAW_SHOTS", "AUDIO", "TIMING", "FRAMING", "EFFECTS", "TRANSITIONS", "CONSTRUCTION", "CORRECTION", "CANDIDATE_SELECTION", "FINAL_REVIEW", "PRESET_LEARNING"],
  machineRole: "EXPLICIT_PLAN_EXECUTION_AND_REQUESTED_MEASUREMENTS_ONLY",
  automaticEditorialFallback: false,
  machineScores: "ADVISORY_ONLY",
  candidateSelection: "CHATGPT_DIRECT_NO_RANKING_OR_PRUNING",
  nativeAnalysis: "ONLY_EXPLICITLY_CHOSEN_TARGET_METHOD_SETTINGS; GPT_REVIEWS_RESULT; NO_AUTOMATIC_BACKEND_FALLBACK",
  learningStorage: "EXISTING_EDIT_TYPE_GPT_LEARNING_WORKED_EXAMPLES",
} as const;

const text = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v.trim()) throw new TypeError(name + " must be non-empty.");
  return v.trim();
};
const strings = (v: unknown, name: string, required = false): string[] => {
  if (!Array.isArray(v) || v.some(x => typeof x !== "string" || !x.trim()) || required && !v.length) {
    throw new TypeError(name + " must contain " + (required ? "one or more " : "") + "non-empty strings.");
  }
  return [...new Set(v.map(x => x.trim()))];
};
export const editorialPayloadHashV1 = (payload: Record<string, any>): string => {
  // Object key order must not change a decision. Array order is editorially meaningful.
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
  const { editorialDecision: _decision, researchContext: _lease, ...plan } = payload;
  return createHash("sha256").update(JSON.stringify(canonical(plan))).digest("hex");
};

export interface ChatgptEditorialDecisionV1 {
  readonly authority: "CHATGPT_DIRECT";
  readonly decisionId: string;
  readonly rationale: string;
  readonly evidenceRefs: readonly string[];
  readonly steps: readonly string[];
  readonly payloadHash: string;
}

export const validateChatgptEditorialJobV1 = (kind: string, payload: Record<string, any>): ChatgptEditorialDecisionV1 => {
  const d = payload.editorialDecision;
  if (d?.authority !== "CHATGPT_DIRECT") throw new TypeError("CHATGPT_EDITORIAL_DECISION_REQUIRED: submit your explicit plan, rationale, steps and evidence.");
  const hash = editorialPayloadHashV1(payload);
  if (d.payloadHash !== undefined && d.payloadHash !== hash) throw new TypeError("EDITORIAL_PLAN_CHANGED: review and record the changed plan.");
  if (kind === "AE_GOAL" && !["SHORT_HORIZON", "REFRAME"].includes(payload.goal?.kind)) {
    throw new TypeError("FORMULA_EDITING_RETIRED: provide exact AE intents/keyframes instead of a pulse or autonomous goal.");
  }
  if (kind === "BUILD_BASELINE" && !payload.plan) throw new TypeError("CHATGPT_BASELINE_PLAN_REQUIRED: provide exact AE operations; automatic baseline generation is retired.");
  if (kind === "PROOF_SCRIPT" && !/^[a-f0-9]{64}$/.test(payload.scriptSha256 ?? "")) {
    throw new TypeError("CHATGPT_SCRIPT_REVIEW_REQUIRED: review the script's editing values and bind its SHA-256.");
  }
  assertExplicitEditorialPayloadV1(payload);
  return { authority: "CHATGPT_DIRECT", decisionId: text(d.decisionId, "decisionId"),
    rationale: text(d.rationale, "rationale"), evidenceRefs: strings(d.evidenceRefs, "evidenceRefs", true),
    steps: strings(d.steps, "steps", true), payloadHash: hash };
};

/** Source integrity is a constraint on execution, not a footage recommendation. */
export const validateChatgptSourceImportsV1 = (input: { mode: string; finishPath?: string; rawVideoPaths: readonly string[] }, payload: Record<string, any>): void => {
  const normalized = (v: string) => /^[A-Za-z]:[\\/]/.test(v) ? path.win32.normalize(v).toLowerCase() : path.resolve(v);
  const forbidden = new Set([...(input.finishPath ? [input.finishPath] : []), ...(input.mode === "PRACTICE" ? input.rawVideoPaths : [])].map(normalized));
  const visit = (value: any): void => {
    if (!value || typeof value !== "object") return;
    if (["media.import", "media.sequence.import"].includes(value.command)) {
      const sourcePath = value.payload?.path ?? value.path;
      if (typeof sourcePath === "string" && forbidden.has(normalized(sourcePath))) throw new TypeError("PROVIDED_WORKING_MEDIA_REQUIRED: Finish is reference-only; full raw videos are search-only. Import GPT-selected working ranges.");
    }
    Object.values(value).forEach(visit);
  };
  visit(payload);
};

/** Immutable receipt binds accepted queue work across worker handoffs. */
export class ChatgptEditorialDecisionFileV1 {
  static readonly #tails = new Map<string, Promise<void>>();
  constructor(readonly directory: string) {}
  async retain(assignmentId: string, kind: string, payload: Record<string, any>): Promise<ChatgptEditorialDecisionV1> {
    const key = path.resolve(this.directory);
    const prior = ChatgptEditorialDecisionFileV1.#tails.get(key) ?? Promise.resolve();
    const operation = prior.then(() => this.#retain(assignmentId, kind, payload));
    const settled = operation.then(() => {}, () => {});
    ChatgptEditorialDecisionFileV1.#tails.set(key, settled);
    try { return await operation; }
    finally { if (ChatgptEditorialDecisionFileV1.#tails.get(key) === settled) ChatgptEditorialDecisionFileV1.#tails.delete(key); }
  }
  async #retain(assignmentId: string, kind: string, payload: Record<string, any>): Promise<ChatgptEditorialDecisionV1> {
    const decision = validateChatgptEditorialJobV1(kind, payload);
    const file = path.join(this.directory, createHash("sha256").update(assignmentId + "\0" + decision.decisionId).digest("hex") + ".json");
    let prior: any;
    try { prior = JSON.parse(await readFile(file, "utf8")); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    if (prior && (prior.kind !== kind || prior.decision.payloadHash !== decision.payloadHash)) throw new TypeError("DECISION_ID_REUSED_FOR_DIFFERENT_PLAN");
    if (!prior) {
      await mkdir(this.directory, { recursive: true });
      const temp = file + ".tmp";
      await writeFile(temp, JSON.stringify({ assignmentId, kind, decision, recordedAt: new Date().toISOString() }) + "\n", { encoding: "utf8", flush: true });
      await rename(temp, file);
    }
    return decision;
  }
  async verify(assignmentId: string, kind: string, payload: Record<string, any>): Promise<void> {
    const d = validateChatgptEditorialJobV1(kind, payload);
    const file = path.join(this.directory, createHash("sha256").update(assignmentId + "\0" + d.decisionId).digest("hex") + ".json");
    const prior = JSON.parse(await readFile(file, "utf8"));
    if (prior.assignmentId !== assignmentId || prior.kind !== kind || prior.decision.payloadHash !== d.payloadHash) throw new TypeError("RETAINED_CHATGPT_PLAN_MISMATCH");
  }
}

export interface PracticeWorkedExampleV1 {
  readonly authority: "CHATGPT_DIRECT";
  readonly lessonId: string;
  readonly editTypeId: string;
  readonly sessionId: string;
  readonly title: string;
  readonly problem: string;
  readonly steps: readonly { readonly action: string; readonly settings: Record<string, unknown>; readonly reason: string; readonly check: string }[];
  readonly outcome: "WORKED" | "FAILED" | "UNVERIFIED";
  readonly observation: string;
  readonly explanation: string;
  readonly whenToUse: readonly string[];
  readonly adaptation: readonly string[];
  readonly mistakesToAvoid: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly supersedesLessonIds: readonly string[];
  readonly recordedAt: string;
  readonly method?: ProductionMethodV1;
}

export const parsePracticeWorkedExampleV1 = (editTypeId: string, sessionId: string, input: Record<string, any>): PracticeWorkedExampleV1 => {
  if (input.authority !== "CHATGPT_DIRECT" || !["WORKED", "FAILED", "UNVERIFIED"].includes(input.outcome)) throw new TypeError("A worked example needs GPT authority and an explicit observed outcome.");
  if (!Array.isArray(input.steps) || !input.steps.length || input.steps.length > 100) throw new TypeError("Retain 1-100 ordered, reproducible steps.");
  const steps = input.steps.map((s: any) => {
    if (!s.settings || typeof s.settings !== "object" || Array.isArray(s.settings)) throw new TypeError("Each step needs explicit settings ({} for a non-AE step).");
    return { action: text(s.action, "step.action"), settings: structuredClone(s.settings), reason: text(s.reason, "step.reason"), check: text(s.check, "step.check") };
  });
  return { authority: "CHATGPT_DIRECT", lessonId: text(input.lessonId, "lessonId"), editTypeId, sessionId,
    title: text(input.title, "title"), problem: text(input.problem, "problem"), steps,
    outcome: input.outcome, observation: text(input.observation, "observation"), explanation: text(input.explanation, "explanation"),
    whenToUse: strings(input.whenToUse, "whenToUse", true), adaptation: strings(input.adaptation, "adaptation"),
    mistakesToAvoid: strings(input.mistakesToAvoid, "mistakesToAvoid"), evidenceRefs: strings(input.evidenceRefs, "evidenceRefs", input.outcome !== "UNVERIFIED"),
    supersedesLessonIds: strings(input.supersedesLessonIds ?? [], "supersedesLessonIds"), recordedAt: new Date().toISOString(),
    ...(input.method === undefined ? {} : { method: parseProductionMethodV1(input.method) }) };
};

export const practiceNotebookViewV1 = (editTypeId: string, examples: readonly PracticeWorkedExampleV1[], query = "") => {
  const own = examples.filter(e => e.editTypeId === editTypeId);
  const superseded = new Set(own.flatMap(e => e.supersedesLessonIds));
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return { authority: "CHATGPT_DIRECT", editTypeId, totalExamples: own.length,
    workedCount: own.filter(e => e.outcome === "WORKED" && !superseded.has(e.lessonId)).length,
    failedCount: own.filter(e => e.outcome === "FAILED" && !superseded.has(e.lessonId)).length,
    examples: own.filter(e => terms.every(t => JSON.stringify(e).toLowerCase().includes(t))).map(e => ({ ...e, superseded: superseded.has(e.lessonId) })),
    instruction: "Read relevant worked and failed examples, adapt explicitly, test in AE, compare actual renders, and retain new observed lessons. Do not blindly apply a recipe or treat a past success as universal proof." };
};

export const CHATGPT_PRACTICE_NOTEBOOK_CONTRACT_V1 = {
  storage: "Existing Edit Type gptLearning.workedExamples; legacy lessons and learnedSkills are preserved.",
  endpoint: "GET/POST /v1/product/gpt/assignments/{id}/practice-notebook",
  query: "GET ?q=... returns matching complete worked examples in retained order; no automatic recipe selection.",
  fields: ["lessonId", "authority:CHATGPT_DIRECT", "title", "problem", "steps:[{action,settings,reason,check}]", "outcome:WORKED|FAILED|UNVERIFIED", "observation", "explanation", "whenToUse", "adaptation", "mistakesToAvoid", "evidenceRefs", "supersedesLessonIds", "method?:{schema:editflow.production-method.v1,family,sourceBindings,containers,anchors,channels,effects,dependencies,adaptationChecks,failureSymptoms}"],
  rules: ["Save reviewed successes, failures and discoveries at meaningful pass boundaries, before handoff and before completing Practice; individual operations need no separate persistence step.", "Preserve exact settings, troubleshooting and render/checkpoint evidence so a future GPT chat can reproduce the solution.", "Failed/unverified examples remain visible and never become automatically applied skills.", "Only the chosen editTypeId is written. Read current preset examples on every new session and resume."],
} as const;
