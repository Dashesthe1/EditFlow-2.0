"use strict";
importScripts("stop-gate.js");

const ALARM = "editflow-production-watchdog";
const HARD_ALARM = "editflow-production-hard-deadline";
const SUPERVISOR_BASE = "http://127.0.0.1:32147";
const DEFAULTS = {
  monitorState: "stopped",
  monitorTabId: null,
  monitorTabWasAutoDiscardable: true,
  hardOpenRequestSeconds: 60,
  failureConfirmSeconds: 15,
  handoffCooldownSeconds: 90,
  runtimeVersion: null,
  watchdogRuntime: null
};

const recentByTab = new Map();
let runtimeCache = null;
let transportQueue = Promise.resolve();
function serialTransport(task) {
  const result = transportQueue.then(task);
  transportQueue = result.catch(() => {});
  return result;
}
async function storeState(value) {
  if (Object.prototype.hasOwnProperty.call(value, "watchdogRuntime")) runtimeCache = value.watchdogRuntime;
  return chrome.storage.local.set(value);
}

function rememberRequest(details, patch) {
  if (!Number.isInteger(details.tabId) || details.tabId < 0) return;
  const bucket = recentByTab.get(details.tabId) || {};
  const current = bucket[details.requestId] || {
    requestId: details.requestId,
    startedAt: Date.now(),
    url: details.url,
    method: details.method,
    active: true
  };
  Object.assign(current, patch || {});
  bucket[details.requestId] = current;
  const cutoff = Date.now() - 15000;
  for (const [id, item] of Object.entries(bucket)) {
    const last = Number(item.endedAt || item.startedAt || 0);
    if (last < cutoff) delete bucket[id];
  }
  recentByTab.set(details.tabId, bucket);
}

function recentForTab(tabId) {
  const bucket = recentByTab.get(tabId) || {};
  const cutoff = Date.now() - 10000;
  return Object.fromEntries(Object.entries(bucket).filter(([, item]) =>
    Number(item.endedAt || item.startedAt || 0) >= cutoff
  ));
}

function freshRuntime(extra) {
  return Object.assign({
    armedAt: Date.now(),
    requests: {},
    streamRequests: {},
    probeReadyAt: null,
    probeVersion: null,
    lastStreamActivityAt: null,
    lastStreamBytesTotal: 0,
    lastStreamRequestId: null,
    lastAssistantFingerprint: null,
    lastAssistantTextLength: 0,
    lastMeaningfulUiProgressAt: null,
    lastThinkingSignal: null,
    lastEventAt: null,
    lastCompletedAt: null,
    lastHttpStatus: null,
    manualStopUntil: 0,
    failureCandidate: null,
    needsAttention: null,
    lastHandoffAt: null,
    lastHandoffReason: null,
    handoffCount: 0,
    statusText: "Armed; waiting for ChatGPT production transport"
  }, extra || {});
}

async function state() {
  return chrome.storage.local.get(DEFAULTS);
}

async function runtime() {
  if (!runtimeCache) { const data = await state(); runtimeCache = data.watchdogRuntime || freshRuntime(); }
  return runtimeCache;
}

async function saveRuntime(value) {
  await storeState({ watchdogRuntime: value });
}

