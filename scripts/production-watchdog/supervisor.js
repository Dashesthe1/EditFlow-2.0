"use strict";

const http = require("http");
const fs = require("fs");
const pathMod = require("path");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");
const { POLICY, evaluateLiveness } = require("./liveness.js");
const { validStopProof } = require("./stop-gate.js");

const PORT = 32147;
const HOST = "127.0.0.1";
const ROOT = __dirname;
const ORCHESTRATION =
  "C:\\Users\\Shadow\\AppData\\Local\\EditFlow2\\practice-state\\gpt-orchestration.json";
const STATE_PATH = pathMod.join(ROOT, "state.json");
const LOG_PATH = pathMod.join(ROOT, "events.jsonl");
const RECOVERY_SCRIPT = pathMod.join(ROOT, "recover-extension.ps1");
const EDITFLOW_STATUS_URL = "http://127.0.0.1:32146/status";

const HEARTBEAT_STALE_MS = 60000;
const HANDOFF_DIR = pathMod.join(ROOT, "handoffs");
const RECOVERY_COOLDOWN_MS = 120000;

let runtime = {
  chainArmed: false,
  armedAt: null,
  armedAssignmentId: null,
  armedSessionId: null,
  lastHeartbeatAt: 0,
  lastTabId: null,
  lastUrl: null,
  lastMonitorState: null,
  lastGenerationStartAt: 0,
  lastGenerationEndAt: 0,
  lastGenerationErrorAt: 0,
  lastGenerationOutcome: null,
  lastStreamActivityAt: 0,
  lastStreamBytesTotal: 0,
  lastStreamRequestId: null,
  lastAssistantFingerprint: null,
  lastAssistantTextLength: 0,
  lastUiProgressAt: 0,
  lastThinkingSignal: null,
  lastAeHostRevision: null,
  lastAeProgressAt: 0,
  lastAeLeaseOwner: null,
  lastAeLeaseExpiresAt: 0,
  lastPracticeProgressAt: 0,
  lastPracticeProgressSource: null,
  probeReadyAt: 0,
  lastChainIssuedAt: 0,
  lastChainAckAt: 0,
  lastUiFailureKey: null,
  lastChainedGenerationStartAt: 0,
  lastChainSentAt: 0,
  lastChainFailedAt: 0,
  lastRecoveryAt: 0,
  lastNativeHandoffAt: 0,
  lastNativeHandoffForAt: 0,
  lastPracticeStatus: null,
  lastPracticeAssignmentId: null,
  liveness: {},
  lastSemanticAt: 0,
  semanticCoverage: false,
  semanticCompletedAt: 0,
  generationRequestId: null,
  semanticRequestId: null,
  handoff: null,
  handoffHistory: [],
  lastLiveness: null,
  supervisorStartedAt: Date.now()
};

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    runtime = Object.assign(runtime, saved || {}, {
      supervisorStartedAt: Date.now()
    });
    // A newer live generation supersedes any older pending handoff state.
    // Clear the old handoff bookkeeping instead of pretending that a handoff
    // was just sent; a fake lastChainSentAt delays the next normal-completion
    // continuation via CHAIN_SETTLE_MS.
    if (runtime.lastGenerationOutcome === "running" &&
        Number(runtime.lastGenerationStartAt || 0) > 0 &&
        Number(runtime.lastGenerationStartAt || 0) >=
          Math.max(
            Number(runtime.lastChainAckAt || 0),
            Number(runtime.lastChainSentAt || 0),
            Number(runtime.lastChainFailedAt || 0)
          )) {
      runtime.lastChainIssuedAt = 0;
      runtime.lastChainAckAt = 0;
      runtime.lastChainSentAt = 0;
      runtime.lastChainFailedAt = 0;
      runtime.lastChainedGenerationStartAt = 0;
      runtime.lastNativeHandoffForAt = 0;
    }
  } catch (_) {}
}

function persist() {
  try {
    fs.writeFileSync(STATE_PATH + ".tmp", JSON.stringify(runtime, null, 2));
    fs.renameSync(STATE_PATH + ".tmp", STATE_PATH);
  } catch (_) {}
}

