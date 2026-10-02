"use strict";
const fs = require('fs');
const path = require('path');
const http = require('http');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const { POLICY, evaluateLiveness } = require('./liveness.js');
const ROOT = process.env.EDITFLOW_SUPERVISOR_ROOT || __dirname;
fs.mkdirSync(ROOT, { recursive: true });
const LOCAL = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
const statePath = path.join(ROOT, 'production-state.json');
const logPath = path.join(ROOT, 'production-events.jsonl');
let state = { phase: 'IDLE', liveness: {}, activeTabId: null, handoff: null, lastRepairAt: 0, lastExtensionLoadedAt: 0 };
try { state = { ...state, ...JSON.parse(fs.readFileSync(statePath, 'utf8')) }; }
catch (e) { if (e.code !== 'ENOENT') throw e; }
// Migration targets only the old explicitly owned production tab, never a maintenance chat.
if (!fs.existsSync(statePath)) { try { const old = JSON.parse(fs.readFileSync(path.join(ROOT, 'state.json'), 'utf8')); state.activeTabId = old.lastTabId; } catch (_) {} }
const bootAt = Date.now();
let snapshot = null, tickBusy = false, lastGatewayAt = 0, gatewayError = null;
function persist() { fs.mkdirSync(ROOT, { recursive: true }); fs.writeFileSync(statePath + '.tmp', JSON.stringify(state, null, 2), { flush: true }); fs.renameSync(statePath + '.tmp', statePath); }
function log(type, detail = {}) { fs.appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), type, ...detail }) + '\n'); }
function connection() {
  const manifest = JSON.parse(fs.readFileSync(path.join(LOCAL, 'EditFlow2', 'current-runtime.json'), 'utf8'));
  const configPath = path.join(process.env.APPDATA, 'Adobe', 'CEP', 'extensions', 'com.editflow2.bridge', 'client', 'runtime-config.js');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8').match(/Object\.freeze\((\{.*\})\);?\s*$/s)[1]);
  const key = fs.readFileSync(path.join(manifest.stateDir, 'production-supervision', 'supervisor.key'), 'utf8').trim();
  return { url: manifest.productBaseUrl + '/v1/product/production/supervision', token: config.token, key };
}
async function gateway(body) {
  const c = connection();
  const response = await fetch(c.url, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(10000),
    headers: { 'content-type': 'application/json', 'x-editflow-token': c.token, 'x-editflow-supervisor-key': c.key },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json(); if (!response.ok) throw Error(result.error || 'GATEWAY_' + response.status);
  return result;
}
function prompt(task, credential) {
  const mode = task.mode === 'PRACTICE' ? 'Practice' : 'Pro Creation';
  return `Continue the ${mode} session with the given raw files to make the finished product. Resume existing assignment ${task.assignmentId} and session ${task.sessionId} from its latest durable checkpoint; do not create or restart the assignment. Run the full connection preflight, reconcile in-flight AE work and retained production-job receipts, then continue the original M6 reference-first workflow. Keep After Effects open. Use only provided raw footage and raw audio. ${mode === 'Practice' ? 'Finished is visual reference only.' : 'Use the designed target and actual render review.'} Your exclusive worker credential is ${credential}. Use this exact value as claimedBy for claims, production updates, researchContext.claimedBy, and all assignment writes. If a connector cannot supply it, use the authenticated production HTTP API with X-EditFlow-Worker-Credential. Submit every AE action through production-jobs. Consult Tutorial Drive first, Adobe resources second, other sources last. A STALE_WORKER response means stop immediately; never reclaim, read supervisor keys, change supervision, or bypass the gateway. Do not launch parallel chats or controllers. Read the current assignment, clip research plans, production status and actual AE state, and continue only unfinished work.`;
}
async function beginHandoff(reason) {
  if (state.handoff) return;
  const a = snapshot.authority, task = snapshot.assignment;
  const handoff = { id: randomUUID(), assignmentId: task.assignmentId, sessionId: task.sessionId,
    mode: task.mode, sourceTabId: state.activeTabId, targetTabId: null, status: 'REVOKE', reason, createdAt: Date.now() };
  state.handoff = handoff; state.phase = 'HANDOFF'; persist();
  await progressHandoff();
}
async function progressHandoff() {
  const h = state.handoff; if (!h || !snapshot) return;
  if (h.assignmentId !== snapshot.assignment?.assignmentId) { state.handoff = null; persist(); return; }
  if (h.status === 'REVOKE') {
    if (snapshot.authority.state === 'ARMED') await gateway({ action: 'REVOKE', assignmentId: h.assignmentId,
      generation: snapshot.authority.generation, reason: h.reason });
    h.status = Number.isInteger(h.sourceTabId) ? 'CLOSE' : 'DRAIN'; persist(); log('worker_revoked', { assignmentId: h.assignmentId, reason: h.reason });
  }
  if (h.status === 'DRAIN') {
    if (snapshot.writerOwner || snapshot.jobs.some(j => j.status === 'RUNNING')) return;
    const issued = await gateway({ action: 'ISSUE', assignmentId: h.assignmentId, launchId: h.id });
    h.prompt = prompt(snapshot.assignment, issued.credential); h.generation = issued.authority.generation;
    h.status = 'CREATE'; persist();
  }
}
function repair(reason) {
  if (Date.now() - state.lastRepairAt < 120000) return;
  state.lastRepairAt = Date.now(); persist(); log('infrastructure_repair_required', { reason });
  // A disconnected actuator can be restored without touching AE or production state.
  {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, reason === 'actuator_offline' ? 'recover-extension.ps1' : 'repair-production.ps1'), '-Reason', reason], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', e => log('actuator_repair_failed', { error: e.message })); child.unref();
  }
}
async function tick() {
  if (tickBusy) return; tickBusy = true;
  try {
    snapshot = await gateway(); lastGatewayAt = Date.now(); gatewayError = null;
    const verdict = evaluateLiveness(state.liveness, snapshot, Date.now());
    state.liveness = verdict.next; state.phase = verdict.phase; state.reason = verdict.reason;
    if (verdict.phase === 'IDLE') { state.handoff = null; }
    else if (verdict.action === 'CANCEL') {
      if (snapshot.authority.state === 'ARMED') await gateway({ action: 'REVOKE', assignmentId: snapshot.assignment.assignmentId,
        generation: snapshot.authority.generation, reason: 'user_cancel' });
      // Assignment cancellation owns job abortion. Never start another chat.
      if (Number.isInteger(state.activeTabId) && !state.handoff) state.handoff = { id: randomUUID(), status: 'CLOSE_ONLY', sourceTabId: state.activeTabId };
    } else if (verdict.action === 'REPAIR') {
      if (snapshot.authority.state === 'ARMED') await gateway({ action: 'REVOKE', assignmentId: snapshot.assignment.assignmentId,
        generation: snapshot.authority.generation, reason: verdict.reason });
      await gateway({ action: 'INTERRUPT', assignmentId: snapshot.assignment.assignmentId, reason: verdict.reason });
      repair(verdict.reason);
    } else if (verdict.action === 'RECOVER_FAILED') {
      await gateway({ action: 'RECOVER_FAILED', assignmentId: snapshot.assignment.assignmentId });
      await beginHandoff(verdict.reason);
    } else if (state.handoff) await progressHandoff();
    else if (verdict.action === 'HANDOFF') await beginHandoff(verdict.reason);
    if (snapshot.assignment && Date.now() - (Math.max(bootAt, state.lastActuatorAt || 0, state.lastExtensionLoadedAt || 0)) > 60000) repair('actuator_offline');
    persist();
  } catch (e) { gatewayError = e.message; state.phase = 'INFRA_RECOVERY'; state.reason = 'gateway_unavailable'; persist(); repair('gateway_unavailable'); }
  finally { tickBusy = false; }
}
function actuatorCommand() {
  const h = state.handoff;
  if (!snapshot || Date.now() - lastGatewayAt > 15000) return { command: 'NONE', reason: 'gateway_unavailable' };
  if (!h || snapshot.authority.state === 'PAUSED') return { command: 'NONE',
    recoverLaunchId: !state.activeTabId && !h ? snapshot.authority.launchId : null };
  if (['CLOSE', 'CLOSE_ONLY'].includes(h.status)) return { command: 'STOP_CLOSE', id: h.id, tabId: h.sourceTabId };
  if (h.status === 'CREATE') return { command: 'CREATE', id: h.id };
  if (h.status === 'SEND') return { command: 'SEND', id: h.id, tabId: h.targetTabId, prompt: h.prompt };
  return { command: 'NONE' };
}
async function body(req) { let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 200000) throw Error('BODY_TOO_LARGE'); } return raw ? JSON.parse(raw) : {}; }
const extensionOrigin = 'chrome-extension://ljjjjjoghmheifakiiahgoonhhmoebog';
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const actuatorAllowed = origin === extensionOrigin || (!origin && req.headers['x-editflow-actuator-id'] === 'ljjjjjoghmheifakiiahgoonhhmoebog');
  res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store');
  if (origin === extensionOrigin) { res.setHeader('access-control-allow-origin', origin); res.setHeader('access-control-allow-headers', 'content-type,x-editflow-actuator-id'); }
  const send = (status, value) => { res.writeHead(status); res.end(JSON.stringify(value)); };
  try {
    if (req.method === 'OPTIONS' && origin === extensionOrigin) return send(200, {});
    if (req.url === '/health') return send(200, { ok: true, service: 'EditFlow Production Supervisor', version: '3.0.1', pid: process.pid,
      phase: state.phase, reason: state.reason, policy: POLICY, progressSeq: state.liveness.progressSeq || 0,
      authority: snapshot?.authority || null, assignment: snapshot?.assignment || null, gatewayError,
      lastExtensionLoadedAt: state.lastExtensionLoadedAt, extensionVersion: state.extensionVersion,
      activeTabId: state.activeTabId, handoff: state.handoff ? { id: state.handoff.id, status: state.handoff.status } : null });
    if (req.url.startsWith('/actuator') && !actuatorAllowed) return send(403, { error: 'ACTUATOR_ORIGIN_REQUIRED' });
    if (req.method === 'GET' && req.url === '/actuator') {
      state.lastActuatorAt = Date.now(); return send(200, actuatorCommand());
    }
    if (req.method === 'POST' && req.url === '/actuator/ack') {
      const b = await body(req); const h = state.handoff;
      if (b.type === 'READY') { state.lastExtensionLoadedAt = Date.now(); state.extensionVersion = b.version; persist(); return send(200, { ok: true }); }
      if (b.type === 'OWNER_TARGET' && !state.handoff && !state.activeTabId &&
        b.launchId === snapshot?.authority.launchId && Number.isInteger(b.tabId)) {
        state.activeTabId = b.tabId; persist(); return send(200, { ok: true });
      }
      if (!h || b.id !== h.id) return send(409, { error: 'STALE_ACTUATOR_ACK' });
      if (b.type === 'MISSING' && h.status === 'SEND') { h.status = 'CREATE'; h.targetTabId = null; }
      else if (b.type === 'CLOSED' && h.status === 'CLOSE_ONLY') { state.activeTabId = null; state.handoff = null; }
      else if (b.type === 'CLOSED' && h.status === 'CLOSE') { h.status = 'DRAIN'; state.activeTabId = null; }
      else if (b.type === 'CREATED' && h.status === 'CREATE' && Number.isInteger(b.tabId)) { h.status = 'SEND'; h.targetTabId = b.tabId; state.activeTabId = b.tabId; }
      else if (b.type === 'SENT' && h.status === 'SEND' && b.tabId === h.targetTabId) {
        state.activeTabId = b.tabId; state.handoff = null; state.liveness = {}; log('continuation_sent', { assignmentId: h.assignmentId, generation: h.generation, tabId: b.tabId });
      } else if (b.type === 'FAILED') { log('actuator_failed_retry_same_step', { id: h.id, error: b.error }); }
      else return send(409, { error: 'ACTUATOR_STEP_MISMATCH' });
      persist(); return send(200, { ok: true });
    }
    // Pause is an explicit production control; the service itself remains running.
    if (req.method === 'POST' && ['/pause', '/resume'].includes(req.url)) {
      if (origin && origin !== extensionOrigin) return send(403, { error: 'LOCAL_CONTROL_REQUIRED' });
      if (!snapshot?.assignment) return send(409, { error: 'NO_ASSIGNMENT' });
      const a = snapshot.authority;
      await gateway({ action: req.url === '/pause' ? 'PAUSE' : 'RESUME', assignmentId: a.assignmentId, generation: a.generation, reason: 'explicit_user_pause' });
      if (state.handoff?.targetTabId) state.activeTabId = state.handoff.targetTabId;
      state.handoff = null; persist(); return send(200, { ok: true });
    }
    return send(404, { error: 'NOT_FOUND' });
  } catch (e) { send(500, { error: e.message }); }
});
server.listen(Number(process.env.EDITFLOW_SUPERVISOR_PORT || 32147), '127.0.0.1', () => { log('supervisor_started', { pid: process.pid }); void tick(); });
setInterval(() => { void tick(); }, 2000).unref();
process.on('unhandledRejection', e => log('unhandled_rejection', { error: String(e) }));
