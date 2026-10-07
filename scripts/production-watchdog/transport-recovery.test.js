'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { createRecoveryRunner } = require('./transport-recovery.js');

const failed = { ready: false, failures: 2, status: 'UNAVAILABLE' };
function fixture(options = {}) {
  const children = [], logs = [], calls = [];
  let time = 0, timeout, resolveProbe, completions = 0;
  const runner = createRecoveryRunner({ script: 'repair-transport.ps1', now: () => time,
    spawn(...args) {
      calls.push(args); const child = new EventEmitter();
      child.unref = () => {}; child.kill = () => { child.killed = true; child.emit('exit', null); };
      children.push(child); return child;
    },
    probe: () => new Promise(resolve => { resolveProbe = resolve; }),
    log: (type, detail) => logs.push({ type, ...detail }),
    completed: () => { completions++; },
    setTimer: callback => { timeout = callback; return 1; }, clearTimer() {}, ...options });
  return { runner, children, logs, calls, advance: ms => { time += ms; },
    timeout: () => timeout(), resolve: value => resolveProbe(value), completions: () => completions };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('repair stays single-flight through process exit and MCP readback, then observes cooldown', async () => {
  const f = fixture();
  assert.equal(f.runner.run(failed, 'retained-assignment'), true);
  f.advance(60000);
  assert.equal(f.runner.run(failed, 'retained-assignment'), false);
  f.children[0].emit('exit', 0);
  assert.equal(f.runner.run(failed, 'retained-assignment'), false);
  f.resolve({ ready: false, status: 'UNAVAILABLE' }); await flush();
  assert.equal(f.logs.at(-1).ready, false);
  assert.equal(f.completions(), 1);
  assert.equal(f.runner.run(failed, 'retained-assignment'), true);
  f.children[1].emit('exit', 0); f.resolve({ ready: true, status: 'READY' }); await flush();
  assert.equal(f.runner.run(failed, 'retained-assignment'), false);
  assert.deepEqual(f.calls[0][1].slice(-2), ['-AssignmentId', 'retained-assignment']);
});
test('healthy transport and isolated failures never launch a repair', () => {
  const f = fixture();
  assert.equal(f.runner.run({ ...failed, ready: true }), false);
  assert.equal(f.runner.run({ ...failed, failures: 1 }), false);
  assert.equal(f.children.length, 0);
});
test('launch errors produce sanitized, verified recovery results once', async () => {
  const f = fixture(); f.runner.run(failed);
  f.children[0].emit('error', Error('secret-url-and-credential'));
  f.children[0].emit('exit', 1);
  f.resolve({ ready: false, status: 'UNAVAILABLE' }); await flush();
  assert.equal(f.completions(), 1);
  assert.equal(f.logs.at(-1).reason, 'RECOVERY_PROCESS_FAILED');
  assert.doesNotMatch(JSON.stringify(f.logs), /secret-url/);
});
test('a stuck repair is bounded and verifies actual readiness after termination', async () => {
  const f = fixture(); f.runner.run(failed); f.timeout();
  assert.equal(f.children[0].killed, true);
  f.resolve({ ready: true, status: 'READY' }); await flush();
  assert.equal(f.logs.at(-1).reason, 'RECOVERY_TIMEOUT');
  assert.equal(f.logs.at(-1).ready, true);
  assert.equal(f.completions(), 1);
});
test('saved-route refresh preserves mappings and restores after failed off acknowledgment', { skip: process.platform !== 'win32' }, () => {
  const output = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'public-route-recovery.test.ps1')], { encoding: 'utf8' });
  assert.match(output, /PUBLIC_ROUTE_RECOVERY_TESTS_PASSED/);
});
