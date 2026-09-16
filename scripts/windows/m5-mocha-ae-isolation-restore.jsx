/* M5 Mocha AE proof isolation restore. Restores only the exact clean saved project recorded by isolation entry. */
(function () {
  "use strict";
  var VERSION = "M5_MOCHA_AE_ISOLATION_V1";
  var OWNED_PREFIX = "EF2_M5_MOCHA_";
  var stateFile = new File(Folder.temp.fsName + "/EditFlow2-m5-mocha-ae-isolation-state.json");
  var resultFile = new File(Folder.temp.fsName + "/EditFlow2-m5-mocha-ae-isolation-restore.json");
  function read(file) {
    if (!file.exists || !file.open("r")) throw new Error("Cannot read " + file.fsName);
    var text = file.read(); file.close(); return text;
  }
  function writeJson(file, value) {
    if (!file.open("w")) throw new Error("Cannot write " + file.fsName);
    file.encoding = "UTF-8"; file.write(JSON.stringify(value, null, 2)); file.close();
  }
  function pathOf(project) { try { return project && project.file ? project.file.fsName : null; } catch (_) { return null; } }
  function samePath(a, b) {
    if (a === null || b === null) return a === b;
    return String(a).replace(/\\/g, "/").toLowerCase() === String(b).replace(/\\/g, "/").toLowerCase();
  }
  var checks = {}, failure = null, state = null;
  try {
    if (!stateFile.exists) throw new Error("M5 isolation state is missing.");
    state = JSON.parse(read(stateFile));
    if (!state || state.version !== VERSION) throw new Error("M5 isolation state version mismatch.");
    if (typeof state.originalProjectPath !== "string" || !state.originalProjectPath) throw new Error("Original project path is missing from isolation state.");
    if (typeof state.originalItemCount !== "number" || state.originalItemCount < 0 || Math.floor(state.originalItemCount) !== state.originalItemCount) throw new Error("Original item count is invalid.");
    var originalFile = new File(state.originalProjectPath);
    if (!originalFile.exists) throw new Error("Original project file no longer exists: " + state.originalProjectPath);
    var current = app.project;
    if (!current) throw new Error("No After Effects project is open during restore.");
    var currentPath = pathOf(current);
    checks.scope_guarded = samePath(currentPath, state.originalProjectPath) || currentPath === null;
    if (!checks.scope_guarded) throw new Error("Restore refuses unexpected saved project: " + currentPath);
    if (currentPath === null) {
      var allOwned = true;
      for (var i = 1; i <= current.numItems; i += 1) {
        var item = current.item(i);
        if (!item || String(item.name).indexOf(OWNED_PREFIX) !== 0) { allOwned = false; break; }
      }
      checks.proof_scope_owned = current.numItems === 0 || allOwned;
      if (!checks.proof_scope_owned) throw new Error("Restore refuses an unsaved project containing non-M5 proof items.");
      var closed = current.close(CloseOptions.DO_NOT_SAVE_CHANGES);
      if (closed === false) throw new Error("After Effects refused to discard the proof-owned isolation project.");
      app.open(originalFile);
    } else {
      checks.proof_scope_owned = true;
    }
    if (!app.project || !samePath(pathOf(app.project), state.originalProjectPath)) throw new Error("Exact original project did not reopen.");
    checks.original_project_reopened = true;
    checks.item_count_restored = Number(app.project.numItems) === Number(state.originalItemCount);
    if (!checks.item_count_restored) throw new Error("Original project item count did not restore exactly.");
    var dirty = null;
    try { if (typeof app.project.dirty === "boolean") dirty = app.project.dirty; } catch (_) { dirty = null; }
    checks.original_project_clean = dirty === false;
    if (!checks.original_project_clean) throw new Error("Restored original project is unexpectedly dirty or unreadable.");
    if (state.originalActiveItemId !== null && state.originalActiveItemId !== undefined) {
      var activeTarget = null;
      for (var j = 1; j <= app.project.numItems; j += 1) {
        var candidate = app.project.item(j);
        if (candidate && Number(candidate.id) === Number(state.originalActiveItemId)) { activeTarget = candidate; break; }
      }
      checks.active_item_found = !!activeTarget;
      if (!activeTarget) throw new Error("Original active item could not be recovered by host ID.");
      try { if (typeof activeTarget.openInViewer === "function") activeTarget.openInViewer(); } catch (_) {}
      checks.active_item_restored = !!app.project.activeItem && Number(app.project.activeItem.id) === Number(state.originalActiveItemId);
      if (!checks.active_item_restored) throw new Error("Original active item did not restore exactly.");
    } else {
      checks.active_item_found = true; checks.active_item_restored = true;
    }
  } catch (error) {
    failure = String(error) + (error.line ? " @line " + error.line : "");
  }
  var allChecks = true, checkCount = 0;
  for (var key in checks) if (checks.hasOwnProperty(key)) { checkCount += 1; if (checks[key] !== true) allChecks = false; }
  try {
    writeJson(resultFile, {
      version: VERSION,
      ok: failure === null && allChecks,
      checkCount: checkCount,
      checks: checks,
      failure: failure,
      projectFile: pathOf(app.project),
      projectItemCount: app.project ? Number(app.project.numItems) : null,
      projectRevision: app.project ? Number(app.project.revision) : null,
      activeItemId: app.project && app.project.activeItem ? Number(app.project.activeItem.id) : null,
      activeItemName: app.project && app.project.activeItem ? String(app.project.activeItem.name) : null
    });
  } catch (emitError) { alert("M5 isolation restore could not write result: " + String(emitError)); }
}());
