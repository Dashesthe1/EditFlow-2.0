/* EditFlow 2.0 marker/motion P5 proof-only fixed project reopen. */
(function () {
  "use strict";
  var PROOF_ENV = "EDITFLOW_M3_MARKER_MOTION_P5_PROOF";
  var proofFile = new File($.fileName);
  var repoRoot = proofFile.parent.parent.parent;
  var artifactDir = new Folder(repoRoot.fsName + "/proofs/artifacts/m3-marker-motion-p5-transfer");
  var projectFile = new File(artifactDir.fsName + "/m3-marker-motion-p5-transfer.aep");
  var markerFile = new File(artifactDir.fsName + "/reopen-result.json");
  var hostScript = new File(repoRoot.fsName + "/packages/adapters/ae-cep/host/editflow_host_current_v20.jsx");
  function s(v) { return v === null || v === undefined ? "" : String(v); }
  function samePath(a,b) { return s(a).replace(/\//g,"\\").toLowerCase() === s(b).replace(/\//g,"\\").toLowerCase(); }
  function q(v) { return '"' + s(v).replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\r/g,"\\r").replace(/\n/g,"\\n") + '"'; }
  function json(v) {
    if ($.global.EditFlow2_JSON && typeof $.global.EditFlow2_JSON.stringify === "function") return $.global.EditFlow2_JSON.stringify(v);
    return '{"proofId":'+q(v.proofId)+',"ok":'+(v.ok?'true':'false')+',"error":'+(v.error===null?'null':q(v.error))+',"projectPath":'+(v.projectPath===null?'null':q(v.projectPath))+',"itemCount":'+(v.itemCount===null?'null':v.itemCount)+',"dispatcherReady":'+(v.dispatcherReady?'true':'false')+'}';
  }
  function write(v) { if (!artifactDir.exists && !artifactDir.create()) throw new Error("Cannot create artifact dir."); markerFile.encoding="UTF-8"; if(!markerFile.open("w")) throw new Error("Cannot open reopen marker."); try{markerFile.write(json(v));}finally{markerFile.close();} }
  var out={proofId:"M3_MARKER_MOTION_P5_REOPEN",ok:false,error:null,projectPath:null,itemCount:null,dispatcherReady:false};
  try {
    if ($.getenv(PROOF_ENV)!=="1") throw new Error("REFUSED: marker-motion P5 reopen proof gate is not armed.");
    if (!app.project || !projectFile.exists) throw new Error("Saved marker-motion P5 project is unavailable.");
    if (!app.project.file || !samePath(app.project.file.fsName,projectFile.fsName)) throw new Error("Refusing to close a project other than the fixed proof project.");
    if (!hostScript.exists) throw new Error("Protocol-2.0 host loader is missing.");
    if (app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES)===false) throw new Error("Could not close disposable proof project.");
    app.open(projectFile);
    if (!app.project || !app.project.file || !samePath(app.project.file.fsName,projectFile.fsName)) throw new Error("Fixed saved project did not reopen.");
    try { $.global.EditFlow2_dispatch=undefined; } catch(_) {}
    $.evalFile(hostScript);
    if (typeof $.global.EditFlow2_dispatch!=="function" || $.global.EditFlow2_HOST_PROTOCOL_20!==true) throw new Error("Protocol-2.0 dispatcher did not reload after reopen.");
    out.ok=true; out.projectPath=app.project.file.fsName; out.itemCount=app.project.numItems; out.dispatcherReady=true;
  } catch(e) { out.error=s(e); }
  write(out);
}());
