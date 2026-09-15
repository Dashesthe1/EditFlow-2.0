(function () {
  var reqPath = Folder.temp.fsName + "/EditFlow2-m5-roto-brush-tool-select-request.json";
  var resPath = Folder.temp.fsName + "/EditFlow2-m5-roto-brush-tool-select-response.json";
  function readJson(path) { var f=new File(path); if(!f.open("r")) throw new Error("request unavailable"); var t=f.read(); f.close(); return JSON.parse(t); }
  function writeJson(value) { var f=new File(resPath); f.encoding="UTF-8"; if(!f.open("w")) throw new Error("response unavailable"); f.write(JSON.stringify(value)); f.close(); }
  var response = { schema:"editflow.roto-brush-tool-select.v1", requestId:null, ok:false, tool:null, toolType:null, error:null };
  try {
    var request = readJson(reqPath);
    response.requestId = request.requestId;
    response.tool = request.tool;
    if (request.schema !== response.schema || !request.requestId) throw new Error("invalid tool-select request");
    if (!app.project) throw new Error("no active After Effects project");
    // Bind to the empirically verified AE 25.6.6 ToolType values directly. In the active
    // Layer-viewer context, symbolic ToolType lookup was observed to echo the previous
    // grouped-tool member even though standalone enum discovery reported the documented values.
    var expected = request.tool === "ROTO_BRUSH" ? 9041
      : request.tool === "REFINE_EDGE" ? 9042 : null;
    if (expected === null) throw new Error("unsupported tool-select target");
    app.project.toolType = expected;
    response.toolType = String(app.project.toolType);
    if (String(app.project.toolType) !== String(expected)) throw new Error("After Effects did not retain requested toolType");
    response.ok = true;
  } catch (e) { response.error = e.toString(); }
  writeJson(response);
})();
