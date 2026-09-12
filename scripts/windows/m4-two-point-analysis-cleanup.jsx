(function () {
  "use strict";
  var root = new Folder("C:/Users/Shadow/EditFlow-2.0");
  var setupFile = new File(root.fsName + "/proofs/artifacts/m4-two-point-analysis-fixture-setup.json");
  var out = new File(root.fsName + "/proofs/artifacts/m4-two-point-analysis-cleanup.json");
  function write(value) { out.parent.create(); out.open("w"); out.encoding = "UTF-8"; out.write(JSON.stringify(value)); out.close(); }
  function readJson(file) { file.open("r"); var text = file.read(); file.close(); return JSON.parse(text); }
  function findByName(name) {
    for (var i = 1; i <= app.project.numItems; i += 1) if (app.project.item(i).name === name) return app.project.item(i);
    return null;
  }
  function findById(id) {
    for (var i = 1; i <= app.project.numItems; i += 1) if (app.project.item(i).id === id) return app.project.item(i);
    return null;
  }
  var r = { ok: false };
  try {
    if (!setupFile.exists) throw new Error("Setup evidence missing");
    var setup = readJson(setupFile);
    if (!setup.ok) throw new Error("Setup evidence is not accepted");
    var folder = findByName("EF2_M4_TP_ANALYSIS_OWNED");
    if (!folder || !(folder instanceof FolderItem)) throw new Error("Owned folder missing");
    var fixture = findByName("TP_FIXTURE");
    var sourceComp = findByName("TP_SOURCE");
    var black = findByName("EF2_M4_TP_BLACK");
    var feature = findByName("EF2_M4_TP_FEATURE");
    if (!fixture || fixture.parentFolder.id !== folder.id) throw new Error("Fixture ownership mismatch");
    if (!sourceComp || sourceComp.parentFolder.id !== folder.id) throw new Error("Source ownership mismatch");
    if (!black || black.parentFolder.id !== folder.id) throw new Error("Black source ownership mismatch");
    if (!feature || feature.parentFolder.id !== folder.id) throw new Error("Feature source ownership mismatch");
    fixture.remove();
    sourceComp.remove();
    black.remove();
    feature.remove();
    if (folder.numItems !== 0) throw new Error("Owned folder still contains unexpected items");
    folder.remove();
    var original = findById(setup.originalCompId);
    if (!original || !(original instanceof CompItem) || original.name !== setup.originalCompName) throw new Error("Original composition identity mismatch");
    original.openInViewer();
    r = {
      ok: app.project.numItems === setup.baselineItems,
      itemCountAfter: app.project.numItems,
      baselineItems: setup.baselineItems,
      activeCompName: app.project.activeItem ? app.project.activeItem.name : null
    };
    r.ownedFolderRemoved = findByName("EF2_M4_TP_ANALYSIS_OWNED") === null;
    r.fixtureRemoved = findByName("TP_FIXTURE") === null;
    r.sourceRemoved = findByName("TP_SOURCE") === null;
    r.originalCompRestored = app.project.activeItem && app.project.activeItem.id === setup.originalCompId;
    r.ok = r.ok && r.ownedFolderRemoved && r.fixtureRemoved && r.sourceRemoved && r.originalCompRestored;
  } catch (error) {
    r.error = String(error);
  }
  write(r);
}());
