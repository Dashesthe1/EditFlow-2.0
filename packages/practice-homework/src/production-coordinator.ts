import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { affectedPracticePhaseIdsV1, type PracticeResidualV1 } from "./acceleration.js";
import { emptyProductionWorkflowV1, retainProductionWorkflowPlanV1, retainProductionWorkflowReviewV1, type ProductionWorkflowStateV1 } from "./production-workflow.js";

export type PracticeProductionStageV1 =
  | "PREFLIGHT"
  | "SOURCE_LOCK"
  | "WHOLE_EDIT_COVERAGE"
  | "RESEARCH"
  | "AE_CONSTRUCTION"
  | "LOCAL_PROOF"
  | "WHOLE_EDIT_PROOF"
  | "FINAL_CERTIFICATION"
  | "INFRA_RECOVERY";

export type PracticePhaseProductionStateV1 =
  | "UNRESOLVED"
  | "SOURCE_LOCKED"
  | "RESEARCH_READY"
  | "COVERED"
  | "CONSTRUCTED"
  | "PROVISIONAL_PASS"
  | "PROVEN";

const PRODUCTION_STAGES_V1: readonly PracticeProductionStageV1[] = [
  "PREFLIGHT", "SOURCE_LOCK", "WHOLE_EDIT_COVERAGE", "RESEARCH", "AE_CONSTRUCTION",
  "LOCAL_PROOF", "WHOLE_EDIT_PROOF", "FINAL_CERTIFICATION", "INFRA_RECOVERY",
];

export interface PracticeProductionPhaseV1 {
  readonly phaseId: string;
  readonly state: PracticePhaseProductionStateV1;
  readonly sourceCertificateKey: string | null;
  readonly researchKey: string | null;
  readonly constructionRevision: number | null;
  readonly consecutivePasses: number;
  readonly lastSimilarity: number | null;
  readonly lastProgressAt: string | null;
  readonly lastProofRef?: string | null;
  readonly proofCandidateKey?: string | null;
  readonly hypothesisKey?: string | null;
  readonly searchRounds?: number;
  readonly lastSearchScore?: number | null;
  readonly changeHypothesis?: boolean;
  readonly sourceValidatedAt?: string;
  readonly sourceValidationToken?: string;
  readonly sourceValidationRequired?: boolean;
}

export type PracticeTelemetryCategoryV1 =
  | "MEDIA_ANALYSIS"
  | "SOURCE_DECISION"
  | "GPT_REVIEW"
  | "RESEARCH"
  | "AE_MUTATION"
  | "RENDER"
  | "COMPARISON"
  | "PROOF_IO"
  | "INFRASTRUCTURE"
  | "IDLE";

export interface PracticeTelemetrySpanV1 {
  readonly schema: "editflow.practice-telemetry-span.v1";
  readonly spanId: string;
  readonly sessionId: string;
  readonly category: PracticeTelemetryCategoryV1;
  readonly stage: PracticeProductionStageV1;
  readonly phaseId: string | null;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly elapsedMs: number;
  readonly outcome: "SUCCESS" | "FAILED" | "CANCELLED";
  readonly detail: string | null;
  readonly activity?: "ACTIVE" | "MACHINE_WAIT" | "IDLE";
  readonly purpose?: "PREPARATION" | "LEARNING" | "PRODUCTION" | "REVIEW" | "EXPORT" | "RECOVERY";
}

export interface PracticeProductionCoordinatorSnapshotV1 {
  readonly schema: "editflow.practice-production-coordinator.v1";
  readonly sessionId: string;
  readonly coldStart: boolean;
  readonly stage: PracticeProductionStageV1;
  readonly stageStartedAt: string;
  readonly wholeEditCovered: boolean;
  readonly wholeEditPasses: number;
  readonly phases: readonly PracticeProductionPhaseV1[];
  readonly residuals: readonly PracticeResidualV1[];
  readonly aeCheckpoint: Readonly<{
    projectId: string | null;
    projectRevision: number | null;
    environmentFingerprint: string | null;
    activeCompId: string | null;
    projectPath: string | null;
    capturedAt: string;
  }> | null;
  readonly currentPhaseId: string | null;
  readonly inFlightOperation: string | null;
  readonly workerHeartbeatAt: string | null;
  readonly lastProgressAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly stageElapsedMs?: Readonly<Partial<Record<PracticeProductionStageV1, number>>>;
  readonly lastWholeProofRef?: string | null;
  readonly wholeProofCandidateKey?: string | null;
  readonly certified?: boolean;
  readonly strategyKey?: string;
  readonly strategyChangedAt?: string;
  readonly budgetBaselineMs?: Readonly<Partial<Record<PracticeProductionStageV1, number>>>;
  readonly workflow?: ProductionWorkflowStateV1;
}

