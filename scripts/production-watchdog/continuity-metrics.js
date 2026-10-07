'use strict';

// Observed elapsed time only. PROCESSING does not pretend to identify GPT thinking,
// browsing or reviewing. Missing samples remain UNOBSERVED, including service restarts.
function activityBucket(snapshot, state, now, freshnessMs = 45000) {
  if (!snapshot?.assignment) return 'NO_ASSIGNMENT';
  if (snapshot.authority?.state === 'PAUSED') return 'USER_PAUSED';
  if (['COMPLETED','CANCELLED'].includes(snapshot.assignment.status)) return 'TERMINAL';
  const running = (snapshot.jobs || []).find(j => j.status === 'RUNNING');
  if (running) return running.kind === 'LOCAL_RENDER' ? 'RENDER_WAIT' : 'AE_OR_ANALYSIS_WAIT';
  if (state.handoff) return 'HANDOFF';
  if (['INFRA_RECOVERY','CONNECTOR_RECOVERY','OBSERVER_RECOVERY'].includes(state.phase)) return 'RECOVERY';
  const chat = snapshot.chatExecution;
  if (!chat || chat.tabId !== snapshot.activeTabId || chat.generation !== snapshot.authority?.generation
    || chat.assignmentId !== snapshot.assignment.assignmentId || chat.sessionId !== snapshot.assignment.sessionId
    || !Number.isFinite(chat.checkedAt) || chat.checkedAt > now || now - chat.checkedAt > freshnessMs
    || chat.observation?.ownerVerified !== true || chat.observation?.observerHealthy !== true) return 'UNOBSERVED';
  return chat.state === 'PROCESSING' ? 'CHAT_PROCESSING_UNCLASSIFIED' : chat.state === 'FINISHED' ? 'FINISHED_AWAITING_HANDOFF' : 'CHAT_' + chat.state;
}
function recordContinuitySample(previous, snapshot, state, now, maximumGapMs = 15000) {
  const identity = snapshot?.assignment?.sessionId || null;
  const prior = previous?.sessionId === identity ? previous : null;
  const next = prior ? { ...prior, milliseconds: { ...prior.milliseconds } }
    : { schema:'editflow.continuity-metrics.v1', sessionId:identity, startedAt:now, milliseconds:{}, samples:0, handoffs:0 };
  const elapsed = prior && now >= prior.lastSampleAt ? now - prior.lastSampleAt : 0;
  if (elapsed) {
    const bucket = elapsed <= maximumGapMs ? prior.bucket : 'UNOBSERVED';
    next.milliseconds[bucket] = (next.milliseconds[bucket] || 0) + elapsed;
  }
  next.bucket = activityBucket(snapshot, state, now);
  if (next.bucket === 'HANDOFF' && prior?.bucket !== 'HANDOFF') next.handoffs++;
  next.lastSampleAt = now; next.samples++;
  return next;
}
module.exports = { activityBucket, recordContinuitySample };