function log(type, detail) {
  const entry = Object.assign({ ts: new Date().toISOString(), type }, detail || {});
  try {
    fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
  } catch (_) {}
}

function assignmentTime(a) {
  return Date.parse(a.startedAt || a.claimedAt || a.createdAt || 0) || 0;
}

const artifactScanCache = new Map();
function newestArtifactMtime(root) {
  if (!root) return 0;
  const now = Date.now();
  const cached = artifactScanCache.get(root);
  if (cached && now - cached.scannedAt < 4000) return cached.mtimeMs;
  let newest = 0;
  let remaining = 2500;
  const walk = (dir, depth) => {
    if (remaining <= 0 || depth > 2) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { return; }
    for (const entry of entries) {
      if (remaining-- <= 0) break;
      const full = pathMod.join(dir, entry.name);
      let stat;
      try { stat = fs.statSync(full); } catch (_) { continue; }
      newest = Math.max(newest, Number(stat.mtimeMs) || 0);
      if (entry.isDirectory()) walk(full, depth + 1);
    }
  };
  walk(root, 0);
  artifactScanCache.set(root, { scannedAt: now, mtimeMs: newest });
  return newest;
}

function readPractice() {
  let store;
  try {
    store = JSON.parse(fs.readFileSync(ORCHESTRATION, "utf8"));
  } catch (error) {
    return {
      ok: false,
      active: false,
      terminal: false,
      error: String(error && error.message || error)
    };
  }

  const all = Array.isArray(store.assignments) ? store.assignments
    .filter(a => a && a.mode === "PRACTICE")
    .sort((a, b) => assignmentTime(b) - assignmentTime(a)) : [];

  const active = all.find(a => a.status === "PENDING" || a.status === "RUNNING");
  const latest = active || all[0] || null;
  if (!latest) {
    return { ok: true, active: false, terminal: true, status: "NONE" };
  }

  let lastLearningEventAt = 0;
  if (latest.sessionId && Array.isArray(store.events)) {
    for (let i = store.events.length - 1; i >= 0; i--) {
      const event = store.events[i];
      if (!event || event.sessionId !== latest.sessionId) continue;
      lastLearningEventAt = Date.parse(event.createdAt || 0) || 0;
      if (lastLearningEventAt) break;
    }
  }
  const artifactProgressAt = newestArtifactMtime(latest.artifactDir || null);
  const practiceProgressAt = Math.max(lastLearningEventAt, artifactProgressAt);
  const practiceProgressSource = artifactProgressAt >= lastLearningEventAt
    ? (artifactProgressAt ? "artifact" : null)
    : "learning_event";

  return {
    ok: true,
    active: !!active,
    terminal: !active,
    assignmentId: latest.assignmentId || null,
    sessionId: latest.sessionId || null,
    status: latest.status || null,
    completedAt: latest.completedAt || null,
    cancelRequestedAt: latest.cancelRequestedAt || null,
    finalRenderRef: latest.finalRenderRef || null,
    controllerLeaseOwner: latest.controllerLease && latest.controllerLease.owner || null,
    controllerLeaseExpiresAt: latest.controllerLease && latest.controllerLease.expiresAt
      ? (Date.parse(latest.controllerLease.expiresAt) || 0)
      : 0,
    lastLearningEventAt: lastLearningEventAt || 0,
    artifactProgressAt: artifactProgressAt || 0,
    progressAt: practiceProgressAt || 0,
    progressSource: practiceProgressSource
  };
}

function pollEditFlowStatus() {
  let request;
  try {
    request = http.get(EDITFLOW_STATUS_URL, { timeout: 1500 }, response => {
      let data = "";
      response.setEncoding("utf8");
      response.on("data", chunk => {
        data += chunk;
        if (data.length > 256 * 1024) response.destroy();
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300 || !data) return;
        let payload;
        try { payload = JSON.parse(data); } catch (_) { return; }
        const now = Date.now();
        const revision = Number(payload.hostRevision);
        if (Number.isFinite(revision)) {
          if (runtime.lastAeHostRevision === null || runtime.lastAeHostRevision !== revision) {
            runtime.lastAeProgressAt = now;
            runtime.lastAeHostRevision = revision;
          }
        }
        const lease = payload.mutationLease || {};
        runtime.lastAeLeaseOwner = lease.held ? (lease.owner || null) : null;
        runtime.lastAeLeaseExpiresAt = lease.held ? (Number(lease.expiresAt) || Date.parse(lease.expiresAt) || 0) : 0;
        persist();
      });
    });
    request.on("error", () => {});
    request.on("timeout", () => request.destroy());
  } catch (_) {}
}

