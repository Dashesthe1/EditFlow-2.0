(function () {
  "use strict";
  var out = new File("C:/Users/Shadow/EditFlow-2.0/proofs/artifacts/m4-mask-tracking-v1-inspect.json");
  function write(v) { out.parent.create(); out.open("w"); out.encoding = "UTF-8"; out.write(JSON.stringify(v)); out.close(); }
  var result = { proof: "M4_MASK_TRACKING_V1_INSPECT", ok: false };
  try {
    var comp = null;
    for (var i = 1; i <= app.project.numItems; i += 1) if (app.project.item(i).name === "EF2_M4_MASK_TRACK_FIXTURE") comp = app.project.item(i);
    if (!comp) throw new Error("Fixture comp missing.");
    var layer = comp.layer("EF2_M4_MASK_TRACK_TARGET");
    var mask = layer.property("ADBE Mask Parade").property(1);
    var path = mask.property("ADBE Mask Shape");
    var times = [];
    for (var k = 1; k <= path.numKeys; k += 1) times.push(path.keyTime(k));
    result.ok = true;
    result.compHostId = comp.id;
    result.layerHostId = layer.id;
    result.maskName = mask.name;
    result.pathKeyCount = path.numKeys;
    result.firstKeyTime = path.numKeys ? path.keyTime(1) : null;
    result.lastKeyTime = path.numKeys ? path.keyTime(path.numKeys) : null;
    result.sampleTimes = times.slice(0, 10);
  } catch (caught) { result.failure = String(caught); }
  write(result);
}());
