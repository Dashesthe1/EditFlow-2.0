/* EditFlow 2.0 current AE host loader + additive M3 protocol 1.5 managed null rigs. */
(function () {
  "use strict";

  var currentFile = new File($.fileName);
  var hostDir = currentFile.parent;
  var acceptedLoader = new File(hostDir.fsName + "/editflow_host_current.jsx");
  var m3NullRigs = new File(hostDir.fsName + "/editflow_host_m3_null_rigs.jsx");
  var m3NullRigProofCleanup = new File(hostDir.fsName + "/editflow_host_m3_null_rig_proof_cleanup.jsx");

  if (!acceptedLoader.exists) throw new Error("EditFlow accepted host loader is missing: " + acceptedLoader.fsName);
  $.evalFile(acceptedLoader);
  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow accepted dispatcher failed to register before protocol 1.5 load.");

  var nullRigLoadError = null;
  if (!m3NullRigs.exists) {
    nullRigLoadError = "EditFlow M3 null-rig host script is missing: " + m3NullRigs.fsName;
  } else {
    try {
      $.evalFile(m3NullRigs);
    } catch (nullRigError) {
      nullRigLoadError = String(nullRigError);
    }
  }

  if (nullRigLoadError !== null) {
    var dispatchBeforeNullRigFailure = $.global.EditFlow2_dispatch;
    $.global.EditFlow2_M3_NULL_RIG_LOAD_ERROR = nullRigLoadError;
    $.global.EditFlow2_dispatch = function (requestJson) {
      var request = null;
      try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) {}
      if (request && request.protocolVersion === "1.5.0") {
        return $.global.EditFlow2_JSON.stringify({
          protocolVersion: "1.5.0",
          requestId: request.requestId,
          transactionId: request.transactionId,
          operationId: request.operationId,
          capabilityId: request.capabilityId,
          command: request.command,
          outcome: "FAILED",
          error: {
            category: "ADAPTER_FAILURE",
            code: "M3_NULL_RIG_MODULE_LOAD_FAILED",
            message: nullRigLoadError,
            details: null
          },
          affectedObjects: [],
          readback: null,
          hostProjectRevision: app.project ? app.project.revision : null,
          diagnostics: {
            adapterProtocolVersion: "1.5.0",
            adapterBuild: "0.4.0-dev.5",
            command: request.command,
            notes: ["Protocol 1.5 null-rig host module failed to load; accepted protocol 1.1-1.4 dispatch remains available."]
          }
        });
      }
      return dispatchBeforeNullRigFailure(requestJson);
    };
  }

  if ($.getenv("EDITFLOW_M3_NULL_RIG_P4_PROOF") === "1") {
    if (!m3NullRigProofCleanup.exists) {
      throw new Error("EditFlow M3 null-rig proof cleanup is missing: " + m3NullRigProofCleanup.fsName);
    }
    $.evalFile(m3NullRigProofCleanup);
  }

  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow protocol 1.5 host dispatcher failed to register.");
}());
