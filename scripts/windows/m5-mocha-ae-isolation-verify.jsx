/* Read-only settled verification for M5 Mocha AE isolation restoration. */
(function () {
  "use strict";
  var VERSION = "M5_MOCHA_AE_ISOLATION_V1";
  var stateFile = new File(Folder.temp.fsName + "/EditFlow2-m5-mocha-ae-isolation-state.json");
  var backupStateFile = new File(Folder.temp.fsName + "/EditFlow2-m5-mocha-ae-isolation-state-backup.json");
  var resultFile = new File(Folder.temp.fsName + "/EditFlow2-m5-mocha-ae-isolation-verify.json");
  function read(file) { if (!file.exists || !file.open("r")) throw new Error("Cannot read " + file.fsName); var text=file.read(); file.close(); return text; }
  function writeJson(file,value) { if (!file.open("w")) throw new Error("Cannot write " + file.fsName); file.encoding="UTF-8"; file.write(JSON.stringify(value,null,2)); file.close(); }
  function pathOf(project) { try { return project && project.file ? project.file.fsName : null; } catch (_) { return null; } }
  function dirtyOf(project) { try { return typeof project.dirty === "boolean" ? project.dirty : null; } catch (_) { return null; } }
  function revisionOf(project) { try { return typeof project.revision === "number" && isFinite(project.revision) ? Number(project.revision) : null; } catch (_) { return null; } }
  function samePath(a,b) { return String(a||"").replace(/\\/g,"/").toLowerCase()===String(b||"").replace(/\\/g,"/").toLowerCase(); }
  function findItemById(project,id) { for (var i=1;i<=project.numItems;i+=1) if (Number(project.item(i).id)===Number(id)) return project.item(i); return null; }
  function sameItem(item,expected) { return !!item && String(item.name)===String(expected.name) && String(item.comment||"")===String(expected.comment||"") && String(item.typeName||"")===String(expected.typeName||""); }
  var checks={}, failure=null, state=null, revision=null, dirty=null;
  try {
    var sf=stateFile.exists?stateFile:backupStateFile;
    if (!sf.exists) throw new Error("M5 isolation state and backup are missing for settled verification.");
    state=JSON.parse(read(sf));
    if (!state || state.version!==VERSION) throw new Error("M5 isolation verification state version mismatch.");
    if (!app.project) throw new Error("No After Effects project is open during settled verification.");
    revision=revisionOf(app.project); dirty=dirtyOf(app.project);
    if (state.mode==="IN_PLACE_UNSAVED") {
      checks.original_project_path=pathOf(app.project)===null;
      checks.item_count=Number(app.project.numItems)===Number(state.originalItemCount);
      checks.dirty=dirty===state.originalDirty;
      checks.items=true;
      if (!state.originalItems || state.originalItems.length!==Number(state.originalItemCount)) checks.items=false;
      else {
        for (var i=0;i<state.originalItems.length;i+=1) {
          if (!sameItem(findItemById(app.project,state.originalItems[i].id),state.originalItems[i])) { checks.items=false; break; }
        }
      }
      if (state.originalActiveItemId!==null && state.originalActiveItemId!==undefined) {
        checks.active_item=!!app.project.activeItem && Number(app.project.activeItem.id)===Number(state.originalActiveItemId);
      } else { checks.active_item=!app.project.activeItem; }
      checks.revision=revision!==null;
    } else {
      checks.original_project_path=samePath(pathOf(app.project),state.originalProjectPath);
      checks.item_count=Number(app.project.numItems)===Number(state.originalItemCount);
      checks.clean=dirty===false;
      checks.revision=state.originalRevision===null||state.originalRevision===undefined?revision!==null:revision===Number(state.originalRevision);
      if (state.originalActiveItemId!==null && state.originalActiveItemId!==undefined) checks.active_item=!!app.project.activeItem && Number(app.project.activeItem.id)===Number(state.originalActiveItemId);
      else checks.active_item=true;
    }
    for (var key in checks) if (checks.hasOwnProperty(key) && checks[key]!==true) throw new Error("Settled restore verification failed: "+key);
  } catch (error) { failure=String(error)+(error.line?" @line "+error.line:""); }
  try {
    writeJson(resultFile, {
      version: VERSION,
      mode: state ? state.mode : null,
      ok: failure===null,
      checks: checks,
      failure: failure,
      projectFile: pathOf(app.project),
      projectItemCount: app.project ? Number(app.project.numItems) : null,
      projectRevision: revision,
      dirty: dirty,
      activeItemId: app.project && app.project.activeItem ? Number(app.project.activeItem.id) : null,
      activeItemName: app.project && app.project.activeItem ? String(app.project.activeItem.name) : null
    });
  } catch (emitError) { alert("M5 isolation verify could not write result: "+String(emitError)); }
}());
