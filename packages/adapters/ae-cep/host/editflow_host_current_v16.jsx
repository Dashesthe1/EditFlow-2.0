/* EditFlow 2.0 current AE host loader + additive M3 protocol 1.6 layer controls. */
(function () {
  "use strict";

  var currentFile = new File($.fileName);
  var hostDir = currentFile.parent;
  var acceptedLoader = new File(hostDir.fsName + "/editflow_host_current_v15.jsx");
  var m3LayerControls = new File(hostDir.fsName + "/editflow_host_m3_layer_controls.jsx");
  var m3LayerControlsProofCleanup = new File(hostDir.fsName + "/editflow_host_m3_layer_controls_proof_cleanup.jsx");

  if (!acceptedLoader.exists) throw new Error("EditFlow protocol 1.5 host loader is missing: " + acceptedLoader.fsName);
  $.evalFile(acceptedLoader);
  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow protocol 1.5 dispatcher failed to register before protocol 1.6 load.");

  var layerControlsLoadError = null;
  if (!m3LayerControls.exists) {
    layerControlsLoadError = "EditFlow M3 layer-controls host script is missing: " + m3LayerControls.fsName;
  } else {
    try {
      $.evalFile(m3LayerControls);
    } catch (layerControlsError) {
      layerControlsLoadError = String(layerControlsError);
    }
  }

  if (layerControlsLoadError !== null) {
    var dispatchBeforeLayerControlsFailure = $.global.EditFlow2_dispatch;
    $.global.EditFlow2_M3_LAYER_CONTROLS_LOAD_ERROR = layerControlsLoadError;
    $.global.EditFlow2_dispatch = function (requestJson) {
      var request = null;
      try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) {}
      if (request && request.protocolVersion === "1.6.0") {
        return $.global.EditFlow2_JSON.stringify({
          protocolVersion: "1.6.0",
          requestId: request.requestId,
          transactionId: request.transactionId,
          operationId: request.operationId,
          capabilityId: request.capabilityId,
          command: request.command,
          outcome: "FAILED",
          error: {
            category: "ADAPTER_FAILURE",
            code: "M3_LAYER_CONTROLS_MODULE_LOAD_FAILED",
            message: layerControlsLoadError,
            details: null
          },
          affectedObjects: [],
          readback: null,
          hostProjectRevision: app.project ? app.project.revision : null,
          diagnostics: {
            adapterProtocolVersion: "1.6.0",
            adapterBuild: "0.4.0-dev.6",
            command: request.command,
            notes: ["Protocol 1.6 layer-controls host module failed to load; accepted protocol 1.1-1.5 dispatch remains available."]
          }
        });
      }
      return dispatchBeforeLayerControlsFailure(requestJson);
    };
  }

  if ($.getenv("EDITFLOW_M3_LAYER_CONTROLS_P4_PROOF") === "1") {
    if (!m3LayerControlsProofCleanup.exists) {
      throw new Error("EditFlow M3 layer-controls proof cleanup is missing: " + m3LayerControlsProofCleanup.fsName);
    }
    $.evalFile(m3LayerControlsProofCleanup);
  }

  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow protocol 1.6 host dispatcher failed to register.");
}());