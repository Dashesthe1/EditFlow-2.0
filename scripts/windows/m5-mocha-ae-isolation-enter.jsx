/* M5 Mocha AE proof isolation entry. Saved projects use external isolation; unsaved projects use exact in-place proof ownership. */
(function () {
  "use strict";
  var VERSION = "M5_MOCHA_AE_ISOLATION_V1";
  var PREFIX = "EF2_M5_MOCHA_";
  var stateFile = new File(Folder.temp.fsName + "/EditFlow2-m5-mocha-ae-isolation-state.json");
  var backupStateFile = new File(Folder.temp.fsName + "/EditFlow2-m5-mocha-ae-isolation-state-backup.json");
  var resultFile = new File(Folder.temp.fsName + "/EditFlow2-m5-mocha-ae-isolation-enter.json");
  function writeJson(file, value) {
    if (!file.open("w")) throw new Error("Cannot write " + file.fsName);
    file.encoding = "UTF-8"; file.write(JSON.stringify(value, null, 2)); file.close();
  }
  function pathOf(project) { try { return project && project.file ? project.file.fsName : null; } catch (_) { return null; } }
  function dirtyOf(project) { try { return typeof project.dirty === "boolean" ? project.dirty : null; } catch (_) { return null; } }
  function revisionOf(project) { try { return typeof project.revision === "number" && isFinite(project.revision) ? Number(project.revision) : null; } catch (_) { return null; } }
  function snapshotItems(project) {
    var items = [];
    for (var i = 1; i <= project.numItems; i += 1) {
      var item = project.item(i);
      items.push({
        id: Number(item.id), name: String(item.name), comment: String(item.comment || ""),
        typeName: String(item.typeName || ""), parentFolderId: item.parentFolder ? Number(item.parentFolder.id) : null
      });
    }
    return items;
  }
  function hasOwnedItems(project) {
    for (var i = 1; i <= project.numItems; i += 1) if (String(project.item(i).name).indexOf(PREFIX) === 0) return true;
    return false;
  }
  var result = { version: VERSION, ok: false, failure: null, stateWritten: false, mode: null };
  try {
    var project = app.project;
    if (!project) throw new Error("No After Effects project is open.");
    var originalPath = pathOf(project);
    var originalDirty = dirtyOf(project);
    var originalItems = Number(project.numItems);
    var originalRevision = revisionOf(project);
    var originalActiveItemId = null, originalActiveItemName = null;
    try {
      if (project.activeItem) {
        originalActiveItemId = Number(project.activeItem.id);
        originalActiveItemName = String(project.activeItem.name);
      }
    } catch (_) {}
    if (!isFinite(originalItems) || originalItems < 0 || Math.floor(originalItems) !== originalItems) throw new Error("Original item count is invalid.");
    if (originalDirty === null) throw new Error("Original project dirty state is unavailable.");
    var state = {
      version: VERSION,
      mode: originalPath === null ? "IN_PLACE_UNSAVED" : "SAVED_PROJECT_ISOLATION",
      originalProjectPath: originalPath,
      originalItemCount: originalItems,
      originalRevision: originalRevision,
      originalDirty: originalDirty,
      originalActiveItemId: originalActiveItemId,
      originalActiveItemName: originalActiveItemName,
      originalItems: snapshotItems(project),
      enteredAtMs: (new Date()).getTime()
    };
    if (state.mode === "SAVED_PROJECT_ISOLATION") {
      var originalFile = new File(originalPath);
      if (!originalFile.exists) throw new Error("Original project file does not exist: " + originalPath);
      if (originalDirty) throw new Error("Original project must be clean before saved-project M5 isolation entry.");
      writeJson(stateFile, state); writeJson(backupStateFile, state); result.stateWritten = true;
      var closed = project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
      if (closed === false) throw new Error("After Effects refused to close the clean original project.");
      app.newProject();
      if (!app.project) throw new Error("After Effects did not create the proof-owned blank project.");
      if (pathOf(app.project) !== null) throw new Error("Isolation project unexpectedly has a saved file path.");
      if (Number(app.project.numItems) !== 0) throw new Error("Isolation project is not empty.");
      if (dirtyOf(app.project) !== false) throw new Error("Isolation project is not clean.");
    } else {
      if (hasOwnedItems(project)) throw new Error("In-place isolation refuses a project that already contains EF2_M5_MOCHA_ items.");
      if (originalDirty === false && originalItems > 0) throw new Error("In-place isolation refuses a clean nonempty unsaved project because exact dirty-state restoration is not possible.");
      writeJson(stateFile, state); writeJson(backupStateFile, state); result.stateWritten = true;
    }
    result.ok = true;
    result.mode = state.mode;
    result.originalProjectPath = state.originalProjectPath;
    result.originalItemCount = state.originalItemCount;
    result.originalRevision = state.originalRevision;
    result.originalDirty = state.originalDirty;
    result.originalActiveItemId = state.originalActiveItemId;
    result.originalActiveItemName = state.originalActiveItemName;
    result.currentState = {
      filePath: pathOf(app.project),
      itemCount: app.project ? Number(app.project.numItems) : null,
      dirty: app.project ? dirtyOf(app.project) : null,
      projectRevision: app.project ? revisionOf(app.project) : null
    };
  } catch (error) {
    result.failure = String(error) + (error.line ? " @line " + error.line : "");
  }
  try { writeJson(resultFile, result); }
  catch (emitError) { alert("M5 isolation entry could not write result: " + String(emitError)); }
}());
