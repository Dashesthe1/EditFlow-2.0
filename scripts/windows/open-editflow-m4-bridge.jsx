/* Fixed read-only M4 host/panel bootstrap for the existing After Effects process. */
(function () {
  "use strict";
  function log(stage, detail) {
    var marker = new File(Folder.temp.fsName + "/EditFlow2-m4-panel-bootstrap.log");
    marker.encoding = "UTF-8";
    if (!marker.open("a")) return;
    try { marker.writeln((new Date()).toUTCString() + "\t" + stage + "\t" + (detail || "")); }
    finally { marker.close(); }
  }
  function detail(error) {
    var parts = ["error=" + String(error)];
    try { parts.push("message=" + String(error.message)); } catch (_) {}
    try { parts.push("line=" + String(error.line)); } catch (_) {}
    return parts.join(";");
  }

  log("SCRIPT_STARTED", $.fileName);
  var installedHost = new File(Folder.userData.fsName + "/Adobe/CEP/extensions/com.editflow2.bridge/host/editflow_host_current_m4.jsx");
  try {
    if (!installedHost.exists) throw new Error("Installed M4 host loader is missing: " + installedHost.fsName);
    $.evalFile(installedHost);
    if ($.global.EditFlow2_HOST_PROTOCOL_20 !== true || $.global.EditFlow2_HOST_M4 !== true) throw new Error("M4 host flags did not register.");
    if ($.global.EditFlow2_M4_TRACKING_RENDER_PROFILE !== "TRACKING_TIFF_SEQUENCE_V1") throw new Error("M4 tracking render profile did not register.");
    log("HOST_READY", "v20=true;m4=true;profile=" + $.global.EditFlow2_M4_TRACKING_RENDER_PROFILE);
  } catch (error) {
    log("HOST_LOAD_ERROR", detail(error));
    return;
  }

  $.global.EditFlow2_m4BridgeOpenAttempts = 0;
  $.global.EditFlow2_m4OpenBridge = function () {
    var attempts = Number($.global.EditFlow2_m4BridgeOpenAttempts || 0) + 1;
    $.global.EditFlow2_m4BridgeOpenAttempts = attempts;
    try {
      var commandId = app.findMenuCommandId("EditFlow 2.0 Bridge");
      if (typeof commandId === "number" && commandId > 0) {
        app.executeCommand(commandId);
        $.global.EditFlow2_m4BridgeOpened = true;
        log("PANEL_COMMAND_SENT", "attempt=" + attempts + ";commandId=" + commandId);
        return;
      }
    } catch (error) { log("PANEL_COMMAND_ERROR", "attempt=" + attempts + ";" + detail(error)); }
    if (attempts < 40) app.scheduleTask("$.global.EditFlow2_m4OpenBridge()", 250, false);
    else { $.global.EditFlow2_m4BridgeOpenFailed = true; log("PANEL_OPEN_FAILED", "attempts=" + attempts); }
  };
  $.global.EditFlow2_m4OpenBridge();
}());
