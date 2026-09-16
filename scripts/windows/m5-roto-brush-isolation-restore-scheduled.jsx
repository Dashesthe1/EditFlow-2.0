/* M5 Roto Brush proof isolation restore scheduled after the CEP eval returns. */
(function () {
  "use strict";
  var VERSION = "M5_ROTO_BRUSH_ISOLATION_V1";
  var OWNED_PREFIX = "EF2_M5_ROTO_";
  var stateFile = new File(Folder.temp.fsName + "/EditFlow2-m5-roto-brush-isolation-state.json");
  var resultFile = new File(Folder.temp.fsName + "/EditFlow2-m5-roto-brush-isolation-restore.json");
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
  function proofOwned(project) {
    if (!project) return false;
    if (project.numItems === 0) return true;
    for (var i = 1; i <= project.numItems; i += 1) {
      var item = project.item(i);
      if (!item || String(item.name).indexOf(OWNED_PREFIX) !== 0) return false;
    }
    return true;
  }
  try {
    if (!stateFile.exists) throw new Error("M5 isolation state is missing.");
    var state = JSON.parse(read(stateFile));
    if (!state || state.version !== VERSION) throw new Error("M5 isolation state version mismatch.");
    if (typeof state.originalProjectPath !== "string" || !state.originalProjectPath) throw new Error("Original project path is missing from isolation state.");
    if (typeof state.originalItemCount !== "number" || state.originalItemCount < 0 || Math.floor(state.originalItemCount) !== state.originalItemCount) throw new Error("Original item count is invalid.");
    var originalFile = new File(state.originalProjectPath);
    if (!originalFile.exists) throw new Error("Original project file no longer exists: " + state.originalProjectPath);
    if (!app.project) throw new Error("No After Effects project is open during scheduled restore preflight.");
    var currentPath = pathOf(app.project);
    if (!samePath(currentPath, state.originalProjectPath) && currentPath !== null) throw new Error("Restore refuses unexpected saved project: " + currentPath);
    if (currentPath === null && !proofOwned(app.project)) throw new Error("Restore refuses an unsaved project containing non-M5 proof items.");
    $.global.EditFlow2_M5_restoreScheduled = function () {
      var checks = {}, failure = null;
      try {
        var scheduledState = JSON.parse(read(stateFile));
        var scheduledFile = new File(scheduledState.originalProjectPath);
        var current = app.project;
        if (!current) throw new Error("No After Effects project is open during scheduled restore.");
        var scheduledCurrentPath = pathOf(current);
        checks.scope_guarded = samePath(scheduledCurrentPath, scheduledState.originalProjectPath) || scheduledCurrentPath === null;
        if (!checks.scope_guarded) throw new Error("Scheduled restore refuses unexpected saved project: " + scheduledCurrentPath);
        if (scheduledCurrentPath === null) {
          checks.proof_scope_owned = proofOwned(current);
          if (!checks.proof_scope_owned) throw new Error("Scheduled restore refuses non-M5 proof items.");
          var closed = current.close(CloseOptions.DO_NOT_SAVE_CHANGES);
          if (closed === false) throw new Error("After Effects refused to discard the proof-owned isolation project.");
          app.open(scheduledFile);
        } else {
          checks.proof_scope_owned = true;
        }
        if (!app.project || !samePath(pathOf(app.project), scheduledState.originalProjectPath)) throw new Error("Exact original project did not reopen.");
        checks.original_project_reopened = true;
        checks.item_count_restored = Number(app.project.numItems) === Number(scheduledState.originalItemCount);
        if (!checks.item_count_restored) throw new Error("Original project item count did not restore exactly.");
        var dirty = null;
        try { if (typeof app.project.dirty === "boolean") dirty = app.project.dirty; } catch (_) { dirty = null; }
        checks.original_project_clean = dirty === false;
        if (!checks.original_project_clean) throw new Error("Restored original project is unexpectedly dirty or unreadable.");
        if (scheduledState.originalActiveItemId !== null && scheduledState.originalActiveItemId !== undefined) {
          var activeTarget = null;
          for (var j = 1; j <= app.project.numItems; j += 1) {
            var candidate = app.project.item(j);
            if (candidate && Number(candidate.id) === Number(scheduledState.originalActiveItemId)) { activeTarget = candidate; break; }
          }
          checks.active_item_found = !!activeTarget;
          if (!activeTarget) throw new Error("Original active item could not be recovered by host ID.");
          try { if (typeof activeTarget.openInViewer === "function") activeTarget.openInViewer(); } catch (_) {}
          checks.active_item_restored = !!app.project.activeItem && Number(app.project.activeItem.id) === Number(scheduledState.originalActiveItemId);
          if (!checks.active_item_restored) throw new Error("Original active item did not restore exactly.");
        } else { checks.active_item_found = true; checks.active_item_restored = true; }
      } catch (error) { failure = String(error) + (error.line ? " @line " + error.line : ""); }
      var allChecks = true, checkCount = 0;
      for (var key in checks) if (checks.hasOwnProperty(key)) { checkCount += 1; if (checks[key] !== true) allChecks = false; }
      try {
        writeJson(resultFile, {
          version: VERSION, scheduled: true, ok: failure === null && allChecks, checkCount: checkCount,
          checks: checks, failure: failure, projectFile: pathOf(app.project),
          projectItemCount: app.project ? Number(app.project.numItems) : null,
          projectRevision: app.project ? Number(app.project.revision) : null,
          activeItemId: app.project && app.project.activeItem ? Number(app.project.activeItem.id) : null,
          activeItemName: app.project && app.project.activeItem ? String(app.project.activeItem.name) : null
        });
      } catch (_) {}
      try { delete $.global.EditFlow2_M5_restoreScheduled; } catch (_) {}
    };
    app.scheduleTask("$.global.EditFlow2_M5_restoreScheduled()", 100, false);
  } catch (error) {
    try { writeJson(resultFile, { version: VERSION, scheduled: false, ok: false, checkCount: 0, checks: {}, failure: String(error) + (error.line ? " @line " + error.line : ""), projectFile: pathOf(app.project) }); } catch (_) {}
  }
}());
