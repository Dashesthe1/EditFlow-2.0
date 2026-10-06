import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CORE_TOOLS } from '../scripts/production-watchdog/transport-health.js';
import { semanticKey } from '../scripts/production-watchdog/liveness.js';
const origin = 'chrome-extension://ljjjjjoghmheifakiiahgoonhhmoebog';
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn) { const deadline = Date.now() + 10000; while (Date.now() < deadline) { try { const value = await fn(); if (value) return value; } catch {} await delay(80); } throw Error('condition timeout'); }
test('supervisor process arms from gateway signals and restart retains the same worker and actuator handoff step', { timeout: 30000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'supervisor-process-'));
  const configDir = path.join(root, 'Adobe/CEP/extensions/com.editflow2.bridge/client');
  const stateDir = path.join(root, 'state');
  await mkdir(configDir, { recursive: true }); await mkdir(path.join(stateDir, 'production-supervision'), { recursive: true }); await mkdir(path.join(root, 'EditFlow2'));
  await writeFile(path.join(configDir, 'runtime-config.js'), 'window.CONFIG=Object.freeze({"token":"test-token"});');
  await writeFile(path.join(stateDir, 'production-supervision/supervisor.key'), 'admin-key');
  const authority = { assignmentId: 'same-assignment', sessionId: 'same-session', mode: 'PRO_CREATION', state: 'HANDOFF', generation: 0, issuedAt: 0, recent: [] };
  let issues = 0, userControl = null, latestUserControl = null;
  const gateway = createServer(async (req, res) => {
    let result;
    if (req.method === 'POST') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const b = JSON.parse(raw);
      if (b.method) {
        if (b.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
        const value = b.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: { tools: {} } } : { tools: CORE_TOOLS.map(name => ({ name })) };
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: b.id, result: value })); return;
      }
      if (b.action === 'ISSUE') { if (authority.launchId !== b.launchId) { issues++; authority.generation++; authority.launchId = b.launchId; } authority.state = 'ARMED'; authority.issuedAt = Date.now(); result = { authority, credential: 'ef-worker:1:' + 'a'.repeat(64) }; }
      else if (b.action === 'REVOKE') { authority.state = 'HANDOFF'; result = { ok: true }; }
      else if (b.action === 'CONTROL_FAILED') { latestUserControl = { ...userControl, status: 'FAILED', error: b.error }; userControl = null; result = { receipt: latestUserControl }; }
    } else result = { authority, assignment: { assignmentId: 'same-assignment', sessionId: 'same-session', mode: 'PRO_CREATION', status: 'RUNNING' }, production: { phases: [] }, jobs: [], writerOwner: null, userControl, latestUserControl };
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(result));
  });
  await new Promise(r => gateway.listen(0, '127.0.0.1', r));
  await writeFile(path.join(root, 'EditFlow2/current-runtime.json'), JSON.stringify({ productBaseUrl: 'http://127.0.0.1:' + gateway.address().port, stateDir }));
  const reserve = createServer(); await new Promise(r => reserve.listen(0, '127.0.0.1', r)); const port = reserve.address().port; await new Promise(r => reserve.close(r));
  let child;
  const start = () => { child = spawn(process.execPath, ['scripts/production-watchdog/supervisor.js'], { env: { ...process.env, APPDATA: root, LOCALAPPDATA: root, EDITFLOW_SUPERVISOR_ROOT: path.join(root, 'supervisor'), EDITFLOW_SUPERVISOR_PORT: String(port), EDITFLOW_SUPERVISOR_TEST_TRANSPORT_URL: 'http://127.0.0.1:' + gateway.address().port + '/mcp' }, stdio: 'pipe' }); };
  const stop = async () => { if (child?.exitCode === null) { const exited = new Promise(r => child.once('exit', r)); child.kill(); await exited; } };
  t.after(async () => { await stop(); await new Promise(r => gateway.close(r)); await rm(root, { recursive: true, force: true }); });
  const fetchJson = async (route, body) => (await fetch(`http://127.0.0.1:${port}${route}`, { headers: { origin, 'content-type': 'application/json' }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) })).json();
  start();
  let command = await until(async () => { const c = await fetchJson('/actuator'); return c.command === 'CREATE' && c; });
  assert.equal(issues, 1);
  await fetchJson('/actuator/ack', { id: command.id, type: 'CREATED', tabId: 99 });
  await stop(); start();
  command = await until(async () => { const c = await fetchJson('/actuator'); return c.command === 'SEND' && c; });
  assert.equal(command.tabId, 99); assert.match(command.prompt, /same-assignment/); assert.match(command.prompt, /Pro Creation/);
  assert.equal(issues, 1);
  const health = await fetchJson('/health'); assert.equal(health.transport.ready, true); assert.ok(!JSON.stringify(health).includes('a'.repeat(64)));
  await fetchJson('/actuator/ack', { id: command.id, type: 'SENT', tabId: 99 });
  await stop();
  authority.issuedAt = Date.now() - 20 * 60000; authority.lastActivityAt = Date.now() - 10 * 60000;
  const statePath = path.join(root, 'supervisor', 'production-state.json');
  const retained = JSON.parse(await readFile(statePath, 'utf8'));
  retained.liveness = { generation: authority.generation, key: semanticKey({
    authority, assignment: { status: 'RUNNING' }, production: { phases: [] }, jobs: [],
  }), progressAt: Date.now() - 10 * 60000, suspectAt: Date.now() - 5 * 60000, suspectReason: 'operational_silence' };
  await writeFile(statePath, JSON.stringify(retained));
  start();
  await until(async () => (await fetchJson('/health')).activeTabId === 99);
  const observationCommand = await fetchJson('/actuator');
  assert.equal(observationCommand.command, 'NONE'); assert.equal(issues, 1);
  assert.equal(observationCommand.observe.tabId, 99);
  assert.equal(observationCommand.observe.generation, authority.generation);
  assert.equal(observationCommand.observe.deliveryConfirmed, true);
  const badObservation = await fetch('http://127.0.0.1:' + port + '/actuator/ack', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'WORKER_STATUS', ...observationCommand.observe, generation: 0, state: 'FINISHED' }),
  });
  assert.equal(badObservation.status, 409);
  await fetchJson('/actuator/ack', { type: 'WORKER_STATUS', ...observationCommand.observe, state: 'PROCESSING',
    observation: { reason: 'OWNED_PROCESSING', userNodes: 1, hasGeneration: true, credential: 'private-worker-secret', rawText: 'private-conversation-text' } });
  await until(async () => (await fetchJson('/health')).phase === 'PROCESSING');
  const observedHealth = await fetchJson('/health');
  assert.deepEqual(observedHealth.chatExecution.observation, { reason: 'OWNED_PROCESSING', hasGeneration: true, userNodes: 1 });
  assert.doesNotMatch(JSON.stringify(observedHealth), /private-worker-secret|private-conversation-text/);
  await delay(2200);
  assert.equal((await fetchJson('/health')).authority.generation, authority.generation);
  assert.equal((await fetchJson('/actuator')).command, 'NONE'); assert.equal(issues, 1);
  userControl = { requestId: authority.launchId, action: 'REPLACE_CHAT', assignmentId: 'same-assignment', sessionId: 'same-session',
    step: 'VERIFYING', status: 'PENDING', generation: authority.generation, tabId: 99 };
  await delay(2200);
  await fetchJson('/actuator/ack', { type: 'WORKER_STATUS', ...observationCommand.observe, state: 'UNKNOWN', observation: { reason: 'NEWER_FOREIGN_CONTINUATION' } });
  await until(async () => (await fetchJson('/health')).phase === 'BLOCKED');
  assert.equal(latestUserControl.status, 'FAILED'); assert.match(latestUserControl.error, /another worker generation/);
  assert.equal(issues, 1); assert.equal(authority.state, 'ARMED');
  assert.equal((await fetchJson('/actuator')).command, 'NONE');
  await fetchJson('/actuator/ack', { type: 'WORKER_STATUS', ...observationCommand.observe, state: 'UNKNOWN',
    observation: { reason: 'OWNER_PROMPT_NOT_FOUND', hasAssignment: true, hasSession: true, hasGeneration: false } });
  await delay(2200);
  assert.equal((await fetchJson('/health')).phase, 'BLOCKED');
  assert.equal((await fetchJson('/health')).userControl, null);
  await stop(); start();
  await until(async () => (await fetchJson('/health')).phase === 'BLOCKED');
  assert.equal((await fetchJson('/health')).reason, 'owned_chat_worker_mismatch');
  assert.equal((await fetchJson('/actuator')).command, 'NONE');
  assert.equal(issues, 1); assert.equal(authority.state, 'ARMED');
  const rejected = await fetch(`http://127.0.0.1:${port}/actuator`); assert.equal(rejected.status, 403);
});
test('supervisor waits for public MCP readiness and launches exactly once after transport recovery', { timeout: 15000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'supervisor-transport-'));
  const configDir = path.join(root, 'Adobe/CEP/extensions/com.editflow2.bridge/client');
  const stateDir = path.join(root, 'state');
  await mkdir(configDir, { recursive: true }); await mkdir(path.join(stateDir, 'production-supervision'), { recursive: true }); await mkdir(path.join(root, 'EditFlow2'));
  await writeFile(path.join(configDir, 'runtime-config.js'), 'window.CONFIG=Object.freeze({"token":"test-token"});');
  await writeFile(path.join(stateDir, 'production-supervision/supervisor.key'), 'admin-key');
  const authority = { assignmentId: 'retained', sessionId: 'retained-session', mode: 'PRACTICE', state: 'HANDOFF', generation: 95, issuedAt: 0, recent: [] };
  let available = false, issues = 0;
  const gateway = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST') {
      let raw = ''; for await (const chunk of req) raw += chunk; const b = JSON.parse(raw);
      if (b.method) {
        if (!available) { res.writeHead(503); res.end('{}'); return; }
        if (b.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
        const result = b.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: { tools: {} } } : { tools: CORE_TOOLS.map(name => ({ name })) };
        res.end(JSON.stringify({ jsonrpc: '2.0', id: b.id, result })); return;
      }
      assert.equal(b.action, 'ISSUE'); issues++; authority.state = 'ARMED'; authority.generation++; authority.issuedAt = Date.now();
      res.end(JSON.stringify({ authority, credential: 'ef-worker:96:' + 'b'.repeat(64) })); return;
    }
    res.end(JSON.stringify({ authority, assignment: { assignmentId: 'retained', sessionId: 'retained-session', mode: 'PRACTICE', status: 'RUNNING' },
      production: { phases: [] }, jobs: [], writerOwner: null }));
  });
  await new Promise(r => gateway.listen(0, '127.0.0.1', r));
  await writeFile(path.join(root, 'EditFlow2/current-runtime.json'), JSON.stringify({ productBaseUrl: 'http://127.0.0.1:' + gateway.address().port, stateDir }));
  const reserve = createServer(); await new Promise(r => reserve.listen(0, '127.0.0.1', r)); const port = reserve.address().port; await new Promise(r => reserve.close(r));
  const child = spawn(process.execPath, ['scripts/production-watchdog/supervisor.js'], { env: { ...process.env, APPDATA: root, LOCALAPPDATA: root,
    EDITFLOW_SUPERVISOR_ROOT: path.join(root, 'supervisor'), EDITFLOW_SUPERVISOR_PORT: String(port),
    EDITFLOW_SUPERVISOR_TEST_TRANSPORT_URL: 'http://127.0.0.1:' + gateway.address().port + '/mcp' }, stdio: 'pipe' });
  t.after(async () => { if(child.exitCode === null) { const exit = new Promise(r => child.once('exit', r)); child.kill(); await exit; } await new Promise(r => gateway.close(r)); await rm(root, { recursive: true, force: true }); });
  const get = async route => (await fetch('http://127.0.0.1:' + port + route, { headers: { origin } })).json();
  await until(async () => (await get('/health')).transport?.status === 'UNAVAILABLE');
  assert.equal(issues, 0); assert.equal((await get('/actuator')).command, 'NONE');
  available = true;
  const command = await until(async () => { const c = await get('/actuator'); return c.command === 'CREATE' && c; });
  assert.ok(command.id); assert.equal(issues, 1); assert.equal((await get('/health')).transport.ready, true);
  assert.equal(authority.assignmentId, 'retained'); assert.equal(authority.sessionId, 'retained-session');
});
