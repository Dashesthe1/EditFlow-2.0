"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { POLICY, evaluateLiveness } = require("./liveness.js");
const { classify, createParser } = require("./stream-events.js");
const { stopAndVerify, validStopProof } = require("./stop-gate.js");
const start = 1000000;
const base = { enabled: true, observerAt: start, startedAt: start,
  semanticAt: start, activeRequests: 1, streamRequests: 1, stopVisible: true, semanticCoverage: true };
const at = (ms, patch = {}) => ({ ...base, observerAt: start + ms, ...patch });

test("recorded 90–92s cutoffs never terminate active reasoning", () => {
  for (const ms of [90008, 91038, 91999]) {
    const r = evaluateLiveness({}, at(ms, { streamAt: start + ms - 341 }), start + ms);
    assert.equal(r.action, "NONE");
  }
});
test("fresh semantic processing remains live after 40 minutes", () => {
  const now = start + 40 * 60000;
  assert.equal(evaluateLiveness({}, at(now - start, { semanticAt: now - 1000 }), now).phase, "PROCESSING");
});
test("fully silent generation needs 1 minute plus 2 minutes confirmation", () => {
  assert.equal(POLICY.quietMs, 60000);
  assert.equal(POLICY.confirmMs, 120000);
  const first = evaluateLiveness({}, at(POLICY.quietMs), start + POLICY.quietMs);
  assert.equal(first.phase, "SUSPECT");
  const early = evaluateLiveness(first.next, at(POLICY.quietMs + POLICY.confirmMs - 1), start + POLICY.quietMs + POLICY.confirmMs - 1);
  assert.equal(early.action, "NONE");
  const last = evaluateLiveness(first.next, at(POLICY.quietMs + POLICY.confirmMs), start + POLICY.quietMs + POLICY.confirmMs);
  assert.equal(last.action, "HANDOFF");
});
test("protocol keepalive bytes do not erase a confirmed silent stall", () => {
  const now = start + POLICY.quietMs;
  const a = evaluateLiveness({}, at(POLICY.quietMs, { streamAt: now }), now);
  const b = evaluateLiveness(a.next, at(POLICY.quietMs + POLICY.confirmMs, { streamAt: now + POLICY.confirmMs }), now + POLICY.confirmMs);
  assert.equal(b.action, "HANDOFF");
});
test("unsupported protocol with fresh traffic remains uncertain", () => {
  const now = start + 30 * 60000;
  assert.equal(evaluateLiveness({}, at(now - start, { semanticCoverage: false, streamAt: now }), now).action, "NONE");
});
test("new processing cancels suspicion", () => {
  const now = start + POLICY.quietMs;
  const a = evaluateLiveness({}, at(POLICY.quietMs), now);
  const b = evaluateLiveness(a.next, at(POLICY.quietMs + 10000, { semanticAt: now + 10000 }), now + 10000);
  assert.equal(b.next.suspectAt, 0);
  assert.equal(b.action, "NONE");
});
test("missing observer permits repair, never termination", () => {
  const r = evaluateLiveness({ suspectAt: start }, at(3600000, { observerAt: start }), start + 3600000);
  assert.equal(r.phase, "OBSERVER_OFFLINE");
  assert.equal(r.action, "NONE");
});
test("active AE/controller lease and manual Stop protect the session", () => {
  for (const key of ["leaseUntil", "manualStopUntil"]) {
    const now = start + 3600000;
    assert.equal(evaluateLiveness({ suspectAt: start }, at(now - start, { [key]: now + 10000 }), now).action, "NONE");
  }
});
test("terminal banner cannot override live processing", () => {
  const now = start + 100000;
  assert.equal(evaluateLiveness({}, at(now - start, { terminal: "stream_cache_expired", semanticAt: now }), now).action, "NONE");
});
test("explicit terminal failure is reconfirmed while idle", () => {
  const patch = { activeRequests: 0, streamRequests: 0, stopVisible: false, terminal: "generation_failed" };
  const a = evaluateLiveness({}, at(60000, patch), start + 60000);
  assert.equal(a.phase, "VERIFYING");
  assert.equal(evaluateLiveness(a.next, at(75000, patch), start + 75000).action, "HANDOFF");
});
test("auth and quota failures do not trigger restart storms", () => {
  for (const blocked of ["authentication_required", "rate_limited"]) {
    assert.equal(evaluateLiveness({}, at(600000, { blocked }), start + 600000).action, "NONE");
  }
});
test("verified completion requires stopped UI and no live generation", () => {
  assert.equal(evaluateLiveness({}, at(60000, { completedAt: start + 59000 }), start + 60000).action, "NONE");
  assert.equal(evaluateLiveness({}, at(60000, { completedAt: start + 59000, stopVisible: false, activeRequests: 0, streamRequests: 0 }), start + 60000).action, "HANDOFF");
});
test("SSE parser handles split CRLF frames, filters ping and padding, retains deltas", () => {
  const seen = [];
  const parse = createParser(e => seen.push(e));
  parse('event: ping\r\ndata: {"type":"ping","timestamp":1}\r');
  parse('\n\r\ndata: {"type":"response.output_text.delta","delta":"A","obfuscation":"123"}\n\n');
  parse('data: {"type":"response.output_text.delta","delta":"A","obfuscation":"456"}\n\n');
  parse('data: [DONE]\n\n');
  assert.equal(seen.filter(e => e.fingerprint).length, 1);
  assert.equal(seen.filter(e => e.terminal).length, 1);
  assert.equal(seen.filter(e => e.coverage).length, 1);
});
test("message boundaries and tool results are not generation completion", () => {
  for (const obj of [ {type: "message_end"}, {type: "tool_result", content: "response.completed [DONE]"}, {message: {status: "finished_successfully"}} ]) {
    assert.equal(classify("", JSON.stringify(obj)).terminal, undefined);
  }
  assert.equal(classify("", JSON.stringify({ type: "response.failed" })).terminal, "failure");
});
test("unrecognized wire data does not falsely claim semantic coverage", () => {
  const seen = []; const parse = createParser(e => seen.push(e));
  parse('data: opaque-wire-payload\n\n');
  assert.equal(seen.some(e => e.coverage), false);
  assert.equal(seen.some(e => e.uncertain), true);
});

