(() => {
  "use strict";
  if (globalThis.__EDITFLOW_CHAT_SUPERVISOR_V260__) return;
  globalThis.__EDITFLOW_CHAT_SUPERVISOR_V260__ = true;

  const PRACTICE_COMPLETION_MARKER = "EDITFLOW_PRACTICE_COMPLETE";
  const PRACTICE_CANCELLATION_MARKER = "EDITFLOW_PRACTICE_CANCELLED";
  const PRACTICE_COMMAND_RE = /\b(start|continue|resume)\b[\s\S]{0,100}\bpractice session\b/i;
  const CONTINUE_PRACTICE_PROMPT =
    "Continue the practice session with the given raw files to make the finished product";
  const PROBE_SOURCE = "__EDITFLOW_CHATGPT_PRODUCTION_LIVENESS_V3__";

  const DEFAULTS = {
    monitorState: "stopped",
    monitorTabId: null,
    rules: [],
    softStallSeconds: 60,
    replacementAllowedSeconds: 90
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const latches = new Set();
  const phraseFirstSeenAt = new Map();
  let busy = false;
  let programmaticStop = false;
  let scanQueue = Promise.resolve();
  let lastPracticeCommandText = null;
  let practiceArmTimer = null;
  let failureHeartbeatTimer = null;
  let conversationHref = location.href;
  let conversationChangedAt = Date.now();
  let lastDomMutationAt = Date.now();

  window.addEventListener("message", event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== PROBE_SOURCE || data.version !== 3 || !data.type) return;
    chrome.runtime.sendMessage({
      type: "PRODUCTION_PROBE_EVENT",
      event: data
    }).catch(() => {});
  }, false);

  const meta = element => [
    element.getAttribute("aria-label"), element.getAttribute("title"),
    element.getAttribute("data-testid"), element.innerText
  ].filter(Boolean).join(" ").toLowerCase().replace(/\s+/g, " ").trim();

  function rendered(element) {
    if (!element || !element.isConnected || element.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function usable(element) {
    return rendered(element) && !element.disabled;
  }

  function stopButtons() {
    const matches = new Set();
    const selectors = [
      'button[data-testid="stop-button"]',
      'button[data-testid*="stop-generation" i]',
      'button[data-testid*="stop-stream" i]',
      'button[aria-label*="stop generating" i]',
      'button[aria-label*="stop streaming" i]',
      'button[aria-label*="stop response" i]',
      'button[aria-label*="stop responding" i]',
      'button[aria-label="stop" i]',
      'button[title*="stop generating" i]',
      'button[title="stop" i]'
    ];
    for (const selector of selectors) {
      for (const button of document.querySelectorAll(selector)) {
        if (rendered(button)) matches.add(button);
      }
    }
    // Includes common square-button variants with accessible names.
    for (const button of document.querySelectorAll('button, [role="button"]')) {
      if (!rendered(button)) continue;
      const label = meta(button);
      const accessibleName = String(button.getAttribute("aria-label") || button.getAttribute("title") || "").toLowerCase().trim();
      if (/\bstop (generating|generation|streaming|response|responding)\b/.test(label) ||
          /\b(data-)?stop-button\b/.test(label) || /^stop(?: (generating|generation|streaming|response|responding))?$/.test(accessibleName) ||
          label === "stop") matches.add(button);
    }
    return [...matches];
  }

  function assistantOutputText() {
    const messages = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    return messages.at(-1)?.innerText || "";
  }

  function latestUserOutputText() {
    const messages = [...document.querySelectorAll('[data-message-author-role="user"]')];
    return (messages.at(-1)?.innerText || "").replace(/\s+/g, " ").trim();
  }

  function stableHash(value) {
    let hash = 2166136261;
    const text = String(value || "");
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function assistantProgressSnapshot() {
    const messages = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    const text = (messages.at(-1)?.innerText || "").replace(/\s+/g, " ").trim();
    const tail = text.length > 16000 ? text.slice(-16000) : text;
    return {
      fingerprint: stableHash(String(messages.length) + "|" + tail),
      textLength: text.length
    };
  }

  function thinkingSignal() {
    const text = monitorSurfaceText().toLowerCase();
    if (/our systems are thinking a bit more/.test(text)) return "extended_thinking";
    if (/thinking a bit more/.test(text)) return "extended_thinking";
    return null;
  }

  function monitorSurfaceText() {
    if (!document.body) return "";
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const parts = [];
    let node;
    while ((node = walker.nextNode())) {
      const element = node.parentElement;
      if (!element) continue;
      if (element.closest(
        '[data-message-author-role], #prompt-textarea, textarea, input, [contenteditable="true"], [hidden], [aria-hidden="true"]'
      )) continue;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const value = (node.nodeValue || "").trim();
      if (value) parts.push(value);
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function uiFailureSignal() {
    // ChatGPT's SPA can briefly leave the previous conversation's terminal
    // banner in the DOM while a fresh chat is mounting. Ignore that carryover
    // for a short route-change grace period.
    if (Date.now() - conversationChangedAt < 5000) return null;
    const text = monitorSurfaceText().toLowerCase();
    if (/stream cache expired/.test(text)) {
      return "stream_cache_expired";
    }
    if (/connection interrupted\.?\s*waiting for (?:the )?complete answer/.test(text)) {
      return "connection_interrupted_waiting_for_complete_answer";
    }
    return null;
  }
  function syncConversationIdentity() {
    if (location.href === conversationHref) return false;
    conversationHref = location.href;
    conversationChangedAt = Date.now();
    latches.clear();
    phraseFirstSeenAt.clear();
    lastPracticeCommandText = null;
    return true;
  }

  async function maybeAutoArmPractice() {
    syncConversationIdentity();
    const text = latestUserOutputText();
    if (!text || !PRACTICE_COMMAND_RE.test(text) || text === lastPracticeCommandText) return;

    // Historical Practice commands in old chats are never enough to arm.
    // A fresh Practice command must be in the active tab while ChatGPT is
    // actively generating a response.
    if (document.visibilityState !== "visible" || stopButtons().length === 0) return;

    lastPracticeCommandText = text;
    latches.clear();
    phraseFirstSeenAt.clear();
    try {
      const result = await chrome.runtime.sendMessage({
        type: "PRACTICE_SESSION_ACTIVE",
        conversationUrl: location.href,
        observedAt: Date.now()
      });
      if (!result?.ok && !result?.ignored) {
        console.warn("[Phrase Monitor] Practice auto-arm did not succeed:", result?.error || "unknown error");
      }
    } catch (error) {
      console.warn("[Phrase Monitor] Practice auto-arm failed:", String(error));
    }
  }

  function schedulePracticeAutoArm() {
    if (practiceArmTimer !== null) return;
    practiceArmTimer = setTimeout(() => {
      practiceArmTimer = null;
      void maybeAutoArmPractice();
    }, 250);
  }

  async function preArmPracticeFromComposer() {
    const box = composer();
    const text = box ? composerText(box).replace(/\s+/g, " ").trim() : "";
    if (!text || !PRACTICE_COMMAND_RE.test(text)) return;
    try {
      await chrome.runtime.sendMessage({
        type: "PRACTICE_SESSION_ACTIVE",
        conversationUrl: location.href,
        observedAt: Date.now(),
        source: "composer-submit"
      });
    } catch (_) {}
  }

  document.addEventListener("click", event => {
    const button = event.target?.closest?.("button, [role=\"button\"]");
    if (!button) return;
    if (button === sendButton()) void preArmPracticeFromComposer();
    if (event.isTrusted === true && !programmaticStop && stopButtons().includes(button)) {
      chrome.runtime.sendMessage({ type: "USER_STOP_INTENT", observedAt: Date.now() }).catch(() => {});
    }
  }, true);

  document.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    const box = composer();
    if (!box || (box !== event.target && !box.contains(event.target))) return;
    void preArmPracticeFromComposer();
  }, true);

  function generationControls() {
    const stops = stopButtons();
    const box = composer();
    const controls = box && (box.closest('form, [data-testid*="composer"], [data-type="composer"]') || box.parentElement);
    const idleSend = controls && [...controls.querySelectorAll('button, [role="button"]')].some(button =>
      rendered(button) && /^(send|send prompt|send message)$/.test(
        String(button.getAttribute("aria-label") || button.getAttribute("title") || button.innerText || "")
          .toLowerCase().replace(/\s+/g, " ").trim()));
    return { href: location.href, stopVisible: stops.length > 0,
      clickableStop: stops.some(button => !button.disabled), idleUi: !!(box && idleSend) };
  }

  async function forceStopGeneration(expectedHref, handoffId) {
    let clicked = false;
    programmaticStop = true;
    try {
      return await globalThis.EditFlowStopGate.stopAndVerify({
        now: () => Date.now(), wait: sleep, observe: generationControls,
        authorized: async () => {
          const state = await chrome.storage.local.get(DEFAULTS);
          if (state.monitorState !== "running" && state.monitorState !== "busy") {
            throw Error("Monitoring paused; Stop cancelled");
          }
          if (handoffId) {
            const permit = await chrome.runtime.sendMessage({ type: "HANDOFF_STILL_AUTHORIZED", handoffId, stopClicked: clicked });
            if (!permit || !permit.ok) throw Error("Handoff authorization changed; Stop cancelled");
          }
        },
        click: () => {
          const button = stopButtons().find(button => !button.disabled);
          if (!button) return false;
          button.click(); clicked = true; return true;
        }
      }, { expectedHref });
    } finally { programmaticStop = false; }
  }

  function sendButton() {
    for (const selector of [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt" i]',
      'button[aria-label="Send message" i]',
      'button[aria-label="Send" i]'
    ]) {
      const button = document.querySelector(selector);
      if (usable(button)) return button;
    }
    return [...document.querySelectorAll("button")].find(button =>
      usable(button) && /^(send|send prompt|send message)$/.test(meta(button))
    ) || null;
  }

  function composer() {
    for (const selector of [
      '#prompt-textarea',
      'div[contenteditable="true"][data-lexical-editor="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'textarea[placeholder*="message" i]'
    ]) {
      const element = document.querySelector(selector);
      if (usable(element)) return element;
    }
    return null;
  }

  function composerText(element) {
    return element instanceof HTMLTextAreaElement ? element.value : (element?.innerText || "");
  }

  async function requireStillAuthorized() {
    const state = await chrome.storage.local.get(DEFAULTS);
    if (state.monitorState !== "busy") throw Error("Workflow paused or stopped; no further action taken.");
  }

  async function stableNoStop(timeoutMs) {
    const end = Date.now() + timeoutMs;
    let consecutive = 0;
    while (Date.now() < end) {
      await requireStillAuthorized();
      if (stopButtons().length === 0) {
        consecutive++;
        if (consecutive >= 4) return true;
      } else {
        consecutive = 0;
      }
      await sleep(250);
    }
    return false;
  }

  async function ensureStopped() {
    for (let attempt = 0; attempt < 4; attempt++) {
      await requireStillAuthorized();
      const stops = stopButtons();
      if (stops.length === 0) return stableNoStop(2500);
      // Stop must be actually clicked; a click attempt is NOT proof of success.
      // Once Stop succeeds, move directly into the fresh-chat handoff instead
      // of leaving the stopped conversation idle for a fixed delay.
      stops[0].click();
      if (await stableNoStop(4000)) return true;
      await sleep(250);
    }
    return false;
  }

  function newChatButton() {
    for (const selector of [
      'a[aria-label*="new chat" i]',
      'button[aria-label*="new chat" i]',
      '[data-testid*="new-chat" i]'
    ]) {
      const element = document.querySelector(selector);
      if (usable(element)) return element;
    }
    return [...document.querySelectorAll('a, button, [role="button"]')].find(el =>
      usable(el) && /\bnew chat\b/.test(meta(el))
    ) || null;
  }

  async function waitForFreshChat(previousHref, previousUserText, maxMs) {
    const until = Date.now() + maxMs;
    while (Date.now() < until) {
      await requireStillAuthorized();
      const currentUserText = latestUserOutputText();
      const messageCount = document.querySelectorAll('[data-message-author-role]').length;
      if (location.href !== previousHref ||
          (messageCount === 0 && currentUserText !== previousUserText)) {
        return true;
      }
      await sleep(100);
    }
    return false;
  }

  async function waitForComposer(maxMs) {
    const until = Date.now() + maxMs;
    while (Date.now() < until) {
      await requireStillAuthorized();
      if (composer()) return composer();
      await sleep(100);
    }
    return null;
  }

  function enterPrompt(element, text) {
    element.focus();
    if (element instanceof HTMLTextAreaElement) {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      set.call(element, text);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    // Chromium's native insertText fires editing events that rich-text editors
    // (including editors based on React/Lexical/ProseMirror) can observe.
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    let inserted = false;
    try { inserted = document.execCommand("insertText", false, text); } catch (_) {}
    if (!inserted || !element.innerText.includes(text)) {
      element.textContent = text;
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true, inputType: "insertText", data: text
      }));
    }
  }

  async function waitForSendButton(maxMs) {
    const until = Date.now() + maxMs;
    while (Date.now() < until) {
      await requireStillAuthorized();
      const send = sendButton();
      if (send && !send.disabled) return send;
      await sleep(100);
    }
    return null;
  }

  async function sendMappedPrompt(target, prompt) {
    await requireStillAuthorized();
    if (!composerText(target).includes(prompt)) {
      throw Error("Composer did not contain the configured prompt; nothing sent.");
    }
    const send = await waitForSendButton(5000);
    if (!send) throw Error("Send button was unavailable; nothing sent.");
    send.click();
  }

  async function waitUntilReplacementAllowed(firstSeenAt, replacementAllowedSeconds) {
    const target = firstSeenAt + Math.max(90, Number(replacementAllowedSeconds) || 90) * 1000;
    while (Date.now() < target) {
      await requireStillAuthorized();
      await sleep(Math.min(1000, Math.max(50, target - Date.now())));
    }
  }

  async function performWorkflow(rule, firstSeenAt, options = {}) {
    const state = await chrome.storage.local.get(DEFAULTS);
    // Background handoff sets "busy" before messaging this page. Accept both
    // states here; otherwise the confirmed watchdog command is acknowledged
    // but the fresh-chat workflow exits before doing anything.
    if (state.monitorState !== "running" && state.monitorState !== "busy") return;
    if (state.monitorState === "running") {
      await chrome.storage.local.set({ monitorState: "busy" });
    }
    busy = true;
    try {
      const previousUserText = latestUserOutputText();
      const handoffPrompt = PRACTICE_COMMAND_RE.test(previousUserText)
        ? CONTINUE_PRACTICE_PROMPT
        : rule.prompt;

      // If ChatGPT is already stopped (timeout/interruption UI), hand off now.
      // If generation is still active, wait until replacement eligibility,
      // then Stop and immediately create the replacement chat. This removes
      // the old stop-now / idle-until-90s gap.
      const alreadyStopped = stopButtons().length === 0 && await stableNoStop(1250);
      if (!alreadyStopped) {
        if (!options.immediateStop) {
          await waitUntilReplacementAllowed(firstSeenAt, state.replacementAllowedSeconds);
        }
        await requireStillAuthorized();
        if (!(await ensureStopped())) {
          throw Error("Current generation was NOT confirmed stopped. No new chat was created.");
        }
      }

      await requireStillAuthorized();
      const previousHref = location.href;
      const button = newChatButton();
      if (!button) throw Error("New Chat control not found; no new chat was created.");
      button.click();

      if (!(await waitForFreshChat(previousHref, previousUserText, 10000))) {
        throw Error("New Chat did not produce a fresh conversation; continuation was not sent.");
      }
      const box = await waitForComposer(20000);
      if (!box) throw Error("Could not find ChatGPT composer in the fresh chat.");

      enterPrompt(box, handoffPrompt);
      await sendMappedPrompt(box, handoffPrompt);
      chrome.runtime.sendMessage({
        type: "HANDOFF_SENT",
        conversationUrl: location.href,
        observedAt: Date.now()
      }).catch(() => {});
      return { sent: true };
    } catch (error) {
      console.error("[ChatGPT Production Watchdog]", error);
      chrome.runtime.sendMessage({
        type: "HANDOFF_FAILED",
        error: String(error && error.message || error),
        conversationUrl: location.href,
        observedAt: Date.now()
      }).catch(() => {});
    } finally {
      // Pause/Stop during a handoff always wins and remains paused/stopped.
      const stateNow = await chrome.storage.local.get(DEFAULTS);
      if (stateNow.monitorState === "busy") {
        await chrome.storage.local.set({ monitorState: "running" });
      }
      busy = false;
    }
  }

  async function sendFreshContinuation(prompt) {
    const state = await chrome.storage.local.get(DEFAULTS);
    if (state.monitorState !== "running" && state.monitorState !== "busy") return;
    if (state.monitorState === "running") {
      await chrome.storage.local.set({ monitorState: "busy" });
    }
    busy = true;
    try {
      // This path is only for a brand-new browser tab created by background.js.
      // Refuse to type into an existing conversation if Chrome restored one.
      const messages = document.querySelectorAll('[data-message-author-role]').length;
      if (messages > 0 || /\/c\//i.test(location.pathname)) {
        throw Error("Fresh-tab handoff landed on an existing conversation; nothing sent.");
      }

      const box = await waitForComposer(20000);
      if (!box) throw Error("Could not find ChatGPT composer in the separate fresh tab.");
      const handoffPrompt = String(prompt || CONTINUE_PRACTICE_PROMPT).trim();
      enterPrompt(box, handoffPrompt);
      await sendMappedPrompt(box, handoffPrompt);
      const until = Date.now() + 12000;
      while (Date.now() < until && latestUserOutputText().replace(/\s+/g, " ").trim() !== handoffPrompt.replace(/\s+/g, " ").trim()) await sleep(250);
      if (latestUserOutputText().replace(/\s+/g, " ").trim() !== handoffPrompt.replace(/\s+/g, " ").trim()) throw Error("Continuation was clicked but acceptance is unconfirmed; reconcile before retry");
      chrome.runtime.sendMessage({
        type: "HANDOFF_SENT",
        conversationUrl: location.href,
        observedAt: Date.now()
      }).catch(() => {});
      return { sent: true };
    } catch (error) {
      console.error("[ChatGPT Production Watchdog]", error);
      chrome.runtime.sendMessage({
        type: "HANDOFF_FAILED",
        error: String(error && error.message || error),
        conversationUrl: location.href,
        observedAt: Date.now()
      }).catch(() => {});
      return { sent: false, error: String(error && error.message || error) };
    } finally {
      const stateNow = await chrome.storage.local.get(DEFAULTS);
      if (stateNow.monitorState === "busy") {
        await chrome.storage.local.set({ monitorState: "running" });
      }
      busy = false;
    }
  }

  async function scan() {
    if (busy) return;
    const { isTarget } = await chrome.runtime.sendMessage({ type: "IS_TARGET_TAB" });
    if (!isTarget) return;

    // A ChatGPT SPA route change is a hard boundary between conversations.
    // Never carry trigger age/latches from an older chat into the new one.
    if (syncConversationIdentity()) return;

    const state = await chrome.storage.local.get(DEFAULTS);
    if (state.monitorState !== "running") return;

    const latestAssistant = assistantOutputText();
    if (latestAssistant.includes(PRACTICE_COMPLETION_MARKER)) {
      await chrome.runtime.sendMessage({ type: "PRACTICE_COMPLETED" });
      return;
    }
    if (latestAssistant.includes(PRACTICE_CANCELLATION_MARKER)) {
      await chrome.runtime.sendMessage({ type: "PRACTICE_CANCELLED" });
      return;
    }
    // v2: phrase matching is disabled. Stall/failure decisions come from Chrome network lifecycle events.
    return;
    // Scan only non-conversation UI text. User/assistant messages are excluded so
    // discussing a trigger phrase cannot create a replacement chat by accident.
    const lower = monitorSurfaceText().toLowerCase();
    for (const phrase of latches) {
      if (!lower.includes(phrase)) latches.delete(phrase);
    }
    for (const phrase of phraseFirstSeenAt.keys()) {
      if (!lower.includes(phrase)) phraseFirstSeenAt.delete(phrase);
    }
    const now = Date.now();
    const softStallMs = Math.max(60, Number(state.softStallSeconds) || 60) * 1000;
    for (const rule of state.rules) {
      if (!rule.phrase?.trim() || !rule.prompt?.trim()) continue;
      const phrase = rule.phrase.trim().toLowerCase();
      if (!lower.includes(phrase)) continue;
      if (!phraseFirstSeenAt.has(phrase)) phraseFirstSeenAt.set(phrase, now);
      const firstSeenAt = phraseFirstSeenAt.get(phrase);
      if (now - firstSeenAt < softStallMs || latches.has(phrase)) continue;
      latches.add(phrase);
      await performWorkflow(rule, firstSeenAt);
      break;
    }
  }

  function scheduleFailureHeartbeat() {
    if (failureHeartbeatTimer !== null) return;
    failureHeartbeatTimer = setTimeout(() => {
      failureHeartbeatTimer = null;
      if (uiFailureSignal()) void sendPageHeartbeat();
    }, 150);
  }

  const practiceObserver = new MutationObserver(() => {
    lastDomMutationAt = Date.now();
    schedulePracticeAutoArm();
    // Terminal UI errors must not wait for a throttled interval timer. The
    // banner mutation itself immediately schedules a watchdog heartbeat.
    scheduleFailureHeartbeat();
  });
  practiceObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
  schedulePracticeAutoArm();

  async function sendPageHeartbeat() {
    try {
      const assistantProgress = assistantProgressSnapshot();
      const controls = generationControls();
      await chrome.runtime.sendMessage({
        type: "PAGE_HEARTBEAT",
        href: location.href,
        observedAt: Date.now(),
        uiFailureSignal: uiFailureSignal(),
        practiceCommandActive: PRACTICE_COMMAND_RE.test(latestUserOutputText()),
        stopVisible: controls.stopVisible,
        stopProtocol: globalThis.EditFlowStopGate.PROTOCOL,
        stopClickable: controls.clickableStop,
        idleUi: controls.idleUi,
        assistantCount: document.querySelectorAll('[data-message-author-role="assistant"]').length,
        responseKey: stableHash(String(document.querySelectorAll('[data-message-author-role="user"]').length) + "|" + latestUserOutputText()),
        assistantFingerprint: assistantProgress.fingerprint,
        assistantTextLength: assistantProgress.textLength,
        thinkingSignal: thinkingSignal(),
        lastDomMutationAt
      });
    } catch (_) {}
  }

  setTimeout(() => void sendPageHeartbeat(), 250);
  setInterval(() => void sendPageHeartbeat(), 2000);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "WATCHDOG_SAMPLE_NOW") {
      void sendPageHeartbeat(); sendResponse({ received: true }); return;
    }
    if (message?.type === "PHRASE_MONITOR_PING") {
      sendResponse({ ready: true, version: chrome.runtime.getManifest().version,
        stopProtocol: globalThis.EditFlowStopGate.PROTOCOL });
      return;
    }
    if (message?.type === "SCAN_NOW") {
      // Serialized; a busy workflow cannot get duplicate scans queued.
      scanQueue = scanQueue.catch(console.warn).then(scan);
      sendResponse({ received: true });
      return;
    }
    if (message?.type === "NETWORK_WATCHDOG_HANDOFF") {
      // Same-tab replacement is permanently disabled. If any stale caller
      // still emits this legacy message, report failure so the supervisor's
      // separate-tab native fallback can take over instead of navigating the
      // current conversation.
      chrome.runtime.sendMessage({
        type: "HANDOFF_FAILED",
        error: "legacy_same_tab_handoff_disabled",
        conversationUrl: location.href,
        observedAt: Date.now()
      }).catch(() => {});
      sendResponse({ received: false, disabled: true });
      return;
    }
    if (message?.type === "NETWORK_WATCHDOG_FRESH_TAB_CONTINUE") {
      scanQueue = scanQueue.catch(console.warn).then(() => sendFreshContinuation(message.prompt || CONTINUE_PRACTICE_PROMPT));
      scanQueue.then(result => sendResponse({ received: true, ...result })).catch(error => sendResponse({ received: true, sent: false, error: String(error) }));
      return true;
    }
    if (message?.type === "CONTINUATION_STATUS") {
      sendResponse({ promptPresent: latestUserOutputText().replace(/\s+/g, " ").trim() === String(message.prompt || "").replace(/\s+/g, " ").trim(),
        emptyConversation: !/\/c\//i.test(location.pathname) && document.querySelectorAll('[data-message-author-role]').length === 0,
        ...generationControls() });
      return;
    }
    if (message?.type === "STOP_GENERATION_TERMINAL") {
      forceStopGeneration(message.expectedHref, message.handoffId)
        .then(proof => sendResponse({ received: true, ...proof }))
        .catch(error => sendResponse({ received: true, stopped: false, error: String(error) }));
      return true;
    }
    if (message?.type === "STOP_GENERATION_STATUS") {
      sendResponse({ received: true, protocol: globalThis.EditFlowStopGate.PROTOCOL,
        ...generationControls(), checkedAt: Date.now() });
      return;
    }
  });
})();
