/* M5 protocol 2.6 fixed readback dispatch. Request is data in a bounded temp file; no caller script is evaluated. */
(function () {
  "use strict";
  var requestFile = new File(Folder.temp.fsName + "/EditFlow2-m5-roto-brush-readback-request.json");
  var responseFile = new File(Folder.temp.fsName + "/EditFlow2-m5-roto-brush-readback-response.json");
  function read(file) {
    if (!file.exists || !file.open("r")) throw new Error("Cannot read " + file.fsName);
    var text = file.read(); file.close(); return text;
  }
  function write(text) {
    if (!responseFile.open("w")) throw new Error("Cannot write " + responseFile.fsName);
    responseFile.encoding = "UTF-8"; responseFile.write(text); responseFile.close();
  }
  function escapeJson(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/\"/g, "\\\"").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  }
  try {
    var currentFile = new File($.fileName);
    var repoRoot = currentFile.parent.parent.parent;
    var loader = new File(repoRoot.fsName + "/packages/adapters/ae-cep/host/editflow_host_current_v26.jsx");
    if (!loader.exists) throw new Error("Protocol 2.6 host loader is missing.");
    $.evalFile(loader);
    if (typeof $.global.EditFlow2_dispatch !== "function" || $.global.EditFlow2_HOST_PROTOCOL_26 !== true) {
      throw new Error("Protocol 2.6 dispatcher did not register.");
    }
    var requestText = read(requestFile);
    var parsed = JSON.parse(requestText);
    if (!parsed || parsed.protocolVersion !== "2.6.0" || parsed.command !== "roto_brush.readback") {
      throw new Error("Readback request is not the bounded M5 protocol 2.6 command.");
    }
    var raw = $.global.EditFlow2_dispatch(requestText);
    if (raw === null || raw === undefined || String(raw).length === 0) throw new Error("Protocol 2.6 dispatcher returned no response.");
    write(String(raw));
  } catch (error) {
    try {
      write("{\"__transportError\":\"" + escapeJson(String(error) + (error.line ? " @line " + error.line : "")) + "\"}");
    } catch (_) {}
  }
}());
