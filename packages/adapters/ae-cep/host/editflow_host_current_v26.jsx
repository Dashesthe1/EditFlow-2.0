/* EditFlow 2.0 current AE host loader + additive M5 protocol 2.6 Roto Brush readback. */
(function () {
  "use strict";
  var currentFile = new File($.fileName);
  var hostDir = currentFile.parent;
  var acceptedLoader = new File(hostDir.fsName + "/editflow_host_current_v25.jsx");
  var rotoBrush = new File(hostDir.fsName + "/editflow_host_m5_roto_brush.jsx");
  if (!acceptedLoader.exists) throw new Error("EditFlow accepted protocol 2.5 host loader is missing: " + acceptedLoader.fsName);
  $.evalFile(acceptedLoader);
  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow accepted dispatcher failed before protocol 2.6 load.");
  var loadError = null;
  if (!rotoBrush.exists) loadError = "EditFlow M5 Roto Brush host script is missing: " + rotoBrush.fsName;
  else { try { $.evalFile(rotoBrush); } catch (error) { loadError = String(error); } }
  if (loadError !== null) {
    var dispatchBeforeFailure = $.global.EditFlow2_dispatch;
    $.global.EditFlow2_M5_ROTO_BRUSH_LOAD_ERROR = loadError;
    $.global.EditFlow2_dispatch = function (requestJson) {
      var request = null;
      try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) {}
      if (request && request.protocolVersion === "2.6.0") {
        return $.global.EditFlow2_JSON.stringify({ protocolVersion: "2.6.0", requestId: request.requestId, transactionId: request.transactionId, operationId: request.operationId, capabilityId: request.capabilityId, command: request.command, outcome: "FAILED", error: { category: "ADAPTER_FAILURE", code: "M5_ROTO_BRUSH_MODULE_LOAD_FAILED", message: loadError, details: null }, affectedObjects: [], readback: null, hostProjectRevision: app.project ? app.project.revision : null, diagnostics: { adapterProtocolVersion: "2.6.0", adapterBuild: "0.6.0-dev.2", command: request.command, notes: ["Protocol 2.6 Roto Brush module failed to load; accepted protocol 1.1-2.5 dispatch remains available."] } });
      }
      return dispatchBeforeFailure(requestJson);
    };
  }
  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow protocol 2.6 host dispatcher failed to register.");
  $.global.EditFlow2_HOST_PROTOCOL_26 = true;
}());