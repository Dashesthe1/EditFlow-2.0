/* M5 Mocha AE proof fixture: import one proof-owned source and add exactly one mochaAECC effect. */
(function () {
  "use strict";
  var PREFIX = "EF2_M5_MOCHA_";
  var VERSION = "M5_MOCHA_AE_ISOLATION_V1";
  var inputFile = new File(Folder.temp.fsName + "/EditFlow2-m5-mocha-ae-fixture-input.json");
  var resultFile = new File(Folder.temp.fsName + "/EditFlow2-m5-mocha-ae-fixture-result.json");
  var stateFile = new File(Folder.temp.fsName + "/EditFlow2-m5-mocha-ae-isolation-state.json");
  var backupStateFile = new File(Folder.temp.fsName + "/EditFlow2-m5-mocha-ae-isolation-state-backup.json");
  function read(file) {
    if (!file.exists || !file.open("r")) throw new Error("Cannot read " + file.fsName);
    var text = file.read(); file.close(); return text;
  }
  function write(value) {
    if (!resultFile.open("w")) throw new Error("Cannot write " + resultFile.fsName);
    resultFile.encoding = "UTF-8"; resultFile.write(JSON.stringify(value, null, 2)); resultFile.close();
  }
  function positive(value, fallback) { var n = Number(value); return isFinite(n) && n > 0 ? n : fallback; }
  function findItemById(project, id) {
    for (var i = 1; i <= project.numItems; i += 1) if (Number(project.item(i).id) === Number(id)) return project.item(i);
    return null;
  }
  function isBaselineId(state, id) {
    if (!state.originalItems) return false;
    for (var i = 0; i < state.originalItems.length; i += 1) if (Number(state.originalItems[i].id) === Number(id)) return true;
    return false;
  }
  function verifyBaseline(project, state) {
    if (!state.originalItems || Number(project.numItems) !== Number(state.originalItemCount)) return false;
    for (var i = 0; i < state.originalItems.length; i += 1) {
      var expected = state.originalItems[i], item = findItemById(project, expected.id);
      if (!item || String(item.name) !== String(expected.name) || String(item.comment || "") !== String(expected.comment || "")) return false;
    }
    return true;
  }
  function snapshotProperty(prop, depth, state) {
    if (!prop || state.count >= 256 || depth > 4) return null;
    state.count += 1;
    var node = { name: String(prop.name || ""), matchName: String(prop.matchName || ""), index: Number(prop.propertyIndex || 0), children: [] };
    var count = Number(prop.numProperties || 0);
    for (var i = 1; i <= count && state.count < 256; i += 1) {
      var child = snapshotProperty(prop.property(i), depth + 1, state);
      if (child) node.children.push(child);
    }
    return node;
  }
  var result = { proofId: "M5_MOCHA_AE_APPLY_FIXTURE_V1", ok: false, mutationStarted: false, failure: null };
  try {
    var input = JSON.parse(read(inputFile));
    var sf = stateFile.exists ? stateFile : backupStateFile;
    if (!sf.exists) throw new Error("Mocha isolation state is required before fixture mutation.");
    var state = JSON.parse(read(sf));
    if (!state || state.version !== VERSION) throw new Error("Mocha isolation state version mismatch.");
    var project = app.project;
    if (!project || project.file !== null) throw new Error("Fixture requires an unsaved project.");
    if (state.mode === "IN_PLACE_UNSAVED") {
      if (!verifyBaseline(project, state)) throw new Error("In-place Mocha fixture baseline no longer matches isolation entry.");
      for (var existing = 1; existing <= project.numItems; existing += 1) {
        if (String(project.item(existing).name).indexOf(PREFIX) === 0) throw new Error("Proof-owned Mocha item already exists before fixture mutation.");
      }
    } else if (project.numItems !== 0) {
      throw new Error("Saved-project isolation fixture requires the empty unsaved Mocha isolation project.");
    }
    var sourceFile = new File(String(input.sourcePath || ""));
    if (!sourceFile.exists) throw new Error("Mocha proof source file does not exist.");
    var imported = project.importFile(new ImportOptions(sourceFile));
    if (!imported) throw new Error("After Effects did not import the Mocha proof source.");
    result.mutationStarted = true;
    imported.name = PREFIX + "SOURCE";
    imported.comment = "[[EDITFLOW2_STABLE:M5_MOCHA_SOURCE]]";
    var width = Math.floor(positive(imported.width, 1920));
    var height = Math.floor(positive(imported.height, 1080));
    var frameRate = positive(imported.frameRate, 30);
    var duration = Math.min(Math.max(positive(imported.duration, 2), 1), 3);
    var comp = project.items.addComp(PREFIX + "PROOF_COMP", width, height, 1, duration, frameRate);
    comp.comment = "[[EDITFLOW2_STABLE:M5_MOCHA_COMP]]";
    var layer = comp.layers.add(imported);
    layer.name = PREFIX + "SUBJECT";
    layer.comment = "[[EDITFLOW2_STABLE:M5_MOCHA_LAYER]]";
    var parade = layer.property("ADBE Effect Parade");
    if (!parade || !parade.canAddProperty("mochaAECC")) throw new Error("mochaAECC is not addable to the proof layer.");
    var beforeCount = Number(parade.numProperties);
    var deferMochaEffect = input.deferMochaEffect === true;
    var effect = null, afterCount = beforeCount, treeState = { count: 0 }, tree = null;
    if (!deferMochaEffect) {
      effect = parade.addProperty("mochaAECC");
      if (!effect) throw new Error("After Effects did not add mochaAECC.");
      afterCount = Number(parade.numProperties);
      if (String(effect.matchName) !== "mochaAECC") throw new Error("Unexpected Mocha effect match name: " + String(effect.matchName));
      if (afterCount !== beforeCount + 1) throw new Error("Mocha effect count did not increase exactly once.");
      tree = snapshotProperty(effect, 0, treeState);
    } else if (beforeCount !== 0) {
      throw new Error("Deferred Mocha fixture requires a zero-effect proof layer.");
    }
    result.ok = true;
    result.isolationMode = state.mode;
    result.projectRevision = Number(project.revision);
    result.itemCount = Number(project.numItems);
    result.compHostId = Number(comp.id);
    result.layerHostId = Number(layer.id);
    result.effectDeferred = deferMochaEffect;
    result.effectIndex = effect ? Number(effect.propertyIndex) : null;
    result.effectName = effect ? String(effect.name) : null;
    result.effectMatchName = effect ? String(effect.matchName) : null;
    result.effectCountBefore = beforeCount;
    result.effectCountAfter = afterCount;
    result.propertyNodeCount = treeState.count;
    result.propertyTree = tree;
    result.width = Number(comp.width);
    result.height = Number(comp.height);
    result.frameRate = Number(comp.frameRate);
    for (var itemIndex = 1; itemIndex <= project.numItems; itemIndex += 1) {
      var current = project.item(itemIndex), currentName = String(current.name);
      if (currentName.indexOf(PREFIX) === 0) continue;
      if (state.mode !== "IN_PLACE_UNSAVED" || !isBaselineId(state, Number(current.id))) throw new Error("Fixture created a non-owned project item.");
    }
  } catch (error) {
    result.failure = String(error) + (error.line ? " @line " + error.line : "");
  }
  try { write(result); }
  catch (emitError) { alert("M5 Mocha AE fixture result write failed: " + String(emitError)); }
}());