async function supervisorPost(path, payload, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(SUPERVISOR_BASE + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload || {}),
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function supervisorEvent(type, detail) {
  return supervisorPost("/event", Object.assign({
    type,
    ts: Date.now(),
    extensionVersion: chrome.runtime.getManifest().version
  }, detail || {}));
}

function isChatGptUrl(url) {
  return /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(String(url || ""));
}

function requestPath(url) {
  try { return new URL(url).pathname.toLowerCase(); }
  catch (_) { return ""; }
}

function isGenerationRequest(details) {
  if (details.method !== "POST" || details.tabId < 0) return false;
  const path = requestPath(details.url).replace(/\/$/, "");
  if (!path) return false;

  // Only count the actual ChatGPT response-generation transport. Helper calls
  // such as /conversation/init, /conversation/prepare, sentinel, title and
  // telemetry requests must never start/finish the Practice watchdog timer.
  return path === "/backend-api/f/conversation" ||
    path === "/backend-api/conversation" ||
    path === "/backend-api/responses" ||
    path === "/backend-api/f/responses";
}

function activeRequests(rt) {
  return Object.values(rt.requests || {}).filter(item => item && item.active);
}

function activeStreamRequests(rt) {
  return Object.values(rt.streamRequests || {}).filter(item => item && item.active);
}

function streamSnapshot(rt) {
  const active = activeStreamRequests(rt);
  if (!active.length) {
    return { active: [], lastActivityAt: null, ageMs: 0, bytesTotal: 0 };
  }
  const lastActivityAt = Math.max(...active.map(req =>
    Number(req.lastByteAt || req.startedAt || 0)
  ));
  const bytesTotal = Math.max(...active.map(req => Number(req.bytesTotal || 0)));
  return {
    active,
    lastActivityAt,
    ageMs: lastActivityAt ? Math.max(0, Date.now() - lastActivityAt) : 0,
    bytesTotal
  };
}

function statusClass(code) {
  code = Number(code || 0);
  if (code === 401 || code === 403) return "auth_invalid";
  if (code === 404 || code === 409 || code === 410) return "conversation_invalid";
  if (code === 429) return "rate_limited";
  if (code >= 500) return "server_error";
  if (code >= 400) return "request_rejected";
  return "ok";
}

function candidate(rt, reason, delaySeconds, requestId, detail) {
  const now = Date.now();
  rt.failureCandidate = {
    reason: reason,
    requestId: requestId || null,
    detail: detail || null,
    firstSeenAt: now,
    actAt: now + Math.max(0, Number(delaySeconds) || 0) * 1000
  };
  rt.statusText = "Confirmed network failure signal: " + reason + "; verifying before handoff";
}

async function syncAlarm() {
  await chrome.alarms.clear(ALARM);
  const data = await state();
  if ((data.monitorState === "running" || data.monitorState === "busy") &&
      Number.isInteger(data.monitorTabId)) {
    await chrome.alarms.create(ALARM, {
      delayInMinutes: 0.5,
      periodInMinutes: 0.5
    });
  }
}

async function syncHardDeadline() {
  // Only the evidence supervisor may authorize a replacement.
  await chrome.alarms.clear(HARD_ALARM);
}

async function restoreTab(data) {
  if (!Number.isInteger(data.monitorTabId)) return;
  try {
    await chrome.tabs.update(data.monitorTabId, {
      autoDiscardable: data.monitorTabWasAutoDiscardable !== false
    });
  } catch (_) {}
}

async function ensureMainProbe(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: "MAIN",
      files: ["stream-events.js", "main_probe.js"]
    });
    return true;
  } catch (_) {
    return false;
  }
}

async function ensureContentScript(tabId) {
  await ensureMainProbe(tabId);
  // Always inject the current isolated-world supervisor once. Its build guard
  // makes this idempotent, while avoiding a stale pre-reload content script
  // falsely reporting the new manifest version through chrome.runtime.
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ["stop-gate.js", "content.js"]
    });
    const reply = await chrome.tabs.sendMessage(tabId, { type: "PHRASE_MONITOR_PING" });
    return !!(reply && reply.ready && reply.stopProtocol === 1 &&
      reply.version === chrome.runtime.getManifest().version);
  } catch (_) {
    return false;
  }
}

async function waitForChatTabReady(tabId, maxMs = 20000) {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && isChatGptUrl(tab.url) && tab.status === "complete") return tab;
    } catch (_) {
      return null;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return null;
}

async function armPracticeTab(tab) {
  if (!tab || !Number.isInteger(tab.id) || !isChatGptUrl(tab.url)) {
    return { ok: false, error: "Practice auto-arm requires an active ChatGPT tab." };
  }

  const data = await state();
  if (data.monitorTabId === tab.id &&
      (data.monitorState === "running" || data.monitorState === "busy")) {
    await ensureContentScript(tab.id);
    const rt = await runtime();
    await syncAlarm();
    return { ok: true, tabId: tab.id, alreadyArmed: true };
  }
  if (Number.isInteger(data.monitorTabId) && data.monitorTabId !== tab.id) {
    await restoreTab(data);
  }
  if (!(await ensureContentScript(tab.id))) {
    return { ok: false, error: "Watchdog content script is unavailable on the ChatGPT tab." };
  }

  const originalAutoDiscardable = tab.autoDiscardable !== false;
  try { await chrome.tabs.update(tab.id, { autoDiscardable: false }); } catch (_) {}

  const previous = await runtime();
  const captured = recentForTab(tab.id);
  const nextRuntime = freshRuntime({
    requests: captured,
    handoffCount: Number(previous.handoffCount || 0),
    lastHandoffAt: previous.lastHandoffAt || null,
    lastHandoffReason: previous.lastHandoffReason || null,
    statusText: Object.values(captured).some(item => item.active)
      ? "Captured the in-flight ChatGPT production request during arm"
      : "Armed; waiting for ChatGPT production transport"
  });
  const recentFailure = Object.values(captured).find(item =>
    item.error || Number(item.status || 0) >= 400
  );
  if (recentFailure) {
    nextRuntime.failureCandidate = {
      reason: recentFailure.error ? "transport_error" : "request_rejected",
      requestId: recentFailure.requestId,
      firstSeenAt: Date.now(),
      actAt: Date.now() + Number(data.failureConfirmSeconds || 15) * 1000
    };
  }
  await storeState({
    monitorState: "running",
    monitorTabId: tab.id,
    monitorTabWasAutoDiscardable: originalAutoDiscardable,
    runtimeVersion: chrome.runtime.getManifest().version,
    watchdogRuntime: nextRuntime
  });
  await syncAlarm();
  return { ok: true, tabId: tab.id };
}

