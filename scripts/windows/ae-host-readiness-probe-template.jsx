/* EditFlow 2.0 accelerated AE readiness probe.
 * Read-only against After Effects project state; writes only the bounded probe result file.
 * The PowerShell orchestrator replaces the placeholder with an artifact-local path.
 */
(function () {
  "use strict";
  var result = new File("__EDITFLOW_AE_PROBE_RESULT__");
  var appName = "";
  var appVersion = "";
  var projectReady = false;
  var itemCount = -1;
  var ok = false;
  try {
    appName = String(app.name || "");
    appVersion = String(app.version || "");
    projectReady = !!app.project;
    itemCount = projectReady ? app.project.numItems : -1;
    ok = appName.toLowerCase().indexOf("after effects") >= 0 && projectReady;
  } catch (_) {
    ok = false;
  }

  if (!result.parent.exists) result.parent.create();
  if (!result.open("w")) throw new Error("EDITFLOW_AE_READINESS_RESULT_OPEN_FAILED");
  result.write("EDITFLOW_AE_READINESS_V1|" + (ok ? "1" : "0") + "|" + appName + "|" + appVersion + "|" + (projectReady ? "1" : "0") + "|" + itemCount);
  result.close();
}());
