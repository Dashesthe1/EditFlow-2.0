(function () {
  "use strict";
  var root = new Folder("C:/Users/Shadow/EditFlow-2.0");
  var out = new File(root.fsName + "/proofs/artifacts/m4-two-point-analysis-fixture-setup.json");
  function write(value) {
    out.parent.create();
    out.open("w");
    out.encoding = "UTF-8";
    out.write(JSON.stringify(value));
    out.close();
  }
  function findByName(name) {
    for (var i = 1; i <= app.project.numItems; i += 1) {
      if (app.project.item(i).name === name) return app.project.item(i);
    }
    return null;
  }
  function seed(point, center) {
    point.property("ADBE MTracker Pt Feature Center").setValue(center);
    point.property("ADBE MTracker Pt Attach Pt").setValue(center);
    point.property("ADBE MTracker Pt Feature Size").setValue([80, 80]);
    point.property("ADBE MTracker Pt Search Size").setValue([160, 160]);
  }
  var r = { ok: false };
  try {
    if (!app.project) throw new Error("No project");
    var original = app.project.activeItem;
    if (!original || !(original instanceof CompItem)) throw new Error("Active composition required");
    var baselineItems = app.project.numItems;
    if (findByName("EF2_M4_TP_ANALYSIS_OWNED")) throw new Error("Owned folder already exists");
    if (findByName("TP_SOURCE")) throw new Error("Source fixture already exists");
    if (findByName("TP_FIXTURE")) throw new Error("Analysis fixture already exists");
    var folder = app.project.items.addFolder("EF2_M4_TP_ANALYSIS_OWNED");
    var sourceComp = app.project.items.addComp("TP_SOURCE", 720, 720, 1, 3, 30);
    sourceComp.parentFolder = folder;
    var black = sourceComp.layers.addSolid([0, 0, 0], "EF2_M4_TP_BLACK", 720, 720, 1, 3);
    black.source.parentFolder = folder;
    black.name = "EF2_M4_TP_BLACK_LAYER";
    var featureA = sourceComp.layers.addSolid([1, 1, 1], "EF2_M4_TP_FEATURE", 60, 60, 1, 3);
    featureA.source.parentFolder = folder;
    featureA.name = "EF2_M4_TP_FEATURE_A";
    var featureB = featureA.duplicate();
    featureB.name = "EF2_M4_TP_FEATURE_B";
    var posA = featureA.property("ADBE Transform Group").property("ADBE Position");
    var posB = featureB.property("ADBE Transform Group").property("ADBE Position");
    posA.setValueAtTime(0, [220, 360]);
    posA.setValueAtTime(2.5, [208.7, 304.9]);
    posB.setValueAtTime(0, [500, 360]);
    posB.setValueAtTime(2.5, [511.3, 415.1]);
    var fixture = app.project.items.addComp("TP_FIXTURE", 720, 720, 1, 3, 30);
    fixture.parentFolder = folder;
    var layer = fixture.layers.add(sourceComp);
    layer.name = "TP_TARGET";
    var motion = layer.property("ADBE MTrackers");
    var tracker = motion.addProperty("ADBE MTracker");
    tracker.name = "Tracker 1";
    var pointA = tracker.addProperty("ADBE MTracker Pt");
    seed(pointA, [220, 360]);
    var pointB = tracker.addProperty("ADBE MTracker Pt");
    seed(pointB, [500, 360]);
    fixture.time = 0;
    for (var li = 1; li <= fixture.numLayers; li += 1) fixture.layer(li).selected = false;
    layer.selected = true;
    try { tracker.selected = true; } catch (_) {}
    try {
      tracker.property(1).selected = true;
      tracker.property(2).selected = true;
    } catch (_) {}
    fixture.openInViewer();
    try { layer.openInViewer(); } catch (_) {}
    fixture.time = 0;
    var trackerPanelId = app.findMenuCommandId("Tracker");
    if (trackerPanelId > 0) app.executeCommand(trackerPanelId);
    r = {
      ok: true,
      baselineItems: baselineItems,
      itemCountAfterSetup: app.project.numItems,
      originalCompId: original.id,
      originalCompName: original.name,
      folderId: folder.id,
      sourceCompId: sourceComp.id,
      fixtureCompId: fixture.id,
      layerId: layer.id,
      trackerPanelId: trackerPanelId,
      pointCount: tracker.numProperties,
      duration: fixture.duration,
      frameRate: fixture.frameRate
    };
  } catch (error) {
    r.error = String(error);
  }
  write(r);
}());
