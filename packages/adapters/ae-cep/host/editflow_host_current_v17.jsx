/* EditFlow 2.0 current AE host loader + additive M3 protocol 1.7 temporal interpolation. */
(function () {
  "use strict";

  var currentFile = new File($.fileName);
  var hostDir = currentFile.parent;
  var acceptedLoader = new File(hostDir.fsName + "/editflow_host_current_v16.jsx");
  var m3TemporalInterpolation = new File(hostDir.fsName + "/editflow_host_m3_temporal_interpolation.jsx");

  if (!acceptedLoader.exists) throw new Error("EditFlow accepted protocol 1.6 host loader is missing: " + acceptedLoader.fsName);
  $.evalFile(acceptedLoader);
  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow accepted dispatcher failed to register before protocol 1.7 load.");

  var temporalInterpolationLoadError = null;
  if (!m3TemporalInterpolation.exists) {
    temporalInterpolationLoadError = "EditFlow M3 temporal-interpolation host script is missing: " + m3TemporalInterpolation.fsName;
  } else {
    try {
      $.evalFile(m3TemporalInterpolation);
    } catch (temporalInterpolationError) {
      temporalInterpolationLoadError = String(temporalInterpolationError);
    }
  }

  if (temporalInterpolationLoadError !== null) {
    var dispatchBeforeTemporalInterpolationFailure = $.global.EditFlow2_dispatch;
    $.global.EditFlow2_M3_TEMPORAL_INTERPOLATION_LOAD_ERROR = temporalInterpolationLoadError;
    $.global.EditFlow2_dispatch = function (requestJson) {
      var request = null;
      try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) {}
      if (request && request.protocolVersion === "1.7.0") {
        return $.global.EditFlow2_JSON.stringify({
          protocolVersion: "1.7.0",
          requestId: request.requestId,
          transactionId: request.transactionId,
          operationId: request.operationId,
          capabilityId: request.capabilityId,
          command: request.command,
          outcome: "FAILED",
          error: {
            category: "ADAPTER_FAILURE",
            code: "M3_TEMPORAL_INTERPOLATION_MODULE_LOAD_FAILED",
            message: temporalInterpolationLoadError,
            details: null
          },
          affectedObjects: [],
          readback: null,
          hostProjectRevision: app.project ? app.project.revision : null,
          diagnostics: {
            adapterProtocolVersion: "1.7.0",
            adapterBuild: "0.4.0-dev.7",
            command: request.command,
            notes: ["Protocol 1.7 temporal-interpolation host module failed to load; accepted protocol 1.1-1.6 dispatch remains available."]
          }
        });
      }
      return dispatchBeforeTemporalInterpolationFailure(requestJson);
    };
  }

  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow protocol 1.7 host dispatcher failed to register.");
  $.global.EditFlow2_HOST_PROTOCOL_17 = true;
}());
