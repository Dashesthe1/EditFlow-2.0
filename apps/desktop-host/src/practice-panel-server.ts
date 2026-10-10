import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { LoopbackCepBroker } from "./loopback-cep.js";
import { CurrentAeTransactionRuntimeV1, type CurrentAeStabilizationRuntimeV1 } from "./current-ae-transaction-runtime.js";

/** UI compatibility options. No option can enable an editing workflow. */
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
  readonly productionSupervision?: boolean;
  readonly practiceSourceMatchOnly?: boolean;
  readonly practiceSourceAssemblyEnabled?: boolean;
  readonly stabilization?: CurrentAeStabilizationRuntimeV1;
}

export type PracticePanelRunStateV1 = "SESSION_READY" | "CANCELLED";
export interface PracticePanelRunSnapshotV1 {
  readonly sessionId: string;
  readonly assignmentId: string;
  readonly mode: "PRACTICE" | "PRO_CREATION";
  readonly practiceRole: null;
  readonly editTypeId: string;
  readonly state: PracticePanelRunStateV1;
  readonly stage: null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly finishPath: string | null;
  readonly videoPaths: readonly string[];
  readonly audioPaths: readonly string[];
  readonly workflow: null;
  readonly steps: readonly [];
  readonly result: null;
  readonly allocation: null;
  readonly masteryScope: null;
  readonly masteryProofRef: null;
  readonly masteryReasons: readonly [];
  readonly finalRenderRef: null;
  readonly humanReview: null;
  readonly finalSummary: string;
  readonly error: null;
}
interface EditType {
  schema: "editflow.edit-type-profile.v1";
  editTypeId: string;
  title: string;
  choiceWords: string[];
  description?: string;
  revision: number;
  sessionIds: string[];
  masteredSessionIds: string[];
  behaviorEvidence: never[];
  gptLearning: { workedExamples: never[] };
}
interface UiState {
  schema: "editflow.empty-workflow-sessions.v1";
  activeRunId: string | null;
  runs: PracticePanelRunSnapshotV1[];
  controls: Record<string, Record<string, unknown>>;
}
class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const emptyMessage = "Session started. No editing workflow is configured.";
const json = (res: ServerResponse, status: number, value: unknown): void => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
};
const objectBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 1024 * 1024) throw new HttpError(413, "REQUEST_TOO_LARGE");
    chunks.push(bytes);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "JSON_OBJECT_REQUIRED");
  return value as Record<string, unknown>;
};
const required = (body: Record<string, unknown>, key: string): string => {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, key + " is required.");
  return value.trim();
};
const files = async (body: Record<string, unknown>, key: string, mandatory = false): Promise<string[]> => {
  const values = body[key] ?? [];
  if (!Array.isArray(values) || values.some(v => typeof v !== "string" || !v.trim()) || (mandatory && !values.length)) {
    throw new HttpError(400, key + " must contain valid file paths.");
  }
  return Promise.all(values.map(async (value: string) => {
    const file = path.resolve(value);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) throw new HttpError(400, "File not found: " + value);
    return file;
  }));
};
const atomicJson = async (file: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = file + ".tmp-" + randomUUID();
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n");
  await rename(temporary, file);
};

