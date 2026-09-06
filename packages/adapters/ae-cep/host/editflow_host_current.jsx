/* EditFlow 2.0 current AE host loader: self-contained JSON runtime + green v1.0 base + protocol 1.1 hardening + operation atomicity + render jobs + async render override. */
(function () {
  var currentFile = new File($.fileName);
  var hostDir = currentFile.parent;
  var jsonRuntime = new File(hostDir.fsName + "/editflow_json.jsx");
  var base = new File(hostDir.fsName + "/editflow_host.jsx");
  var hardening = new File(hostDir.fsName + "/editflow_host_hardening.jsx");
  var atomicity = new File(hostDir.fsName + "/editflow_host_atomicity.jsx");
  var renderJobs = new File(hostDir.fsName + "/editflow_host_render_jobs.jsx");
  var renderAsync = new File(hostDir.fsName + "/editflow_host_render_async.jsx");
  if (!jsonRuntime.exists) throw new Error("EditFlow JSON runtime is missing: " + jsonRuntime.fsName);
  if (!base.exists) throw new Error("EditFlow base AE host script is missing: " + base.fsName);
  if (!hardening.exists) throw new Error("EditFlow AE host hardening script is missing: " + hardening.fsName);
  if (!atomicity.exists) throw new Error("EditFlow AE host atomicity script is missing: " + atomicity.fsName);
  if (!renderJobs.exists) throw new Error("EditFlow AE render-job script is missing: " + renderJobs.fsName);
  if (!renderAsync.exists) throw new Error("EditFlow AE async-render script is missing: " + renderAsync.fsName);

  $.evalFile(jsonRuntime);
  if (!$.global.EditFlow2_JSON || typeof $.global.EditFlow2_JSON.parse !== "function" || typeof $.global.EditFlow2_JSON.stringify !== "function") {
    throw new Error("EditFlow JSON runtime failed to register.");
  }

  /* After Effects ExtendScript does not guarantee a native JSON object. Install our
   * standards-shaped codec only when JSON is absent so checked-in proof scripts and
   * other EditFlow host code do not depend on another Adobe panel having polyfilled it.
   * Never overwrite a JSON implementation that already exists in the shared host.
   */
  if (typeof $.global.JSON === "undefined") $.global.JSON = $.global.EditFlow2_JSON;

  $.evalFile(base);
  $.evalFile(hardening);
  $.evalFile(atomicity);
  $.evalFile(renderJobs);
  $.evalFile(renderAsync);
  if (typeof $.global.EditFlow2_dispatch !== "function") {
    throw new Error("EditFlow current AE dispatcher failed to register.");
  }

  /* The legacy host layers use JSON.parse/stringify internally. Other Adobe panels can
   * replace/remove the shared JSON object after EditFlow loads, so bind our codec for the
   * duration of every EditFlow dispatch and restore the prior global afterward.
   */
  var dispatchWithAmbientJson = $.global.EditFlow2_dispatch;
  $.global.EditFlow2_dispatch = function (requestJson) {
    var hadJson = typeof $.global.JSON !== "undefined";
    var previousJson = hadJson ? $.global.JSON : null;
    $.global.JSON = $.global.EditFlow2_JSON;
    try {
      return dispatchWithAmbientJson(requestJson);
    } finally {
      if (hadJson) $.global.JSON = previousJson;
      else {
        try { delete $.global.JSON; } catch (_) { $.global.JSON = undefined; }
      }
    }
  };
}());
