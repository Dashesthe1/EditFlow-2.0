/* EditFlow 2.0 bounded CEP panel opener.
 * Uses the exact extension menu label declared in CSXS/manifest.xml.
 * No mouse, keyboard, focus guessing, arbitrary eval, or unknown-window interaction.
 * A temp evidence log makes warm-loop failures diagnosable in the same proof run.
 */
(function () {
  "use strict";

  function appendEvidence(stage, detail) {
    var marker = new File(Folder.temp.fsName + "/EditFlow2-fast-panel-bootstrap.log");
    marker.encoding = "UTF-8";
    if (!marker.open("a")) return;
    try {
      marker.writeln((new Date()).toUTCString() + "\t" + stage + "\t" + (detail || ""));
    } finally {
      marker.close();
    }
  }

  var menuLabel = "EditFlow 2.0 Bridge";
  appendEvidence("SCRIPT_STARTED", $.fileName);
  try {
    var commandId = app.findMenuCommandId(menuLabel);
    appendEvidence("MENU_PROBE", "commandId=" + commandId);
    if (!commandId || commandId <= 0) {
      appendEvidence("MENU_NOT_FOUND", menuLabel);
      throw new Error("EDITFLOW2_PANEL_MENU_COMMAND_NOT_FOUND");
    }
    app.executeCommand(commandId);
    appendEvidence("EXECUTE_COMMAND_SENT", "commandId=" + commandId);
  } catch (error) {
    appendEvidence("OPEN_ERROR", String(error));
    throw error;
  }
}());
