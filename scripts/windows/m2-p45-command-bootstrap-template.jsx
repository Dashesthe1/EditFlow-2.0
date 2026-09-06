/* EditFlow 2.0 temporary command bootstrap for the disposable M2 P4/P5 proof.
 * Tokens are replaced by run-m2-ae-p4-p5.ps1 before the generated wrapper is
 * passed to the declared After Effects executable with the fixed `-r` switch.
 */
(function () {
  "use strict";

  var state = {
    proofPath: "__EDITFLOW_PROOF_PATH__",
    resultPath: "__EDITFLOW_RESULT_PATH__",
    logPath: "__EDITFLOW_LOG_PATH__",
    bootstrapPath: "__EDITFLOW_BOOTSTRAP_PATH__",
    attempts: 0,
    maxAttempts: 120
  };

  function appendLog(stage, detail) {
    try {
      var file = new File(state.logPath);
      file.encoding = "UTF-8";
      if (file.open("a")) {
        file.writeln((new Date()).toUTCString() + "\t" + stage + "\t" + String(detail || ""));
        file.close();
      }
    } catch (_) {}
  }

  function escapeJsonString(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/\"/g, "\\\"")
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n");
  }

  function writeFailure(message) {
    try {
      var result = new File(state.resultPath);
      result.encoding = "UTF-8";
      if (result.open("w")) {
        result.write("{\"proofId\":\"M2_REAL_AE_P4_P5_DISPOSABLE\",\"status\":\"BOOTSTRAP_FAILED\",\"ok\":false,\"bootstrap\":true,\"error\":\"" + escapeJsonString(message) + "\"}");
        result.close();
      }
    } catch (_) {}
  }

  try {
    var bootstrapFile = new File(state.bootstrapPath);
    if (bootstrapFile.exists) bootstrapFile.remove();
  } catch (_) {}

  $.global.EditFlow2_m2P45CommandState = state;
  $.global.EditFlow2_runM2P45CommandProof = function () {
    var current = $.global.EditFlow2_m2P45CommandState;
    current.attempts += 1;

    try {
      if (!app.project) {
        if (current.attempts >= current.maxAttempts) {
          appendLog("PROJECT_NOT_READY", "attempts=" + current.attempts);
          writeFailure("After Effects did not expose a project to the command P4/P5 bootstrap.");
          return;
        }
        var retryId = app.scheduleTask("$.global.EditFlow2_runM2P45CommandProof()", 250, false);
        appendLog("PROJECT_RETRY_SCHEDULED", "attempt=" + current.attempts + ";taskId=" + retryId);
        return;
      }

      var proof = new File(current.proofPath);
      if (!proof.exists) {
        appendLog("PROOF_MISSING", proof.fsName);
        writeFailure("P4/P5 proof script is missing: " + proof.fsName);
        return;
      }

      appendLog("PROOF_STARTED", "attempt=" + current.attempts + ";projectFile=" + (app.project.file ? app.project.file.fsName : "UNSAVED") + ";items=" + app.project.numItems);
      $.evalFile(proof);
      appendLog("PROOF_RETURNED", "resultExists=" + (new File(current.resultPath)).exists);
    } catch (error) {
      appendLog("PROOF_THROW", String(error));
      writeFailure("Command P4/P5 proof threw before producing its result: " + String(error));
    }
  };

  appendLog("COMMAND_BOOTSTRAP_LOADED", "proof=" + state.proofPath + ";bootstrap=" + state.bootstrapPath);
  $.global.EditFlow2_runM2P45CommandProof();
}());
