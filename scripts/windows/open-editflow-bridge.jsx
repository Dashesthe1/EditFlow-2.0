/* EditFlow 2.0 self-hosted test bootstrap.
 *
 * This fixed script is invoked only by the controlled Windows self-hosted
 * launchers. It opens the checked-in CEP panel through After Effects' own menu
 * command API so the authenticated bridge can register without manual UI input.
 *
 * No caller-supplied script text or menu command is executed. A bounded diagnostic
 * log in Folder.temp proves whether the bootstrap script ran, whether AE exposed
 * the panel menu command, and whether executeCommand was reached.
 */
(function () {
  "use strict";

  function appendBootstrapEvidence(stage, detail) {
    var marker = new File(Folder.temp.fsName + "/EditFlow2-self-hosted-panel-bootstrap.log");
    marker.encoding = "UTF-8";
    if (!marker.open("a")) return;
    try {
      marker.writeln((new Date()).toUTCString() + "\t" + stage + "\t" + (detail || ""));
    } finally {
      marker.close();
    }
  }

  var loadedPath = $.fileName;
  appendBootstrapEvidence("SCRIPT_STARTED", loadedPath);

  /* The self-hosted runner may copy this source to a uniquely owned Startup filename.
   * Delete only that temporary copy after AE has loaded it so an interrupted runner
   * cannot leave a bootstrap that runs during a later user-initiated AE session. */
  try {
    var selfFile = new File(loadedPath);
    if (selfFile.name === "EditFlow2-self-hosted-bootstrap.jsx") {
      var removed = selfFile.remove();
      appendBootstrapEvidence("STARTUP_FILE_SELF_DELETE", "removed=" + removed + ";path=" + selfFile.fsName);
    }
  } catch (selfDeleteError) {
    appendBootstrapEvidence("STARTUP_FILE_SELF_DELETE_ERROR", String(selfDeleteError));
  }

  $.global.EditFlow2_selfHostedBridgeOpenAttempts = 0;

  $.global.EditFlow2_selfHostedOpenBridge = function () {
    var menuName = "EditFlow 2.0 Bridge";
    var maxAttempts = 120;
    var retryDelayMs = 500;
    var attempts = Number($.global.EditFlow2_selfHostedBridgeOpenAttempts || 0) + 1;
    $.global.EditFlow2_selfHostedBridgeOpenAttempts = attempts;

    function taskWrite(stage, detail) {
      var marker = new File(Folder.temp.fsName + "/EditFlow2-self-hosted-panel-bootstrap.log");
      marker.encoding = "UTF-8";
      if (!marker.open("a")) return;
      try {
        marker.writeln((new Date()).toUTCString() + "\t" + stage + "\t" + (detail || ""));
      } finally {
        marker.close();
      }
    }

    try {
      var commandId = app.findMenuCommandId(menuName);
      taskWrite("MENU_PROBE", "attempt=" + attempts + ";commandId=" + commandId);
      if (typeof commandId === "number" && commandId > 0) {
        taskWrite("MENU_FOUND", "attempt=" + attempts + ";commandId=" + commandId);
        app.executeCommand(commandId);
        taskWrite("EXECUTE_COMMAND_SENT", "commandId=" + commandId);
        $.global.EditFlow2_selfHostedBridgeOpened = true;
        return;
      }
    } catch (error) {
      taskWrite("MENU_PROBE_ERROR", "attempt=" + attempts + ";error=" + String(error));
    }

    if (attempts < maxAttempts) {
      var taskId = app.scheduleTask("$.global.EditFlow2_selfHostedOpenBridge()", retryDelayMs, false);
      taskWrite("RETRY_SCHEDULED", "attempt=" + attempts + ";taskId=" + taskId);
    } else {
      taskWrite("RETRY_EXHAUSTED", "attempts=" + attempts);
      $.global.EditFlow2_selfHostedBridgeOpenFailed = true;
    }
  };

  /* The proven command-bootstrap shape performs its first action synchronously.
   * Some AE -r invocations execute the script but do not service a newly scheduled
   * first callback. A direct first probe/open avoids that dead zone; scheduleTask
   * remains only as a bounded retry mechanism if the menu is not ready yet. */
  appendBootstrapEvidence("INITIAL_ATTEMPT_DIRECT", "attempt=1");
  $.global.EditFlow2_selfHostedOpenBridge();
}());
