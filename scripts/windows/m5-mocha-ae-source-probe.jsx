(function () {
  var out = new File(Folder.temp.fsName + "/EditFlow2-m5-mocha-ae-source.json");
  function write(v) { if (!out.open("w")) throw new Error("Cannot write source probe"); out.encoding="UTF-8"; out.write(JSON.stringify(v)); out.close(); }
  var result = { ok:false, sourcePath:null, compId:null, layerId:null, failure:null };
  try {
    var item = app.project && app.project.activeItem;
    if (!item || !item.layers || item.numLayers < 1) throw new Error("Active composition/layer required.");
    var layer = item.layer(1);
    if (!layer.source || !layer.source.file) throw new Error("Active layer has no file-backed source.");
    result.sourcePath = layer.source.file.fsName;
    result.compId = Number(item.id);
    result.layerId = Number(layer.id);
    result.ok = true;
  } catch (e) { result.failure = String(e); }
  write(result);
}());