async function stopMonitor() {
  const data = await state();
  await restoreTab(data);
  await storeState({
    monitorState: "stopped",
    monitorTabId: null,
    monitorTabWasAutoDiscardable: true,
    watchdogRuntime: freshRuntime({ statusText: "Stopped" })
  });
  await chrome.alarms.clear(ALARM);
}

async function scheduleFromStatus(details, rt, data) {
  const code = Number(details.statusCode || 0);
  rt.lastHttpStatus = code;
  const kind = statusClass(code);
  if (kind === "auth_invalid") {
    rt.needsAttention = "ChatGPT authentication was rejected. A fresh conversation would not repair the login session.";
    rt.failureCandidate = null;
    rt.statusText = "Authentication invalid; automatic handoff is suppressed";
  } else if (kind === "conversation_invalid") {
    candidate(rt, "conversation_invalid", 2, details.requestId, { status: code });
  } else if (kind === "rate_limited") {
    rt.needsAttention = "ChatGPT is rate-limited. Replacement-chat loops are suppressed.";
    rt.failureCandidate = null;
    rt.statusText = "Rate limited; waiting for user/account availability";
  } else if (kind === "server_error") {
    candidate(rt, "server_error", data.failureConfirmSeconds, details.requestId, { status: code });
  } else if (kind === "request_rejected") {
    candidate(rt, "request_rejected", data.failureConfirmSeconds, details.requestId, { status: code });
  }
}

async function onBefore(details) {
  if (!isGenerationRequest(details)) return;
  rememberRequest(details, { active: true, startedAt: Date.now(), status: null });
  const data = await state();
  if ((data.monitorState !== "running" && data.monitorState !== "busy") ||
      data.monitorTabId !== details.tabId) return;
  const rt = await runtime();
  rt.requests = rt.requests || {};
  rt.requests[details.requestId] = {
    active: true,
    startedAt: Date.now(),
    url: details.url,
    method: details.method,
    status: null
  };
  rt.lastEventAt = Date.now();
  rt.lastAssistantFingerprint = null;
  rt.lastAssistantTextLength = 0;
  rt.lastMeaningfulUiProgressAt = Date.now();
  rt.lastThinkingSignal = null;
  rt.failureCandidate = null;
  rt.needsAttention = null;
  rt.statusText = "ChatGPT production request is open; progress-aware watchdog is observing transport + task progress";
  await saveRuntime(rt);
  await syncHardDeadline();
  await supervisorEvent("generation_start", {
    tabId: details.tabId,
    requestId: details.requestId,
    url: details.url
  });
}

async function onHeaders(details) {
  if (!isGenerationRequest(details)) return;
  rememberRequest(details, { active: true, status: Number(details.statusCode || 0) });
  const data = await state();
  if ((data.monitorState !== "running" && data.monitorState !== "busy") ||
      data.monitorTabId !== details.tabId) return;
  const rt = await runtime();
  const req = rt.requests[details.requestId] || {
    active: true, startedAt: Date.now(), url: details.url, method: details.method
  };
  req.status = Number(details.statusCode || 0);
  rt.requests[details.requestId] = req;
  rt.lastEventAt = Date.now();
  await scheduleFromStatus(details, rt, data);
  await saveRuntime(rt);
}

async function requestCompletionHandoff(tabId) {
  const data = await state();
  if (data.monitorState !== "running" || data.monitorTabId !== tabId) return;
  try { await chrome.tabs.sendMessage(tabId, { type: "WATCHDOG_SAMPLE_NOW" }); } catch (_) {}
}

async function onCompleted(details) {
  if (!isGenerationRequest(details)) return;
  rememberRequest(details, {
    active: false, endedAt: Date.now(), status: Number(details.statusCode || 0)
  });
  const data = await state();
  if (data.monitorTabId !== details.tabId) return;
  const rt = await runtime();
  const req = rt.requests[details.requestId] || {
    startedAt: Date.now(), url: details.url, method: details.method
  };
  req.active = false;
  req.endedAt = Date.now();
  req.status = Number(details.statusCode || 0);
  rt.requests[details.requestId] = req;
  rt.lastEventAt = Date.now();
  rt.lastCompletedAt = Date.now();
  rt.lastHttpStatus = req.status;

  if (req.status >= 200 && req.status < 400) {
    rt.failureCandidate = null;
    rt.needsAttention = null;
    rt.statusText = "Generation completed; awaiting Practice continuation handoff";
  } else {
    await scheduleFromStatus(details, rt, data);
  }
  await saveRuntime(rt);
  await syncHardDeadline();
  const success = req.status >= 200 && req.status < 400;
  await supervisorEvent("generation_end", {
    tabId: details.tabId,
    requestId: details.requestId,
    status: req.status,
    success
  });

  if (success) {
    const completedAt = req.endedAt;
    setTimeout(() => {
      void requestCompletionHandoff(details.tabId, completedAt).catch(() => {});
    }, 2200);
  }
}