function supervisorHarness() {
  let now = start;
  const assignment = { mode: "PRACTICE", assignmentId: "assignment-1", sessionId: "session-1", status: "RUNNING", createdAt: "2026-01-01T00:00:00Z" };
  const copies = [];
  const fakeFs = { readFileSync: () => JSON.stringify({ assignments: [assignment] }), writeFileSync() {}, renameSync() {}, appendFileSync() {}, mkdirSync() {}, readdirSync: () => [], copyFileSync: (...args) => copies.push(args) };
  const context = vm.createContext({ require: name => name === "fs" ? fakeFs : name === "./liveness.js" ? require("./liveness.js") : require(name), __dirname, process, console, URL, Date: class extends Date { static now() { return now; } } });
  const code = fs.readFileSync(path.join(__dirname, "supervisor.js"), "utf8").split("\nloadState();")[0];
  vm.runInContext(code + '\nthis.api = { commandForHeartbeat, onEvent, prepareHandoff, recordStopped, commitHandoff, supervisorTick, validateHandoff, prepareMissingTab, validateOwnerRefresh, readPractice, get: () => runtime };', context);
  const api = context.api;
  api.onEvent({ type: "practice_arm", tabId: 1 });
  api.onEvent({ type: "generation_start", tabId: 1, requestId: "network-1", ts: start });
  return { api, assignment, copies, time: n => { now = n; }, heartbeat: patch => api.commandForHeartbeat({ tabId: 1, url: "https://chatgpt.com/c/test", isTarget: true, practiceCommandActive: true, monitorState: "running", activeRequests: 1, streamActiveRequests: 1, stopVisible: true, ...patch }, { ...api.readPractice(), ok: true, active: true, assignmentId: "assignment-1", sessionId: "session-1", status: "RUNNING" }) };
}
test("unrelated tabs and old network failures never alter the owner", () => {
  const h = supervisorHarness();
  h.time(start + 100000);
  h.heartbeat({ tabId: 2, isTarget: false });
  assert.equal(h.api.get().lastTabId, 1);
  h.api.onEvent({ type: "generation_error", tabId: 2, requestId: "network-1" });
  h.api.onEvent({ type: "generation_error", tabId: 1, requestId: "old-network" });
  assert.equal(h.api.get().lastGenerationOutcome, "running");
});
test("supervisor protects reasoning in a long session using semantic events", () => {
  const h = supervisorHarness();
  h.api.onEvent({ type: "stream_start", tabId: 1, requestId: "stream-1" });
  h.time(start + 3600000);
  h.api.onEvent({ type: "semantic_activity", tabId: 1, requestId: "stream-1" });
  assert.equal(h.heartbeat({}).command, "NONE");
});
test("HTTP 200 stream closure alone cannot replace a still-processing chat", () => {
  const h = supervisorHarness();
  h.api.onEvent({ type: "generation_end", tabId: 1, requestId: "network-1", success: true, status: 200 });
  h.time(start + 91000);
  assert.equal(h.heartbeat({}).command, "NONE");
});
test("Pause cancels pending handoff authorization", () => {
  const h = supervisorHarness();
  h.time(start + 600000); h.heartbeat({});
  h.time(start + 720000); const command = h.heartbeat({});
  assert.equal(command.command, "CHAIN");
  h.api.onEvent({ type: "monitor_inactive", monitorState: "paused" });
  assert.equal(h.api.prepareHandoff({ tabId: 1, handoffId: command.handoffId }).ok, false);
});
test("explicitly selecting a monitor target rebinds ownership", () => {
  const h = supervisorHarness();
  h.api.onEvent({ type: "monitor_inactive", monitorState: "stopped" });
  h.api.onEvent({ type: "practice_arm", tabId: 3, source: "explicit-monitor-target" });
  const reply = h.heartbeat({ tabId: 3 });
  assert.notEqual(reply.reason, "owner_tab_mismatch");
  assert.equal(h.api.get().lastTabId, 3);
});
test("handoff snapshots before commit; Stop proof and unchanged assignment are required", () => {
  const h = supervisorHarness();
  h.time(start + 600000); h.heartbeat({});
  h.time(start + 720000); const command = h.heartbeat({});
  assert.equal(command.command, "CHAIN");
  const permit = h.api.prepareHandoff({ tabId: 1, handoffId: command.handoffId });
  assert.equal(permit.ok, true);
  assert.equal(h.copies.length, 1);
  assert.match(permit.prompt, /assignment-1.*session-1/);
  assert.equal(h.api.commitHandoff({ tabId: 1, handoffId: command.handoffId, targetTabId: 2, stopped: false }).ok, false);
  h.assignment.cancelRequestedAt = "now";
  assert.equal(h.api.commitHandoff({ tabId: 1, handoffId: command.handoffId, targetTabId: 2, stopped: true }).ok, false);
  h.assignment.cancelRequestedAt = null;
  h.time(start + 723000);
  const receipt = h.api.recordStopped({ tabId: 1, handoffId: command.handoffId,
    proof: stopProof(start + 720000, start + 723000) });
  assert.equal(receipt.ok, true);
  assert.equal(h.api.commitHandoff({ tabId: 1, handoffId: command.handoffId, targetTabId: 2,
    stopReceiptId: receipt.stopReceiptId }).ok, true);
  assert.equal(h.api.get().lastTabId, 2);
});
test("three no-progress restarts apply temporary backoff and resume", () => {
  const h = supervisorHarness();
  h.api.get().handoffHistory = [10000, 20000, 30000].map(delta => ({at: start + delta}));
  h.time(start + 600000); h.heartbeat({});
  h.time(start + 720000);
  const decision = h.heartbeat({});
  assert.equal(decision.command, "NONE");
  assert.equal(decision.reason, "restart_backoff_no_task_progress");
  h.time(start + 839999);
  assert.equal(h.heartbeat({}).command, "NONE");
  h.time(start + 840000);
  assert.equal(h.heartbeat({}).command, "CHAIN");
});