export interface PracticeProductionActionV1 {
  readonly kind:
    | "LOCK_SOURCES"
    | "BUILD_WHOLE_EDIT_COVERAGE"
    | "RESEARCH_PHASE"
    | "CONSTRUCT_PHASE"
    | "CORRECT_RESIDUAL"
    | "RUN_WHOLE_EDIT_PROOF"
    | "RUN_LOCAL_PROOF"
    | "WAIT_FOR_PHASES"
    | "CHANGE_HYPOTHESIS"
    | "FINAL_CERTIFICATION"
    | "COMPLETE";
  readonly phaseIds: readonly string[];
  readonly reason: string;
}

const nowIso = (): string => new Date().toISOString();
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const stateRank: Record<PracticePhaseProductionStateV1, number> = {
  UNRESOLVED: 0,
  SOURCE_LOCKED: 1,
  RESEARCH_READY: 2,
  COVERED: 3,
  CONSTRUCTED: 4,
  PROVISIONAL_PASS: 5,
  PROVEN: 6,
};

const advance = (
  phase: PracticeProductionPhaseV1,
  state: PracticePhaseProductionStateV1,
  patch: Partial<PracticeProductionPhaseV1> = {},
): PracticeProductionPhaseV1 => ({
  ...phase,
  ...(stateRank[state] >= stateRank[phase.state] ? { state } : {}),
  ...patch,
  lastProgressAt: nowIso(),
});

export const practiceSourceCertificateKeyV1 = (input: {
  readonly sourceMediaId: string;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly direction: string;
  readonly playbackRate: number;
  readonly sourceIdentity?: string | null;
}): string => "source-lock:" + hash(input);

export const practiceResearchReuseKeyV1 = (input: {
  readonly effectIds: readonly string[];
  readonly editTypeId: string;
  readonly tutorialSourceId?: string | null;
  readonly methodVersion?: string | null;
}): string => "effect-research:" + hash({
  ...input,
  effectIds: [...input.effectIds].sort(),
});

export class PracticeProductionCoordinatorV1 {
  #snapshot: PracticeProductionCoordinatorSnapshotV1;

