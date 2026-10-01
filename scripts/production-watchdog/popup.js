const $ = id => document.getElementById(id);
let hardMinutesDirty = false;

function activeCount(runtime) {
  return Object.values(runtime && runtime.requests || {}).filter(item => item && item.active).length;
}

function ago(value) {
  if (!value) return "—";
  const seconds = Math.max(0, Math.round((Date.now() - Number(value)) / 1000));
  if (seconds < 60) return seconds + "s ago";
  return Math.floor(seconds / 60) + "m " + (seconds % 60) + "s ago";
}

async function readState() {
  return chrome.storage.local.get({
    monitorState: "stopped",
    monitorTabId: null,
    hardOpenRequestSeconds: 60,
    watchdogRuntime: null
  });
}

async function render() {
  const data = await readState();
  const runtime = data.watchdogRuntime || {};
  const labels = {
    running: "Running",
    busy: "Handing off",
    paused: "Paused",
    stopped: "Stopped"
  };
  $("status").textContent = labels[data.monitorState] || data.monitorState;
  const active = activeCount(runtime);
  $("production").textContent = active ? "OPEN (" + active + ")" : "Idle";
  $("httpStatus").textContent = runtime.lastHttpStatus || "—";
  $("lastEvent").textContent = ago(runtime.lastEventAt);
  $("handoffs").textContent = Number(runtime.handoffCount || 0);
  const hardInput = $("hardMinutes");
  if (!hardMinutesDirty && document.activeElement !== hardInput) {
    const savedMinutes = Number(data.hardOpenRequestSeconds || 60) / 60;
    hardInput.value = Math.max(1, Math.round(savedMinutes * 2) / 2);
  }
  $("detail").textContent = runtime.needsAttention
    ? "Needs attention: " + runtime.needsAttention
    : (runtime.statusText || "Waiting for a Practice session.");
}

async function activeChatTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function setState(target) {
  const data = await readState();
  if (target === "running") {
    const tab = await activeChatTab();
    if (!tab || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(tab.url || "")) {
      $("detail").textContent = "Open the ChatGPT tab to monitor, then press Start.";
      return;
    }
    const oldId = data.monitorTabId;
    if (Number.isInteger(oldId) && oldId !== tab.id) {
      try { await chrome.tabs.update(oldId, { autoDiscardable: true }); } catch (_) {}
    }
    try { await chrome.tabs.update(tab.id, { autoDiscardable: false }); } catch (_) {}
    await chrome.storage.local.set({
      monitorState: "running",
      pauseReason: null,
      monitorTabId: tab.id,
      monitorTabWasAutoDiscardable: tab.autoDiscardable !== false
    });
  } else if (target === "paused") {
    await chrome.storage.local.set({ monitorState: "paused", pauseReason: "explicit_user_pause" });
  } else {
    if (Number.isInteger(data.monitorTabId)) {
      try { await chrome.tabs.update(data.monitorTabId, { autoDiscardable: true }); } catch (_) {}
    }
    await chrome.storage.local.set({
      monitorState: "stopped",
      pauseReason: "explicit_user_stop",
      pendingContinuation: null,
      monitorTabId: null,
      monitorTabWasAutoDiscardable: true
    });
  }
  await render();
}

$("startBtn").addEventListener("click", () => void setState("running"));
$("pauseBtn").addEventListener("click", () => void setState("paused"));
$("stopBtn").addEventListener("click", () => void setState("stopped"));

async function saveHardMinutes() {
  const input = $("hardMinutes");
  const raw = Number(input.value);
  if (!Number.isFinite(raw) || raw < 1) {
    input.value = 1;
  }
  const minutes = Math.max(1, Number(input.value) || 1);
  await chrome.storage.local.set({ hardOpenRequestSeconds: minutes * 60 });
  hardMinutesDirty = false;
  await render();
}

$("hardMinutes").addEventListener("input", () => {
  hardMinutesDirty = true;
});
$("hardMinutes").addEventListener("change", () => void saveHardMinutes());
$("hardMinutes").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    void saveHardMinutes();
  }
});
$("saveBtn").addEventListener("click", () => void saveHardMinutes());

chrome.storage.onChanged.addListener(() => void render());
setInterval(() => void render(), 2000);
void render();
