(function () {
  var out = new File(Folder.temp.fsName + "/EditFlow2-m5-mocha-ae-source.json");
  var pending = new File(Folder.temp.fsName + "/EditFlow2-m5-mocha-ae-source.pending.json");
  function quote(value) {
    var text = value === null || value === undefined ? "" : String(value);
    return "\"" + text.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"").replace(/\r/g, "\\r").replace(/\n/g, "\\n") + "\"";
  }
  function bool(value) { return value ? "true" : "false"; }
  function write(v) {
    var text = "{\"ok\":" + bool(v.ok) + ",\"sourcePath\":" + (v.sourcePath === null ? "null" : quote(v.sourcePath)) + ",\"compId\":" + (v.compId === null ? "null" : String(v.compId)) + ",\"layerId\":" + (v.layerId === null ? "null" : String(v.layerId)) + ",\"failure\":" + (v.failure === null ? "null" : quote(v.failure)) + "}";
    try { if (pending.exists) pending.remove(); } catch (_) {}
    if (!pending.open("w")) throw new Error("Cannot write pending source probe");
    try { pending.encoding = "UTF-8"; pending.write(text); } finally { try { pending.close(); } catch (_) {} }
    if (out.exists && !out.remove()) throw new Error("Cannot replace previous source probe");
    if (!pending.rename(out.name)) throw new Error("Cannot publish source probe atomically");
  }
  var result = { ok:false, sourcePath:null, compId:null, layerId:null, failure:null };
  try {
    var item = app.project && app.project.activeItem;
    if (!item || !item.layers || item.numLayers < 1) throw new Error("Active composition/layer required.");
    var layer = item.layer(1); if (!layer.source || !layer.source.file) throw new Error("Active layer has no file-backed source.");
    result.sourcePath = layer.source.file.fsName; result.compId = Number(item.id); result.layerId = Number(layer.id); result.ok = true;
  } catch (e) { result.failure = String(e) + (e.line ? " @line " + e.line : ""); }
  write(result);
}());