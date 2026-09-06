(function () {
  "use strict";

  var config = window.EDITFLOW2_BRIDGE_CONFIG || {};
  var statusEl = document.getElementById("status");
  var brokerEl = document.getElementById("broker");
  var protocolEl = document.getElementById("protocol");
  var stopped = false;
  var sessionId = null;
  var connectionGeneration = 0;
  var pollDelayMs = 125;
  var reconnectDelayMs = 750;
  var livenessDelayMs = 500;
  var connectInFlight = false;
  var reconnectTimer = null;
  var livenessStarted = false;
  var hostReady = false;
  var HOST_ERROR_PREFIX = "__EDITFLOW2_HOST_ERROR__:";
  var HOST_BOOTSTRAP_OK = "__EDITFLOW2_HOST_BOOTSTRAP_OK__";
  var HOST_BOOTSTRAP_ERROR_PREFIX = "__EDITFLOW2_HOST_BOOTSTRAP_ERROR__:";

  function setStatus(state, text) {
    statusEl.setAttribute("data-state", state);
    statusEl.textContent = text;
  }

  function assertConfig() {
    if (config.protocolVersion !== "1.1.0") throw new Error("Unsupported EditFlow CEP protocol configuration.");
    if (config.host !== "127.0.0.1") throw new Error("EditFlow CEP broker host must be 127.0.0.1.");
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error("EditFlow CEP broker port is not configured.");
    if (typeof config.token !== "string" || config.token.length < 32) throw new Error("EditFlow CEP broker token is not configured.");
  }

  function brokerUrl(path) {
    return "http://127.0.0.1:" + config.port + path;
  }

  function headers(extra) {
    var result = {
      "Content-Type": "application/json",
      "X-EditFlow-Token": config.token
    };
    if (extra) {
      Object.keys(extra).forEach(function (key) { result[key] = extra[key]; });
    }
    return result;
  }

  function requestJson(path, options) {
    var init = options || {};
    init.headers = headers(init.headers);
    return fetch(brokerUrl(path), init).then(function (response) {
      if (response.status === 204) return { status: 204, value: null };
      return response.text().then(function (text) {
        var value = text ? JSON.parse(text) : null;
        if (!response.ok) {
          var message = value && value.error ? value.error : "Broker HTTP " + response.status;
          throw new Error(message);
        }
        return { status: response.status, value: value };
      });
    });
  }

  function extensionRootPath() {
    var cep = window.__adobe_cep__;
    if (!cep || typeof cep.getSystemPath !== "function") {
      throw new Error("CEP extension path API is unavailable.");
    }
    var path = decodeURI(cep.getSystemPath("extension"));
    if (path.indexOf("file:///") === 0 && /^[A-Za-z]:\//.test(path.substring(8))) {
      path = path.substring(8);
    } else if (path.indexOf("file://") === 0) {
      path = path.substring(7);
    }
    path = path.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!path) throw new Error("CEP extension root path is empty.");
    return path;
  }

  function ensureHostDispatcher() {
    return new Promise(function (resolve, reject) {
      var cep = window.__adobe_cep__;
      if (!cep || typeof cep.evalScript !== "function") {
        reject(new Error("Host bootstrap: CEP evalScript is unavailable in this panel context."));
        return;
      }

      var hostPath;
      try {
        hostPath = extensionRootPath() + "/host/editflow_host_current.jsx";
      } catch (error) {
        reject(new Error("Host bootstrap: " + (error && error.message ? error.message : String(error))));
        return;
      }

      var hostPathLiteral = JSON.stringify(hostPath);
      var script = "(function(){try{" +
        "if(typeof $.global.EditFlow2_dispatch===\"function\")return \"" + HOST_BOOTSTRAP_OK + "\";" +
        "var hostFile=new File(" + hostPathLiteral + ");" +
        "if(!hostFile.exists)return \"" + HOST_BOOTSTRAP_ERROR_PREFIX + "host file missing: \"+hostFile.fsName;" +
        "$.evalFile(hostFile);" +
        "if(typeof $.global.EditFlow2_dispatch!==\"function\")return \"" + HOST_BOOTSTRAP_ERROR_PREFIX + "dispatcher did not register\";" +
        "return \"" + HOST_BOOTSTRAP_OK + "\";" +
        "}catch(error){return \"" + HOST_BOOTSTRAP_ERROR_PREFIX + "\"+String(error);}}())";

      cep.evalScript(script, function (raw) {
        if (raw === HOST_BOOTSTRAP_OK) {
          resolve();
          return;
        }
        if (typeof raw === "string" && raw.indexOf(HOST_BOOTSTRAP_ERROR_PREFIX) === 0) {
          reject(new Error("Host bootstrap: " + raw.substring(HOST_BOOTSTRAP_ERROR_PREFIX.length)));
          return;
        }
        if (raw === "EvalScript error.") {
          reject(new Error("Host bootstrap: After Effects returned an evalScript error."));
          return;
        }
        reject(new Error("Host bootstrap: unexpected result " + String(raw)));
      });
    });
  }

  function register() {
    return requestJson("/v1/register", {
      method: "POST",
      body: JSON.stringify({
        protocolVersion: "1.1.0",
        extensionId: config.extensionId,
        extensionVersion: config.extensionVersion
      })
    }).then(function (result) {
      sessionId = result.value.sessionId;
      connectionGeneration += 1;
      var generation = connectionGeneration;
      brokerEl.textContent = "127.0.0.1:" + config.port;
      protocolEl.textContent = result.value.protocolVersion;
      setStatus("connected", "Connected to local EditFlow runtime");
      schedulePoll(generation);
      return generation;
    });
  }

  function evalHostDispatcher(request) {
    return new Promise(function (resolve, reject) {
      var cep = window.__adobe_cep__;
      if (!cep || typeof cep.evalScript !== "function") {
        reject(new Error("CEP evalScript is unavailable in this panel context."));
        return;
      }
      var requestJson = JSON.stringify(request);
      var requestLiteral = JSON.stringify(requestJson);
      var script = "(function(){try{" +
        "if(typeof $.global.EditFlow2_dispatch!==\"function\")return \"" + HOST_ERROR_PREFIX + "dispatcher unavailable\";" +
        "var result=$.global.EditFlow2_dispatch(" + requestLiteral + ");" +
        "if(result===undefined||result===null)return \"" + HOST_ERROR_PREFIX + "dispatcher returned no result\";" +
        "return String(result);" +
        "}catch(error){return \"" + HOST_ERROR_PREFIX + "\"+String(error);}}())";
      cep.evalScript(script, function (raw) {
        try {
          if (typeof raw !== "string") throw new Error("After Effects returned a non-string evalScript result.");
          if (raw === "EvalScript error.") throw new Error("After Effects returned an evalScript error.");
          if (raw.indexOf(HOST_ERROR_PREFIX) === 0) throw new Error(raw.substring(HOST_ERROR_PREFIX.length));
          if (raw.length === 0) throw new Error("After Effects dispatcher returned an empty evalScript result.");
          var response = JSON.parse(raw);
          if (response.protocolVersion !== "1.1.0") throw new Error("After Effects dispatcher protocol mismatch.");
          if (response.requestId !== request.requestId || response.operationId !== request.operationId || response.command !== request.command) {
            throw new Error("After Effects dispatcher correlation mismatch.");
          }
          resolve(response);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  function postResponse(response, responseSessionId) {
    return requestJson("/v1/response", {
      method: "POST",
      body: JSON.stringify({ sessionId: responseSessionId, response: response })
    });
  }

  function postTransportFailure(request, error, responseSessionId) {
    var message = error && error.message ? error.message : String(error);
    return postResponse({
      protocolVersion: "1.1.0",
      requestId: request.requestId,
      transactionId: request.transactionId,
      operationId: request.operationId,
      capabilityId: request.capabilityId,
      command: request.command,
      outcome: "FAILED",
      error: {
        category: "ADAPTER_FAILURE",
        code: "CEP_TRANSPORT_HOST_DISPATCH_FAILED",
        message: message
      },
      affectedObjects: [],
      readback: null,
      projectSnapshot: null,
      environmentProbe: null,
      hostProjectRevision: null,
      diagnostics: {
        adapterProtocolVersion: "1.1.0",
        adapterBuild: config.extensionVersion,
        command: request.command,
        notes: ["Failure occurred in the CEP client transport before a valid host response was returned."]
      },
      proofArtifactRefs: []
    }, responseSessionId);
  }

  function pollOnce(generation) {
    if (stopped || !sessionId || generation !== connectionGeneration) return Promise.resolve();
    var leasedSessionId = sessionId;
    return requestJson("/v1/next?sessionId=" + encodeURIComponent(leasedSessionId), { method: "GET" })
      .then(function (result) {
        if (generation !== connectionGeneration) return null;
        if (result.status === 204) return null;
        return evalHostDispatcher(result.value)
          .then(function (response) {
            if (generation !== connectionGeneration) return null;
            return postResponse(response, leasedSessionId);
          })
          .catch(function (error) {
            if (generation !== connectionGeneration) return null;
            return postTransportFailure(result.value, error, leasedSessionId);
          });
      });
  }

  function scheduleReconnect(delayMs) {
    if (stopped || reconnectTimer !== null) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, delayMs === undefined ? reconnectDelayMs : delayMs);
  }

  function schedulePoll(generation) {
    if (stopped || generation !== connectionGeneration) return;
    setTimeout(function () {
      if (stopped || generation !== connectionGeneration) return;
      pollOnce(generation)
        .then(function () { schedulePoll(generation); })
        .catch(function (error) {
          if (generation !== connectionGeneration) return;
          sessionId = null;
          setStatus("error", "Bridge disconnected: " + error.message);
          scheduleReconnect(reconnectDelayMs);
        });
    }, pollDelayMs);
  }

  function livenessOnce() {
    if (stopped) return Promise.resolve();
    if (!sessionId) {
      scheduleReconnect(0);
      return Promise.resolve();
    }

    var generation = connectionGeneration;
    var observedSessionId = sessionId;
    return requestJson("/v1/status", { method: "GET" })
      .then(function (result) {
        if (generation !== connectionGeneration) return;
        var value = result.value || {};
        var remoteSession = value.session || null;
        if (value.panelConnected !== true || !remoteSession || remoteSession.sessionId !== observedSessionId) {
          sessionId = null;
          setStatus("error", "Bridge session changed; reconnecting to local EditFlow runtime.");
          scheduleReconnect(0);
        }
      })
      .catch(function (error) {
        if (generation !== connectionGeneration) return;
        sessionId = null;
        setStatus("error", "Bridge disconnected: " + error.message);
        scheduleReconnect(0);
      });
  }

  function scheduleLiveness() {
    if (stopped) return;
    setTimeout(function () {
      livenessOnce()
        .then(scheduleLiveness)
        .catch(function () { scheduleLiveness(); });
    }, livenessDelayMs);
  }

  function connect() {
    if (stopped || connectInFlight) return;
    connectInFlight = true;

    var ready = hostReady
      ? Promise.resolve()
      : ensureHostDispatcher().then(function () { hostReady = true; });

    ready
      .then(register)
      .then(function () {
        connectInFlight = false;
      })
      .catch(function (error) {
        connectInFlight = false;
        sessionId = null;
        var message = error && error.message ? error.message : String(error);
        if (message.indexOf("Host bootstrap:") === 0) setStatus("error", message);
        else setStatus("error", "Local runtime unavailable: " + message);
        scheduleReconnect(reconnectDelayMs);
      });
  }

  function start() {
    if (stopped) return;
    try {
      assertConfig();
    } catch (error) {
      setStatus("error", error.message);
      return;
    }

    if (!livenessStarted) {
      livenessStarted = true;
      scheduleLiveness();
    }
    connect();
  }

  window.addEventListener("beforeunload", function () { stopped = true; });
  start();
}());
