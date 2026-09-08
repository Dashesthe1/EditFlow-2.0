/* EditFlow 2.0 current AE host loader + additive M3 protocol 1.9 spatial Graph Editor. */
(function () {
  "use strict";

  var currentFile = new File($.fileName);
  var hostDir = currentFile.parent;
  var acceptedLoader = new File(hostDir.fsName + "/editflow_host_current_v18.jsx");
  var m3SpatialGraph = new File(hostDir.fsName + "/editflow_host_m3_spatial_graph.jsx");

  if (!acceptedLoader.exists) throw new Error("EditFlow accepted protocol 1.8 host loader is missing: " + acceptedLoader.fsName);
  $.evalFile(acceptedLoader);
  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow accepted dispatcher failed to register before protocol 1.9 load.");

  var loadError = null;
  if (!m3SpatialGraph.exists) loadError = "EditFlow M3 spatial-graph host script is missing: " + m3SpatialGraph.fsName;
  else {
    try { $.evalFile(m3SpatialGraph); }
    catch (error) { loadError = String(error); }
  }

  if (loadError !== null) {
    var dispatchBeforeFailure = $.global.EditFlow2_dispatch;
    $.global.EditFlow2_M3_SPATIAL_GRAPH_LOAD_ERROR = loadError;
    $.global.EditFlow2_dispatch = function (requestJson) {
      var request = null;
      try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) {}
      if (request && request.protocolVersion === "1.9.0") {
        return $.global.EditFlow2_JSON.stringify({
          protocolVersion: "1.9.0", requestId: request.requestId, transactionId: request.transactionId,
          operationId: request.operationId, capabilityId: request.capabilityId, command: request.command,
          outcome: "FAILED", error: { category: "ADAPTER_FAILURE", code: "M3_SPATIAL_GRAPH_MODULE_LOAD_FAILED", message: loadError, details: null },
          affectedObjects: [], readback: null, hostProjectRevision: app.project ? app.project.revision : null,
          diagnostics: { adapterProtocolVersion: "1.9.0", adapterBuild: "0.4.0-dev.9", command: request.command, notes: ["Protocol 1.9 spatial-graph host module failed to load; accepted protocol 1.1-1.8 dispatch remains available."] }
        });
      }
      return dispatchBeforeFailure(requestJson);
    };
  }

  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow protocol 1.9 host dispatcher failed to register.");
  $.global.EditFlow2_HOST_PROTOCOL_19 = true;
}());