function browserHarness(stopOK = true, options = {}) {
  let now = start;
  let storage = { monitorState: "running", monitorTabId: 1, watchdogRuntime: { requests: {}, streamRequests: {} } };
  if (options.monitorPaused) storage.monitorState = "paused";
  if (options.streamActive) storage.watchdogRuntime.streamRequests.main = { active: true };
  const actions = [];
  const event = { addListener() {} };
  const chrome = { runtime: { getManifest: () => ({version: "2.6.3"}), onMessage: event },
    storage: { local: { get: async defaults => ({...defaults, ...structuredClone(storage)}),
      set: async values => { storage = {...storage, ...structuredClone(values)}; }, remove: async () => {} }, onChanged: event },
    alarms: { clear: async () => {}, create: async () => {}, onAlarm: event },
    scripting: { executeScript: async () => [] },
    tabs: { get: async id => ({id, url: options.tabUrl || "https://chatgpt.com/", status: "complete"}),
      query: async () => [{id: 1, url: "https://chatgpt.com/"}], update: async () => {},
      reload: async () => { actions.push("reload"); if (options.reloadFails) throw Error("reload failed"); },
      create: async () => { actions.push("create"); return { id: 2 }; },
      sendMessage: async (id, message) => {
        actions.push(message.type);
        if (message.type === "STOP_GENERATION_TERMINAL") {
          if (options.pauseDuringStop) storage.monitorState = "paused";
          now += 1500;
          return options.legacyBoolean ? { stopped: true } : { ...stopProof(now - 1500, now), stopped: stopOK };
        }
        if (message.type === "STOP_GENERATION_STATUS") return { protocol: 1,
          href: "https://chatgpt.com/c/test", stopVisible: !!options.stopReappears, idleUi: !options.unknownUi,
          uiFailureSignal: "stream_cache_expired", practiceCommandActive: true };
        if (message.type === "CONTINUATION_STATUS") return { promptPresent: !!options.alreadySent, emptyConversation: !options.alreadySent };
        if (message.type === "NETWORK_WATCHDOG_FRESH_TAB_CONTINUE") return { received: true, sent: !options.sendFails };
        return { ready: true, received: true, stopProtocol: 1, version: "2.6.3" };
      }, onRemoved: event },
    webRequest: { onBeforeRequest: event, onHeadersReceived: event, onCompleted: event, onErrorOccurred: event } };
  const context = vm.createContext({ chrome, console, URL, AbortController, structuredClone,
    EditFlowStopGate: require("./stop-gate.js"), importScripts() {},
    setTimeout: (fn, ms) => { if (ms === 250) { now += ms; Promise.resolve().then(fn); } return 1; },
    clearTimeout() {}, Date: class extends Date { static now() { return now; } },
    fetch: async (url, options) => ({ ok: true, json: async () => { actions.push(url.split("32147")[1]);
      return { ok: !(url.endsWith("/owner-refresh/validate") && options.repairDenied), active: true, assignmentId: "assignment-1", sessionId: "session-1", prompt: "Resume assignment-1", sourceUrl: "https://chatgpt.com/c/test", issuedAt: start, stopReceiptId: "stop-receipt-1" }; } }) });
  const code = fs.readFileSync(path.join(__dirname, "background.js"), "utf8").split("\nchrome.runtime.onInstalled")[0];
  vm.runInContext(code + '\nthis.api = { handoff, handlePageHeartbeat, onProbeEvent, onHeaders, onCompleted, onError, initialize, resumeContinuation, evaluate, repairOwner };', context);
  return { api: context.api, actions, storage: () => storage };
}
test("browser will not create a replacement without verified Stop", async () => {
  const h = browserHarness(false);
  await h.api.handoff(1, "confirmed_multi_signal_silence", "permit-1");
  assert.equal(h.actions.includes("create"), false);
});
test("browser handoff prepares checkpoint then verifies Stop then commits once", async () => {
  const h = browserHarness();
  await Promise.all([h.api.handoff(1, "confirmed_multi_signal_silence", "permit-1"), h.api.handoff(1, "confirmed_multi_signal_silence", "permit-1")]);
  assert.equal(h.actions.filter(x => x === "create").length, 1);
  assert.ok(h.actions.indexOf("/handoff/prepare") < h.actions.indexOf("STOP_GENERATION_TERMINAL"));
  assert.ok(h.actions.indexOf("/handoff/stopped") < h.actions.indexOf("create"));
  assert.ok(h.actions.indexOf("STOP_GENERATION_TERMINAL") < h.actions.indexOf("/handoff/commit"));
  assert.ok(h.actions.indexOf("/handoff/commit") < h.actions.indexOf("NETWORK_WATCHDOG_FRESH_TAB_CONTINUE"));
});
test("non-target page heartbeat does not mutate browser runtime", async () => {
  const h = browserHarness(); const before = JSON.stringify(h.storage());
  await h.api.handlePageHeartbeat({ assistantFingerprint: "foreign" }, {tab: {id: 99, url: "https://chatgpt.com/c/other"}});
  assert.equal(JSON.stringify(h.storage()), before);
});

function stopProof(requestedAt, checkedAt) {
  return { protocol: 1, stopped: true, href: "https://chatgpt.com/c/test", requestedAt, checkedAt,
    clickCount: 1, alreadyIdle: false, stopVisible: false, idleUi: true, stableForMs: 1500,
    activeRequests: 0, activeStreamRequests: 0, transportQuietMs: 1500 };
}

function stopDriver(sampleAt, clickAction = () => {}) {
  let now = start, clicks = 0;
  return { now: () => now, observe: () => ({ href: "https://chatgpt.com/c/test", ...sampleAt(now - start, clicks) }),
    wait: async ms => { now += ms; }, authorized: async () => {},
    click: () => { clicks++; clickAction(); return true; }, clicks: () => clicks };
}

