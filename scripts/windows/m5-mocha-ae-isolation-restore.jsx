/* M5 Mocha AE proof restore. Saved projects reopen exactly; in-place unsaved projects remove only proof-owned items. */
(function () {
  "use strict";
  var VERSION = "M5_MOCHA_AE_ISOLATION_V1";
  var PREFIX = "EF2_M5_MOCHA_";
  var stateFile = new File(Folder.temp.fsName + "/EditFlow2-m5-mocha-ae-isolation-state.json");
  var backupStateFile = new File(Folder.temp.fsName + "/EditFlow2-m5-mocha-ae-isolation-state-backup.json");
  var resultFile = new File(Folder.temp.fsName + "/EditFlow2-m5-mocha-ae-isolation-restore.json");
  function read(file) { if (!file.exists || !file.open("r")) throw new Error("Cannot read " + file.fsName); var text=file.read(); file.close(); return text; }
  function writeJson(file, value) { if (!file.open("w")) throw new Error("Cannot write " + file.fsName); file.encoding="UTF-8"; file.write(JSON.stringify(value,null,2)); file.close(); }
  function pathOf(project) { try { return project && project.file ? project.file.fsName : null; } catch (_) { return null; } }
  function dirtyOf(project) { try { return typeof project.dirty === "boolean" ? project.dirty : null; } catch (_) { return null; } }
  function samePath(a,b) { if (a === null || b === null) return a === b; return String(a).replace(/\\/g,"/").toLowerCase() === String(b).replace(/\\/g,"/").toLowerCase(); }
  function findItemById(project,id) { for (var i=1;i<=project.numItems;i+=1) if (Number(project.item(i).id)===Number(id)) return project.item(i); return null; }
  function expectedById(state,id) {
    if (!state.originalItems) return null;
    for (var i=0;i<state.originalItems.length;i+=1) if (Number(state.originalItems[i].id)===Number(id)) return state.originalItems[i];
    return null;
  }
  function verifyBaselineItem(item, expected) {
    return !!item && String(item.name)===String(expected.name) && String(item.comment||"")===String(expected.comment||"") && String(item.typeName||"")===String(expected.typeName||"");
  }
  var checks={}, failure=null, state=null, removedOwnedItems=0;
  try {
    var restoreStateFile = stateFile.exists ? stateFile : backupStateFile;
    if (!restoreStateFile.exists) throw new Error("M5 isolation state and backup are missing.");
    state = JSON.parse(read(restoreStateFile));
    if (!state || state.version !== VERSION) throw new Error("M5 isolation state version mismatch.");
    var current = app.project;
    if (!current) throw new Error("No After Effects project is open during restore.");
    if (state.mode === "IN_PLACE_UNSAVED") {
      if (pathOf(current) !== null) throw new Error("In-place restore refuses a saved project.");
      for (var scan=1; scan<=current.numItems; scan+=1) {
        var candidate=current.item(scan), expected=expectedById(state,Number(candidate.id));
        if (expected) {
          if (!verifyBaselineItem(candidate,expected)) throw new Error("Baseline project item changed during in-place Mocha proof: "+String(candidate.name));
        } else if (String(candidate.name).indexOf(PREFIX)!==0) {
          throw new Error("In-place restore refuses unexpected non-proof item: "+String(candidate.name));
        }
      }
      for (var index=current.numItems; index>=1; index-=1) {
        var item=current.item(index);
        if (!expectedById(state,Number(item.id))) {
          if (String(item.name).indexOf(PREFIX)!==0) throw new Error("Unexpected item escaped proof ownership during cleanup.");
          item.remove(); removedOwnedItems+=1;
        }
      }
      checks.scope_guarded=true;
      checks.proof_scope_owned=true;
      checks.item_count_restored=Number(current.numItems)===Number(state.originalItemCount);
      if (!checks.item_count_restored) throw new Error("In-place restore did not recover the original item count.");
      for (var b=0;b<state.originalItems.length;b+=1) {
        var baselineItem=findItemById(current,state.originalItems[b].id);
        if (!verifyBaselineItem(baselineItem,state.originalItems[b])) throw new Error("Baseline item did not restore exactly: "+String(state.originalItems[b].name));
      }
      if (state.originalDirty===false && Number(state.originalItemCount)===0) {
        var discarded=current.close(CloseOptions.DO_NOT_SAVE_CHANGES);
        if (discarded===false) throw new Error("After Effects refused to reset the originally clean blank unsaved project.");
        app.newProject(); current=app.project;
      }
      checks.original_project_reopened=true;
      checks.original_project_clean=dirtyOf(current)===state.originalDirty;
      if (!checks.original_project_clean) throw new Error("Original in-place dirty state did not restore exactly.");
      if (state.originalActiveItemId!==null && state.originalActiveItemId!==undefined) {
        var activeTarget=findItemById(current,state.originalActiveItemId);
        checks.active_item_found=!!activeTarget;
        if (!activeTarget) throw new Error("Original active item could not be recovered by host ID.");
        try { if (typeof activeTarget.openInViewer==="function") activeTarget.openInViewer(); } catch (_) {}
        checks.active_item_restored=!!current.activeItem && Number(current.activeItem.id)===Number(state.originalActiveItemId);
        if (!checks.active_item_restored) throw new Error("Original active item did not restore exactly.");
      } else {
        checks.active_item_found=true;
        checks.active_item_restored=!current.activeItem;
        if (!checks.active_item_restored) throw new Error("Originally empty active-item state did not restore exactly.");
      }
    } else {
      if (typeof state.originalProjectPath!=="string" || !state.originalProjectPath) throw new Error("Original project path is missing from isolation state.");
      var originalFile=new File(state.originalProjectPath);
      if (!originalFile.exists) throw new Error("Original project file no longer exists: "+state.originalProjectPath);
      var currentPath=pathOf(current);
      checks.scope_guarded=samePath(currentPath,state.originalProjectPath)||currentPath===null;
      if (!checks.scope_guarded) throw new Error("Restore refuses unexpected saved project: "+currentPath);
      if (currentPath===null) {
        var allOwned=true;
        for (var j=1;j<=current.numItems;j+=1) {
          var currentItem=current.item(j);
          if (!currentItem || String(currentItem.name).indexOf(PREFIX)!==0) { allOwned=false; break; }
        }
        checks.proof_scope_owned=current.numItems===0||allOwned;
        if (!checks.proof_scope_owned) throw new Error("Restore refuses an unsaved project containing non-M5 proof items.");
        var closed=current.close(CloseOptions.DO_NOT_SAVE_CHANGES);
        if (closed===false) throw new Error("After Effects refused to discard the proof-owned isolation project.");
        app.open(originalFile); current=app.project;
      } else { checks.proof_scope_owned=true; }
      if (!current || !samePath(pathOf(current),state.originalProjectPath)) throw new Error("Exact original project did not reopen.");
      checks.original_project_reopened=true;
      checks.item_count_restored=Number(current.numItems)===Number(state.originalItemCount);
      if (!checks.item_count_restored) throw new Error("Original project item count did not restore exactly.");
      checks.original_project_clean=dirtyOf(current)===false;
      if (!checks.original_project_clean) throw new Error("Restored original project is unexpectedly dirty or unreadable.");
      if (state.originalActiveItemId!==null && state.originalActiveItemId!==undefined) {
        var savedActive=findItemById(current,state.originalActiveItemId);
        checks.active_item_found=!!savedActive;
        if (!savedActive) throw new Error("Original active item could not be recovered by host ID.");
        try { if (typeof savedActive.openInViewer==="function") savedActive.openInViewer(); } catch (_) {}
        checks.active_item_restored=!!current.activeItem && Number(current.activeItem.id)===Number(state.originalActiveItemId);
        if (!checks.active_item_restored) throw new Error("Original active item did not restore exactly.");
      } else { checks.active_item_found=true; checks.active_item_restored=true; }
    }
  } catch (error) {
    failure=String(error)+(error.line?" @line "+error.line:"");
  }
  var allChecks=true, checkCount=0;
  for (var key in checks) if (checks.hasOwnProperty(key)) { checkCount+=1; if (checks[key]!==true) allChecks=false; }
  try {
    writeJson(resultFile, {
      version: VERSION,
      mode: state ? state.mode : null,
      ok: failure===null && allChecks,
      checkCount: checkCount,
      checks: checks,
      failure: failure,
      removedOwnedItems: removedOwnedItems,
      projectFile: pathOf(app.project),
      projectItemCount: app.project ? Number(app.project.numItems) : null,
      projectRevision: app.project ? Number(app.project.revision) : null,
      dirty: app.project ? dirtyOf(app.project) : null,
      activeItemId: app.project && app.project.activeItem ? Number(app.project.activeItem.id) : null,
      activeItemName: app.project && app.project.activeItem ? String(app.project.activeItem.name) : null
    });
  } catch (emitError) { alert("M5 isolation restore could not write result: "+String(emitError)); }
}());
