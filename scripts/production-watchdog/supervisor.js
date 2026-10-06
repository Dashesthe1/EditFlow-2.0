"use strict";
const fs = require('fs');
const path = require('path');
const http = require('http');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const { POLICY, evaluateLiveness, operationFailure, decisionLeaseStatus, noProgressLimit } = require('./liveness.js');
const { prompt } = require('./worker-prompt.js');
const { createTransportMonitor, probeMcp } = require('./transport-health.js');
const OWNERSHIP_CONFLICT_ERROR = 'The replacement tab contains a continuation for another worker generation. No chat was stopped. Request Replace editing chat to deliver a fresh current-worker continuation while retaining the assignment.';
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
let chatExecution = null;
let snapshot = null, tickBusy = false, lastGatewayAt = 0, gatewayError = null;
const testTransportUrl = path.resolve(ROOT) !== path.resolve(__dirname) ? process.env.EDITFLOW_SUPERVISOR_TEST_TRANSPORT_URL : null;
if (testTransportUrl && new URL(testTransportUrl).hostname !== '127.0.0.1') throw Error('TEST_TRANSPORT_MUST_BE_LOOPBACK');
const transport = createTransportMonitor({ localRoot: LOCAL, ...(testTransportUrl ? {
  localUrl: testTransportUrl, intervalMs: 100,
  publicProbe: probeMcp,
  resolve: async () => ({ configured: true, public: testTransportUrl }),
} : {}) });
let transportRepairAt = 0;
function checkTransport() { void transport.check().catch(() => log('transport_probe_failed', { reason: 'PROBE_FAILED' })); }
function recoverTransport() {
  if (testTransportUrl || transport.state().failures < 2 || Date.now() - transportRepairAt < 30000) return;
  transportRepairAt = Date.now();
  log('transport_recovery_required', { status: transport.state().status });
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(ROOT, 'repair-transport.ps1'), '-Reason', 'mcp_transport_unavailable',
    ...(snapshot?.assignment ? ['-AssignmentId', snapshot.assignment.assignmentId] : [])],
    { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => log('transport_recovery_failed', { reason: 'RECOVERY_PROCESS_FAILED' }));
  child.on('exit', () => { void transport.check(true).then(() => tick()).catch(() => {}); });
  child.unref();
}
function persist() { fs.mkdirSync(ROOT, { recursive: true }); fs.writeFileSync(statePath + '.tmp', JSON.stringify(state, null, 2), { flush: true }); fs.renameSync(statePath + '.tmp', statePath); }
function log(type, detail = {}) { fs.appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), type, ...detail }) + '\n'); }
function connection() {
  const manifest = JSON.parse(fs.readFileSync(path.join(LOCAL, 'EditFlow2', 'current-runtime.json'), 'utf8'));
  const configPath = path.join(process.env.APPDATA, 'Adobe', 'CEP', 'extensions', 'com.editflow2.bridge', 'client', 'runtime-config.js');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8').match(/Object\.freeze\((\{.*\})\);?\s*$/s)[1]);
  const key = fs.readFileSync(path.join(manifest.stateDir, 'production-supervision', 'supervisor.key'), 'utf8').trim();
  return { url: manifest.productBaseUrl + '/v1/product/production/supervision', token: config.token, key };
}
async function gateway(body, route) {
  const c = connection();
  const response = await fetch(route ? c.url.replace('/production/supervision', route) : c.url, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(10000),
    headers: { 'content-type': 'application/json', 'x-editflow-token': c.token, 'x-editflow-supervisor-key': c.key },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json(); if (!response.ok) throw Error(result.error || 'GATEWAY_' + response.status);
  return result;
}
function livenessDiagnostics(now = Date.now()) {
  const a = snapshot?.authority || {}, p = snapshot?.production || {};
  const lease = snapshot ? decisionLeaseStatus(snapshot, now) : { active: false, operation: null, ageMs: null };
  return {
    stage: p.stage || null,
    currentPhaseId: p.currentPhaseId || null,
    authorityState: a.state || null,
    generation: a.generation ?? null,
    activityAgeMs: a.lastActivityAt ? Math.max(0, now - a.lastActivityAt) : null,
    semanticProgressAgeMs: state.liveness.progressAt ? Math.max(0, now - state.liveness.progressAt) : null,
    semanticNoProgressLimitMs: snapshot ? noProgressLimit(snapshot) : null,
    decisionLeaseActive: lease.active,
    decisionOperation: lease.operation,
    decisionLeaseAgeMs: lease.ageMs,
    chatState: chatExecution?.state || 'UNKNOWN',
    repeatedActionWarning: !!state.liveness.repeatedActionWarning,
    stageBudgetWarning: !!state.liveness.stageBudgetWarning,
  };
}
async function beginHandoff(reason) {
  if (state.handoff) return;
  log('handoff_begin', { reason, ...livenessDiagnostics() });
  const a = snapshot.authority, task = snapshot.assignment;
  const handoff = { id: randomUUID(), assignmentId: task.assignmentId, sessionId: task.sessionId,
    mode: task.mode, sourceTabId: state.activeTabId, targetTabId: null, status: 'REVOKE', reason, createdAt: Date.now() };
  state.handoff = handoff; state.phase = 'HANDOFF'; persist();
  await progressHandoff();
}
async function progressHandoff() {
  const h = state.handoff; if (!h || !snapshot) return;
  if (!h.userControlId && h.assignmentId !== snapshot.assignment?.assignmentId) { state.handoff = null; persist(); return; }
  if (h.status === 'REVOKE') {
    if (snapshot.authority.state === 'ARMED') await gateway({ action: 'REVOKE', assignmentId: h.assignmentId,
      generation: snapshot.authority.generation, reason: h.reason });
    h.status = Number.isInteger(h.sourceTabId) ? 'CLOSE' : 'DRAIN'; persist(); log('worker_revoked', { assignmentId: h.assignmentId, reason: h.reason });
  }
  if (h.status === 'DRAIN') {
    if (!transport.state().ready) { checkTransport(); recoverTransport(); state.phase = 'CONNECTOR_RECOVERY'; state.reason = 'mcp_transport_unavailable'; persist(); return; }
    if (snapshot.writerOwner || snapshot.jobs.some(j => j.status === 'RUNNING') || snapshot.preflightRunning && h.userControlId) return;
    if (h.userControlId) {
      const prepared = await gateway({ action: 'CONTROL_PREPARE', requestId: h.userControlId });
      if (prepared.receipt.status === 'COMPLETED') { state.handoff = null; persist(); return; }
      if (prepared.receipt.status !== 'PENDING' || prepared.receipt.step !== 'LAUNCHING') return;
      h.assignmentId = prepared.receipt.assignmentId; h.sessionId = prepared.receipt.sessionId;
      snapshot = await gateway(); lastGatewayAt = Date.now();
    }
    const issued = await gateway({ action: 'ISSUE', assignmentId: h.assignmentId, launchId: h.id });
    h.prompt = prompt(snapshot.assignment, issued.credential); h.generation = issued.authority.generation;
    h.status = 'CREATE'; persist();
  }
}
async function processUserControl(request) {
  state.phase = request.status === 'BLOCKED' ? 'BLOCKED' : 'USER_CONTROL';
  state.reason = request.error || request.action + ':' + request.step;
  if (request.status === 'BLOCKED') return;
  if (!state.handoff || state.handoff.userControlId !== request.requestId) {
    // An outstanding CREATE must acknowledge its owned tab before it can be retired.
    if (state.handoff?.status === 'CREATE') return;
    if (state.handoff?.targetTabId) state.activeTabId = state.handoff.targetTabId;
    const begun = await gateway({ action: 'CONTROL_BEGIN', requestId: request.requestId });
    if (begun.receipt.status !== 'PENDING') return;
    state.handoff = { id: request.requestId, userControlId: request.requestId,
      assignmentId: request.expectedAssignmentId, sourceTabId: state.activeTabId, targetTabId: null,
      status: Number.isInteger(state.activeTabId) ? 'CLOSE' : 'DRAIN', reason: 'explicit_user_' + request.action.toLowerCase(), createdAt: Date.now() };
    persist();
  }
  await progressHandoff();
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
    snapshot = { ...snapshot, activeTabId: state.activeTabId, chatExecution };
    checkTransport();
    if ((snapshot.assignment || snapshot.userControl) && Date.now() - (Math.max(bootAt, state.lastActuatorAt || 0, state.lastExtensionLoadedAt || 0)) > 60000) repair('actuator_offline');
    if (snapshot.userControl && snapshot.userControl.step !== 'VERIFYING') {
      const failure = operationFailure(snapshot, Date.now());
      if (failure && snapshot.assignment) {
        if (snapshot.authority.state === 'ARMED') await gateway({ action: 'REVOKE', assignmentId: snapshot.assignment.assignmentId, generation: snapshot.authority.generation, reason: failure });
        await gateway({ action: 'INTERRUPT', assignmentId: snapshot.assignment.assignmentId, reason: failure });
        state.phase = 'INFRA_RECOVERY'; state.reason = failure; repair(failure); persist(); return;
      }
      await processUserControl(snapshot.userControl); persist(); return;
    }
    const ownedObservation = chatExecution && chatExecution.tabId === state.activeTabId
      && chatExecution.generation === snapshot.authority.generation
      && chatExecution.assignmentId === snapshot.assignment?.assignmentId
      && Date.now() - chatExecution.checkedAt <= POLICY.chatStatusFreshMs;
    const failedControl = snapshot.latestUserControl;
    const retainedOwnershipFailure = failedControl?.action === 'REPLACE_CHAT' && failedControl.status === 'FAILED'
      && failedControl.step === 'VERIFYING' && failedControl.error === OWNERSHIP_CONFLICT_ERROR
      && failedControl.requestId === snapshot.authority.launchId
      && failedControl.generation === snapshot.authority.generation && failedControl.tabId === state.activeTabId
      && failedControl.assignmentId === snapshot.assignment?.assignmentId && failedControl.sessionId === snapshot.assignment?.sessionId;
    const currentlyOwned = ownedObservation && (chatExecution.state === 'PROCESSING'
      && chatExecution.observation?.reason === 'OWNED_PROCESSING' || chatExecution.state === 'FINISHED'
      && chatExecution.observation?.reason === 'OWNED_FINISHED');
    if (ownedObservation && chatExecution.observation?.reason === 'NEWER_FOREIGN_CONTINUATION'
      || retainedOwnershipFailure && !currentlyOwned) {
      // Keep the verified conflict visible after the terminal receipt clears the pending control.
      // Never stop a chat from an ownership mismatch.
      if (snapshot.userControl?.step === 'VERIFYING' && snapshot.userControl.generation === snapshot.authority.generation
        && snapshot.userControl.tabId === state.activeTabId) await gateway({ action: 'CONTROL_FAILED',
        requestId: snapshot.userControl.requestId, error: OWNERSHIP_CONFLICT_ERROR });
      state.phase = 'BLOCKED'; state.reason = 'owned_chat_worker_mismatch'; persist(); return;
    }
    const verdict = evaluateLiveness(state.liveness, snapshot, Date.now());
    state.liveness = verdict.next; state.phase = verdict.phase; state.reason = verdict.reason;
    if (verdict.phase === 'IDLE') { state.handoff = null; }
    else if (verdict.action === 'CANCEL') {
      if (snapshot.authority.state === 'ARMED') await gateway({ action: 'REVOKE', assignmentId: snapshot.assignment.assignmentId,
        generation: snapshot.authority.generation, reason: 'user_cancel' });
      // Assignment cancellation owns job abortion. Never start another chat.
      if (state.handoff?.targetTabId) state.activeTabId = state.handoff.targetTabId;
      if (Number.isInteger(state.activeTabId) && state.handoff?.status !== 'CLOSE_ONLY') {
        state.handoff = { id: randomUUID(), status: 'CLOSE_ONLY', sourceTabId: state.activeTabId };
      }
      if (!Number.isInteger(state.activeTabId) && state.handoff?.status !== 'CLOSE_ONLY') state.handoff = null;
      if (!Number.isInteger(state.activeTabId) && !state.handoff && !snapshot.writerOwner
        && !snapshot.preflightRunning && !snapshot.jobs.some(j => j.status === 'RUNNING')) {
        await gateway({ action: 'FINALIZE_CANCEL', assignmentId: snapshot.assignment.assignmentId });
        log('cancellation_completed', { assignmentId: snapshot.assignment.assignmentId });
      }
    } else if (verdict.action === 'REPAIR') {
      if (snapshot.authority.state === 'ARMED') await gateway({ action: 'REVOKE', assignmentId: snapshot.assignment.assignmentId,
        generation: snapshot.authority.generation, reason: verdict.reason });
      await gateway({ action: 'INTERRUPT', assignmentId: snapshot.assignment.assignmentId, reason: verdict.reason });
      repair(verdict.reason);
    } else if (verdict.action === 'RECOVER_FAILED') {
      await gateway({ action: 'RECOVER_FAILED', assignmentId: snapshot.assignment.assignmentId });
      await beginHandoff(verdict.reason);
    } else if (state.handoff) await progressHandoff();
    else if (verdict.action === 'HANDOFF') {
      if (!transport.state().ready) { state.phase = 'CONNECTOR_RECOVERY'; state.reason = 'mcp_transport_unavailable'; recoverTransport(); persist(); return; }
      if (snapshot.userControl?.step === 'VERIFYING') await gateway({ action: 'CONTROL_FAILED', requestId: snapshot.userControl.requestId, error: 'Prompt delivered, but the authorized worker did not claim the assignment before operational silence was confirmed.' });
      await beginHandoff(verdict.reason);
    }
    if (snapshot.assignment && !transport.state().ready && snapshot.authority.state !== 'PAUSED'
      && !['CANCEL', 'REPAIR', 'RECOVER_FAILED'].includes(verdict.action)) {
      state.phase = 'CONNECTOR_RECOVERY'; state.reason = 'mcp_transport_unavailable'; recoverTransport();
    }
    persist();
  } catch (e) { gatewayError = e.message; state.phase = 'INFRA_RECOVERY'; state.reason = 'gateway_unavailable'; persist(); repair('gateway_unavailable'); }
  finally { tickBusy = false; }
}
function actuatorCommand() {
  const h = state.handoff;
  const deliveryMatches = receipt => receipt && receipt.launchId === snapshot?.authority.launchId
    && receipt.tabId === state.activeTabId && receipt.generation === snapshot?.authority.generation
    && receipt.assignmentId === snapshot?.assignment?.assignmentId && receipt.sessionId === snapshot?.assignment?.sessionId;
  const control = snapshot?.userControl;
  const deliveryConfirmed = !!(deliveryMatches(state.workerTabReceipt) || control?.deliveredAt
    && control.step === 'VERIFYING' && deliveryMatches({ ...control, launchId: control.requestId }));
  if (!snapshot || Date.now() - lastGatewayAt > 15000) return { command: 'NONE', reason: 'gateway_unavailable' };
  if (!h || snapshot.authority.state === 'PAUSED' && !['CLOSE', 'CLOSE_ONLY'].includes(h.status)) return { command: 'NONE',
    recoverLaunchId: !state.activeTabId && !h ? snapshot.authority.launchId : null,
    observe: !h && Number.isInteger(state.activeTabId) && snapshot.authority.state === 'ARMED' ? {
      tabId: state.activeTabId, assignmentId: snapshot.assignment?.assignmentId,
      sessionId: snapshot.assignment?.sessionId, generation: snapshot.authority.generation,
      deliveryConfirmed,
    } : null };
  if (['CLOSE', 'CLOSE_ONLY'].includes(h.status)) return { command: 'STOP_CLOSE', id: h.id, tabId: h.sourceTabId };
  if (['CREATE', 'SEND'].includes(h.status) && !transport.state().ready) return { command: 'NONE', reason: 'mcp_transport_unavailable' };
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
    if (req.url === '/health') return send(200, { ok: true, service: 'EditFlow Production Supervisor', version: '3.3.0', pid: process.pid,
      phase: state.phase, reason: state.reason, policy: POLICY, progressSeq: state.liveness.progressSeq || 0,
      decisionLease: snapshot ? decisionLeaseStatus(snapshot, Date.now()) : null, livenessDiagnostics: livenessDiagnostics(),
      authority: snapshot?.authority || null, assignment: snapshot?.assignment || null, gatewayError, transport: transport.state(), chatExecution,
      lastExtensionLoadedAt: state.lastExtensionLoadedAt, extensionVersion: state.extensionVersion,
      userControl: snapshot?.userControl || null, latestUserControl: snapshot?.latestUserControl || null,
      activeTabId: state.activeTabId, handoff: state.handoff ? { id: state.handoff.id, status: state.handoff.status } : null });
    if (req.url.split('?')[0] === '/user-controls') {
      if (!actuatorAllowed) return send(403, { error: 'ACTUATOR_ORIGIN_REQUIRED' });
      if (req.method === 'GET') return send(200, await gateway(null, '/production/user-controls' + (req.url.includes('?') ? '?' + req.url.split('?')[1] : '')));
      if (req.method === 'POST') return send(200, await gateway(await body(req), '/production/user-controls'));
    }
    if (req.url.startsWith('/actuator') && !actuatorAllowed) return send(403, { error: 'ACTUATOR_ORIGIN_REQUIRED' });
    if (req.method === 'GET' && req.url === '/actuator') {
      state.lastActuatorAt = Date.now(); return send(200, actuatorCommand());
    }
    if (req.method === 'POST' && req.url === '/actuator/ack') {
      const b = await body(req); const h = state.handoff;
      if (b.type === 'WORKER_STATUS') {
        if (h || b.tabId !== state.activeTabId || b.generation !== snapshot?.authority.generation
          || b.assignmentId !== snapshot?.assignment?.assignmentId) return send(409, { error: 'STALE_WORKER_OBSERVATION' });
        if (!['PROCESSING','FINISHED','MISSING','UNKNOWN'].includes(b.state)) return send(400, { error: 'INVALID_WORKER_OBSERVATION' });
        const observation = {};
        const reasons = ['INVALID_TARGET','OWNER_PROMPT_NOT_FOUND','NEWER_FOREIGN_CONTINUATION','NO_CURRENT_ASSISTANT',
          'NO_FINAL_CONTROLS','OWNED_PROCESSING','OWNED_FINISHED','PAGE_NOT_READY','TARGET_MISSING','OBSERVER_UNAVAILABLE'];
        if (reasons.includes(b.observation?.reason)) observation.reason = b.observation.reason;
        for (const name of ['hasAssignment','hasSession','hasGeneration']) if (typeof b.observation?.[name] === 'boolean') observation[name] = b.observation[name];
        if (Number.isInteger(b.observation?.userNodes) && b.observation.userNodes >= 0 && b.observation.userNodes <= 10000) observation.userNodes = b.observation.userNodes;
        chatExecution = { tabId: b.tabId, generation: b.generation, assignmentId: b.assignmentId,
          state: b.state, checkedAt: Date.now(), observation };
        void tick(); return send(200, { ok: true });
      }
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
        if (h.userControlId) await gateway({ action: 'CONTROL_DELIVERED', requestId: h.userControlId, tabId: b.tabId });
        state.workerTabReceipt = { launchId: h.id, tabId: b.tabId, assignmentId: h.assignmentId,
          sessionId: h.sessionId, generation: h.generation, deliveredAt: Date.now() };
        state.activeTabId = b.tabId; state.handoff = null; state.liveness = {}; log('continuation_sent', { assignmentId: h.assignmentId, generation: h.generation, tabId: b.tabId });
      } else if (b.type === 'FAILED') { log('actuator_failed_retry_same_step', { id: h.id, error: b.error }); }
      else return send(409, { error: 'ACTUATOR_STEP_MISMATCH' });
      persist(); return send(200, { ok: true });
    }
    // Pause is an explicit production control; the service itself remains running.
    if (req.method === 'POST' && ['/pause', '/resume'].includes(req.url)) {
      if (origin && origin !== extensionOrigin) return send(403, { error: 'LOCAL_CONTROL_REQUIRED' });
      if (!snapshot?.assignment) return send(409, { error: 'NO_ASSIGNMENT' });
      if (snapshot.userControl) return send(409, { error: 'USER_CONTROL_ALREADY_PENDING' });
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