async function onError(details) {
  if (!isGenerationRequest(details)) return;
  rememberRequest(details, {
    active: false, endedAt: Date.now(), error: details.error || "network_error"
  });
  const data = await state();
  if (data.monitorTabId !== details.tabId) return;
  const rt = await runtime();
  const req = rt.requests[details.requestId] || {
    startedAt: Date.now(), url: details.url, method: details.method
  };
  req.active = false;
  req.endedAt = Date.now();
  req.error = details.error || "network_error";
  rt.requests[details.requestId] = req;
  rt.lastEventAt = Date.now();

  const manuallyStopped = Number(rt.manualStopUntil || 0) > Date.now();
  if (manuallyStopped) {
    rt.failureCandidate = null;
    rt.statusText = "Generation was manually stopped; watchdog will not replace it";
  } else {
    candidate(rt, "transport_error", data.failureConfirmSeconds, details.requestId, {
      error: details.error || null
    });
  }
  await saveRuntime(rt);
  await syncHardDeadline();
  if (!manuallyStopped) {
    void supervisorEvent("generation_error", {
      tabId: details.tabId,
      requestId: details.requestId,
      error: details.error || null
    });


  }
}

async function onProbeEvent(event, sender) {
  const tab = sender && sender.tab;
  if (!tab || !Number.isInteger(tab.id) || !isChatGptUrl(tab.url)) {
    return { ok: false, error: "invalid_probe_tab" };
  }
  const data = await state();
  if ((data.monitorState !== "running" && data.monitorState !== "busy") ||
      data.monitorTabId !== tab.id) return { ok: true, ignored: true };

  const rt = await runtime();
  rt.streamRequests = rt.streamRequests || {};
  const type = String(event && event.type || "");
  const now = Date.now();
  const ts = Number(event && event.ts) || now;
  const requestId = String(event && event.requestId || "");
  const wasProbeReady = !!rt.probeReadyAt;

  if (type === "probe_ready" || type === "page_heartbeat") {
    if (!rt.probeReadyAt) rt.probeReadyAt = ts;
    rt.probeVersion = Number(event.version) || 2;
  } else if (requestId) {
    const req = rt.streamRequests[requestId] || {
      requestId,
      active: false,
      startedAt: ts,
      lastByteAt: ts,
      bytesTotal: 0,
      transport: event.transport || null
    };
    if (type === "generation_request_start") {
      req.active = true;
      req.startedAt = ts;
      req.lastByteAt = ts;
      req.bytesTotal = 0;
      req.terminal = null;
      rt.failureCandidate = null;
      rt.needsAttention = null;
      rt.statusText = "Byte probe attached to the live generation stream";
    } else if (type === "generation_headers") {
      req.active = true;
      req.status = Number(event.status || 0);
    } else if (type === "generation_stream_activity") {
      if (req.endedAt || req.supersededAt) return { ok: true, ignored: true };
      req.active = true;
      req.lastByteAt = ts;
      req.bytesTotal = Math.max(Number(req.bytesTotal || 0), Number(event.bytesTotal || 0));
      req.terminal = event.terminal || req.terminal || null;
      rt.lastStreamActivityAt = ts;
      rt.lastStreamBytesTotal = req.bytesTotal;
      rt.lastStreamRequestId = requestId;
      rt.statusText = "Generation stream is live; response bytes are still arriving";
    } else if (type.startsWith("generation_semantic_")) {
      if (req.endedAt || req.supersededAt) return { ok: true, ignored: true };
      req.semanticCoverage = true;
      if (type === "generation_semantic_activity") rt.lastSemanticAt = ts;
      if (type === "generation_semantic_terminal") {
        req.terminal = event.terminal || null;
        req.active = false; req.endedAt = ts;
      }
    } else if (type === "generation_stream_end") {
      req.active = false;
      req.endedAt = ts;
      req.lastByteAt = ts;
      req.bytesTotal = Math.max(Number(req.bytesTotal || 0), Number(event.bytesTotal || 0));
      req.terminal = event.terminal || null;
      rt.lastStreamActivityAt = ts;
      rt.lastStreamBytesTotal = req.bytesTotal;
      rt.lastStreamRequestId = requestId;
    } else if (type === "generation_stream_unreadable" ||
               type === "generation_stream_error" ||
               type === "generation_request_error" ||
               type === "generation_abort") {
      req.active = false;
      req.endedAt = ts;
      req.probeError = event.errorName || type;
    }
    rt.streamRequests[requestId] = req;
  }

  for (const [id, req] of Object.entries(rt.streamRequests)) {
    if (!req.active && now - Number(req.endedAt || req.startedAt || now) > 60000) {
      delete rt.streamRequests[id];
    }
  }
  rt.lastEventAt = now;
  await saveRuntime(rt);
  await syncHardDeadline();
  if (type.startsWith("generation_semantic_")) {
    await supervisorEvent(type === "generation_semantic_terminal" ? "semantic_terminal" :
      type === "generation_semantic_activity" ? "semantic_activity" : "semantic_coverage", {
      tabId: tab.id, requestId, terminal: event.terminal || null, eventType: event.eventType || null
    });
  } else if (type === "generation_stream_activity") {
    void supervisorEvent("stream_activity", {
      tabId: tab.id,
      requestId,
      bytesTotal: Number(event.bytesTotal || 0),
      bytesDelta: Number(event.bytesDelta || 0)
    });
  } else if (type === "generation_request_start") {
    await supervisorEvent("stream_start", { tabId: tab.id, requestId });
  } else if (type === "generation_stream_end") {
    void supervisorEvent("stream_end", {
      tabId: tab.id,
      requestId,
      bytesTotal: Number(event.bytesTotal || 0),
      terminal: event.terminal || null
    });
  } else if (type === "probe_ready" || (type === "page_heartbeat" && !wasProbeReady)) {
    void supervisorEvent("probe_ready", { tabId: tab.id, probeVersion: Number(event.version) || 2 });
  }
  return { ok: true };
}

