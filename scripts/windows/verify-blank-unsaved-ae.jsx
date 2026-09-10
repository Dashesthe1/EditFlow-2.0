/* Read-only proof helper: verifies the current AE project is blank and unsaved. */
(function () {
  "use strict";
  var f = new File(Folder.temp.fsName + "/EditFlow2-blank-unsaved-proof.txt");
  var value = "ERROR";
  try {
    value = app.project && !app.project.file && app.project.numItems === 0 ? "BLANK_UNSAVED" : ("NOT_BLANK itemCount=" + (app.project ? app.project.numItems : -1) + " saved=" + (app.project && app.project.file ? "1" : "0"));
  } catch (e) { value = "ERROR " + String(e); }
  try { f.open("w"); f.write(value); f.close(); } catch (_) {}
}());