function armToPractice(practice, source) {
  if (!practice || !practice.active) return false;
  runtime.chainArmed = true;
  runtime.armedAt = Date.now();
  runtime.armedAssignmentId = practice.assignmentId || null;
  runtime.armedSessionId = practice.sessionId || null;
  runtime.lastPracticeStatus = practice.status || null;
  runtime.lastPracticeAssignmentId = practice.assignmentId || null;
  persist();
  log("practice_arm", {
    source: source || "unknown",
    assignmentId: runtime.armedAssignmentId,
    sessionId: runtime.armedSessionId
  });
  return true;
}

function disarm(reason, practice) {
  if (!runtime.chainArmed) return;
  runtime.chainArmed = false;
  runtime.lastPracticeStatus = practice && practice.status || runtime.lastPracticeStatus;
  persist();
  log("practice_disarm", {
    reason: reason || "unknown",
    assignmentId: practice && practice.assignmentId || runtime.armedAssignmentId,
    status: practice && practice.status || null
  });
}

function commandForHeartbeat(body, practice) {
  const now = Date.now();
  // Old/historical tabs must not refresh evidence or trigger commands.
  if (body.isTarget !== true || !Number.isInteger(body.tabId)) {
    return { command: "NONE", reason: "non_target_tab" };
  }
  if (runtime.lastTabId !== null && body.tabId !== runtime.lastTabId) {
    return { command: "NONE", reason: "owner_tab_mismatch" };
  }
  runtime.lastTabId = body.tabId;
  runtime.lastHeartbeatAt = now;
  runtime.lastMonitorState = body.monitorState;
  runtime.lastUrl = body.url || runtime.lastUrl;
  if (!practice.ok) return { command: "NONE", reason: "practice_status_unreadable" };
  if (practice.terminal || practice.cancelRequestedAt) {
    disarm("practice_terminal_or_cancel", practice);
    return { command: "STOP", reason: "practice_terminal_or_cancel" };
  }
  if (!runtime.chainArmed) return { command: "NONE", reason: "not_armed" };
  if (practice.assignmentId !== runtime.armedAssignmentId) {
    return { command: "NONE", reason: "assignment_changed_rearm_required" };
  }
  const enabled = body.monitorState === "running";
  if (!enabled) runtime.handoff = null;
  const fingerprint = String(body.assistantFingerprint || "");
  if (fingerprint && fingerprint !== runtime.lastAssistantFingerprint) {
    runtime.lastAssistantFingerprint = fingerprint;
    runtime.lastAssistantTextLength = Math.max(0, Number(body.assistantTextLength) || 0);
    runtime.lastUiProgressAt = now;
  }
  runtime.lastThinkingSignal = body.thinkingSignal || null;
  if (Number(practice.progressAt) > Number(runtime.lastPracticeProgressAt || 0)) {
    runtime.lastPracticeProgressAt = Number(practice.progressAt);
    runtime.lastPracticeProgressSource = practice.progressSource;
  }
  const status = Number(runtime.lastGenerationHttpStatus || 0);
  const blocked = status === 401 || status === 403 ? "authentication_required"
    : status === 429 ? "rate_limited" : null;
  const terminal = body.uiFailureSignal ||
    (runtime.lastGenerationOutcome === "failure" ? "generation_failed" : null);
  const transportClosedAndVisibleAnswer = runtime.lastGenerationOutcome === "transport_closed" &&
    Number(body.activeRequests || 0) === 0 && Number(body.streamActiveRequests || 0) === 0 &&
    body.stopVisible !== true && runtime.lastAssistantTextLength > 0 &&
    now - Math.max(runtime.lastGenerationEndAt, runtime.lastUiProgressAt) >= 15000;
  const evidence = {
    enabled, blocked, observerAt: now,
    startedAt: runtime.lastGenerationStartAt,
    semanticAt: runtime.lastSemanticAt,
    semanticCoverage: runtime.semanticCoverage,
    uiAt: runtime.lastUiProgressAt,
    aeAt: runtime.lastAeProgressAt,
    practiceAt: runtime.lastPracticeProgressAt,
    streamAt: Number(body.streamLastActivityAt || runtime.lastStreamActivityAt || 0),
    activeRequests: Number(body.activeRequests || 0),
    streamRequests: Number(body.streamActiveRequests || 0),
    stopVisible: body.stopVisible === true,
    manualStopUntil: Number(body.manualStopUntil || 0),
    leaseUntil: Math.max(Number(runtime.lastAeLeaseExpiresAt || 0), Number(practice.controllerLeaseExpiresAt || 0)),
    terminal,
    completedAt: runtime.semanticCompletedAt || (transportClosedAndVisibleAnswer ? runtime.lastGenerationEndAt : 0)
  };
  runtime.lastStopObservation = { protocol: Number(body.stopProtocol) || null,
    stopVisible: body.stopVisible === true, clickable: body.stopClickable === true,
    idleUi: body.idleUi === true, href: body.url || runtime.lastUrl, at: now };
  // One request's terminal event cannot mark another active stream idle.
  const policy = { ...POLICY, quietMs: Math.max(POLICY.quietMs, (Number(body.hardOpenRequestSeconds) || 600) * 1000) };
  const verdict = evaluateLiveness(runtime.liveness || {}, evidence, now, policy);
  runtime.liveness = verdict.next;
  runtime.lastLiveness = { phase: verdict.phase, reason: verdict.reason, at: now };
  if (verdict.action !== "HANDOFF") { persist(); return { command: "NONE", ...runtime.lastLiveness }; }
  if (runtime.lastChainedGenerationStartAt === runtime.lastGenerationStartAt && runtime.lastGenerationStartAt) {
    return { command: "NONE", reason: "generation_already_handed_off" };
  }
  if (runtime.handoff && now < runtime.handoff.expiresAt) {
    return { command: "NONE", reason: "handoff_pending" };
  }
  const progressAt = Math.max(runtime.lastAeProgressAt || 0, runtime.lastPracticeProgressAt || 0);
  runtime.handoffHistory = (runtime.handoffHistory || []).filter(item =>
    now - item.at < 15 * 60000 && item.at > progressAt);
  if (runtime.handoffHistory.length >= 3) {
    runtime.lastLiveness = { phase: "BLOCKED", reason: "restart_circuit_open_no_task_progress", at: now };
    persist(); return { command: "NONE", ...runtime.lastLiveness };
  }
  runtime.lastChainIssuedAt = now;
  runtime.handoff = { id: randomUUID(), sourceTabId: body.tabId,
    generationAt: runtime.lastGenerationStartAt, assignmentId: practice.assignmentId,
    sessionId: practice.sessionId, sourceUrl: runtime.lastUrl, issuedAt: now,
    reason: verdict.reason, status: "issued", expiresAt: now + 60000 };
  persist();
  log("command_chain", { reason: verdict.reason, phase: verdict.phase, handoffId: runtime.handoff.id,
    generationAt: runtime.lastGenerationStartAt, semanticAt: runtime.lastSemanticAt });
  return { command: "CHAIN", reason: verdict.reason, handoffId: runtime.handoff.id };
}

