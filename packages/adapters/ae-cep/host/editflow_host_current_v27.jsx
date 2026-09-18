(function () {
  "use strict";

  var currentFile = new File($.fileName);
  var hostDir = currentFile.parent;
  var acceptedLoader = new File(hostDir.fsName + "/editflow_host_current_v26.jsx");
  var timeRemap = new File(hostDir.fsName + "/editflow_host_m5_time_remap.jsx");

  if (!acceptedLoader.exists) throw new Error("EditFlow accepted protocol 2.6 host loader is missing: " + acceptedLoader.fsName);
  $.evalFile(acceptedLoader);
  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow accepted dispatcher failed before protocol 2.7 load.");

  var loadError = null;
  if (!timeRemap.exists) loadError = "EditFlow M5 Time Remap host script is missing: " + timeRemap.fsName;
  else {
    try { $.evalFile(timeRemap); }
    catch (error) { loadError = String(error); }
  }

  if (loadError !== null) {
    var dispatchBeforeFailure = $.global.EditFlow2_dispatch;
    $.global.EditFlow2_M5_TIME_REMAP_LOAD_ERROR = loadError;
    $.global.EditFlow2_dispatch = function (requestJson) {
      var request = null;
      try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) {}
      if (request && request.protocolVersion === "2.7.0") {
        return $.global.EditFlow2_JSON.stringify({
          protocolVersion: "2.7.0",
          requestId: request.requestId,
          transactionId: request.transactionId,
          operationId: request.operationId,
          capabilityId: request.capabilityId,
          command: request.command,
          outcome: "FAILED",
          error: {
            category: "ADAPTER_FAILURE",
            code: "M5_TIME_REMAP_MODULE_LOAD_FAILED",
            message: loadError,
            details: null
          },
          affectedObjects: [],
          readback: null,
          hostProjectRevision: app.project ? app.project.revision : null,
          diagnostics: {
            adapterProtocolVersion: "2.7.0",
            adapterBuild: "0.7.0-dev.1",
            command: request.command,
            notes: [
              "Protocol 2.7 Time Remap module failed to load; accepted protocol 1.1-2.6 dispatch remains available."
            ]
          }
        });
      }
      return dispatchBeforeFailure(requestJson);
    };
  }

  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow protocol 2.7 host dispatcher failed to register.");
  $.global.EditFlow2_HOST_PROTOCOL_27 = true;
}());
