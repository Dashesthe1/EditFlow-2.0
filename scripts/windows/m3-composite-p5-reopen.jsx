/* EditFlow 2.0 M3 composite P5 proof-only save/reopen transfer step.
 * RUN ONLY on the isolated self-hosted Windows AE runner with
 * EDITFLOW_M3_COMPOSITE_P5_PROOF=1. The project path is fixed inside the
 * runner-owned proof artifact directory; no caller-controlled path is accepted.
 */
(function () {
  "use strict";

  var PROOF_ENV = "EDITFLOW_M3_COMPOSITE_P5_PROOF";
  var proofFile = new File($.fileName);
  var repoRoot = proofFile.parent.parent.parent;
  var artifactDir = new Folder(repoRoot.fsName + "/proofs/artifacts/m3-composite-p5-transfer");
  var projectFile = new File(artifactDir.fsName + "/m3-composite-p5-transfer.aep");
  var markerFile = new File(artifactDir.fsName + "/reopen-result.json");
  var hostScript = new File(repoRoot.fsName + "/packages/adapters/ae-cep/host/editflow_host_current.jsx");

  function asString(value) { return value === null || value === undefined ? "" : String(value); }
  function samePath(left, right) {
    return asString(left).replace(/\//g, "\\").toLowerCase() === asString(right).replace(/\//g, "\\").toLowerCase();
  }
  function quote(value) {
    var text = asString(value);
    text = text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
    return "\"" + text + "\"";
  }
  function stringify(value) {
    if ($.global.EditFlow2_JSON && typeof $.global.EditFlow2_JSON.stringify === "function") {
      return $.global.EditFlow2_JSON.stringify(value);
    }
    return "{" +
      "\"proofId\":" + quote(value.proofId) + "," +
      "\"ok\":" + (value.ok ? "true" : "false") + "," +
      "\"error\":" + (value.error === null ? "null" : quote(value.error)) +
      "}";
  }
  function writeMarker(value) {
    if (!artifactDir.exists && !artifactDir.create()) throw new Error("Unable to create M3 composite P5 artifact directory.");
    markerFile.encoding = "UTF-8";
    if (!markerFile.open("w")) throw new Error("Unable to open M3 composite P5 reopen marker: " + markerFile.fsName);
    try { markerFile.write(stringify(value)); } finally { markerFile.close(); }
  }

  var payload = {
    proofId: "M3_COMPOSITE_P5_REOPEN",
    ok: false,
    error: null,
    projectPath: null,
    itemCount: null,
    hostProjectRevision: null,
    dispatcherReady: false,
    completedAtMs: (new Date()).getTime()
  };

  try {
    if ($.getenv(PROOF_ENV) !== "1") throw new Error("REFUSED: M3 composite P5 reopen requires the isolated proof environment.");
    if (!app.project) throw new Error("M3 composite P5 reopen requires an open After Effects project.");
    if (!projectFile.exists) throw new Error("M3 composite P5 saved project artifact does not exist: " + projectFile.fsName);
    if (!app.project.file || !samePath(app.project.file.fsName, projectFile.fsName)) {
      throw new Error("M3 composite P5 reopen refuses to close a project other than the fixed runner-owned saved proof project.");
    }
    if (!hostScript.exists) throw new Error("EditFlow current host loader is missing: " + hostScript.fsName);

    var closed = app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    if (closed === false) throw new Error("M3 composite P5 reopen could not close the saved disposable proof project.");
    app.open(projectFile);
    if (!app.project || !app.project.file || !samePath(app.project.file.fsName, projectFile.fsName)) {
      throw new Error("M3 composite P5 reopen did not reopen the fixed saved project.");
    }

    /* Force a fresh host-dispatcher registration after project reopen rather than
     * treating the pre-save global function as transfer evidence. */
    try { $.global.EditFlow2_dispatch = undefined; } catch (_) {}
    $.evalFile(hostScript);
    if (typeof $.global.EditFlow2_dispatch !== "function") {
      throw new Error("M3 composite P5 current EditFlow dispatcher did not register after reopen.");
    }

    payload.ok = true;
    payload.projectPath = app.project.file.fsName;
    payload.itemCount = app.project.numItems;
    payload.hostProjectRevision = app.project.revision;
    payload.dispatcherReady = true;
    payload.completedAtMs = (new Date()).getTime();
  } catch (error) {
    payload.error = asString(error);
    payload.completedAtMs = (new Date()).getTime();
  }

  writeMarker(payload);
}());
