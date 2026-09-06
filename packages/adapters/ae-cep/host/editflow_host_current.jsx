/* EditFlow 2.0 current AE host loader: self-contained JSON runtime + green v1.0 base + protocol 1.1 hardening + operation atomicity. */
(function () {
  var currentFile = new File($.fileName);
  var hostDir = currentFile.parent;
  var jsonRuntime = new File(hostDir.fsName + "/editflow_json.jsx");
  var base = new File(hostDir.fsName + "/editflow_host.jsx");
  var hardening = new File(hostDir.fsName + "/editflow_host_hardening.jsx");
  var atomicity = new File(hostDir.fsName + "/editflow_host_atomicity.jsx");
  if (!jsonRuntime.exists) throw new Error("EditFlow JSON runtime is missing: " + jsonRuntime.fsName);
  if (!base.exists) throw new Error("EditFlow base AE host script is missing: " + base.fsName);
  if (!hardening.exists) throw new Error("EditFlow AE host hardening script is missing: " + hardening.fsName);
  if (!atomicity.exists) throw new Error("EditFlow AE host atomicity script is missing: " + atomicity.fsName);

  $.evalFile(jsonRuntime);
  if (!$.global.EditFlow2_JSON || typeof $.global.EditFlow2_JSON.parse !== "function" || typeof $.global.EditFlow2_JSON.stringify !== "function") {
    throw new Error("EditFlow JSON runtime failed to register.");
  }

  $.evalFile(base);
  $.evalFile(hardening);
  $.evalFile(atomicity);
  if (typeof $.global.EditFlow2_dispatch !== "function") {
    throw new Error("EditFlow current AE dispatcher failed to register.");
  }

  /* The legacy host layers use JSON.parse/stringify internally. ExtendScript does not
   * guarantee a native JSON object, and other Adobe panels can add/remove one. Keep the
   * codec scoped to one EditFlow call so we do not permanently alter the shared host global.
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
