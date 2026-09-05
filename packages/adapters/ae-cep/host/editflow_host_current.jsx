/* EditFlow 2.0 current AE host loader: base v1.0 + protocol 1.1 hardening. */
(function () {
  var currentFile = new File($.fileName);
  var hostDir = currentFile.parent;
  var base = new File(hostDir.fsName + "/editflow_host.jsx");
  var hardening = new File(hostDir.fsName + "/editflow_host_hardening.jsx");
  if (!base.exists) throw new Error("EditFlow base AE host script is missing: " + base.fsName);
  if (!hardening.exists) throw new Error("EditFlow AE host hardening script is missing: " + hardening.fsName);
  $.evalFile(base);
  $.evalFile(hardening);
  if (typeof $.global.EditFlow2_dispatch !== "function") {
    throw new Error("EditFlow current AE dispatcher failed to register.");
  }
}());
