/* EditFlow 2.0 current AE host loader + additive M4 protocol 2.4 tracker-repair write/readback. */
(function () {
  "use strict";
  var currentFile = new File($.fileName);
  var hostDir = currentFile.parent;
  var acceptedLoader = new File(hostDir.fsName + "/editflow_host_current_v23.jsx");
  var repair = new File(hostDir.fsName + "/editflow_host_m4_repair_resume.jsx");
  if (!acceptedLoader.exists) throw new Error("EditFlow accepted protocol 2.3 host loader is missing: " + acceptedLoader.fsName);
  $.evalFile(acceptedLoader);
  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow accepted dispatcher failed before protocol 2.4 load.");
  var loadError = null;
  if (!repair.exists) loadError = "EditFlow M4 tracker-repair host script is missing: " + repair.fsName;
  else { try { $.evalFile(repair); } catch (error) { loadError = String(error); } }
  if (loadError !== null) {
    var dispatchBeforeFailure = $.global.EditFlow2_dispatch;
    $.global.EditFlow2_M4_TRACKER_REPAIR_LOAD_ERROR = loadError;
    $.global.EditFlow2_dispatch = function (requestJson) {
      var request = null;
      try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) {}
      if (request && request.protocolVersion === "2.4.0") {
        return $.global.EditFlow2_JSON.stringify({ protocolVersion: "2.4.0", requestId: request.requestId, transactionId: request.transactionId, operationId: request.operationId, capabilityId: request.capabilityId, command: request.command, outcome: "FAILED", error: { category: "ADAPTER_FAILURE", code: "M4_TRACKER_REPAIR_MODULE_LOAD_FAILED", message: loadError, details: null }, affectedObjects: [], readback: null, hostProjectRevision: app.project ? app.project.revision : null, diagnostics: { adapterProtocolVersion: "2.4.0", adapterBuild: "0.5.0-dev.1", command: request.command, notes: ["Protocol 2.4 tracker-repair module failed to load; accepted protocol 1.1-2.3 dispatch remains available."] } });
      }
      return dispatchBeforeFailure(requestJson);
    };
  }
  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow protocol 2.4 host dispatcher failed to register.");
  $.global.EditFlow2_HOST_PROTOCOL_24 = true;
}());
