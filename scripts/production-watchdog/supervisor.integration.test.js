'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { CORE_TOOLS } = require('./transport-health.js');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const r = await check(); if (r) return r; await delay(100); }
  throw Error('TEST_DEADLINE');
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'supervisor-acceptance-'));
  const local = path.join(root, 'local'), app = path.join(root, 'app'), state = path.join(root, 'state');
  const task = { assignmentId: 'gpt-assignment:acceptance', sessionId: 'practice:acceptance', mode: 'PRACTICE', status: 'RUNNING' };
  let authority = { ...task, state: 'ARMED', generation: 4, launchId: 'original', issuedAt: Date.now() - 600000, lastActivityAt: Date.now() - 120000 };
  const production = { stage: 'RESEARCH', phases: [] }, actions = [], jobs = [];
  let onRead = null;
  const gateway = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    let raw = ''; for await (const c of req) raw += c;
    const b = raw ? JSON.parse(raw) : null;
    if (req.url === '/mcp') {
      if (b.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
      res.end(JSON.stringify({ jsonrpc: '2.0', id: b.id, result: b.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: { tools: {} } } : { tools: CORE_TOOLS.map(name => ({ name })) } })); return;
    }
    if (b) {
      actions.push(b.action);
      if (b.action === 'REVOKE') authority.state = 'HANDOFF';
      if (b.action === 'ISSUE' && authority.launchId !== b.launchId) { authority = { ...authority,
        state: 'ARMED', launchId: b.launchId, generation: authority.generation + 1, issuedAt: Date.now(), lastActivityAt: 0 }; }
      res.end(JSON.stringify({ authority, credential: 'ef-worker:' + authority.generation + ':' + 'a'.repeat(64) }));
    } else { if (onRead) onRead(); res.end(JSON.stringify({ authority, assignment: task, production, jobs, writerOwner: null })); }
  });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const gatewayUrl = 'http://127.0.0.1:' + gateway.address().port;
  const reserve = http.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  await fs.mkdir(path.join(local, 'EditFlow2'), { recursive: true });
  await fs.mkdir(path.join(state, 'production-supervision'), { recursive: true });
  await fs.mkdir(path.join(app, 'Adobe/CEP/extensions/com.editflow2.bridge/client'), { recursive: true });
  await fs.writeFile(path.join(local, 'EditFlow2/current-runtime.json'), JSON.stringify({ productBaseUrl: gatewayUrl, stateDir: state }));
  await fs.writeFile(path.join(state, 'production-supervision/supervisor.key'), 'test-key');
  await fs.writeFile(path.join(app, 'Adobe/CEP/extensions/com.editflow2.bridge/client/runtime-config.js'), 'Object.freeze({"token":"test-token"});');
  await fs.writeFile(path.join(root, 'production-state.json'), JSON.stringify({ activeTabId: 99, liveness: {},
    workerTabReceipt: { launchId: 'original', tabId: 99, generation: 4, ...task } }));
  await fs.writeFile(path.join(root, 'continuation-notes.json'), JSON.stringify({ ...task, text: 'STALE_TASK_SENTINEL: redo finished shot10 and require old plan gates' }));
  let child, errors = '';
  const base = 'http://127.0.0.1:' + port;
  async function start() {
    child = spawn(process.execPath, [path.join(__dirname, 'supervisor.js')], { env: { ...process.env,
      LOCALAPPDATA: local, APPDATA: app, EDITFLOW_SUPERVISOR_ROOT: root, EDITFLOW_SUPERVISOR_PORT: String(port),
      EDITFLOW_SUPERVISOR_TEST_TRANSPORT_URL: gatewayUrl + '/mcp' }, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', b => { errors += b; });
    await until(async () => { try { return (await (await fetch(base + '/health')).json()).transport.ready; } catch { return false; } });
  }
  async function stop() { if (!child || child.exitCode !== null) return; const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill(); await stopped; }
  t.after(async () => { await stop(); await new Promise(resolve => gateway.close(resolve)); await fs.rm(root, { recursive: true, force: true }); assert.equal(errors, ''); });
  const call = async (route, b) => fetch(base + route, { headers: { 'content-type': 'application/json', 'x-editflow-actuator-id': 'ljjjjjoghmheifakiiahgoonhhmoebog' },
    ...(b ? { method: 'POST', body: JSON.stringify(b) } : {}) });
  const command = async () => (await call('/actuator')).json();
  const ack = async b => { const response = await call('/actuator/ack', b); assert.equal(response.status, 200, await response.text()); };
  const observe = async (state, extra = {}) => {
    const cmd = await command(); assert.equal(cmd.command, 'NONE'); assert.ok(cmd.observe);
    await ack({ type: 'WORKER_STATUS', ...cmd.observe, state, observation: { observerHealthy: true, ownerVerified: true,
      processing: state === 'PROCESSING', shellReady: true, terminalSurface: true, composerUsable: false, recoveryAction: true, reason: 'OWNED_' + state, ...extra } });
    return cmd.observe;
  };
  await start();
  return { start, stop, call, command, ack, observe, actions, jobs, production, task,
    authority: () => authority, onRead: fn => { onRead = fn; },
    health: async () => (await (await fetch(base + '/health')).json()) };
}
test('real supervisor HTTP handoff closes before creating, survives restart, and issues exactly one replacement', async t => {
  const f = await fixture(t);
  const old = await f.observe('EXPIRED');
  const replay = await f.call('/actuator/ack', { type: 'WORKER_STATUS', ...old, state: 'EXPIRED' });
  assert.equal(replay.status, 409);
  await delay(3100); await f.observe('EXPIRED');
  const close = await until(async () => { const c = await f.command(); return c.command === 'STOP_CLOSE' && c; });
  assert.equal(close.tabId, 99); assert.deepEqual(f.actions, ['REVOKE']);
  await f.stop(); await f.start();
  assert.equal((await f.command()).id, close.id);
  await f.ack({ id: close.id, type: 'CLOSED' });
  const create = await until(async () => { const c = await f.command(); return c.command === 'CREATE' && c; });
  assert.equal(f.authority().generation, 5);
  await f.stop(); await f.start();
  assert.equal((await f.command()).id, create.id);
  await f.ack({ id: create.id, type: 'CREATED', tabId: 100 });
  const send = await f.command(); assert.equal(send.command, 'SEND'); assert.equal(send.tabId, 100);
  assert.doesNotMatch(send.prompt, /STALE_TASK_SENTINEL|redo finished shot10/);
  assert.match(send.prompt, /gpt-assignment:acceptance/); assert.match(send.prompt, /practice:acceptance/);
  await f.ack({ id: send.id, type: 'SENT', tabId: 100 });
  await until(async () => !(await f.health()).handoff);
  assert.equal(f.actions.filter(x => x === 'ISSUE').length, 1);
  assert.equal(f.actions.filter(x => x === 'REVOKE').length, 1);
  assert.equal((await f.health()).activeTabId, 100);
});
test('observer repair cannot enter revoke or interrupt path and ACKs require exact session', async t => {
  const f = await fixture(t);
  await f.observe('UNKNOWN', { reason: 'NO_FINAL_CONTROLS', processing: false });
  const repair = await until(async () => { const c = await f.command(); return c.observe?.repairObserver && c; });
  assert.equal(f.actions.length, 0);
  const wrong = await f.call('/actuator/ack', { type: 'WORKER_STATUS', ...repair.observe, sessionId: 'other', state: 'EXPIRED' });
  assert.equal(wrong.status, 409);
  await f.ack({ type: 'WORKER_STATUS', ...repair.observe, state: 'PROCESSING', observation: {
    ownerVerified: true, observerHealthy: true, processing: true, revalidated: true, reason: 'OWNED_PROCESSING' } });
  await until(async () => (await f.health()).reason === 'owned_chat_processing');
  assert.deepEqual(f.actions, []);
});
test('a new accepted render at final handoff recheck prevents revocation', async t => {
  const f = await fixture(t);
  await f.observe('EXPIRED'); await delay(3100);
  let reads = 0;
  f.onRead(() => { if (++reads === 2) f.jobs.push({ status: 'RUNNING', heartbeatAt: new Date().toISOString() }); });
  await f.observe('EXPIRED');
  await until(async () => (await f.health()).phase === 'PROCESSING');
  assert.deepEqual(f.actions, []);
});

test('live read-only expiry observations preserve an explicit pause and the worker generation', async t => {
  const f = await fixture(t); f.authority().state = 'PAUSED';
  await until(async () => (await f.health()).phase === 'PAUSED');
  await f.observe('EXPIRED'); await delay(3100); await f.observe('EXPIRED');
  assert.equal((await f.health()).phase, 'PAUSED'); assert.equal(f.authority().generation, 4);
  assert.deepEqual(f.actions, []);
});
