/* M5 Roto Brush proof isolation entry. Requires a clean saved user project and creates one blank unsaved proof project. */
(function () {
  "use strict";
  var VERSION = "M5_ROTO_BRUSH_ISOLATION_V1";
  var stateFile = new File(Folder.temp.fsName + "/EditFlow2-m5-roto-brush-isolation-state.json");
  var resultFile = new File(Folder.temp.fsName + "/EditFlow2-m5-roto-brush-isolation-enter.json");
  function quote(value) {
    var text = value === null || value === undefined ? "" : String(value);
    return "\"" + text.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"").replace(/\r/g, "\\r").replace(/\n/g, "\\n") + "\"";
  }
  function write(file, text) {
    if (!file.open("w")) throw new Error("Cannot write " + file.fsName);
    file.encoding = "UTF-8"; file.write(text); file.close();
  }
  function bool(value) { return value ? "true" : "false"; }
  function currentPath(project) {
    try { return project && project.file ? project.file.fsName : null; } catch (_) { return null; }
  }
  var ok = false, failure = null, originalPath = null, originalItems = -1, originalRevision = null;
  var originalActiveItemId = null, originalActiveItemName = null;
  var blankItems = null, blankDirty = null, blankRevision = null, stateWritten = false;
  try {
    var project = app.project;
    if (!project) throw new Error("No After Effects project is open.");
    originalPath = currentPath(project);
    if (originalPath === null) throw new Error("Isolation entry requires a saved project so exact restoration is possible.");
    var originalFile = new File(originalPath);
    if (!originalFile.exists) throw new Error("Original project file does not exist: " + originalPath);
    var dirty = null;
    try { if (typeof project.dirty === "boolean") dirty = project.dirty; } catch (_) { dirty = null; }
    if (dirty === null) throw new Error("Original project dirty state is unavailable.");
    if (dirty) throw new Error("Original project must be clean before M5 isolation entry.");
    originalItems = Number(project.numItems);
    if (!isFinite(originalItems) || originalItems < 0 || Math.floor(originalItems) !== originalItems) throw new Error("Original item count is invalid.");
    try { if (typeof project.revision === "number" && isFinite(project.revision)) originalRevision = Number(project.revision); } catch (_) { originalRevision = null; }
    try { if (project.activeItem) { originalActiveItemId = Number(project.activeItem.id); originalActiveItemName = String(project.activeItem.name); } } catch (_) { originalActiveItemId = null; originalActiveItemName = null; }
    var state = "{" +
      "\"version\":" + quote(VERSION) + "," +
      "\"originalProjectPath\":" + quote(originalPath) + "," +
      "\"originalItemCount\":" + String(originalItems) + "," +
      "\"originalRevision\":" + (originalRevision === null ? "null" : String(originalRevision)) + "," +
      "\"originalActiveItemId\":" + (originalActiveItemId === null ? "null" : String(originalActiveItemId)) + "," +
      "\"originalActiveItemName\":" + (originalActiveItemName === null ? "null" : quote(originalActiveItemName)) + "," +
      "\"enteredAtMs\":" + String((new Date()).getTime()) + "}";
    write(stateFile, state); stateWritten = true;
    var closed = project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    if (closed === false) throw new Error("After Effects refused to close the clean original project.");
    app.newProject();
    if (!app.project) throw new Error("After Effects did not create the proof-owned blank project.");
    if (currentPath(app.project) !== null) throw new Error("Isolation project unexpectedly has a saved file path.");
    blankItems = Number(app.project.numItems);
    try { if (typeof app.project.dirty === "boolean") blankDirty = app.project.dirty; } catch (_) { blankDirty = null; }
    try { if (typeof app.project.revision === "number" && isFinite(app.project.revision)) blankRevision = Number(app.project.revision); } catch (_) { blankRevision = null; }
    if (blankItems !== 0) throw new Error("Isolation project is not empty.");
    if (blankDirty !== false) throw new Error("Isolation project is not clean.");
    if (blankRevision === null || blankRevision < 1 || Math.floor(blankRevision) !== blankRevision) throw new Error("Isolation project revision is invalid.");
    ok = true;
  } catch (error) {
    failure = String(error) + (error.line ? " @line " + error.line : "");
  }
  var result = "{" +
    "\"version\":" + quote(VERSION) + "," +
    "\"ok\":" + bool(ok) + "," +
    "\"failure\":" + (failure === null ? "null" : quote(failure)) + "," +
    "\"stateWritten\":" + bool(stateWritten) + "," +
    "\"originalProjectPath\":" + (originalPath === null ? "null" : quote(originalPath)) + "," +
    "\"originalItemCount\":" + String(originalItems) + "," +
    "\"originalRevision\":" + (originalRevision === null ? "null" : String(originalRevision)) + "," +
    "\"originalActiveItemId\":" + (originalActiveItemId === null ? "null" : String(originalActiveItemId)) + "," +
    "\"originalActiveItemName\":" + (originalActiveItemName === null ? "null" : quote(originalActiveItemName)) + "," +
    "\"blankState\":{" +
      "\"filePath\":" + (currentPath(app.project) === null ? "null" : quote(currentPath(app.project))) + "," +
      "\"itemCount\":" + (blankItems === null ? "null" : String(blankItems)) + "," +
      "\"dirty\":" + (blankDirty === null ? "null" : bool(blankDirty)) + "," +
      "\"projectRevision\":" + (blankRevision === null ? "null" : String(blankRevision)) + "}" +
    "}";
  try { write(resultFile, result); }
  catch (emitError) { alert("M5 isolation entry could not write result: " + String(emitError)); }
}());