function prepareHandoff(body) {
  const practice = readPractice();
  const handoff = runtime.handoff;
  const now = Date.now();
  if (!handoff || handoff.id !== body.handoffId || handoff.sourceTabId !== body.tabId ||
      handoff.generationAt !== runtime.lastGenerationStartAt || now >= handoff.expiresAt ||
      runtime.lastMonitorState !== "running" || !practice.active || practice.cancelRequestedAt ||
      practice.assignmentId !== handoff.assignmentId) return { ok: false, reason: "handoff_authorization_changed" };
  if (Math.max(practice.controllerLeaseExpiresAt || 0, runtime.lastAeLeaseExpiresAt || 0) > now) {
    return { ok: false, reason: "active_work_lease" };
  }
  fs.mkdirSync(HANDOFF_DIR, { recursive: true });
  const checkpoint = pathMod.join(HANDOFF_DIR, handoff.id + ".checkpoint.json");
  fs.copyFileSync(ORCHESTRATION, checkpoint);
  handoff.checkpoint = checkpoint; handoff.status = "prepared";
  handoff.prompt = "Continue the practice session with the given raw files to make the finished product. " +
    "Resume existing assignment " + practice.assignmentId + " and session " + practice.sessionId +
    " from its latest durable checkpoint; do not create or restart the assignment. " +
    "Run the connection preflight, reconcile any in-flight AE work and controller lease, then continue the original M6 reference-first workflow. " +
    "Use only the provided raw footage and raw audio; Finished is visual reference only. Keep After Effects open.";
  persist(); log("handoff_prepared", { handoffId: handoff.id, assignmentId: practice.assignmentId, checkpoint });
  return { ok: true, handoffId: handoff.id, prompt: handoff.prompt,
    sourceUrl: handoff.sourceUrl, issuedAt: handoff.issuedAt };
}