test("Stop gate actually clicks the square and waits for stable idle controls", async () => {
  const driver = stopDriver((ms, clicks) => ({ stopVisible: clicks === 0, clickableStop: true, idleUi: clicks > 0 }));
  const proof = await stopAndVerify(driver);
  assert.equal(driver.clicks(), 1);
  assert.equal(proof.stopped, true);
  assert.equal(proof.alreadyIdle, false);
  assert.ok(proof.stableForMs >= 1500);
});
test("missing Stop selector and unknown UI never imply stopped", async () => {
  const proof = await stopAndVerify(stopDriver(() => ({ stopVisible: false, idleUi: false })));
  assert.equal(proof.stopped, false);
});
test("disabled or ineffective Stop keeps the handoff blocked", async () => {
  for (const clickableStop of [false, true]) {
    const proof = await stopAndVerify(stopDriver(() => ({ stopVisible: true, clickableStop, idleUi: false })));
    assert.equal(proof.stopped, false);
  }
});
test("Stop disappearing briefly then returning resets confirmation", async () => {
  const proof = await stopAndVerify(stopDriver(ms => ({ stopVisible: ms < 250 || ms >= 1000,
    clickableStop: true, idleUi: ms >= 250 && ms < 1000 })));
  assert.equal(proof.stopped, false);
});
test("natural completion needs positive stable idle UI", async () => {
  const proof = await stopAndVerify(stopDriver(() => ({ stopVisible: false, idleUi: true })));
  assert.equal(proof.stopped, true);
  assert.equal(proof.clickCount, 0);
  assert.equal(proof.alreadyIdle, true);
});
test("Stop proof rejects stale, wrong-conversation and still-streaming evidence", () => {
  const proof = stopProof(start, start + 3000);
  assert.equal(validStopProof(proof, proof.href, start + 3000, start), true);
  for (const patch of [{checkedAt: start - 10000}, {href: "https://chatgpt.com/c/other"},
    {activeStreamRequests: 1}, {transportQuietMs: 0}, {idleUi: false}, {requestedAt: start - 1}]) {
    assert.equal(validStopProof({...proof, ...patch}, proof.href, start + 3000, start), false);
  }
});
test("legacy stopped boolean, active cloned stream, returned Stop and lost observer create no tab", async () => {
  for (const options of [{legacyBoolean: true}, {streamActive: true}, {stopReappears: true}, {unknownUi: true}, {pauseDuringStop: true}]) {
    const h = browserHarness(true, options);
    await h.api.handoff(1, "confirmed_multi_signal_silence", "permit-1");
    assert.equal(h.actions.includes("create"), false, JSON.stringify(options));
    assert.equal(h.storage().monitorState, options.pauseDuringStop ? "paused" : "running");
  }
});
test("secondary completion cannot erase a different active main stream", () => {
  const h = supervisorHarness();
  h.api.onEvent({type: "stream_start", tabId: 1, requestId: "short-secondary"});
  h.time(start + 1000);
  h.api.onEvent({type: "semantic_terminal", tabId: 1, requestId: "short-secondary", terminal: "success"});
  h.time(start + 20000);
  h.api.onEvent({type: "stream_activity", tabId: 1, requestId: "long-main", bytesTotal: 5000000});
  assert.equal(h.heartbeat({activeRequests: 0, streamActiveRequests: 1, stopVisible: false}).command, "NONE");
});
test("supervisor rejects commit with only a stopped boolean", () => {
  const h = supervisorHarness();
  h.time(start + 600000); h.heartbeat({});
  h.time(start + 720000); const command = h.heartbeat({});
  h.api.prepareHandoff({tabId: 1, handoffId: command.handoffId});
  assert.equal(h.api.commitHandoff({tabId: 1, handoffId: command.handoffId, targetTabId: 2, stopped: true}).ok, false);
});
test("a new parallel stream does not silently supersede an active old stream", async () => {
  const h = browserHarness(true, {streamActive: true});
  await h.api.onProbeEvent({type: "generation_request_start", requestId: "secondary", ts: start},
    {tab: {id: 1, url: "https://chatgpt.com/c/test"}});
  assert.equal(h.storage().watchdogRuntime.streamRequests.main.active, true);
  assert.equal(h.storage().watchdogRuntime.streamRequests.secondary.active, true);
});

function contentHarness(options = {}) {
  let now = start, stopVisible = !options.missing && !options.idle, idleVisible = !!options.idle, clicks = 0;
  const listeners = {}, sent = [];
  const makeElement = (label, isStop = false) => ({
    isConnected: true, disabled: isStop ? !!options.disabled : true, innerText: "",
    getAttribute: key => key === "aria-label" ? label : key === "data-testid" ? "composer-submit-button" : null,
    getClientRects: () => (isStop ? stopVisible : idleVisible) ? [{}] : [],
    closest: selector => selector.includes("hidden") ? null : selector.includes("button") ? (isStop ? stop : send) : null,
    click() { clicks++; listeners.click?.({target: this});
      if (!options.ineffective) { stopVisible = false; idleVisible = true; } }
  });
  const stop = makeElement(options.label || "Stop", true), send = makeElement(options.idleLabel || "Send prompt");
  const controls = { querySelectorAll: () => [stop, send] };
  const box = { isConnected: true, disabled: false, getClientRects: () => [{}],
    closest: selector => selector.includes("hidden") ? null : controls };
  const doc = { addEventListener: (type, fn) => { listeners[type] = fn; },
    querySelector: selector => selector === "#prompt-textarea" ? box : null,
    querySelectorAll: selector => selector.startsWith("button[") ? [] : [stop, send] };
  const context = vm.createContext({ console, document: doc, window: {addEventListener(){}},
    location: {href: "https://chatgpt.com/c/test"}, EditFlowStopGate: require("./stop-gate.js"),
    getComputedStyle: () => ({display: "block", visibility: "visible"}),
    Date: class extends Date { static now() { return now; } },
    setTimeout: (fn, ms) => { now += ms; Promise.resolve().then(fn); },
    chrome: { storage: {local: {get: async () => ({monitorState: "running"})}},
      runtime: {sendMessage: async msg => {sent.push(msg.type); return {};}} } });
  const code = fs.readFileSync(path.join(__dirname, "content.js"), "utf8").split("\n  const practiceObserver")[0];
  vm.runInContext(code + '\nthis.api = { forceStopGeneration, generationControls };\n})();', context);
  return {api: context.api, sent, clicks: () => clicks};
}
test("production content script detects and clicks accessible Stop square variants", async () => {
  for (const label of ["Stop", "Stop responding", "Stop streaming"]) {
    const h = contentHarness({label});
    const proof = await h.api.forceStopGeneration("https://chatgpt.com/c/test");
    assert.equal(proof.stopped, true, label);
    assert.equal(h.clicks(), 1, label);
    assert.equal(h.sent.includes("USER_STOP_INTENT"), false, "Automated Stop must not masquerade as a user's pause");
  }
});
test("production content script refuses missing, disabled or ineffective Stop", async () => {
  for (const options of [{missing: true}, {disabled: true}, {ineffective: true}]) {
    const h = contentHarness(options);
    assert.equal((await h.api.forceStopGeneration("https://chatgpt.com/c/test")).stopped, false);
  }
});
test("conversation mismatch cancels Stop before any click", async () => {
  const h = contentHarness();
  await assert.rejects(h.api.forceStopGeneration("https://chatgpt.com/c/other"), /conversation changed/);
  assert.equal(h.clicks(), 0);
});
test("extension upgrade preserves a user's paused state and owning tab", async () => {
  const h = browserHarness(true, {monitorPaused: true});
  await h.api.initialize();
  assert.equal(h.storage().monitorState, "paused");
  assert.equal(h.storage().monitorTabId, 1);
  assert.equal(h.storage().hardOpenRequestSeconds, 60);
  assert.equal(h.actions.includes("STOP_GENERATION_TERMINAL"), false);
  assert.equal(h.actions.includes("create"), false);
});

