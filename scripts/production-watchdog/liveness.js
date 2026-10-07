"use strict";

const STAGE_POLICY = Object.freeze({
  PREFLIGHT: Object.freeze({ quietMs: 60000, warmBudgetMs: 120000, coldBudgetMs: 300000 }),
  SOURCE_LOCK: Object.freeze({ quietMs: 60000, warmBudgetMs: 300000, coldBudgetMs: 1800000 }),
  WHOLE_EDIT_COVERAGE: Object.freeze({ quietMs: 60000, warmBudgetMs: 900000, coldBudgetMs: 1800000 }),
  RESEARCH: Object.freeze({ quietMs: 60000, warmBudgetMs: 600000, coldBudgetMs: 1200000 }),
  AE_CONSTRUCTION: Object.freeze({ quietMs: 60000, warmBudgetMs: 1800000, coldBudgetMs: 3600000 }),
  LOCAL_PROOF: Object.freeze({ quietMs: 60000, warmBudgetMs: 1200000, coldBudgetMs: 2400000 }),
  WHOLE_EDIT_PROOF: Object.freeze({ quietMs: 60000, warmBudgetMs: 900000, coldBudgetMs: 1800000 }),
  FINAL_CERTIFICATION: Object.freeze({ quietMs: 60000, warmBudgetMs: 900000, coldBudgetMs: 1800000 }),
  INFRA_RECOVERY: Object.freeze({ quietMs: 60000, warmBudgetMs: 180000, coldBudgetMs: 600000 }),
});

const POLICY = Object.freeze({
  quietMs: 60000,
  confirmMs: 0,
  terminalConfirmMs: 3000,
  unusableConfirmMs: 15000,
  unknownResolveMs: 60000,
  activityLeaseMs: 10000,
  minimumObservations: 2,
  unknownObservations: 3,
  startupMs: 8 * 60000,
  heartbeatMs: 20000,
  operationHeartbeatGraceMs: 180000,
  chatStatusFreshMs: 45000,
  handoffEvidence: 'OWNED_TERMINAL_OR_REVALIDATED_IDLE_WITHOUT_LIVE_LEASE',
  activeChatTimeoutHandoff: false,
  decisionHeartbeatMs: 180000,
  noProgressMs: 30 * 60000,
  hardBudgetMultiplier: 1.5,
  loopCount: 5,
  stage: STAGE_POLICY,
  deadlines: {
    AE_TRANSACTION: 120000,
    AE_CORRECTION: 180000,
    AE_BATCH: 120000,
    AE_GOAL: 120000,
    SAVE_CHECKPOINT: 120000,
    REFERENCE_ANALYSIS: 600000,
    LOCAL_RENDER: 1800000,
    BUILD_BASELINE: 1800000,
    PROOF_SCRIPT: 1800000,
    SCRATCH_SEARCH: 3600000,
  },
});

