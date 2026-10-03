import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { GptOrchestrationStoreV1, EditTypeRegistryFileV1 } from '../.tmp/runtime/packages/practice-homework/src/index.js';
import { PracticePanelServerV1 } from '../.tmp/runtime/apps/desktop-host/src/practice-panel-server.js';
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn) { const deadline = Date.now() + 14000; let error; while (Date.now() < deadline) { try { const result = await fn(); if (result) return result; } catch (e) { error = e; } await delay(80); } throw Error('condition timeout: ' + (error?.message || 'predicate remained false')); }
const ready = { stage: 'READY', updatedAt: new Date().toISOString(), requireTransferNovelty: false, completedShotIds: [], unresolvedShotIds: [], reasons: [], evidenceRefs: [] };

async function fixture(t, { existing = true, cancelled = false, paused = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'production-user-control-'));
  const stateDir = path.join(root, 'state'), configDir = path.join(root, 'Adobe/CEP/extensions/com.editflow2.bridge/client');
  await mkdir(configDir, { recursive: true }); await mkdir(path.join(root, 'EditFlow2'), { recursive: true });
  const token = 'lifecycle-test-token-0123456789abcdef';
  const broker = { isStarted: true, panelSession: { protocolVersion: '1.1.0', extensionVersion: 'test' }, port: 0,
    async dispatch(request) {
      assert.ok(['host.probe', 'project.inspect'].includes(request.command), 'Lifecycle must not perform AE mutations');
      return { ...request, outcome: 'NO_OP', error: null, affectedObjects: [], readback: null,
        projectSnapshot: request.command === 'project.inspect' ? { hostRevision: 42, filePath: 'retained.aep', activeItemHostId: null, itemCount: 0, items: [] } : null,
        environmentProbe: request.command === 'host.probe' ? { adapterProtocolVersion: request.protocolVersion, adapterBuild: 'test', hostName: 'Adobe After Effects', hostVersion: '25.6.6', hostBuild: '4', os: 'test', projectOpen: true } : null,
        hostProjectRevision: 42, diagnostics: { adapterProtocolVersion: request.protocolVersion, adapterBuild: 'test', command: request.command, notes: [] }, proofArtifactRefs: [] };
    } };
  const input = { editTypeId: 'microwave-edit', practiceRole: 'LEARNING', videoPaths: [path.join(root, 'raw.mp4')], audioPaths: [path.join(root, 'raw.mp3')], finishPath: path.join(root, 'ref.mp4') };
  for (const file of [...input.videoPaths, ...input.audioPaths, input.finishPath]) await writeFile(file, 'test-media');
  const config = { port: 0, token, broker, repositoryRoot: process.cwd(), artifactDir: path.join(root, 'artifacts'), gptOrchestrationFilePath: path.join(stateDir, 'gpt.json'), learningMemoryFilePath: path.join(root, 'memory.json'), editTypeRegistryFilePath: path.join(root, 'types.json') };
  const registryFile = new EditTypeRegistryFileV1(config.editTypeRegistryFilePath), registry = await registryFile.load();
  registry.create({ editTypeId: input.editTypeId, title: 'Microwave', choiceWords: ['Microwave'] }); await registryFile.save(registry);
  const store = new GptOrchestrationStoreV1(config.gptOrchestrationFilePath);
  let old;
  if (existing) {
    old = await store.createAssignment({ sessionId: 'practice:old', mode: 'PRACTICE', practiceRole: 'LEARNING', editTypeId: input.editTypeId, artifactDir: path.join(root, 'old-artifacts'), knowledge: null,
      preflight: ready, finish: { mediaId: 'ref', role: 'FINISH_REFERENCE', mediaKind: 'VIDEO', uri: input.finishPath }, start: [
        { mediaId: 'raw', role: 'START_SOURCE', mediaKind: 'VIDEO', uri: input.videoPaths[0] }, { mediaId: 'audio', role: 'START_SOURCE', mediaKind: 'AUDIO', uri: input.audioPaths[0] }] });
    await store.claim(old.assignmentId, 'legacy'); if (cancelled) await store.requestCancel(old.assignmentId);
  }
  let service = new PracticePanelServerV1(config); await service.start();
  let base = 'http://127.0.0.1:' + service.port;
  const call = async (route, body, admin = false) => {
    const headers = { 'x-editflow-token': token, 'content-type': 'application/json' };
    if (admin) headers['x-editflow-supervisor-key'] = (await readFile(path.join(stateDir, 'production-supervision/supervisor.key'), 'utf8')).trim();
    const r = await fetch(base + route, { headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    return { status: r.status, ...await r.json() };
  };
  const admin = body => call('/v1/product/production/supervision', body, true);
  if (old && paused) await admin({ action: 'PAUSE', assignmentId: old.assignmentId, generation: 0, reason: 'user_pause' });
  const reserve = createServer(); await new Promise(r => reserve.listen(0, '127.0.0.1', r)); const port = reserve.address().port; await new Promise(r => reserve.close(r));
  await writeFile(path.join(configDir, 'runtime-config.js'), 'window.CONFIG=Object.freeze(' + JSON.stringify({ token }) + ');');
  async function manifest() { await writeFile(path.join(root, 'EditFlow2/current-runtime.json'), JSON.stringify({ productBaseUrl: base, stateDir })); }
  await manifest();
  const sideRoot = path.join(root, 'supervisor'); await mkdir(sideRoot);
  await writeFile(path.join(sideRoot, 'production-state.json'), JSON.stringify({ activeTabId: old ? 80 : null }));
  let child;
  const startSupervisor = () => { child = spawn(process.execPath, ['scripts/production-watchdog/supervisor.js'], { env: { ...process.env, APPDATA: root, LOCALAPPDATA: root, EDITFLOW_SUPERVISOR_ROOT: sideRoot, EDITFLOW_SUPERVISOR_PORT: String(port) }, stdio: 'pipe' }); };
  const stopSupervisor = async () => { if (child?.exitCode === null) { const p = new Promise(r => child.once('exit', r)); child.kill(); await p; } };
  const actuator = async (route, body) => { const r = await fetch('http://127.0.0.1:' + port + route, { headers: { origin: 'chrome-extension://ljjjjjoghmheifakiiahgoonhhmoebog', 'content-type': 'application/json' }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) }); return { status: r.status, ...await r.json() }; };
  t.after(async () => { await stopSupervisor(); await service.stop(); await rm(root, { recursive: true, force: true }); });
  return { input, old, store, broker, call, admin, actuator, startSupervisor, stopSupervisor,
    async restartGateway() { await service.stop(); service = new PracticePanelServerV1(config); await service.start(); base = 'http://127.0.0.1:' + service.port; await manifest(); } };
}