async function confirmStoppedTransport(tabId, stop, issuedAt) {
  const deadline = Date.now() + 12000;
  let quietSince = null;
  while (Date.now() <= deadline) {
    const data = await state();
    if (data.monitorState !== "running" || data.monitorTabId !== tabId) {
      throw Error("Monitoring changed during Stop confirmation");
    }
    await transportQueue;
    const sample = await chrome.tabs.sendMessage(tabId, { type: "STOP_GENERATION_STATUS" });
    if (!sample || sample.protocol !== 1 || sample.href !== stop.href) {
      throw Error("Old conversation observer could not verify Stop");
    }
    const rt = await runtime();
    const requests = activeRequests(rt).length;
    const streams = activeStreamRequests(rt).length;
    if (!sample.stopVisible && sample.idleUi && requests === 0 && streams === 0) {
      if (quietSince === null) quietSince = Date.now();
      if (Date.now() - quietSince >= 1500) {
        const proof = { ...stop, checkedAt: Date.now(), stopVisible: false, idleUi: true,
          activeRequests: requests, activeStreamRequests: streams, transportQuietMs: Date.now() - quietSince };
        if (!globalThis.EditFlowStopGate.validStopProof(proof, stop.href, Date.now(), issuedAt)) {
          throw Error("Stop proof was incomplete or stale");
        }
        return proof;
      }
    } else { quietSince = null; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw Error("Old generation UI or transport remains active; no replacement created");
}

let handoffInFlight = false;
async function handoff(tabId, reason, handoffId) {
  if (handoffInFlight || !handoffId) return;
  handoffInFlight = true;
  let freshTab = null;
  let committedHandoff = false;
  try {
    const data = await state();
    if (data.monitorState !== "running" || data.monitorTabId !== tabId) return;
    const permit = await supervisorPost("/handoff/prepare", { tabId, reason, handoffId });
    if (!permit || !permit.ok) return;
    if (!(await ensureContentScript(tabId))) throw Error("Current Stop observer could not attach");
    const rt = await runtime();
    // Missing Stop is not proof of cancellation. Require stable idle UI and
    // closure of every tracked generation stream before opening another tab.
    const stop = await chrome.tabs.sendMessage(tabId, { type: "STOP_GENERATION_TERMINAL", expectedHref: permit.sourceUrl });
    if (!stop || stop.protocol !== 1 || stop.stopped !== true || stop.href !== permit.sourceUrl) {
      throw Error("Old generation was not confirmed stopped");
    }
    const proof = await confirmStoppedTransport(tabId, stop, permit.issuedAt);
    const receipt = await supervisorPost("/handoff/stopped", { tabId, handoffId, proof });
    if (!receipt || !receipt.ok || !receipt.stopReceiptId) throw Error("Supervisor rejected Stop confirmation");
    const current = await state();
    if (current.monitorState !== "running" || current.monitorTabId !== tabId) return;
    freshTab = await chrome.tabs.create({ url: "https://chatgpt.com/", active: false });
    const committed = await supervisorPost("/handoff/commit", {
      handoffId, tabId, targetTabId: freshTab.id, stopReceiptId: receipt.stopReceiptId
    });
    if (!committed || !committed.ok) throw Error("Checkpoint handoff commit was rejected");
    committedHandoff = true;
    await restoreTab(data);
    await storeState({ monitorState: "busy", monitorTabId: freshTab.id,
      monitorTabWasAutoDiscardable: freshTab.autoDiscardable !== false,
      watchdogRuntime: freshRuntime({ handoffCount: Number(rt.handoffCount || 0) + 1,
        lastHandoffAt: Date.now(), lastHandoffReason: reason, statusText: "Checkpoint committed; sending continuation" }) });
    await chrome.tabs.update(freshTab.id, { autoDiscardable: false, active: true });
    if (!(await waitForChatTabReady(freshTab.id, 20000)) || !(await ensureContentScript(freshTab.id))) {
      throw Error("Fresh chat observer could not attach");
    }
    const reply = await chrome.tabs.sendMessage(freshTab.id, {
      type: "NETWORK_WATCHDOG_FRESH_TAB_CONTINUE", reason, prompt: committed.prompt
    });
    if (!reply || reply.received !== true) throw Error("Continuation was not accepted");
    await supervisorEvent("chain_ack", { tabId: freshTab.id, handoffId, reason });
  } catch (error) {
    if (freshTab && !committedHandoff) {
      try { await chrome.tabs.remove(freshTab.id); } catch (_) {}
    }
    const rt = await runtime();
    rt.needsAttention = String(error && error.message || error);
    rt.statusText = "Handoff paused: " + rt.needsAttention;
    await saveRuntime(rt);
    await supervisorEvent("chain_failed", { tabId: freshTab ? freshTab.id : tabId, handoffId, error: rt.needsAttention });
    const current = await state();
    if ((current.monitorState === "running" || current.monitorState === "busy") &&
        (current.monitorTabId === tabId || current.monitorTabId === (freshTab && freshTab.id))) {
      await storeState({ monitorState: "paused" });
    }
  } finally { handoffInFlight = false; }
}

async function evaluate() {
  const data = await state();
  if (data.monitorState !== "running" || !Number.isInteger(data.monitorTabId)) return;
  if (!(await ensureContentScript(data.monitorTabId))) return;
  // Ask the owning page for fresh observations. Alarms never kill a chat.
  try { await chrome.tabs.sendMessage(data.monitorTabId, { type: "WATCHDOG_SAMPLE_NOW" }); } catch (_) {}
}

chrome.webRequest.onBeforeRequest.addListener(
  details => { void serialTransport(() => onBefore(details)); },
  { urls: ["https://chatgpt.com/*", "https://chat.openai.com/*"] }
);
chrome.webRequest.onHeadersReceived.addListener(
  details => { void serialTransport(() => onHeaders(details)); },
  { urls: ["https://chatgpt.com/*", "https://chat.openai.com/*"] },
  ["responseHeaders"]
);
chrome.webRequest.onCompleted.addListener(
  details => { void serialTransport(() => onCompleted(details)); },
  { urls: ["https://chatgpt.com/*", "https://chat.openai.com/*"] },
  ["responseHeaders"]
);
chrome.webRequest.onErrorOccurred.addListener(
  details => { void serialTransport(() => onError(details)); },
  { urls: ["https://chatgpt.com/*", "https://chat.openai.com/*"] }
);

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) void evaluate();
  if (alarm.name === HARD_ALARM) {
    void evaluate().then(() => syncHardDeadline()).catch(() => {});
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || (!changes.monitorState && !changes.monitorTabId && !changes.hardOpenRequestSeconds)) return;
  if (changes.monitorState && ["paused", "stopped"].includes(changes.monitorState.newValue)) {
    void supervisorEvent("monitor_inactive", { monitorState: changes.monitorState.newValue });
  }
  void syncAlarm();
  void syncHardDeadline();
  void state().then(async data => {
    if (data.monitorState === "running" && Number.isInteger(data.monitorTabId)) {
      if (changes.monitorState || changes.monitorTabId) {
        await supervisorEvent("practice_arm", { tabId: data.monitorTabId, source: "explicit-monitor-target" });
      }
      return ensureContentScript(data.monitorTabId);
    }
  }).catch(() => {});
});

