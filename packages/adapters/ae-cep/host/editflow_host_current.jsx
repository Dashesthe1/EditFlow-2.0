/* EditFlow 2.0 current AE host loader: green v1.0 base + protocol 1.1 hardening + operation atomicity. */
(function () {
  var currentFile = new File($.fileName);
  var hostDir = currentFile.parent;
  var base = new File(hostDir.fsName + "/editflow_host.jsx");
  var hardening = new File(hostDir.fsName + "/editflow_host_hardening.jsx");
  var atomicity = new File(hostDir.fsName + "/editflow_host_atomicity.jsx");
  if (!base.exists) throw new Error("EditFlow base AE host script is missing: " + base.fsName);
  if (!hardening.exists) throw new Error("EditFlow AE host hardening script is missing: " + hardening.fsName);
  if (!atomicity.exists) throw new Error("EditFlow AE host atomicity script is missing: " + atomicity.fsName);
  $.evalFile(base);
  $.evalFile(hardening);
  $.evalFile(atomicity);
  if (typeof $.global.EditFlow2_dispatch !== "function") {
    throw new Error("EditFlow current AE dispatcher failed to register.");
  }
}());
