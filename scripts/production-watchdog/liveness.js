"use strict";
const POLICY = Object.freeze({ quietMs: 60000, confirmMs: 120000, startupMs: 180000,
  heartbeatMs: 20000, noProgressMs: 15 * 60000, loopCount: 5,
  deadlines: { AE_TRANSACTION: 120000, AE_CORRECTION: 180000, AE_BATCH: 120000,
    AE_GOAL: 120000, SAVE_CHECKPOINT: 120000, REFERENCE_ANALYSIS: 600000,
    LOCAL_RENDER: 1800000, BUILD_BASELINE: 1800000, PROOF_SCRIPT: 1800000, SCRATCH_SEARCH: 3600000 } });
function semanticKey(snapshot) {
  const p = snapshot.production || {};
  return JSON.stringify({ preflight: snapshot.assignment?.preflight?.stage,
    sources: snapshot.assignment?.preflight?.completedShotIds, stage: p.stage,
    covered: p.wholeEditCovered, passes: p.wholeEditPasses, certified: p.certified,
    strategy: p.strategyKey, checkpoint: p.aeCheckpoint ? [p.aeCheckpoint.projectPath, p.aeCheckpoint.projectRevision] : null,
    phases: (p.phases || []).map(x => [x.phaseId, x.state, x.sourceCertificateKey,
      x.researchKey, x.consecutivePasses, x.lastSimilarity, x.proofCandidateKey, x.lastSearchScore]),
    jobs: (snapshot.jobs || []).filter(x => ['SUCCEEDED', 'REVIEW_REQUIRED'].includes(x.status)).map(x => [x.operationSignature || x.jobId, x.status]) });
}
function operationFailure(snapshot, now, policy = POLICY) {
  const jobs = (snapshot.jobs || []).filter(x => x.status === 'RUNNING');
  if (snapshot.writerOwner && !jobs.length) return 'writer_requires_reconciliation';
  return jobs.some(x => now - Date.parse(x.heartbeatAt || x.updatedAt) > policy.heartbeatMs
    || now - Date.parse(x.startedAt || x.createdAt) > (policy.deadlines[x.kind] || 600000))
    ? 'operation_deadline_or_heartbeat_expired' : null;
}
function evaluateLiveness(previous, snapshot, now, policy = POLICY) {
  const next = { ...previous };
  const result = (phase, reason, action = 'NONE') => ({ next, phase, reason, action });
  if (!snapshot) return result('INFRA_RECOVERY', 'gateway_unavailable', 'REPAIR');
  const a = snapshot.authority || {}, task = snapshot.assignment;
  if (!task || ['COMPLETED', 'CANCELLED'].includes(task.status)) return result('IDLE', 'assignment_terminal');
  if (task.cancelRequestedAt || task.status === 'CANCEL_REQUESTED') return result('CANCELLING', 'user_cancel', 'CANCEL');
  if (a.state === 'PAUSED') return result('PAUSED', 'user_pause');
  if (task.status === 'FAILED') return result('RECOVERING', 'assignment_failed_checkpoint_retained', 'RECOVER_FAILED');
  const key = semanticKey(snapshot);
  if (next.generation !== a.generation || next.key !== key) {
    next.key = key; next.progressAt = now; next.suspectAt = 0; next.generation = a.generation;
    next.loopBaselineAt = now; next.progressSeq = (next.progressSeq || 0) + 1;
  }
  const jobs = (snapshot.jobs || []).filter(x => x.status === 'RUNNING');
  const failure = operationFailure(snapshot, now, policy);
  if (snapshot.writerOwner && !jobs.length) return result('INFRA_RECOVERY', failure, 'REPAIR');
  if (jobs.length || snapshot.writerOwner) {
    next.suspectAt = 0;
    return failure ? result('INFRA_RECOVERY', failure, 'REPAIR')
      : result('PROCESSING', 'accepted_operation_running');
  }
  if (a.state === 'HANDOFF') return result('HANDOFF', 'worker_revoked', 'HANDOFF');
  const activityAt = Math.max(a.issuedAt || 0, a.lastActivityAt || 0);
  const recent = (a.recent || []).filter(x => x.at > (next.loopBaselineAt || 0));
  const groups = new Map();
  for (const x of recent) groups.set(x.signature, (groups.get(x.signature) || 0) + 1);
  if ([...groups.values()].some(count => count >= policy.loopCount)) return result('LOOP', 'repeated_action_without_checkpoint_delta', 'HANDOFF');
  if (a.lastActivityAt && now - next.progressAt >= policy.noProgressMs) return result('STALLED', 'activity_without_semantic_progress', 'HANDOFF');
  const grace = a.lastActivityAt ? policy.quietMs : policy.startupMs;
  if (now - activityAt < grace) { next.suspectAt = 0; return result('HEALTHY', 'worker_activity_grace'); }
  if (!next.suspectAt) next.suspectAt = now;
  if (now - next.suspectAt < policy.confirmMs) return result('VERIFYING', 'no_worker_or_operation_activity');
  return result('STALLED', 'confirmed_operational_silence', 'HANDOFF');
}
module.exports = { POLICY, evaluateLiveness, semanticKey, operationFailure };