chrome.tabs.onRemoved.addListener(tabId => {
  state().then(data => {
    if (data.monitorTabId === tabId) return stopMonitor();
  }).catch(() => {});
});

async function handlePageHeartbeat(message, sender) {
  const tab = sender && sender.tab;
  if (!tab || !Number.isInteger(tab.id) || !isChatGptUrl(tab.url)) {
    return { ok: false, error: "invalid_chatgpt_tab" };
  }

  const data = await state();
  if (data.monitorTabId !== tab.id) return { ok: true, ignored: true };
  const rt = await runtime();
  const uiFailureSignal = String(message.uiFailureSignal || "").trim() || null;
  const assistantFingerprint = String(message.assistantFingerprint || "").trim() || null;
  const assistantTextLength = Math.max(0, Number(message.assistantTextLength) || 0);
  const thinkingSignal = String(message.thinkingSignal || "").trim() || null;
  if (assistantFingerprint && assistantFingerprint !== rt.lastAssistantFingerprint) {
    rt.lastAssistantFingerprint = assistantFingerprint;
    rt.lastAssistantTextLength = assistantTextLength;
    rt.lastMeaningfulUiProgressAt = Date.now();
    rt.statusText = "Visible ChatGPT/tool progress advanced; watchdog timer refreshed";
    await saveRuntime(rt);
  } else if (thinkingSignal !== rt.lastThinkingSignal) {
    rt.lastThinkingSignal = thinkingSignal;
    await saveRuntime(rt);
  }

  // Never let a stale UI banner invalidate real network liveness. ChatGPT can
  // leave "stream cache expired" or an interruption banner mounted while a
  // newer response is healthy. UI failure text is actionable only when there
  // is no active generation request, stream, or Stop control.
  if (uiFailureSignal &&
      data.monitorTabId === tab.id &&
      (data.monitorState === "running" || data.monitorState === "busy")) {
    const transportLive =
      activeRequests(rt).length > 0 || activeStreamRequests(rt).length > 0;
    rt.failureCandidate = null;
    rt.statusText = transportLive
      ? "Stale UI failure banner ignored because generation transport is live"
      : "Terminal ChatGPT UI failure detected with no live generation transport: " + uiFailureSignal;
    await saveRuntime(rt);
  }

  const active = activeRequests(rt);
  const stream = streamSnapshot(rt);

  const oldestStartedAt = active.length
    ? Math.min(...active.map(req => Number(req.startedAt || Date.now())))
    : null;

  const reply = await supervisorPost("/heartbeat", {
    tabId: tab.id,
    tabActive: tab.active === true,
    isTarget: data.monitorTabId === tab.id,
    monitorState: data.monitorState,
    activeRequests: active.length,
    oldestRequestAgeMs: oldestStartedAt ? Date.now() - oldestStartedAt : 0,
    hardOpenRequestSeconds: Number(data.hardOpenRequestSeconds) || 60,
    streamActiveRequests: stream.active.length,
    streamLastActivityAgeMs: stream.ageMs,
    streamBytesTotal: stream.bytesTotal,
    streamLastActivityAt: stream.lastActivityAt,
    probeReadyAt: Number(rt.probeReadyAt) || null,
    uiFailureSignal: message.uiFailureSignal || null,
    practiceCommandActive: !!message.practiceCommandActive,
    stopVisible: !!message.stopVisible,
    stopProtocol: Number(message.stopProtocol) || null,
    stopClickable: message.stopClickable === true,
    idleUi: message.idleUi === true,
    manualStopUntil: Number(rt.manualStopUntil || 0),
    assistantCount: Number(message.assistantCount) || 0,
    assistantFingerprint,
    assistantTextLength,
    thinkingSignal,
    lastDomMutationAt: Number(message.lastDomMutationAt) || null,
    url: message.href || tab.url,
    observedAt: Number(message.observedAt) || Date.now(),
    extensionVersion: chrome.runtime.getManifest().version
  });

  if (reply && reply.phase) {
    const latest = await runtime();
    const labels = { PROCESSING: "Processing: response activity is continuing", WAITING: "Waiting: allowing reasoning or active tool work",
      SUSPECT: "Possible stall: verifying continued silence", STALLED: "Stall confirmed", COMPLETED: "Response completed",
      VERIFYING: "Verifying response failure", TERMINAL: "Response failure confirmed", PAUSED: "Monitoring paused",
      OBSERVER_OFFLINE: "Monitor unavailable: repairing observation", BLOCKED: "Automatic restarts paused; diagnosis needed" };
    latest.statusText = labels[reply.phase] || "Observing session activity";
    await saveRuntime(latest);
  }
  if (!reply || !reply.command || reply.command === "NONE") {
    return { ok: true, supervisor: !!reply, command: "NONE" };
  }

  if (reply.command === "STOP") {
    if (data.monitorTabId === tab.id) await stopMonitor();
    return { ok: true, supervisor: true, command: "STOP" };
  }

  if (reply.command === "ARM_ONLY") {
    if (tab.active !== true) return { ok: true, ignored: true, command: reply.command };
    const armed = await armPracticeTab(tab);
    return armed.ok
      ? { ok: true, supervisor: true, command: reply.command }
      : armed;
  }

  if (reply.command === "ARM_AND_CHAIN") {
    if (tab.active !== true) return { ok: true, ignored: true, command: reply.command };
    const armed = await armPracticeTab(tab);
    if (!armed.ok) return armed;
    await handoff(tab.id, reply.reason || "monitor_recovery", reply.handoffId);
    return { ok: true, supervisor: true, command: reply.command };
  }

  if (reply.command === "CHAIN" && data.monitorTabId === tab.id) {
    await handoff(tab.id, reply.reason || "continue", reply.handoffId);
    return { ok: true, supervisor: true, command: reply.command };
  }

  return { ok: true, supervisor: true, command: reply.command, ignored: true };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message && message.type === "IS_TARGET_TAB") {
    state().then(data => respond({
      isTarget: Number.isInteger(sender.tab && sender.tab.id) &&
        sender.tab.id === data.monitorTabId
    })).catch(() => respond({ isTarget: false }));
    return true;
  }

  if (message && message.type === "PRODUCTION_PROBE_EVENT") {
    serialTransport(() => onProbeEvent(message.event || {}, sender))
      .then(result => respond(result))
      .catch(error => respond({ ok: false, error: String(error) }));
    return true;
  }

  if (message && message.type === "PAGE_HEARTBEAT") {
    handlePageHeartbeat(message, sender)
      .then(result => respond(result))
      .catch(error => respond({ ok: false, error: String(error) }));
    return true;
  }

  if (message && message.type === "PRACTICE_SESSION_ACTIVE") {
    if (!sender.tab || sender.tab.active !== true) {
      respond({ ok: false, ignored: true, error: "Inactive historical ChatGPT tab ignored." });
      return;
    }
    (async () => {
      const result = await armPracticeTab(sender.tab);
      if (result && result.ok) {
        await supervisorEvent("practice_arm", {
          tabId: sender.tab.id,
          source: message.source || "practice-command",
          conversationUrl: message.conversationUrl || sender.tab.url
        });
      }
      respond(result);
    })().catch(error => respond({ ok: false, error: String(error) }));
    return true;
  }

  if (message && message.type === "USER_STOP_INTENT") {
    state().then(async data => {
      if (!sender.tab || data.monitorTabId !== sender.tab.id) return;
      const rt = await runtime();
      rt.manualStopUntil = Date.now() + 30000;
      rt.failureCandidate = null;
      rt.statusText = "Manual Stop detected; monitor paused until Start";
      await saveRuntime(rt);
      await storeState({ monitorState: "paused" });
    }).then(() => respond({ ok: true })).catch(() => respond({ ok: false }));
    return true;
  }

  if (message && message.type === "HANDOFF_SENT") {
    void supervisorEvent("chain_sent", {
      tabId: sender.tab && sender.tab.id || null,
      conversationUrl: message.conversationUrl || null
    });
    respond({ ok: true });
    return;
  }

  if (message && message.type === "HANDOFF_FAILED") {
    void supervisorEvent("chain_failed", {
      tabId: sender.tab && sender.tab.id || null,
      error: message.error || "handoff_failed",
      conversationUrl: message.conversationUrl || null
    });
    respond({ ok: true });
    return;
  }

  if (message && (message.type === "PRACTICE_COMPLETED" ||
                  message.type === "PRACTICE_CANCELLED")) {
    (async () => {
      await supervisorEvent("terminal", {
        terminalType: message.type,
        tabId: sender.tab && sender.tab.id || null
      });
      await stopMonitor();
      respond({ ok: true });
    })().catch(error => respond({ ok: false, error: String(error) }));
    return true;
  }
});

