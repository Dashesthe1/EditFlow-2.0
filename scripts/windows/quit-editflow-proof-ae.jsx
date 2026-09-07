/* EditFlow 2.0 proof-only clean shutdown.
 *
 * This fixed script is safe to dispatch only after a proof's exact cleanup has
 * restored a fresh blank unsaved project. It refuses to close or quit if any
 * project item remains or if the active project has ever been saved.
 */
(function () {
  "use strict";

  var logFile = new File(Folder.temp.fsName + "/EditFlow2-layer-controls-proof-quit.log");

  function append(stage, detail) {
    try {
      logFile.encoding = "UTF-8";
      if (logFile.open("a")) {
        logFile.writeln((new Date()).toUTCString() + "\t" + stage + "\t" + (detail || ""));
        logFile.close();
      }
    } catch (_) {}
  }

  try {
    append("SCRIPT_STARTED", $.fileName);
    if (!app.project) throw new Error("No After Effects project is open.");
    if (app.project.file) throw new Error("Refusing proof shutdown because the active project is saved on disk.");
    if (app.project.numItems !== 0) throw new Error("Refusing proof shutdown because the active project is not blank; itemCount=" + app.project.numItems + ".");

    var closed = app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    if (closed === false) throw new Error("After Effects refused to close the blank unsaved proof project.");
    append("QUIT_APPROVED", "blank unsaved proof project closed without saving");
    app.quit();
  } catch (error) {
    append("QUIT_REFUSED", String(error));
    throw error;
  }
}());
