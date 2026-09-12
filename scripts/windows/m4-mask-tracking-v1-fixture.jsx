(function () {
  "use strict";
  var root = new Folder("C:/Users/Shadow/EditFlow-2.0");
  var out = new File(root.fsName + "/proofs/artifacts/m4-mask-tracking-v1-fixture.json");
  function write(v) { out.parent.create(); out.open("w"); out.encoding = "UTF-8"; out.write(JSON.stringify(v)); out.close(); }
  function findByName(name) { for (var i = 1; i <= app.project.numItems; i += 1) if (app.project.item(i).name === name) return app.project.item(i); return null; }
  var result = { proof: "M4_MASK_TRACKING_V1_FIXTURE", ok: false };
  try {
    if (!app.project) throw new Error("No project open.");
    var original = app.project.activeItem;
    var existing = findByName("EF2_M4_MASK_TRACK_FIXTURE");
    if (!original || !(original instanceof CompItem) || original.numLayers < 1 || (existing && original.id === existing.id)) original = findByName("Comp 1");
    if (!original || !(original instanceof CompItem) || original.numLayers < 1) throw new Error("Source comp required.");
    if (existing) existing.remove();
    var source = original.layer(1).source;
    if (!source) throw new Error("Active layer has no source.");
    var baselineItems = app.project.numItems;
    var comp = app.project.items.addComp("EF2_M4_MASK_TRACK_FIXTURE", 1080, 1080, 1, 6, original.frameRate);
    var layer = comp.layers.add(source);
    layer.name = "EF2_M4_MASK_TRACK_TARGET";
    layer.comment = "[[EDITFLOW2_STABLE:M4_MASK_TRACK_LAYER]]";
    layer.startTime = 0;
    layer.inPoint = 0;
    layer.outPoint = Math.min(6, source.duration || 6);
    var masks = layer.property("ADBE Mask Parade");
    var mask = masks.addProperty("ADBE Mask Atom");
    mask.name = "EditFlow Track Mask [[EDITFLOW2_MASK:M4_MASK_TRACK_1]]";
    var shape = new Shape();
    shape.closed = true;
    shape.vertices = [[360, 360], [720, 360], [720, 720], [360, 720]];
    shape.inTangents = [[0, 0], [0, 0], [0, 0], [0, 0]];
    shape.outTangents = [[0, 0], [0, 0], [0, 0], [0, 0]];
    var path = mask.property("ADBE Mask Shape");
    path.setValue(shape);
    comp.time = 0;
    comp.workAreaStart = 0;
    comp.workAreaDuration = Math.min(5, comp.duration);
    for (var i = 1; i <= comp.numLayers; i += 1) comp.layer(i).selected = false;
    layer.selected = true;
    path.selected = true;
    comp.openInViewer();
    result.ok = true;
    result.originalCompHostId = original.id;
    result.originalCompName = original.name;
    result.baselineItemCount = baselineItems;
    result.compHostId = comp.id;
    result.layerHostId = layer.id;
    result.maskStableId = "M4_MASK_TRACK_1";
    result.maskName = "EditFlow Track Mask";
    result.pathKeyCount = path.numKeys;
    result.frameRate = comp.frameRate;
    result.duration = comp.duration;
    result.workAreaDuration = comp.workAreaDuration;
    result.projectItemCountAfter = app.project.numItems;
  } catch (caught) {
    result.failure = String(caught);
  } finally {
    write(result);
  }
}());
