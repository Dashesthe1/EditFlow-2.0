/* EditFlow 2.0 current AE host loader + additive M3 protocol 1.10 motion render controls. */
(function () {
  "use strict";

  var currentFile = new File($.fileName);
  var hostDir = currentFile.parent;
  var acceptedLoader = new File(hostDir.fsName + "/editflow_host_current_v19.jsx");
  var m3MotionRender = new File(hostDir.fsName + "/editflow_host_m3_motion_render.jsx");

  if (!acceptedLoader.exists) throw new Error("EditFlow accepted protocol 1.9 host loader is missing: " + acceptedLoader.fsName);
  $.evalFile(acceptedLoader);
  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow accepted dispatcher failed to register before protocol 1.10 load.");

  var loadError = null;
  if (!m3MotionRender.exists) loadError = "EditFlow M3 motion-render host script is missing: " + m3MotionRender.fsName;
  else {
    try { $.evalFile(m3MotionRender); }
    catch (error) { loadError = String(error); }
  }

  if (loadError !== null) {
    var dispatchBeforeFailure = $.global.EditFlow2_dispatch;
    $.global.EditFlow2_M3_MOTION_RENDER_LOAD_ERROR = loadError;
    $.global.EditFlow2_dispatch = function (requestJson) {
      var request = null;
      try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) {}
      if (request && request.protocolVersion === "1.10.0") {
        return $.global.EditFlow2_JSON.stringify({
          protocolVersion: "1.10.0", requestId: request.requestId, transactionId: request.transactionId,
          operationId: request.operationId, capabilityId: request.capabilityId, command: request.command,
          outcome: "FAILED", error: { category: "ADAPTER_FAILURE", code: "M3_MOTION_RENDER_MODULE_LOAD_FAILED", message: loadError, details: null },
          affectedObjects: [], readback: null, hostProjectRevision: app.project ? app.project.revision : null,
          diagnostics: { adapterProtocolVersion: "1.10.0", adapterBuild: "0.4.0-dev.10", command: request.command, notes: ["Protocol 1.10 motion-render host module failed to load; accepted protocol 1.1-1.9 dispatch remains available."] }
        });
      }
      return dispatchBeforeFailure(requestJson);
    };
  }

  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow protocol 1.10 host dispatcher failed to register.");
  $.global.EditFlow2_HOST_PROTOCOL_110 = true;
}());
