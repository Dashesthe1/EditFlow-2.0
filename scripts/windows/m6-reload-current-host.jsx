(function () {
  "use strict";
  var currentFile = new File($.fileName);
  var repoRoot = currentFile.parent.parent.parent;
  var loader = new File(
    repoRoot.fsName + "/packages/adapters/ae-cep/host/editflow_host_current_v27.jsx"
  );
  if (!loader.exists) throw new Error("M6 accepted protocol 2.7 host loader is missing: " + loader.fsName);
  $.evalFile(loader);
}());
