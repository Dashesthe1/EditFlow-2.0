/* EditFlow M5 Roto Brush proof preflight. Read-only: never loads host modules or mutates AE. */
(function () {
  "use strict";
  var VERSION = "M5_ROTO_BRUSH_PREFLIGHT_V1";
  var marker = new File(Folder.temp.fsName + "/EditFlow2-m5-roto-brush-preflight.json");

  function quote(value) {
    var text = value === null || value === undefined ? "" : String(value);
    return "\"" + text.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"").replace(/\r/g, "\\r").replace(/\n/g, "\\n") + "\"";
  }
  function nullableString(value) { return value === null ? "null" : quote(value); }
  function nullableBoolean(value) { return value === null ? "null" : (value ? "true" : "false"); }
  function nullableNumber(value) { return value === null ? "null" : String(value); }
  function emit(payload) {
    var json = "{" +
      "\"version\":" + quote(payload.version) + "," +
      "\"eligible\":" + (payload.eligible ? "true" : "false") + "," +
      "\"refusalCode\":" + nullableString(payload.refusalCode) + "," +
      "\"safeToLoadDevelopmentHost\":" + (payload.eligible ? "true" : "false") + "," +
      "\"safeToIssueInteractiveActions\":" + (payload.eligible ? "true" : "false") + "," +
      "\"state\":{" +
        "\"hasProject\":" + (payload.hasProject ? "true" : "false") + "," +
        "\"filePath\":" + nullableString(payload.filePath) + "," +
        "\"itemCount\":" + String(payload.itemCount) + "," +
        "\"dirty\":" + nullableBoolean(payload.dirty) + "," +
        "\"projectRevision\":" + nullableNumber(payload.projectRevision) +
      "}}";
    marker.open("w"); marker.write(json); marker.close();
  }

  var project = app.project;
  var hasProject = !!project;
  var filePath = null;
  var itemCount = -1;
  var dirty = null;
  var projectRevision = null;
  var refusalCode = null;
  try { if (project && project.file) filePath = project.file.fsName; } catch (_) { filePath = null; }
  try { if (project) itemCount = Number(project.numItems); } catch (_) { itemCount = -1; }
  try { if (project && typeof project.dirty === "boolean") dirty = project.dirty; } catch (_) { dirty = null; }
  try { if (project && typeof project.revision === "number" && isFinite(project.revision)) projectRevision = Number(project.revision); } catch (_) { projectRevision = null; }

  if (!hasProject) refusalCode = "NO_PROJECT";
  else if (!isFinite(itemCount) || Math.floor(itemCount) !== itemCount || itemCount < 0) refusalCode = "INVALID_ITEM_COUNT";
  else if (filePath !== null) refusalCode = "SAVED_PROJECT";
  else if (itemCount !== 0) refusalCode = "NONEMPTY_PROJECT";
  else if (dirty === null) refusalCode = "DIRTY_STATE_UNAVAILABLE";
  else if (dirty) refusalCode = "DIRTY_PROJECT";
  else if (projectRevision === null || Math.floor(projectRevision) !== projectRevision || projectRevision < 1) refusalCode = "INVALID_PROJECT_REVISION";

  emit({
    version: VERSION,
    eligible: refusalCode === null,
    refusalCode: refusalCode,
    hasProject: hasProject,
    filePath: filePath,
    itemCount: itemCount,
    dirty: dirty,
    projectRevision: projectRevision
  });
}());