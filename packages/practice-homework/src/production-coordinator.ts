import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  affectedPracticePhaseIdsV1,
  rankPracticeResidualsV1,
  type PracticeResidualV1,
} from "./acceleration.js";

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

export interface PracticeProductionBudgetV1 {
  readonly stage: PracticeProductionStageV1;
  readonly warmBudgetMs: number;
  readonly coldBudgetMs: number;
}

export const DEFAULT_PRACTICE_PRODUCTION_BUDGETS_V1: readonly PracticeProductionBudgetV1[] = [
  { stage: "PREFLIGHT", warmBudgetMs: 120_000, coldBudgetMs: 300_000 },
  { stage: "SOURCE_LOCK", warmBudgetMs: 300_000, coldBudgetMs: 1_800_000 },
  { stage: "WHOLE_EDIT_COVERAGE", warmBudgetMs: 900_000, coldBudgetMs: 1_800_000 },
  { stage: "RESEARCH", warmBudgetMs: 600_000, coldBudgetMs: 1_200_000 },
  { stage: "AE_CONSTRUCTION", warmBudgetMs: 1_800_000, coldBudgetMs: 3_600_000 },
  { stage: "LOCAL_PROOF", warmBudgetMs: 1_200_000, coldBudgetMs: 2_400_000 },
  { stage: "WHOLE_EDIT_PROOF", warmBudgetMs: 900_000, coldBudgetMs: 1_800_000 },
  { stage: "FINAL_CERTIFICATION", warmBudgetMs: 900_000, coldBudgetMs: 1_800_000 },
  { stage: "INFRA_RECOVERY", warmBudgetMs: 180_000, coldBudgetMs: 600_000 },
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
    if (!DEFAULT_PRACTICE_PRODUCTION_BUDGETS_V1.some((budget) => budget.stage === stage)) {
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

  lockSource(phaseId: string, certificateKey: string, validatedAt?: string): void {
    const prior = this.#snapshot.phases.find((phase) => phase.phaseId === phaseId);
    if (prior?.sourceCertificateKey === certificateKey) return;
    if (prior?.sourceCertificateKey) this.invalidate([phaseId], "SOURCE");
    this.#mapPhase(phaseId, (phase) => advance(phase, "SOURCE_LOCKED", {
      sourceCertificateKey: certificateKey,
      sourceValidationRequired: false,
      ...(validatedAt ? { sourceValidatedAt: validatedAt } : {}),
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

  recordSearchResult(phaseId: string, hypothesisKey: string, score: number): void {
    this.#mapPhase(phaseId, (phase) => {
      const same = phase.hypothesisKey === hypothesisKey;
      const rounds = same ? (phase.searchRounds ?? 0) + 1 : 1;
      const prior = same ? phase.lastSearchScore : null;
      const gain = prior == null ? Infinity : (score - prior) / Math.max(Math.abs(prior), Number.EPSILON);
      return { ...phase, hypothesisKey, searchRounds: rounds, lastSearchScore: score,
        changeHypothesis: rounds >= 2 || gain < 0.01, lastProgressAt: nowIso() };
    });
  }

  parallelReadOnlyWork(maxJobs = 4): readonly Readonly<{
    kind: "RESEARCH_PREP" | "COMPARISON_PREP";
    phaseId: string;
    reason: string;
  }>[] {
    const jobs: Array<{ kind: "RESEARCH_PREP" | "COMPARISON_PREP"; phaseId: string; reason: string }> = [];
    for (const phase of this.#snapshot.phases) {
      if (jobs.length >= Math.max(1, maxJobs)) break;
      if (phase.sourceCertificateKey !== null && phase.researchKey === null) {
        jobs.push({
          kind: "RESEARCH_PREP", phaseId: phase.phaseId,
          reason: "Prepare tutorial/anatomy evidence without taking the single AE writer.",
        });
      }
    }
    for (const residual of rankPracticeResidualsV1(this.#snapshot.residuals)) {
      if (jobs.length >= Math.max(1, maxJobs)) break;
      if (jobs.some((job) => job.phaseId === residual.phaseId)) continue;
      jobs.push({
        kind: "COMPARISON_PREP", phaseId: residual.phaseId,
        reason: "Prepare residual diagnosis while the current AE mutation/render proceeds.",
      });
    }
    return jobs;
  }

  nextAction(residuals: readonly PracticeResidualV1[] = this.#snapshot.residuals): PracticeProductionActionV1 {
    if (this.#snapshot.phases.length === 0) return { kind: "WAIT_FOR_PHASES", phaseIds: [], reason: "Reference/source phases have not been retained yet." };
    if (this.#snapshot.certified) return { kind: "COMPLETE", phaseIds: [], reason: "Authoritative certification has completed." };
    const unresolved = this.#snapshot.phases.filter((phase) => phase.state === "UNRESOLVED").map((phase) => phase.phaseId);
    if (unresolved.length > 0) return { kind: "LOCK_SOURCES", phaseIds: unresolved, reason: "Source identity is a hard prerequisite." };
    if (!this.#snapshot.wholeEditCovered) {
      return { kind: "BUILD_WHOLE_EDIT_COVERAGE", phaseIds: this.#snapshot.phases.map((phase) => phase.phaseId), reason: "Coverage-first schedule requires a playable full edit before deep certification." };
    }
    const unresearched = this.#snapshot.phases.filter((phase) => phase.researchKey === null).map((phase) => phase.phaseId);
    if (unresearched.length > 0) return { kind: "RESEARCH_PHASE", phaseIds: [unresearched[0]!], reason: "Only the next affected phase needs research before mutation." };
    const unconstructed = this.#snapshot.phases.filter((phase) => stateRank[phase.state] < stateRank.CONSTRUCTED).map((phase) => phase.phaseId);
    if (unconstructed.length > 0) return { kind: "CONSTRUCT_PHASE", phaseIds: [unconstructed[0]!], reason: "Construct the next uncovered phase without blocking on deep proof elsewhere." };
    const ranked = rankPracticeResidualsV1(residuals).filter((item) =>
      this.#snapshot.phases.some((phase) => phase.phaseId === item.phaseId && phase.state !== "PROVEN"));
    const exhausted = this.#snapshot.phases.find((phase) => phase.changeHypothesis && phase.state !== "PROVEN");
    if (exhausted) return { kind: "CHANGE_HYPOTHESIS", phaseIds: [exhausted.phaseId], reason: "Two search rounds or less than 1% gain exhausted this construction hypothesis." };
    if (ranked.length > 0) return { kind: "CORRECT_RESIDUAL", phaseIds: [ranked[0]!.phaseId], reason: "Correct the highest viewer-impact residual first." };
    const provisional = this.#snapshot.phases.filter((phase) => phase.state === "PROVISIONAL_PASS").map((phase) => phase.phaseId);
    if (provisional.length > 0) return { kind: "RUN_WHOLE_EDIT_PROOF", phaseIds: provisional, reason: "Use one whole-edit render to supply second-pass confirmation for all provisional phases." };
    if (this.#snapshot.phases.every((phase) => phase.state === "PROVEN") && this.#snapshot.wholeEditPasses < 2) {
      return { kind: "RUN_WHOLE_EDIT_PROOF", phaseIds: this.#snapshot.phases.map((phase) => phase.phaseId), reason: "Exact final candidate still needs two whole-edit passes." };
    }
    if (this.#snapshot.wholeEditPasses >= 2) return { kind: "FINAL_CERTIFICATION", phaseIds: [], reason: "Phase and whole-edit proof gates are satisfied." };
    return { kind: "RUN_LOCAL_PROOF", phaseIds: this.#snapshot.phases.filter((phase) => phase.state === "CONSTRUCTED").map((phase) => phase.phaseId), reason: "Constructed phases still need local visual proof." };
  }

  budgetStatus(stage = this.#snapshot.stage, now = Date.now()): { exceeded: boolean; elapsedMs: number; budgetMs: number } {
    const budget = DEFAULT_PRACTICE_PRODUCTION_BUDGETS_V1.find((item) => item.stage === stage)!;
    const elapsedMs = Math.max(0, (this.#snapshot.stageElapsedMs?.[stage] ?? 0)
      + (stage === this.#snapshot.stage ? Math.max(0, now - Date.parse(this.#snapshot.stageStartedAt)) : 0)
      - (this.#snapshot.budgetBaselineMs?.[stage] ?? 0));
    const budgetMs = this.#snapshot.coldStart ? budget.coldBudgetMs : budget.warmBudgetMs;
    return { exceeded: elapsedMs > budgetMs, elapsedMs, budgetMs };
  }

  strategyDirective(now = Date.now()): Readonly<{
    action: "CONTINUE" | "ESCALATE_STRATEGY";
    stage: PracticeProductionStageV1;
    reason: string;
    elapsedMs: number;
    budgetMs: number;
  }> {
    const budget = this.budgetStatus(this.#snapshot.stage, now);
    const sessionOverrun = now - Date.parse(this.#snapshot.strategyChangedAt ?? this.#snapshot.createdAt) > (this.#snapshot.coldStart ? 6 : 4) * 3_600_000;
    return budget.exceeded || sessionOverrun
      ? {
          action: "ESCALATE_STRATEGY",
          stage: this.#snapshot.stage,
          reason: sessionOverrun ? "Production wall-clock SLO exceeded; diagnose the dominant time bucket and change strategy." : "Stage wall-clock budget exceeded; change search/construction strategy instead of silently waiting.",
          elapsedMs: budget.elapsedMs,
          budgetMs: budget.budgetMs,
        }
      : {
          action: "CONTINUE",
          stage: this.#snapshot.stage,
          reason: "Current stage remains within its wall-clock budget.",
          elapsedMs: budget.elapsedMs,
          budgetMs: budget.budgetMs,
        };
  }

  acknowledgeStrategyChange(strategyKey: string): void {
    if (!strategyKey.trim() || strategyKey === this.#snapshot.strategyKey) throw new TypeError("Budget acknowledgement requires a new concrete strategy.");
    const now = Date.now();
    const baseline = { ...this.#snapshot.stageElapsedMs };
    baseline[this.#snapshot.stage] = (baseline[this.#snapshot.stage] ?? 0) + Math.max(0, now - Date.parse(this.#snapshot.stageStartedAt));
    this.#commit({ strategyKey, strategyChangedAt: new Date(now).toISOString(), budgetBaselineMs: baseline });
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
    wallClockElapsedMs: number | null;
    unattributedMs: number | null;
    activeUtilization: number | null;
    spanCount: number;
    byCategory: Readonly<Record<string, number>>;
    byStage: Readonly<Record<string, number>>;
    failedSpanCount: number;
  }>> {
    let textValue = "";
    try { textValue = await readFile(this.telemetryPath, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const spans = textValue.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line) as PracticeTelemetrySpanV1]; }
      catch { return []; }
    });
    const byCategory: Record<string, number> = {};
    const byStage: Record<string, number> = {};
    let totalElapsedMs = 0;
    let failedSpanCount = 0;
    for (const span of spans) {
      const elapsed = Number.isFinite(span.elapsedMs) ? Math.max(0, span.elapsedMs) : 0;
      totalElapsedMs += elapsed;
      byCategory[span.category] = (byCategory[span.category] ?? 0) + elapsed;
      byStage[span.stage] = (byStage[span.stage] ?? 0) + elapsed;
      if (span.outcome === "FAILED") failedSpanCount += 1;
    }
    const wallClockElapsedMs = Number.isFinite(fromMs)
      ? Math.max(0, nowMs - Number(fromMs))
      : null;
    const intervals = spans.map((span) => [Date.parse(span.startedAt), Date.parse(span.endedAt)] as const)
      .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end >= start)
      .map(([start, end]) => [Math.max(start, fromMs ?? start), Math.min(end, nowMs)] as const)
      .filter(([start, end]) => end >= start).sort((a, b) => a[0] - b[0]);
    let activeWallClockMs = 0, start = 0, end = 0;
    for (const interval of intervals) {
      if (interval[0] > end) { activeWallClockMs += Math.max(0, end - start); [start, end] = interval; }
      else end = Math.max(end, interval[1]);
    }
    activeWallClockMs += Math.max(0, end - start);
    const unattributedMs = wallClockElapsedMs === null
      ? null
      : Math.max(0, wallClockElapsedMs - activeWallClockMs);
    const activeUtilization = wallClockElapsedMs === null || wallClockElapsedMs <= 0
      ? null
      : Math.min(1, activeWallClockMs / wallClockElapsedMs);
    return {
      totalElapsedMs, activeWallClockMs, wallClockElapsedMs, unattributedMs, activeUtilization,
      spanCount: spans.length, byCategory, byStage, failedSpanCount,
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
}): PracticeTelemetrySpanV1 => ({
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
});
