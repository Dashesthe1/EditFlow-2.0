'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { POLICY, evaluateLiveness, semanticKey, decisionLeaseStatus } = require('./liveness.js');
const now = 10000000;
function snapshot(patch = {}) {
  const base = { activeTabId: 99,
    authority: { state: 'ARMED', generation: 4, issuedAt: now - 600000, lastActivityAt: now - 70000, recent: [] },
    assignment: { assignmentId: 'retained', sessionId: 'retained-session', status: 'RUNNING', mode: 'PRACTICE' },
    production: { stage: 'RESEARCH', phases: [] }, jobs: [] };
  return { ...base, ...patch, authority: { ...base.authority, ...patch.authority },
    assignment: { ...base.assignment, ...patch.assignment }, production: { ...base.production, ...patch.production } };
}
function observation(state, checkedAt = now, patch = {}) {
  return { state, checkedAt, observationId: 'sample-' + checkedAt, tabId: 99, generation: 4,
    assignmentId: 'retained', sessionId: 'retained-session',
    observation: { ownerVerified: true, observerHealthy: true, processing: state === 'PROCESSING',
      shellReady: true, terminalSurface: ['EXPIRED','UNUSABLE'].includes(state), composerUsable: !['EXPIRED','UNUSABLE'].includes(state), recoveryAction: true, reason: state === 'MISSING' ? 'TARGET_MISSING' : state === 'UNKNOWN' ? 'NO_FINAL_CONTROLS' : 'OWNED_' + state }, ...patch };
}
function simulate(s, duration, update = () => {}, previous = {}) {
  let v;
  for (let elapsed = 0; elapsed <= duration; elapsed += 3000) {
    const at = now + elapsed; update(s, at, elapsed);
    if (s.chatExecution) s.chatExecution = { ...s.chatExecution, checkedAt: at, observationId: 'sample-' + at };
    v = evaluateLiveness(previous, s, at); previous = v.next;
    if (v.action === 'HANDOFF') return { ...v, elapsed };
  }
  return { ...v, elapsed: duration };
}
test('explicit expiry/missing confirm in two independent samples over three seconds', () => {
  for (const state of ['EXPIRED', 'MISSING']) {
    const s = snapshot({ chatExecution: observation(state) });
    const v = simulate(s, 15000);
    assert.equal(v.action, 'HANDOFF'); assert.equal(v.elapsed, 3000);
  }
});
test('unusable error requires 15 seconds; normal finished response requires one minute', () => {
  for (const [state, duration] of [['UNUSABLE', 15000], ['FINISHED', 60000]]) {
    const v = simulate(snapshot({ chatExecution: observation(state) }), duration);
    assert.equal(v.action, 'HANDOFF'); assert.equal(v.elapsed, duration);
  }
});
test('unknown resolves after observer reinjection and repeated positive idle evidence', () => {
  const s = snapshot({ chatExecution: observation('UNKNOWN') });
  let revalidated = false;
  const v = simulate(s, 90000, (s, at, elapsed) => {
    if (elapsed === 3000) revalidated = true;
    s.chatExecution.observation.revalidated = revalidated;
  });
  assert.equal(v.action, 'HANDOFF'); assert.equal(v.elapsed, 60000);
  assert.equal(v.reason, 'confirmed_owned_chat_unresponsive');
});
test('unknown without revalidation requests repair, never replacement', () => {
  const v = simulate(snapshot({ chatExecution: observation('UNKNOWN') }), 600000);
  assert.equal(v.action, 'REOBSERVE'); assert.equal(v.next.observerRepairRequested, true);
});
test('unavailable or unfamiliar observer never supplies a negative proof of life', () => {
  for (const o of [{ observerHealthy: false }, { ownerVerified: false }, { shellReady: false },
    { reason: 'OBSERVER_UNAVAILABLE' }, { reason: 'OWNER_PROMPT_NOT_FOUND' }, { processing: undefined }]) {
    const chat = observation('UNKNOWN'); chat.observation = { ...chat.observation, revalidated: true, ...o };
    assert.equal(simulate(snapshot({ chatExecution: chat }), 600000).action, 'REOBSERVE');
  }
});
test('ten-minute reasoning and browsing retain workers despite stale heartbeat and budgets', () => {
  for (const stage of ['RESEARCH', 'AE_CONSTRUCTION']) {
    const s = snapshot({ chatExecution: observation('PROCESSING'), production: { stage },
      authority: { recent: Array.from({ length: 8 }, (_, i) => ({ at: now + i, signature: 'same' })) } });
    const v = simulate(s, 600000);
    assert.equal(v.action, 'NONE'); assert.equal(v.phase, 'PROCESSING');
    assert.equal(v.next.progressSeq, 1);
  }
});
test('fresh decision and authenticated activity leases protect even a terminal/unknown observation', () => {
  for (const state of ['UNKNOWN', 'EXPIRED', 'FINISHED', 'MISSING']) {
    const s = snapshot({ chatExecution: observation(state) });
    let v = simulate(s, 600000, (s, at) => {
      s.production.workerHeartbeatAt = new Date(at).toISOString(); s.production.inFlightOperation = 'GPT_WEB:research';
    });
    assert.equal(v.phase, 'DECIDING'); assert.equal(v.action, 'NONE');
    s.production.inFlightOperation = null;
    v = simulate(s, 600000, (s, at) => { s.authority.lastActivityAt = at; });
    assert.equal(v.action, 'NONE');
  }
});
test('a thirty-minute render stays protected; lost heartbeat repairs rather than spawning a chat', () => {
  const s = snapshot({ chatExecution: observation('EXPIRED'), jobs: [{ status: 'RUNNING', kind: 'LOCAL_RENDER' }] });
  let v = simulate(s, 1800000, (s, at) => { s.jobs[0].heartbeatAt = new Date(at).toISOString(); });
  assert.equal(v.action, 'NONE'); assert.equal(v.phase, 'PROCESSING');
  v = evaluateLiveness(v.next, s, now + 1800000 + POLICY.operationHeartbeatGraceMs + 1);
  assert.equal(v.action, 'REPAIR');
});
test('replayed/cached observations and stale gaps do not satisfy confirmation', () => {
  const s = snapshot({ chatExecution: observation('EXPIRED') });
  let v = evaluateLiveness({}, s, now);
  v = evaluateLiveness(v.next, s, now + 4000); assert.equal(v.action, 'NONE');
  s.chatExecution.checkedAt += 5000; // Same observation ID cannot count twice.
  v = evaluateLiveness(v.next, s, now + 5000); assert.equal(v.action, 'NONE');
  s.chatExecution = observation('EXPIRED', now + 60000);
  v = evaluateLiveness(v.next, s, now + 60000); assert.equal(v.action, 'NONE');
  assert.equal(v.next.observations, 1);
});
test('unrelated session, tab, generation and future/stale observations cannot replace a worker', () => {
  for (const chat of [observation('EXPIRED', now, { tabId: 100 }), observation('EXPIRED', now, { generation: 3 }),
    observation('EXPIRED', now, { assignmentId: 'other' }), observation('EXPIRED', now, { sessionId: 'other' }),
    observation('EXPIRED', now + 1), observation('EXPIRED', now - POLICY.chatStatusFreshMs - 1)]) {
    const s = snapshot({ chatExecution: chat });
    const v = evaluateLiveness({ generation: 4, key: semanticKey(s), suspectAt: now - 3600000,
      suspectReason: 'owned_chat_expired', observations: 100 }, s, now);
    assert.notEqual(v.action, 'HANDOFF'); assert.equal(v.next.suspectAt, 0);
  }
});
test('processing resumes and clears all terminal suspicion', () => {
  const s = snapshot({ chatExecution: observation('FINISHED') });
  let v = evaluateLiveness({}, s, now);
  s.chatExecution = observation('PROCESSING', now + 30000);
  v = evaluateLiveness(v.next, s, now + 30000); assert.equal(v.next.suspectAt, 0);
  s.chatExecution = observation('FINISHED', now + 60000);
  v = evaluateLiveness(v.next, s, now + 60000); assert.equal(v.action, 'NONE');
  assert.equal(v.next.suspectAt, now + 60000);
});
test('pause, cancel and completion precede every liveness lease in both modes', () => {
  for (const mode of ['PRACTICE', 'PRO_CREATION']) {
    const s = snapshot({ assignment: { mode }, chatExecution: observation('EXPIRED') });
    s.authority.state = 'PAUSED'; assert.equal(simulate(s, 600000).phase, 'PAUSED');
    s.assignment.status = 'CANCEL_REQUESTED'; assert.equal(evaluateLiveness({}, s, now).action, 'CANCEL');
    s.assignment.status = 'COMPLETED'; assert.equal(evaluateLiveness({}, s, now).phase, 'IDLE');
    s.assignment.status = 'RUNNING'; s.authority.state = 'HANDOFF'; assert.equal(evaluateLiveness({}, s, now).action, 'HANDOFF');
  }
});
test('future decision timestamps and orphaned writers cannot invent valid work', () => {
  const s = snapshot({ production: { inFlightOperation: 'GPT_RESEARCH', workerHeartbeatAt: new Date(now + 600000).toISOString() } });
  assert.equal(decisionLeaseStatus(s, now).active, false);
  assert.equal(evaluateLiveness({}, snapshot({ writerOwner: 'retained' }), now).action, 'REPAIR');
  assert.equal(evaluateLiveness({}, null, now).action, 'REPAIR');
});

test('contradictory active-turn evidence protects the worker from a terminal label', () => {
  const chat = observation('EXPIRED'); chat.observation.processing = true;
  const v = simulate(snapshot({ chatExecution: chat }), 600000);
  assert.equal(v.action, 'NONE'); assert.equal(v.phase, 'PROCESSING');
});
