(function () {
  "use strict";
  var root = new Folder("C:/Users/Shadow/EditFlow-2.0");
  var out = new File(root.fsName + "/proofs/artifacts/m4-face-tracking-v1-fixture.json");
  function write(v) { out.parent.create(); out.open("w"); out.encoding = "UTF-8"; out.write(JSON.stringify(v)); out.close(); }
  function findByName(name) { for (var i = 1; i <= app.project.numItems; i += 1) if (app.project.item(i).name === name) return app.project.item(i); return null; }
  var result = { proof: "M4_FACE_TRACKING_V1_FIXTURE", ok: false };
  try {
    if (!app.project) throw new Error("No project open.");
    var original = findByName("Comp 1");
    if (!original || !(original instanceof CompItem) || original.numLayers < 1) throw new Error("Comp 1 source fixture is required.");
    var existing = findByName("EF2_M4_FACE_TRACK_FIXTURE");
    if (existing) existing.remove();
    var source = original.layer(1).source;
    if (!source) throw new Error("Comp 1 layer 1 has no source.");
    var comp = app.project.items.addComp("EF2_M4_FACE_TRACK_FIXTURE", 1080, 1080, 1, 8, original.frameRate);
    var layer = comp.layers.add(source);
    layer.name = "EF2_M4_FACE_TRACK_TARGET";
    layer.comment = "[[EDITFLOW2_STABLE:M4_FACE_TRACK_LAYER]]";
    layer.startTime = 0; layer.inPoint = 0; layer.outPoint = Math.min(5.7, source.duration || 5.7);
    var masks = layer.property("ADBE Mask Parade");
    var mask = masks.addProperty("ADBE Mask Atom");
    mask.name = "EditFlow Face Mask [[EDITFLOW2_MASK:M4_FACE_TRACK_1]]";
    var shape = new Shape();
    shape.closed = true;
    shape.vertices = [[455,120],[610,105],[680,180],[675,310],[610,365],[485,360],[410,295],[405,190]];
    shape.inTangents = [[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0]];
    shape.outTangents = [[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0]];
    var path = mask.property("ADBE Mask Shape"); path.setValue(shape);
    comp.time = 5.0;
    comp.workAreaStart = 5.0; comp.workAreaDuration = 0.7;
    for (var i = 1; i <= comp.numLayers; i += 1) comp.layer(i).selected = false;
    layer.selected = true; path.selected = true; comp.openInViewer();
    result.ok = true; result.compHostId = comp.id; result.layerHostId = layer.id;
    result.maskStableId = "M4_FACE_TRACK_1"; result.maskName = "EditFlow Face Mask";
    result.startTime = comp.time; result.frameRate = comp.frameRate; result.pathKeyCount = path.numKeys;
  } catch (caught) { result.failure = String(caught); } finally { write(result); }
}());
