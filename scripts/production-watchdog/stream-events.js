(function(root) {
  "use strict";
  const hash = text => {
    let n = 2166136261;
    for (let i = 0; i < text.length; i++) n = Math.imul(n ^ text.charCodeAt(i), 16777619);
    return (n >>> 0).toString(16);
  };
  function classify(event, data) {
    if (data === "[DONE]") return { terminal: "success", recognized: true };
    let obj;
    try { obj = JSON.parse(data); } catch (_) { return {}; }
    if (!obj || typeof obj !== "object") return {};
    const type = String(obj.type || event || "").toLowerCase();
    // Match top-level lifecycle events only; tool results and quoted text can
    // contain words like response.completed without ending this generation.
    if (["response.completed", "turn.completed", "turn_end"].includes(type)) return { terminal: "success", recognized: true };
    if (["response.failed", "response.cancelled", "response.incomplete", "error"].includes(type)) return { terminal: "failure", recognized: true };
    if (/^(ping|heartbeat|keepalive|keep_alive)$/.test(type)) return { recognized: true };
    if (Object.keys(obj).every(k => ["type", "timestamp", "ts", "obfuscation", "sequence_number"].includes(k))) return { recognized: true };
    const normalized = JSON.stringify(obj, (key, value) =>
      ["obfuscation", "timestamp", "ts", "sequence_number"].includes(key) ? undefined : value);
    return { fingerprint: hash(normalized), eventType: type || "structured_delta", recognized: true };
  }
  function createParser(onEvent) {
    let buffer = "", previous = null, covered = false;
    return chunk => {
      buffer += chunk;
      // Retain split frames, including CRLF split across network chunks.
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop();
      if (buffer.length > 1024 * 1024) buffer = "";
      for (const frame of frames) {
        let event = ""; const data = [];
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        if (!data.length) continue;
        const info = classify(event, data.join("\n"));
        if (!info.recognized) onEvent({ uncertain: true });
        if (info.recognized && !covered) { covered = true; onEvent({ coverage: true }); }
        if (info.terminal || (info.fingerprint && info.fingerprint !== previous)) onEvent(info);
        if (info.fingerprint) previous = info.fingerprint;
      }
    };
  }
  const api = { classify, createParser };
  root.EditFlowStreamEvents = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