async function initialize() {
  await supervisorEvent("extension_loaded", {});
  await chrome.alarms.clear("phrase-monitor-scan");
  await chrome.alarms.clear("editflow-practice-status-poll");
  await chrome.alarms.clear(HARD_ALARM);
  try {
    const tabs = await chrome.tabs.query({
      url: ["https://chatgpt.com/*", "https://chat.openai.com/*"]
    });
    for (const tab of tabs) {
      if (Number.isInteger(tab.id)) await ensureContentScript(tab.id);
    }
  } catch (_) {}
  const data = await state();
  await chrome.storage.local.remove([
    "rules", "softStallSeconds", "replacementAllowedSeconds",
    "lastPracticeSessionId", "lastHandledTerminalSessionId"
  ]);

  if (data.runtimeVersion !== chrome.runtime.getManifest().version) {
    await storeState({
      runtimeVersion: chrome.runtime.getManifest().version,
      hardOpenRequestSeconds: 60,
      watchdogRuntime: freshRuntime({
        statusText: "Production Watchdog " + chrome.runtime.getManifest().version + " loaded; semantic liveness and verified checkpoint handoff ready"
      })
    });
  }

  if ((data.monitorState === "running" || data.monitorState === "busy") &&
      Number.isInteger(data.monitorTabId)) {
    let tab = null;
    try { tab = await chrome.tabs.get(data.monitorTabId); } catch (_) {}
    if (tab && isChatGptUrl(tab.url)) {
      // Service-worker reloads can happen during a handoff. "busy" is not a
      // terminal user choice, so recover it to running instead of silently
      // disabling the watchdog.
      if (data.monitorState === "busy") {
        await storeState({ monitorState: "running" });
      }
      await ensureContentScript(tab.id);
      await syncAlarm();
      return;
    }
  }

  if (data.monitorState === "paused") {
    await chrome.alarms.clear(ALARM);
    return;
  }

  await storeState({
    monitorState: "stopped",
    monitorTabId: null,
    monitorTabWasAutoDiscardable: true
  });
  await chrome.alarms.clear(ALARM);
}

chrome.runtime.onInstalled.addListener(() => { void initialize(); });
chrome.runtime.onStartup.addListener(() => { void initialize(); });
void initialize().catch(console.warn);