async function deliver(f, requestId, { close = true, restart = false } = {}) {
  if (close) {
    const c = await until(async () => { const c = await f.actuator('/actuator'); return c.command === 'STOP_CLOSE' && c; });
    assert.equal(c.tabId, 80); await f.actuator('/actuator/ack', { id: c.id, type: 'CLOSED' });
  }
  let c = await until(async () => { const c = await f.actuator('/actuator'); return c.command === 'CREATE' && c; });
  await f.actuator('/actuator/ack', { id: c.id, type: 'CREATED', tabId: 81 });
  if (restart) { await f.stopSupervisor(); await f.restartGateway(); f.startSupervisor(); }
  c = await until(async () => { const c = await f.actuator('/actuator'); return c.command === 'SEND' && c; });
  const credential = c.prompt.match(/ef-worker:\d+:[a-f0-9]{64}/)[0];
  await f.actuator('/actuator/ack', { id: c.id, type: 'SENT', tabId: 81 });
  const pending = await f.call('/v1/product/production/user-controls?requestId=' + requestId);
  assert.equal(pending.receipt.status, 'PENDING'); assert.equal(pending.receipt.step, 'VERIFYING');
  const result = await f.call('/v1/product/gpt/assignments/' + encodeURIComponent(pending.receipt.assignmentId) + '/claim', { claimedBy: credential }); assert.equal(result.status, 200, JSON.stringify(result));
  const completed = await until(async () => { const r = await f.call('/v1/product/production/user-controls?requestId=' + requestId); return r.receipt.status === 'COMPLETED' && r.receipt; });
  assert.equal(completed.tabId, 81); assert.ok(completed.completedAt); return completed;
}

test('an ordinary chat can request restart of a paused CANCEL_REQUESTED assignment; fresh IDs, same inputs, verified receipt survive both process restarts', { timeout: 40000 }, async t => {
  const f = await fixture(t, { cancelled: true, paused: true });
  const body = { action: 'RESTART_PRACTICE', requestId: 'restart-test', userRequested: true, expectedAssignmentId: f.old.assignmentId };
  const first = await f.call('/v1/product/practice/resume-or-start', body); assert.equal(first.status, 200); assert.equal(first.receipt.status, 'PENDING');
  assert.equal((await f.call('/v1/product/practice/resume-or-start', body)).receipt.plannedSessionId, first.receipt.plannedSessionId);
  f.startSupervisor(); const completed = await deliver(f, body.requestId, { restart: true });
  assert.notEqual(completed.assignmentId, f.old.assignmentId); assert.notEqual(completed.sessionId, f.old.sessionId);
  assert.equal((await f.store.getAssignment(f.old.assignmentId)).status, 'CANCELLED');
  const fresh = await f.store.getAssignment(completed.assignmentId);
  assert.deepEqual(fresh.start, f.old.start.map((m, i) => ({ ...fresh.start[i], uri: m.uri }))); assert.equal(fresh.finish.uri, f.input.finishPath); assert.equal(fresh.editTypeId, f.input.editTypeId);
  assert.equal((await f.store.listAssignments()).length, 2);
  assert.equal((await f.call('/v1/product/practice/resume-or-start', body)).receipt.status, 'COMPLETED');
  assert.equal((await f.store.listAssignments()).length, 2);
});

