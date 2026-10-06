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
  confirmMs: 120000,
  startupMs: 8 * 60000,
  heartbeatMs: 20000,
  operationHeartbeatGraceMs: 180000,
  chatStatusFreshMs: 45000,
  handoffEvidence: 'OWNED_CHAT_FINISHED_OR_MISSING',
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
  const fresh = recognized && heartbeatAt > 0 && now - heartbeatAt <= policy.decisionHeartbeatMs;
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
  const owned = chat.tabId === snapshot.activeTabId && chat.generation === a.generation
    && chat.assignmentId === task.assignmentId;
  const fresh = owned && chat.checkedAt > 0 && now - chat.checkedAt <= (policy.chatStatusFreshMs || 45000);
  if (fresh && chat.state === "PROCESSING") {
    next.suspectAt = 0;
    next.suspectReason = null;
    return result("PROCESSING", "owned_chat_processing");
  }

  // Silence is a request to inspect the owned chat, not proof that it stopped.
  // Unknown, stale or unrelated browser observations must never revoke authority.
  const inactive = fresh && ["FINISHED", "MISSING"].includes(chat.state);
  if (inactive) {
    const reason = "owned_chat_" + chat.state.toLowerCase();
    if (next.suspectReason !== reason || next.suspectGeneration !== a.generation || next.suspectTabId !== chat.tabId) {
      next.suspectAt = now;
      next.suspectReason = reason;
      next.suspectGeneration = a.generation;
      next.suspectTabId = chat.tabId;
    }
    if (now - next.suspectAt < policy.quietMs + policy.confirmMs) {
      return result("VERIFYING", reason);
    }
    return result("STALLED", "confirmed_" + reason, "HANDOFF");
  }
  next.suspectAt = 0;
  next.suspectReason = null;
  const lease = decisionLeaseStatus(snapshot, now, policy);
  if (lease.active) return result("DECIDING", "authenticated_gpt_decision_lease");
  const activityAt = Math.max(a.issuedAt || 0, a.lastActivityAt || 0);
  const grace = a.lastActivityAt ? stagePolicy(snapshot, policy).quietMs : policy.startupMs;
  return now - activityAt < grace ? result("HEALTHY", "worker_activity_or_startup_grace")
    : result("VERIFYING", "owned_chat_state_required");

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