test("supervisor starts suspicion at 60 seconds and waits another 120 before handoff", () => {
  const h = supervisorHarness();
  h.time(start + 59999);
  assert.equal(h.heartbeat({hardOpenRequestSeconds: 60}).phase, "PROCESSING");
  h.time(start + 60000);
  assert.equal(h.heartbeat({hardOpenRequestSeconds: 60}).phase, "SUSPECT");
  h.time(start + 179999);
  assert.equal(h.heartbeat({hardOpenRequestSeconds: 60}).command, "NONE");
  h.time(start + 180000);
  assert.equal(h.heartbeat({hardOpenRequestSeconds: 60}).command, "CHAIN");
});

test("a new stream reconciles a missed network start and clears old semantic coverage", () => {
  const h = supervisorHarness();
  h.api.onEvent({type: "stream_start", tabId: 1, requestId: "old"});
  h.api.onEvent({type: "semantic_terminal", tabId: 1, requestId: "old", terminal: "success"});
  h.time(start + 3600000);
  h.api.onEvent({type: "stream_start", tabId: 1, requestId: "current"});
  assert.equal(h.api.get().lastGenerationStartAt, start + 3600000);
  assert.equal(h.api.get().semanticCoverage, false);
  assert.equal(h.api.get().semanticCompletedAt, 0);
  for (let i = 1; i <= 30; i++) {
    h.time(start + 3600000 + i * 60000);
    h.api.onEvent({type: "stream_activity", tabId: 1, requestId: "current", bytesTotal: i * 10000});
    assert.equal(h.heartbeat({}).command, "NONE");
  }
});
test("old stream semantic and terminal events cannot corrupt a current response", () => {
  const h = supervisorHarness();
  h.time(start + 600000);
  h.api.onEvent({type: "stream_start", tabId: 1, requestId: "current"});
  const before = h.api.get().lastStreamActivityAt;
  h.time(start + 601000);
  h.api.onEvent({type: "semantic_terminal", tabId: 1, requestId: "old", terminal: "failure"});
  h.api.onEvent({type: "stream_end", tabId: 1, requestId: "old", terminal: "failure"});
  assert.equal(h.api.get().lastGenerationOutcome, "running");
  assert.equal(h.api.get().lastStreamActivityAt, before);
});
test("owning page response identity repairs stale running evidence on attachment", () => {
  const h = supervisorHarness();
  h.time(start + 3600000);
  const reply = h.heartbeat({responseKey: "current-user-turn", semanticCoverage: false, streamLastActivityAt: start + 3600000});
  assert.equal(reply.command, "NONE");
  assert.equal(h.api.get().lastGenerationStartAt, start + 3600000);
});
test("new uncertain traffic restarts the complete silence and verification windows", () => {
  const a = evaluateLiveness({}, at(60000), start + 60000);
  const b = evaluateLiveness(a.next, at(200000, {semanticCoverage: false, streamAt: start + 150000}), start + 200000);
  assert.equal(b.action, "NONE");
  assert.equal(b.next.suspectAt, 0);
  const c = evaluateLiveness(b.next, at(210000, {semanticCoverage: false, streamAt: start + 150000}), start + 210000);
  assert.equal(c.phase, "SUSPECT");
  assert.equal(evaluateLiveness(c.next, at(329999, {semanticCoverage: false, streamAt: start + 150000}), start + 329999).action, "NONE");
});
test("progress between throttled samples cancels the previous confirmation", () => {
  const a = evaluateLiveness({}, at(60000), start + 60000);
  const b = evaluateLiveness(a.next, at(240000, {semanticAt: start + 160000}), start + 240000);
  assert.equal(b.action, "NONE");
  assert.equal(b.next.suspectAt, start + 240000);
});
test("new progress revokes a prepared stall before the Stop click", () => {
  const h = supervisorHarness();
  h.time(start + 60000); h.heartbeat({});
  h.time(start + 180000); const c = h.heartbeat({});
  assert.equal(h.api.prepareHandoff({tabId: 1, handoffId: c.handoffId}).ok, true);
  h.time(start + 180001); h.api.onEvent({type: "stream_activity", tabId: 1, requestId: "current", bytesTotal: 1000});
  assert.equal(h.api.validateHandoff({tabId: 1, handoffId: c.handoffId}).ok, false);
});
test("extended thinking is protected even with silent transport", () => {
  const now = start + 3600000;
  assert.equal(evaluateLiveness({suspectAt: start}, at(now-start, {thinkingSignal: "extended_thinking"}), now).action, "NONE");
});
test("failed Stop keeps alarms and monitoring active for recovery", async () => {
  const h = browserHarness(false);
  await h.api.handoff(1, "confirmed_multi_signal_silence", "permit-1");
  assert.equal(h.storage().monitorState, "running");
  assert.ok(h.actions.includes("/event"));
  assert.equal(h.actions.includes("create"), false);
});
test("committed send failure retains the single replacement tab and its prompt", async () => {
  const h = browserHarness(true, {sendFails: true});
  await h.api.handoff(1, "response_complete", "permit-1");
  assert.equal(h.storage().monitorState, "running");
  assert.equal(h.storage().pendingContinuation.tabId, 2);
  assert.equal(h.actions.filter(x => x === "create").length, 1);
  await h.api.resumeContinuation();
  assert.equal(h.actions.filter(x => x === "create").length, 1);
});
test("already accepted continuation is reconciled without sending it twice", async () => {
  const h = browserHarness(true, {alreadySent: true});
  await h.api.handoff(1, "response_complete", "permit-1");
  assert.equal(h.actions.includes("NETWORK_WATCHDOG_FRESH_TAB_CONTINUE"), false);
  assert.equal(h.storage().pendingContinuation, null);
  assert.equal(h.storage().monitorState, "running");
});
test("a failed handoff retries after backoff rather than disarming Practice", () => {
  const h = supervisorHarness();
  h.time(start + 60000); h.heartbeat({});
  h.time(start + 180000); const c = h.heartbeat({});
  h.api.onEvent({type: "chain_failed", tabId: 1, handoffId: c.handoffId});
  assert.equal(h.api.get().chainArmed, true);
  assert.equal(h.heartbeat({}).command, "NONE");
  h.time(start + 190000);
  assert.equal(h.heartbeat({}).command, "CHAIN");
});
test("completion markers cannot disarm a still-running Practice assignment", () => {
  const h = supervisorHarness();
  h.api.onEvent({type: "terminal", tabId: 1, terminalType: "PRACTICE_COMPLETED"});
  assert.equal(h.api.get().chainArmed, true);
});
test("failed assignment remains monitored; durable completion disarms it", () => {
  const h = supervisorHarness();
  h.assignment.status = "FAILED";
  assert.equal(h.api.readPractice().active, true);
  h.assignment.status = "COMPLETED";
  h.api.supervisorTick();
  assert.equal(h.api.get().chainArmed, false);
});
test("semantic terminal does not silently close its transport reader", async () => {
  const h = browserHarness();
  const sender = {tab: {id: 1, url: "https://chatgpt.com/c/test"}};
  await h.api.onProbeEvent({type: "generation_request_start", requestId: "main", ts: start}, sender);
  await h.api.onProbeEvent({type: "generation_semantic_terminal", requestId: "main", terminal: "success", ts: start+1000}, sender);
  assert.equal(h.storage().watchdogRuntime.streamRequests.main.active, true);
  await h.api.onProbeEvent({type: "generation_stream_end", requestId: "main", ts: start+2000}, sender);
  assert.equal(h.storage().watchdogRuntime.streamRequests.main.active, false);
});
test("unrecognized frames after recognized keepalives explicitly mark uncertainty", () => {
  const seen = [], parse = createParser(e => seen.push(e));
  parse('data: {"type":"ping"}\n\n');
  parse('data: new-wire-format\n\n');
  assert.equal(seen.some(e => e.uncertain), true);
});

