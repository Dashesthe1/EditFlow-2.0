/* EditFlow 2.0 current AE host loader + additive M4 protocol 2.1 point-tracking readback. */
(function () {
  "use strict";
  var currentFile = new File($.fileName);
  var hostDir = currentFile.parent;
  var acceptedLoader = new File(hostDir.fsName + "/editflow_host_current_v20.jsx");
  var pointTracking = new File(hostDir.fsName + "/editflow_host_m4_point_tracking.jsx");
  if (!acceptedLoader.exists) throw new Error("EditFlow accepted protocol 2.0 host loader is missing: " + acceptedLoader.fsName);
  $.evalFile(acceptedLoader);
  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow accepted dispatcher failed before protocol 2.1 load.");

  var loadError = null;
  if (!pointTracking.exists) loadError = "EditFlow M4 point-tracking host script is missing: " + pointTracking.fsName;
  else { try { $.evalFile(pointTracking); } catch (error) { loadError = String(error); } }
  if (loadError !== null) {
    var dispatchBeforeFailure = $.global.EditFlow2_dispatch;
    $.global.EditFlow2_M4_POINT_TRACKING_LOAD_ERROR = loadError;
    $.global.EditFlow2_dispatch = function (requestJson) {
      var request = null;
      try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) {}
      if (request && request.protocolVersion === "2.1.0") {
        return $.global.EditFlow2_JSON.stringify({
          protocolVersion: "2.1.0", requestId: request.requestId, transactionId: request.transactionId,
          operationId: request.operationId, capabilityId: request.capabilityId, command: request.command,
          outcome: "FAILED", error: { category: "ADAPTER_FAILURE", code: "M4_POINT_TRACKING_MODULE_LOAD_FAILED", message: loadError, details: null },
          affectedObjects: [], readback: null, hostProjectRevision: app.project ? app.project.revision : null,
          diagnostics: { adapterProtocolVersion: "2.1.0", adapterBuild: "0.5.0-dev.1", command: request.command, notes: ["Protocol 2.1 point-tracking module failed to load; accepted protocol 1.1-2.0 dispatch remains available."] }
        });
      }
      return dispatchBeforeFailure(requestJson);
    };
  }
  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow protocol 2.1 host dispatcher failed to register.");
  $.global.EditFlow2_HOST_PROTOCOL_21 = true;
}());
