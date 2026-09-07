/* EditFlow 2.0 protocol 1.7 self-hosted panel bootstrap diagnostic.
 *
 * This fixed proof-only script first loads the installed v1.7 host chain directly
 * inside the already-running After Effects process, records exact ExtendScript
 * loader evidence, and then opens the same fixed CEP panel menu command used by
 * the accepted M3 runners. No caller-supplied script text is evaluated.
 */
(function () {
  "use strict";

  function appendEvidence(stage, detail) {
    var marker = new File(Folder.temp.fsName + "/EditFlow2-temporal-host-preflight.log");
    marker.encoding = "UTF-8";
    if (!marker.open("a")) return;
    try {
      marker.writeln((new Date()).toUTCString() + "\t" + stage + "\t" + (detail || ""));
    } finally {
      marker.close();
    }
  }

  function errorDetail(error) {
    var parts = ["error=" + String(error)];
    try { parts.push("name=" + String(error.name)); } catch (_) {}
    try { parts.push("message=" + String(error.message)); } catch (_) {}
    try { parts.push("line=" + String(error.line)); } catch (_) {}
    try { parts.push("fileName=" + String(error.fileName)); } catch (_) {}
    return parts.join(";");
  }

  var loadedPath = $.fileName;
  appendEvidence("SCRIPT_STARTED", loadedPath);

  var installedHost = new File(Folder.userData.fsName + "/Adobe/CEP/extensions/com.editflow2.bridge/host/editflow_host_current_v17.jsx");
  appendEvidence("HOST_PATH", "exists=" + installedHost.exists + ";path=" + installedHost.fsName);
  appendEvidence(
    "HOST_STATE_BEFORE",
    "v17=" + String($.global.EditFlow2_HOST_PROTOCOL_17 === true)
      + ";v16=" + String($.global.EditFlow2_HOST_PROTOCOL_16 === true)
      + ";dispatch=" + typeof $.global.EditFlow2_dispatch
  );

  try {
    if (!installedHost.exists) throw new Error("Installed EditFlow protocol 1.7 host loader is missing.");
    var result = $.evalFile(installedHost);
    appendEvidence(
      "HOST_LOAD_RETURNED",
      "result=" + String(result)
        + ";v17=" + String($.global.EditFlow2_HOST_PROTOCOL_17 === true)
        + ";v16=" + String($.global.EditFlow2_HOST_PROTOCOL_16 === true)
        + ";dispatch=" + typeof $.global.EditFlow2_dispatch
    );
  } catch (hostLoadError) {
    appendEvidence("HOST_LOAD_ERROR", errorDetail(hostLoadError));
  }

  $.global.EditFlow2_temporalBridgeOpenAttempts = 0;
  $.global.EditFlow2_temporalOpenBridge = function () {
    var menuName = "EditFlow 2.0 Bridge";
    var maxAttempts = 120;
    var retryDelayMs = 500;
    var attempts = Number($.global.EditFlow2_temporalBridgeOpenAttempts || 0) + 1;
    $.global.EditFlow2_temporalBridgeOpenAttempts = attempts;

    try {
      var commandId = app.findMenuCommandId(menuName);
      appendEvidence("MENU_PROBE", "attempt=" + attempts + ";commandId=" + commandId);
      if (typeof commandId === "number" && commandId > 0) {
        appendEvidence("MENU_FOUND", "attempt=" + attempts + ";commandId=" + commandId);
        app.executeCommand(commandId);
        appendEvidence("EXECUTE_COMMAND_SENT", "commandId=" + commandId);
        $.global.EditFlow2_temporalBridgeOpened = true;
        return;
      }
    } catch (error) {
      appendEvidence("MENU_PROBE_ERROR", "attempt=" + attempts + ";" + errorDetail(error));
    }

    if (attempts < maxAttempts) {
      var taskId = app.scheduleTask("$.global.EditFlow2_temporalOpenBridge()", retryDelayMs, false);
      appendEvidence("RETRY_SCHEDULED", "attempt=" + attempts + ";taskId=" + taskId);
    } else {
      appendEvidence("RETRY_EXHAUSTED", "attempts=" + attempts);
      $.global.EditFlow2_temporalBridgeOpenFailed = true;
    }
  };

  appendEvidence("INITIAL_ATTEMPT_DIRECT", "attempt=1");
  $.global.EditFlow2_temporalOpenBridge();
}());