function validTime(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function stagePolicy(snapshot, policy = POLICY) {
  const p = snapshot?.production || {};
  return policy.stage?.[p.stage] || { quietMs: policy.quietMs, warmBudgetMs: policy.noProgressMs, coldBudgetMs: policy.noProgressMs };
}

function noProgressLimit(snapshot, policy = POLICY) {
  const p = snapshot?.production || {};
  const stage = stagePolicy(snapshot, policy);
  const budget = p.coldStart ? stage.coldBudgetMs : stage.warmBudgetMs;
  return Math.max(policy.noProgressMs, stage.quietMs + policy.confirmMs, Math.round(budget * policy.hardBudgetMultiplier));
}

function decisionLeaseStatus(snapshot, now, policy = POLICY) {
  const p = snapshot?.production || {};
  const operation = typeof p.inFlightOperation === "string" ? p.inFlightOperation.trim() : "";
  const heartbeatAt = validTime(p.workerHeartbeatAt);
  const recognized = /^GPT_(DECISION|RESEARCH|FOOTAGE|REFERENCE|REVIEW|PLANNING|ANALYSIS|WEB|DRIVE)(:|$)/i.test(operation);
  const fresh = recognized && heartbeatAt > 0 && heartbeatAt <= now && now - heartbeatAt <= policy.decisionHeartbeatMs;
  return {
    active: fresh,
    recognized,
    operation: operation || null,
    heartbeatAt: heartbeatAt || null,
    ageMs: heartbeatAt ? Math.max(0, now - heartbeatAt) : null,
  };
}

function semanticKey(snapshot) {
  const p = snapshot.production || {};
  return JSON.stringify({
    preflight: snapshot.assignment?.preflight?.stage,
    sources: snapshot.assignment?.preflight?.completedShotIds,
    stage: p.stage,
    currentPhaseId: p.currentPhaseId,
    covered: p.wholeEditCovered,
    passes: p.wholeEditPasses,
    certified: p.certified,
    strategy: p.strategyKey,
    checkpoint: p.aeCheckpoint ? [p.aeCheckpoint.projectPath, p.aeCheckpoint.projectRevision] : null,
    phases: (p.phases || []).map(x => [
      x.phaseId,
      x.state,
      x.sourceCertificateKey,
      x.researchKey,
      x.consecutivePasses,
      x.lastSimilarity,
      x.proofCandidateKey,
      x.lastSearchScore,
    ]),
    jobs: (snapshot.jobs || [])
      .filter(x => ["SUCCEEDED", "REVIEW_REQUIRED"].includes(x.status))
      .map(x => [x.operationSignature || x.jobId, x.status]),
  });
}

function operationFailure(snapshot, now, policy = POLICY) {
  const jobs = (snapshot.jobs || []).filter(x => x.status === "RUNNING");
  if (snapshot.writerOwner && !jobs.length) return "writer_requires_reconciliation";
  return jobs.some(x => {
    const heartbeatAt = validTime(x.heartbeatAt || x.updatedAt);
    // A healthy queue heartbeat protects a long operation regardless of wall-clock budget.
    // Require the full confirmation window before reconciling a lost queue worker.
    return heartbeatAt > 0 && now - heartbeatAt > (policy.operationHeartbeatGraceMs || policy.quietMs + policy.confirmMs);
  }) ? "operation_deadline_or_heartbeat_expired" : null;
}

function evaluateLiveness(previous, snapshot, now, policy = POLICY) {
  const next = { ...previous };
  const result = (phase, reason, action = "NONE") => ({ next, phase, reason, action });
  if (!snapshot) return result("INFRA_RECOVERY", "gateway_unavailable", "REPAIR");

  const a = snapshot.authority || {};
  const task = snapshot.assignment;
  const p = snapshot.production || {};
  if (!task || ["COMPLETED", "CANCELLED"].includes(task.status)) return result("IDLE", "assignment_terminal");
  if (task.cancelRequestedAt || task.status === "CANCEL_REQUESTED") return result("CANCELLING", "user_cancel", "CANCEL");
  if (a.state === "PAUSED") return result("PAUSED", "user_pause");
  if (task.status === "FAILED") return result("RECOVERING", "assignment_failed_checkpoint_retained", "RECOVER_FAILED");

  const key = semanticKey(snapshot);
  if (next.generation !== a.generation || next.key !== key) {
    next.key = key;
    next.progressAt = now;
    next.suspectAt = 0;
    next.suspectReason = null;
    next.generation = a.generation;
    next.loopBaselineAt = now;
    next.progressSeq = (next.progressSeq || 0) + 1;
  }

  const jobs = (snapshot.jobs || []).filter(x => x.status === "RUNNING");
  const failure = operationFailure(snapshot, now, policy);
  if (snapshot.writerOwner && !jobs.length) return result("INFRA_RECOVERY", failure, "REPAIR");
  if (jobs.length || snapshot.writerOwner) {
    next.suspectAt = 0;
    next.suspectReason = null;
    next.observerRepairRequested = false; next.observerRevalidatedAt = 0; next.observations = 0;
    return failure ? result("INFRA_RECOVERY", failure, "REPAIR")
      : result("PROCESSING", "accepted_operation_running");
  }

  if (a.state === "HANDOFF") return result("HANDOFF", "worker_revoked", "HANDOFF");

  const recent = (a.recent || []).filter(x => x.at > (next.loopBaselineAt || 0));
  const groups = new Map();
  for (const x of recent) groups.set(x.signature, (groups.get(x.signature) || 0) + 1);
  // Budgets and repeated requests are diagnostics for GPT, never authority to terminate it.
  next.repeatedActionWarning = [...groups.values()].some(count => count >= policy.loopCount);
  const progressAt = next.progressAt || Math.max(validTime(p.lastProgressAt), a.issuedAt || 0, now);
  next.stageBudgetWarning = now - progressAt >= noProgressLimit(snapshot, policy);
  const chat = snapshot.chatExecution || {};
  const owned = Number.isInteger(snapshot.activeTabId) && chat.tabId === snapshot.activeTabId
    && chat.generation === a.generation && chat.assignmentId === task.assignmentId
    && chat.sessionId === task.sessionId;
  const fresh = owned && Number.isFinite(chat.checkedAt) && chat.checkedAt > 0
    && chat.checkedAt <= now && now - chat.checkedAt <= policy.chatStatusFreshMs;
  const reset = () => {
    next.suspectAt = 0; next.suspectReason = null; next.observations = 0;
    next.lastObservationAt = 0; next.lastObservationId = null;
    next.observerRepairRequested = false; next.observerRevalidatedAt = 0;
  };
  const lease = decisionLeaseStatus(snapshot, now, policy);
  const activityAt = Math.max(a.issuedAt || 0, a.lastActivityAt || 0);
  const activityLease = activityAt > 0 && activityAt <= now && now - activityAt < policy.activityLeaseMs;
  const startup = !a.lastActivityAt && now - (a.issuedAt || 0) < policy.startupMs;
  next.leases = { chat: fresh && (chat.state === "PROCESSING" || chat.observation?.processing === true) && chat.observation?.ownerVerified === true && chat.observation?.observerHealthy === true,
    editflow: activityLease, decision: lease.active, startup };
  if (next.leases.chat || lease.active || activityLease) {
    reset();
    return next.leases.chat ? result("PROCESSING", "owned_chat_processing")
      : lease.active ? result("DECIDING", "authenticated_gpt_decision_lease")
      : result("HEALTHY", "authenticated_editflow_activity_lease");
  }
  const o = chat.observation || {};
  const healthy = fresh && o.observerHealthy === true && o.ownerVerified === true;
  const terminal = healthy && o.processing === false && (
    chat.state === "MISSING" && o.reason === "TARGET_MISSING"
    || chat.state === "FINISHED" && o.reason === "OWNED_FINISHED"
    || chat.state === "EXPIRED" && o.reason === "OWNED_EXPIRED" && o.terminalSurface === true
      && (o.composerUsable === false || o.recoveryAction === true)
    || chat.state === "UNUSABLE" && o.reason === "OWNED_UNUSABLE" && o.terminalSurface === true
      && o.composerUsable === false && o.recoveryAction === true);
  // UNKNOWN is actionable only after a functioning observer positively recognizes
  // the owned conversation shell and reports no active generation. Transport/DOM
  // failures cannot provide this evidence and instead repair the observer.
  const idleUnknown = healthy && chat.state === "UNKNOWN" && o.shellReady === true
    && o.processing === false && ["NO_CURRENT_ASSISTANT", "NO_FINAL_CONTROLS"].includes(o.reason);
  if (!terminal && !idleUnknown) {
    reset(); next.observerRepairRequested = true;
    return startup ? result("HEALTHY", "worker_startup_grace")
      : result("OBSERVER_RECOVERY", "owned_chat_observer_requires_revalidation", "REOBSERVE");
  }
  if (startup && !["EXPIRED", "UNUSABLE", "MISSING"].includes(chat.state)) {
    reset(); return result("HEALTHY", "worker_startup_grace");
  }
  const reason = "owned_chat_" + (idleUnknown ? "unresponsive" : chat.state.toLowerCase());
  const gap = next.lastObservationAt && chat.checkedAt - next.lastObservationAt > policy.chatStatusFreshMs;
  if (next.suspectReason !== reason || next.suspectGeneration !== a.generation
    || next.suspectTabId !== chat.tabId || gap) {
    reset(); next.suspectAt = now; next.suspectReason = reason;
    next.suspectGeneration = a.generation; next.suspectTabId = chat.tabId;
  }
  // The same cached snapshot, replayed ACK, or repeated supervisor tick is never
  // a second independent observation. A boot must acquire new evidence as well.
  if (chat.observationId && chat.observationId !== next.lastObservationId && chat.checkedAt > next.lastObservationAt) {
    next.observations = (next.observations || 0) + 1;
    next.lastObservationAt = chat.checkedAt; next.lastObservationId = chat.observationId;
    if (idleUnknown && o.revalidated === true) next.observerRevalidatedAt = chat.checkedAt;
  }
  next.observerRepairRequested = idleUnknown && !next.observerRevalidatedAt;
  const duration = idleUnknown ? policy.unknownResolveMs : chat.state === "FINISHED"
    ? policy.quietMs + policy.confirmMs : chat.state === "UNUSABLE" ? policy.unusableConfirmMs : policy.terminalConfirmMs;
  const count = idleUnknown ? policy.unknownObservations : policy.minimumObservations;
  if (now - next.suspectAt < duration || next.observations < count
    || idleUnknown && !next.observerRevalidatedAt) {
    return result("VERIFYING", reason, next.observerRepairRequested ? "REOBSERVE" : "NONE");
  }
  return result("STALLED", "confirmed_" + reason, "HANDOFF");

}

module.exports = {
  POLICY,
  STAGE_POLICY,
  evaluateLiveness,
  semanticKey,
  operationFailure,
  decisionLeaseStatus,
  noProgressLimit,
  stagePolicy,
};