test("logged 22:09 incident: stale completed generation cannot stop a byte-active current response", () => {
  const h = supervisorHarness(), r = h.api.get();
  Object.assign(r, {lastGenerationStartAt: 1790870519401, lastGenerationOutcome: "failure",
    semanticCoverage: true, lastSemanticAt: 1790870710416, semanticCompletedAt: 1790870711607,
    lastUiProgressAt: 1790870520588, semanticRequestId: "fetch-old"});
  const started = 1790891946331;
  h.time(started);
  h.api.onEvent({type: "stream_start", tabId: 1, requestId: "fetch-current", ts: started});
  for (const ts of [1790892517638, 1790892538263, 1790892554781, 1790892558401]) {
    h.time(ts);
    h.api.onEvent({type: "stream_activity", tabId: 1, requestId: "fetch-current", bytesTotal: 24982055});
    assert.equal(h.heartbeat({}).command, "NONE");
  }
});
test("Stop-caused EOF does not revoke a Stop already clicked under a valid permit", () => {
  const h = supervisorHarness();
  h.time(start + 60000); h.heartbeat({});
  h.time(start + 180000); const c = h.heartbeat({});
  h.api.prepareHandoff({tabId: 1, handoffId: c.handoffId});
  assert.equal(h.api.validateHandoff({tabId: 1, handoffId: c.handoffId, stopClicked: true}).ok, true);
  h.time(start + 180001);
  h.api.onEvent({type: "stream_end", tabId: 1, requestId: "current", bytesTotal: 1000});
  assert.equal(h.api.validateHandoff({tabId: 1, handoffId: c.handoffId, stopClicked: true}).ok, true);
});
test("closed owner tab requires fresh closure evidence and checkpoints before replacement", () => {
  const h = supervisorHarness();
  assert.equal(h.api.prepareMissingTab({tabId: 1}).ok, false);
  h.api.onEvent({type: "owner_tab_closed", tabId: 1});
  const permit = h.api.prepareMissingTab({tabId: 1});
  assert.equal(permit.ok, true);
  assert.equal(h.copies.length, 1);
  assert.equal(h.api.commitHandoff({tabId: 1, targetTabId: 2, handoffId: permit.handoffId, stopReceiptId: permit.stopReceiptId}).ok, true);
  assert.equal(h.api.get().lastTabId, 2);
});
test("unrelated or stale tab closure cannot authorize a replacement", () => {
  const h = supervisorHarness();
  h.api.onEvent({type: "owner_tab_closed", tabId: 99});
  assert.equal(h.api.prepareMissingTab({tabId: 1}).ok, false);
  h.api.onEvent({type: "owner_tab_closed", tabId: 1});
  h.time(start + 5001);
  assert.equal(h.api.prepareMissingTab({tabId: 1}).ok, false);
});

test("missed transport start still continues a stable visibly completed owning response", () => {
  const h = supervisorHarness();
  h.time(start + 3600000);
  h.heartbeat({responseKey: "owning-response", assistantFingerprint: "answer", assistantTextLength: 500,
    stopVisible: false, idleUi: true, activeRequests: 0, streamActiveRequests: 0});
  h.time(start + 3615000);
  assert.equal(h.heartbeat({responseKey: "owning-response", assistantFingerprint: "answer", assistantTextLength: 500,
    stopVisible: false, idleUi: true, activeRequests: 0, streamActiveRequests: 0}).command, "CHAIN");
});

test("maintenance chat is never evaluated or stopped while Practice remains armed", () => {
  const h = supervisorHarness();
  h.time(start + 600000); h.heartbeat({practiceCommandActive: false});
  h.time(start + 720000);
  const reply = h.heartbeat({practiceCommandActive: false});
  assert.equal(reply.command, "NONE");
  assert.equal(reply.reason, "owning_chat_is_not_running_practice");
  assert.equal(h.api.get().chainArmed, true);
  assert.equal(h.api.get().handoff, null);
});

