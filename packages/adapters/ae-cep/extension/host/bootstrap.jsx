/* EditFlow 2.0 CEP host bootstrap. The installer copies current host scripts beside this file. */
(function () {
  var bootstrap = new File($.fileName);
  var hostDir = bootstrap.parent;
  var current = new File(hostDir.fsName + "/editflow_host_current.jsx");
  if (!current.exists) {
    throw new Error("EditFlow 2.0 current AE host script is missing from the installed CEP extension: " + current.fsName);
  }
  $.evalFile(current);
  if (typeof $.global.EditFlow2_dispatch !== "function") {
    throw new Error("EditFlow 2.0 dispatcher failed to register from CEP bootstrap.");
  }
}());
