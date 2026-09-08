/* EditFlow 2.0 current AE host loader + additive M3 protocol 2.0 marker/motion controls. */
(function () {
  "use strict";

  var currentFile = new File($.fileName);
  var hostDir = currentFile.parent;
  var acceptedLoader = new File(hostDir.fsName + "/editflow_host_current_v19.jsx");
  var m3MarkerMotion = new File(hostDir.fsName + "/editflow_host_m3_marker_motion.jsx");
  var m3MarkerMotionAtomicity = new File(hostDir.fsName + "/editflow_host_m3_marker_motion_atomicity.jsx");
  var m3MarkerMotionProofCleanup = new File(hostDir.fsName + "/editflow_host_m3_marker_motion_proof_cleanup.jsx");
  var p4ProofMode = $.getenv("EDITFLOW_M3_MARKER_MOTION_P4_PROOF") === "1";

  if (!acceptedLoader.exists) throw new Error("EditFlow accepted protocol 1.9 host loader is missing: " + acceptedLoader.fsName);
  $.evalFile(acceptedLoader);
  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow accepted dispatcher failed to register before protocol 2.0 load.");

  var loadError = null;
  if (!m3MarkerMotion.exists) loadError = "EditFlow M3 marker-motion host script is missing: " + m3MarkerMotion.fsName;
  else {
    try { $.evalFile(m3MarkerMotion); }
    catch (error) { loadError = String(error); }
  }

  if (loadError !== null) {
    var dispatchBeforeFailure = $.global.EditFlow2_dispatch;
    $.global.EditFlow2_M3_MARKER_MOTION_LOAD_ERROR = loadError;
    $.global.EditFlow2_dispatch = function (requestJson) {
      var request = null;
      try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) {}
      if (request && request.protocolVersion === "2.0.0") {
        return $.global.EditFlow2_JSON.stringify({
          protocolVersion: "2.0.0", requestId: request.requestId, transactionId: request.transactionId,
          operationId: request.operationId, capabilityId: request.capabilityId, command: request.command,
          outcome: "FAILED", error: { category: "ADAPTER_FAILURE", code: "M3_MARKER_MOTION_MODULE_LOAD_FAILED", message: loadError, details: null },
          affectedObjects: [], readback: null, hostProjectRevision: app.project ? app.project.revision : null,
          diagnostics: { adapterProtocolVersion: "2.0.0", adapterBuild: "0.4.0-dev.10", command: request.command, notes: ["Protocol 2.0 marker-motion host module failed to load; accepted protocol 1.1-1.9 dispatch remains available."] }
        });
      }
      return dispatchBeforeFailure(requestJson);
    };
  }

  /* The accepted P1/P2 preview lineage predates this additive guard, so a missing
   * atomicity file remains compatible outside P4 proof mode. P3/P4 explicitly
   * installs both the atomicity and guarded cleanup modules. */
  var atomicityLoadError = null;
  if (loadError === null) {
    if (!m3MarkerMotionAtomicity.exists) {
      if (p4ProofMode) atomicityLoadError = "EditFlow M3 marker-motion atomicity script is required for P4 proof mode: " + m3MarkerMotionAtomicity.fsName;
    } else {
      try { $.evalFile(m3MarkerMotionAtomicity); }
      catch (atomicityError) { atomicityLoadError = String(atomicityError); }
    }
  }

  if (atomicityLoadError !== null) {
    var dispatchBeforeAtomicityFailure = $.global.EditFlow2_dispatch;
    $.global.EditFlow2_M3_MARKER_MOTION_ATOMICITY_LOAD_ERROR = atomicityLoadError;
    $.global.EditFlow2_dispatch = function (requestJson) {
      var request = null;
      try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) {}
      if (request && request.protocolVersion === "2.0.0") {
        return $.global.EditFlow2_JSON.stringify({
          protocolVersion: "2.0.0", requestId: request.requestId, transactionId: request.transactionId,
          operationId: request.operationId, capabilityId: request.capabilityId, command: request.command,
          outcome: "FAILED", error: { category: "ADAPTER_FAILURE", code: "M3_MARKER_MOTION_ATOMICITY_LOAD_FAILED", message: atomicityLoadError, details: null },
          affectedObjects: [], readback: null, hostProjectRevision: app.project ? app.project.revision : null,
          diagnostics: { adapterProtocolVersion: "2.0.0", adapterBuild: "0.4.0-dev.10.2-loader", command: request.command, notes: ["Protocol 2.0 atomicity guard failed to load; protocol 2.0 traffic is blocked before further proof mutation."] }
        });
      }
      return dispatchBeforeAtomicityFailure(requestJson);
    };
  }

  var proofCleanupLoadError = null;
  if (p4ProofMode && loadError === null && atomicityLoadError === null) {
    if (!m3MarkerMotionProofCleanup.exists) proofCleanupLoadError = "EditFlow M3 marker-motion proof cleanup script is required for P4 proof mode: " + m3MarkerMotionProofCleanup.fsName;
    else {
      try { $.evalFile(m3MarkerMotionProofCleanup); }
      catch (cleanupError) { proofCleanupLoadError = String(cleanupError); }
    }
  }

  if (proofCleanupLoadError !== null) {
    var dispatchBeforeCleanupFailure = $.global.EditFlow2_dispatch;
    $.global.EditFlow2_M3_MARKER_MOTION_PROOF_CLEANUP_LOAD_ERROR = proofCleanupLoadError;
    $.global.EditFlow2_dispatch = function (requestJson) {
      var request = null;
      try { request = $.global.EditFlow2_JSON.parse(requestJson); } catch (_) {}
      if (request && request.protocolVersion === "2.0.0") {
        return $.global.EditFlow2_JSON.stringify({
          protocolVersion: "2.0.0", requestId: request.requestId, transactionId: request.transactionId,
          operationId: request.operationId, capabilityId: request.capabilityId, command: request.command,
          outcome: "FAILED", error: { category: "ADAPTER_FAILURE", code: "M3_MARKER_MOTION_PROOF_CLEANUP_LOAD_FAILED", message: proofCleanupLoadError, details: null },
          affectedObjects: [], readback: null, hostProjectRevision: app.project ? app.project.revision : null,
          diagnostics: { adapterProtocolVersion: "2.0.0", adapterBuild: "0.4.0-dev.10.2-proof-cleanup", command: request.command, notes: ["P4 proof cleanup guard failed to load; protocol 2.0 proof traffic is blocked before mutation."] }
        });
      }
      return dispatchBeforeCleanupFailure(requestJson);
    };
  }

  if (typeof $.global.EditFlow2_dispatch !== "function") throw new Error("EditFlow protocol 2.0 host dispatcher failed to register.");
  $.global.EditFlow2_HOST_PROTOCOL_20 = true;
}());
