/* EditFlow 2.0 current AE host loader + additive M3 protocol 1.8 temporal ease. */
(function () {
  "use strict";

  var currentFile = new File($.fileName);
  var hostDir = currentFile.parent;
  var acceptedLoader = new File(hostDir.fsName + "/editflow_host_current_v17.jsx");
  var m3TemporalEase = new File(hostDir.fsName + "/editflow_host_m3_temporal_ease.jsx");

  if (!acceptedLoader.exists) throw new Error("EditFlow accepted protocol 1.7 host loader is missing: " + acceptedLoader.fsName);
  $.evalFile(acceptedLoader);
  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow accepted dispatcher failed to register before protocol 1.8 load.");

  var temporalEaseLoadError = null;
  if (!m3TemporalEase.exists) {
    temporalEaseLoadError = "EditFlow M3 temporal-ease host script is missing: " + m3TemporalEase.fsName;
  } else {
    try {
      $.evalFile(m3TemporalEase);
    } catch (temporalEaseError) {
      temporalEaseLoadError = String(temporalEaseError);
    }
  }

  if (temporalEaseLoadError !== null) {
    var dispatchBeforeTemporalEaseFailure = $.global.EditFlow2_dispatch;
    $.global.EditFlow2_M3_TEMPORAL_EASE_LOAD_ERROR = temporalEaseLoadError;
    $.global.EditFlow2_dispatch = function (requestJson) {
      var request = null;
      try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) {}
      if (request && request.protocolVersion === "1.8.0") {
        return $.global.EditFlow2_JSON.stringify({
          protocolVersion: "1.8.0",
          requestId: request.requestId,
          transactionId: request.transactionId,
          operationId: request.operationId,
          capabilityId: request.capabilityId,
          command: request.command,
          outcome: "FAILED",
          error: {
            category: "ADAPTER_FAILURE",
            code: "M3_TEMPORAL_EASE_MODULE_LOAD_FAILED",
            message: temporalEaseLoadError,
            details: null
          },
          affectedObjects: [],
          readback: null,
          hostProjectRevision: app.project ? app.project.revision : null,
          diagnostics: {
            adapterProtocolVersion: "1.8.0",
            adapterBuild: "0.4.0-dev.8",
            command: request.command,
            notes: ["Protocol 1.8 temporal-ease host module failed to load; accepted protocol 1.1-1.7 dispatch remains available."]
          }
        });
      }
      return dispatchBeforeTemporalEaseFailure(requestJson);
    };
  }

  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow protocol 1.8 host dispatcher failed to register.");
  $.global.EditFlow2_HOST_PROTOCOL_18 = true;
}());