test('explicit chat replacement preserves assignment and checkpoints; delivery alone is not completion', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  const request = await f.call('/v1/product/practice/resume-or-start', { action: 'REPLACE_CHAT', requestId: 'replace-test', userRequested: true, expectedAssignmentId: f.old.assignmentId });
  assert.equal(request.status, 200); f.startSupervisor(); const completed = await deliver(f, 'replace-test');
  assert.equal(completed.assignmentId, f.old.assignmentId); assert.equal(completed.sessionId, f.old.sessionId);
  assert.deepEqual((await f.store.getAssignment(f.old.assignmentId)).preflight, f.old.preflight); assert.equal((await f.store.listAssignments()).length, 1);
});

test('start with chosen inputs is idempotent, rejects unsolicited commands, and never issues a credential publicly', { timeout: 25000 }, async t => {
  const f = await fixture(t, { existing: false });
  const body = { action: 'START_PRACTICE', requestId: 'start-test', input: f.input };
  assert.equal((await f.call('/v1/product/practice/resume-or-start', body)).status, 400);
  body.userRequested = true;
  assert.equal((await f.call('/v1/product/production/user-controls', body)).status, 200);
  assert.equal((await f.call('/v1/product/production/user-controls', { ...body, input: { ...f.input, editTypeId: 'different' } })).status, 409);
  f.startSupervisor(); const completed = await deliver(f, 'start-test', { close: false });
  const publicReceipt = await f.call('/v1/product/practice/resume-or-start', { action: 'STATUS', requestId: 'start-test' });
  assert.equal(publicReceipt.receipt.assignmentId, completed.assignmentId); assert.ok(!JSON.stringify(publicReceipt).includes('ef-worker:'));
  assert.equal((await f.store.listAssignments()).length, 1);
});

test('user cancellation completes while paused without authorizing a replacement worker', { timeout: 20000 }, async t => {
  const f = await fixture(t, { cancelled: true, paused: true }); f.startSupervisor();
  const c = await until(async () => { const c = await f.actuator('/actuator'); return c.command === 'STOP_CLOSE' && c; });
  await f.actuator('/actuator/ack', { id: c.id, type: 'CLOSED' });
  await until(async () => (await f.store.getAssignment(f.old.assignmentId)).status === 'CANCELLED');
  assert.equal((await f.actuator('/actuator')).command, 'NONE');
  assert.equal((await f.admin()).authority.generation, 0); assert.equal((await f.store.listAssignments()).length, 1);
});

test('missing connections produce a durable BLOCKED receipt; explicit retry resumes the same intent and creates only one assignment', { timeout: 25000 }, async t => {
  const f = await fixture(t, { existing: false });
  const panel = f.broker.panelSession; f.broker.panelSession = null;
  const body = { action: 'START_PRACTICE', requestId: 'blocked-start', input: f.input, userRequested: true };
  const accepted = await f.call('/v1/product/practice/resume-or-start', body); assert.equal(accepted.status, 200);
  f.startSupervisor();
  const blocked = await until(async () => { const r = await f.call('/v1/product/production/user-controls?requestId=blocked-start'); return r.receipt.status === 'BLOCKED' && r.receipt; });
  assert.match(blocked.error, /CONNECTION_PREFLIGHT_BLOCKED/); assert.equal((await f.store.listAssignments()).length, 0);
  await f.stopSupervisor(); await f.restartGateway(); f.startSupervisor();
  assert.equal((await f.call('/v1/product/production/user-controls?requestId=blocked-start')).receipt.status, 'BLOCKED');
  f.broker.panelSession = panel;
  const retried = await f.call('/v1/product/practice/resume-or-start', { action: 'RETRY', requestId: 'blocked-start', userRequested: true });
  assert.equal(retried.receipt.plannedSessionId, accepted.receipt.plannedSessionId);
  await deliver(f, 'blocked-start', { close: false }); assert.equal((await f.store.listAssignments()).length, 1);
});