function recordStopped(body) {
  const handoff = runtime.handoff;
  const practice = readPractice();
  const now = Date.now();
  if (!handoff || handoff.status !== "prepared" || handoff.id !== body.handoffId ||
      handoff.sourceTabId !== body.tabId || handoff.generationAt !== runtime.lastGenerationStartAt ||
      runtime.lastUrl !== handoff.sourceUrl || now >= handoff.expiresAt ||
      runtime.lastMonitorState !== "running" || !practice.active || practice.cancelRequestedAt ||
      practice.assignmentId !== handoff.assignmentId || practice.sessionId !== handoff.sessionId ||
      Math.max(practice.controllerLeaseExpiresAt || 0, runtime.lastAeLeaseExpiresAt || 0) > now ||
      !validStopProof(body.proof, handoff.sourceUrl, now, handoff.issuedAt)) {
    return { ok: false, reason: "stop_confirmation_rejected" };
  }
  handoff.stopReceipt = { id: randomUUID(), proof: body.proof, verifiedAt: now };
  persist();
  log("handoff_stop_verified", { handoffId: handoff.id, sourceTabId: body.tabId,
    clickCount: body.proof.clickCount, alreadyIdle: body.proof.alreadyIdle,
    stableForMs: body.proof.stableForMs, transportQuietMs: body.proof.transportQuietMs });
  return { ok: true, stopReceiptId: handoff.stopReceipt.id };
}

