'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { POLICY, evaluateLiveness, decisionLeaseStatus, noProgressLimit, semanticKey } = require('./liveness.js');
const now = 10000000;
function snapshot(patch = {}) {
  const base = {
    activeTabId: 99,
    authority: { state: 'ARMED', generation: 4, issuedAt: now - 200000, lastActivityAt: now - 70000, recent: [] },
    assignment: { assignmentId: 'retained', sessionId: 'retained-session', mode: 'PRACTICE', status: 'RUNNING' },
    production: { stage: 'RESEARCH', coldStart: false, lastProgressAt: new Date(now - 120000).toISOString(), workerHeartbeatAt: null, inFlightOperation: null, phases: [] },
    jobs: [],
  };
  return { ...base, ...patch, authority: { ...base.authority, ...patch.authority },
    assignment: { ...base.assignment, ...patch.assignment }, production: { ...base.production, ...patch.production } };
}
const observation = (state, checkedAt = now, patch = {}) => ({ state, checkedAt, tabId: 99, generation: 4, assignmentId: 'retained', ...patch });
test('one-minute verification inspects chat state but backend silence alone never revokes an active assignment', () => {
  for (const stage of [...Object.keys(POLICY.stage), 'UNKNOWN_STAGE']) {
    const s = snapshot({ production: { stage }, authority: { lastActivityAt: now - 59999 } });
    let v = evaluateLiveness({}, s, now);
    assert.equal(v.phase, 'HEALTHY');
    v = evaluateLiveness(v.next, s, now + 1);
    assert.equal(v.phase, 'VERIFYING');
    v = evaluateLiveness(v.next, s, now + 8 * 3600000);
    assert.equal(v.action, 'NONE', stage);
    assert.equal(v.reason, 'owned_chat_state_required');
  }
});
test('processing chat survives expired decision heartbeat, stage budget and repeated actions without inventing progress', () => {
  const s = snapshot({ chatExecution: observation('PROCESSING'), authority: { lastActivityAt: now - 3600000 } });
  const previous = evaluateLiveness({}, s, now - 10 * 3600000).next;
  previous.progressAt = now - 10 * 3600000;
  s.authority.recent = Array.from({ length: 8 }, (_, i) => ({ at: now - 5000 + i, signature: 'same-request', outcome: 'FAILED' }));
  const v = evaluateLiveness(previous, s, now);
  assert.equal(v.phase, 'PROCESSING');
  assert.equal(v.action, 'NONE');
  assert.equal(v.next.progressAt, previous.progressAt);
  assert.equal(v.next.stageBudgetWarning, true);
  assert.equal(v.next.repeatedActionWarning, true);
});
test('finished or missing owned chat must remain confirmed through one minute plus two-minute verification', () => {
  for (const state of ['FINISHED','MISSING']) {
    const s = snapshot({ chatExecution: observation(state) });
    let v = evaluateLiveness({}, s, now);
    assert.equal(v.phase, 'VERIFYING');
    assert.equal(v.action, 'NONE');
    s.chatExecution.checkedAt = now + POLICY.quietMs + POLICY.confirmMs - 1;
    v = evaluateLiveness(v.next, s, s.chatExecution.checkedAt);
    assert.equal(v.action, 'NONE');
    s.chatExecution.checkedAt++;
    v = evaluateLiveness(v.next, s, s.chatExecution.checkedAt);
    assert.equal(v.action, 'HANDOFF');
    assert.equal(v.reason, 'confirmed_owned_chat_' + state.toLowerCase());
  }
});
test('stale, unrelated, old-generation and unknown observations cannot authorize replacement', () => {
  for (const chat of [observation('FINISHED', now - POLICY.chatStatusFreshMs - 1),
    observation('FINISHED', now, { tabId: 100 }), observation('MISSING', now, { generation: 3 }),
    observation('FINISHED', now, { assignmentId: 'other' }), observation('UNKNOWN')]) {
    const s = snapshot({ chatExecution: chat });
    const previous = { generation: 4, key: semanticKey(s), suspectAt: now - 3600000, suspectReason: 'owned_chat_finished', suspectGeneration: 4, suspectTabId: 99 };
    const v = evaluateLiveness(previous, s, now);
    assert.equal(v.action, 'NONE');
    assert.equal(v.next.suspectAt, 0);
  }
});
test('resumed processing clears completion suspicion and a later completion starts a new confirmation window', () => {
  const s = snapshot({ chatExecution: observation('FINISHED') });
  let v = evaluateLiveness({}, s, now);
  s.chatExecution = observation('PROCESSING', now + 100000);
  v = evaluateLiveness(v.next, s, now + 100000);
  assert.equal(v.next.suspectAt, 0);
  s.chatExecution = observation('FINISHED', now + 180000);
  v = evaluateLiveness(v.next, s, now + 180000);
  assert.equal(v.action, 'NONE');
  assert.equal(v.next.suspectAt, now + 180000);
});
test('fresh GPT heartbeat is useful evidence when UI is unavailable but cannot mask completion of its turn', () => {
  const s = snapshot({ production: { workerHeartbeatAt: new Date(now).toISOString(), inFlightOperation: 'GPT_RESEARCH:shot12' } });
  assert.equal(decisionLeaseStatus(s, now).active, true);
  assert.equal(evaluateLiveness({}, s, now).phase, 'DECIDING');
  s.chatExecution = observation('FINISHED');
  assert.equal(evaluateLiveness({}, s, now).phase, 'VERIFYING');
});
test('a long accepted render is not interrupted by a wall-clock budget while queue heartbeat remains healthy', () => {
  const s = snapshot({ chatExecution: observation('FINISHED'), jobs: [{
    jobId: 'retained-render', kind: 'LOCAL_RENDER', status: 'RUNNING',
    startedAt: new Date(now - 3600000).toISOString(), heartbeatAt: new Date(now - 1000).toISOString(),
  }] });
  assert.equal(evaluateLiveness({}, s, now).phase, 'PROCESSING');
  s.jobs[0].heartbeatAt = new Date(now - 30000).toISOString();
  assert.equal(evaluateLiveness({}, s, now).action, 'NONE');
  s.jobs[0].heartbeatAt = new Date(now - POLICY.operationHeartbeatGraceMs - 1).toISOString();
  assert.equal(evaluateLiveness({}, s, now).action, 'REPAIR');
});
test('a running job with temporarily absent metadata is not falsely declared expired', () => {
  assert.equal(evaluateLiveness({}, snapshot({ jobs: [{ status: 'RUNNING', kind: 'PROOF_SCRIPT' }] }), now).phase, 'PROCESSING');
});
test('user cancel, explicit pause and terminal completion still take precedence over browser signals in both modes', () => {
  for (const mode of ['PRACTICE','PRO_CREATION']) {
    const s = snapshot({ assignment: { mode }, chatExecution: observation('PROCESSING') });
    s.authority.state = 'PAUSED';
    assert.equal(evaluateLiveness({}, s, now).phase, 'PAUSED');
    s.assignment.status = 'CANCEL_REQUESTED';
    assert.equal(evaluateLiveness({}, s, now).action, 'CANCEL');
    s.assignment.status = 'COMPLETED';
    assert.equal(evaluateLiveness({}, s, now).phase, 'IDLE');
    s.assignment.status = 'RUNNING'; s.authority.state = 'HANDOFF';
    assert.equal(evaluateLiveness({}, s, now).action, 'HANDOFF');
    s.authority.state = 'ARMED'; s.assignment.status = 'FAILED';
    assert.equal(evaluateLiveness({}, s, now).action, 'RECOVER_FAILED');
  }
});
test('transport loss and orphaned queue writer request infrastructure reconciliation without blind chat replacement', () => {
  assert.equal(evaluateLiveness({}, null, now).action, 'REPAIR');
  assert.equal(evaluateLiveness({}, snapshot({ writerOwner: 'retained-writer' }), now).action, 'REPAIR');
  assert.ok(noProgressLimit(snapshot()) > POLICY.quietMs + POLICY.confirmMs);
});