function workModeObservationHarness() {
  const node = (text, visible = true) => ({innerText:text, isConnected:true,
    closest: () => null, getClientRects: () => visible ? [{}] : [], getAttribute: () => null});
  const users = [node('I still think that the Watchdog is malfunctioning', false), node('Continue the practice session with the given raw files to make the finished product.')];
  const assistants = [], activities = [node('Applying effect correction. Working for 2m 5s')];
  const doc = {addEventListener(){}, querySelector:()=>null,
    querySelectorAll: selector => selector === '[data-user-message-bubble]' ? users :
      selector === '[data-markdown-text-style="assistant-message"]' ? assistants :
      selector === '[class*="group/agent-activity"]' ? activities : []};
  const context=vm.createContext({document:doc,window:{addEventListener(){}},location:{href:'https://chatgpt.com/c/practice'},
    Date,console,setTimeout(){},getComputedStyle:()=>({display:'block',visibility:'visible'}),
    chrome:{storage:{local:{get:async()=>({monitorState:'running'})}},runtime:{sendMessage:async()=>({ok:true})}}});
  const code=fs.readFileSync(path.join(__dirname,'content.js'),'utf8').split('\n  const practiceObserver')[0];
  vm.runInContext(code+'\nthis.api={latestUserOutputText,assistantProgressSnapshot,userMessages,isPractice:()=>PRACTICE_COMMAND_RE.test(latestUserOutputText())};\n})();',context);
  return {api:context.api,users,activities,node};
}
test('Work Mode observes the rendered Practice bubble and excludes mounted hidden conversations',()=>{
  const h=workModeObservationHarness();
  assert.equal(h.api.isPractice(),true);
  assert.match(h.api.latestUserOutputText(),/^Continue/);
  assert.equal(h.api.userMessages().length,1);
});
test('Work Mode maintenance request excludes even quoted Practice commands',()=>{
  const h=workModeObservationHarness();
  h.users.splice(0, h.users.length, h.node('Continue the practice session',false),
    h.node('While implementing changes to the watchdog, do not run the quoted Continue the practice session command'));
  assert.equal(h.api.isPractice(),false);
});
test('Work Mode tool progress refreshes the fingerprint but clock-only Working timers do not',()=>{
  const h=workModeObservationHarness(), before=h.api.assistantProgressSnapshot();
  assert.ok(before.textLength>0);
  h.activities[0].innerText='Applying effect correction. Working for 2m 6s';
  assert.equal(h.api.assistantProgressSnapshot().fingerprint,before.fingerprint);
  h.activities[0].innerText='Rendered correction proof. Working for 2m 6s';
  assert.notEqual(h.api.assistantProgressSnapshot().fingerprint,before.fingerprint);
});
test('switching conversations cancels the previous response and Stop permit',()=>{
  const h=supervisorHarness();
  h.time(start+60000);h.heartbeat({});h.time(start+180000);const command=h.heartbeat({});
  h.api.prepareHandoff({tabId:1,handoffId:command.handoffId});
  const reply=h.heartbeat({url:'https://chatgpt.com/c/maintenance',practiceCommandActive:false});
  assert.equal(reply.command,'NONE');
  assert.equal(h.api.get().handoff,null);
  assert.equal(h.api.validateHandoff({tabId:1,handoffId:command.handoffId}).ok,false);
});

test("Work Mode idle voice controls positively verify an already-ended response", async () => {
  for (const idleLabel of ["Start Voice", "Dictate"]) {
    const h=contentHarness({idle:true,idleLabel});
    const proof=await h.api.forceStopGeneration("https://chatgpt.com/c/test");
    assert.equal(proof.stopped,true);
    assert.equal(proof.alreadyIdle,true);
    assert.equal(h.clicks(),0);
  }
});
test("the content Stop guard refuses a non-Practice request before clicking", async () => {
  const h=contentHarness();
  await assert.rejects(h.api.forceStopGeneration("https://chatgpt.com/c/test","permit-1"),/not executing Practice/);
  assert.equal(h.clicks(),0);
});

test("upgrade retires unscoped streams that blocked an idle Practice handoff", async () => {
  const h = browserHarness(true, {streamActive: true});
  await h.api.initialize();
  assert.equal(Object.keys(h.storage().watchdogRuntime.streamRequests).length, 0);
  assert.equal(h.storage().monitorState, "running");
  await h.api.handoff(1, "response_complete", "permit-1");
  assert.equal(h.actions.filter(x => x === "create").length, 1);
});
test("normal worker restart preserves scoped active transport", async () => {
  const h = browserHarness(true, {streamActive: true});
  h.storage().watchdogRuntime.transportSchemaVersion = 4;
  await h.api.initialize();
  assert.equal(h.storage().watchdogRuntime.streamRequests.main.active, true);
});
test("late headers cannot resurrect a request from before conversation attachment", async () => {
  const h = browserHarness();
  await h.api.initialize();
  const detail = {requestId:"obsolete", tabId:1, method:"POST", url:"https://chatgpt.com/backend-api/f/conversation", statusCode:200};
  await h.api.onHeaders(detail);
  await h.api.onCompleted(detail);
  await h.api.onError({...detail, error:"net::ERR_ABORTED"});
  assert.equal(Object.keys(h.storage().watchdogRuntime.requests).length, 0);
});
test("stream origin stays bound to its initial conversation across SPA navigation", async () => {
  const h=browserHarness();
  Object.assign(h.storage().watchdogRuntime, {transportSchemaVersion:4, conversationUrl:"https://chatgpt.com/c/current", scopeChangedAt:start});
  const sender={tab:{id:1,url:"https://chatgpt.com/c/current"}};
  await h.api.onProbeEvent({type:"generation_request_start",requestId:"old",ts:start+100,requestStartedAt:start+100,conversationUrl:"https://chatgpt.com/c/maintenance"},sender);
  await h.api.onProbeEvent({type:"generation_headers",requestId:"orphan",ts:start+100,requestStartedAt:start+100,conversationUrl:sender.tab.url},sender);
  await h.api.onProbeEvent({type:"generation_stream_activity",requestId:"legacy",ts:start+100},sender);
  assert.equal(Object.keys(h.storage().watchdogRuntime.streamRequests).length,0);
  const current={requestId:"current",ts:start+200,requestStartedAt:start+100,conversationUrl:sender.tab.url};
  await h.api.onProbeEvent({...current,type:"generation_request_start"},sender);
  await h.api.onProbeEvent({...current,type:"generation_stream_activity",bytesTotal:500},sender);
  assert.equal(h.storage().watchdogRuntime.streamRequests.current.active,true);
  assert.equal(h.storage().watchdogRuntime.streamRequests.current.bytesTotal,500);
});

test("recorded idle stream-expiry with a renewed controller lease repairs the owner page", () => {
  const patch = { activeRequests: 0, streamRequests: 0, stopVisible: false, idleUi: true,
    terminal: "stream_cache_expired", controllerLeaseUntil: start + 240000 };
  const first = evaluateLiveness({}, at(60000, patch), start + 60000);
  assert.equal(first.phase, "VERIFYING");
  const confirmed = evaluateLiveness(first.next, at(75000, patch), start + 75000);
  assert.equal(confirmed.action, "REPAIR_OWNER");
  assert.equal(confirmed.reason, "expired_ui_controller_reserved");
});
test("owner page repair never overrides active mutation, manual Stop, traffic or recent work", () => {
  const now = start + 75000;
  const patch = { terminal: "stream_cache_expired", controllerLeaseUntil: now + 120000,
    activeRequests: 0, streamRequests: 0, stopVisible: false, idleUi: true };
  for (const extra of [{leaseUntil:now+1000}, {manualStopUntil:now+1000},
    {activeRequests:1}, {streamRequests:1}, {stopVisible:true}, {practiceAt:now}, {aeAt:now}, {semanticAt:now}, {uiAt:now}]) {
    const result = evaluateLiveness({terminalAt:start+60000, terminalKey:patch.terminal}, at(75000,{...patch,...extra}),now);
    assert.equal(result.action,"NONE", JSON.stringify(extra));
  }
});
test("recent artifact progress blocks a premature idle-answer completion handoff", () => {
  const now = start + 60000;
  assert.equal(evaluateLiveness({}, at(60000,{activeRequests:0,streamRequests:0,stopVisible:false,
    completedAt:start+10000,practiceAt:now}),now).action,"NONE");
});
const expiredOwner = {activeRequests:0,streamActiveRequests:0,stopVisible:false,idleUi:true,
  uiFailureSignal:"stream_cache_expired",responseKey:"owning-response"};
