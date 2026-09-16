/* M5 fixed Roto Brush export dispatch. Request is bounded JSON data; no caller code is evaluated. */
(function () {
  "use strict";
  var requestFile = new File(Folder.temp.fsName + "/EditFlow2-m5-roto-brush-export-request.json");
  var responseFile = new File(Folder.temp.fsName + "/EditFlow2-m5-roto-brush-export-response.json");
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
  function allowed(request) {
    if (!request) return false;
    if (request.protocolVersion === "2.6.0") {
      return request.command === "roto_brush.readback" && request.capabilityId === "ae.roto_brush.session.inspect";
    }
    if (request.protocolVersion === "1.1.0") {
      if (request.command === "project.inspect") return request.capabilityId === "ae.project.inspect";
      if (request.command === "layer.duplicate") return request.capabilityId === "ae.layer.duplicate";
    }
    return false;
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
    if (!allowed(parsed)) throw new Error("Request is not an allowed bounded M5 export command.");
    var raw = $.global.EditFlow2_dispatch(requestText);
    if (raw === null || raw === undefined || String(raw).length === 0) throw new Error("M5 export dispatcher returned no response.");
    write(String(raw));
  } catch (error) {
    try { write("{\"__transportError\":\"" + escapeJson(String(error) + (error.line ? " @line " + error.line : "")) + "\"}"); } catch (_) {}
  }
}());
