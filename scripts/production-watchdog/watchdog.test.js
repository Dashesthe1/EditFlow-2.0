"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { POLICY, evaluateLiveness } = require("./liveness.js");
const { classify, createParser } = require("./stream-events.js");
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
test("fully silent generation needs 10 minutes plus 2 minutes confirmation", () => {
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
  assert.equal(seen.length, 0);
});

function supervisorHarness() {
  let now = start;
  const assignment = { mode: "PRACTICE", assignmentId: "assignment-1", sessionId: "session-1", status: "RUNNING", createdAt: "2026-01-01T00:00:00Z" };
  const copies = [];
  const fakeFs = { readFileSync: () => JSON.stringify({ assignments: [assignment] }), writeFileSync() {}, renameSync() {}, appendFileSync() {}, mkdirSync() {}, readdirSync: () => [], copyFileSync: (...args) => copies.push(args) };
  const context = vm.createContext({ require: name => name === "fs" ? fakeFs : name === "./liveness.js" ? require("./liveness.js") : require(name), __dirname, process, console, URL, Date: class extends Date { static now() { return now; } } });
  const code = fs.readFileSync(path.join(__dirname, "supervisor.js"), "utf8").split("\nloadState();")[0];
  vm.runInContext(code + '\nthis.api = { commandForHeartbeat, onEvent, prepareHandoff, commitHandoff, supervisorTick, get: () => runtime };', context);
  const api = context.api;
  api.onEvent({ type: "practice_arm", tabId: 1 });
  api.onEvent({ type: "generation_start", tabId: 1, requestId: "network-1", ts: start });
  return { api, assignment, copies, time: n => { now = n; }, heartbeat: patch => api.commandForHeartbeat({ tabId: 1, isTarget: true, monitorState: "running", activeRequests: 1, streamActiveRequests: 1, stopVisible: true, ...patch }, { ok: true, active: true, assignmentId: "assignment-1", sessionId: "session-1", status: "RUNNING" }) };
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
  assert.equal(h.api.commitHandoff({ tabId: 1, handoffId: command.handoffId, targetTabId: 2, stopped: true }).ok, true);
  assert.equal(h.api.get().lastTabId, 2);
});
test("three no-progress restarts open circuit", () => {
  const h = supervisorHarness();
  h.api.get().handoffHistory = [10000, 20000, 30000].map(delta => ({at: start + delta}));
  h.time(start + 600000); h.heartbeat({});
  h.time(start + 720000);
  const decision = h.heartbeat({});
  assert.equal(decision.command, "NONE");
  assert.equal(decision.reason, "restart_circuit_open_no_task_progress");
});

function browserHarness(stopOK = true) {
  let storage = { monitorState: "running", monitorTabId: 1, watchdogRuntime: { requests: {}, streamRequests: {} } };
  const actions = [];
  const event = { addListener() {} };
  const chrome = { runtime: { getManifest: () => ({version: "2.5.0"}), onMessage: event },
    storage: { local: { get: async defaults => ({...defaults, ...structuredClone(storage)}), set: async values => { storage = {...storage, ...structuredClone(values)}; } }, onChanged: event },
    alarms: { clear: async () => {}, create: async () => {}, onAlarm: event },
    scripting: { executeScript: async () => [] },
    tabs: { get: async id => ({id, url: "https://chatgpt.com/", status: "complete"}), update: async () => {},
      create: async () => { actions.push("create"); return { id: 2 }; },
      sendMessage: async (id, message) => { actions.push(message.type); return message.type === "STOP_GENERATION_TERMINAL" ? { stopped: stopOK } : { ready: true, received: true }; }, onRemoved: event },
    webRequest: { onBeforeRequest: event, onHeadersReceived: event, onCompleted: event, onErrorOccurred: event } };
  const context = vm.createContext({ chrome, console, URL, AbortController, structuredClone, setTimeout: () => 1, clearTimeout() {}, Date,
    fetch: async (url, options) => ({ ok: true, json: async () => { actions.push(url.split("32147")[1]); return { ok: true, prompt: "Resume assignment-1" }; } }) });
  const code = fs.readFileSync(path.join(__dirname, "background.js"), "utf8").split("\nchrome.runtime.onInstalled")[0];
  vm.runInContext(code + '\nthis.api = { handoff, handlePageHeartbeat };', context);
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
  assert.ok(h.actions.indexOf("STOP_GENERATION_TERMINAL") < h.actions.indexOf("/handoff/commit"));
  assert.ok(h.actions.indexOf("/handoff/commit") < h.actions.indexOf("NETWORK_WATCHDOG_FRESH_TAB_CONTINUE"));
});
test("non-target page heartbeat does not mutate browser runtime", async () => {
  const h = browserHarness(); const before = JSON.stringify(h.storage());
  await h.api.handlePageHeartbeat({ assistantFingerprint: "foreign" }, {tab: {id: 99, url: "https://chatgpt.com/c/other"}});
  assert.equal(JSON.stringify(h.storage()), before);
});
