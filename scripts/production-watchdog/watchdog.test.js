'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { POLICY, evaluateLiveness } = require('./liveness.js');
const now = 1000000;
function snapshot(patch = {}) { return { authority: { state: 'ARMED', generation: 4, issuedAt: now - 200000,
  lastActivityAt: now - 70000, recent: [] }, assignment: { mode: 'PRACTICE', status: 'RUNNING' },
  production: { phases: [] }, jobs: [], ...patch }; }
function baseline(s, time = now) { return evaluateLiveness({}, s, time).next; }
test('silence requires operational grace and confirmation, never pixels or browser network', () => {
  const s = snapshot(); let v = evaluateLiveness(baseline(s), { ...s, stopVisible: true, thinkingSignal: 'extended_thinking', uiAt: now, streamAt: now }, now);
  assert.equal(v.phase, 'VERIFYING');
  v = evaluateLiveness(v.next, s, now + POLICY.confirmMs); assert.equal(v.action, 'HANDOFF');
});
test('long accepted render heartbeat protects a quiet GPT until its own deadline', () => {
  const s = snapshot({ jobs: [{ jobId: 'render', kind: 'LOCAL_RENDER', status: 'RUNNING', startedAt: new Date(now - 600000).toISOString(), heartbeatAt: new Date(now - 1000).toISOString() }] });
  assert.equal(evaluateLiveness({}, s, now).phase, 'PROCESSING');
  s.jobs[0].heartbeatAt = new Date(now - 30000).toISOString();
  assert.equal(evaluateLiveness({}, s, now).action, 'REPAIR');
  s.jobs[0].heartbeatAt = new Date(now).toISOString(); s.jobs[0].startedAt = new Date(now - 2000000).toISOString();
  assert.equal(evaluateLiveness({}, s, now).action, 'REPAIR');
});
test('five repeated failed actions without checkpoint delta trigger semantic-loop handoff', () => {
  const s = snapshot(); const previous = baseline(s, now - 10000);
  s.authority.recent = Array.from({ length: 5 }, (_, i) => ({ at: now - 5000 + i, signature: 'same-effect-same-target', outcome: 'FAILED' }));
  assert.equal(evaluateLiveness(previous, s, now).phase, 'LOOP');
  s.production.phases = [{ phaseId: 'shot3', state: 'PROVEN' }];
  assert.notEqual(evaluateLiveness(previous, s, now).phase, 'LOOP');
});
test('heartbeats do not count as checkpoint movement', () => {
  const s = snapshot(); const previous = baseline(s, now - POLICY.noProgressMs);
  s.authority.lastActivityAt = now;
  s.production.workerHeartbeatAt = new Date(now).toISOString(); s.production.lastProgressAt = new Date(now).toISOString();
  assert.equal(evaluateLiveness(previous, s, now).reason, 'activity_without_semantic_progress');
});
test('both production modes arm, manual pause survives, unfinished failure recovers', () => {
  for (const mode of ['PRACTICE', 'PRO_CREATION']) {
    const s = snapshot(); s.assignment.mode = mode; s.authority.state = 'HANDOFF';
    assert.equal(evaluateLiveness({}, s, now).action, 'HANDOFF');
    s.authority.state = 'PAUSED'; assert.equal(evaluateLiveness({}, s, now).phase, 'PAUSED');
    s.authority.state = 'ARMED'; s.assignment.status = 'FAILED'; assert.equal(evaluateLiveness({}, s, now).action, 'RECOVER_FAILED');
    s.assignment.status = 'COMPLETED'; assert.equal(evaluateLiveness({}, s, now).phase, 'IDLE');
  }
});
test('gateway loss repairs infrastructure and never authorizes blind browser replacement', () => {
  const v = evaluateLiveness({}, null, now); assert.equal(v.action, 'REPAIR'); assert.equal(v.phase, 'INFRA_RECOVERY');
});