  constructor(sessionId: string, phaseIds: readonly string[], coldStart = false) {
    const createdAt = nowIso();
    this.#snapshot = {
      schema: "editflow.practice-production-coordinator.v1",
      sessionId,
      coldStart,
      stage: "PREFLIGHT",
      stageStartedAt: createdAt,
      wholeEditCovered: false,
      wholeEditPasses: 0,
      phases: [...new Set(phaseIds)].map((phaseId) => ({
        phaseId,
        state: "UNRESOLVED",
        sourceCertificateKey: null,
        researchKey: null,
        constructionRevision: null,
        consecutivePasses: 0,
        lastSimilarity: null,
        lastProgressAt: null,
      })),
      residuals: [],
      aeCheckpoint: null,
      currentPhaseId: null,
      inFlightOperation: null,
      workerHeartbeatAt: null,
      lastProgressAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    };
  }

  static fromSnapshot(snapshot: PracticeProductionCoordinatorSnapshotV1): PracticeProductionCoordinatorV1 {
    const coordinator = new PracticeProductionCoordinatorV1(
      snapshot.sessionId,
      snapshot.phases.map((phase) => phase.phaseId),
      snapshot.coldStart,
    );
    coordinator.#snapshot = {
      ...structuredClone(snapshot),
      stageStartedAt: snapshot.stageStartedAt ?? snapshot.updatedAt ?? snapshot.createdAt,
      residuals: structuredClone(snapshot.residuals ?? []),
      aeCheckpoint: snapshot.aeCheckpoint ?? null,
    };
    return coordinator;
  }

  snapshot(): PracticeProductionCoordinatorSnapshotV1 {
    return structuredClone(this.#snapshot);
  }

  retainWorkflowPlan(input: Record<string, any>): void {
    this.#commit({ workflow: retainProductionWorkflowPlanV1(this.#snapshot.workflow ?? emptyProductionWorkflowV1(), input) });
  }

  retainWorkflowReview(input: Record<string, any>): void {
    this.#commit({ workflow: retainProductionWorkflowReviewV1(this.#snapshot.workflow ?? emptyProductionWorkflowV1(), input) });
  }

  retainWorkflowMilestone(input: Record<string, any>): void {
    if (input.authority !== "CHATGPT_DIRECT" || !["FIRST_ROUGH", "FIRST_ACCEPTED_METHOD", "FINAL_REVIEW", "DELIVERY"].includes(input.name)
      || typeof input.evidenceRef !== "string" || !input.evidenceRef.trim() || !Number.isFinite(Date.parse(input.at))) throw new TypeError("Milestone requires ChatGPT choice, explicit time and evidence.");
    const workflow = this.#snapshot.workflow ?? emptyProductionWorkflowV1();
    const prior = workflow.milestones.find(m => m.name === input.name);
    if (prior && JSON.stringify(prior) !== JSON.stringify(input)) throw new TypeError("First milestones are immutable.");
    if (!prior) this.#commit({ workflow: { ...workflow, milestones: [...workflow.milestones, structuredClone(input)] } });
  }

  #commit(patch: Partial<PracticeProductionCoordinatorSnapshotV1>): void {
    const now = nowIso();
    if (patch.stage && patch.stage !== this.#snapshot.stage && !patch.stageElapsedMs) {
      patch = { ...patch, stageElapsedMs: { ...this.#snapshot.stageElapsedMs,
        [this.#snapshot.stage]: (this.#snapshot.stageElapsedMs?.[this.#snapshot.stage] ?? 0)
          + Math.max(0, Date.parse(now) - Date.parse(this.#snapshot.stageStartedAt)) } };
    }
    this.#snapshot = { ...this.#snapshot, ...patch, lastProgressAt: now, updatedAt: now };
  }

  #mapPhase(phaseId: string, fn: (phase: PracticeProductionPhaseV1) => PracticeProductionPhaseV1): void {
    let found = false;
    const phases = this.#snapshot.phases.map((phase) => {
      if (phase.phaseId !== phaseId) return phase;
      found = true;
      return fn(phase);
    });
    if (!found) throw new TypeError("Unknown Practice production phase: " + phaseId);
    this.#commit({ phases });
  }

  ensurePhases(phaseIds: readonly string[]): void {
    const known = new Set(this.#snapshot.phases.map((phase) => phase.phaseId));
    const additions = [...new Set(phaseIds)].filter((phaseId) => !known.has(phaseId)).map((phaseId) => ({
      phaseId,
      state: "UNRESOLVED" as const,
      sourceCertificateKey: null,
      researchKey: null,
      constructionRevision: null,
      consecutivePasses: 0,
      lastSimilarity: null,
      lastProgressAt: null,
    }));
    if (additions.length > 0) this.#commit({ phases: [...this.#snapshot.phases, ...additions] });
  }

  heartbeat(operation: string | null = null): void {
    const now = nowIso();
    this.#snapshot = {
      ...this.#snapshot,
      workerHeartbeatAt: now,
      inFlightOperation: operation,
      updatedAt: now,
    };
  }

  setStage(stage: PracticeProductionStageV1, phaseId: string | null = null): void {
    if (!PRODUCTION_STAGES_V1.includes(stage)) {
      throw new TypeError("Unknown Practice production stage: " + stage);
    }
    if (this.#snapshot.stage === stage && this.#snapshot.currentPhaseId === phaseId) return;
    const stageElapsedMs = { ...this.#snapshot.stageElapsedMs };
    if (stage !== this.#snapshot.stage) {
      stageElapsedMs[this.#snapshot.stage] = (stageElapsedMs[this.#snapshot.stage] ?? 0)
        + Math.max(0, Date.now() - Date.parse(this.#snapshot.stageStartedAt));
    }
    const stageStartedAt = stage === this.#snapshot.stage
      ? this.#snapshot.stageStartedAt
      : nowIso();
    this.#commit({ stage, stageStartedAt, currentPhaseId: phaseId, stageElapsedMs });
  }

  lockSource(phaseId: string, certificateKey: string, validatedAt?: string, validationToken?: string): void {
    const prior = this.#snapshot.phases.find((phase) => phase.phaseId === phaseId);
    if (prior?.sourceCertificateKey === certificateKey) return;
    if (prior?.sourceCertificateKey) this.invalidate([phaseId], "SOURCE");
    this.#mapPhase(phaseId, (phase) => advance(phase, "SOURCE_LOCKED", {
      sourceCertificateKey: certificateKey,
      sourceValidationRequired: false,
      ...(validatedAt ? { sourceValidatedAt: validatedAt } : {}),
      ...(validationToken ? { sourceValidationToken: validationToken } : {}),
    }));
    this.setStage("SOURCE_LOCK", phaseId);
  }

  migrateSourceCertificate(phaseId: string, certificateKey: string, validatedAt?: string): void {
    this.#mapPhase(phaseId, (phase) => ({ ...phase, sourceCertificateKey: certificateKey,
      ...(validatedAt ? { sourceValidatedAt: validatedAt } : {}) }));
  }

  requireSourceValidation(phaseId: string): void {
    this.invalidate([phaseId], "SOURCE");
    this.#mapPhase(phaseId, (phase) => ({ ...phase, sourceValidationRequired: true }));
  }

  markResearchReady(phaseId: string, researchKey: string): void {
    const prior = this.#snapshot.phases.find((phase) => phase.phaseId === phaseId);
    if (prior?.researchKey === researchKey) return;
    if (prior?.researchKey) this.invalidate([phaseId], "RESEARCH");
    this.#mapPhase(phaseId, (phase) => advance(phase, "RESEARCH_READY", { researchKey }));
    this.setStage("RESEARCH", phaseId);
  }

  markWholeEditCovered(constructionRevision: number | null = null): void {
    if (this.#snapshot.phases.length === 0 || this.#snapshot.phases.some((phase) => !phase.sourceCertificateKey)) {
      throw new TypeError("Whole-edit coverage requires every retained phase to be source locked.");
    }
    const phases = this.#snapshot.phases.map((phase) =>
      stateRank[phase.state] >= stateRank.SOURCE_LOCKED
        ? advance(phase, "COVERED", { constructionRevision: constructionRevision ?? phase.constructionRevision })
        : phase);
    this.#commit({
      stage: "WHOLE_EDIT_COVERAGE",
      stageStartedAt: this.#snapshot.stage === "WHOLE_EDIT_COVERAGE"
        ? this.#snapshot.stageStartedAt : nowIso(),
      wholeEditCovered: true,
      phases,
      currentPhaseId: null,
    });
  }

  markAeCheckpoint(input: {
    readonly projectId?: string | null;
    readonly projectRevision?: number | null;
    readonly environmentFingerprint?: string | null;
    readonly activeCompId?: string | null;
    readonly projectPath?: string | null;
  }): void {
    this.#commit({
      aeCheckpoint: {
        projectId: input.projectId ?? null,
        projectRevision: Number.isFinite(input.projectRevision) ? input.projectRevision! : null,
        environmentFingerprint: input.environmentFingerprint ?? null,
        activeCompId: input.activeCompId ?? null,
        projectPath: input.projectPath ?? null,
        capturedAt: nowIso(),
      },
    });
  }

  markConstructed(phaseId: string, revision: number | null): void {
    this.#mapPhase(phaseId, (phase) => ({ ...phase, state: "CONSTRUCTED",
      constructionRevision: revision,
      consecutivePasses: 0,
      lastProofRef: null, proofCandidateKey: null, lastProgressAt: nowIso(),
    }));
    this.#commit({ wholeEditPasses: 0, certified: false });
    this.setStage("AE_CONSTRUCTION", phaseId);
  }

  markLocalProof(phaseId: string, passed: boolean, similarity: number | null,
    proof?: { readonly evidenceRef: string; readonly candidateKey: string }): void {
    const previous = this.#snapshot.phases.find((phase) => phase.phaseId === phaseId);
    if (proof && proof.evidenceRef === previous?.lastProofRef) return;
    this.#mapPhase(phaseId, (phase) => {
      if (proof && proof.evidenceRef === phase.lastProofRef) return phase;
      if (!passed) return { ...phase, state: "CONSTRUCTED",
        consecutivePasses: 0,
        lastSimilarity: similarity,
        lastProofRef: proof?.evidenceRef ?? null, proofCandidateKey: null, lastProgressAt: nowIso(),
      };
      if (!phase.sourceCertificateKey || !phase.researchKey || stateRank[phase.state] < stateRank.CONSTRUCTED) {
        throw new TypeError("Local proof requires source, research, and construction evidence.");
      }
      const passes = proof && phase.proofCandidateKey !== proof.candidateKey
        ? 1 : Math.max(1, phase.consecutivePasses + 1);
      return { ...phase, state: passes >= 2 ? "PROVEN" : "PROVISIONAL_PASS",
        consecutivePasses: passes,
        lastSimilarity: similarity,
        lastProofRef: proof?.evidenceRef ?? null, proofCandidateKey: proof?.candidateKey ?? null,
        lastProgressAt: nowIso(),
      };
    });
    if (!passed || (proof && previous?.proofCandidateKey !== proof.candidateKey)) {
      this.#commit({ wholeEditPasses: 0, certified: false });
    }
    this.setStage("LOCAL_PROOF", phaseId);
  }

  confirmProvisionalFromWholeEdit(passingPhaseIds: readonly string[],
    proof?: { readonly evidenceRef: string; readonly candidateKey: string; readonly passed: boolean }): void {
    if (proof && proof.evidenceRef === this.#snapshot.lastWholeProofRef) return;
    const passing = new Set(passingPhaseIds);
    const phases = this.#snapshot.phases.map((phase) => {
      if (!passing.has(phase.phaseId)) return { ...phase, state: stateRank[phase.state] >= stateRank.CONSTRUCTED ? "CONSTRUCTED" as const : phase.state,
        consecutivePasses: 0, lastProofRef: proof?.evidenceRef ?? null, proofCandidateKey: null };
      if (phase.state !== "PROVISIONAL_PASS") return phase;
      if (proof && phase.lastProofRef === proof.evidenceRef) return phase;
      return advance(phase, "PROVEN", { consecutivePasses: Math.max(2, phase.consecutivePasses + 1) });
    });
    const wholeEditPasses = phases.length > 0 && phases.every((phase) => phase.state === "PROVEN") && proof?.passed !== false
      ? (proof && this.#snapshot.wholeProofCandidateKey !== proof.candidateKey ? 0 : this.#snapshot.wholeEditPasses) + 1
      : 0;
    this.#commit({
      stage: "WHOLE_EDIT_PROOF",
      stageStartedAt: this.#snapshot.stage === "WHOLE_EDIT_PROOF"
        ? this.#snapshot.stageStartedAt : nowIso(),
      phases, wholeEditPasses, currentPhaseId: null, certified: false,
      lastWholeProofRef: proof?.evidenceRef ?? null, wholeProofCandidateKey: proof?.candidateKey ?? null,
    });
  }

  markCertified(): void {
    if (this.#snapshot.wholeEditPasses < 2 || this.#snapshot.phases.length === 0
      || this.#snapshot.phases.some((phase) => phase.state !== "PROVEN")) {
      throw new TypeError("Final certification cannot bypass phase and whole-edit proof.");
    }
    this.#commit({ certified: true });
  }

  invalidate(phaseIds: readonly string[], target: "PROOF" | "CONSTRUCTION" | "RESEARCH" | "SOURCE"): void {
    const affected = new Set<string>();
    for (const phaseId of phaseIds) {
      for (const connected of affectedPracticePhaseIdsV1(phaseId, this.#snapshot.residuals)) affected.add(connected);
    }
    const phases = this.#snapshot.phases.map((phase) => {
      if (!affected.has(phase.phaseId)) return phase;
      if (target === "PROOF" || !phaseIds.includes(phase.phaseId)) return { ...phase,
        state: stateRank[phase.state] >= stateRank.CONSTRUCTED ? "CONSTRUCTED" as const : phase.state,
        consecutivePasses: 0, lastProofRef: null, proofCandidateKey: null, lastProgressAt: nowIso() };
      if (target === "CONSTRUCTION") return { ...phase, state: "COVERED" as const, constructionRevision: null, consecutivePasses: 0, lastProgressAt: nowIso() };
      if (target === "RESEARCH") return { ...phase, state: "SOURCE_LOCKED" as const, researchKey: null, constructionRevision: null, consecutivePasses: 0, lastProgressAt: nowIso() };
      return { ...phase, state: "UNRESOLVED" as const, sourceCertificateKey: null, researchKey: null, constructionRevision: null, consecutivePasses: 0, lastProgressAt: nowIso() };
    });
    this.#commit({ phases, wholeEditPasses: 0, certified: false, wholeEditCovered: target === "SOURCE" ? false : this.#snapshot.wholeEditCovered });
  }

  updateResiduals(residuals: readonly PracticeResidualV1[]): void {
    this.#commit({ residuals: structuredClone(residuals) });
  }

  liveness(input: { now?: number; staleAfterMs?: number; aeProgressAt?: number; checkpointAt?: number }): {
    stalled: boolean;
    reason: string;
    progressAt: number;
  } {
    const now = input.now ?? Date.now();
    const heartbeatAt = Date.parse(this.#snapshot.workerHeartbeatAt ?? "") || 0;
    const coordinatorAt = Date.parse(this.#snapshot.lastProgressAt) || 0;
    const progressAt = Math.max(heartbeatAt, coordinatorAt, input.aeProgressAt ?? 0, input.checkpointAt ?? 0);
    const staleAfterMs = input.staleAfterMs ?? 180_000;
    if (this.#snapshot.inFlightOperation !== null && now - heartbeatAt < staleAfterMs) return { stalled: false, reason: "production_operation_in_flight", progressAt };
    return now - progressAt >= staleAfterMs
      ? { stalled: true, reason: "production_state_stalled", progressAt }
      : { stalled: false, reason: "production_progress_recent", progressAt };
  }
}

export class PracticeProductionCoordinatorFileV1 {
  static readonly tails = new Map<string, Promise<void>>();
  readonly filePath: string;
  readonly telemetryPath: string;
  constructor(filePath: string, telemetryPath = filePath + ".telemetry.jsonl") {
    this.filePath = path.resolve(filePath);
    this.telemetryPath = path.resolve(telemetryPath);
  }

  async load(): Promise<PracticeProductionCoordinatorV1 | null> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as PracticeProductionCoordinatorSnapshotV1;
      if (parsed.schema !== "editflow.practice-production-coordinator.v1") throw new TypeError("Invalid Practice production coordinator snapshot.");
      return PracticeProductionCoordinatorV1.fromSnapshot(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(coordinator: PracticeProductionCoordinatorV1): Promise<void> {
    const snapshot = coordinator.snapshot();
    const pending = (PracticeProductionCoordinatorFileV1.tails.get(this.filePath) ?? Promise.resolve())
      .catch(() => undefined).then(async () => {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        const temporary = this.filePath + ".tmp-" + process.pid + "-" + randomUUID();
        try {
          await writeFile(temporary, JSON.stringify(snapshot, null, 2) + "\n", { encoding: "utf8", flush: true });
          for (let attempt = 0; ; attempt++) {
            try { await rename(temporary, this.filePath); break; }
            catch (error) {
              if (attempt >= 6 || !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
              await new Promise((resolve) => setTimeout(resolve, Math.min(500, 20 * 2 ** attempt)));
            }
          }
        } finally { await rm(temporary, { force: true }); }
      });
    PracticeProductionCoordinatorFileV1.tails.set(this.filePath, pending);
    try { await pending; } finally {
      if (PracticeProductionCoordinatorFileV1.tails.get(this.filePath) === pending) PracticeProductionCoordinatorFileV1.tails.delete(this.filePath);
    }
  }

  async appendTelemetry(span: PracticeTelemetrySpanV1): Promise<void> {
    await mkdir(path.dirname(this.telemetryPath), { recursive: true });
    await appendFile(this.telemetryPath, JSON.stringify(span) + "\n", "utf8");
  }

  async telemetrySummary(fromMs?: number, nowMs = Date.now()): Promise<Readonly<{
    totalElapsedMs: number;
    activeWallClockMs: number;
    observedWallClockMs: number;
    machineWaitWallClockMs: number;
    idleWallClockMs: number;
    wallClockElapsedMs: number | null;
    unattributedMs: number | null;
    activeUtilization: number | null;
    spanCount: number;
    byCategory: Readonly<Record<string, number>>;
    byStage: Readonly<Record<string, number>>;
    byPurpose: Readonly<Record<string, number>>;
    failedSpanCount: number;
  }>> {
    let textValue = "";
    try { textValue = await readFile(this.telemetryPath, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const spans = [...new Map(textValue.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line) as PracticeTelemetrySpanV1]; }
      catch { return []; }
    }).map(span => [span.spanId, span])).values()];
    const byCategory: Record<string, number> = {};
    const byStage: Record<string, number> = {};
    const byPurpose: Record<string, number> = {};
    let totalElapsedMs = 0;
    let failedSpanCount = 0;
    for (const span of spans) {
      const elapsed = Number.isFinite(span.elapsedMs) ? Math.max(0, span.elapsedMs) : 0;
      totalElapsedMs += elapsed;
      byCategory[span.category] = (byCategory[span.category] ?? 0) + elapsed;
      byStage[span.stage] = (byStage[span.stage] ?? 0) + elapsed;
      const purpose = span.purpose ?? "UNCLASSIFIED";
      byPurpose[purpose] = (byPurpose[purpose] ?? 0) + elapsed;
      if (span.outcome === "FAILED") failedSpanCount += 1;
    }
    const wallClockElapsedMs = Number.isFinite(fromMs)
      ? Math.max(0, nowMs - Number(fromMs))
      : null;
    const union = (selected: readonly PracticeTelemetrySpanV1[]): number => {
    const intervals = selected.map((span) => [Date.parse(span.startedAt), Date.parse(span.endedAt)] as const)
      .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end >= start)
      .map(([start, end]) => [Math.max(start, fromMs ?? start), Math.min(end, nowMs)] as const)
      .filter(([start, end]) => end >= start).sort((a, b) => a[0] - b[0]);
    let elapsed = 0, start = 0, end = 0;
    for (const interval of intervals) {
      if (interval[0] > end) { elapsed += Math.max(0, end - start); [start, end] = interval; }
      else end = Math.max(end, interval[1]);
    }
    return elapsed + Math.max(0, end - start);
    };
    const activeWallClockMs = union(spans.filter(s => s.activity === "ACTIVE"));
    const machineWaitWallClockMs = union(spans.filter(s => s.activity === "MACHINE_WAIT"));
    const idleWallClockMs = union(spans.filter(s => s.activity === "IDLE"));
    const observedWallClockMs = union(spans);
    const unattributedMs = wallClockElapsedMs === null
      ? null
      : Math.max(0, wallClockElapsedMs - observedWallClockMs);
    const activeUtilization = wallClockElapsedMs === null || wallClockElapsedMs <= 0 || unattributedMs !== 0
      ? null
      : Math.min(1, activeWallClockMs / wallClockElapsedMs);
    return {
      totalElapsedMs, activeWallClockMs, observedWallClockMs, machineWaitWallClockMs, idleWallClockMs, wallClockElapsedMs, unattributedMs, activeUtilization,
      spanCount: spans.length, byCategory, byStage, byPurpose, failedSpanCount,
    };
  }
}