function ownerRepairHarness() {
  const h=supervisorHarness();
  h.assignment.controllerLease={owner:"expired-page-controller",expiresAt:new Date(start+240000).toISOString()};
  h.time(start+60000); h.heartbeat(expiredOwner);
  h.time(start+120000); h.heartbeat(expiredOwner);
  h.time(start+135000); const reply=h.heartbeat(expiredOwner);
  assert.equal(reply.command,"REFRESH_OWNER");
  return {...h, reply, permit:{...expiredOwner,href:"https://chatgpt.com/c/test",practiceCommandActive:true,
    tabId:1,refreshId:reply.refreshId}};
}
test("page recovery is response scoped, validated and limited to one successful reload", () => {
  const h=ownerRepairHarness();
  assert.equal(h.api.validateOwnerRefresh(h.permit).ok,true);
  h.api.onEvent({type:"owner_refreshed",tabId:1,refreshId:h.reply.refreshId});
  h.time(start+150000);
  assert.equal(h.heartbeat(expiredOwner).command,"NONE");
  assert.equal(h.api.get().ownerRefresh.status,"reloaded");
  assert.equal(h.api.get().chainArmed,true);
  assert.equal(h.copies.length,0);
  // Once the reservation expires, the ordinary checkpoint/Stop handoff runs.
  h.time(start+240000);
  assert.equal(h.heartbeat(expiredOwner).command,"CHAIN");
});
test("renewed work or changing the owning chat revokes a queued page recovery", () => {
  for (const change of ["work","stop","pause","url","cancel","mutation"]) {
    const h=ownerRepairHarness();
    if(change==="work") h.api.get().lastAeProgressAt=start+135001;
    if(change==="stop") h.api.get().lastStopObservation.stopVisible=true;
    if(change==="pause") h.api.onEvent({type:"monitor_inactive",monitorState:"paused"});
    if(change==="url") h.api.get().lastUrl="https://chatgpt.com/c/maintenance";
    if(change==="cancel") h.assignment.cancelRequestedAt="now";
    if(change==="mutation") h.api.get().lastAeLeaseExpiresAt=start+140000;
    assert.equal(h.api.validateOwnerRefresh(h.permit).ok,false,change);
  }
});
test("failed page recovery retries without pausing or creating a chat", () => {
  const h=ownerRepairHarness();
  h.api.onEvent({type:"owner_refresh_failed",tabId:1,refreshId:h.reply.refreshId});
  h.time(start+164999); assert.equal(h.heartbeat(expiredOwner).command,"NONE");
  h.time(start+165000); assert.equal(h.heartbeat(expiredOwner).command,"REFRESH_OWNER");
  assert.equal(h.api.get().lastMonitorState,"running");
});
test("browser reloads the same failed owner once without Stop or replacement", async () => {
  const h=browserHarness(true,{tabUrl:"https://chatgpt.com/c/test"});
  const reply={refreshId:"repair-1",sourceUrl:"https://chatgpt.com/c/test"};
  await Promise.all([h.api.repairOwner(1,reply),h.api.repairOwner(1,reply)]);
  assert.equal(h.actions.filter(x=>x==="reload").length,1);
  assert.equal(h.actions.includes("create"),false);
  assert.equal(h.actions.includes("STOP_GENERATION_TERMINAL"),false);
  assert.equal(h.storage().monitorState,"running");
});
test("browser refuses page recovery after Pause, navigation, permit denial or live transport", async () => {
  for(const options of [{monitorPaused:true},{tabUrl:"https://chatgpt.com/c/maintenance"},
    {repairDenied:true},{streamActive:true}]) {
    const h=browserHarness(true,options);
    await h.api.repairOwner(1,{refreshId:"repair-1",sourceUrl:"https://chatgpt.com/c/test"});
    assert.equal(h.actions.includes("reload"),false,JSON.stringify(options));
    assert.equal(h.actions.includes("create"),false);
  }
});
test("reload failures leave monitoring running for a later retry", async () => {
  const h=browserHarness(true,{reloadFails:true,tabUrl:"https://chatgpt.com/c/test"});
  await h.api.repairOwner(1,{refreshId:"repair-1",sourceUrl:"https://chatgpt.com/c/test"});
  assert.equal(h.actions.includes("/event"),true);
  assert.equal(h.storage().monitorState,"running");
});

function failureObservationHarness() {
  let now=start;
  const leaves=[];
  const doc={body:{},addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[],
    createTreeWalker:()=>{let i=0;return{nextNode:()=>leaves[i++]||null};}};
  const context=vm.createContext({document:doc,window:{addEventListener(){}},location:{href:"https://chatgpt.com/c/test"},
    NodeFilter:{SHOW_TEXT:4},Date:class extends Date{static now(){return now;}},console,setTimeout(){},
    getComputedStyle:()=>({display:"block",visibility:"visible"}),chrome:{runtime:{sendMessage:async()=>({})}}});
  const code=fs.readFileSync(path.join(__dirname,"content.js"),"utf8").split("\n  const practiceObserver")[0];
  vm.runInContext(code+'\nthis.api={uiFailureSignal};\n})();',context);
  return {api:context.api,time:n=>now=n,leaves,
    leaf:(text,{hidden=false,prose=false,legacyWrapper=false}={})=>({nodeValue:text,parentElement:{isConnected:true,
      getClientRects:()=>hidden?[]:[{}],closest:s=>prose&&s.includes('.markdown')?{}:
        legacyWrapper&&s.includes('[data-message-author-role]')?{}:null}})};
}
test("terminal observer reads the rendered error inside a message wrapper",()=>{
  const h=failureObservationHarness();h.time(start+6000);
  h.leaves.push(h.leaf("Stream cache expired",{legacyWrapper:true}));
  assert.equal(h.api.uiFailureSignal(),"stream_cache_expired");
});
test("terminal observer excludes hidden conversation errors and quoted assistant prose",()=>{
  const h=failureObservationHarness();h.time(start+6000);
  h.leaves.push(h.leaf("Stream cache expired",{hidden:true}),h.leaf("Stream cache expired",{prose:true}));
  assert.equal(h.api.uiFailureSignal(),null);
});