/** File selection, Edit Type CRUD and empty sessions only. No production worker is constructed. */
export class PracticePanelServerV1 {
  readonly config: PracticePanelServerConfigV1;
  #server: Server | null = null;
  #port = 0;
  #state: UiState = { schema: "editflow.empty-workflow-sessions.v1", activeRunId: null, runs: [], controls: {} };
  #tail: Promise<unknown> = Promise.resolve();
  #hostRevision: unknown = null;
  readonly #stateFile: string;
  constructor(config: PracticePanelServerConfigV1) {
    if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535 || config.token.length < 32) {
      throw new TypeError("Valid loopback port and EditFlow token are required.");
    }
    this.config = config;
    this.#stateFile = path.join(path.dirname(config.gptOrchestrationFilePath ?? config.editTypeRegistryFilePath), "ui-sessions.json");
  }
  get port(): number { return this.#port; }
  get isStarted(): boolean { return this.#server !== null; }
  get activeRunId(): string | null { return this.#state.activeRunId; }
  async start(): Promise<number> {
    if (this.#server) return this.#port;
    try {
      const stored = JSON.parse(await readFile(this.#stateFile, "utf8"));
      if (stored.schema !== this.#state.schema || !Array.isArray(stored.runs)) throw new Error("Invalid UI session state.");
      this.#state = stored;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const server = createServer((req, res) => { void this.#handle(req, res); });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.config.port, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
    this.#server = server;
    this.#port = (server.address() as AddressInfo).port;
    return this.#port;
  }
  async stop(): Promise<void> {
    await this.#tail;
    const server = this.#server;
    this.#server = null;
    if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    this.#port = 0;
  }
  async observeCurrentAe() {
    // An explicit read-only diagnostic. Session creation never calls it.
    const state = await new CurrentAeTransactionRuntimeV1(this.config.broker, "editflow-ui", 64).observe();
    this.#hostRevision = state.projectRevision;
    return { ...state, hostRevision: state.projectRevision };
  }
  controlStatus() {
    return {
      primaryWorkflow: null, availableWorkflows: [], workflowSelectionAllowed: false, workflowFallback: false,
      productionWorkflow: null, editorialAuthority: null, practiceNotebook: null,
      primaryProductionSystem: null, executionMode: "UI_ONLY_V1",
      sourceMatch: null, sourceMatchPolicy: null, sourceAssembly: null,
      practiceWorkflow: null, proCreationWorkflow: null, practiceSubsystemsEnabled: [], proCreationSubsystemsEnabled: [],
      practiceStartBehavior: "SAVE_EMPTY_SESSION", proCreationStartBehavior: "SAVE_EMPTY_SESSION",
      supervisorAutomation: "REMOVED", productionSupervisor: null,
      userControls: { active: null, latest: Object.values(this.#state.controls).at(-1) ?? null },
      mutationLease: { held: false, owner: null, expiresAt: null }, hostRevision: this.#hostRevision,
      productionJobKinds: [], workflowConfigured: false,
    };
  }
  async #exclusive<T>(work: () => Promise<T>): Promise<T> {
    const task = this.#tail.then(work);
    this.#tail = task.catch(() => undefined);
    return task;
  }
  async #profiles(): Promise<EditType[]> {
    try {
      const registry = JSON.parse(await readFile(this.config.editTypeRegistryFilePath, "utf8"));
      if (registry.schema !== "editflow.edit-type-registry.v1" || !Array.isArray(registry.profiles)) throw new Error("Invalid Edit Type registry.");
      // Only names/descriptions remain part of the empty workflow UI.
      return registry.profiles.map((p: EditType) => this.#profile(p.editTypeId, p.title, p.description));
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }
  #profile(editTypeId: string, title: string, description?: string): EditType {
    return { schema: "editflow.edit-type-profile.v1", editTypeId, title, choiceWords: [title],
      ...(description ? { description } : {}), revision: 1, sessionIds: [], masteredSessionIds: [],
      behaviorEvidence: [], gptLearning: { workedExamples: [] } };
  }
  async #createProfile(body: Record<string, unknown>): Promise<EditType> {
    const id = required(body, "editTypeId"), title = required(body, "title");
    const profiles = await this.#profiles();
    if (profiles.some(p => p.editTypeId === id)) throw new HttpError(409, "Edit Type already exists.");
    const profile = this.#profile(id, title, typeof body.description === "string" ? body.description : undefined);
    await atomicJson(this.config.editTypeRegistryFilePath, { schema: "editflow.edit-type-registry.v1", profiles: [...profiles, profile] });
    return profile;
  }
  async #input(body: Record<string, unknown>, mode: PracticePanelRunSnapshotV1["mode"]) {
    const editTypeId = required(body, "editTypeId");
    const videoPaths = await files(body, "videoPaths", true);
    const audioPaths = await files(body, "audioPaths");
    const finishPath = mode === "PRACTICE" ? (await files({ finish: [required(body, "finishPath")] }, "finish", true))[0]! : null;
    if (!(await this.#profiles()).some(p => p.editTypeId === editTypeId)) {
      if (mode === "PRACTICE" && typeof body.editTypeTitle === "string") {
        await this.#createProfile({ editTypeId, title: body.editTypeTitle });
      } else throw new HttpError(400, "EDIT_TYPE_NOT_FOUND: " + editTypeId);
    }
    return { editTypeId, videoPaths, audioPaths, finishPath };
  }
  async #createSession(body: Record<string, unknown>, mode: PracticePanelRunSnapshotV1["mode"]): Promise<PracticePanelRunSnapshotV1> {
    if (this.#state.activeRunId) throw new HttpError(409, "EditFlow session already active: " + this.#state.activeRunId);
    const input = await this.#input(body, mode);
    const sessionId = (mode === "PRACTICE" ? "practice:" : "pro:") + randomUUID();
    const run: PracticePanelRunSnapshotV1 = {
      sessionId, assignmentId: "ui-session:" + randomUUID(), mode, practiceRole: null, ...input,
      state: "SESSION_READY", stage: null, startedAt: new Date().toISOString(), completedAt: null,
      workflow: null, steps: [], result: null, allocation: null, masteryScope: null, masteryProofRef: null,
      masteryReasons: [], finalRenderRef: null, humanReview: null, finalSummary: emptyMessage, error: null,
    };
    const next: UiState = { ...this.#state, activeRunId: sessionId, runs: [...this.#state.runs, run] };
    await atomicJson(this.#stateFile, next);
    this.#state = next;
    return run;
  }
  #run(id: string): PracticePanelRunSnapshotV1 {
    const run = this.#state.runs.find(r => r.sessionId === id || r.assignmentId === id);
    if (!run) throw new HttpError(404, "Session not found.");
    return run;
  }
  async #cancel(id: string): Promise<PracticePanelRunSnapshotV1> {
    const old = this.#run(id);
    const run: PracticePanelRunSnapshotV1 = { ...old, state: "CANCELLED", completedAt: new Date().toISOString(), finalSummary: "Empty session cancelled." };
    const next = { ...this.#state, activeRunId: this.#state.activeRunId === old.sessionId ? null : this.#state.activeRunId,
      runs: this.#state.runs.map(r => r.sessionId === old.sessionId ? run : r) };
    await atomicJson(this.#stateFile, next); this.#state = next;
    return run;
  }
  #resume() {
    const run = this.#state.activeRunId ? this.#run(this.#state.activeRunId) : null;
    return { ...this.controlStatus(), run, assignment: null, session: run, nextOperation: "NONE", nextAction: "No editing workflow is configured.",
      workflowConfigured: false, production: null, queue: { jobs: [], receipts: [] }, checkpoint: null,
      rawSelections: [] };
  }
  async #lifecycle(body: Record<string, unknown>) {
    if (body.action === "STATUS") return { control: typeof body.requestId === "string" ? this.#state.controls[body.requestId] ?? null : null, ...this.#resume() };
    if (body.userRequested !== true) throw new HttpError(400, "USER_REQUEST_REQUIRED");
    const requestId = required(body, "requestId");
    if (this.#state.controls[requestId]) return { control: this.#state.controls[requestId], ...this.#resume() };
    let run: PracticePanelRunSnapshotV1;
    if (body.action === "START_PRACTICE" || body.action === "START_PRO_CREATION") {
      if (!body.input || typeof body.input !== "object" || Array.isArray(body.input)) throw new HttpError(400, "input is required.");
      run = await this.#createSession(body.input as Record<string, unknown>, body.action === "START_PRACTICE" ? "PRACTICE" : "PRO_CREATION");
    } else if (body.action === "CANCEL") run = await this.#cancel(required(body, "expectedAssignmentId"));
    else throw new HttpError(410, "WORKFLOW_NOT_CONFIGURED");
    const control = { requestId, action: body.action, status: "COMPLETED", step: "DONE", sessionId: run.sessionId, assignmentId: run.assignmentId };
    this.#state.controls[requestId] = control;
    await atomicJson(this.#stateFile, this.#state);
    return { ...this.#resume(), control, run };
  }
  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-EditFlow-Token");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
    try {
      const provided = req.headers["x-editflow-token"];
      if (typeof provided !== "string" || Buffer.byteLength(provided) !== Buffer.byteLength(this.config.token)
        || !timingSafeEqual(Buffer.from(provided), Buffer.from(this.config.token))) throw new HttpError(401, "UNAUTHORIZED");
      const url = new URL(req.url ?? "/", "http://127.0.0.1"), route = url.pathname;
      if (req.method === "GET" && route === "/v1/product/status") {
        json(res, 200, { service: "READY", panelConnected: this.config.broker.panelSession !== null, ...this.controlStatus(),
          gptOrchestration: "REMOVED", activeRunId: this.#state.activeRunId,
          activeRunState: this.#state.activeRunId ? this.#run(this.#state.activeRunId).state : null,
          latestRunId: this.#state.runs.at(-1)?.sessionId ?? null }); return;
      }
      if (route === "/v1/product/preflight" && req.method === "GET") {
        json(res, 200, { preflight: { schema: "editflow.connection-preflight.v1", status: "READY", checkedAt: new Date().toISOString(),
          checks: [{ id: "PRODUCT_SERVICE", ready: true, detail: "Session UI is ready." }] } }); return;
      }
      if (route === "/v1/product/edit-types") {
        if (req.method === "GET") { json(res, 200, { editTypes: await this.#profiles() }); return; }
        if (req.method === "POST") { const body = await objectBody(req); json(res, 201, { editType: await this.#exclusive(() => this.#createProfile(body)) }); return; }
      }
      if (req.method === "POST" && ["/v1/product/practice", "/v1/product/pro-creation"].includes(route)) {
        const body = await objectBody(req);
        json(res, 202, { run: await this.#exclusive(() => this.#createSession(body, route.endsWith("/practice") ? "PRACTICE" : "PRO_CREATION")) }); return;
      }
      if (req.method === "POST" && route === "/v1/product/pro-creation/prepare") {
        const input = await this.#input(await objectBody(req), "PRO_CREATION");
        json(res, 200, { preparation: { status: "READY", reasons: [], input, knowledge: null, workflow: null, steps: [] } }); return;
      }
      if (["GET", "POST"].includes(req.method ?? "") && ["/v1/product/practice/resume-or-start", "/v1/product/production/user-controls"].includes(route)) {
        if (req.method === "GET") { json(res, 200, this.#resume()); return; }
        const body = await objectBody(req);
        if (body.action) json(res, 200, await this.#exclusive(() => this.#lifecycle(body)));
        else {
          if (body.finishPath && !this.#state.activeRunId) await this.#exclusive(() => this.#createSession(body, "PRACTICE"));
          json(res, 200, this.#resume());
        }
        return;
      }
      const runRoute = /^\/v1\/product\/(?:runs|practice)\/([^/]+)(\/cancel)?$/.exec(route);
      if (runRoute && req.method === "GET" && !runRoute[2]) { json(res, 200, { run: this.#run(decodeURIComponent(runRoute[1]!)) }); return; }
      if (runRoute && req.method === "POST" && runRoute[2]) { json(res, 200, { run: await this.#exclusive(() => this.#cancel(decodeURIComponent(runRoute[1]!))) }); return; }
      if (req.method === "GET" && route === "/v1/product/gpt/assignments/next") { json(res, 200, { assignment: null, resumeRequired: false, ...this.controlStatus() }); return; }
      if (req.method === "GET" && route === "/v1/product/gpt/assignments") { json(res, 200, { assignments: [] }); return; }
      if (route.startsWith("/v1/product/")) throw new HttpError(410, "WORKFLOW_NOT_CONFIGURED");
      throw new HttpError(404, "NOT_FOUND");
    } catch (error) { json(res, error instanceof HttpError ? error.status : 400, { error: error instanceof Error ? error.message : String(error) }); }
  }
}