export const practiceTelemetrySpanV1 = (input: {
  readonly spanId: string;
  readonly sessionId: string;
  readonly category: PracticeTelemetryCategoryV1;
  readonly stage: PracticeProductionStageV1;
  readonly phaseId?: string | null;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly outcome?: PracticeTelemetrySpanV1["outcome"];
  readonly detail?: string | null;
  readonly activity?: PracticeTelemetrySpanV1["activity"];
  readonly purpose?: PracticeTelemetrySpanV1["purpose"];
}): PracticeTelemetrySpanV1 => {
  if (!Number.isFinite(input.startedAtMs) || !Number.isFinite(input.endedAtMs) || input.endedAtMs < input.startedAtMs) throw new TypeError("Telemetry interval must be finite and increasing.");
  if (input.activity !== undefined && !["ACTIVE", "MACHINE_WAIT", "IDLE"].includes(input.activity)) throw new TypeError("Unknown telemetry activity.");
  if (input.purpose !== undefined && !["PREPARATION", "LEARNING", "PRODUCTION", "REVIEW", "EXPORT", "RECOVERY"].includes(input.purpose)) throw new TypeError("Unknown telemetry purpose.");
  return ({
  schema: "editflow.practice-telemetry-span.v1",
  spanId: input.spanId,
  sessionId: input.sessionId,
  category: input.category,
  stage: input.stage,
  phaseId: input.phaseId ?? null,
  startedAt: new Date(input.startedAtMs).toISOString(),
  endedAt: new Date(input.endedAtMs).toISOString(),
  elapsedMs: Math.max(0, input.endedAtMs - input.startedAtMs),
  outcome: input.outcome ?? "SUCCESS",
  detail: input.detail ?? null,
  ...(input.activity === undefined ? {} : { activity: input.activity }),
  ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
});
};
