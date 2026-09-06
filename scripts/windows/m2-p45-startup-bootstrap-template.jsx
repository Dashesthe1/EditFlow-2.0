/* EditFlow 2.0 temporary cold-start bootstrap for the disposable M2 P4/P5 proof.
 * Tokens are replaced by run-m2-ae-p4-p5.ps1 before this file is copied into
 * the current user's After Effects Scripts/Startup folder.
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

  try {
    var bootstrapFile = new File(state.bootstrapPath);
    if (bootstrapFile.exists) bootstrapFile.remove();
  } catch (_) {}

  $.global.EditFlow2_m2P45StartupState = state;
  $.global.EditFlow2_runM2P45Startup = function () {
    var current = $.global.EditFlow2_m2P45StartupState;

    function taskLog(stage, detail) {
      try {
        var file = new File(current.logPath);
        file.encoding = "UTF-8";
        if (file.open("a")) {
          file.writeln((new Date()).toUTCString() + "\t" + stage + "\t" + String(detail || ""));
          file.close();
        }
      } catch (_) {}
    }

    function taskEscape(value) {
      return String(value || "")
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, "\\\"")
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
    }

    function taskFailure(message) {
      try {
        var result = new File(current.resultPath);
        result.encoding = "UTF-8";
        if (result.open("w")) {
          result.write("{\"proofId\":\"M2_REAL_AE_P4_P5_DISPOSABLE\",\"status\":\"BOOTSTRAP_FAILED\",\"ok\":false,\"bootstrap\":true,\"error\":\"" + taskEscape(message) + "\"}");
          result.close();
        }
      } catch (_) {}
    }

    try {
      current.attempts += 1;
      if (!app.project) {
        if (current.attempts >= current.maxAttempts) {
          taskLog("PROJECT_NOT_READY", "attempts=" + current.attempts);
          taskFailure("After Effects did not expose a project to the cold-start P4/P5 bootstrap.");
          return;
        }
        app.scheduleTask("$.global.EditFlow2_runM2P45Startup()", 250, false);
        return;
      }

      var proof = new File(current.proofPath);
      if (!proof.exists) {
        taskLog("PROOF_MISSING", proof.fsName);
        taskFailure("P4/P5 proof script is missing: " + proof.fsName);
        return;
      }

      taskLog("PROOF_STARTED", "attempt=" + current.attempts + ";projectFile=" + (app.project.file ? app.project.file.fsName : "UNSAVED") + ";items=" + app.project.numItems);
      $.evalFile(proof);
      taskLog("PROOF_RETURNED", "resultExists=" + (new File(current.resultPath)).exists);
    } catch (error) {
      taskLog("PROOF_THROW", String(error));
      taskFailure("Cold-start P4/P5 proof threw before producing its result: " + String(error));
    }
  };

  appendLog("BOOTSTRAP_LOADED", "proof=" + state.proofPath);
  var taskId = app.scheduleTask("$.global.EditFlow2_runM2P45Startup()", 750, false);
  appendLog("PROOF_SCHEDULED", "taskId=" + taskId);
}());
