(() => {
  "use strict";
  if (globalThis.__EDITFLOW_PRODUCTION_PROBE_V3__) return;
  globalThis.__EDITFLOW_PRODUCTION_PROBE_V3__ = true;

  const SOURCE = "__EDITFLOW_CHATGPT_PRODUCTION_LIVENESS_V3__";
  let sequence = 0;
  const stamp = () => Date.now();
  const makeId = prefix => prefix + "-" + stamp() + "-" + (++sequence);

  function emit(type, detail) {
    try {
      window.postMessage(Object.assign({
        source: SOURCE, version: 3, type: type,
        ts: stamp(), href: location.href
      }, detail || {}), "*");
    } catch (_) {}
  }

  function requestMeta(input, init) {
    init = init || {};
    const request = input instanceof Request ? input : null;
    let url = null;
    try { url = new URL(request ? request.url : String(input), location.href); } catch (_) {}
    const method = String(init.method || (request && request.method) || "GET").toUpperCase();
    let body = "";
    if (typeof init.body === "string") body = init.body.slice(0, 12000);
    else if (init.body instanceof URLSearchParams) body = init.body.toString().slice(0, 12000);
    return { url: url, method: method, body: body };
  }

  function isGeneration(meta) {
    if (!meta.url || meta.method !== "POST" || meta.url.origin !== location.origin) return false;
    return ["/backend-api/f/conversation", "/backend-api/conversation",
      "/backend-api/responses", "/backend-api/f/responses"].includes(meta.url.pathname.replace(/\/$/, ""));
  }

  function parserFor(requestId) {
    let lastEmit = 0, timer = null;
    const progress = () => { lastEmit = stamp(); emit("generation_semantic_activity", { requestId }); };
    return globalThis.EditFlowStreamEvents.createParser(info => {
      if (info.fingerprint) {
        if (stamp() - lastEmit >= 1000) progress();
        else if (timer === null) timer = setTimeout(() => { timer = null; progress(); }, 1000);
        return;
      }
      if (info.terminal && timer !== null) { clearTimeout(timer); timer = null; }
      emit(info.terminal ? "generation_semantic_terminal" :
        info.fingerprint ? "generation_semantic_activity" : "generation_semantic_coverage", {
        requestId, terminal: info.terminal || null, eventType: info.eventType || null
      });
    });
  }

  async function watchResponse(requestId, response, transport) {
    let clone;
    try { clone = response.clone(); }
    catch (_) {
      emit("generation_stream_unreadable", { requestId: requestId, transport: transport });
      return;
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!clone.body) {
      try {
        const text = await clone.text();
        parserFor(requestId)(text + "\n\n");
        emit("generation_stream_end", {
          requestId: requestId, transport: transport, bytesTotal: text.length,
          terminal: response.ok ? "unknown" : "failure"
        });
      } catch (error) {
        emit("generation_stream_error", {
          requestId: requestId, transport: transport,
          errorName: error && error.name || "Error", message: String(error && error.message || error)
        });
      }
      return;
    }

    const reader = clone.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0, pending = 0, lastEmit = 0;
    const parse = parserFor(requestId);
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        if (!next.value) continue;
        bytes += next.value.byteLength;
        pending += next.value.byteLength;
        parse(decoder.decode(next.value, { stream: true }));
        const current = stamp();
        if (current - lastEmit >= 1000) {
          emit("generation_stream_activity", {
            requestId: requestId, transport: transport,
            bytesDelta: pending, bytesTotal: bytes, terminal: null
          });
          pending = 0; lastEmit = current;
        }
      }
      parse(decoder.decode() + "\n\n");
      if (pending) emit("generation_stream_activity", {
        requestId: requestId, transport: transport,
        bytesDelta: pending, bytesTotal: bytes, terminal: null
      });
      emit("generation_stream_end", {
        requestId: requestId, transport: transport, bytesTotal: bytes,
        terminal: response.ok ? "unknown" : "failure",
        contentType: contentType
      });
    } catch (error) {
      emit("generation_stream_error", {
        requestId: requestId, transport: transport, bytesTotal: bytes,
        errorName: error && error.name || "Error", message: String(error && error.message || error)
      });
    }
  }

  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    const meta = requestMeta(input, init);
    const candidate = isGeneration(meta);
    const requestId = candidate ? makeId("fetch") : null;
    if (requestId) emit("generation_request_start", {
      requestId: requestId, transport: "fetch", method: meta.method,
      path: meta.url && meta.url.pathname || ""
    });

    let promise;
    try { promise = originalFetch.apply(this, arguments); }
    catch (error) {
      if (requestId) emit("generation_request_error", {
        requestId: requestId, transport: "fetch",
        errorName: error && error.name || "Error", message: String(error && error.message || error)
      });
      throw error;
    }

    return Promise.resolve(promise).then(response => {
      const type = String(response.headers.get("content-type") || "").toLowerCase();
      const effectiveId = requestId;
      if (effectiveId) {
        emit("generation_headers", {
          requestId: effectiveId, transport: "fetch",
          status: response.status, ok: response.ok, contentType: type
        });
        void watchResponse(effectiveId, response, "fetch");
      }
      return response;
    }, error => {
      if (requestId) emit("generation_request_error", {
        requestId: requestId, transport: "fetch",
        errorName: error && error.name || "Error", message: String(error && error.message || error)
      });
      throw error;
    });
  };

  const xhrState = new WeakMap();
  const oldOpen = XMLHttpRequest.prototype.open;
  const oldSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    let parsed = null;
    try { parsed = new URL(String(url), location.href); } catch (_) {}
    xhrState.set(this, { method: String(method || "GET").toUpperCase(), url: parsed });
    return oldOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    const meta = xhrState.get(this) || {};
    meta.body = typeof body === "string" ? body.slice(0, 12000) : "";
    if (isGeneration(meta)) {
      meta.requestId = makeId("xhr");
      emit("generation_request_start", {
        requestId: meta.requestId, transport: "xhr",
        method: meta.method, path: meta.url && meta.url.pathname || ""
      });
      this.addEventListener("progress", event => emit("generation_stream_activity", {
        requestId: meta.requestId, transport: "xhr",
        bytesDelta: 0, bytesTotal: Number(event.loaded) || 0, terminal: null
      }));
      const parse = parserFor(meta.requestId);
      let consumed = 0;
      this.addEventListener("progress", () => {
        try { const text = String(this.responseText || ""); parse(text.slice(consumed)); consumed = text.length; } catch (_) {}
      });
      this.addEventListener("load", () => {
        try { parse(String(this.responseText || "").slice(consumed) + "\n\n"); } catch (_) {}
        emit("generation_headers", {
          requestId: meta.requestId, transport: "xhr", status: this.status,
          ok: this.status >= 200 && this.status < 300,
          contentType: this.getResponseHeader("content-type") || ""
        });
        emit("generation_stream_end", {
          requestId: meta.requestId, transport: "xhr",
          bytesTotal: String(this.responseText || "").length,
          terminal: this.status >= 200 && this.status < 300 ? "unknown" : "failure"
        });
      });
      ["error","timeout","abort"].forEach(eventName => {
        this.addEventListener(eventName, () => emit(
          eventName === "abort" ? "generation_abort" : "generation_request_error",
          { requestId: meta.requestId, transport: "xhr", errorName: eventName }
        ));
      });
    }
    xhrState.set(this, meta);
    return oldSend.apply(this, arguments);
  };

  window.addEventListener("online", () => emit("network_state", { online: true }));
  window.addEventListener("offline", () => emit("network_state", { online: false }));
  setInterval(() => emit("page_heartbeat", {
    online: navigator.onLine, visibility: document.visibilityState,
    readyState: document.readyState
  }), 5000);
  emit("probe_ready", {
    online: navigator.onLine, visibility: document.visibilityState,
    readyState: document.readyState
  });
})();