function commitHandoff(body) {
  const handoff = runtime.handoff;
  const practice = readPractice();
  if (!handoff || handoff.status !== "prepared" || handoff.id !== body.handoffId ||
      !handoff.stopReceipt || body.stopReceiptId !== handoff.stopReceipt.id ||
      Date.now() - handoff.stopReceipt.verifiedAt > 5000 || !Number.isInteger(body.targetTabId) ||
      handoff.sourceTabId !== body.tabId || handoff.generationAt !== runtime.lastGenerationStartAt ||
      Date.now() >= handoff.expiresAt || runtime.lastMonitorState !== "running" ||
      runtime.lastUrl !== handoff.sourceUrl || !practice.active || practice.cancelRequestedAt ||
      practice.assignmentId !== handoff.assignmentId || practice.sessionId !== handoff.sessionId ||
      Math.max(practice.controllerLeaseExpiresAt || 0, runtime.lastAeLeaseExpiresAt || 0) > Date.now()) {
    return { ok: false, reason: "handoff_commit_rejected" };
  }
  handoff.status = "committed"; handoff.targetTabId = body.targetTabId;
  runtime.lastChainedGenerationStartAt = handoff.generationAt;
  runtime.lastTabId = body.targetTabId;
  runtime.handoffHistory.push({ at: Date.now(), handoffId: handoff.id });
  runtime.lastHeartbeatAt = 0;
  persist(); log("handoff_committed", { handoffId: handoff.id, targetTabId: body.targetTabId });
  return { ok: true, prompt: handoff.prompt };
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type"
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 128 * 1024) {
        reject(new Error("body_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

function onEvent(body) {
  const type = String(body.type || "");
  const now = Date.now();
  const practice = readPractice();
  if (type === "practice_arm" && Number.isInteger(body.tabId)) {
    runtime.lastTabId = body.tabId;
  } else if (Number.isInteger(body.tabId) && body.tabId !== runtime.lastTabId) {
    return { ok: true, ignored: true, reason: "non_owner_event" };
  }
  if (["generation_end", "generation_error"].includes(type) &&
      String(body.requestId || "") !== String(runtime.generationRequestId || "")) {
    return { ok: true, ignored: true, reason: "superseded_request_event" };
  }
  if (type === "semantic_activity" || type === "semantic_terminal" || type === "semantic_coverage") {
    if (body.requestId !== runtime.semanticRequestId) return { ok: true, ignored: true };
    runtime.semanticCoverage = true;
    if (type === "semantic_activity") runtime.lastSemanticAt = now;
    if (type === "semantic_terminal" && body.terminal === "success") runtime.semanticCompletedAt = now;
    if (type === "semantic_terminal" && body.terminal === "failure") {
      runtime.lastGenerationOutcome = "failure"; runtime.lastGenerationErrorAt = now;
    }
  }

  if (type === "monitor_inactive") {
    runtime.lastMonitorState = body.monitorState || "stopped";
    runtime.liveness = {}; runtime.handoff = null;
  } else if (type === "extension_loaded") {
    runtime.lastExtensionVersion = body.extensionVersion || null;
  } else if (type === "practice_arm") {
    armToPractice(practice, body.source || "extension");
  } else if (type === "generation_start") {
    if (!runtime.chainArmed && practice.active) {
      armToPractice(practice, "generation_start_recovery");
    }
    runtime.lastUiFailureKey = null;
    runtime.lastGenerationStartAt = Number(body.ts) || now;
    runtime.lastGenerationOutcome = "running";
    runtime.generationRequestId = body.requestId || null;
    runtime.lastGenerationHttpStatus = 0;
    runtime.lastSemanticAt = 0;
    runtime.semanticCompletedAt = 0;
    runtime.semanticCoverage = false;
    runtime.liveness = {};
    runtime.handoff = null;
    runtime.lastAssistantFingerprint = null;
    runtime.lastAssistantTextLength = 0;
    runtime.lastUiProgressAt = runtime.lastGenerationStartAt;
    runtime.lastThinkingSignal = null;
    runtime.lastPracticeProgressAt = Number(practice.progressAt || 0);
    runtime.lastPracticeProgressSource = practice.progressSource || null;
    // Every new real ChatGPT generation starts a fresh watchdog cycle.
    // Older handoff state must not impose a 15-second settle delay on this
    // response after it finishes.
    runtime.lastChainIssuedAt = 0;
    runtime.lastChainAckAt = 0;
    runtime.lastChainSentAt = 0;
    runtime.lastChainFailedAt = 0;
    runtime.lastChainedGenerationStartAt = 0;
    runtime.lastNativeHandoffForAt = 0;
  } else if (type === "generation_end") {
    runtime.lastGenerationEndAt = Number(body.ts) || now;
    if (runtime.lastGenerationOutcome !== "failure") {
      runtime.lastGenerationOutcome = body.success === false ? "failure" : "transport_closed";
    }
    runtime.lastGenerationHttpStatus = Number(body.status) || 0;
    if (body.success === false) runtime.lastGenerationErrorAt = Number(body.ts) || now;
  } else if (type === "generation_error") {
    runtime.lastGenerationErrorAt = Number(body.ts) || now;
    runtime.lastGenerationOutcome = "failure";
  } else if (type === "chain_failed") {
    // A handoff failure is not a generation failure. Keeping these states
    // separate prevents an old handoff error from overwriting a newer live
    // ChatGPT generation and triggering another replacement loop.
    runtime.lastChainFailedAt = Number(body.ts) || now;
  } else if (type === "stream_start") {
    runtime.semanticRequestId = body.requestId || null;
    runtime.lastUiFailureKey = null;
    runtime.lastStreamActivityAt = Number(body.ts) || now;
    runtime.lastStreamBytesTotal = 0;
    runtime.lastStreamRequestId = body.requestId || null;
  } else if (type === "stream_activity") {
    runtime.lastStreamActivityAt = Number(body.ts) || now;
    runtime.lastStreamBytesTotal = Math.max(
      Number(runtime.lastStreamBytesTotal) || 0,
      Number(body.bytesTotal) || 0
    );
    runtime.lastStreamRequestId = body.requestId || runtime.lastStreamRequestId;
  } else if (type === "stream_end") {
    runtime.lastStreamActivityAt = Number(body.ts) || now;
    runtime.lastStreamBytesTotal = Math.max(
      Number(runtime.lastStreamBytesTotal) || 0,
      Number(body.bytesTotal) || 0
    );
    runtime.lastStreamRequestId = body.requestId || runtime.lastStreamRequestId;
  } else if (type === "probe_ready") {
    runtime.probeReadyAt = Number(body.ts) || now;
  } else if (type === "chain_ack") {
    runtime.lastChainAckAt = Number(body.ts) || now;
  } else if (type === "chain_sent") {
    runtime.lastChainSentAt = Number(body.ts) || now;
    runtime.lastChainFailedAt = 0;
  } else if (type === "terminal") {
    disarm("extension_terminal", practice);
  }

  runtime.lastPracticeStatus = practice.status || runtime.lastPracticeStatus;
  runtime.lastPracticeAssignmentId = practice.assignmentId || runtime.lastPracticeAssignmentId;
  persist();
  log(type || "event", Object.assign({}, body, {
    practiceStatus: practice.status || null,
    assignmentId: practice.assignmentId || null
  }));
  return { ok: true, practice, chainArmed: runtime.chainArmed };
}

async function handle(req, res) {
  const url = new URL(req.url, "http://" + HOST + ":" + PORT);
  if (req.method === "OPTIONS") return json(res, 200, { ok: true });

  if (req.method === "GET" && url.pathname === "/health") {
    const practice = readPractice();
    return json(res, 200, {
      ok: true,
      service: "EditFlow Practice Chat Supervisor",
      version: "1.6.1",
      extensionVersion: runtime.lastExtensionVersion || null,
      monitorState: runtime.lastMonitorState,
      monitoredTabId: runtime.lastTabId,
      policy: POLICY,
      liveness: runtime.lastLiveness,
      handoff: runtime.handoff,
      stopObservation: runtime.lastStopObservation || null,
      lastSemanticAt: runtime.lastSemanticAt,
      semanticCoverage: runtime.semanticCoverage,
      pid: process.pid,
      chainArmed: runtime.chainArmed,
      lastChainIssuedAt: runtime.lastChainIssuedAt || null,
      lastChainAckAt: runtime.lastChainAckAt || null,
      lastChainSentAt: runtime.lastChainSentAt || null,
      lastChainFailedAt: runtime.lastChainFailedAt || null,
      lastNativeHandoffAt: runtime.lastNativeHandoffAt || null,
      lastHeartbeatAt: runtime.lastHeartbeatAt || null,
      heartbeatAgeMs: runtime.lastHeartbeatAt ? Date.now() - runtime.lastHeartbeatAt : null,
      lastStreamActivityAt: runtime.lastStreamActivityAt || null,
      streamActivityAgeMs: runtime.lastStreamActivityAt ? Date.now() - runtime.lastStreamActivityAt : null,
      lastStreamBytesTotal: Number(runtime.lastStreamBytesTotal) || 0,
      lastStreamRequestId: runtime.lastStreamRequestId || null,
      lastUiProgressAt: runtime.lastUiProgressAt || null,
      uiProgressAgeMs: runtime.lastUiProgressAt ? Date.now() - runtime.lastUiProgressAt : null,
      lastAssistantTextLength: Number(runtime.lastAssistantTextLength) || 0,
      lastThinkingSignal: runtime.lastThinkingSignal || null,
      lastAeHostRevision: runtime.lastAeHostRevision,
      lastAeProgressAt: runtime.lastAeProgressAt || null,
      aeProgressAgeMs: runtime.lastAeProgressAt ? Date.now() - runtime.lastAeProgressAt : null,
      lastAeLeaseOwner: runtime.lastAeLeaseOwner || null,
      lastAeLeaseExpiresAt: runtime.lastAeLeaseExpiresAt || null,
      lastPracticeProgressAt: runtime.lastPracticeProgressAt || null,
      practiceProgressAgeMs: runtime.lastPracticeProgressAt ? Date.now() - runtime.lastPracticeProgressAt : null,
      lastPracticeProgressSource: runtime.lastPracticeProgressSource || null,
      probeReadyAt: runtime.probeReadyAt || null,
      practice
    });
  }

  if (req.method === "GET" && url.pathname === "/practice-status") {
    return json(res, 200, Object.assign({ supervisor: true }, readPractice()));
  }

  if (req.method === "POST" && ["/handoff/prepare", "/handoff/stopped", "/handoff/commit"].includes(url.pathname)) {
    try {
      const body = await readBody(req);
      const result = url.pathname.endsWith("prepare") ? prepareHandoff(body)
        : url.pathname.endsWith("stopped") ? recordStopped(body) : commitHandoff(body);
      return json(res, result.ok ? 200 : 409, result);
    } catch (error) { return json(res, 500, { ok: false, error: String(error) }); }
  }

  if (req.method === "POST" && url.pathname === "/event") {
    try {
      return json(res, 200, onEvent(await readBody(req)));
    } catch (error) {
      return json(res, 400, { ok: false, error: String(error) });
    }
  }

  if (req.method === "POST" && url.pathname === "/heartbeat") {
    let body;
    try { body = await readBody(req); }
    catch (error) { return json(res, 400, { ok: false, error: String(error) }); }

    const practice = readPractice();
    runtime.lastPracticeStatus = practice.status || runtime.lastPracticeStatus;
    runtime.lastPracticeAssignmentId = practice.assignmentId || runtime.lastPracticeAssignmentId;

    const command = commandForHeartbeat(body, practice);
    return json(res, 200, Object.assign({
      ok: true,
      chainArmed: runtime.chainArmed,
      practice
    }, command));
  }

  return json(res, 404, { ok: false, error: "not_found" });
}

function runRecovery(reason) {
  const now = Date.now();
  if (now - runtime.lastRecoveryAt < RECOVERY_COOLDOWN_MS) return;
  runtime.lastRecoveryAt = now;
  persist();
  log("native_recovery", { reason });

  try {
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", RECOVERY_SCRIPT,
      "-Reason", String(reason || "heartbeat_stale")
    ], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
  } catch (error) {
    log("native_recovery_error", { error: String(error) });
  }
}

function supervisorTick() {
  const practice = readPractice();
  if (runtime.chainArmed && (practice.terminal || practice.cancelRequestedAt)) {
    disarm("practice_terminal_tick", practice); return;
  }
  if (!runtime.chainArmed || !practice.active || runtime.lastMonitorState !== "running") return;
  if (runtime.handoff && Date.now() >= runtime.handoff.expiresAt) {
    log("handoff_expired", { handoffId: runtime.handoff.id });
    runtime.handoff = null; persist();
  }
  const age = runtime.lastHeartbeatAt ? Date.now() - runtime.lastHeartbeatAt : Infinity;
  if (age > HEARTBEAT_STALE_MS) {
    runtime.lastLiveness = { phase: "OBSERVER_OFFLINE", reason: "observer_missing_repair_only", at: Date.now() };
    runtime.liveness = {}; persist();
    runRecovery("target_observer_stale_no_chat_termination");
  }
}

loadState();
runtime.liveness = {};
runtime.handoff = null;
runtime.lastHeartbeatAt = 0;
runtime.lastMonitorState = "stopped";
persist();

const server = http.createServer((req, res) => {
  handle(req, res).catch(error => {
    log("server_error", { error: String(error && error.stack || error) });
    if (!res.headersSent) json(res, 500, { ok: false, error: "internal_error" });
    else res.end();
  });
});

server.listen(PORT, HOST, () => {
  log("supervisor_started", { pid: process.pid, port: PORT });
  console.log("EditFlow Practice Chat Supervisor listening on http://" + HOST + ":" + PORT);
});

setInterval(supervisorTick, 1000).unref();
pollEditFlowStatus();
setInterval(pollEditFlowStatus, 2000).unref();

process.on("uncaughtException", error => {
  log("uncaught_exception", { error: String(error && error.stack || error) });
});
process.on("unhandledRejection", error => {
  log("unhandled_rejection", { error: String(error && error.stack || error) });
});
