/* EditFlow 2.0 AE host operation-atomicity wrapper for protocol 1.1. */
(function () {
  var PROTOCOL = "1.1.0";
  var BUILD = "0.1.0-dev.3";
  var innerDispatch = $.global.EditFlow2_dispatch;
  if (typeof innerDispatch !== "function") throw new Error("EditFlow atomicity wrapper requires the current dispatcher.");

  function isMutation(command) {
    return command !== "host.probe"
      && command !== "project.inspect"
      && command !== "readback.object"
      && command !== "transaction.undo_last";
  }

  $.global.EditFlow2_dispatch = function (requestJson) {
    var request = null;
    var beforeRevision = app.project ? app.project.revision : null;
    try { request = JSON.parse(requestJson); } catch (_) {}
    var raw = innerDispatch(requestJson);
    var response = null;
    try { response = JSON.parse(raw); } catch (_) { return raw; }

    if (request && request.protocolVersion === PROTOCOL && isMutation(request.command)
        && response.outcome === "FAILED" && app.project && beforeRevision !== null
        && app.project.revision !== beforeRevision) {
      var revisionAfterFailure = app.project.revision;
      try {
        app.executeCommand(16);
        response.hostProjectRevision = app.project.revision;
        response.diagnostics = response.diagnostics || {};
        response.diagnostics.adapterProtocolVersion = PROTOCOL;
        response.diagnostics.adapterBuild = BUILD;
        response.diagnostics.hostRevisionAfter = app.project.revision;
        response.diagnostics.notes = response.diagnostics.notes || [];
        response.diagnostics.notes.push(
          "Failed mutation changed AE revision " + beforeRevision + " -> " + revisionAfterFailure
          + "; fixed Undo command ID 16 was applied to self-rollback the failed operation."
        );
      } catch (rollbackError) {
        response.error = response.error || { category: "ADAPTER_FAILURE", code: "HOST_COMMAND_FAILED", message: "Host command failed." };
        response.error.details = {
          failedOperationRevisionBefore: beforeRevision,
          failedOperationRevisionAfter: revisionAfterFailure,
          selfRollbackError: String(rollbackError)
        };
        response.error.code = "FAILED_OPERATION_SELF_ROLLBACK_FAILED";
      }
      return JSON.stringify(response);
    }

    return raw;
  };
}());
