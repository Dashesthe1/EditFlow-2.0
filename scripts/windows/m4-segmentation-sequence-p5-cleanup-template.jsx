(function () {
  "use strict";
  var originalProjectFile = new File("__EDITFLOW_ORIGINAL_PROJECT_PATH__");
  var lifecycleProjectFile = new File("__EDITFLOW_LIFECYCLE_PROJECT_PATH__");
  var planFile = new File("__EDITFLOW_PLAN_PATH__");
  var resultFile = new File("__EDITFLOW_CLEANUP_RESULT__");
  var STABLE_PREFIX = "[[EDITFLOW2_STABLE:";
  var STABLE_SUFFIX = "]]";
  var checks = {};
  var failure = null;

  function readText(file) {
    if (!file.exists || !file.open("r")) throw new Error("Cannot read " + file.fsName);
    var text = file.read(); file.close(); return text;
  }
  function writeJson(file, value) {
    if (!file.parent.exists) file.parent.create();
    if (!file.open("w")) throw new Error("Cannot write " + file.fsName);
    file.encoding = "UTF-8"; file.write(JSON.stringify(value, null, 2)); file.close();
  }
  function stableId(target) {
    var text = String(target && target.comment !== undefined ? target.comment : "");
    var start = text.indexOf(STABLE_PREFIX);
    if (start < 0) return null;
    start += STABLE_PREFIX.length;
    var end = text.indexOf(STABLE_SUFFIX, start);
    return end < 0 ? null : text.substring(start, end);
  }
  function findItem(id) {
    if (!app.project) return null;
    for (var i = 1; i <= app.project.numItems; i += 1) {
      var item = app.project.item(i);
      if (stableId(item) === id) return item;
    }
    return null;
  }

  try {
    if (!originalProjectFile.exists) throw new Error("Original user project is missing: " + originalProjectFile.fsName);
    if (!planFile.exists) throw new Error("Lifecycle plan is missing");
    var plan = JSON.parse(readText(planFile));
    var currentPath = app.project && app.project.file ? app.project.file.fsName : null;
    var onLifecycle = currentPath === lifecycleProjectFile.fsName;
    checks.cleanup_scope_guarded = currentPath === originalProjectFile.fsName || onLifecycle;
    if (!checks.cleanup_scope_guarded) throw new Error("Cleanup refused unexpected open project: " + currentPath);

    if (onLifecycle) {
      try { var ownedComp = findItem("M4_TRANSFER_SEQUENCE_COMP"); if (ownedComp) ownedComp.remove(); } catch (_) {}
      var ownedIds = [plan.plan.importItemStableId, "M4_TRANSFER_BG_MEDIA"];
      for (var i = 0; i < ownedIds.length; i += 1) {
        try { var owned = findItem(ownedIds[i]); if (owned) owned.remove(); } catch (_) {}
      }
      checks.proof_objects_removed = !findItem("M4_TRANSFER_SEQUENCE_COMP") && !findItem(plan.plan.importItemStableId) && !findItem("M4_TRANSFER_BG_MEDIA");
      app.project.save(lifecycleProjectFile);
      checks.lifecycle_cleanup_saved = lifecycleProjectFile.exists && app.project.file && app.project.file.fsName === lifecycleProjectFile.fsName;
    } else {
      checks.proof_objects_removed = true;
      checks.lifecycle_cleanup_saved = true;
    }

    if (!app.project || !app.project.file || app.project.file.fsName !== originalProjectFile.fsName) app.open(originalProjectFile);
    checks.original_project_reopened = !!app.project && !!app.project.file && app.project.file.fsName === originalProjectFile.fsName;
  } catch (error) {
    failure = String(error) + (error.line ? " @line " + error.line : "");
  }

  var allChecks = true;
  var checkCount = 0;
  for (var key in checks) if (checks.hasOwnProperty(key)) { checkCount += 1; if (checks[key] !== true) allChecks = false; }
  writeJson(resultFile, {
    schemaVersion: 1,
    proofId: "M4_SEGMENTATION_SEQUENCE_P5_CLEANUP",
    ok: failure === null && allChecks,
    checkCount: checkCount,
    checks: checks,
    failure: failure,
    projectFile: app.project && app.project.file ? app.project.file.fsName : null,
    projectItemCount: app.project ? app.project.numItems : null,
    projectRevision: app.project ? app.project.revision : null
  });
}());
