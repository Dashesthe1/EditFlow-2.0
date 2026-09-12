/* EditFlow 2.0 current AE host loader + additive M4 protocol 2.2 Detailed Face Tracking readback. */
(function () {
  "use strict";
  var currentFile = new File($.fileName);
  var hostDir = currentFile.parent;
  var acceptedLoader = new File(hostDir.fsName + "/editflow_host_current_v21.jsx");
  var faceTracking = new File(hostDir.fsName + "/editflow_host_m4_face_tracking.jsx");
  if (!acceptedLoader.exists) throw new Error("EditFlow accepted protocol 2.1 host loader is missing: " + acceptedLoader.fsName);
  $.evalFile(acceptedLoader);
  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow accepted dispatcher failed before protocol 2.2 load.");

  var loadError = null;
  if (!faceTracking.exists) loadError = "EditFlow M4 face-tracking host script is missing: " + faceTracking.fsName;
  else { try { $.evalFile(faceTracking); } catch (error) { loadError = String(error); } }
  if (loadError !== null) {
    var dispatchBeforeFailure = $.global.EditFlow2_dispatch;
    $.global.EditFlow2_M4_FACE_TRACKING_LOAD_ERROR = loadError;
    $.global.EditFlow2_dispatch = function (requestJson) {
      var request = null;
      try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) {}
      if (request && request.protocolVersion === "2.2.0") {
        return $.global.EditFlow2_JSON.stringify({
          protocolVersion: "2.2.0", requestId: request.requestId, transactionId: request.transactionId,
          operationId: request.operationId, capabilityId: request.capabilityId, command: request.command,
          outcome: "FAILED", error: { category: "ADAPTER_FAILURE", code: "M4_FACE_TRACKING_MODULE_LOAD_FAILED", message: loadError, details: null },
          affectedObjects: [], readback: null, hostProjectRevision: app.project ? app.project.revision : null,
          diagnostics: { adapterProtocolVersion: "2.2.0", adapterBuild: "0.5.0-dev.1", command: request.command, notes: ["Protocol 2.2 face-tracking module failed to load; accepted protocol 1.1-2.1 dispatch remains available."] }
        });
      }
      return dispatchBeforeFailure(requestJson);
    };
  }
  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow protocol 2.2 host dispatcher failed to register.");
  $.global.EditFlow2_HOST_PROTOCOL_22 = true;
}());
