import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
  let issues = 0;
  const gateway = createServer(async (req, res) => {
    let result;
    if (req.method === 'POST') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const b = JSON.parse(raw);
      if (b.action === 'ISSUE') { if (authority.launchId !== b.launchId) { issues++; authority.generation++; authority.launchId = b.launchId; } authority.state = 'ARMED'; authority.issuedAt = Date.now(); result = { authority, credential: 'ef-worker:1:' + 'a'.repeat(64) }; }
      else if (b.action === 'REVOKE') { authority.state = 'HANDOFF'; result = { ok: true }; }
    } else result = { authority, assignment: { assignmentId: 'same-assignment', sessionId: 'same-session', mode: 'PRO_CREATION', status: 'RUNNING' }, production: { phases: [] }, jobs: [], writerOwner: null };
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(result));
  });
  await new Promise(r => gateway.listen(0, '127.0.0.1', r));
  await writeFile(path.join(root, 'EditFlow2/current-runtime.json'), JSON.stringify({ productBaseUrl: 'http://127.0.0.1:' + gateway.address().port, stateDir }));
  const reserve = createServer(); await new Promise(r => reserve.listen(0, '127.0.0.1', r)); const port = reserve.address().port; await new Promise(r => reserve.close(r));
  let child;
  const start = () => { child = spawn(process.execPath, ['scripts/production-watchdog/supervisor.js'], { env: { ...process.env, APPDATA: root, LOCALAPPDATA: root, EDITFLOW_SUPERVISOR_ROOT: path.join(root, 'supervisor'), EDITFLOW_SUPERVISOR_PORT: String(port) }, stdio: 'pipe' }); };
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
  const health = await fetchJson('/health'); assert.ok(!JSON.stringify(health).includes('a'.repeat(64)));
  await fetchJson('/actuator/ack', { id: command.id, type: 'SENT', tabId: 99 });
  await stop(); start();
  await until(async () => (await fetchJson('/health')).activeTabId === 99);
  assert.equal((await fetchJson('/actuator')).command, 'NONE'); assert.equal(issues, 1);
  const rejected = await fetch(`http://127.0.0.1:${port}/actuator`); assert.equal(rejected.status, 403);
});
